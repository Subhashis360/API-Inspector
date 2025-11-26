// Enhanced content script with better interception
let isRecording = false;
let targetDomain = '';

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);

  if (request.action === 'startRecording') {
    isRecording = true;
    targetDomain = request.targetDomain;
    startContentScriptRecording();
    sendResponse({ status: 'started' });
  } else if (request.action === 'stopRecording') {
    isRecording = false;
    stopContentScriptRecording();
    sendResponse({ status: 'stopped' });
  } else if (request.action === 'resumeRecording') {
    isRecording = true;
    targetDomain = request.targetDomain;
    sendResponse({ status: 'resumed' });
  } else if (request.action === 'getStatus') {
    sendResponse({ isRecording, targetDomain });
  }
  return true;
});

// Check recording status on load
chrome.runtime.sendMessage({ action: 'getRecordingStatus' }, (response) => {
  if (response && response.isRecording) {
    isRecording = true;
    targetDomain = response.targetDomain;
    startContentScriptRecording();
  }
});

function startContentScriptRecording() {
  console.log('Starting content script recording for:', targetDomain);

  interceptFetch();
  interceptXHR();
  interceptWebSockets();
  captureScriptTags();
  captureDynamicImports();
}

function stopContentScriptRecording() {
  console.log('Stopping content script recording');
  // Note: We don't restore original methods to avoid breaking the page
}

function isTargetDomain(url) {
  if (!url || !targetDomain) return false;

  try {
    const urlObj = new URL(url);
    const requestDomain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
    let baseTargetDomain = targetDomain.replace(/^www\./, '').replace(/^https?:\/\//, '').toLowerCase();
    
    // Remove port and path
    baseTargetDomain = baseTargetDomain.split('/')[0].split(':')[0];

    // Exact match
    if (requestDomain === baseTargetDomain) {
      return true;
    }
    
    // Check if requestDomain ends with .baseTargetDomain (subdomain at any level)
    if (requestDomain.endsWith('.' + baseTargetDomain)) {
      // Count dots to ensure we don't exceed 10 levels
      const requestParts = requestDomain.split('.');
      const targetParts = baseTargetDomain.split('.');
      const depth = requestParts.length - targetParts.length;
      
      // Allow up to 10 levels of subdomains
      if (depth > 0 && depth <= 10) {
        return true;
      }
    }
    
    // Check reverse (target is subdomain of request)
    if (baseTargetDomain.endsWith('.' + requestDomain)) {
      const targetParts = baseTargetDomain.split('.');
      const requestParts = requestDomain.split('.');
      const depth = targetParts.length - requestParts.length;
      if (depth > 0 && depth <= 10) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    // If URL parsing fails, check if it's a relative URL
    return url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
  }
}

function interceptFetch() {
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const fetchStartTime = Date.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || args[0]?.toString();

    const fetchData = {
      type: 'fetch',
      url: url,
      method: args[1]?.method || 'GET',
      timestamp: new Date().toISOString(),
      args: args[1] ? JSON.parse(JSON.stringify(args[1])) : undefined
    };

    if (isRecording && isTargetDomain(url)) {
      return originalFetch.apply(this, args)
        .then(response => {
          const responseClone = response.clone();
          fetchData.duration = Date.now() - fetchStartTime;
          fetchData.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
            type: response.type
          };

          return responseClone.text().then(responseText => {
            fetchData.response.body = responseText;
            storeAPICall(fetchData);
            return response;
          });
        })
        .catch(error => {
          fetchData.error = error.toString();
          fetchData.duration = Date.now() - fetchStartTime;
          storeAPICall(fetchData);
          throw error;
        });
    }

    return originalFetch.apply(this, args);
  };
}

