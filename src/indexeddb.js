/**
 * IndexedDB Storage Manager for API/JS Scanner Extension
 * 
 * This module provides a high-performance, async storage layer to replace Chrome Storage API.
 * Features:
 * - Unlimited storage capacity (vs 10MB Chrome Storage limit)
 * - Zero UI blocking with fully async operations
 * - Automatic batching for optimal performance
 * - Built-in migration from Chrome Storage
 * - Change listeners for reactive updates
 */

const DB_NAME = 'APIJSScannerDB';
const DB_VERSION = 2;

// Object store names
const STORES = {
    API_CALLS: 'apiCalls',
    WEBSOCKETS: 'webSockets',
    SETTINGS: 'settings'
};

class IndexedDBManager {
    constructor() {
        this.db = null;
        this.initPromise = null;
        this.changeListeners = [];
        this.batchQueue = {
            apiCalls: new Map(),
            webSockets: new Map(),
            batchTimeout: null
        };

        // Setup cross-context synchronization
        try {
            this.syncChannel = new BroadcastChannel('APIJSScannerDB_Sync');
            console.log('[IndexedDB] Sync channel created');

            this.syncChannel.onmessage = (event) => {
                console.log('[IndexedDB] Received sync message:', event.data);
                // When receiving update from another context, notify local listeners
                // Pass true as second arg to prevent re-broadcasting
                this.notifyChange(event.data, true);
            };
        } catch (e) {
            console.warn('[IndexedDB] BroadcastChannel not supported:', e);
        }
    }

    /**
     * Initialize the database connection
     * Creates object stores and indices on first run
     */
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('[IndexedDB] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[IndexedDB] Database opened successfully');

                // Migrate from Chrome Storage on first run
                this.migrateFromChromeStorage();

                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('[IndexedDB] Upgrading database schema...');

                // API Calls store
                if (!db.objectStoreNames.contains(STORES.API_CALLS)) {
                    const apiStore = db.createObjectStore(STORES.API_CALLS, { keyPath: 'id' });
                    apiStore.createIndex('sourceDomain', 'sourceDomain', { unique: false });
                    apiStore.createIndex('timestamp', 'timestamp', { unique: false });
                    apiStore.createIndex('status', 'status', { unique: false });
                    apiStore.createIndex('method', 'method', { unique: false });
                    console.log('[IndexedDB] Created API Calls store with indices');
                }

                // WebSockets store
                if (!db.objectStoreNames.contains(STORES.WEBSOCKETS)) {
                    const wsStore = db.createObjectStore(STORES.WEBSOCKETS, { keyPath: 'id' });
                    wsStore.createIndex('timestamp', 'timestamp', { unique: false });
                    wsStore.createIndex('status', 'status', { unique: false });
                    console.log('[IndexedDB] Created WebSockets store with indices');
                }

