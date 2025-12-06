let attachedTabs = new Map();
let collectedData = { jsFiles: {}, apiCalls: [], webSockets: [] };
let windowModeActive = false; // Track if window mode is active
let deletedWebSocketIds = new Set(); // Track deleted WebSocket IDs to prevent re-adding

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
  console.log('[Background] Message received:', JSON.stringify(request));

  const action = request.action ? request.action.trim() : '';

  if (action === 'startRecording') {
    doStartRecording(request.windowId, request.tabId, request.domain, request.captureAllRequests)
      .then(() => sendResponse({ success: true, status: 'started' }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (action === 'stopRecording') {
    doStopRecording(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (action === 'clearData') {
    collectedData = { apiCalls: [], jsFiles: {}, webSockets: [] };
    deletedWebSocketIds.clear(); // Reset deleted IDs tracking
    chrome.storage.local.set({ collectedData });
    sendResponse({ success: true });
    return false;
  }
  if (action === 'deleteWebSocket') {
    deleteWebSocket(request.requestId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Catch-all for unknown actions to aid debugging
  console.warn('[Background] Unknown action received:', request.action);
  // Log char codes to detect hidden characters
  if (request.action) {
    console.warn('Action char codes:', request.action.split('').map(c => c.charCodeAt(0)));
  }
  sendResponse({ success: false, error: 'Unknown action: ' + request.action });
  return false;
});



function updateStorage(entry) {
  if (!collectedData.apiCalls) collectedData.apiCalls = [];

  // Check if entry exists
  const index = collectedData.apiCalls.findIndex(req => req.id === entry.id);
  if (index !== -1) {
    collectedData.apiCalls[index] = entry;
  } else {
    collectedData.apiCalls.push(entry);
  }

  // Optimize storage by keeping only last 2000 requests
  if (collectedData.apiCalls.length > 2000) {
    collectedData.apiCalls.shift();
  }

  chrome.storage.local.set({ collectedData });
}

// Helper to get hostname safely
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

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
        const urlToUse = tab.url || tab.pendingUrl;
        if (urlToUse && !isRestrictedUrl(urlToUse)) {
          console.log(`Attaching to tab: ${urlToUse}`);
          try {
            // Pass the tab's hostname as the domain (source)
            const tabHost = getHostname(urlToUse);
            await attachToTab(tab.id, tabHost, true);
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
      const urlToUse = tab.url || tab.pendingUrl;
      if (tab && urlToUse && isRestrictedUrl(urlToUse)) {
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
  if (!url) return true;
  const restricted = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'devtools://'];
  return restricted.some(r => url.startsWith(r));
}

async function attachToTab(tabId, domain, captureAllRequests) {
  if (attachedTabs.has(tabId)) {
    const existing = attachedTabs.get(tabId);
    if (domain) existing.domain = domain; // Update domain if provided
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
        const urlToUse = updatedTab.url || updatedTab.pendingUrl;
        if (urlToUse && !isRestrictedUrl(urlToUse)) {
          const tabHost = getHostname(urlToUse);
          await attachToTab(tab.id, tabHost, true);
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
    if (!isRestrictedUrl(changeInfo.url)) {
      try {
        const tabHost = getHostname(changeInfo.url);
        // Always update attachment to capture new domain info if navigation happened
        await attachToTab(tabId, tabHost, true);
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

async function handleRequest(tabId, params, session) {
  const { requestId, request, type } = params;
  const url = request.url;

  // Lazy update: If session domain is missing, try to fetch it now
  if (!session.domain) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const urlToUse = tab.url || tab.pendingUrl;
      if (urlToUse) {
        const host = getHostname(urlToUse);
        if (host) {
          session.domain = host;
          console.log(`Late-updated domain for tab ${tabId}: ${host}`);
        }
      }
    } catch (e) { }
  }

  // ULTRA-STRICT FILTER: ONLY capture XHR, Fetch, WebSocket requests
  const urlLower = url.toLowerCase();

  // Only allow http/https URLs
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.log(`[API Inspector] ❌ Blocked non-HTTP: ${url}`);
    return;
  }

  // ONLY allow XHR, Fetch, and WebSocket types - block EVERYTHING else
  if (type !== 'XHR' && type !== 'Fetch' && type !== 'WebSocket') {
    console.log(`[API Inspector] ❌ Blocked type ${type}: ${url}`);
    return;
  }

  // Additional safety: Block static file extensions
  const staticExtensions = /\.(png|jpg|jpeg|gif|svg|wasm|ico|webp|bmp|css|woff|woff2|ttf|eot|otf|mp4|webm|ogg|mp3|wav|flac|aac|json|xml|js|mjs|jsx|ts|tsx|map|pdf|zip|rar|tar|gz|7z)$/i;
  if (staticExtensions.test(urlLower.split('?')[0])) {
    console.log(`[API Inspector] ❌ Blocked extension: ${url}`);
    return;
  }

  // Block static asset paths
  const staticPaths = /\/(images?|img|assets|static|media|fonts?|css|styles?|js|javascripts?|scripts?|icons?|files?)\//i;
  if (staticPaths.test(urlLower)) {
    console.log(`[API Inspector] ❌ Blocked path: ${url}`);
    return;
  }

  // Layer 4: Block Analytics, Tracking, and Push Notifications
  // Blocks common services: Google Analytics, GTM, Firebase, OneSignal, Segment, Mixpanel, etc.
  // Blocks keywords: analytics, tracking, telemetry, pixel, metric, etc.
  const trackingPatterns = [
    'google-analytics', 'googletagmanager', 'g.doubleclick', 'googleads', 'doubleclick', 'facebook.com/tr',
    'analytics', 'telemetry', 'pixel', 'tracker', 'tracking',
    'firebase', 'fcm.googleapis', 'onesignal', 'braze', 'push', 'notification',
    'segment', 'mixpanel', 'amplitude', 'adjust', 'appsflyer', 'heapanalytics',
    'hotjar', 'clarity', 'sentry', 'newrelic', 'datadog',
    'collect', 'measure', 'beacon',
    // Added based on user feedback:
    'notifyvisitors', 'clevertap', 'accounts.google.com', 'heatmaps', 'event-api'
  ];

  if (trackingPatterns.some(p => urlLower.includes(p))) {
    console.log(`[API Inspector] ❌ Blocked tracking/analytics: ${url}`);
    return;
  }

  console.log(`[API Inspector] ✅ CAPTURED: ${type} - ${url}`);

  // Domain filtering
  let requestDomain = session.domain || 'Unknown';
  if (requestDomain === 'Unknown') {
    try {
      const urlObj = new URL(url);
      requestDomain = urlObj.hostname.replace(/^www\./, '');
      console.log(`[API Inspector] Using request hostname as fallback source: ${requestDomain}`);
    } catch (e) { }
  }

  if (!session.captureAllRequests && session.domain) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
      let targetDomain = session.domain.replace(/^www\./, '').toLowerCase();

      if (!matchesDomainOrSubdomain(hostname, targetDomain) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        const method = (request.method || 'GET').toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          return;
        }
      }
    } catch (e) { }
  }

  const entry = {
    id: requestId,
    url: url,
    sourceDomain: requestDomain, // Use the resolved domain
    method: (request.method || 'GET').toUpperCase(),
    type: type,
    timestamp: new Date().toISOString(),
    startTime: Date.now(),
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
    // Calculate duration
    if (entry.startTime) {
      entry.time = Date.now() - entry.startTime;
    }

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
    // Calculate time even for failed requests
    if (entry.startTime) {
      entry.time = Date.now() - entry.startTime;
    }
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



  chrome.storage.local.set({ collectedData });
}

// Function to send WebSocket messages
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
    // Attempt to send via content script hook (since Network.sendWebSocketFrame is not available)
    const expression = `
      (function() {
        try {
          if (window.__capturedWebSockets && window.__capturedWebSockets['${wsEntry.url}']) {
            window.__capturedWebSockets['${wsEntry.url}'].send('${message.replace(/'/g, "\\'")}');
            return { success: true };
          } else {
            return { success: false, error: 'WebSocket instance not found in page context' };
          }
        } catch (e) {
          return { success: false, error: e.toString() };
        }
      })()
    `;

    const result = await sendCommand({ tabId }, "Runtime.evaluate", {
      expression: expression,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error('Script evaluation failed: ' + result.exceptionDetails.text);
    }

    if (result.result && result.result.value) {
      if (!result.result.value.success) {
        throw new Error(result.result.value.error);
      }
    }

    console.log('WebSocket message sent successfully via script injection');

    // Add the sent message to frames (it will also be captured by handleWebSocketFrameSent/intercept)
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

  // CRITICAL FIX: Don't re-add deleted WebSockets
  if (deletedWebSocketIds.has(String(entry.id))) {
    console.log(`[Background] Skipping update for deleted WebSocket: ${entry.id}`);
    return;
  }

  const index = collectedData.webSockets.findIndex(w => w.id === entry.id);
  if (index !== -1) collectedData.webSockets[index] = entry;
  else collectedData.webSockets.push(entry);

  if (collectedData.webSockets.length > 1000) collectedData.webSockets.shift();

  chrome.storage.local.set({ collectedData });
}

function handleWebSocketHandshakeResponse(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.status = 'connected';
    wsEntry.readyState = 1; // OPEN
    wsEntry.handshakeResponse = response;
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketFrameSent(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry && response && response.payloadData) {
    wsEntry.frames.push({
      type: 'send',
      data: response.payloadData,
      time: new Date().toISOString(),
      timestamp: Date.now()
    });
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketFrameReceived(tabId, params, session) {
  const { requestId, response } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry && response && response.payloadData) {
    wsEntry.frames.push({
      type: 'receive',
      data: response.payloadData,
      time: new Date().toISOString(),
      timestamp: Date.now()
    });
    updateWsStorage(wsEntry);
  }
}

function handleWebSocketClosed(tabId, params, session) {
  const { requestId } = params;
  const wsEntry = session.websockets.get(requestId);
  if (wsEntry) {
    wsEntry.status = 'closed';
    wsEntry.readyState = 3; // CLOSED
    wsEntry.endTime = Date.now();
    updateWsStorage(wsEntry);
  }
}

async function deleteWebSocket(requestId) {
  console.log(`[Background] Deleting WebSocket with ID: ${requestId}`);

  // CRITICAL FIX: Mark this ID as deleted to prevent re-adding
  deletedWebSocketIds.add(String(requestId));
  console.log(`[Background] Marked WebSocket ${requestId} as deleted`);

  // FIX: Always reload collectedData from storage to ensure we have the latest state
  try {
    const stored = await chrome.storage.local.get(['collectedData']);
    if (stored.collectedData) {
      collectedData = stored.collectedData;
    }
  } catch (e) { console.error("Error fetching storage during delete:", e); }

  // Remove from collectedData
  if (collectedData.webSockets) {
    const initialLength = collectedData.webSockets.length;
    // Use String() comparison to handle both number/string IDs safely
    collectedData.webSockets = collectedData.webSockets.filter(ws => String(ws.id) !== String(requestId));

    if (collectedData.webSockets.length < initialLength) {
      console.log('[Background] Removed from collectedData');
      await chrome.storage.local.set({ collectedData });
    } else {
      console.warn('[Background] ID not found in collectedData.webSockets');
    }
  }

  // Remove from any active session
  for (const [tabId, session] of attachedTabs) {
    if (session.websockets) {
      // iterate keys to find match since Map keys might be numbers or strings
      let matchedKey = null;
      for (const key of session.websockets.keys()) {
        if (String(key) === String(requestId)) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey) {
        session.websockets.delete(matchedKey);
        console.log(`[Background] Removed from session tab ${tabId}`);
      }
    }
  }
}