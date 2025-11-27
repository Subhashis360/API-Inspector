let attachedTabs = new Map();
let collectedData = { jsFiles: {}, apiCalls: [], webSockets: [] };
let windowModeActive = false; // Track if window mode is active

function isJavaScriptFile(type, url) {
  if (!url) return false;
  const urlLower = url.toLowerCase();
  if (type === 'Script') return true;
  if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs') || urlLower.endsWith('.jsx') || urlLower.includes('.js?') || urlLower.includes('.mjs?') || urlLower.includes('.jsx?')) return true;
  if (urlLower.includes('javascript') || urlLower.includes('/script') || urlLower.includes('type=script')) return true;
  return false;
}

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isRecording: false,
    collectedData: { apiCalls: [], jsFiles: {}, webSockets: [] },
    lastError: null
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    doStartRecording(request.windowId, request.tabId, request.domain, request.captureAllRequests)
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
  if (request.action === 'sendWebSocketMessage') {
    sendWebSocketMessage(request.tabId, request.requestId, request.message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  sendResponse({ success: false, error: 'Unknown action' });
  return false;
});

async function doStartRecording(windowId, tabId, domain, captureAllRequests = false) {
  console.log('Starting recording - windowId:', windowId, 'tabId:', tabId, 'domain:', domain, 'captureAll:', captureAllRequests);

  let normalizedDomain = domain;
  if (domain) {
    normalizedDomain = domain.replace(/^www\./, '').replace(/^https?:\/\//, '').split('/')[0].split(':')[0].toLowerCase();
  }

  try {
    // For window mode, attach to all tabs in the window
    if (captureAllRequests && windowId !== null) {
      windowModeActive = true;

      // Load existing data
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

      // Attach to all tabs in the specified window
      const tabs = await chrome.tabs.query({ windowId: windowId });
      let attachedCount = 0;
      for (const tab of tabs) {
        if (tab.url && !isRestrictedUrl(tab.url)) {
          try {
            await attachToTab(tab.id, null, true);
            attachedCount++;
          } catch (e) {
            console.log(`Could not attach to tab ${tab.id}:`, e.message);
          }
        }
      }

      if (attachedCount === 0) {
        throw new Error('No valid tabs found to record. Please open a normal webpage (http:// or https://).');
      }

      await updateRecordingState(true, 'window', windowId, null, true);
      console.log(`Window mode recording started - attached to ${attachedCount} tabs`);
      return;
    }

    // Regular tab-specific recording
    if (tabId !== null) {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && isRestrictedUrl(tab.url)) {
        const error = 'Cannot record on this page. Please navigate to a normal website (http:// or https://).';
        await updateRecordingState(false, domain, tabId, error, captureAllRequests);
        throw new Error(error);
      }

      await attachToTab(tabId, normalizedDomain, captureAllRequests);
      await updateRecordingState(true, normalizedDomain, tabId, null, captureAllRequests);
      console.log(`Recording started. Capture All: ${captureAllRequests}`);
    }
  } catch (err) {
    await updateRecordingState(false, domain, tabId || windowId, err.message, captureAllRequests);
    throw err;
  }
}

function isRestrictedUrl(url) {
  const restricted = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'devtools://'];
  return restricted.some(r => url.startsWith(r));
}

async function attachToTab(tabId, domain, captureAllRequests) {
  if (attachedTabs.has(tabId)) {
    const existing = attachedTabs.get(tabId);
    existing.domain = domain;
    existing.captureAllRequests = captureAllRequests;
    attachedTabs.set(tabId, existing);
    return;
  }

  const debuggee = { tabId };
  try {
    await attachDebugger(debuggee, "1.3");
  } catch (e) {
    if (!e.message.includes("Already attached")) {
      throw e;
    }
  }

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

  await sendCommand(debuggee, "Network.enable", {
    maxResourceBufferSize: 100 * 1024 * 1024,
    maxPostDataSize: 100 * 1024 * 1024
  });
  await sendCommand(debuggee, "Network.setCacheDisabled", { cacheDisabled: true });
  await sendCommand(debuggee, "Runtime.enable");

  const session = {
    domain: domain,
    captureAllRequests: captureAllRequests,
    requests: new Map(),
    websockets: new Map()
  };
  attachedTabs.set(tabId, session);
}

