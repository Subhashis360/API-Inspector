class DashboardCommon {
    constructor() {
        this.data = { apiCalls: [], jsFiles: {}, webSockets: [] };
        this.setupCommonListeners();
        this.loadData();
        this.updateConnectionStatus(false);
    }

    setupCommonListeners() {
        // Import/Export/Clear buttons
        const importBtn = document.getElementById('importBtn');
        const exportBtn = document.getElementById('exportBtn');
        const clearBtn = document.getElementById('clearBtn');
        const importInput = document.getElementById('importInput');

        if (importBtn) importBtn.addEventListener('click', () => importInput.click());
        if (importInput) importInput.addEventListener('change', (e) => this.importData(e));
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportData());
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearData());

        // Connection Status
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                if (changes.collectedData) {
                    this.data = changes.collectedData.newValue || { apiCalls: [], jsFiles: {}, webSockets: [] };
                    this.updateCounts();
                    if (this.onDataUpdated) this.onDataUpdated();
                }
                if (changes.isRecording) {
                    this.updateConnectionStatus(changes.isRecording.newValue);
                }
            }
        });
    }

    loadData() {
        chrome.storage.local.get(['collectedData', 'isRecording'], (result) => {
            if (result.collectedData) {
                this.data = result.collectedData;
                this.updateCounts();
                if (this.onDataUpdated) this.onDataUpdated();
            }
            this.updateConnectionStatus(result.isRecording);
        });
    }

    updateCounts() {
        const apiCount = document.getElementById('apiCount');
        const wsCount = document.getElementById('wsCount');
        if (apiCount) apiCount.textContent = this.data.apiCalls ? this.data.apiCalls.length : 0;
        if (wsCount) wsCount.textContent = this.data.webSockets ? this.data.webSockets.length : 0;
    }

    updateConnectionStatus(isRecording) {
        const statusEl = document.getElementById('connectionStatus');
        const dotEl = document.querySelector('.status-dot');
        if (statusEl && dotEl) {
            if (isRecording) {
                statusEl.textContent = 'Recording';
                statusEl.style.color = 'var(--success)';
                dotEl.style.backgroundColor = 'var(--success)';
                dotEl.style.animation = 'pulse 2s infinite';
            } else {
                statusEl.textContent = 'Connected';
                statusEl.style.color = 'var(--text-secondary)';
                dotEl.style.backgroundColor = 'var(--text-secondary)';
                dotEl.style.animation = 'none';
            }
        }
    }

    clearData() {
        if (confirm('Clear all captured data?')) {
            chrome.runtime.sendMessage({ action: 'clearData' });
        }
    }

    exportData() {
        const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `api-inspector-${Date.now()}.json`;
        a.click();
    }

    importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (imported.apiCalls) {
                    this.data = imported;
                    chrome.storage.local.set({ collectedData: this.data });
                }
            } catch (err) {
                alert('Error parsing JSON');
            }
        };
        reader.readAsText(file);
    }

    // Utility Methods
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    highlightText(text, query) {
        if (!text) return '';
        const safeText = this.escapeHtml(text);
        if (!query) return safeText;

        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, 'gi');
        return safeText.replace(regex, '<span class="search-highlight">$1</span>');
    }

    syntaxHighlightJson(json) {
        if (typeof json !== 'string') {
            json = JSON.stringify(json, null, 2);
        }
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }
            return '<span class="json-' + cls + '">' + match + '</span>';
        });
    }

    syntaxHighlightHttp(text) {
        if (!text) return '';
        let safeText = this.escapeHtml(text);

        // Highlight Method and Protocol
        safeText = safeText.replace(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|CONNECT|TRACE)(\s+)(.*?)(\s+)(HTTP\/\d\.\d)/gm,
            '<span class="http-method">$1</span>$2$3$4<span class="http-protocol">$5</span>');

        // Highlight Status Line
        safeText = safeText.replace(/^(HTTP\/\d\.\d)(\s+)(\d{3})(\s+)(.*)/gm,
            '<span class="http-protocol">$1</span>$2<span class="http-status-code">$3</span>$4<span class="http-status-text">$5</span>');

        // Highlight Headers
        safeText = safeText.replace(/^([a-zA-Z0-9-]+):(\s+)(.*)/gm,
            '<span class="http-header-key">$1</span>:<span class="http-header-value">$2$3</span>');

        // Highlight JSON body (simple detection)
        // We look for the start of a JSON object or array after a double newline (headers end)
        const parts = safeText.split('\n\n');
        if (parts.length > 1) {
            // The last part is likely the body
            let body = parts.slice(1).join('\n\n');
            // Try to highlight if it looks like JSON
            if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
                // We need to unescape to parse, then re-highlight
                try {
                    const unescaped = text.split('\n\n').slice(1).join('\n\n');
                    const highlightedBody = this.syntaxHighlightJson(JSON.parse(unescaped));
                    parts[parts.length - 1] = highlightedBody;
                    return parts.join('\n\n');
                } catch (e) {
                    // If parsing fails, just return the text with HTTP highlighting
                }
            }
        }

        return safeText;
    }

    getStatusClass(code) {
        if (!code) return '';
        if (code >= 200 && code < 300) return 'status-2xx';
        if (code >= 300 && code < 400) return 'status-3xx';
        if (code >= 400 && code < 500) return 'status-4xx';
        return 'status-5xx';
    }
}