                // Settings store (for all other data: recording state, folder order, repeater tabs, etc.)
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                    console.log('[IndexedDB] Created Settings store');
                }
            };
        });

        return this.initPromise;
    }

    /**
     * Migrate data from Chrome Storage to IndexedDB
     * Only runs once on first initialization
     */
    async migrateFromChromeStorage() {
        try {
            // Check if migration already completed
            const migrated = await this.getSetting('_migrationCompleted');
            if (migrated) {
                console.log('[IndexedDB] Migration already completed, skipping');
                return;
            }

            console.log('[IndexedDB] Starting migration from Chrome Storage...');

            // Get all data from Chrome Storage
            const chromeData = await new Promise((resolve) => {
                chrome.storage.local.get(null, resolve);
            });

            if (!chromeData || Object.keys(chromeData).length === 0) {
                console.log('[IndexedDB] No Chrome Storage data to migrate');
                await this.setSetting('_migrationCompleted', true);
                return;
            }

            // Migrate collected data
            if (chromeData.collectedData) {
                const { apiCalls = [], webSockets = [] } = chromeData.collectedData;

                // Migrate API calls in batches
                if (apiCalls.length > 0) {
                    console.log(`[IndexedDB] Migrating ${apiCalls.length} API calls...`);
                    await this.batchAddApiCalls(apiCalls);
                }

                // Migrate WebSockets in batches
                if (webSockets.length > 0) {
                    console.log(`[IndexedDB] Migrating ${webSockets.length} WebSocket connections...`);
                    await this.batchAddWebSockets(webSockets);
                }
            }

            // Migrate all settings
            const settingsToMigrate = [
                'isRecording',
                'targetDomain',
                'captureAllRequests',
                'recordingTabId',
                'lastError',
                'startTime',
                'folderOrder',
                'repeaterTabs',
                'activeRepeaterTabId',
                'repeater_pending_request'
            ];

            for (const key of settingsToMigrate) {
                if (chromeData[key] !== undefined) {
                    await this.setSetting(key, chromeData[key]);
                }
            }

            // Mark migration as completed
            await this.setSetting('_migrationCompleted', true);
            console.log('[IndexedDB] Migration completed successfully!');

        } catch (error) {
            console.error('[IndexedDB] Migration failed:', error);
            // Don't throw - allow the extension to continue working
        }
    }

    /**
     * Execute a transaction on a store
     */
    async transaction(storeName, mode, callback) {
        await this.init();
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);

                callback(store, tx);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Add a change listener
     */
    addChangeListener(callback) {
        this.changeListeners.push(callback);
    }

    /**
     * Notify all change listeners
     * @param {Object} changes - The changes to notify
     * @param {boolean} fromRemote - If true, this notification came from another context
     */
    notifyChange(changes, fromRemote = false) {
        // Notify local listeners
        this.changeListeners.forEach(callback => {
            try {
                callback(changes);
            } catch (error) {
                console.error('[IndexedDB] Change listener error:', error);
            }
        });

        // Broadcast to other contexts if this originated locally
        if (!fromRemote && this.syncChannel) {
            try {
                // console.log('[IndexedDB] Broadcasting change:', changes);
                this.syncChannel.postMessage(changes);
            } catch (e) {
                console.error('[IndexedDB] Broadcast failed:', e);
            }
        }
    }

    // ========== SETTINGS OPERATIONS ==========

    /**
     * Get a setting value
     */
    async getSetting(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.SETTINGS, 'readonly');
            const store = tx.objectStore(STORES.SETTINGS);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Set a setting value
     */
    async setSetting(key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.SETTINGS, 'readwrite');
            const store = tx.objectStore(STORES.SETTINGS);
            const request = store.put({ key, value });

            request.onsuccess = () => {
                this.notifyChange({ [key]: { newValue: value } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Remove a setting
     */
    async removeSetting(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.SETTINGS, 'readwrite');
            const store = tx.objectStore(STORES.SETTINGS);
            const request = store.delete(key);

            request.onsuccess = () => {
                this.notifyChange({ [key]: { newValue: undefined } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get multiple settings at once
     */
    async getSettings(keys) {
        await this.init();
        const results = {};

        for (const key of keys) {
            results[key] = await this.getSetting(key);
        }

        return results;
    }

    /**
     * Set multiple settings at once
     */
    async setSettings(keyValuePairs) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.SETTINGS, 'readwrite');
            const store = tx.objectStore(STORES.SETTINGS);

            for (const [key, value] of Object.entries(keyValuePairs)) {
                store.put({ key, value });
            }

            tx.oncomplete = () => {
                const changes = {};
                for (const [key, value] of Object.entries(keyValuePairs)) {
                    changes[key] = { newValue: value };
                }
                this.notifyChange(changes);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    // ========== API CALLS OPERATIONS ==========

    /**
     * Get all API calls
     */
    async getApiCalls(filters = {}) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readonly');
            const store = tx.objectStore(STORES.API_CALLS);
            const request = store.getAll();

            request.onsuccess = () => {
                let results = request.result || [];

                // Apply filters if provided
                if (filters.sourceDomain) {
                    results = results.filter(call => call.sourceDomain === filters.sourceDomain);
                }
                if (filters.method) {
                    results = results.filter(call => call.method === filters.method);
                }
                if (filters.status) {
                    results = results.filter(call => call.status === filters.status);
                }

                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Add a single API call (with batching)
     */
    async addApiCall(data) {
        // Add to batch queue
        this.batchQueue.apiCalls.set(data.id, data);

        // Debounce: flush batch after 100ms of inactivity
        clearTimeout(this.batchQueue.batchTimeout);
        this.batchQueue.batchTimeout = setTimeout(() => {
            this.flushApiCallBatch();
        }, 100);
    }

    /**
     * Flush the API call batch queue
     */
    async flushApiCallBatch() {
        if (this.batchQueue.apiCalls.size === 0) return;

        const batch = Array.from(this.batchQueue.apiCalls.values());
        this.batchQueue.apiCalls.clear();

        await this.batchAddApiCalls(batch);
    }

    /**
     * Add multiple API calls in a single transaction (fast)
     */
    async batchAddApiCalls(apiCalls) {
        if (!apiCalls || apiCalls.length === 0) return;

        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readwrite');
            const store = tx.objectStore(STORES.API_CALLS);

            for (const call of apiCalls) {
                store.put(call);
            }

            tx.oncomplete = () => {
                this.notifyChange({ collectedData: { newValue: { apiCalls } } });
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Update an existing API call
     */
    async updateApiCall(id, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readwrite');
            const store = tx.objectStore(STORES.API_CALLS);

            // Get existing data first
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const existingData = getRequest.result || {};
                const updatedData = { ...existingData, ...data, id };

                const putRequest = store.put(updatedData);
                putRequest.onsuccess = () => resolve(updatedData);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * Delete an API call
     */
    async deleteApiCall(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readwrite');
            const store = tx.objectStore(STORES.API_CALLS);
            const request = store.delete(id);

            request.onsuccess = () => {
                this.notifyChange({ collectedData: { newValue: {} } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete multiple API calls
     */
    async deleteApiCalls(ids) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readwrite');
            const store = tx.objectStore(STORES.API_CALLS);

            for (const id of ids) {
                store.delete(id);
            }

            tx.oncomplete = () => {
                this.notifyChange({ collectedData: { newValue: {} } });
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Clear all API calls
     */
    async clearApiCalls() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readwrite');
            const store = tx.objectStore(STORES.API_CALLS);
            const request = store.clear();

            request.onsuccess = () => {
                this.notifyChange({ collectedData: { newValue: { apiCalls: [] } } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get API calls with advanced filtering using cursor streaming
     * precise filtering before loading into memory
     */
    async getFilteredApiCalls(filters = {}) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.API_CALLS, 'readonly');
            const store = tx.objectStore(STORES.API_CALLS);
            const request = store.openCursor(null, 'prev'); // Newest first
            const results = [];
            const limit = filters.limit || 5000; // Safety limit

            // Pre-compile Regex if needed
            let urlRegex = null;
            try {
                if (filters.urlRegex) {
                    urlRegex = new RegExp(filters.urlRegex, 'i');
                }
            } catch (e) {
                console.error('[IndexedDB] Invalid Regex:', e);
            }

            // Normalizing filter lists for faster lookup
            const inScopeDomains = (filters.inScope && Array.isArray(filters.inScope)) ? filters.inScope.map(d => d.trim().toLowerCase()).filter(d => d) : [];
            const mimeTypes = (filters.mimeTypes && Array.isArray(filters.mimeTypes)) ? new Set(filters.mimeTypes) : null;
            const excludedExtensions = (filters.excludedExtensions && Array.isArray(filters.excludedExtensions)) ? new Set(filters.excludedExtensions.map(e => e.trim().toLowerCase().replace(/^\./, ''))) : null;
            const excludedPaths = (filters.excludedPaths && Array.isArray(filters.excludedPaths)) ? filters.excludedPaths.map(p => p.trim().toLowerCase()) : null;

            // console.log('[IndexedDB] Filtering with:', {
            //     inScopeCount: inScopeDomains.length,
            //     mimeTypes: mimeTypes ? mimeTypes.size : 'All',
            //     excludedExtensionsCount: excludedExtensions ? excludedExtensions.size : 'None',
            //     excludedPaths: excludedPaths
            // });

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    let match = true;

                    // 0. Static Path Filter (Exclude)
                    // Always apply excluded paths unless it's an API request? 
                    // Usually we want to block /assets/ even if it is XHR if user explicitly put it there? 
                    // But let's stick to standard behavior: Excludes apply globally.
                    if (match && excludedPaths) {
                        try {
                            let pathname = '';
                            try {
                                pathname = new URL(item.url).pathname;
                            } catch (e) { pathname = item.url; }

                            pathname = pathname.toLowerCase();
                            for (const seg of excludedPaths) {
                                if (pathname.includes('/' + seg + '/') || pathname.endsWith('/' + seg)) {
                                    match = false;
                                    break;
                                }
                            }
                        } catch (e) { }
                    }

                    // 1. In-Scope Filter (Wildcard Support)
                    if (match && inScopeDomains.length > 0) {
                        let domainMatch = false;
                        const itemUrl = item.url.toLowerCase();
                        const itemDomain = item.sourceDomain ? item.sourceDomain.toLowerCase() : '';

                        for (const scope of inScopeDomains) {
                            // Handle Wildcards
                            if (scope.includes('*')) {
                                let regexStr;
                                if (scope.startsWith('*.')) {
                                    const base = scope.substring(2).replace(/\./g, '\\.');
                                    regexStr = `^(?:.*\\.)?${base}$`;
                                } else {
                                    const pattern = scope.replace(/\./g, '\\.').replace(/\*/g, '.*');
                                    regexStr = `^${pattern}$`;
                                }
                                const scopeRegex = new RegExp(regexStr);
                                if (scopeRegex.test(itemDomain)) {
                                    domainMatch = true;
                                    break;
                                }
                                try {
                                    const urlHost = new URL(itemUrl).hostname;
                                    if (scopeRegex.test(urlHost)) {
                                        domainMatch = true;
                                        break;
                                    }
                                } catch (e) { }
                            } else {
                                if (itemDomain === scope || itemUrl.includes(scope)) {
                                    domainMatch = true;
                                    break;
                                }
                            }
                        }
                        if (!domainMatch) match = false;
                    }

                    // 2. Additive MIME Filter & Type Logic
                    // Rules:
                    // - XHR/Fetch/WebSocket are ALWAYS shown (unless scope/path excluded them).
                    // - Static files (Images, JS, CSS, Fonts) are ONLY shown if their Type is in mimeTypes list.
                    // - If mimeTypes is empty/null, it implies "Only APIs" mode (strict).

                    if (match) {
                        const requestType = (item.type || '').toLowerCase();
                        // Explicitly include all API-like methods including typical "other" from older extensions if needed, but 'xmlhttprequest' is key
                        const isApiRequest = requestType === 'xhr' || requestType === 'fetch' || requestType === 'websocket' || requestType === 'xmlhttprequest';

                        if (isApiRequest) {
                            // API requests still need content-type checking
                            // Don't bypass - continue to type detection below
                        }

                        // A. Robust Type Detection (applies to ALL requests now)
                        let detectedType = 'unknown';

                        // Check explicit response mime first
                        let mime = '';
                        if (item.response && item.response.mimeType) {
                            mime = item.response.mimeType.toLowerCase();
                        } else if (item.response && item.response.headers) {
                            const h = item.response.headers.find(x => x.name.toLowerCase() === 'content-type');
                            if (h) mime = h.value.split(';')[0].trim().toLowerCase();
                        }

                        const u = item.url.toLowerCase();

                        // Categorize based on known signatures
                        if (mime.includes('javascript') || mime.includes('ecmascript') ||
                            requestType === 'script' ||
                            u.match(/\.(js|mjs|jsx|ts|tsx)(\?.*)?$/)) {
                            detectedType = 'js';
                        } else if (mime.includes('css') || requestType === 'stylesheet' || u.match(/\.css(\?.*)?$/)) {
                            detectedType = 'css';
                        } else if (mime.includes('image') || requestType === 'image' || u.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|bmp)(\?.*)?$/)) {
                            detectedType = 'image';
                        } else if (mime.includes('font') || requestType === 'font' || u.match(/\.(woff|woff2|ttf|eot|otf)(\?.*)?$/)) {
                            detectedType = 'font';
                        } else if (mime.includes('json') || u.match(/\.json(\?.*)?$/)) {
                            detectedType = 'json';
                        } else if (mime.includes('html') || requestType === 'main_frame' || requestType === 'sub_frame') {
                            detectedType = 'doc';
                        } else if (mime.includes('xml') || u.match(/\.xml(\?.*)?$/)) { // Explicit XML detection
                            detectedType = 'xml';
                        } else if (mime.includes('text/plain')) {
                            detectedType = 'other';
                        } else if (isApiRequest) {
                            // Pure API call without specific static file type
                            detectedType = 'api';
                        } else {
                            detectedType = 'other';
                        }

                        // Match Logic: Determine if this type should be shown
                        // RULE: Always show XHR/Fetch/WebSocket API calls and Documents
                        // RULE: Static assets (JS/CSS/Image/Font) only shown if explicitly requested

                        const staticTypes = ['js', 'css', 'image', 'font'];
                        const alwaysShowTypes = ['json', 'xml', 'doc', 'api', 'other'];

                        let typeAllowed = false;

                        // 1. Always show non-static API types (JSON, XML, Doc, API, Other)
                        if (alwaysShowTypes.includes(detectedType)) {
                            typeAllowed = true;
                        }
                        // 2. Show static types ONLY if explicitly requested in filter
                        else if (staticTypes.includes(detectedType) && mimeTypes && mimeTypes.has(detectedType)) {
                            typeAllowed = true;
                        }
                        // 3. Show unknown types by default (fallback)
                        else if (!staticTypes.includes(detectedType)) {
                            typeAllowed = true;
                        }
                        // 4. Special case for media/images if requested
                        if (!typeAllowed && detectedType === 'image' && mimeTypes && mimeTypes.has('media')) {
                            typeAllowed = true;
                        }

                        // Custom Mime fallthrough
                        if (!typeAllowed && filters.customMime && mime.includes(filters.customMime.toLowerCase())) {
                            typeAllowed = true;
                        }

                        if (!typeAllowed) {
                            match = false;
                        }
                    }

                    // 3. Extension Filter (Exclude) - still applies to strictly remove clutter if user wants
                    // This is "Excluded Extensions" list. 
                    // If user explicitly excludes 'js' here, it overrides the 'Include JS' checkbox?
                    // Typically 'Exclude' has higher priority.
                    if (match && excludedExtensions) {
                        try {
                            const urlObj = new URL(item.url);
                            const pathname = urlObj.pathname;
                            const ext = pathname.split('.').pop().toLowerCase();
                            // Simple check: if extension exists and is in exclude list
                            if (ext && ext !== pathname && excludedExtensions.has(ext)) {
                                match = false;
                            }
                        } catch (e) { }
                    }

                    // 4. Regex Filter (Include)
                    if (match && urlRegex) {
                        if (!urlRegex.test(item.url)) {
                            match = false;
                        }
                    }

                    // Add to results if matched
                    if (match) {
                        results.push(item);
                        // Store the detected type on the item for UI to reuse? 
                        // It would save UI from re-calculating.
                        // However, we can't easily modify the object in cursor without update. 
                        // Just returning it is fine.
                    }

                    // Continue if limit not reached
                    if (results.length < limit) {
                        cursor.continue();
                    } else {
                        console.log(`[IndexedDB] Filtered Results: ${results.length}`);
                        resolve(results);
                    }
                } else {
                    console.log(`[IndexedDB] Cursor finished. Filtered Results: ${results.length}`);
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ========== WEBSOCKETS OPERATIONS ==========

    /**
     * Get all WebSockets
     */
    async getWebSockets() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WEBSOCKETS, 'readonly');
            const store = tx.objectStore(STORES.WEBSOCKETS);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Add a single WebSocket (with batching)
     */
    async addWebSocket(data) {
        // Add to batch queue
        this.batchQueue.webSockets.set(data.id, data);

        // Debounce: flush batch after 100ms of inactivity
        clearTimeout(this.batchQueue.batchTimeout);
        this.batchQueue.batchTimeout = setTimeout(() => {
            this.flushWebSocketBatch();
        }, 100);
    }

    /**
     * Flush the WebSocket batch queue
     */
    async flushWebSocketBatch() {
        if (this.batchQueue.webSockets.size === 0) return;

        const batch = Array.from(this.batchQueue.webSockets.values());
        this.batchQueue.webSockets.clear();

        await this.batchAddWebSockets(batch);
    }

    /**
     * Add multiple WebSockets in a single transaction (fast)
     */
    async batchAddWebSockets(webSockets) {
        if (!webSockets || webSockets.length === 0) return;

        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WEBSOCKETS, 'readwrite');
            const store = tx.objectStore(STORES.WEBSOCKETS);

            for (const ws of webSockets) {
                store.put(ws);
            }

            tx.oncomplete = () => {
                this.notifyChange({ collectedData: { newValue: { webSockets } } });
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Update an existing WebSocket
     */
    async updateWebSocket(id, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WEBSOCKETS, 'readwrite');
            const store = tx.objectStore(STORES.WEBSOCKETS);

            // Get existing data first
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const existingData = getRequest.result || {};
                const updatedData = { ...existingData, ...data, id };

                const putRequest = store.put(updatedData);
                putRequest.onsuccess = () => resolve(updatedData);
                putRequest.onerror = () => reject(putRequest.error);
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    /**
     * Delete a WebSocket
     */
    async deleteWebSocket(id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WEBSOCKETS, 'readwrite');
            const store = tx.objectStore(STORES.WEBSOCKETS);
            const request = store.delete(id);

            request.onsuccess = () => {
                this.notifyChange({ collectedData: { newValue: {} } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all WebSockets
     */
    async clearWebSockets() {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORES.WEBSOCKETS, 'readwrite');
            const store = tx.objectStore(STORES.WEBSOCKETS);
            const request = store.clear();

            request.onsuccess = () => {
                this.notifyChange({ collectedData: { newValue: { webSockets: [] } } });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ========== CONVENIENCE METHODS ==========

    /**
     * Get collected data (API calls + WebSockets)
     */
    async getCollectedData() {
        const [apiCalls, webSockets] = await Promise.all([
            this.getApiCalls(),
            this.getWebSockets()
        ]);

        return {
            apiCalls,
            webSockets,
            jsFiles: {} // Legacy field, kept for compatibility
        };
    }

    /**
     * Clear all collected data
     */
    async clearAllData() {
        await Promise.all([
            this.clearApiCalls(),
            this.clearWebSockets()
        ]);
    }

    /**
     * Get storage statistics
     */
    async getStats() {
        const [apiCalls, webSockets] = await Promise.all([
            this.getApiCalls(),
            this.getWebSockets()
        ]);

        return {
            apiCallsCount: apiCalls.length,
            webSocketsCount: webSockets.length,
            totalItems: apiCalls.length + webSockets.length
        };
    }
}

// Create singleton instance
const storageDB = new IndexedDBManager();

// Make it globally available immediately (works in both service worker and window contexts)
if (typeof self !== 'undefined') {
    self.StorageDB = storageDB;
}

// Export for use in other modules (Node.js style)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = storageDB;
}
