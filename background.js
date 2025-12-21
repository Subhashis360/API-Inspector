// Import IndexedDB storage module
importScripts('src/indexeddb.js');

const attachedTabs = new Map();
// REMOVED: large in-memory collectedData object. We rely on IndexedDB + small cache for active WebSocket control.
let collectedData = { webSockets: [] }; // Only keep minimum needed for WS control
let windowModeActive = false;
let deletedWebSocketIds = new Set();
// Optimized Tracking BlockList (Regex is faster than array.some + includes)
const TRACKING_REGEX = new RegExp(
  [
    'google-analytics', 'googletagmanager', 'g\\.doubleclick', 'googleads', 'doubleclick', 'facebook\\.com/tr',
    'analytics', 'telemetry', 'pixel', 'tracker', 'tracking',
    'firebase', 'fcm\\.googleapis', 'onesignal', 'braze',
    'segment', 'mixpanel', 'amplitude', 'adjust', 'appsflyer', 'heapanalytics',
    'hotjar', 'clarity', 'sentry', 'newrelic', 'datadog',
    'collect', 'measure', 'beacon',
    'notifyvisitors', 'clevertap', 'heatmaps', 'event-api', 'google\\.com/xjs', 'gstatic\\.com/_/mss', 'connect\\.facebook\\.net/signals'
  ].join('|'), 'i'
);

// --- STATE RESTORATION FOR EXTENSION RESTARTS (Manfiest V3) ---
async function restoreState() {
  try {
    const saved = await StorageDB.getSetting('activeSessions');
    if (saved && Array.isArray(saved)) {
      console.log('[Background] Restoring active sessions:', saved.length);
      for (const session of saved) {
        if (!attachedTabs.has(session.tabId)) {
          // Re-hydrate session object
          attachedTabs.set(session.tabId, {
            domain: session.domain,
            captureAllRequests: session.captureAllRequests,
            requests: new Map(), // Start fresh for in-memory requests map (ok since we store to DB)
            websockets: new Map()
          });

          // Re-arm debugger if needed? 
          // Usually debugger stays attached, we just lost our local map.
          // We can Verify attachment:
          chrome.debugger.getTargets((targets) => {
            const isAttached = targets.some(t => t.tabId === session.tabId && t.attached);
            if (!isAttached) {
              console.warn(`[Background] Tab ${session.tabId} was marked active but is not attached. Cleaning up.`);
              attachedTabs.delete(session.tabId);
              saveSessionState();
            }
          });
        }
      }
    }

    // Restore window mode state
    const winState = await StorageDB.getSetting('windowModeActive');
    windowModeActive = !!winState;

  } catch (e) {
    console.error('Failed to restore state:', e);
  }
}

// Save current attachedTabs state to DB
async function saveSessionState() {
  const sessions = [];
  for (const [tabId, data] of attachedTabs) {
    sessions.push({
      tabId,
      domain: data.domain,
      captureAllRequests: data.captureAllRequests
    });
  }
  await StorageDB.setSetting('activeSessions', sessions);
  await StorageDB.setSetting('windowModeActive', windowModeActive);
}

// Init
chrome.runtime.onStartup.addListener(restoreState);
// Also run immediately in case of update/reload
restoreState();


function isJavaScriptFile(type, url) {
  if (!url) return false;
  // Fast path
  if (type === 'Script') return true;
  const u = url.split('?')[0].toLowerCase(); // ignore params for extension check
  return u.endsWith('.js') || u.endsWith('.mjs') || u.endsWith('.jsx') ||
    url.includes('javascript:') || url.includes('/script');
}

function matchesDomainOrSubdomain(hostname, targetDomain) {
  if (!hostname || !targetDomain) return false;
  if (hostname === targetDomain) return true;
  return hostname.endsWith('.' + targetDomain); // Optimized simple suffix check
}

