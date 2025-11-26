class HttpRequestPage extends DashboardCommon {
    constructor() {
        super();
        this.selectedItem = null;
        this.filters = { search: '', method: 'ALL', status: 'ALL' };
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
            ctxSendToRepeater: document.getElementById('ctxSendToRepeater')
        };

        this.contextMenuItem = null; // Store the item triggered by context menu

        this.setupPageListeners();
    }

    onDataUpdated() {
        this.renderList();
    }

    setupPageListeners() {
        // Search & Filter
        this.elements.searchInput.addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.renderList();
        });
        this.elements.methodFilter.addEventListener('change', (e) => {
            this.filters.method = e.target.value;
            this.renderList();
        });
        this.elements.statusFilter.addEventListener('change', (e) => {
            this.filters.status = e.target.value;
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

        document.addEventListener('click', () => {
            this.elements.highlightMenu.classList.add('hidden');
            this.elements.contextMenu.classList.add('hidden');
        });

        // Context Menu Actions
        this.elements.ctxSendToRepeater.addEventListener('click', () => {
            if (this.contextMenuItem) {
                this.sendToRepeater(this.contextMenuItem);
            }
            this.elements.contextMenu.classList.add('hidden');
        });
    }

    renderList() {
        const list = this.elements.apiList;
        list.innerHTML = '';

        const filtered = this.data.apiCalls.filter(item => {
            const matchSearch = !this.filters.search ||
                item.url.toLowerCase().includes(this.filters.search) ||
                item.method.toLowerCase().includes(this.filters.search);
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

        filtered.forEach(item => {
            const el = this.createApiListItem(item, this.selectedItem && this.selectedItem.id === item.id, item.highlightColor);
            el.addEventListener('click', () => this.selectItem(item));

            // Context Menu
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, item);
            });

            list.appendChild(el);
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
      <div class="col-time">${item.time ? Math.round(item.time) + 'ms' : '-'}</div>
    `;
        return el;
    }

    selectItem(item) {
        this.selectedItem = item;
        this.renderList(); // Re-render to update selection state
        this.elements.detailsEmpty.classList.add('hidden');
        this.elements.detailsContent.classList.remove('hidden');
        this.renderDetails('split'); // Default view
    }

    renderDetails(viewMode = 'split') {
        if (!this.selectedItem) return;
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
            return `<div class="code-block">${this.syntaxHighlightJson(body)}</div>`;
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
            return `<div class="code-block">${this.syntaxHighlightJson(parsed)}</div>`;
        } catch (e) {
            // Not JSON, return as string
            return `<div class="code-block">${this.highlightText(content, this.filters.search)}</div>`;
        }
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
}

// Initialize
const page = new HttpRequestPage();
