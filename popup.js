// IndexedDB storage module loaded via script tag and available as StorageDB global

const setupView = document.getElementById('setupView');
const recordingView = document.getElementById('recordingView');
const statusBadge = document.getElementById('statusBadge');
const customUrl = document.getElementById('customUrl');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const dashboardBtn = document.getElementById('dashboardBtn');
const includeSubdomains = document.getElementById('includeSubdomains');
const targetInfo = document.getElementById('targetInfo');
const recordingTarget = document.getElementById('recordingTarget');
const apiCountEl = document.getElementById('apiCount');
const jsCountEl = document.getElementById('jsCount');
const currentUrlDisplay = document.getElementById('currentUrlDisplay');
const customUrlSection = document.getElementById('customUrlSection');
const currentTabSection = document.getElementById('currentTabSection');
const optionsSection = document.getElementById('optionsSection');
const subdomainWrapper = document.getElementById('subdomainWrapper');
const openAutomatically = document.getElementById('openAutomatically');
const radioButtons = document.getElementsByName('targetMode');

let currentMode = 'custom';
let currentActiveTab = null;
let statsInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize StorageDB
  try {
    await StorageDB.init();
  } catch (e) {
    console.error('[Popup] StorageDB init failed:', e);
  }

  await checkRecordingStatus();
  setupEventListeners();
  getCurrentTab();
  setupStorageListener();
  const checkedRadio = document.querySelector('input[name="targetMode"]:checked');
  if (checkedRadio) {
    handleModeChange(checkedRadio.value);
  }
});

function setupStorageListener() {
  // Listen for IndexedDB changes
  StorageDB.addChangeListener((changes) => {
    if (changes.isRecording) {
      checkRecordingStatus();
    }
    if (changes.lastError && changes.lastError.newValue) {
      alert('Recording error: ' + changes.lastError.newValue);
    }
  });
}

function setupEventListeners() {
  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      handleModeChange(e.target.value);
    });
  });
  customUrl.addEventListener('input', updateTargetInfo);
  includeSubdomains.addEventListener('change', updateTargetInfo);
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
  dashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/pages/httprequestpage.html') });
  });
}

function handleModeChange(mode) {
  currentMode = mode;
  customUrlSection.classList.add('hidden');
  currentTabSection.classList.add('hidden');
  subdomainWrapper.style.display = 'flex';
  if (mode === 'custom') {
    customUrlSection.classList.remove('hidden');
  } else if (mode === 'current') {
    currentTabSection.classList.remove('hidden');
    getCurrentTab();
  } else if (mode === 'window') {
    currentTabSection.classList.remove('hidden');
    subdomainWrapper.style.display = 'none';
    getCurrentTab();
  }
  updateTargetInfo();
}

function getCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentActiveTab = tabs[0];
      if (currentActiveTab.url && (currentActiveTab.url.startsWith('http') || currentActiveTab.url.startsWith('file'))) {
        currentUrlDisplay.textContent = truncateText(currentActiveTab.url, 45);
        currentUrlDisplay.style.color = 'var(--accent-primary)';
      } else if (currentMode === 'window') {
        currentUrlDisplay.textContent = truncateText(currentActiveTab.url || 'Unknown URL', 45);
        currentUrlDisplay.style.color = 'var(--text-secondary)';
      } else {
        currentUrlDisplay.textContent = 'Invalid URL';
        currentUrlDisplay.style.color = 'var(--danger)';
      }
      updateTargetInfo();
    }
  });
}

function getTargetUrl() {
  if (currentMode === 'custom') {
    return customUrl.value;
  } else if (currentMode === 'current' || currentMode === 'window') {
    return currentActiveTab ? currentActiveTab.url : '';
  }
  return '';
}

function updateTargetInfo() {
  const url = getTargetUrl();
  if (!url && currentMode !== 'window') {
    targetInfo.classList.add('hidden');
    return;
  }
  try {
    let infoText = '';
    if (currentMode === 'window') {
      infoText = 'Target: Whole Window (All Requests from Current Tab)';
    } else if (url) {
      const hostname = new URL(url).hostname;
      const baseDomain = hostname.replace(/^www\./, '');
      const subText = includeSubdomains.checked ? '(+subs)' : '';
      infoText = `Target: ${baseDomain} ${subText}`;
    }
    if (infoText) {
      targetInfo.textContent = infoText;
      targetInfo.classList.remove('hidden');
    } else {
      targetInfo.classList.add('hidden');
    }
  } catch (e) {
    if (currentMode === 'window') {
      targetInfo.textContent = 'Target: Whole Window (All Requests)';
      targetInfo.classList.remove('hidden');
    } else {
      targetInfo.textContent = 'Invalid URL';
      targetInfo.classList.remove('hidden');
    }
  }
}

