class WebSocketPage extends DashboardCommon {
    constructor() {
        super();
        this.selectedItem = null;
        this.filters = { search: '' };
        this.viewMode = 'pretty'; // 'pretty' or 'raw'
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
            viewToggle: document.getElementById('viewToggle'),
            sendMessageBtn: document.getElementById('sendMessageBtn'),
            messageInput: document.getElementById('messageInput')
        };

        this.setupPageListeners();
        this.setupContextMenu();
    }

    onDataUpdated() {
        this.renderList();
        if (this.selectedItem) {
            const updated = this.data.webSockets.find(ws => ws.id === this.selectedItem.id);
            if (updated) {
                this.selectedItem = updated;
                this.renderDetails();
                this.renderConnectionInfo();
                this.updateSendButtonState();
            }
        }
    }

    setupPageListeners() {
        // Search
        this.elements.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.renderList();
        });

        // View Toggle
        this.elements.viewToggle.addEventListener('click', () => {
            this.viewMode = this.viewMode === 'pretty' ? 'raw' : 'pretty';
            this.elements.viewToggle.textContent = this.viewMode === 'pretty' ? '🔍 Raw' : '✨ Pretty';
            this.renderDetails();
        });

        // Send Message
        this.elements.sendMessageBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.elements.messageInput.addEventListener('input', () => {
            this.updateSendButtonState();
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

            // Get the connection ID
            const index = Array.from(this.elements.wsList.children).indexOf(wsItem);
            const filtered = this.data.webSockets.filter(item => {
                return !this.filters.search || item.url.toLowerCase().includes(this.filters.search);
            });
            filtered.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
            const connection = filtered[index];

            // Handle menu click
            menu.addEventListener('click', (e) => {
                const action = e.target.closest('.context-menu-item')?.dataset.action;
                if (action === 'delete' && connection) {
                    this.deleteConnection(connection.id);
                }
                menu.remove();
            });

            // Close menu on outside click
            setTimeout(() => {
                document.addEventListener('click', () => menu.remove(), { once: true });
            }, 0);
        });
    }

    deleteConnection(id) {
        this.data.webSockets = this.data.webSockets.filter(ws => ws.id !== id);
        if (this.selectedItem && this.selectedItem.id === id) {
            this.selectedItem = null;
            this.elements.detailsEmpty.classList.remove('hidden');
            this.elements.detailsContent.classList.add('hidden');
        }
        this.saveData();
        this.renderList();
    }

    updateSendButtonState() {
        const message = this.elements.messageInput.value.trim();
        const readyState = this.selectedItem ? this.getReadyState(this.selectedItem) : 3;
        const isOpen = readyState === 1;
        const hasMessage = message.length > 0;

        this.elements.sendMessageBtn.disabled = !isOpen || !hasMessage;

        if (!isOpen && this.selectedItem) {
            const status = this.getConnectionStatus(readyState);
            this.elements.sendMessageBtn.title = `Cannot send - Connection is ${status}`;
        } else if (!hasMessage) {
            this.elements.sendMessageBtn.title = 'Type a message to send';
        } else {
            this.elements.sendMessageBtn.title = 'Send message';
        }
    }

    sendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || !this.selectedItem) return;

        const tabId = this.selectedItem.tabId;
        if (!tabId) {
            alert('Cannot send message: Missing Tab ID. This connection may be from an old recording session. Please start a new recording.');
            return;
        }

        const readyState = this.getReadyState(this.selectedItem);
        if (readyState !== 1) {
            const status = this.getConnectionStatus(readyState);
            alert(`Cannot send message: WebSocket is ${status}. Messages can only be sent when the connection is Open.`);
            return;
        }

        // Disable button while sending
        this.elements.sendMessageBtn.disabled = true;
        this.elements.sendMessageBtn.textContent = 'Sending...';

        // Send to background script
        chrome.runtime.sendMessage({
            action: 'sendWebSocketMessage',
            tabId: tabId,
            requestId: this.selectedItem.id,
            message: message
        }, (response) => {
            // Re-enable button
            this.elements.sendMessageBtn.disabled = false;
            this.elements.sendMessageBtn.textContent = 'Send →';

            if (chrome.runtime.lastError) {
                console.error('Failed to send:', chrome.runtime.lastError);
                alert('Failed to send: ' + chrome.runtime.lastError.message);
                return;
            }

            if (response && response.success) {
                this.elements.messageInput.value = '';
                this.updateSendButtonState();
                // Force a refresh to show the sent message
                setTimeout(() => this.loadData(), 100);
            } else {
                console.error('Failed to send:', response?.error);
                alert('Failed to send message: ' + (response?.error || 'Unknown error'));
            }
        });
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
        this.updateSendButtonState();
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
                <div class="info-item">
                    <div class="info-label">URL</div>
                    <div class="info-value">${this.escapeHtml(item.url)}</div>
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
            const dataSize = this.formatBytes(new TextEncoder().encode(msg.data).length);

            let displayData = msg.data;
            let isJson = false;

            if (this.viewMode === 'pretty') {
                try {
                    const parsed = JSON.parse(msg.data);
                    displayData = JSON.stringify(parsed, null, 2);
                    isJson = true;
                } catch (e) {
                    // Not JSON
                }
            }

            el.innerHTML = `
                <div class="ws-msg-header">
                    <span class="ws-msg-direction">${direction}${manualTag}</span>
                    <span class="ws-msg-meta">#${index + 1} • ${timestamp} • ${dataSize}</span>
                </div>
                <div class="ws-msg-data ${isJson ? 'ws-json-data' : ''}">
                    ${this.viewMode === 'pretty' && isJson ? this.syntaxHighlightJSON(displayData) : `<pre class="raw-pre">${this.escapeHtml(displayData)}</pre>`}
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

    syntaxHighlightJSON(json) {
        let html = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

        html = html.replace(jsonRegex, function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });

        return `<pre class="json-pre">${html}</pre>`;
    }
}

const page = new WebSocketPage();