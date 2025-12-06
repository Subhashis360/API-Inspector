
async function deleteWebSocket(requestId) {
    // Remove from collectedData
    if (collectedData.webSockets) {
        collectedData.webSockets = collectedData.webSockets.filter(ws => ws.id !== requestId);
        await chrome.storage.local.set({ collectedData });
    }

    // Remove from any active session
    for (const [tabId, session] of attachedTabs) {
        if (session.websockets && session.websockets.has(requestId)) {
            session.websockets.delete(requestId);
        }
    }
}
