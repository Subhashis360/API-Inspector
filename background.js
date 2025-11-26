// Background script using Chrome Debugger API for full capture
let attachedTabs = new Map();
let collectedData = { jsFiles: {}, apiCalls: [], webSockets: [] };

// Helper function to check if a request is a JavaScript file
function isJavaScriptFile(type, url) {
  if (!url) return false;
  const urlLower = url.toLowerCase();
  if (type === 'Script') return true;
  if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs') || urlLower.endsWith('.jsx') || urlLower.includes('.js?') || urlLower.includes('.mjs?') || urlLower.includes('.jsx?')) return true;
  if (urlLower.includes('javascript') || urlLower.includes('/script') || urlLower.includes('type=script')) return true;
  return false;
}

// Helper function to check if a hostname matches target domain or is a subdomain
function matchesDomainOrSubdomain(hostname, targetDomain) {
  if (!hostname || !targetDomain) return false;
  const hostnameLower = hostname.toLowerCase();
  const targetLower = targetDomain.toLowerCase();
  if (hostnameLower === targetLower) return true;
  if (hostnameLower.endsWith('.' + targetLower)) {
    const depth = hostnameLower.split('.').length - targetLower.split('.').length;
    if (depth > 0 && depth <= 10) return true;
  }
  if (targetLower.endsWith('.' + hostnameLower)) {
    const depth = targetLower.split('.').length - hostnameLower.split('.').length;
    if (depth > 0 && depth <= 10) return true;
  }
  return false;
}

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    collectedData: { apiCalls: [], jsFiles: {}, webSockets: [] },
    lastError: null
  });
});

// Message Handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    doStartRecording(request.tabId, request.domain, request.captureAllRequests)
      .then(() => sendResponse({ success: true, status: 'started' }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'stopRecording') {
    doStopRecording(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'clearData') {
    collectedData = { apiCalls: [], jsFiles: {}, webSockets: [] };
    chrome.storage.local.set({ collectedData });
    sendResponse({ success: true });
    return false;
  }

  sendResponse({ success: false, error: 'Unknown action' });
  return false;
});

// Recording Logic
async function doStartRecording(tabId, domain, captureAllRequests = false) {
  console.log('Starting recording for tab:', tabId, 'domain:', domain, 'captureAll:', captureAllRequests);

  let normalizedDomain = domain;
  if (domain) {
    normalizedDomain = domain.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  }

  try {
    if (attachedTabs.has(tabId)) {
      const existing = attachedTabs.get(tabId);
      existing.domain = normalizedDomain;
      existing.captureAllRequests = captureAllRequests;
      attachedTabs.set(tabId, existing);
      await updateRecordingState(true, normalizedDomain, tabId, null, captureAllRequests);
      return;
    }

    const debuggee = { tabId };
    try {
      await attachDebugger(debuggee, "1.3");
    } catch (e) {
      if (!e.message.includes("Already attached")) {
        await updateRecordingState(false, domain, tabId, e.message, captureAllRequests);
        throw e;
      }
    }

    // Initialize collectedData BEFORE enabling network to avoid race conditions
    const stored = await chrome.storage.local.get(['collectedData']);
    if (stored.collectedData) {
      collectedData = stored.collectedData;
      if (!collectedData.apiCalls) collectedData.apiCalls = [];
      if (!collectedData.jsFiles) collectedData.jsFiles = {};
      if (!collectedData.webSockets) collectedData.webSockets = [];
    } else {
      collectedData = { apiCalls: [], jsFiles: {}, webSockets: [] };
      await chrome.storage.local.set({ collectedData });
    }

    // Enable Network and disable cache for full capture
    await sendCommand(debuggee, "Network.enable", {
      maxResourceBufferSize: 100 * 1024 * 1024,
      maxPostDataSize: 100 * 1024 * 1024
    });

    // CRITICAL: Disable cache to ensure all requests are captured
    await sendCommand(debuggee, "Network.setCacheDisabled", { cacheDisabled: true });

    const session = {
      domain: normalizedDomain,
      captureAllRequests: captureAllRequests,
      requests: new Map(),
      websockets: new Map()
    };
    attachedTabs.set(tabId, session);

    await updateRecordingState(true, normalizedDomain, tabId, null, captureAllRequests);

    console.log(`Recording started. Capture All: ${captureAllRequests}`);
  } catch (err) {
    await updateRecordingState(false, domain, tabId, err.message, captureAllRequests);
    throw err;
  }
}

