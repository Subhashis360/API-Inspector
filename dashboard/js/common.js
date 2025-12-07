class DashboardCommon {
    constructor() {
        this.data = { apiCalls: [], jsFiles: {}, webSockets: [] };
        if (!self.StorageDB) {
            console.error('StorageDB not found! Check if indexeddb.js is loaded.');
            return;
        }
        this.storageDB = self.StorageDB; // Access IndexedDB (works in all contexts)
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

        // Listen for IndexedDB changes
        this.storageDB.addChangeListener((changes) => {
            if (changes.collectedData) {
                const updates = changes.collectedData.newValue;
                const hasUpdates = (updates && (updates.apiCalls?.length > 0 || updates.webSockets?.length > 0));

                if (hasUpdates) {
                    this.handleIncrementalUpdate(updates);
                } else {
                    // Full reload for deletes or clears
                    this.loadData();
                }
            }
            if (changes.isRecording) {
                this.updateConnectionStatus(changes.isRecording.newValue);
            }
        });
    }

    handleIncrementalUpdate(updates) {
        // Merge API calls
        if (updates.apiCalls && updates.apiCalls.length > 0) {
            if (!this.data.apiCalls) this.data.apiCalls = [];

            updates.apiCalls.forEach(ne => {
                const idx = this.data.apiCalls.findIndex(e => e.id === ne.id);
                if (idx !== -1) {
                    this.data.apiCalls[idx] = ne; // Update
                } else {
                    this.data.apiCalls.push(ne); // Add
                }
            });
        }

        // Merge WebSockets
        if (updates.webSockets && updates.webSockets.length > 0) {
            if (!this.data.webSockets) this.data.webSockets = [];

            updates.webSockets.forEach(ne => {
                const idx = this.data.webSockets.findIndex(e => e.id === ne.id);
                if (idx !== -1) {
                    this.data.webSockets[idx] = ne; // Update
                } else {
                    this.data.webSockets.push(ne); // Add
                }
            });
        }

        this.updateCounts();

        // Notify page subclass
        if (this.onItemsAdded) {
            this.onItemsAdded(updates);
        } else if (this.onDataUpdated) {
            this.onDataUpdated();
        }
    }

    async loadData() {
        try {
            this.data = await this.storageDB.getCollectedData();
            this.updateCounts();
            if (this.onDataUpdated) this.onDataUpdated();

            const isRecording = await this.storageDB.getSetting('isRecording');
            this.updateConnectionStatus(isRecording);
        } catch (error) {
            console.error('[Dashboard] Error loading data:', error);
        }
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

    async importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (imported.apiCalls || imported.webSockets) {
                    // Import API calls
                    if (imported.apiCalls && imported.apiCalls.length > 0) {
                        await this.storageDB.batchAddApiCalls(imported.apiCalls);
                    }
                    // Import WebSockets
                    if (imported.webSockets && imported.webSockets.length > 0) {
                        await this.storageDB.batchAddWebSockets(imported.webSockets);
                    }
                    // Reload data
                    await this.loadData();
                }
            } catch (err) {
                alert('Error parsing JSON: ' + err.message);
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

            // Check headers for Content-Type
            const headersPart = parts[0];
            const isJs = /Content-Type:.*(javascript|x-javascript)/i.test(headersPart);

            if (isJs) {
                // Unescape to get raw body for formatting
                const unescaped = text.split('\n\n').slice(1).join('\n\n');
                const highlightedBody = this.syntaxHighlightJs(unescaped);
                parts[parts.length - 1] = highlightedBody;
                return parts.join('\n\n');
            }

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

    syntaxHighlightJs(code) {
        if (!code) return '';

        // 1. Basic Formatting (Pretty Print)
        // Simple indentation based on braces. Not a full parser but good for readability.
        let formatted = '';
        let indentLevel = 0;
        const indentString = '  '; // 2 spaces

        // Remove existing indentation to start fresh if it looks minified or messy
        // But be careful not to break strings. 
        // For safety, we'll process char by char or line by line if we had a full parser.
        // A simple approach: 
        // If code is one line (minified), split by { ; }
        const isMinified = code.split('\n').length <= 2 && code.length > 100;

        if (isMinified) {
            let temp = code.replace(/\{/g, '{\n').replace(/\}/g, '\n}\n').replace(/;/g, ';\n');
            // Naive rebuild
            const lines = temp.split('\n');
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;

                if (line.includes('}')) indentLevel = Math.max(0, indentLevel - 1);

                formatted += indentString.repeat(indentLevel) + line + '\n';

                if (line.includes('{')) indentLevel++;
            });
        } else {
            formatted = code; // Already formatted? Keep it.
        }

        // 2. Syntax Highlighting
        let safeText = this.escapeHtml(formatted);

        // Keywords
        const keywords = 'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|let|static|enum|await|async';
        safeText = safeText.replace(new RegExp(`\\b(${keywords})\\b`, 'g'), '<span class="js-keyword">$1</span>');

        // Functions (word followed by ()
        safeText = safeText.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g, '<span class="js-function">$1</span>(');

        // Strings (double and single quotes) - Simple regex, doesn't handle all escapes perfectly but okay for view
        safeText = safeText.replace(/(".*?"|'.*?')/g, '<span class="js-string">$1</span>');

        // Comments (// and /* */)
        safeText = safeText.replace(/(\/\/.*$)/gm, '<span class="js-comment">$1</span>');
        safeText = safeText.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="js-comment">$1</span>');

        // Numbers
        safeText = safeText.replace(/\b(\d+)\b/g, '<span class="js-number">$1</span>');

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
