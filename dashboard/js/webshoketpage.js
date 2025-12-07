class WebSocketPage extends DashboardCommon {
    constructor() {
        super();
        this.selectedItem = null;
        this.filters = { search: '' };
        this.elements = {
            wsList: document.getElementById('wsList'),
            detailsPane: document.getElementById('detailsPane'),
            detailsEmpty: document.getElementById('detailsEmpty'),
            detailsContent: document.getElementById('detailsContent'),
            detailsBody: document.getElementById('detailsBody'),
            connectionInfo: document.getElementById('connectionInfo'),
            searchInput: document.getElementById('searchInput'),
            dragHandle: document.getElementById('dragHandle'),
            listPane: document.querySelector('.list-pane'),
            listPane: document.querySelector('.list-pane')
        };

        this.setupPageListeners();
        this.setupContextMenu();
    }

    onItemsAdded(updates) {
        // Only handle WebSocket updates
        if (!updates.webSockets || updates.webSockets.length === 0) return;

        const list = this.elements.wsList;
        const wasEmpty = list.querySelector('.empty-state');
        if (wasEmpty) list.innerHTML = '';

        // Check if we need to filter
        const matchesFilter = (item) => !this.filters.search || item.url.toLowerCase().includes(this.filters.search);

        updates.webSockets.forEach(item => {
            // Update existing or add new
            const existingEl = list.querySelector(`.ws-item[data-id="${item.id}"]`);

            if (matchesFilter(item)) {
                if (existingEl) {
                    // Replace existing
                    const newEl = this.createWsListItem(item, this.selectedItem && this.selectedItem.id === item.id);
                    newEl.addEventListener('click', () => this.selectItem(item));
                    // Preserve context menu handler? The list has a delegated handler?
                    // No, context menu is attached to list in setupContextMenu
                    list.replaceChild(newEl, existingEl);
                } else {
                    // Prepend or Append?
                    // renderList sorts by startTime desc (newest first).
                    // So we should PREPEND new items.
                    const el = this.createWsListItem(item, this.selectedItem && this.selectedItem.id === item.id);
                    el.addEventListener('click', () => this.selectItem(item));
                    list.prepend(el);
                }
            } else if (existingEl) {
                // If it no longer matches filter, remove it
                existingEl.remove();
            }
        });

        // If selected item was updated, refresh details
        if (this.selectedItem) {
            const updatedSelected = updates.webSockets.find(u => u.id === this.selectedItem.id);
            if (updatedSelected) {
                this.selectedItem = updatedSelected;
                this.renderDetails();
                this.renderConnectionInfo();
            } else if (updates.webSockets.some(u => u.id === this.selectedItem.id)) {
                // It might have been updated in data but not found in updates array? No, strict check above.
            }
        }
    }

    onDataUpdated() {
        this.renderList();
        if (this.selectedItem) {
            const updated = this.data.webSockets.find(ws => ws.id === this.selectedItem.id);
            if (updated) {
                this.selectedItem = updated;
                this.renderDetails();
                this.renderConnectionInfo();
            }
        }
    }

    setupPageListeners() {
        // Search
        this.elements.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.renderList();
        });



        // Resizer
        let isResizing = false;
        this.elements.dragHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const containerWidth = document.getElementById('splitViewContainer').offsetWidth;
            const newWidth = (e.clientX - 260);
            const percentage = (newWidth / containerWidth) * 100;
            if (percentage > 20 && percentage < 80) {
                this.elements.listPane.style.width = `${percentage}%`;
            }
        });
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });
    }

    setupContextMenu() {
        // Context menu for list items
        this.elements.wsList.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const wsItem = e.target.closest('.ws-item');
            if (!wsItem) return;

            // Remove existing context menu
            const existing = document.querySelector('.context-menu');
            if (existing) existing.remove();

            // Create context menu
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.innerHTML = `
                <div class="context-menu-item" data-action="delete">
                    <span>🗑️</span>
                    <span>Delete Connection</span>
                </div>
            `;
            menu.style.left = `${e.pageX}px`;
            menu.style.top = `${e.pageY}px`;
            document.body.appendChild(menu);

            // Get the connection ID directly from the DOM element's data attribute
            const connectionId = wsItem.getAttribute('data-id');

            // Handle menu click
            menu.addEventListener('click', async (e) => {
                e.preventDefault(); // Prevent bubbling and default actions
                e.stopPropagation();

                const action = e.target.closest('.context-menu-item')?.dataset.action;
                console.log(`[WebSocket] Context menu action: ${action}, Connection ID: ${connectionId}`);

                if (action === 'delete') {
                    if (connectionId) {
                        await this.deleteConnection(connectionId);
                    } else {
                        console.error('[WebSocket] No connection ID found for delete action');
                        alert('Error: Could not identify connection to delete.');
                    }
                }
                menu.remove();
            });

            // Close menu on outside click
            setTimeout(() => {
                const closeMenu = () => menu.remove();
                document.addEventListener('click', closeMenu, { once: true });
                // Also close on right click elsewhere
                document.addEventListener('contextmenu', (evt) => {
                    if (!menu.contains(evt.target)) closeMenu();
                }, { once: true });
            }, 0);
        });
    }

    async deleteConnection(id) {
        console.log(`[WebSocket] Requesting deletion for ID: ${id}`);

        // Optimistically remove from UI first to feel responsive
        const originalList = this.data.webSockets; // Backup

        try {
            // Send message to background to delete from source and wait for confirmation
            const response = await chrome.runtime.sendMessage({
                action: 'deleteWebSocket',
                requestId: id
            });

            if (!response || !response.success) {
                console.error('Failed to delete WebSocket from background:', response?.error);
                alert(`Failed to delete connection: ${response?.error || 'Unknown error'}`);
                return;
            }

            console.log(`[WebSocket] Deletion successful for ID: ${id}`);

            // UI Update Logic
            // Note: Background script will update storage, which triggers onDataUpdated via common.js
            // But we can also manually filter local state to be faster
            this.data.webSockets = this.data.webSockets.filter(ws => String(ws.id) !== String(id));

            if (this.selectedItem && String(this.selectedItem.id) === String(id)) {
                this.selectedItem = null;
                this.elements.detailsEmpty.classList.remove('hidden');
                this.elements.detailsContent.classList.add('hidden');
            }

            this.renderList();

        } catch (error) {
            console.error('Error deleting WebSocket:', error);
            alert('Error deleting WebSocket connection. check console for details.');
        }
    }

    async saveData() {
        // Note: Data is automatically saved to IndexedDB via background.js
        // This method is kept for compatibility but the actual persistence
        // is handled by the IndexedDB batching mechanism
        console.log('[WebSocketPage] Data updates are handled automatically by IndexedDB');
    }

    renderList() {
        const list = this.elements.wsList;
        list.innerHTML = '';

        const filtered = this.data.webSockets.filter(item => {
            return !this.filters.search || item.url.toLowerCase().includes(this.filters.search);
        });

        if (filtered.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔌</div>
                    <h3>No WebSockets</h3>
                    <p>WebSocket connections will appear here</p>
                </div>
            `;
            return;
        }

        filtered.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

        filtered.forEach(item => {
            const el = this.createWsListItem(item, this.selectedItem && this.selectedItem.id === item.id);
            el.addEventListener('click', () => this.selectItem(item));
            list.appendChild(el);
        });
    }

    getReadyState(item) {
        if (item.readyState !== undefined) return item.readyState;
        // Backward compatibility
        if (item.status === 'connected') return 1;
        if (item.status === 'connecting') return 0;
        return 3; // Default to Closed
    }

    createWsListItem(item, isSelected) {
        const el = document.createElement('div');
        el.className = `ws-item ${isSelected ? 'selected' : ''}`;
        // Store the WebSocket ID in the DOM element for easy retrieval
        el.setAttribute('data-id', item.id);

        // Format timestamp properly - handle both timestamp formats
        let timestamp = 'N/A';
        if (item.startTime) {
            const date = new Date(item.startTime);
            if (!isNaN(date.getTime())) {
                timestamp = date.toLocaleTimeString();
            }
        } else if (item.timestamp) {
            const date = new Date(item.timestamp);
            if (!isNaN(date.getTime())) {
                timestamp = date.toLocaleTimeString();
            }
        }

        const readyState = this.getReadyState(item);
        const status = this.getConnectionStatus(readyState);
        const statusColor = this.getStatusColor(readyState);

        const messageCount = item.frames ? item.frames.length : 0;

        el.innerHTML = `
            <div class="col-method">
                <span class="method-tag method-WS">WS</span>
            </div>
            <div class="col-url" title="${item.url}">
                <div class="ws-url-text">${this.highlightText(item.url, this.filters.search)}</div>
                <div class="ws-metadata">
                    <span class="ws-status" style="color: ${statusColor}">● ${status}</span>
                    <span class="ws-msg-count">${messageCount} msg${messageCount !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div class="col-time">${timestamp}</div>
        `;
        return el;
    }

    getConnectionStatus(readyState) {
        const states = {
            0: 'Connecting',
            1: 'Open',
            2: 'Closing',
            3: 'Closed'
        };
        return states[readyState] !== undefined ? states[readyState] : 'Closed';
    }

    getStatusColor(readyState) {
        const colors = {
            0: '#FFA500', // Orange for Connecting
            1: '#4CAF50', // Green for Open
            2: '#FF9800', // Orange for Closing
            3: '#F44336'  // Red for Closed
        };
        return colors[readyState] !== undefined ? colors[readyState] : '#F44336';
    }

    selectItem(item) {
        this.selectedItem = item;
        this.renderList();
        this.elements.detailsEmpty.classList.add('hidden');
        this.elements.detailsContent.classList.remove('hidden');
        this.renderConnectionInfo();
        this.renderDetails();
    }

    renderConnectionInfo() {
        if (!this.selectedItem) return;
        const item = this.selectedItem;
        const container = this.elements.connectionInfo;

        // Handle both timestamp formats
        const startTimeValue = item.startTime || item.timestamp || Date.now();
        const startTime = new Date(startTimeValue).toLocaleString();
        const endTime = item.endTime ? new Date(item.endTime).toLocaleString() : 'Still active';
        const duration = item.endTime ?
            `${((item.endTime - startTimeValue) / 1000).toFixed(2)}s` :
            `${((Date.now() - startTimeValue) / 1000).toFixed(2)}s`;

        const readyState = this.getReadyState(item);
        const status = this.getConnectionStatus(readyState);
        const statusColor = this.getStatusColor(readyState);

        const messageCount = item.frames ? item.frames.length : 0;
        const sentCount = item.frames ? item.frames.filter(f => f.type === 'send').length : 0;
        const receivedCount = item.frames ? item.frames.filter(f => f.type === 'receive' || f.type === 'message').length : 0;

        container.innerHTML = `
            <div class="info-grid">
                <div class="info-item full-width">
                    <div class="info-label">URL</div>
                    <div class="info-value" title="${this.escapeHtml(item.url)}">${this.escapeHtml(item.url)}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Status</div>
                    <div class="info-value" style="color: ${statusColor}">
                        <span class="status-indicator" style="background: ${statusColor}"></span>
                        ${status}
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Started</div>
                    <div class="info-value">${startTime}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Duration</div>
                    <div class="info-value">${duration}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Messages</div>
                    <div class="info-value">
                        ${messageCount} total
                        <span style="color: #3B82F6; margin-left: 8px;">↑ ${sentCount}</span>
                        <span style="color: #10B981; margin-left: 8px;">↓ ${receivedCount}</span>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Protocol</div>
                    <div class="info-value">${item.url.startsWith('wss://') ? 'WSS (Secure)' : 'WS'}</div>
                </div>
            </div>
        `;
    }

    renderDetails() {
        if (!this.selectedItem) return;
        const item = this.selectedItem;
        const container = this.elements.detailsBody;
        container.innerHTML = '';

        if (!item.frames || item.frames.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💬</div>
                    <h3>No Messages</h3>
                    <p>No messages have been sent or received yet</p>
                </div>
            `;
            return;
        }

        item.frames.forEach((msg, index) => {
            const el = document.createElement('div');
            const msgType = msg.type === 'send' ? 'send' : 'receive';
            el.className = `ws-message ${msgType === 'send' ? 'ws-sent' : 'ws-received'}`;

            // Handle timestamp
            let timestamp = 'N/A';
            if (msg.timestamp) {
                const date = new Date(msg.timestamp);
                if (!isNaN(date.getTime())) {
                    timestamp = date.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        fractionalSecondDigits: 3
                    });
                }
            } else if (msg.time) {
                const date = new Date(msg.time);
                if (!isNaN(date.getTime())) {
                    timestamp = date.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        fractionalSecondDigits: 3
                    });
                }
            }

            const direction = msgType === 'send' ? '↑ Sent' : '↓ Received';
            const manualTag = msg.manual ? ' <span style="color: #9333EA;">(Manual)</span>' : '';

            // Safe data handling
            let safeData = msg.data;
            if (typeof safeData === 'object') {
                safeData = JSON.stringify(safeData);
            } else if (safeData === undefined || safeData === null) {
                safeData = '';
            } else {
                safeData = String(safeData);
            }

            const dataSize = this.formatBytes(new TextEncoder().encode(safeData).length);

            let displayData = safeData;
            let isJson = false;

            // Always try to pretty print if it looks like JSON
            try {
                const parsed = JSON.parse(safeData);
                displayData = JSON.stringify(parsed, null, 2);
                isJson = true;
            } catch (e) {
                // Not JSON or parse failed
            }

            el.innerHTML = `
                <div class="ws-msg-header">
                    <span class="ws-msg-direction">${direction}${manualTag}</span>
                    <span class="ws-msg-meta">#${index + 1} • ${timestamp} • ${dataSize}</span>
                </div>
                <div class="ws-msg-data ${isJson ? 'ws-json-data' : ''}">
                    ${isJson ? this.syntaxHighlightJson(displayData) : `<pre class="raw-pre">${this.escapeHtml(displayData)}</pre>`}
                </div>
            `;
            container.appendChild(el);
        });

        container.scrollTop = container.scrollHeight;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

const page = new WebSocketPage();