// async function startRecording() {
//   let url = getTargetUrl();
//   let captureAll = (currentMode === 'window');
//   if (currentMode === 'custom' && !url) {
//     alert('Please enter a valid URL');
//     return;
//   }
//   if ((currentMode === 'current' || currentMode === 'window') && !currentActiveTab) {
//     alert('No active tab found');
//     return;
//   }
//   if (currentMode === 'current' || (currentMode === 'custom' && !openAutomatically.checked)) {
//     if (currentActiveTab && currentActiveTab.url) {
//       const restricted = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'https://chrome.google.com/webstore', 'https://microsoftedge.microsoft.com/addons'];
//       if (restricted.some(r => currentActiveTab.url.startsWith(r))) {
//         alert('Cannot record on this page. Chrome restricts extensions from scripting privileged pages (like settings, extensions, or web store). Please switch to a normal web page.');
//         return;
//       }
//     }
//   }
//   let hostname;
//   try {
//     if (url) {
//       hostname = new URL(url).hostname.replace(/^www\./, '');
//     }
//   } catch (e) {
//     if (currentMode !== 'window') {
//       alert('Invalid URL format');
//       return;
//     }
//   }
//   startBtn.disabled = true;
//   startBtn.textContent = 'Starting...';
//   try {
//     let targetTabId;
//     let domain = hostname;
//     if (currentMode === 'custom') {
//       const shouldOpen = openAutomatically.checked;
//       if (shouldOpen) {
//         const tab = await chrome.tabs.create({ url: url, active: false });
//         targetTabId = tab.id;
//       } else {
//         if (!currentActiveTab) throw new Error('No active tab to attach to');
//         targetTabId = currentActiveTab.id;
//       }
//     } else {
//       targetTabId = currentActiveTab.id;
//     }
//     chrome.runtime.sendMessage({
//       action: 'startRecording',
//       tabId: targetTabId,
//       domain: domain,
//       captureAllRequests: captureAll
//     }, async (response) => {
//       if (chrome.runtime.lastError) {
//         console.error('Runtime Error:', chrome.runtime.lastError);
//         resetStartBtn();
//         alert('Error: ' + chrome.runtime.lastError.message);
//         return;
//       }
//       if (response && response.success) {
//         console.log('Recording started successfully');
//         if (currentMode === 'custom' && openAutomatically.checked && targetTabId) {
//           await new Promise(resolve => setTimeout(resolve, 100));
//           chrome.tabs.update(targetTabId, { active: true });
//         }
//         setTimeout(async () => {
//           await checkRecordingStatus();
//           const status = await chrome.storage.local.get(['isRecording']);
//           if (!status.isRecording) {
//             resetStartBtn();
//           }
//         }, 200);
//       } else {
//         resetStartBtn();
//         alert('Failed to start recording: ' + (response?.error || 'Unknown error'));
//       }
//     });
//   } catch (e) {
//     resetStartBtn();
//     alert('Failed to start: ' + e.message);
//   }
// }