async function updateRecordingState(isRecording, domain, tabId, error, captureAllRequests = false) {
  await chrome.storage.local.set({
    isRecording,
    targetDomain: domain,
    captureAllRequests,
    recordingTabId: tabId,
    lastError: error,
    startTime: isRecording ? Date.now() : null
  });
}

async function doStopRecording(tabId) {
  if (!attachedTabs.has(tabId)) {
    await chrome.storage.local.set({ isRecording: false });
    return;
  }
  try {
    await new Promise((resolve) => chrome.debugger.detach({ tabId }, resolve));
  } catch (err) { }
  attachedTabs.delete(tabId);
  await chrome.storage.local.set({ isRecording: false });
}

function attachDebugger(target, version) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, version, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function sendCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

// Event Listener
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!attachedTabs.has(tabId)) return;
  const session = attachedTabs.get(tabId);

  // HTTP Handling
  if (method === "Network.requestWillBeSent") handleRequest(tabId, params, session);
  else if (method === "Network.responseReceived") handleResponse(tabId, params, session);
  else if (method === "Network.loadingFinished") handleFinished(tabId, params, session);
  else if (method === "Network.loadingFailed") handleFailed(tabId, params, session);

  // WebSocket Handling
  else if (method === "Network.webSocketCreated") handleWebSocketCreated(tabId, params, session);
  else if (method === "Network.webSocketWillSendHandshakeRequest") handleWebSocketHandshakeRequest(tabId, params, session);
  else if (method === "Network.webSocketHandshakeResponseReceived") handleWebSocketHandshakeResponse(tabId, params, session);
  else if (method === "Network.webSocketFrameSent") handleWebSocketFrameSent(tabId, params, session);
  else if (method === "Network.webSocketFrameReceived") handleWebSocketFrameReceived(tabId, params, session);
  else if (method === "Network.webSocketClosed") handleWebSocketClosed(tabId, params, session);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (attachedTabs.has(source.tabId)) {
    attachedTabs.delete(source.tabId);
    chrome.storage.local.set({ isRecording: false });
  }
});

// --- HTTP Handlers ---

function handleRequest(tabId, params, session) {
  const { requestId, request, type } = params;
  const url = request.url;

  // Filter Logic
  // We strictly filter out static assets unless they are XHR/Fetch or WebSocket
  const isXhrOrFetch = type === 'XHR' || type === 'Fetch' || type === 'WebSocket';

  // List of types to always ignore unless XHR/Fetch
  const isStaticType = ['Image', 'Stylesheet', 'Font', 'Media', 'Manifest', 'TextTrack', 'Ping', 'CSPViolationReport', 'Other'].includes(type);

  // Check for static file extensions
  const urlLower = url.toLowerCase();
  const isStaticExtension = /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff|css|woff|woff2|ttf|eot|otf|mp4|webm|mp3|wav|json|map)$/.test(urlLower.split('?')[0]);

  // If it's a static asset (by type or extension) and NOT XHR/Fetch/WebSocket, ignore it
  if ((isStaticType || isStaticExtension) && !isXhrOrFetch) return;

  // Further domain filtering if not capturing all
  if (session.domain && !session.captureAllRequests) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
      let targetDomain = session.domain.replace(/^www\./, '').toLowerCase();

      if (!matchesDomainOrSubdomain(hostname, targetDomain) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        const method = (request.method || 'GET').toUpperCase();
        // Allow POST/PUT/PATCH/DELETE even if cross-domain, but strict on GET
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !isXhrOrFetch) return;
      }
    } catch (e) { }
  }

  const entry = {
    id: requestId,
    url: url,
    method: (request.method || 'GET').toUpperCase(),
    type: type,
    timestamp: new Date().toISOString(),
    requestHeaders: request.headers ? Object.entries(request.headers).map(([name, value]) => ({ name, value })) : [],
    requestBody: request.postData || null,
    status: 'pending'
  };

  session.requests.set(requestId, entry);
  updateStorage(entry);
}

