class RepeaterPage extends DashboardCommon {
    constructor() {
        super();
        this.repeaterTabs = [];
        this.activeRepeaterTabId = null;
        this.repeaterCounter = 1;

        this.elements = {
            // Note: We now render tabs into the container, not the bar itself
            repeaterTabsContainer: document.getElementById('repeaterTabsContainer'),
            repeaterWorkspace: document.getElementById('repeaterWorkspace'),
            addRepeaterTabBtn: document.getElementById('addRepeaterTab'),

            // Settings
            settingsBtn: document.getElementById('repeaterSettingsBtn'),
            settingsModal: document.getElementById('settingsModal'),
            closeSettingsBtn: document.getElementById('closeSettingsModal'),
            saveSettingsBtn: document.getElementById('saveSettingsBtn'),
            proxyStatus: document.getElementById('proxyStatus'),

            // HTTP Proxy inputs
            httpProxyHost: document.getElementById('httpProxyHost'),
            httpProxyPort: document.getElementById('httpProxyPort'),
            httpProxyUser: document.getElementById('httpProxyUser'),
            httpProxyPass: document.getElementById('httpProxyPass'),

            // HTTPS Proxy inputs
            httpsProxyHost: document.getElementById('httpsProxyHost'),
            httpsProxyPort: document.getElementById('httpsProxyPort'),
            httpsProxyUser: document.getElementById('httpsProxyUser'),
            httpsProxyPass: document.getElementById('httpsProxyPass'),
            sameAsHttp: document.getElementById('sameAsHttp'),
            httpsProxyInputs: document.getElementById('httpsProxyInputs')
        };

        this.proxyConfig = { http: null, https: null, enabled: true };

        this.setupPageListeners();
        this.setupSettingsListeners(); // New listener setup

        Promise.all([
            this.loadTabs(),
            this.loadProxySettings()
        ]).then(() => {
            this.checkPendingRequest();
        });
    }

    setupPageListeners() {
        this.elements.addRepeaterTabBtn.addEventListener('click', () => this.addRepeaterTab());
    }

