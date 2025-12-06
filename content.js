// Minimal content script - Only used for WebSocket instance storage
// All HTTP request capture is handled by background.js via Chrome DevTools Protocol

let isRecording = false;
let targetDomain = '';

// Check recording status on load
chrome.runtime.sendMessage({ action: 'getRecordingStatus' }, (response) => {
  if (response && response.isRecording) {
    isRecording = true;
    targetDomain = response.targetDomain;
    interceptWebSockets();
  }
});

// Listen for recording state changes
// Listen for recording state changes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    isRecording = true;
    targetDomain = request.targetDomain;
    interceptWebSockets();
    sendResponse({ status: 'started' });
    return false; // Synchronous response
  } else if (request.action === 'stopRecording') {
    isRecording = false;
    sendResponse({ status: 'stopped' });
    return false; // Synchronous response
  } else if (request.action === 'getStatus') {
    sendResponse({ isRecording, targetDomain });
    return false; // Synchronous response
  }
  // Important: Do not return true unconditionally, providing no response.
  return false;
});

// WebSocket interception - stores instances for replay functionality
function interceptWebSockets() {
  if (window.WebSocket.__intercepted) return; // Already intercepted

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);

    // Store the WebSocket instance globally for replay (used by background.js sendWebSocketMessage)
    if (!window.__capturedWebSockets) window.__capturedWebSockets = {};
    window.__capturedWebSockets[url] = ws;

    // Cleanup on close
    ws.addEventListener('close', function () {
      if (window.__capturedWebSockets && window.__capturedWebSockets[url] === ws) {
        delete window.__capturedWebSockets[url];
      }
    });

    return ws;
  };

  window.WebSocket.__intercepted = true;
}

console.log('API Inspector content script loaded');