chrome.runtime.onInstalled.addListener(async () => {
  await StorageDB.setSettings({
    isRecording: false,
    lastError: null
  });
  console.log('[Background] Extension installed/updated, IndexedDB initialized');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request.action || '';

  if (action === 'startRecording') {
    doStartRecording(request.windowId, request.tabId, request.domain, request.captureAllRequests)
      .then(() => sendResponse({ success: true, status: 'started' }))
      .catch((error) => sendResponse({ success: false, error: (error.message || error) }));
    return true;
  }
  if (action === 'stopRecording') {
    doStopRecording(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: (error.message || error) }));
    return true;
  }
  if (action === 'clearData') {
    clearAllData()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (action === 'deleteWebSocket') {
    deleteWebSocket(request.requestId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false; // let other listeners handle if any
});

async function updateStorage(entry) {
  // Direct to IndexedDB, bypass memory cache
  await StorageDB.addApiCall(entry);
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

      // Load existing data from IndexedDB
      collectedData = await StorageDB.getCollectedData();
      if (!collectedData.apiCalls) collectedData.apiCalls = [];
      if (!collectedData.jsFiles) collectedData.jsFiles = {};
      if (!collectedData.webSockets) collectedData.webSockets = [];

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

  // Load existing data from IndexedDB
  collectedData = await StorageDB.getCollectedData();
  if (!collectedData.apiCalls) collectedData.apiCalls = [];
  if (!collectedData.jsFiles) collectedData.jsFiles = {};
  if (!collectedData.webSockets) collectedData.webSockets = [];

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
  await saveSessionState(); // Persist state
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
  await StorageDB.setSettings({
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

  await saveSessionState(); // Update state
  await StorageDB.setSetting('isRecording', false);
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
    saveSessionState(); // Update state

    // Only stop recording if no tabs are attached and not in window mode
    if (attachedTabs.size === 0 && !windowModeActive) {
      StorageDB.setSetting('isRecording', false);
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

  // ULTRA-STRICT FILTER: Basic security and noise reduction
  const urlLower = url.toLowerCase();

  // Only allow http/https URLs
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.log(`[API Inspector] ❌ Blocked non-HTTP: ${url}`);
    return;
  }

  // REMOVED: Type-based filter
  // Now capturing ALL file types (JS, CSS, Images, etc.)
  // Filters control display only, not capture

  // Layer 4: Block Analytics, Tracking, and Push Notifications
  // Optimized: Use pre-compiled Regex
  if (TRACKING_REGEX.test(urlLower)) {
    // console.log(`[API Inspector] ❌ Blocked tracking/analytics: ${url}`);
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
  } else {
    // Normalize: Always strip www. prefix for consistent grouping
    requestDomain = requestDomain.replace(/^www\./, '');
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

  // Removed: IndexedDB handles storage automatically via batching
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

async function updateWsStorage(entry) {
  if (!collectedData.webSockets) collectedData.webSockets = [];

  // CRITICAL FIX: Don't re-add deleted WebSockets
  if (deletedWebSocketIds.has(String(entry.id))) {
    console.log(`[Background] Skipping update for deleted WebSocket: ${entry.id}`);
    return;
  }

  // Use IndexedDB with automatic batching
  await StorageDB.addWebSocket(entry);

  // Update in-memory cache
  const index = collectedData.webSockets.findIndex(w => w.id === entry.id);
  if (index !== -1) collectedData.webSockets[index] = entry;
  else collectedData.webSockets.push(entry);

  // Optimize memory by keeping only last 1000 WebSockets in memory
  if (collectedData.webSockets.length > 1000) collectedData.webSockets.shift();
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

  // Delete from IndexedDB
  try {
    await StorageDB.deleteWebSocket(requestId);
    console.log('[Background] Deleted from IndexedDB');
  } catch (e) {
    console.error("Error deleting from IndexedDB:", e);
  }

  // Remove from in-memory cache
  if (collectedData.webSockets) {
    const initialLength = collectedData.webSockets.length;
    collectedData.webSockets = collectedData.webSockets.filter(ws => String(ws.id) !== String(requestId));

    if (collectedData.webSockets.length < initialLength) {
      console.log('[Background] Removed from in-memory cache');
    } else {
      console.warn('[Background] ID not found in in-memory cache');
    }
  }

  // Remove from any active session
  for (const [tabId, session] of attachedTabs) {
    if (session.websockets) {
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

/**
 * Clear all collected data (API calls and WebSockets)
 */
async function clearAllData() {
  console.log('[Background] Clearing all data...');

  // Clear IndexedDB
  await StorageDB.clearAllData();

  // Clear in-memory cache
  collectedData = { apiCalls: [], jsFiles: {}, webSockets: [] };

  // Reset deleted WebSocket IDs tracking
  deletedWebSocketIds.clear();

  console.log('[Background] All data cleared successfully');
}