// Listen for new tabs in window mode
chrome.tabs.onCreated.addListener(async (tab) => {
  if (windowModeActive && tab.id) {
    // Wait a bit for the tab to initialize
    setTimeout(async () => {
      try {
        const updatedTab = await chrome.tabs.get(tab.id);
        if (updatedTab.url && !isRestrictedUrl(updatedTab.url)) {
          await attachToTab(tab.id, null, true);
        }
      } catch (e) {
        console.log('Could not attach to new tab:', e.message);
      }
    }, 1000);
  }
});

// Listen for tab updates in window mode
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (windowModeActive && changeInfo.url) {
    if (!isRestrictedUrl(changeInfo.url) && !attachedTabs.has(tabId)) {
      try {
        await attachToTab(tabId, null, true);
      } catch (e) {
        console.log('Could not attach to updated tab:', e.message);
      }
    }
  }
});

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
  windowModeActive = false;

  // Detach from all tabs
  const tabsToDetach = Array.from(attachedTabs.keys());
  for (const tid of tabsToDetach) {
    try {
      await new Promise((resolve) => chrome.debugger.detach({ tabId: tid }, resolve));
    } catch (err) {
      console.log('Error detaching from tab:', err);
    }
    attachedTabs.delete(tid);
  }

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

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!attachedTabs.has(tabId)) return;
  const session = attachedTabs.get(tabId);

  if (method === "Network.requestWillBeSent") handleRequest(tabId, params, session);
  else if (method === "Network.responseReceived") handleResponse(tabId, params, session);
  else if (method === "Network.loadingFinished") handleFinished(tabId, params, session);
  else if (method === "Network.loadingFailed") handleFailed(tabId, params, session);
  else if (method === "Network.webSocketCreated") handleWebSocketCreated(tabId, params, session);
  else if (method === "Network.webSocketWillSendHandshakeRequest") handleWebSocketHandshakeRequest(tabId, params, session);
  else if (method === "Network.webSocketHandshakeResponseReceived") handleWebSocketHandshakeResponse(tabId, params, session);
  else if (method === "Network.webSocketFrameSent") handleWebSocketFrameSent(tabId, params, session);
  else if (method === "Network.webSocketFrameReceived") handleWebSocketFrameReceived(tabId, params, session);
  else if (method === "Network.webSocketClosed") handleWebSocketClosed(tabId, params, session);
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (attachedTabs.has(source.tabId)) {
    const session = attachedTabs.get(source.tabId);

    // Mark all WebSockets from this tab as closed
    for (const [requestId, wsEntry] of session.websockets) {
      if (wsEntry.readyState !== 3) { // Not already closed
        wsEntry.status = 'closed';
        wsEntry.readyState = 3;
        wsEntry.endTime = Date.now();
        updateWsStorage(wsEntry);
      }
    }

    attachedTabs.delete(source.tabId);
    // Only stop recording if no tabs are attached and not in window mode
    if (attachedTabs.size === 0 && !windowModeActive) {
      chrome.storage.local.set({ isRecording: false });
    }
  }
});

