// UI Elements
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

// New UI Elements
const customUrlSection = document.getElementById('customUrlSection');
const currentTabSection = document.getElementById('currentTabSection');
const optionsSection = document.getElementById('optionsSection');
const subdomainWrapper = document.getElementById('subdomainWrapper');
const openAutomatically = document.getElementById('openAutomatically');
const radioButtons = document.getElementsByName('targetMode');

// State
let currentMode = 'custom';
let currentActiveTab = null;
let statsInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkRecordingStatus();
  setupEventListeners();
  getCurrentTab();
  setupStorageListener();

  // Initialize UI based on default checked radio
  const checkedRadio = document.querySelector('input[name="targetMode"]:checked');
  if (checkedRadio) {
    handleModeChange(checkedRadio.value);
  }
});

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRecording) {
        checkRecordingStatus();
      }
      if (changes.lastError && changes.lastError.newValue) {
        alert('Recording error: ' + changes.lastError.newValue);
      }
    }
  });
}

function setupEventListeners() {
  // Radio Button Changes
  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      handleModeChange(e.target.value);
    });
  });

  // Input Changes
  customUrl.addEventListener('input', updateTargetInfo);
  includeSubdomains.addEventListener('change', updateTargetInfo);

  // Buttons
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);

  dashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/pages/httprequestpage.html') });
  });
}

function handleModeChange(mode) {
  currentMode = mode;

  // Reset visibility
  customUrlSection.classList.add('hidden');
  currentTabSection.classList.add('hidden');
  subdomainWrapper.style.display = 'flex'; // Default visible

  // Show relevant sections
  if (mode === 'custom') {
    customUrlSection.classList.remove('hidden');
  } else if (mode === 'current') {
    currentTabSection.classList.remove('hidden');
    getCurrentTab();
  } else if (mode === 'window') {
    currentTabSection.classList.remove('hidden'); // Show current tab info as base
    subdomainWrapper.style.display = 'none'; // Hide subdomains option for whole window
    getCurrentTab();
  }

  updateTargetInfo();
}

function getCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentActiveTab = tabs[0];
      if (currentActiveTab.url && (currentActiveTab.url.startsWith('http') || currentActiveTab.url.startsWith('file'))) {
        currentUrlDisplay.textContent = currentActiveTab.url;
        currentUrlDisplay.style.color = 'var(--accent-primary)';
      } else {
        currentUrlDisplay.textContent = 'Invalid URL (must be http/https/file)';
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
      const subText = includeSubdomains.checked ? 'and all subdomains' : '(exact domain only)';
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

async function startRecording() {
  let url = getTargetUrl();
  let captureAll = (currentMode === 'window');

  // Validation
  if (currentMode === 'custom' && !url) {
    alert('Please enter a valid URL');
    return;
  }

  if ((currentMode === 'current' || currentMode === 'window') && !currentActiveTab) {
    alert('No active tab found');
    return;
  }

  // Check for restricted URLs if we are using the current tab
  if (currentMode === 'current' || currentMode === 'window' || (currentMode === 'custom' && !openAutomatically.checked)) {
    if (currentActiveTab && currentActiveTab.url) {
      const restricted = [
        'chrome://',
        'edge://',
        'about:',
        'chrome-extension://',
        'https://chrome.google.com/webstore',
        'https://microsoftedge.microsoft.com/addons'
      ];
      if (restricted.some(r => currentActiveTab.url.startsWith(r))) {
        alert('Cannot record on this page. Chrome restricts extensions from scripting privileged pages (like settings, extensions, or web store). Please switch to a normal web page.');
        return;
      }
    }
  }

  let hostname;
  try {
    // If window mode, we might not need a valid URL if we just capture everything, 
    // but usually we still want to know where we are.
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

    if (currentMode === 'custom') {
      const shouldOpen = openAutomatically.checked;

      if (shouldOpen) {
        // Create new tab
        const tab = await chrome.tabs.create({ url: url, active: true });
        targetTabId = tab.id;
        // Wait for tab to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Use current tab but filter for the custom domain
        if (!currentActiveTab) throw new Error('No active tab to attach to');
        targetTabId = currentActiveTab.id;
        // Note: We don't navigate, just attach and filter
      }
    } else {
      // Current or Window mode
      targetTabId = currentActiveTab.id;
    }

    // Send message to background
    chrome.runtime.sendMessage({
      action: 'startRecording',
      tabId: targetTabId,
      domain: domain, // Can be undefined for window mode if we want, but background handles it
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
        // Wait for storage update
        setTimeout(async () => {
          await checkRecordingStatus();
          const status = await chrome.storage.local.get(['isRecording']);
          if (!status.isRecording) {
            resetStartBtn();
          }
        }, 500);
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
  const result = await chrome.storage.local.get(['recordingTabId']);
  if (result.recordingTabId) {
    chrome.runtime.sendMessage({ action: 'stopRecording', tabId: result.recordingTabId });
  }
  await chrome.storage.local.set({ isRecording: false });
  updateUIState(false);
}

async function checkRecordingStatus() {
  const result = await chrome.storage.local.get(['isRecording', 'targetDomain', 'captureAllRequests']);
  if (result.isRecording) {
    updateUIState(true, result.targetDomain, result.captureAllRequests);
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
      recordingTarget.textContent = domain || 'Unknown Domain';
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
  const result = await chrome.storage.local.get(['collectedData']);
  const data = result.collectedData || { jsFiles: {}, apiCalls: [] };

  apiCountEl.textContent = data.apiCalls ? data.apiCalls.length : 0;
  jsCountEl.textContent = countJSFiles(data.jsFiles);
}

function countJSFiles(jsFiles) {
  if (!jsFiles) return 0;
  let count = 0;
  function traverse(obj) {
    for (const key in obj) {
      if (obj[key] && obj[key].url) {
        count++;
      } else if (typeof obj[key] === 'object') {
        traverse(obj[key]);
      }
    }
  }
  traverse(jsFiles);
  return count;
}