class HttpRequestPage extends DashboardCommon {
    constructor() {
        super();
        this.selectedItem = null;
        this.filters = { search: '', method: 'ALL', status: 'ALL' };
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
            methodFilter: document.getElementById('methodFilter'),
            statusFilter: document.getElementById('statusFilter'),
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

        this.contextMenuItem = null; // Store the item triggered by context menu

        this.setupPageListeners();

        // Load saved folder order synchronously on init
        chrome.storage.local.get('folderOrder', (result) => {
            if (result.folderOrder) {
                this.folderOrder = result.folderOrder;
                console.log('Loaded folder order:', this.folderOrder);
                // Re-render if data is already loaded
                if (this.data && this.data.apiCalls) {
                    this.renderList();
                }
            }
        });
    }

    // Save folder order to storage
    saveFolderOrder() {
        if (this.folderOrder) {
            chrome.storage.local.set({ folderOrder: this.folderOrder }, () => {
                console.log('Saved folder order:', this.folderOrder);
            });
        }
    }

    onDataUpdated() {
        this.renderList();
    }

    setupPageListeners() {
        // Search & Filter
        this.elements.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.searchMatchIndex = 0;
            this.renderList();
            this.updateSearchNav();
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

                // Folder context menu (right-click)
                headerEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.contextFolderDomain = domain;
                    this.showFolderContextMenu(e);
                });

                this.renderItems(items, contentEl);

                groupEl.appendChild(headerEl);
                groupEl.appendChild(contentEl);

                // Drag and drop event handlers for reordering folders
                groupEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', domain);
                    groupEl.style.opacity = '0.5';
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
                        // Reorder the domains
                        if (!this.folderOrder) this.folderOrder = Object.keys(groups).sort();

                        const draggedIndex = this.folderOrder.indexOf(draggedDomain);
                        const targetIndex = this.folderOrder.indexOf(domain);

                        if (draggedIndex !== -1 && targetIndex !== -1) {
                            // Remove dragged item and insert at target position
                            this.folderOrder.splice(draggedIndex, 1);
                            const newTargetIndex = this.folderOrder.indexOf(domain);
                            this.folderOrder.splice(newTargetIndex, 0, draggedDomain);

                            // Save the new order
                            this.saveFolderOrder();

                            // Re-render to show new order
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
            container.innerHTML = `
        <div class="split-view-content">
          <div class="split-half">
            <div class="split-header">Request</div>
            <div class="split-body">
              ${this.renderRequestContent(item)}
            </div>
          </div>
          <div class="split-half">
            <div class="split-header">Response</div>
            <div class="split-body">
              ${this.renderResponseContent(item)}
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
            // Not JSON, return as string with highlighting
            return `<div class="code-block">${this.highlightText(content, this.filters.search)}</div>`;
        }
    }

    // Helper method to apply search highlighting to already HTML-formatted content
    applySearchHighlight(html, query) {
        if (!query) return html;

        // Escape special regex characters in the query
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Create regex that matches the query but not inside HTML tags or existing spans
        const regex = new RegExp(`(?![^<]*>)(?!<[^>]*)(${escapedQuery})`, 'gi');

        // Replace matches with highlighted version
        return html.replace(regex, '<span class="search-highlight">$1</span>');
    }

    setHighlight(color) {
        if (!this.selectedItem) return;
        this.selectedItem.highlightColor = color;

        // Update local data
        const index = this.data.apiCalls.findIndex(i => i.id === this.selectedItem.id);
        if (index !== -1) {
            this.data.apiCalls[index].highlightColor = color;
            chrome.storage.local.set({ collectedData: this.data });
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

    sendToRepeater(specificItem = null) {
        const item = specificItem || this.selectedItem;
        if (!item) return;

        const repeaterData = {
            method: item.method,
            url: item.url,
            headers: item.requestHeaders,
            body: item.requestBody
        };

        chrome.storage.local.set({ repeater_pending_request: repeaterData }, () => {
            window.location.href = 'repeterpage.html';
        });
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
            // Remove from data
            const index = this.data.apiCalls.findIndex(req => req.id === item.id);
            if (index !== -1) {
                this.data.apiCalls.splice(index, 1);

                // Update storage
                await chrome.storage.local.set({ collectedData: this.data });

                // Clear selection if this was the selected item
                if (this.selectedItem && this.selectedItem.id === item.id) {
                    this.selectedItem = null;
                    this.elements.detailsContent.classList.add('hidden');
                    this.elements.detailsEmpty.classList.remove('hidden');
                }

                // Re-render list
                this.renderList();
            }
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
            // Remove all requests from this domain
            this.data.apiCalls = this.data.apiCalls.filter(req => req.sourceDomain !== domain);

            // Update storage
            await chrome.storage.local.set({ collectedData: this.data });

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
                    this.saveFolderOrder();
                }
            }

            // Re-render list
            this.renderList();
        } catch (e) {
            console.error('Failed to delete folder:', e);
            alert('Failed to delete folder');
        }
    }
}

// Initialize
const page = new HttpRequestPage();
