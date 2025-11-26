class RepeaterPage extends DashboardCommon {
    constructor() {
        super();
        this.repeaterTabs = [];
        this.activeRepeaterTabId = null;
        this.repeaterCounter = 1;
        this.repeaterViewMode = 'split';

        this.elements = {
            repeaterTabsBar: document.getElementById('repeaterTabsBar'),
            repeaterWorkspace: document.getElementById('repeaterWorkspace'),
            addRepeaterTabBtn: document.getElementById('addRepeaterTab')
        };

        this.setupPageListeners();
        this.loadTabs().then(() => {
            this.checkPendingRequest();
        });
    }

    setupPageListeners() {
        this.elements.addRepeaterTabBtn.addEventListener('click', () => this.addRepeaterTab());
    }

    async loadTabs() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['repeaterTabs', 'activeRepeaterTabId'], (result) => {
                if (result.repeaterTabs && result.repeaterTabs.length > 0) {
                    this.repeaterTabs = result.repeaterTabs;
                    this.activeRepeaterTabId = result.activeRepeaterTabId || this.repeaterTabs[0].id;
                    this.repeaterCounter = this.repeaterTabs.length + 1;
                } else {
                    this.repeaterTabs = [];
                    this.addRepeaterTab(); // Add default empty tab
                }
                this.renderRepeaterTabs();
                this.renderRepeaterWorkspace();
                resolve();
            });
        });
    }

    saveTabs() {
        chrome.storage.local.set({
            repeaterTabs: this.repeaterTabs,
            activeRepeaterTabId: this.activeRepeaterTabId
        });
    }

    checkPendingRequest() {
        chrome.storage.local.get(['repeater_pending_request'], (result) => {
            if (result.repeater_pending_request) {
                const req = result.repeater_pending_request;

                // Smart Tab Logic: Check if current/active tab is "empty"
                const activeTab = this.repeaterTabs.find(t => t.id === this.activeRepeaterTabId);
                const isEmpty = activeTab && !activeTab.url && activeTab.method === 'GET' && (!activeTab.headers || activeTab.headers.length === 0) && !activeTab.body;

                if (isEmpty) {
                    // Overwrite active tab
                    this.updateTabWithRequest(activeTab, req);
                } else {
                    // Create new tab
                    this.addRepeaterTab(req);
                }

                chrome.storage.local.remove('repeater_pending_request');
            }
        });
    }

    updateTabWithRequest(tab, req) {
        tab.method = req.method || 'GET';
        tab.url = req.url || '';
        tab.headers = req.headers || [];
        tab.body = req.body || '';
        tab.isHttps = req.url?.startsWith('https') || false;

        // Normalize headers/body
        this.normalizeTabData(tab);

        this.renderRepeaterTabs();
        this.renderRepeaterWorkspace();
        this.saveTabs();
    }

    normalizeTabData(tab) {
        // Normalize headers
        if (typeof tab.headers === 'string') {
            const headerLines = tab.headers.split('\n');
            tab.headers = [];
            headerLines.forEach(line => {
                const parts = line.split(':');
                if (parts.length > 1) {
                    tab.headers.push({ name: parts[0].trim(), value: parts.slice(1).join(':').trim() });
                }
            });
        } else if (typeof tab.headers === 'object' && !Array.isArray(tab.headers)) {
            tab.headers = Object.entries(tab.headers).map(([name, value]) => ({ name, value }));
        } else if (!tab.headers) {
            tab.headers = [];
        }

        // Format body
        if (typeof tab.body === 'object') {
            tab.body = JSON.stringify(tab.body, null, 2);
        }
    }

    // Repeater Methods
    addRepeaterTab(requestData = null) {
        const id = Date.now().toString();
        const tab = {
            id,
            name: `Request ${this.repeaterCounter++}`,
            method: requestData?.method || 'GET',
            url: requestData?.url || '',
            headers: requestData?.headers || [],
            body: requestData?.body || '',
            response: null,
            isHttps: requestData?.url?.startsWith('https') || false
        };

        // Only normalize if we have actual request data
        if (requestData) {
            this.normalizeTabData(tab);
        }

        this.repeaterTabs.push(tab);
        this.activeRepeaterTabId = id;
        this.renderRepeaterTabs();
        this.renderRepeaterWorkspace();
        this.saveTabs();
    }

    renderRepeaterTabs() {
        const container = this.elements.repeaterTabsBar;
        if (!container) return;

        const addBtn = this.elements.addRepeaterTabBtn;
        container.innerHTML = '';

        this.repeaterTabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = `repeater-tab ${tab.id === this.activeRepeaterTabId ? 'active' : ''}`;
            el.innerHTML = `
                <span class="tab-method method-${tab.method}" style="font-size:11px; font-weight:bold; margin-right:5px;">${tab.method}</span>
                <span class="tab-name">${tab.name}</span>
                <span class="close-tab">×</span>
            `;

            el.addEventListener('click', (e) => {
                if (!e.target.classList.contains('close-tab')) {
                    this.switchRepeaterTab(tab.id);
                }
            });

            const closeBtn = el.querySelector('.close-tab');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.closeRepeaterTab(tab.id);
            });

            container.appendChild(el);
        });

        container.appendChild(addBtn);
    }

    switchRepeaterTab(id) {
        this.activeRepeaterTabId = id;
        this.renderRepeaterTabs();
        this.renderRepeaterWorkspace();
        this.saveTabs();
    }

    closeRepeaterTab(id) {
        if (this.repeaterTabs.length <= 1) return;

        const index = this.repeaterTabs.findIndex(t => t.id === id);
        this.repeaterTabs = this.repeaterTabs.filter(t => t.id !== id);

        if (this.activeRepeaterTabId === id) {
            const newIndex = Math.max(0, index - 1);
            this.activeRepeaterTabId = this.repeaterTabs[newIndex].id;
        }

        this.renderRepeaterTabs();
        this.renderRepeaterWorkspace();
        this.saveTabs();
    }

    renderRepeaterWorkspace() {
        const container = this.elements.repeaterWorkspace;
        if (!container) return;

        const tab = this.repeaterTabs.find(t => t.id === this.activeRepeaterTabId);
        if (!tab) return;

        container.innerHTML = `
            <div class="split-view-content">
                <div class="split-half">
                    ${this.renderRequestPanel(tab)}
                </div>
                <div class="split-half">
                    ${this.renderResponsePanel(tab)}
                </div>
            </div>
        `;

        this.attachRequestListeners(tab);
    }

    renderRequestPanel(tab) {
        const rawContent = this.combineHeadersAndBody(tab);
        const lineCount = rawContent.split('\n').length;
        const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

        return `
            <div class="panel-toolbar">
                <div class="toolbar-actions" style="flex:1;">
                    <div class="req-line" style="margin:0; background:#1e1e1e; padding:4px 8px; border-radius:4px; flex:1; display:flex;">
                        <select class="method-select" id="repMethod" style="background:transparent; border:none; color:#CC7832; font-weight:bold; font-family:inherit; outline:none; width:80px;">
                            <option value="GET" ${tab.method === 'GET' ? 'selected' : ''}>GET</option>
                            <option value="POST" ${tab.method === 'POST' ? 'selected' : ''}>POST</option>
                            <option value="PUT" ${tab.method === 'PUT' ? 'selected' : ''}>PUT</option>
                            <option value="DELETE" ${tab.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
                            <option value="PATCH" ${tab.method === 'PATCH' ? 'selected' : ''}>PATCH</option>
                        </select>
                        <div class="toolbar-divider"></div>
                        <input type="text" id="repUrl" value="${tab.url}" placeholder="http://api.example.com/v1/users" style="flex:1; background:transparent; border:none; color:#A9B7C6; font-family:'JetBrains Mono', monospace; font-size:13px; outline:none; margin-left:8px;">
                    </div>
                </div>
                <div class="toolbar-actions" style="margin-left:12px;">
                    <div class="https-badge" id="httpsToggle">
                        <div class="https-checkbox ${tab.isHttps ? 'active' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        <span class="https-label">HTTPS</span>
                    </div>
                    <button class="send-btn" id="repSend">SEND</button>
                </div>
            </div>
            <div class="unified-editor">
                <div class="line-numbers" id="reqLineNumbers">${lineNumbers}</div>
                <div class="editor-content">
                    <pre class="editor-highlight" id="reqHighlight"></pre>
                    <textarea class="editor-textarea" id="reqEditor" spellcheck="false">${rawContent}</textarea>
                </div>
            </div>
        `;
    }

    combineHeadersAndBody(tab) {
        let content = '';

        // Only process URL if it exists
        if (tab.url && tab.url.trim()) {
            try {
                const url = tab.url.startsWith('http') ? tab.url : 'http://' + tab.url;
                const parsedUrl = new URL(url);
                const path = parsedUrl.pathname || '/';
                content += `${tab.method} ${path} HTTP/1.1\n`;
                const host = parsedUrl.host;
                content += `Host: ${host}\n`;
            } catch (e) {
                content += `${tab.method} / HTTP/1.1\n`;
            }
        } else {
            content += `${tab.method} / HTTP/1.1\n`;
        }

        if (tab.headers && tab.headers.length > 0) {
            const otherHeaders = tab.headers.filter(h => h.name.toLowerCase() !== 'host');
            if (otherHeaders.length > 0) {
                content += otherHeaders.map(h => `${h.name}: ${h.value}`).join('\n') + '\n';
            }
        }
        content += '\n';

        // Body - pretty print JSON if detected
        if (tab.body) {
            try {
                const jsonBody = JSON.parse(tab.body);
                content += JSON.stringify(jsonBody, null, 2);
            } catch (e) {
                content += typeof tab.body === 'string' ? tab.body : JSON.stringify(tab.body, null, 2);
            }
        }
        return content;
    }

    renderResponsePanel(tab) {
        if (!tab.response) {
            return `
                <div class="panel-toolbar">
                    <span class="panel-title">Response</span>
                </div>
                <div class="empty-state">
                    <div class="empty-icon">⚡</div>
                    <h3>Ready to Send</h3>
                </div>
            `;
        }

        // Build response content
        let rawContent = '';
        rawContent += `HTTP/1.1 ${tab.response.status} ${tab.response.statusText}\n`;

        if (tab.response.headers) {
            rawContent += tab.response.headers;
            if (!tab.response.headers.endsWith('\n')) {
                rawContent += '\n';
            }
        }

        rawContent += '\n';

        // Pretty print JSON response body
        if (tab.response.body) {
            try {
                const jsonBody = JSON.parse(tab.response.body);
                rawContent += JSON.stringify(jsonBody, null, 2);
            } catch (e) {
                rawContent += tab.response.body;
            }
        }

        const lineCount = rawContent.split('\n').length;
        const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

        return `
            <div class="panel-toolbar">
                <div class="toolbar-actions">
                    <span class="status-pill ${tab.response.status >= 200 && tab.response.status < 300 ? 'success' : ''}">${tab.response.status} ${tab.response.statusText}</span>
                    <span class="status-pill time">${tab.response.time}ms</span>
                    <span class="status-pill size">${tab.response.size}</span>
                </div>
            </div>
            <div class="unified-editor">
                <div class="line-numbers">${lineNumbers}</div>
                <div class="editor-content">
                    <pre class="editor-highlight">${this.syntaxHighlightUnified(rawContent)}</pre>
                    <textarea class="editor-textarea" readonly>${rawContent}</textarea>
                </div>
            </div>
        `;
    }

    syntaxHighlightUnified(text) {
        if (!text) return '';

        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Highlight Request Line
        html = html.replace(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|CONNECT|TRACE)(\s+)(.*?)(\s+)(HTTP\/\d\.\d)/gm,
            '<span class="http-method">$1</span>$2$3$4<span class="http-protocol">$5</span>');

        // Highlight Response Status Line
        html = html.replace(/^(HTTP\/\d\.\d)(\s+)(\d{3})(\s+)(.*)/gm,
            '<span class="http-protocol">$1</span>$2<span class="http-status-code">$3</span>$4<span class="http-status-text">$5</span>');

        // Highlight Headers
        html = html.replace(/^([a-zA-Z0-9-]+):(\s+)(.*)/gm,
            '<span class="http-header-key">$1</span>:<span class="http-header-value">$2$3</span>');

        // Highlight JSON Body
        const parts = html.split('\n\n');
        if (parts.length > 1) {
            let body = parts.slice(1).join('\n\n');
            if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
                const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

                body = body.replace(jsonRegex, function (match) {
                    var cls = 'syntax-number';
                    if (/^"/.test(match)) {
                        if (/:$/.test(match)) {
                            cls = 'syntax-key';
                        } else {
                            cls = 'syntax-string';
                        }
                    } else if (/true|false/.test(match)) {
                        cls = 'syntax-boolean';
                    } else if (/null/.test(match)) {
                        cls = 'syntax-null';
                    }
                    return '<span class="' + cls + '">' + match + '</span>';
                });

                return parts[0] + '\n\n' + body;
            }
        }

        return html;
    }

    attachRequestListeners(tab) {
        // Method
        document.getElementById('repMethod').addEventListener('change', (e) => {
            tab.method = e.target.value;
            this.renderRepeaterTabs();
            this.saveTabs();
        });

        // URL
        document.getElementById('repUrl').addEventListener('input', (e) => {
            tab.url = e.target.value;
            if (tab.url.startsWith('https://')) {
                tab.isHttps = true;
                this.renderRepeaterWorkspace();
            } else if (tab.url.startsWith('http://')) {
                tab.isHttps = false;
                this.renderRepeaterWorkspace();
            }
            this.saveTabs();
        });

        // HTTPS Toggle
        document.getElementById('httpsToggle').addEventListener('click', () => {
            tab.isHttps = !tab.isHttps;
            this.renderRepeaterWorkspace();
            this.saveTabs();
        });

        // Editor
        const editor = document.getElementById('reqEditor');
        const highlight = document.getElementById('reqHighlight');
        const lineNumbers = document.getElementById('reqLineNumbers');

        const updateEditor = () => {
            const text = editor.value;
            highlight.innerHTML = this.syntaxHighlightUnified(text);
            const lineCount = text.split('\n').length;
            lineNumbers.innerHTML = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
            highlight.scrollTop = editor.scrollTop;
            highlight.scrollLeft = editor.scrollLeft;
            lineNumbers.scrollTop = editor.scrollTop;
            this.parseRawRequest(text, tab);
            this.saveTabs();
        };

        highlight.innerHTML = this.syntaxHighlightUnified(editor.value);

        editor.addEventListener('input', updateEditor);
        editor.addEventListener('scroll', () => {
            highlight.scrollTop = editor.scrollTop;
            highlight.scrollLeft = editor.scrollLeft;
            lineNumbers.scrollTop = editor.scrollTop;
        });

        // Send
        document.getElementById('repSend').addEventListener('click', () => this.executeRepeaterRequest(tab));
    }

    parseRawRequest(text, tab) {
        const lines = text.split('\n');
        if (lines.length === 0) return;

        const firstLine = lines[0];
        const reqLineMatch = firstLine.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|CONNECT|TRACE)\s+(.*?)\s+HTTP\/\d\.\d/);

        if (reqLineMatch) {
            tab.method = reqLineMatch[1];
            const path = reqLineMatch[2];

            let host = '';
            const parts = text.split('\n\n');
            const headerLines = parts[0].split('\n').slice(1);

            tab.headers = [];
            headerLines.forEach(line => {
                const p = line.split(':');
                if (p.length > 1) {
                    const key = p[0].trim();
                    const val = p.slice(1).join(':').trim();
                    if (key.toLowerCase() === 'host') {
                        host = val;
                    } else {
                        tab.headers.push({ name: key, value: val });
                    }
                }
            });

            if (host) {
                tab.url = (tab.isHttps ? 'https://' : 'http://') + host + path;
            }

            const methodSelect = document.getElementById('repMethod');
            const urlInput = document.getElementById('repUrl');
            if (methodSelect && methodSelect.value !== tab.method) methodSelect.value = tab.method;
            if (urlInput && urlInput.value !== tab.url) urlInput.value = tab.url;
        } else {
            const parts = text.split('\n\n');
            tab.body = parts.slice(1).join('\n\n');
            return;
        }

        const parts = text.split('\n\n');
        tab.body = parts.slice(1).join('\n\n');
    }

    async executeRepeaterRequest(tab) {
        const sendBtn = document.getElementById('repSend');
        if (sendBtn) {
            sendBtn.textContent = '...';
            sendBtn.disabled = true;
        }

        const startTime = Date.now();

        try {
            let url = tab.url;
            if (!url.startsWith('http')) {
                url = (tab.isHttps ? 'https://' : 'http://') + url;
            }

            const headers = {};
            tab.headers.forEach(h => {
                if (h.name && h.value) headers[h.name] = h.value;
            });

            const options = {
                method: tab.method,
                headers: headers
            };

            if (['POST', 'PUT', 'PATCH'].includes(tab.method) && tab.body) {
                options.body = tab.body;
            }

            const res = await fetch(url, options);
            const text = await res.text();
            const endTime = Date.now();

            let respHeaders = '';
            res.headers.forEach((val, key) => {
                respHeaders += `${key}: ${val}\n`;
            });

            tab.response = {
                status: res.status,
                statusText: res.statusText,
                headers: respHeaders,
                body: text,
                time: endTime - startTime,
                size: (new TextEncoder().encode(text)).length + ' B'
            };

        } catch (e) {
            tab.response = {
                status: 0,
                statusText: 'Error',
                headers: '',
                body: e.message,
                time: 0,
                size: '0 B'
            };
        } finally {
            if (sendBtn) {
                sendBtn.textContent = 'SEND';
                sendBtn.disabled = false;
            }
        }

        this.renderRepeaterWorkspace();
        this.saveTabs();
    }
}

// Initialize
const page = new RepeaterPage();