    setupSettingsListeners() {
        // Open Modal
        this.elements.settingsBtn.addEventListener('click', () => {
            this.loadProxyIntoForm();
            this.elements.proxyStatus.classList.add('hidden');
            this.elements.settingsModal.classList.remove('hidden');
        });

        // Close Modal
        this.elements.closeSettingsBtn.addEventListener('click', () => {
            this.elements.settingsModal.classList.add('hidden');
        });

        // Close on clicking outside
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) {
                this.elements.settingsModal.classList.add('hidden');
            }
        });

        // Same as HTTP checkbox
        this.elements.sameAsHttp.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.elements.httpsProxyInputs.classList.add('disabled');
            } else {
                this.elements.httpsProxyInputs.classList.remove('disabled');
            }
        });

        // Save Settings
        this.elements.saveSettingsBtn.addEventListener('click', async () => {
            this.validateAndSaveProxy();
        });
    }

    loadProxyIntoForm() {
        if (this.proxyConfig.http) {
            this.elements.httpProxyHost.value = this.proxyConfig.http.host || '';
            this.elements.httpProxyPort.value = this.proxyConfig.http.port || '';
            this.elements.httpProxyUser.value = this.proxyConfig.http.username || '';
            this.elements.httpProxyPass.value = this.proxyConfig.http.password || '';
        } else {
            this.elements.httpProxyHost.value = '';
            this.elements.httpProxyPort.value = '';
            this.elements.httpProxyUser.value = '';
            this.elements.httpProxyPass.value = '';
        }

        if (this.proxyConfig.https) {
            this.elements.httpsProxyHost.value = this.proxyConfig.https.host || '';
            this.elements.httpsProxyPort.value = this.proxyConfig.https.port || '';
            this.elements.httpsProxyUser.value = this.proxyConfig.https.username || '';
            this.elements.httpsProxyPass.value = this.proxyConfig.https.password || '';
            this.elements.sameAsHttp.checked = false;
            this.elements.httpsProxyInputs.classList.remove('disabled');
        } else {
            this.elements.httpsProxyHost.value = '';
            this.elements.httpsProxyPort.value = '';
            this.elements.httpsProxyUser.value = '';
            this.elements.httpsProxyPass.value = '';
            this.elements.sameAsHttp.checked = true;
            this.elements.httpsProxyInputs.classList.add('disabled');
        }
    }

    async loadProxySettings() {
        try {
            const result = await this.storageDB.getSetting('repeater_proxy_config');
            if (result) {
                this.proxyConfig = result;
            } else {
                this.proxyConfig = { http: null, https: null, enabled: true };
            }
            // Update settings button color if any proxy is configured
            if (this.proxyConfig.http || this.proxyConfig.https) {
                this.elements.settingsBtn.style.color = 'var(--accent-primary)';
            }
        } catch (error) {
            console.error('[RepeaterPage] Error loading proxy settings:', error);
            this.proxyConfig = { http: null, https: null, enabled: true };
        }
    }

    async saveProxySettings(config) {
        try {
            await this.storageDB.setSetting('repeater_proxy_config', config);
            this.proxyConfig = config;
            if (config.http || config.https) {
                this.elements.settingsBtn.style.color = 'var(--accent-primary)';
            } else {
                this.elements.settingsBtn.style.color = '';
            }
        } catch (error) {
            console.error('[RepeaterPage] Error saving proxy settings:', error);
        }
    }

    showProxyStatus(msg, type) {
        const el = this.elements.proxyStatus;
        el.textContent = msg;
        el.className = `status-message ${type}`;
        el.classList.remove('hidden');
    }

    async validateAndSaveProxy() {
        const btn = this.elements.saveSettingsBtn;
        btn.textContent = 'Verifying...';
        btn.classList.add('btn-disabled');

        try {
            // Read form values
            const httpHost = this.elements.httpProxyHost.value.trim();
            const httpPort = this.elements.httpProxyPort.value.trim();
            const httpUser = this.elements.httpProxyUser.value.trim();
            const httpPass = this.elements.httpProxyPass.value.trim();

            const sameAsHttp = this.elements.sameAsHttp.checked;
            let httpsHost, httpsPort, httpsUser, httpsPass;

            if (sameAsHttp) {
                httpsHost = httpHost;
                httpsPort = httpPort;
                httpsUser = httpUser;
                httpsPass = httpPass;
            } else {
                httpsHost = this.elements.httpsProxyHost.value.trim();
                httpsPort = this.elements.httpsProxyPort.value.trim();
                httpsUser = this.elements.httpsProxyUser.value.trim();
                httpsPass = this.elements.httpsProxyPass.value.trim();
            }

            // Build config object
            const newConfig = {
                http: httpHost ? {
                    scheme: 'http',
                    host: httpHost,
                    port: parseInt(httpPort) || 80,
                    username: httpUser || null,
                    password: httpPass || null
                } : null,
                https: httpsHost ? {
                    scheme: 'http',
                    host: httpsHost,
                    port: parseInt(httpsPort) || 443,
                    username: httpsUser || null,
                    password: httpsPass || null
                } : null,
                enabled: this.proxyConfig.enabled
            };

            // If both are empty, clear config
            if (!newConfig.http && !newConfig.https) {
                await this.saveProxySettings({ http: null, https: null, enabled: true });
                this.showProxyStatus('Proxy configuration cleared.', 'success');
                setTimeout(() => this.elements.settingsModal.classList.add('hidden'), 1000);
                return;
            }

            // Test the proxy by applying temporarily
            const testConfig = this.buildChromeProxyConfig(newConfig.http || newConfig.https);
            await this.applyChromeProxy(testConfig);

            // Verify with IP service
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const res = await fetch('https://api.ipify.org?format=json', {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    // Build success message with the proxy info user entered
                    let proxyInfo = '';
                    if (newConfig.http) {
                        proxyInfo = `HTTP Proxy: ${newConfig.http.host}:${newConfig.http.port}`;
                    }
                    if (newConfig.https) {
                        if (proxyInfo) proxyInfo += ' | ';
                        proxyInfo += `HTTPS Proxy: ${newConfig.https.host}:${newConfig.https.port}`;
                    }

                    this.showProxyStatus(`Success! ${proxyInfo}`, 'success');
                    await this.saveProxySettings(newConfig);
                    setTimeout(() => this.elements.settingsModal.classList.add('hidden'), 1500);
                } else {
                    throw new Error('Verification request failed');
                }
            } catch (err) {
                throw new Error('Could not connect through proxy: ' + err.message);
            } finally {
                // Revert proxy
                await this.clearChromeProxy();
            }

        } catch (error) {
            this.showProxyStatus(error.message, 'error');
        } finally {
            btn.textContent = 'Save & Apply';
            btn.classList.remove('btn-disabled');
        }
    }

    buildChromeProxyConfig(proxyInfo) {
        if (!proxyInfo) return null;

        return {
            mode: "fixed_servers",
            rules: {
                singleProxy: {
                    scheme: proxyInfo.scheme || 'http',
                    host: proxyInfo.host,
                    port: proxyInfo.port
                },
                bypassList: ["localhost", "127.0.0.1"]
            }
        };
    }

    async applyChromeProxy(config) {
        return new Promise((resolve) => {
            if (chrome && chrome.proxy) {
                chrome.proxy.settings.set(
                    { value: config, scope: 'regular' },
                    () => resolve()
                );
            } else {
                resolve(); // Fallback for dev/non-extension env
            }
        });
    }

    async clearChromeProxy() {
        return new Promise((resolve) => {
            if (chrome && chrome.proxy) {
                chrome.proxy.settings.clear(
                    { scope: 'regular' },
                    () => resolve()
                );
            } else {
                resolve();
            }
        });
    }

    async loadTabs() {
        try {
            const settings = await this.storageDB.getSettings(['repeaterTabs', 'activeRepeaterTabId']);

            if (settings.repeaterTabs && settings.repeaterTabs.length > 0) {
                this.repeaterTabs = settings.repeaterTabs;
                this.activeRepeaterTabId = settings.activeRepeaterTabId || this.repeaterTabs[0].id;
                this.repeaterCounter = this.repeaterTabs.length + 1;
            } else {
                this.repeaterTabs = [];
                this.addRepeaterTab(); // Add default empty tab
            }

            this.renderRepeaterTabs();
            this.renderRepeaterWorkspace();
        } catch (error) {
            console.error('[RepeaterPage] Error loading tabs:', error);
            this.addRepeaterTab(); // Fallback: add default tab
        }
    }

    async saveTabs() {
        try {
            await this.storageDB.setSettings({
                repeaterTabs: this.repeaterTabs,
                activeRepeaterTabId: this.activeRepeaterTabId
            });
        } catch (error) {
            console.error('[RepeaterPage] Error saving tabs:', error);
        }
    }

    async checkPendingRequest() {
        try {
            const pendingRequest = await this.storageDB.getSetting('repeater_pending_request');

            if (pendingRequest) {
                const req = pendingRequest;
                const activeTab = this.repeaterTabs.find(t => t.id === this.activeRepeaterTabId);
                const isEmpty = activeTab && !activeTab.url && activeTab.method === 'GET' && (!activeTab.headers || activeTab.headers.length === 0) && !activeTab.body;

                if (isEmpty) {
                    this.updateTabWithRequest(activeTab, req);
                } else {
                    this.addRepeaterTab(req);
                }

                await this.storageDB.removeSetting('repeater_pending_request');
            }
        } catch (error) {
            console.error('[RepeaterPage] Error checking pending request:', error);
        }
    }

    updateTabWithRequest(tab, req) {
        tab.method = req.method || 'GET';
        // Ensure URL always has a protocol before saving/displaying?
        // Actually, we usually want to keep it as is, but users expect http/https
        tab.url = req.url || '';
        tab.headers = req.headers || [];
        tab.body = req.body || '';
        tab.isHttps = req.isHttps !== undefined ? req.isHttps : (req.url?.startsWith('https') || false);

        this.normalizeTabData(tab);
        this.renderRepeaterTabs();
        this.renderRepeaterWorkspace();
        this.saveTabs();
    }

    normalizeTabData(tab) {
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

        if (typeof tab.body === 'object') {
            tab.body = JSON.stringify(tab.body, null, 2);
        }
    }

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
            isHttps: requestData?.isHttps !== undefined ? requestData.isHttps : true
        };

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
        const container = this.elements.repeaterTabsContainer;
        if (!container) return;

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

        // Removed appendChild(addBtn) because it is now outside the container in HTML
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
                    <div class="https-badge" id="proxyToggle">
                        <div class="https-checkbox ${this.proxyConfig.enabled ? 'active' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        <span class="https-label">PROXY</span>
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

        if (tab.url && tab.url.trim()) {
            try {
                const url = tab.url.startsWith('http') ? tab.url : 'http://' + tab.url;
                const parsedUrl = new URL(url);
                const path = (parsedUrl.pathname || '/') + (parsedUrl.search || '');
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

        let rawContent = '';
        rawContent += `HTTP/1.1 ${tab.response.status} ${tab.response.statusText}\n`;

        if (tab.response.headers) {
            rawContent += tab.response.headers;
            if (!tab.response.headers.endsWith('\n')) {
                rawContent += '\n';
            }
        }

        rawContent += '\n';

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
                <div class="line-numbers" id="resLineNumbers">${lineNumbers}</div>
                <div class="editor-content">
                    <pre class="editor-highlight" id="resHighlight">${this.syntaxHighlightUnified(rawContent)}</pre>
                    <textarea class="editor-textarea" id="resEditor" readonly>${rawContent}</textarea>
                </div>
            </div>
        `;
    }

    syntaxHighlightUnified(text) {
        if (!text) return '';

        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html = html.replace(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|CONNECT|TRACE)(\s+)(.*?)(\s+)(HTTP\/\d\.\d)/gm,
            '<span class="http-method">$1</span>$2$3$4<span class="http-protocol">$5</span>');

        html = html.replace(/^(HTTP\/\d\.\d)(\s+)(\d{3})(\s+)(.*)/gm,
            '<span class="http-protocol">$1</span>$2<span class="http-status-code">$3</span>$4<span class="http-status-text">$5</span>');

        html = html.replace(/^([a-zA-Z0-9-]+):(\s+)(.*)/gm,
            '<span class="http-header-key">$1</span>:<span class="http-header-value">$2$3</span>');

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
        document.getElementById('repMethod').addEventListener('change', (e) => {
            tab.method = e.target.value;
            this.renderRepeaterTabs();
            this.saveTabs();
        });

        document.getElementById('repUrl').addEventListener('input', (e) => {
            tab.url = e.target.value;
            this.saveTabs();
        });

        document.getElementById('httpsToggle').addEventListener('click', () => {
            tab.isHttps = !tab.isHttps;
            this.renderRepeaterWorkspace();
            this.saveTabs();
        });

        document.getElementById('proxyToggle').addEventListener('click', async () => {
            this.proxyConfig.enabled = !this.proxyConfig.enabled;
            await this.saveProxySettings(this.proxyConfig);
            this.renderRepeaterWorkspace();
        });

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

        document.getElementById('repSend').addEventListener('click', () => this.executeRepeaterRequest(tab));

        const resEditor = document.getElementById('resEditor');
        const resHighlight = document.getElementById('resHighlight');
        const resLineNumbers = document.getElementById('resLineNumbers');

        if (resEditor && resHighlight && resLineNumbers) {
            resEditor.addEventListener('scroll', () => {
                resHighlight.scrollTop = resEditor.scrollTop;
                resHighlight.scrollLeft = resEditor.scrollLeft;
                resLineNumbers.scrollTop = resEditor.scrollTop;
            });
        }
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

            // Extract body from raw request (everything after first blank line)
            if (parts.length > 1) {
                tab.body = parts.slice(1).join('\n\n');
            } else {
                tab.body = '';
            }
        } else {
            const parts = text.split('\n\n');
            tab.body = parts.slice(1).join('\n\n');
        }
    }

    async executeRepeaterRequest(tab) {
        const sendBtn = document.getElementById('repSend');
        if (sendBtn) {
            sendBtn.textContent = '...';
            sendBtn.disabled = true;
        }

        const startTime = Date.now();
        let proxyApplied = false;

        try {
            let url = tab.url;
            if (!url.startsWith('http')) {
                url = (tab.isHttps ? 'https://' : 'http://') + url;
            }

            // Apply proxy if enabled and configured
            let proxyApplied = false;
            if (this.proxyConfig.enabled) {
                const isHttpsRequest = url.startsWith('https://');
                const proxyToUse = isHttpsRequest ? this.proxyConfig.https : this.proxyConfig.http;

                if (proxyToUse) {
                    const proxyConfig = this.buildChromeProxyConfig(proxyToUse);
                    if (proxyConfig) {
                        await this.applyChromeProxy(proxyConfig);
                        proxyApplied = true;
                    }
                }
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
            // Revert proxy settings if they were applied
            if (proxyApplied) {
                await this.clearChromeProxy();
            }

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