function interceptXHR() {
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    const xhrData = {
      type: 'xhr',
      timestamp: new Date().toISOString()
    };

    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const originalSetRequestHeader = xhr.setRequestHeader;

    xhr.open = function (method, url, ...rest) {
      xhrData.method = method;
      xhrData.url = url;
      xhrData.headers = {};

      return originalOpen.call(this, method, url, ...rest);
    };

    xhr.setRequestHeader = function (header, value) {
      xhrData.headers[header] = value;
      return originalSetRequestHeader.call(this, header, value);
    };

    xhr.send = function (body) {
      xhrData.requestBody = body;
      xhrData.sendTimestamp = new Date().toISOString();

      if (isRecording && isTargetDomain(xhrData.url)) {
        xhr.addEventListener('readystatechange', function () {
          if (xhr.readyState === 4) {
            xhrData.response = {
              status: xhr.status,
              statusText: xhr.statusText,
              responseURL: xhr.responseURL,
              responseType: xhr.responseType,
              responseText: xhr.responseText,
              response: xhr.response
            };
            xhrData.duration = Date.now() - new Date(xhrData.sendTimestamp).getTime();
            storeAPICall(xhrData);
          }
        });

        xhr.addEventListener('error', function () {
          xhrData.error = 'XHR Error';
          storeAPICall(xhrData);
        });

        xhr.addEventListener('timeout', function () {
          xhrData.error = 'XHR Timeout';
          storeAPICall(xhrData);
        });
      }

      return originalSend.call(this, body);
    };

    return xhr;
  };
}

function interceptWebSockets() {
  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);

    if (isRecording && isTargetDomain(url)) {
      const wsData = {
        type: 'websocket',
        url: url,
        protocols: protocols,
        timestamp: new Date().toISOString(),
        messages: []
      };

      const originalSend = ws.send;
      ws.send = function (data) {
        wsData.messages.push({
          type: 'sent',
          data: data,
          timestamp: new Date().toISOString()
        });

        // Limit messages to prevent memory issues
        if (wsData.messages.length > 100) {
          wsData.messages = wsData.messages.slice(-50);
        }

        storeAPICall(wsData);
        return originalSend.call(this, data);
      };

      ws.addEventListener('message', function (event) {
        wsData.messages.push({
          type: 'received',
          data: event.data,
          timestamp: new Date().toISOString()
        });

        if (wsData.messages.length > 100) {
          wsData.messages = wsData.messages.slice(-50);
        }

        storeAPICall(wsData);
      });

      ws.addEventListener('open', function () {
        wsData.connected = true;
        wsData.connectionTimestamp = new Date().toISOString();
        storeAPICall(wsData);
      });

      ws.addEventListener('close', function (event) {
        wsData.closed = true;
        wsData.closeTimestamp = new Date().toISOString();
        wsData.closeCode = event.code;
        wsData.closeReason = event.reason;
        storeAPICall(wsData);
      });

      ws.addEventListener('error', function (error) {
        wsData.error = error.toString();
        storeAPICall(wsData);
      });
    }

    return ws;
  };
}

function captureScriptTags() {
  // Capture existing script tags
  const scripts = document.querySelectorAll('script[src]');
  scripts.forEach(script => {
    const src = script.src;
    if (isTargetDomain(src)) {
      storeJSFileFromContent(src, 'script_tag');
    }
  });

  // Observe for new script tags
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'SCRIPT' && node.src) {
          if (isTargetDomain(node.src)) {
            storeJSFileFromContent(node.src, 'dynamic_script');
          }
        }
      });
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function captureDynamicImports() {
  const originalImport = window.import;
  if (typeof originalImport === 'function') {
    window.import = function (specifier) {
      if (isRecording && isTargetDomain(specifier)) {
        storeJSFileFromContent(specifier, 'dynamic_import');
      }
      return originalImport(specifier);
    };
  }
}

function storeAPICall(apiData) {
  if (!isRecording) return;

  try {
    // Generate unique ID
    apiData.id = `content_${apiData.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    chrome.runtime.sendMessage({
      action: 'storeAPICall',
      data: apiData
    }, (response) => {
      if (chrome.runtime.lastError) {
        // Silently handle errors
      }
    });
  } catch (error) {
    // Silently handle errors
  }
}

function storeJSFileFromContent(src, sourceType) {
  if (!isRecording) return;

  try {
    chrome.runtime.sendMessage({
      action: 'storeJSFile',
      data: {
        url: src,
        timestamp: new Date().toISOString(),
        source: sourceType
      }
    });
  } catch (error) {
    // Silently handle errors
  }
}

// Also capture console logs for debugging
const originalConsoleLog = console.log;
console.log = function (...args) {
  if (isRecording && args.some(arg =>
    typeof arg === 'string' && (arg.includes('api') || arg.includes('http') || arg.includes('fetch')))
  ) {
    storeAPICall({
      type: 'console',
      message: args.join(' '),
      timestamp: new Date().toISOString()
    });
  }
  originalConsoleLog.apply(console, args);
};

console.log('Content script loaded and ready');