function handleRequest(tabId, params, session) {
  const { requestId, request, type } = params;
  const url = request.url;

  const isXhrOrFetch = type === 'XHR' || type === 'Fetch' || type === 'WebSocket';
  const isStaticType = ['Image', 'Stylesheet', 'Font', 'Media', 'Manifest', 'TextTrack', 'Ping', 'CSPViolationReport', 'Other'].includes(type);
  const urlLower = url.toLowerCase();
  const isStaticExtension = /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff|css|woff|woff2|ttf|eot|otf|mp4|webm|mp3|wav|json|map)$/.test(urlLower.split('?')[0]);

  if ((isStaticType || isStaticExtension) && !isXhrOrFetch) return;

  if (!session.captureAllRequests && session.domain) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
      let targetDomain = session.domain.replace(/^www\./, '').toLowerCase();

      if (!matchesDomainOrSubdomain(hostname, targetDomain) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        const method = (request.method || 'GET').toUpperCase();
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

function handleWebSocketCreated(tabId, params, session) {
  const { requestId, url } = params;
  const wsEntry = {
    id: requestId,
    url: url,
    type: 'websocket',
    timestamp: new Date().toISOString(),
    startTime: Date.now(),
    status: 'connecting',
    readyState: 0, // CONNECTING
    frames: [],
    tabId: tabId // Store tab ID for sending messages
  };
  session.websockets.set(requestId, wsEntry);
  updateWsStorage(wsEntry);

  if (collectedData.apiCalls.length > 10000) collectedData.apiCalls.shift();

  if (isJavaScriptFile(entry.type, entry.url)) {
    const urlObj = new URL(entry.url);
    const domain = urlObj.hostname;
    if (!collectedData.jsFiles[domain]) collectedData.jsFiles[domain] = {};
    collectedData.jsFiles[domain][entry.url] = { url: entry.url, type: entry.type, lastSeen: new Date().toISOString() };
  }

  chrome.storage.local.set({ collectedData });
}

// Function to send WebSocket messages
async function sendWebSocketMessage(tabId, requestId, message) {
  console.log('Attempting to send WebSocket message:', { tabId, requestId, message });

  if (!attachedTabs.has(tabId)) {
    throw new Error('Tab is not being recorded. Please start recording first.');
  }

  const session = attachedTabs.get(tabId);
  const wsEntry = session.websockets.get(requestId);

  if (!wsEntry) {
    throw new Error('WebSocket connection not found in active session.');
  }

  // Relaxed check: Allow sending if readyState is 1 OR status is 'connected'
  if (wsEntry.readyState !== 1 && wsEntry.status !== 'connected') {
    throw new Error(`WebSocket is ${wsEntry.status}. Can only send messages when connection is open.`);
  }

  try {
    // Send the WebSocket frame using Chrome DevTools Protocol
    await sendCommand({ tabId }, "Network.sendWebSocketFrame", {
      requestId: requestId,
      data: message
    });

    console.log('WebSocket message sent successfully');

    // Add the sent message to frames (it will also be captured by handleWebSocketFrameSent)
    wsEntry.frames.push({
      type: 'send',
      data: message,
      time: new Date().toISOString(),
      timestamp: Date.now(),
      manual: true // Mark as manually sent
    });
    updateWsStorage(wsEntry);

  } catch (error) {
    console.error('Failed to send WebSocket message:', error);
    throw new Error('Failed to send message: ' + error.message);
  }
}

// Listen for tab closures to update WebSocket status
chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) {
    const session = attachedTabs.get(tabId);

    // Mark all WebSockets from this tab as closed
    for (const [requestId, wsEntry] of session.websockets) {
      if (wsEntry.readyState !== 3) { // Not already closed
        wsEntry.status = 'closed';
        wsEntry.readyState = 3;
        wsEntry.endTime = Date.now();
        updateWsStorage(wsEntry);
      }
    }
  }
});

function updateWsStorage(entry) {
  if (!collectedData.webSockets) collectedData.webSockets = [];

  const index = collectedData.webSockets.findIndex(w => w.id === entry.id);
  if (index !== -1) collectedData.webSockets[index] = entry;
  else collectedData.webSockets.push(entry);

  if (collectedData.webSockets.length > 1000) collectedData.webSockets.shift();

  chrome.storage.local.set({ collectedData });
}