function handleResponse(tabId, params, session) {
  const { requestId, response } = params;
  const entry = session.requests.get(requestId);
  if (entry) {
    if (!entry.response) entry.response = {};
    entry.response.statusCode = response.status;
    entry.response.statusText = response.statusText;
    entry.response.headers = response.headers ? Object.entries(response.headers).map(([name, value]) => ({ name, value })) : [];
    entry.response.mimeType = response.mimeType;
    updateStorage(entry);
  }
}

async function handleFinished(tabId, params, session) {
  const { requestId } = params;
  const entry = session.requests.get(requestId);
  if (entry) {
    entry.status = 'completed';
    if (!entry.response) entry.response = { statusCode: 0, headers: [] };

    try {
      const result = await sendCommand({ tabId }, "Network.getResponseBody", { requestId });
      if (result && result.body) {
        entry.response.body = result.body;
        entry.response.base64Encoded = result.base64Encoded || false;
      }
    } catch (err) {
      entry.response.error = "Body capture failed: " + err.message;
    }

    updateStorage(entry);
    setTimeout(() => session.requests.delete(requestId), 60000);
  }
}

function handleFailed(tabId, params, session) {
  const { requestId, errorText } = params;
  const entry = session.requests.get(requestId);
  if (entry) {
    entry.status = 'failed';
    entry.error = errorText;
    updateStorage(entry);
    setTimeout(() => session.requests.delete(requestId), 60000);
  }
}

// --- WebSocket Handlers ---

function handleWebSocketCreated(tabId, params, session) {
  const { requestId, url } = params;
  const wsEntry = {
    id: requestId,
    url: url,
    type: 'websocket',
    timestamp: new Date().toISOString(),
    status: 'connecting',
    frames: []
  };
  session.websockets.set(requestId, wsEntry);
  updateWsStorage(wsEntry);
}

function handleWebSocketHandshakeRequest(tabId, params, session) {
  // Can capture headers here if needed
}

function handleWebSocketHandshakeResponse(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.status = 'connected';
    wsEntry.handshakeResponse = response;
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketFrameSent(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.frames.push({
      type: 'send',
      data: response.payloadData,
      time: new Date().toISOString()
    });
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketFrameReceived(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.frames.push({
      type: 'receive',
      data: response.payloadData,
      time: new Date().toISOString()
    });
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketClosed(tabId, params, session) {
  const { requestId } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.status = 'closed';
    updateWsStorage(wsEntry);
  }
}

// --- Storage Updates ---

function updateStorage(entry) {
  const index = collectedData.apiCalls.findIndex(c => c.id === entry.id);
  if (index !== -1) collectedData.apiCalls[index] = entry;
  else collectedData.apiCalls.push(entry);

  if (collectedData.apiCalls.length > 10000) collectedData.apiCalls.shift();

  if (isJavaScriptFile(entry.type, entry.url)) {
    const urlObj = new URL(entry.url);
    const domain = urlObj.hostname;
    if (!collectedData.jsFiles[domain]) collectedData.jsFiles[domain] = {};
    collectedData.jsFiles[domain][entry.url] = { url: entry.url, type: entry.type, lastSeen: new Date().toISOString() };
  }

  chrome.storage.local.set({ collectedData });
}

function updateWsStorage(entry) {
  const index = collectedData.webSockets.findIndex(w => w.id === entry.id);
  if (index !== -1) collectedData.webSockets[index] = entry;
  else collectedData.webSockets.push(entry);

  if (collectedData.webSockets.length > 1000) collectedData.webSockets.shift();

  chrome.storage.local.set({ collectedData });
}