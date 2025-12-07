class HttpRequestPage extends DashboardCommon {
    constructor() {
        super();
        this.selectedItem = null;
        this.filters = { search: '', method: 'ALL', status: 'ALL' };
        // Advanced History Filters
        // Default lists
        const defaultExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'wasm', 'ico', 'webp', 'bmp', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'pdf', 'zip', 'rar', 'tar', 'gz', '7z'];
        const defaultPaths = ['images', 'img', 'assets', 'static', 'media', 'fonts', 'styles', 'icons', 'files'];

        this.historyFilters = {
            inScope: [],
            mimeTypes: [],  // Default: Smart Filter (Show everything except static assets)
            customMime: '',
            excludedExtensions: defaultExtensions,
            excludedPaths: defaultPaths,
            urlRegex: ''
        };

        this.searchMatchIndex = 0;
        this.searchMatchesTotal = 0;
        this.expandedGroups = new Set(); // Track which folders are expanded

        this.elements = {
            apiList: document.getElementById('apiList'),
            detailsPane: document.getElementById('detailsPane'),
            detailsEmpty: document.getElementById('detailsEmpty'),
            detailsContent: document.getElementById('detailsContent'),
            detailsBody: document.getElementById('detailsBody'),
            searchInput: document.getElementById('searchInput'),
            methodFilter: document.getElementById('methodFilter'), // Top bar list filter
            statusFilter: document.getElementById('statusFilter'), // Top bar list filter

            // Advanced Filter Elements
            filterSettingsBtn: document.getElementById('filterSettingsBtn'),
            filterModal: document.getElementById('filterModal'),
            closeFilterModal: document.getElementById('closeFilterModal'),
            cancelFiltersBtn: document.getElementById('cancelFiltersBtn'),
            applyFiltersBtn: document.getElementById('applyFiltersBtn'),
            resetFiltersBtn: document.getElementById('resetFiltersBtn'),

            filterInScope: document.getElementById('filterInScope'),
            filterCustomMime: document.getElementById('filterCustomMime'),
            filterExtensions: document.getElementById('filterExtensions'),
            filterStaticPaths: document.getElementById('filterStaticPaths'),
            filterRegex: document.getElementById('filterRegex'),

            dragHandle: document.getElementById('dragHandle'),
            listPane: document.querySelector('.list-pane'),
            copyCurlBtn: document.getElementById('copyCurlBtn'),
            sendToRepeaterBtn: document.getElementById('sendToRepeaterBtn'),
            highlightBtn: document.getElementById('highlightBtn'),
            highlightMenu: document.getElementById('highlightMenu'),
            contextMenu: document.getElementById('contextMenu'),
            ctxSendToRepeater: document.getElementById('ctxSendToRepeater'),
            ctxDeleteRequest: document.getElementById('ctxDeleteRequest'),
            folderContextMenu: document.getElementById('folderContextMenu'),
            ctxDeleteFolder: document.getElementById('ctxDeleteFolder'),
            searchNav: document.getElementById('searchNav'),
            searchCounter: document.getElementById('searchCounter'),
            searchPrevBtn: document.getElementById('searchPrevBtn'),
            searchNextBtn: document.getElementById('searchNextBtn')
        };

        this.contextMenuItem = null;

        // Flag to track filter loading
        this.filtersLoaded = false;
        this.filtersLoadingPromise = this.loadHistoryFilters();

        // Initialize logic
        // this.loadHistoryFilters() is called above and stored in promise
        this.setupPageListeners();
        this.loadFolderOrder();
    }

    /**
     * Override base loadData to use cursor filtering
     */
    async loadData() {
        // Ensure filters are loaded first
        if (!this.filtersLoaded && this.filtersLoadingPromise) {
            await this.filtersLoadingPromise;
        }

        // We do typically get called by constructor -> loadData -> refreshFilteredData
        // But also base class calls this.
        await this.refreshFilteredData();

        const isRecording = await this.storageDB.getSetting('isRecording');
        this.updateConnectionStatus(isRecording);
    }

    /**
     * Override onDataUpdated to refresh specifically our filtered list
     */
    onDataUpdated() {
        this.refreshFilteredData();
    }

    /**
     * Override onItemsAdded to determine if we should just append (simple) or full refresh (filtered)
     * With cursor filtering, it's safer to full refresh or check if new item matches filter.
     * For now, simplistic approach: Full refresh to guarantee consistency.
     */
    onItemsAdded(updates) {
        this.refreshFilteredData();
    }

    async refreshFilteredData() {
        try {
            // Fetch filtered data using cursor
            const filteredCalls = await this.storageDB.getFilteredApiCalls(this.historyFilters);

            // Update local data reference
            this.data.apiCalls = filteredCalls;

            // Update counts (displaying filtered count vs total might be nice, but simple count for now)
            const apiCount = document.getElementById('apiCount');
            if (apiCount) apiCount.textContent = filteredCalls.length;

            // Render
            this.renderList();

            // Update filter button state
            this.updateFilterButtonState();

        } catch (error) {
            console.error('[HttpRequestPage] Error refreshing filtered data:', error);
        }
    }

    async loadHistoryFilters() {
        try {
            if (!this.storageDB) return;
            const settings = await this.storageDB.getSetting('historyFilters');
            if (settings) {
                this.historyFilters = { ...this.historyFilters, ...settings };

                // POPULATE DEFAULTS IF EMPTY
                const defaultExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'wasm', 'ico', 'webp', 'bmp', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'pdf', 'zip', 'rar', 'tar', 'gz', '7z'];
                const defaultPaths = ['images', 'img', 'assets', 'static', 'media', 'fonts', 'styles', 'icons', 'files'];

                if (!this.historyFilters.excludedExtensions || this.historyFilters.excludedExtensions.length === 0) {
                    this.historyFilters.excludedExtensions = defaultExtensions;
                }
                if (!this.historyFilters.excludedPaths || this.historyFilters.excludedPaths.length === 0) {
                    this.historyFilters.excludedPaths = defaultPaths;
                }

                // MIGRATION: Convert legacy MIME strings to simple categories
                if (this.historyFilters.mimeTypes && Array.isArray(this.historyFilters.mimeTypes)) {
                    let migrationNeeded = false;
                    const newMimes = this.historyFilters.mimeTypes.map(m => {
                        const low = m.toLowerCase();
                        if (low.includes('javascript') || low.includes('ecmascript')) { migrationNeeded = true; return 'js'; }
                        if (low === 'text/css') { migrationNeeded = true; return 'css'; }
                        if (low.includes('image')) { migrationNeeded = true; return 'image'; }
                        if (low.includes('font')) { migrationNeeded = true; return 'font'; }
                        if (low === 'text/html') { migrationNeeded = true; return 'doc'; }
                        if (low.includes('json') && low !== 'json') { migrationNeeded = true; return 'json'; }
                        return m;
                    });

                    if (migrationNeeded) {
                        // De-duplicate
                        this.historyFilters.mimeTypes = [...new Set(newMimes)];
                        console.log('Migrated legacy filters to:', this.historyFilters.mimeTypes);
                        this.saveHistoryFilters(); // Persist migration
                    }
                }

                console.log('Loaded history filters:', this.historyFilters);
            } else {
                // No saved settings - save defaults to storage
                console.log('No saved filters, saving defaults');
                await this.saveHistoryFilters();
            }
        } catch (e) {
            console.error('Error loading filters:', e);
        } finally {
            this.filtersLoaded = true;
        }
    }

    async saveHistoryFilters() {
        try {
            await this.storageDB.setSetting('historyFilters', this.historyFilters);
            this.updateFilterButtonState();
            this.refreshFilteredData(); // Reload list with new filters
        } catch (e) {
            console.error('Error saving filters:', e);
        }
    }

    async loadFolderOrder() {
        try {
            if (!this.storageDB) return;
            const order = await this.storageDB.getSetting('folderOrder');
            if (Array.isArray(order)) {
                this.folderOrder = order;
            } else {
                this.folderOrder = [];
            }
        } catch (e) {
            this.folderOrder = [];
        }
    }

    async saveFolderOrder() {
        try {
            if (this.folderOrder && this.folderOrder.length > 0) {
                await this.storageDB.setSetting('folderOrder', this.folderOrder);
            }
        } catch (e) { }
    }

    updateFilterButtonState() {
        const hasFilters = this.historyFilters.inScope.length > 0 ||
            (this.historyFilters.mimeTypes !== null) ||  // Active if not null (even if empty, as empty = strict API only)
            this.historyFilters.customMime ||
            this.historyFilters.excludedExtensions.length > 0 ||
            this.historyFilters.urlRegex;

        if (hasFilters) {
            this.elements.filterSettingsBtn.classList.add('filter-btn-active');
        } else {
            this.elements.filterSettingsBtn.classList.remove('filter-btn-active');
        }
    }

    // Open Modal and populate inputs with current settings
    openFilterModal() {
        const f = this.historyFilters;

        this.elements.filterInScope.value = f.inScope ? f.inScope.join('\n') : '';
        this.elements.filterCustomMime.value = f.customMime || '';

        // Comma separated lists
        this.elements.filterExtensions.value = f.excludedExtensions ? f.excludedExtensions.join(', ') : '';
        this.elements.filterStaticPaths.value = f.excludedPaths ? f.excludedPaths.join(', ') : '';

        this.elements.filterRegex.value = f.urlRegex || '';

        // Checkboxes - Handle single and comma-separated values
        document.querySelectorAll('input[name="mime"]').forEach(cb => {
            if (!this.historyFilters.mimeTypes) {
                cb.checked = false;
                return;
            }

            if (cb.value.includes(',')) {
                // If checkbox represents multiple types (e.g. JS), check if any of them are present
                // (or checking all? checking any is safer for partial legacy data)
                const values = cb.value.split(',').map(v => v.trim());
                cb.checked = values.some(v => this.historyFilters.mimeTypes.includes(v));
            } else {
                cb.checked = this.historyFilters.mimeTypes.includes(cb.value);
            }
        });

        this.elements.filterModal.classList.add('active');
    }

    closeFilterModal() {
        this.elements.filterModal.classList.remove('active');
    }

    applyFiltersFromModal() {
        // Parse In-Scope
        const inScopeRaw = this.elements.filterInScope.value;
        const inScope = inScopeRaw.split('\n').map(s => s.trim()).filter(s => s);

        // Parse Extensions (Comma list)
        const extRaw = this.elements.filterExtensions.value;
        let excludedExtensions = extRaw.split(',').map(s => s.trim()).filter(s => s);

        // Parse Static Paths (Comma list)
        const pathRaw = this.elements.filterStaticPaths.value;
        const excludedPaths = pathRaw.split(',').map(s => s.trim()).filter(s => s);

        // Parse Regex
        const urlRegex = this.elements.filterRegex.value.trim();

        // Parse Mime - use empty array if no checkboxes (Strict Filtering: Only APIs)
        const checkedBoxes = document.querySelectorAll('input[name="mime"]:checked');
        const mimeTypes = []; // Default to empty array (Strict) instead of null (All)

        checkedBoxes.forEach(cb => {
            if (cb.value.includes(',')) {
                cb.value.split(',').forEach(v => mimeTypes.push(v.trim()));
            } else {
                mimeTypes.push(cb.value);
            }
        });

        const customMime = this.elements.filterCustomMime.value.trim();

        // Update State
        this.historyFilters = {
            inScope,
            mimeTypes,
            customMime,
            excludedExtensions,
            excludedPaths,
            urlRegex
        };

        // Save & Refresh
        this.saveHistoryFilters();
        this.closeFilterModal();
    }

    resetFilters() {
        // Defaults per user request
        const defaultExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'wasm', 'ico', 'webp', 'bmp', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'pdf', 'zip', 'rar', 'tar', 'gz', '7z'];
        const defaultPaths = ['images', 'img', 'assets', 'static', 'media', 'fonts', 'styles', 'icons', 'files'];

        this.historyFilters = {
            inScope: [],
            mimeTypes: [],  // Default to Smart Filtering
            customMime: '',
            excludedExtensions: defaultExtensions,
            excludedPaths: defaultPaths,
            urlRegex: ''
        };
        this.saveHistoryFilters();

        // Clear inputs visually if modal open
        this.elements.filterInScope.value = '';
        this.elements.filterCustomMime.value = '';
        this.elements.filterExtensions.value = defaultExtensions.join(', ');
        this.elements.filterStaticPaths.value = defaultPaths.join(', ');
        this.elements.filterRegex.value = '';
        document.querySelectorAll('input[name="mime"]').forEach(cb => cb.checked = false);

        this.closeFilterModal();
    }

    setupPageListeners() {
        // Filter UI Events
        this.elements.filterSettingsBtn.addEventListener('click', () => this.openFilterModal());
        this.elements.closeFilterModal.addEventListener('click', () => this.closeFilterModal());
        this.elements.cancelFiltersBtn.addEventListener('click', () => this.closeFilterModal());
        this.elements.applyFiltersBtn.addEventListener('click', () => this.applyFiltersFromModal());
        this.elements.resetFiltersBtn.addEventListener('click', () => this.resetFilters());

        // Close modal on outside click
        this.elements.filterModal.addEventListener('click', (e) => {
            if (e.target === this.elements.filterModal) this.closeFilterModal();
        });

        // Search & Filter (List level)
        this.elements.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.searchMatchIndex = 0;
            this.renderList();
            this.updateSearchNav();

            // Auto-expand folders and scroll to first match
            if (this.filters.search) {
                setTimeout(() => {
                    this.expandAllFoldersWithMatches();
                    this.scrollToFirstMatch();
                }, 100);
            }
        });
        this.elements.methodFilter.addEventListener('change', (e) => {
            this.filters.method = e.target.value;
            this.renderList();
        });
        this.elements.statusFilter.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.renderList();
        });

        // Search keyboard navigation  
        this.elements.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.searchPrevMatch();
                } else {
                    this.searchNextMatch();
                }
            }
        });

        // Search navigation buttons
        this.elements.searchPrevBtn.addEventListener('click', () => this.searchPrevMatch());
        this.elements.searchNextBtn.addEventListener('click', () => this.searchNextMatch());

        // Resizer
        let isResizing = false;
        this.elements.dragHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerWidth = document.getElementById('splitViewContainer').offsetWidth;
            const newWidth = (e.clientX - 260); // Subtract sidebar width
            const percentage = (newWidth / containerWidth) * 100;
            if (percentage > 20 && percentage < 80) {
                this.elements.listPane.style.width = `${percentage}%`;
            }
        });
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });

        // Detail Tabs
        document.querySelectorAll('.detail-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                const view = e.target.dataset.view;
                this.renderDetails(view);
            });
        });

        // Copy Curl
        this.elements.copyCurlBtn.addEventListener('click', () => this.copyAsCurl());

        // Send to Repeater
        this.elements.sendToRepeaterBtn.addEventListener('click', () => this.sendToRepeater());

        // Highlight
        this.elements.highlightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.highlightMenu.classList.toggle('hidden');
            const rect = this.elements.highlightBtn.getBoundingClientRect();
            this.elements.highlightMenu.style.top = `${rect.bottom + 5}px`;
            this.elements.highlightMenu.style.left = `${rect.left - 100}px`;
        });

        document.querySelectorAll('.highlight-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const color = e.currentTarget.dataset.color;
                this.setHighlight(color);
                this.elements.highlightMenu.classList.add('hidden');
            });
        });

        // Global click handler to close menus
        document.addEventListener('click', () => {
            this.elements.highlightMenu.classList.add('hidden');
            this.elements.contextMenu.classList.add('hidden');
            this.elements.folderContextMenu.classList.add('hidden');
        });

        // Context Menu - Send to Repeater
        this.elements.ctxSendToRepeater.addEventListener('click', () => {
            if (this.contextMenuItem) {
                this.sendToRepeater(this.contextMenuItem);
                this.elements.contextMenu.classList.add('hidden');
            }
        });

        // Context Menu - Delete Request
        this.elements.ctxDeleteRequest.addEventListener('click', () => {
            if (this.contextMenuItem) {
                if (confirm('Are you sure you want to delete this request?')) {
                    this.deleteRequest(this.contextMenuItem);
                }
                this.elements.contextMenu.classList.add('hidden');
            }
        });

        // Folder Context Menu - Delete Folder
        this.elements.ctxDeleteFolder.addEventListener('click', () => {
            if (this.contextFolderDomain) {
                const count = this.data.apiCalls.filter(req => req.sourceDomain === this.contextFolderDomain).length;
                if (confirm(`Delete all ${count} request(s) from "${this.contextFolderDomain}"?`)) {
                    this.deleteFolder(this.contextFolderDomain);
                }
                this.elements.folderContextMenu.classList.add('hidden');
            }
        });
    }

    renderList() {
        const list = this.elements.apiList;
        const scrollTop = list.scrollTop;

        // Store scroll positions of all group-content containers
        const groupScrollPositions = new Map();
        document.querySelectorAll('.group-content').forEach((groupContent) => {
            const groupName = groupContent.closest('.request-group')?.querySelector('.group-name')?.textContent;
            if (groupName) {
                groupScrollPositions.set(groupName, groupContent.scrollTop);
            }
        });

        list.innerHTML = '';

        const filtered = this.data.apiCalls.filter(item => {
            // Enhanced search - searches in URL, method, headers, bodies, and status
            let matchSearch = !this.filters.search;

            if (this.filters.search) {
                const searchTerm = this.filters.search;

                // Search in URL and method
                matchSearch = item.url.toLowerCase().includes(searchTerm) ||
                    item.method.toLowerCase().includes(searchTerm);

                // Search in status code
                if (!matchSearch && item.response && item.response.statusCode) {
                    matchSearch = item.response.statusCode.toString().includes(searchTerm);
                }

                // Search in request headers
                if (!matchSearch && item.requestHeaders) {
                    matchSearch = item.requestHeaders.some(h =>
                        h.name.toLowerCase().includes(searchTerm) ||
                        h.value.toLowerCase().includes(searchTerm)
                    );
                }

                // Search in request body
                if (!matchSearch && item.requestBody) {
                    const body = typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody);
                    matchSearch = body.toLowerCase().includes(searchTerm);
                }

                // Search in response headers
                if (!matchSearch && item.response && item.response.headers) {
                    const headers = Array.isArray(item.response.headers) ? item.response.headers : Object.entries(item.response.headers).map(([name, value]) => ({ name, value }));
                    matchSearch = headers.some(h =>
                        h.name.toLowerCase().includes(searchTerm) ||
                        h.value.toLowerCase().includes(searchTerm)
                    );
                }

                // Search in response body
                if (!matchSearch && item.response && item.response.body) {
                    const body = typeof item.response.body === 'string' ? item.response.body : JSON.stringify(item.response.body);
                    matchSearch = body.toLowerCase().includes(searchTerm);
                }
            }
            const matchMethod = this.filters.method === 'ALL' || item.method === this.filters.method;

            let matchStatus = true;
            if (this.filters.status !== 'ALL') {
                const code = item.response ? item.response.statusCode : 0;
                if (this.filters.status === '2xx') matchStatus = code >= 200 && code < 300;
                else if (this.filters.status === '3xx') matchStatus = code >= 300 && code < 400;
                else if (this.filters.status === '4xx') matchStatus = code >= 400 && code < 500;
                else if (this.filters.status === '5xx') matchStatus = code >= 500;
            }

            return matchSearch && matchMethod && matchStatus;
        });

        if (filtered.length === 0) {
            list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No requests found</h3>
          <p>Try adjusting your filters</p>
        </div>
      `;
            return;
        }

        // Group by Source Domain (the site that originated the requests)
        const groups = {};
        const domains = new Set();
        filtered.forEach(item => {
            let domain = item.sourceDomain || 'Unknown';
            if (!groups[domain]) groups[domain] = [];
            groups[domain].push(item);
            domains.add(domain);
        });

        // If only one domain, render flat list
        if (domains.size <= 1) {
            this.renderItems(filtered, list);
        } else {
            // Render groups - use custom order if it exists, otherwise alphabetical
            // Ensure folderOrder is up to date with current domains
            if (!this.folderOrder) this.folderOrder = [];

            // Add any missing domains to folderOrder
            Object.keys(groups).forEach(domain => {
                if (!this.folderOrder.includes(domain)) {
                    this.folderOrder.push(domain);
                }
            });

            // Clean up folderOrder - remove domains that no longer exist in current view (optional, but keeps list clean)
            // Actually, for search consistency, we might want to keep them or just filter for display
            const displayList = this.folderOrder.filter(d => groups[d]);

            displayList.forEach(domain => {
                const items = groups[domain];

                // Group Header
                const groupEl = document.createElement('div');
                groupEl.className = 'request-group';
                groupEl.draggable = true;
                groupEl.dataset.domain = domain;

                const headerEl = document.createElement('div');
                headerEl.className = 'group-header';

                // Initialize collapsedGroups if not exists
                if (!this.collapsedGroups) this.collapsedGroups = new Set();

                // Folders are collapsed by default, unless explicitly opened
                const isCollapsed = !this.expandedGroups || !this.expandedGroups.has(domain);

                headerEl.innerHTML = `
                    <div class="group-info">
                        <span class="group-icon">${isCollapsed ? '📁' : '📂'}</span>
                        <span class="group-name">${domain}</span>
                        <span class="group-count">${items.length}</span>
                    </div>
                    <div class="group-toggle">
                        <svg class="chevron ${isCollapsed ? 'collapsed' : ''}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                `;

                // Content Container
                const contentEl = document.createElement('div');
                contentEl.className = `group-content ${isCollapsed ? 'hidden' : ''}`;
                contentEl.dataset.groupName = domain; // Add identifier for scroll restoration

                // Categorize Items
                const rootItems = [];
                const jsItems = [];
                const otherItems = [];

                items.forEach(item => {
                    const urlLower = item.url.toLowerCase();
                    const type = (item.type || '').toLowerCase();
                    // Explicitly include all API-like methods
                    const isApiRequest = type === 'xhr' || type === 'fetch' || type === 'websocket' || type === 'xmlhttprequest';

                    // Robust Type Detection for UI Grouping (Must mirror IndexedDB)
                    let detectedType = 'unknown';

                    // Check explicit response mime first
                    let mime = '';
                    if (item.response && item.response.mimeType) {
                        mime = item.response.mimeType.toLowerCase();
                    } else if (item.response && item.response.headers) {
                        const h = item.response.headers.find(x => x.name.toLowerCase() === 'content-type');
                        if (h) mime = h.value.split(';')[0].trim().toLowerCase();
                    }

                    // Categorize based on known signatures
                    if (mime.includes('javascript') || mime.includes('ecmascript') ||
                        type === 'script' ||
                        urlLower.match(/\.(js|mjs|jsx|ts|tsx)(\?.*)?$/)) {
                        detectedType = 'js';
                    } else if (mime.includes('css') || type === 'stylesheet' || urlLower.match(/\.css(\?.*)?$/)) {
                        detectedType = 'css';
                    } else if (mime.includes('image') || type === 'image' || urlLower.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|bmp)(\?.*)?$/)) {
                        detectedType = 'image';
                    } else if (mime.includes('font') || type === 'font' || urlLower.match(/\.(woff|woff2|ttf|eot|otf)(\?.*)?$/)) {
                        detectedType = 'font';
                    } else if (mime.includes('json') || urlLower.match(/\.json(\?.*)?$/)) {
                        detectedType = 'json';
                    } else if (mime.includes('html') || type === 'main_frame' || type === 'sub_frame') {
                        detectedType = 'doc';
                    } else if (mime.includes('xml') || urlLower.match(/\.xml(\?.*)?$/)) { // Explicit XML detection
                        detectedType = 'xml';
                    } else if (mime.includes('text/plain')) {
                        detectedType = 'other';
                    } else {
                        // If not strictly identified, and it is an API request, it stays Root.
                        // If it is NOT an API request and 'unknown', put in Others?
                        if (!isApiRequest) detectedType = 'other';
                    }

                    // Grouping Logic
                    // 1. JS Folder
                    if (detectedType === 'js') {
                        jsItems.push(item);
                    }
                    // 2. Others Folder (CSS, Images, Fonts, Docs, Other Static, XML)
                    // Added 'xml' to Others folder
                    else if (['css', 'image', 'font', 'doc', 'other', 'xml'].includes(detectedType)) {
                        otherItems.push(item);
                    }
                    // 3. Root (API Endpoints: XHR, Fetch, WebSocket, JSON)
                    else {
                        rootItems.push(item);
                    }
                });

                // Helper to render sub-lists
                const renderSubList = (subItems, label) => {
                    if (subItems.length === 0) return;

                    const subFolderEl = document.createElement('div');
                    subFolderEl.className = 'sub-folder';

                    // Track expanded state (could be persisted if needing granualar persistence, but simple map for now)
                    // We can use a composite key for expanded state: domain + label
                    const subParams = domain + '-' + label;
                    const isSubExpanded = this.expandedGroups.has(subParams);

                    const subHeaderEl = document.createElement('div');
                    subHeaderEl.className = 'sub-folder-header';
                    subHeaderEl.style.cursor = 'pointer'; // Make it look clickable

                    // Use standard folder icons
                    const icon = isSubExpanded ? '📂' : '📁';

                    subHeaderEl.innerHTML = `
                        <span class="sub-icon" style="font-size: 14px; margin-right: 6px;">${icon}</span> 
                        ${label} 
                        <span class="sub-count">(${subItems.length})</span>
                    `;

                    const subListEl = document.createElement('div');
                    subListEl.className = `sub-folder-list ${isSubExpanded ? '' : 'hidden'}`;

                    this.renderItems(subItems, subListEl);
                    subFolderEl.appendChild(subHeaderEl);
                    subFolderEl.appendChild(subListEl);
                    contentEl.appendChild(subFolderEl);

                    // Click handler
                    subHeaderEl.addEventListener('click', (e) => {
                        e.stopPropagation(); // Prevent bubbling to parent group
                        if (this.expandedGroups.has(subParams)) {
                            this.expandedGroups.delete(subParams);
                            subListEl.classList.add('hidden');
                            subHeaderEl.querySelector('.sub-icon').textContent = '📁';
                        } else {
                            this.expandedGroups.add(subParams);
                            subListEl.classList.remove('hidden');
                            subHeaderEl.querySelector('.sub-icon').textContent = '📂';
                        }
                    });
                };

                // Render Sub-folders in order: Root, JS, Others
                // Actually, Root items usually go first
                // Render Sub-folders first (JS, Others) then Root items
                if (jsItems.length > 0) {
                    renderSubList(jsItems, 'JS');
                }

                if (otherItems.length > 0) {
                    renderSubList(otherItems, 'Others');
                }

                // Render Root items (standard API requests) last, typically at the "top level" visually below folders
                if (rootItems.length > 0) {
                    this.renderItems(rootItems, contentEl);
                }

                groupEl.appendChild(headerEl);
                groupEl.appendChild(contentEl);

                headerEl.addEventListener('click', () => {
                    if (this.expandedGroups.has(domain)) {
                        this.expandedGroups.delete(domain);
                        contentEl.classList.add('hidden');
                        headerEl.querySelector('.chevron').classList.add('collapsed');
                        headerEl.querySelector('.group-icon').textContent = '📁';
                    } else {
                        this.expandedGroups.add(domain);
                        contentEl.classList.remove('hidden');
                        headerEl.querySelector('.chevron').classList.remove('collapsed');
                        headerEl.querySelector('.group-icon').textContent = '📂';
                    }
                });

                // Add context menu for folder delete
                headerEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.contextFolderDomain = domain;
                    this.showFolderContextMenu(e);
                });

                groupEl.addEventListener('dragend', (e) => {
                    groupEl.style.opacity = '1';
                });

                groupEl.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    groupEl.style.borderTop = '2px solid var(--accent-primary)';
                });

                groupEl.addEventListener('dragleave', (e) => {
                    groupEl.style.borderTop = '';
                });

                groupEl.addEventListener('drop', (e) => {
                    e.preventDefault();
                    groupEl.style.borderTop = '';

                    const draggedDomain = e.dataTransfer.getData('text/plain');
                    if (draggedDomain && draggedDomain !== domain) {
                        if (!this.folderOrder) this.folderOrder = Object.keys(groups).sort();
                        const draggedIndex = this.folderOrder.indexOf(draggedDomain);
                        const targetIndex = this.folderOrder.indexOf(domain);

                        if (draggedIndex !== -1 && targetIndex !== -1) {
                            this.folderOrder.splice(draggedIndex, 1);
                            const newTargetIndex = this.folderOrder.indexOf(domain);
                            this.folderOrder.splice(newTargetIndex, 0, draggedDomain);
                            this.saveFolderOrder();
                            this.renderList();
                        }
                    }
                });

                list.appendChild(groupEl);
            });
        }

        // Restore scroll positions after a brief delay to ensure DOM is ready
        requestAnimationFrame(() => {
            // Restore main list scroll position
            list.scrollTop = scrollTop;

            // Restore each group-content scroll position
            document.querySelectorAll('.group-content').forEach((groupContent) => {
                const groupName = groupContent.dataset.groupName;
                if (groupName && groupScrollPositions.has(groupName)) {
                    groupContent.scrollTop = groupScrollPositions.get(groupName);
                }
            });
        });
    }

    renderItems(items, container) {
        items.forEach(item => {
            const el = this.createApiListItem(item, this.selectedItem && this.selectedItem.id === item.id, item.highlightColor);
            el.addEventListener('click', () => this.selectItem(item));

            // Context Menu
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, item);
            });

            container.appendChild(el);
        });
    }

    createApiListItem(item, isSelected, highlightColor) {
        const el = document.createElement('div');
        el.className = `request-item ${isSelected ? 'selected' : ''}`;
        if (highlightColor && highlightColor !== 'none') {
            el.style.backgroundColor = `var(--highlight-${highlightColor}, rgba(59, 130, 246, 0.1))`;
        }

        el.innerHTML = `
            <div class="col-method"><span class="method-tag method-${item.method}">${item.method}</span></div>
            <div class="col-url" title="${item.url}">${this.highlightText(item.url, this.filters.search)}</div>
            <div class="col-status"><span class="status-badge ${this.getStatusClass(item.response ? item.response.statusCode : 0)}">${item.response ? item.response.statusCode : 'Pending'}</span></div>
        `;
        return el;
    }

    selectItem(item) {
        this.selectedItem = item;
        this.renderList(); // Re-render to update selection state
        this.elements.detailsEmpty.classList.add('hidden');
        this.elements.detailsContent.classList.remove('hidden');
        this.renderDetails(this.currentViewMode || 'split'); // Use persisted view mode
    }

    // Helper method to format raw HTTP request with syntax highlighting
    formatRawHttpRequest(item) {
        let lines = [];

        // Request line
        const url = new URL(item.url);
        lines.push(`<span class="http-method">${item.method}</span> <span class="http-url">${url.pathname}${url.search}</span> <span class="http-version">HTTP/1.1</span>`);

        // Host header
        lines.push(`<span class="http-header-name">Host</span>: <span class="http-header-value">${url.host}</span>`);

        // Request headers
        if (item.requestHeaders && item.requestHeaders.length > 0) {
            item.requestHeaders.forEach(h => {
                if (!h.name.startsWith(':')) { // Skip pseudo headers
                    lines.push(`<span class="http-header-name">${this.escapeHtml(h.name)}</span>: <span class="http-header-value">${this.escapeHtml(h.value)}</span>`);
                }
            });
        }

        // Empty line before body
        if (item.requestBody) {
            lines.push('');

            // Request body - try to highlight as JSON
            let body = item.requestBody;
            if (typeof body === 'object') {
                body = JSON.stringify(body, null, 2);
            }

            try {
                let jsonObj = typeof body === 'object' ? body : JSON.parse(body);
                const jsonStr = JSON.stringify(jsonObj, null, 2);
                const highlightedJson = this.highlightJson(jsonStr);
                highlightedJson.split('\n').forEach(line => {
                    lines.push(line);
                });
            } catch (e) {
                // Not JSON, just display as plain text
                if (typeof body === 'object') {
                    body = JSON.stringify(body, null, 2);
                }
                body.split('\n').forEach(line => {
                    lines.push(this.escapeHtml(line));
                });
            }
        }

        return lines;
    }

    // Helper method to format raw HTTP response with syntax highlighting
    formatRawHttpResponse(item) {
        let lines = [];

        if (!item.response) {
            lines.push('<span class="http-status error">No Response</span>');
            return lines;
        }

        // Status line
        const statusCode = item.response.statusCode || 0;
        const statusClass = (statusCode >= 200 && statusCode < 300) ? 'http-status' : 'http-status error';
        lines.push(`<span class="http-version">HTTP/1.1</span> <span class="${statusClass}">${statusCode} ${item.response.statusText || ''}</span>`);

        // Response headers
        const headers = item.responseHeaders || item.response.headers;
        if (headers) {
            const headerArray = Array.isArray(headers) ? headers : Object.entries(headers).map(([name, value]) => ({ name, value }));
            headerArray.forEach(h => {
                if (!h.name.startsWith(':')) { // Skip pseudo headers
                    lines.push(`<span class="http-header-name">${this.escapeHtml(h.name)}</span>: <span class="http-header-value">${this.escapeHtml(h.value)}</span>`);
                }
            });
        }

        // Empty line before body
        const body = item.responseBody || (item.response && item.response.body);
        if (body) {
            lines.push('');

            // Response body
            let bodyStr = body;
            const isBase64 = (item.response && item.response.base64Encoded) || item.responseType === 'base64';

            if (isBase64) {
                try {
                    bodyStr = atob(body);
                } catch (e) {
                    bodyStr = body; // Use original if decode fails
                }
            }

            // Try to parse and highlight JSON
            try {
                let jsonObj = typeof bodyStr === 'object' ? bodyStr : JSON.parse(bodyStr);
                const jsonStr = JSON.stringify(jsonObj, null, 2);
                const highlightedJson = this.highlightJson(jsonStr);
                highlightedJson.split('\n').forEach(line => {
                    lines.push(line);
                });
            } catch (e) {
                // Not JSON, just escape and add
                if (typeof bodyStr === 'object') {
                    bodyStr = JSON.stringify(bodyStr, null, 2);
                }
                bodyStr.split('\n').forEach(line => {
                    lines.push(this.escapeHtml(line));
                });
            }
        } else if (item.response && item.response.error) {
            lines.push('');
            lines.push(`<span class="http-status error">Error: ${this.escapeHtml(item.response.error)}</span>`);
        }

        return lines;
    }

    // Helper to highlight JSON syntax
    highlightJson(jsonStr) {
        return jsonStr
            .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
            .replace(/: "([^"]+)"/g, ': <span class="json-string">"$1"</span>')
            .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
            .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
            .replace(/: null/g, ': <span class="json-null">null</span>');
    }

    // Helper method to create line-numbered code display
    createLineNumberedCode(lines) {
        const lineNumbers = lines.map((_, i) => `<span class="line-number">${i + 1}</span>`).join('');
        const codeLines = lines.map(line => `<span class="code-line">${line || ' '}</span>`).join('');

        return `
            <div class="code-editor">
                <div class="line-numbers">${lineNumbers}</div>
                <div class="code-content">${codeLines}</div>
            </div>
        `;
    }

    // Helper to escape HTML
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text.toString();
        return div.innerHTML;
    }

    renderDetails(viewMode = 'split') {
        if (!this.selectedItem) return;

        // Store the current view mode for persistence
        this.currentViewMode = viewMode;

        // Sync tab active states
        document.querySelectorAll('.detail-tab').forEach(t => {
            if (t.dataset.view === viewMode) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });

        const item = this.selectedItem;
        const container = this.elements.detailsBody;

        if (viewMode === 'split') {
            // Format request and response with line numbers
            const requestLines = this.formatRawHttpRequest(item);
            const responseLines = this.formatRawHttpResponse(item);

            container.innerHTML = `
        <div class="split-view-content">
          <div class="split-half">
            <div class="split-header">Request</div>
            <div class="split-body">
              ${this.createLineNumberedCode(requestLines)}
            </div>
          </div>
          <div class="split-half">
            <div class="split-header">Response</div>
            <div class="split-body">
              ${this.createLineNumberedCode(responseLines)}
            </div>
          </div>
        </div>
      `;
        } else if (viewMode === 'request') {
            container.innerHTML = this.renderRequestContent(item);
        } else if (viewMode === 'response') {
            container.innerHTML = this.renderResponseContent(item);
        } else if (viewMode === 'raw') {
            container.innerHTML = this.renderRawContent(item);
        }
    }

    renderRequestContent(item) {
        return `
      ${this.renderHeaders('General', [
            { name: 'Request URL', value: item.url },
            { name: 'Request Method', value: item.method },
            { name: 'Status Code', value: item.response ? `${item.response.statusCode} ${item.response.statusText || ''}` : 'Pending' }
        ])}
      ${this.renderHeaders('Request Headers', item.requestHeaders)}
      ${item.requestBody ? `<div class="section-title">Request Body</div>${this.formatBody(item.requestBody)}` : ''}
    `;
    }

    renderResponseContent(item) {
        const body = item.responseBody || (item.response && item.response.body);
        const headers = item.responseHeaders || (item.response && item.response.headers);
        const isBase64 = (item.response && item.response.base64Encoded) || item.responseType === 'base64';

        if (!body && item.response && item.response.error) {
            return `
          ${this.renderHeaders('Response Headers', headers)}
          <div class="section-title">Response Body</div>
          <div class="code-block" style="color: var(--danger); border-color: var(--danger);">Error capturing body: ${item.response.error}</div>
        `;
        }

        return `
      ${this.renderHeaders('Response Headers', headers)}
      <div class="section-title">Response Body</div>
      ${this.formatBody(body, isBase64)}
    `;
    }

    renderRawContent(item) {
        let content = '';

        // Request
        content += `${item.method} ${new URL(item.url).pathname} HTTP/1.1\n`;
        content += `Host: ${new URL(item.url).host}\n`;
        if (item.requestHeaders) {
            item.requestHeaders.forEach(h => content += `${h.name}: ${h.value}\n`);
        }
        content += '\n';
        if (item.requestBody) {
            content += typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody, null, 2);
        }
        content += '\n\n';

        // Response
        if (item.response) {
            content += `HTTP/1.1 ${item.response.statusCode} ${item.response.statusText || ''}\n`;
            if (item.responseHeaders || item.response.headers) {
                const headers = item.responseHeaders || item.response.headers;
                // Handle headers array or object
                if (Array.isArray(headers)) {
                    headers.forEach(h => content += `${h.name}: ${h.value}\n`);
                } else {
                    Object.entries(headers).forEach(([k, v]) => content += `${k}: ${v}\n`);
                }
            }
            content += '\n';

            const body = item.responseBody || item.response.body;
            if (body) {
                if (typeof body === 'object') {
                    content += JSON.stringify(body, null, 2);
                } else {
                    content += body;
                }
            }
        }

        return `<div class="code-block">${this.syntaxHighlightHttp(content)}</div>`;
    }

    renderHeaders(title, headers) {
        if (!headers || headers.length === 0) return '';
        let html = `<div class="section-title">${title}</div>`;
        html += `<div class="kv-grid">`;
        if (Array.isArray(headers)) {
            headers.forEach(h => {
                html += `
          <div class="kv-key">${this.highlightText(h.name, this.filters.search)}:</div>
          <div class="kv-value">${this.highlightText(h.value, this.filters.search)}</div>
        `;
            });
        } else {
            // Handle object headers if necessary
            for (const [key, value] of Object.entries(headers)) {
                html += `
          <div class="kv-key">${this.highlightText(key, this.filters.search)}:</div>
          <div class="kv-value">${this.highlightText(value, this.filters.search)}</div>
        `;
            }
        }
        html += `</div>`;
        return html;
    }

    formatBody(body, isBase64 = false) {
        if (body === null || body === undefined || body === '') return '<div class="code-block">No Content</div>';

        // If body is already an object, stringify it
        if (typeof body === 'object') {
            let highlighted = this.syntaxHighlightJson(body);
            // Apply search highlighting on top of syntax highlighting
            if (this.filters.search) {
                highlighted = this.applySearchHighlight(highlighted, this.filters.search);
            }
            return `<div class="code-block">${highlighted}</div>`;
        }

        let content = body;
        if (isBase64) {
            try {
                content = atob(body);
            } catch (e) {
                // If failed to decode, just show original
                return `<div class="code-block">${this.highlightText(body, this.filters.search)}</div>`;
            }
        }

        try {
            // Try to parse as JSON if it's a string
            const parsed = JSON.parse(content);
            let highlighted = this.syntaxHighlightJson(parsed);
            // Apply search highlighting on top of syntax highlighting
            if (this.filters.search) {
                highlighted = this.applySearchHighlight(highlighted, this.filters.search);
            }
            return `<div class="code-block">${highlighted}</div>`;
        } catch (e) {
            // Not JSON
            // Check if it's JavaScript
            const item = this.selectedItem;
            let isJs = false;

            // Check headers
            if (item) {
                const contentType = item.responseHeaders ? (item.responseHeaders.find(h => h.name.toLowerCase() === 'content-type') || {}).value : '';
                if (contentType && (contentType.includes('javascript') || contentType.includes('application/x-javascript'))) {
                    isJs = true;
                }
                // Check URL extension
                if (!isJs && (item.url.endsWith('.js') || item.url.endsWith('.mjs'))) {
                    isJs = true;
                }
            }

            if (isJs) {
                let highlighted = this.syntaxHighlightJs(content);
                if (this.filters.search) {
                    highlighted = this.applySearchHighlight(highlighted, this.filters.search);
                }
                return `<div class="code-block">${highlighted}</div>`;
            }

            // Fallback to plain text
            return `<div class="code-block">${this.highlightText(content, this.filters.search)}</div>`;
        }
    }

    // Helper method to apply search highlighting to already HTML-formatted content
    applySearchHighlight(html, query) {
        if (!query) return html;

        // Escape special regex characters in the query
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Create regex that matches the query but not inside HTML tags or existing spans
        const regex = new RegExp(`(?![^<]*>)(?!<[^>]*)(?!<span class="search-highlight">)(${escapedQuery})`, 'gi');

        // Replace matches with highlighted version
        return html.replace(regex, '<span class="search-highlight">$1</span>');
    }

    async setHighlight(color) {
        if (!this.selectedItem) return;
        this.selectedItem.highlightColor = color;

        // Update in IndexedDB
        await this.storageDB.updateApiCall(this.selectedItem.id, { highlightColor: color });

        // Update in-memory cache
        const index = this.data.apiCalls.findIndex(i => i.id === this.selectedItem.id);
        if (index !== -1) {
            this.data.apiCalls[index].highlightColor = color;
        }
        this.renderList();
    }

    copyAsCurl() {
        if (!this.selectedItem) return;
        const item = this.selectedItem;
        let curl = `curl -X ${item.method} "${item.url}"`;
        if (item.requestHeaders) {
            item.requestHeaders.forEach(h => {
                if (!h.name.startsWith(':')) curl += ` \\\n -H "${h.name}: ${h.value}"`;
            });
        }
        if (item.requestBody) {
            const body = typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody);
            curl += ` \\\n -d '${body.replace(/'/g, "'\\''")}'`;
        }

        navigator.clipboard.writeText(curl).then(() => {
            const btn = this.elements.copyCurlBtn;
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = original, 1500);
        });
    }

    async sendToRepeater(specificItem = null) {
        const item = specificItem || this.selectedItem;
        if (!item) return;

        const repeaterData = {
            method: item.method,
            url: item.url,
            headers: item.requestHeaders,
            body: item.requestBody
        };

        await this.storageDB.setSetting('repeater_pending_request', repeaterData);
        window.location.href = 'repeterpage.html';
    }

    showContextMenu(e, item) {
        this.contextMenuItem = item;
        const menu = this.elements.contextMenu;

        // Position menu
        const x = e.clientX;
        const y = e.clientY;

        // Adjust if close to edge
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const menuWidth = 180;
        const menuHeight = 50;

        menu.style.left = `${Math.min(x, winWidth - menuWidth)}px`;
        menu.style.top = `${Math.min(y, winHeight - menuHeight)}px`;

        menu.classList.remove('hidden');
    }

    // Search Navigation Methods
    updateSearchNav() {
        const hasSearch = this.filters.search && this.filters.search.length > 0;

        if (hasSearch) {
            // Count total matches after rendering
            setTimeout(() => {
                const highlights = document.querySelectorAll('.search-highlight');
                this.searchMatchesTotal = highlights.length;

                if (this.searchMatchesTotal > 0) {
                    this.elements.searchNav.style.display = 'flex';
                    this.elements.searchCounter.textContent = `${Math.min(this.searchMatchIndex + 1, this.searchMatchesTotal)}/${this.searchMatchesTotal}`;
                    this.elements.searchPrevBtn.disabled = this.searchMatchesTotal <= 1;
                    this.elements.searchNextBtn.disabled = this.searchMatchesTotal <= 1;

                    // Highlight current match
                    highlights.forEach((el, idx) => el.classList.toggle('active', idx === this.searchMatchIndex));
                } else {
                    this.elements.searchNav.style.display = 'none';
                }
            }, 50);
        } else {
            this.elements.searchNav.style.display = 'none';
        }
    }

    searchNextMatch() {
        if (this.searchMatchesTotal <= 1) return;

        this.searchMatchIndex = (this.searchMatchIndex + 1) % this.searchMatchesTotal;
        const highlights = document.querySelectorAll('.search-highlight');
        highlights.forEach((el, idx) => el.classList.toggle('active', idx === this.searchMatchIndex));
        this.elements.searchCounter.textContent = `${this.searchMatchIndex + 1}/${this.searchMatchesTotal}`;

        // Scroll to active match
        const activeMatch = document.querySelector('.search-highlight.active');
        if (activeMatch) {
            activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    searchPrevMatch() {
        if (this.searchMatchesTotal <= 1) return;

        this.searchMatchIndex = (this.searchMatchIndex - 1 + this.searchMatchesTotal) % this.searchMatchesTotal;
        const highlights = document.querySelectorAll('.search-highlight');
        highlights.forEach((el, idx) => el.classList.toggle('active', idx === this.searchMatchIndex));
        this.elements.searchCounter.textContent = `${this.searchMatchIndex + 1}/${this.searchMatchesTotal}`;

        // Scroll to active match
        const activeMatch = document.querySelector('.search-highlight.active');
        if (activeMatch) {
            activeMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // Delete a specific request
    async deleteRequest(item) {
        try {
            // Remove from IndexedDB
            await this.storageDB.deleteApiCall(item.id);

            // Remove from in-memory cache
            const index = this.data.apiCalls.findIndex(req => req.id === item.id);
            if (index !== -1) {
                this.data.apiCalls.splice(index, 1);
            }

            // Clear selection if this was the selected item
            if (this.selectedItem && this.selectedItem.id === item.id) {
                this.selectedItem = null;
                this.elements.detailsContent.classList.add('hidden');
                this.elements.detailsEmpty.classList.remove('hidden');
            }

            // Re-render list
            this.renderList();
        } catch (e) {
            console.error('Failed to delete request:', e);
            alert('Failed to delete request');
        }
    }

    // Show folder context menu
    showFolderContextMenu(e) {
        const menu = this.elements.folderContextMenu;

        // Position menu
        const x = e.clientX;
        const y = e.clientY;

        // Adjust if close to edge
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const menuWidth = 180;
        const menuHeight = 50;

        menu.style.left = `${Math.min(x, winWidth - menuWidth)}px`;
        menu.style.top = `${Math.min(y, winHeight - menuHeight)}px`;

        menu.classList.remove('hidden');
    }

    // Delete entire folder (all requests from a domain)
    async deleteFolder(domain) {
        try {
            // Get all IDs to delete
            const idsToDelete = this.data.apiCalls
                .filter(req => req.sourceDomain === domain)
                .map(req => req.id);

            // Delete from IndexedDB in batch
            if (idsToDelete.length > 0) {
                await this.storageDB.deleteApiCalls(idsToDelete);
            }

            // Remove from in-memory cache
            this.data.apiCalls = this.data.apiCalls.filter(req => req.sourceDomain !== domain);

            // Clear selection if the selected item was from this domain
            if (this.selectedItem && this.selectedItem.sourceDomain === domain) {
                this.selectedItem = null;
                this.elements.detailsContent.classList.add('hidden');
                this.elements.detailsEmpty.classList.remove('hidden');
            }

            // Remove from folder order
            if (this.folderOrder) {
                const index = this.folderOrder.indexOf(domain);
                if (index !== -1) {
                    this.folderOrder.splice(index, 1);
                    await this.saveFolderOrder();
                }
            }

            // Re-render list
            this.renderList();
        } catch (e) {
            console.error('Failed to delete folder:', e);
            alert('Failed to delete folder');
        }
    }

    // Search Navigation Methods
    updateSearchNav() {
        const filtered = this.getFilteredItems();
        this.searchMatchesTotal = filtered.length;

        if (this.filters.search && this.searchMatchesTotal > 0) {
            this.elements.searchNav.style.display = 'flex';
            this.elements.searchCounter.textContent = `${this.searchMatchIndex + 1}/${this.searchMatchesTotal}`;
            this.elements.searchPrevBtn.disabled = this.searchMatchesTotal <= 1;
            this.elements.searchNextBtn.disabled = this.searchMatchesTotal <= 1;
        } else {
            this.elements.searchNav.style.display = 'none';
        }
    }

    searchNextMatch() {
        if (!this.filters.search || this.searchMatchesTotal === 0) return;

        this.searchMatchIndex = (this.searchMatchIndex + 1) % this.searchMatchesTotal;
        this.goToMatch(this.searchMatchIndex);
    }

    searchPrevMatch() {
        if (!this.filters.search || this.searchMatchesTotal === 0) return;

        this.searchMatchIndex = (this.searchMatchIndex - 1 + this.searchMatchesTotal) % this.searchMatchesTotal;
        this.goToMatch(this.searchMatchIndex);
    }

    goToMatch(index) {
        const filtered = this.getFilteredItems();
        if (index < 0 || index >= filtered.length) return;

        const matchedItem = filtered[index];

        // Auto-select the matched request
        this.selectItem(matchedItem);

        // Scroll the matched request into view in the list
        setTimeout(() => {
            // Look specifically in the list pane
            const listPane = document.getElementById('listPane');
            if (!listPane) return;

            const selectedEl = listPane.querySelector('.request-item.selected');
            if (selectedEl) {
                // Check if item is inside a collapsed folder
                let parent = selectedEl.parentElement;
                while (parent && parent !== listPane) {
                    if (parent.classList.contains('folder') && parent.classList.contains('collapsed')) {
                        // Found a collapsed folder, expand it
                        const folderHeader = parent.querySelector('.folder-header');
                        if (folderHeader) {
                            folderHeader.click();
                            // Wait for expansion animation then scroll
                            setTimeout(() => {
                                selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 200);
                            return;
                        }
                    }
                    parent = parent.parentElement;
                }

                // Not in collapsed folder, scroll immediately
                selectedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 350);

        // Update counter
        this.updateSearchNav();

        // Highlight matches in the detail view and scroll to first match
        this.highlightSearchInDetails();

        // Scroll to the first highlighted match in detail view
        setTimeout(() => {
            this.scrollToHighlightInDetail();
        }, 600);
    }

    getFilteredItems() {
        // Get the currently filtered and search-matched items
        return this.data.apiCalls.filter(item => {
            let matchSearch = !this.filters.search;

            if (this.filters.search) {
                const searchTerm = this.filters.search;
                matchSearch = item.url.toLowerCase().includes(searchTerm) ||
                    item.method.toLowerCase().includes(searchTerm) ||
                    (item.response && item.response.statusCode && item.response.statusCode.toString().includes(searchTerm)) ||
                    (item.requestHeaders && item.requestHeaders.some(h =>
                        h.name.toLowerCase().includes(searchTerm) ||
                        h.value.toLowerCase().includes(searchTerm)
                    )) ||
                    (item.requestBody && JSON.stringify(item.requestBody).toLowerCase().includes(searchTerm)) ||
                    (item.response && item.response.headers && item.response.headers.some(h =>
                        h.name.toLowerCase().includes(searchTerm) ||
                        h.value.toLowerCase().includes(searchTerm)
                    )) ||
                    (item.response && item.response.body && JSON.stringify(item.response.body).toLowerCase().includes(searchTerm));
            }

            const matchMethod = this.filters.method === 'ALL' || item.method === this.filters.method;
            let matchStatus = true;
            if (this.filters.status !== 'ALL') {
                const code = item.response ? item.response.statusCode : 0;
                if (this.filters.status === '2xx') matchStatus = code >= 200 && code < 300;
                else if (this.filters.status === '3xx') matchStatus = code >= 300 && code < 400;
                else if (this.filters.status === '4xx') matchStatus = code >= 400 && code < 500;
                else if (this.filters.status === '5xx') matchStatus = code >= 500;
            }

            return matchSearch && matchMethod && matchStatus;
        });
    }

    highlightSearchInDetails() {
        if (!this.filters.search) return;

        // Add CSS for highlighting if not already present
        if (!document.getElementById('search-highlight-style')) {
            const style = document.createElement('style');
            style.id = 'search-highlight-style';
            style.textContent = `
                .search-highlight {
                    background-color: #ffeb3b;
                    color: #1a1a1a;
                    font-weight: 500;
                    padding: 2px 4px;
                    border-radius: 2px;
                }
            `;
            document.head.appendChild(style);
        }

        // Highlight in the details body
        setTimeout(() => {
            const detailsBody = this.elements.detailsBody;
            if (!detailsBody) return;

            const searchTerm = this.filters.search;
            const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

            // Get all text nodes and highlight
            const walker = document.createTreeWalker(
                detailsBody,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            const textNodes = [];
            while (walker.nextNode()) {
                textNodes.push(walker.currentNode);
            }

            textNodes.forEach(node => {
                const parent = node.parentElement;
                if (parent && !parent.classList.contains('search-highlight')) {
                    const text = node.textContent;
                    if (regex.test(text)) {
                        const highlighted = text.replace(regex, '<span class="search-highlight">$1</span>');
                        const span = document.createElement('span');
                        span.innerHTML = highlighted;
                        parent.replaceChild(span, node);
                    }
                }
            });
        }, 200);
    }

    expandAllFoldersWithMatches() {
        if (!this.filters.search) return;

        const listPane = document.getElementById('listPane');
        if (!listPane) return;

        // Expand all domain groups that have matching items
        const domainGroups = listPane.querySelectorAll('.domain-group');
        domainGroups.forEach(group => {
            const content = group.querySelector('.domain-content');
            if (content) {
                // Check if this group has any visible request items
                const visibleItems = content.querySelectorAll('.request-item');
                if (visibleItems.length > 0) {
                    const domain = group.querySelector('.domain-header')?.dataset.domain;
                    if (domain && !this.expandedGroups.has(domain)) {
                        // Expand this domain group
                        const header = group.querySelector('.domain-header');
                        if (header) {
                            header.click();
                        }
                    }

                    // Also expand sub-folders (JS, Others) that have matches
                    const subFolders = content.querySelectorAll('.sub-folder');
                    subFolders.forEach(subFolder => {
                        const subList = subFolder.querySelector('.sub-folder-list');
                        if (subList && subList.classList.contains('hidden')) {
                            const itemsInSub = subList.querySelectorAll('.request-item');
                            if (itemsInSub.length > 0) {
                                const subHeader = subFolder.querySelector('.sub-folder-header');
                                if (subHeader) {
                                    subHeader.click();
                                }
                            }
                        }
                    });
                }
            }
        });
    }

    scrollToFirstMatch() {
        const listPane = document.getElementById('listPane');
        if (!listPane) return;

        setTimeout(() => {
            // Find the first visible request item
            const firstMatch = listPane.querySelector('.request-item');
            if (firstMatch) {
                firstMatch.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 200);
    }

    scrollToHighlightInDetail() {
        const detailsBody = this.elements.detailsBody;
        if (!detailsBody) return;

        // Find the first highlighted match in the detail view
        const firstHighlight = detailsBody.querySelector('.search-highlight');
        if (firstHighlight) {
            // Scroll the highlight into view within the detail pane
            firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Initialize
const page = new HttpRequestPage();