async function startRecording() {
  let url = getTargetUrl();
  let captureAll = (currentMode === 'window');

  // For custom mode without URL
  if (currentMode === 'custom' && !url) {
    alert('Please enter a valid URL');
    return;
  }

  // For window mode, we don't need a specific URL or tab validation
  if (currentMode === 'window') {
    // No tab validation needed for window mode
  } else {
    // For current and custom modes, check active tab
    if ((currentMode === 'current' || currentMode === 'window') && !currentActiveTab) {
      alert('No active tab found');
      return;
    }

    // Only validate restricted pages for non-window modes
    if (currentMode === 'current' || (currentMode === 'custom' && !openAutomatically.checked)) {
      if (currentActiveTab && currentActiveTab.url) {
        const restricted = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'https://chrome.google.com/webstore', 'https://microsoftedge.microsoft.com/addons'];
        if (restricted.some(r => currentActiveTab.url.startsWith(r))) {
          alert('Cannot record on this page. Chrome restricts extensions from scripting privileged pages (like settings, extensions, or web store). Please switch to a normal web page.');
          return;
        }
      }
    }
  }

  let hostname;
  try {
    if (url) {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    }
  } catch (e) {
    if (currentMode !== 'window') {
      alert('Invalid URL format');
      return;
    }
  }

  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';

  try {
    let targetTabId;
    let domain = hostname;

    if (currentMode === 'window') {
      // For window mode, use the current window ID
      // Background script will handle attaching to all tabs
      const windows = await chrome.windows.getCurrent();
      targetTabId = windows.id; // Pass window ID instead of tab ID
      domain = null; // No domain filtering for window mode
    } else if (currentMode === 'custom') {
      const shouldOpen = openAutomatically.checked;
      if (shouldOpen) {
        const tab = await chrome.tabs.create({ url: url, active: false });
        targetTabId = tab.id;
      } else {
        if (!currentActiveTab) throw new Error('No active tab to attach to');
        targetTabId = currentActiveTab.id;
      }
    } else {
      targetTabId = currentActiveTab.id;
    }

    chrome.runtime.sendMessage({
      action: 'startRecording',
      tabId: targetTabId,
      domain: domain,
      captureAllRequests: captureAll
    }, async (response) => {
      if (chrome.runtime.lastError) {
        console.error('Runtime Error:', chrome.runtime.lastError);
        resetStartBtn();
        alert('Error: ' + chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('Recording started successfully');
        if (currentMode === 'custom' && openAutomatically.checked && targetTabId) {
          await new Promise(resolve => setTimeout(resolve, 100));
          chrome.tabs.update(targetTabId, { active: true });
        }

        setTimeout(async () => {
          await checkRecordingStatus();
          const status = await chrome.storage.local.get(['isRecording']);
          if (!status.isRecording) {
            resetStartBtn();
          }
        }, 200);
      } else {
        resetStartBtn();
        alert('Failed to start recording: ' + (response?.error || 'Unknown error'));
      }
    });
  } catch (e) {
    resetStartBtn();
    alert('Failed to start: ' + e.message);
  }
}

function resetStartBtn() {
  startBtn.disabled = false;
  startBtn.textContent = 'Start Recording';
}

async function stopRecording() {
  const recordingTabId = await StorageDB.getSetting('recordingTabId');
  if (recordingTabId) {
    chrome.runtime.sendMessage({ action: 'stopRecording', tabId: recordingTabId });
  }
  await StorageDB.setSetting('isRecording', false);
  updateUIState(false);
}

async function checkRecordingStatus() {
  const settings = await StorageDB.getSettings(['isRecording', 'targetDomain', 'captureAllRequests']);
  if (settings.isRecording) {
    updateUIState(true, settings.targetDomain, settings.captureAllRequests);
  } else {
    updateUIState(false);
  }
}

function updateUIState(isRecording, domain = '', captureAllRequests = false) {
  if (isRecording) {
    setupView.classList.add('hidden');
    recordingView.classList.remove('hidden');
    statusBadge.textContent = 'Recording';
    statusBadge.className = 'status-badge recording';
    if (captureAllRequests) {
      recordingTarget.textContent = 'Whole Window';
    } else {
      recordingTarget.textContent = truncateText(domain || 'Unknown Domain', 25);
    }
    startBtn.disabled = false;
    startBtn.textContent = 'Start Recording';
    startStatsInterval();
  } else {
    setupView.classList.remove('hidden');
    recordingView.classList.add('hidden');
    statusBadge.textContent = 'Stopped';
    statusBadge.className = 'status-badge stopped';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Recording';
    stopStatsInterval();
  }
}

function startStatsInterval() {
  updateStats();
  statsInterval = setInterval(updateStats, 1000);
}

function stopStatsInterval() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

async function updateStats() {
  try {
    const stats = await StorageDB.getStats();
    // Format numbers nicely (e.g. 1.2k) if they get large
    apiCountEl.textContent = stats.apiCallsCount || 0;

    // In the new layout, this card is labeled "WebSockets", so we show WS count
    jsCountEl.textContent = stats.webSocketsCount || 0;
  } catch (e) {
    console.error('Stats update failed:', e);
  }
}

// Utility to truncate long URLs to prevent layout overflow
function truncateText(text, maxLength = 35) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Update UI Text helper
function safeSetText(elementId, text) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = truncateText(text);
}
