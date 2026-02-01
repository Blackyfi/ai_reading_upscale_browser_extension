const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const pageImagesDetected = document.getElementById('pageImagesDetected');
const pageImagesUpscaled = document.getElementById('pageImagesUpscaled');
const pageProgressBar = document.getElementById('pageProgressBar');
const pageProgressText = document.getElementById('pageProgressText');
const pageQueueSection = document.getElementById('pageQueueSection');
const pageQueueList = document.getElementById('pageQueueList');

const cacheCount = document.getElementById('cacheCount');
const cacheSize = document.getElementById('cacheSize');
const queueSize = document.getElementById('queueSize');
const totalImagesUpscaled = document.getElementById('totalImagesUpscaled');
const avgUpscaleTime = document.getElementById('avgUpscaleTime');
const totalSessionTime = document.getElementById('totalSessionTime');
const statsHistory = document.getElementById('statsHistory');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const checkServerBtn = document.getElementById('checkServerBtn');

const toggleExtension = document.getElementById('toggleExtension');
const extensionStatus = document.getElementById('extensionStatus');
const serverStatus = document.getElementById('serverStatus');

init();

/**
 * Initialize popup
 */
function init() {
  tabBtns.forEach(btn => {
    btn.addEventListener('click', handleTabSwitch);
  });

  chrome.storage.local.get(['enabled'], (result) => {
    const enabled = result.enabled !== undefined ? result.enabled : true;
    toggleExtension.checked = enabled;
    updateExtensionStatus(enabled);
  });

  checkServer();
  loadStatistics();
  loadPageStatistics();

  toggleExtension.addEventListener('change', handleToggle);
  clearCacheBtn.addEventListener('click', handleClearCache);
  checkServerBtn.addEventListener('click', handleCheckServer);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PAGE_STATS_UPDATE') {
      updatePageStatistics(request.data);
    }
  });
}

/**
 * Handle tab switching
 */
function handleTabSwitch(event) {
  const tabName = event.target.dataset.tab;

  tabBtns.forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  tabContents.forEach(content => content.classList.remove('active'));
  document.getElementById(`${tabName}-tab`).classList.add('active');

  // Reload statistics when switching to statistics tab
  if (tabName === 'statistics') {
    loadStatistics();
  }
}

/**
 * Handle extension toggle
 */
function handleToggle() {
  const enabled = toggleExtension.checked;

  chrome.storage.local.set({ enabled });
  updateExtensionStatus(enabled);

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_EXTENSION',
        enabled
      }).catch(() => {}); // Tab might not have content script
    });
  });
}

/**
 * Update extension status display
 */
function updateExtensionStatus(enabled) {
  extensionStatus.textContent = enabled ? 'Enabled' : 'Disabled';
  extensionStatus.className = enabled ? 'status-text enabled' : 'status-text disabled';
}

/**
 * Check server status
 */
async function checkServer() {
  updateServerStatus('checking', 'Checking...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_SERVER'
    });

    if (response.success && response.available) {
      updateServerStatus('online', 'Online');
    } else {
      updateServerStatus('offline', 'Offline');
    }
  } catch (error) {
    console.error('Error checking server:', error);
    updateServerStatus('offline', 'Offline');
  }
}

/**
 * Update server status display
 */
function updateServerStatus(status, text) {
  const indicator = serverStatus.querySelector('.indicator-dot');
  const statusText = serverStatus.querySelector('.indicator-text');

  indicator.className = `indicator-dot ${status}`;
  statusText.textContent = text;
}

/**
 * Load statistics
 */
async function loadStatistics() {
  try {
    const statusResponse = await chrome.runtime.sendMessage({
      type: 'GET_STATUS'
    });

    if (statusResponse.success) {
      queueSize.textContent = statusResponse.queueSize || 0;
    }

    const response = await fetch('http://127.0.0.1:5000/stats');
    if (response.ok) {
      const data = await response.json();
      cacheCount.textContent = data.cache_count || 0;
      cacheSize.textContent = `${data.cache_size_mb || 0} MB`;
    }

    loadSessionStatistics();
    loadStatsHistory();
  } catch (error) {
    console.error('Error loading statistics:', error);
    cacheCount.textContent = '-';
    cacheSize.textContent = '-';
  }
}

/**
 * Load session statistics from storage
 */
function loadSessionStatistics() {
  chrome.storage.local.get(['sessionStats'], (result) => {
    const stats = result.sessionStats || {
      totalUpscaled: 0,
      totalTime: 0,
      upscaleTimes: [],
      sessions: []
    };

    totalImagesUpscaled.textContent = stats.totalUpscaled || 0;

    if (stats.upscaleTimes && stats.upscaleTimes.length > 0) {
      const avgTime = stats.upscaleTimes.reduce((a, b) => a + b, 0) / stats.upscaleTimes.length;
      avgUpscaleTime.textContent = avgTime.toFixed(1) + 's';
    } else {
      avgUpscaleTime.textContent = '-';
    }

    if (stats.totalTime && stats.totalTime > 0) {
      const hours = Math.floor(stats.totalTime / 3600);
      const minutes = Math.floor((stats.totalTime % 3600) / 60);
      totalSessionTime.textContent = `${hours}h ${minutes}m`;
    } else {
      totalSessionTime.textContent = '-';
    }
  });
}

/**
 * Load stats history
 */
function loadStatsHistory() {
  chrome.storage.local.get(['sessionStats'], (result) => {
    const stats = result.sessionStats || { sessions: [] };
    const sessions = stats.sessions || [];

    if (sessions.length === 0) {
      statsHistory.innerHTML = '<p class="no-stats">No statistics recorded yet</p>';
      return;
    }

    statsHistory.innerHTML = '';

    // Display last 10 sessions
    sessions.slice(-10).reverse().forEach((session) => {
      const sessionDiv = document.createElement('div');
      sessionDiv.className = 'stats-history-item';

      const date = new Date(session.timestamp).toLocaleString();
      const avgTime = session.upscaleTimes && session.upscaleTimes.length > 0
        ? (session.upscaleTimes.reduce((a, b) => a + b, 0) / session.upscaleTimes.length).toFixed(1)
        : 0;

      sessionDiv.innerHTML = `
        <div class="stats-history-date">${date}</div>
        <div class="stats-history-data">
          <div>Images upscaled: ${session.imagesUpscaled || 0}</div>
          <div>Average time: ${avgTime}s</div>
          <div>Total time: ${session.totalTime ? Math.round(session.totalTime) + 's' : '-'}</div>
          <div>From: ${session.pageUrl || 'Unknown'}</div>
        </div>
      `;

      statsHistory.appendChild(sessionDiv);
    });
  });
}

/**
 * Load page statistics
 */
function loadPageStatistics() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, {
        type: 'GET_PAGE_STATS'
      }, (response) => {
        if (response && response.success) {
          updatePageStatistics(response.stats);
        }
      }).catch(() => {
        // Content script might not be loaded
        pageImagesDetected.textContent = '0';
        pageImagesUpscaled.textContent = '0';
      });
    }
  });
}

/**
 * Update page statistics
 */
function updatePageStatistics(stats) {
  pageImagesDetected.textContent = stats.totalDetected || 0;
  pageImagesUpscaled.textContent = stats.totalUpscaled || 0;

  const total = stats.totalDetected || 1;
  const upscaled = stats.totalUpscaled || 0;
  const percentage = Math.round((upscaled / total) * 100);

  pageProgressBar.style.width = percentage + '%';
  pageProgressText.textContent = percentage + '%';

  if (stats.queue && stats.queue.length > 0) {
    pageQueueSection.style.display = 'block';
    renderPageQueue(stats.queue);
  } else {
    pageQueueSection.style.display = 'none';
  }
}

/**
 * Render page queue
 */
function renderPageQueue(queue) {
  pageQueueList.innerHTML = '';

  queue.forEach((item) => {
    const queueItem = createQueueItem(item);
    pageQueueList.appendChild(queueItem);
  });
}

/**
 * Create queue item element
 */
function createQueueItem(item) {
  const div = document.createElement('div');
  div.className = 'queue-item';
  div.dataset.imageId = item.id;

  const statusInfo = getStatusInfo(item.status);
  const elapsed = Math.round((Date.now() - item.startTime) / 1000);

  div.innerHTML = `
    <div class="queue-item-header">
      <span class="queue-status ${item.status}">
        <span class="status-icon">${statusInfo.icon}</span>
        <span class="status-text">${statusInfo.text}</span>
      </span>
      <span class="queue-time">${elapsed}s</span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width: ${item.progress}%">
        <span class="progress-text">${item.progress}%</span>
      </div>
    </div>
    <div class="queue-item-url">${truncateUrl(item.imageUrl)}</div>
  `;

  return div;
}

/**
 * Get status information
 */
function getStatusInfo(status) {
  const statusMap = {
    'queued': { icon: '⏳', text: 'Queued' },
    'fetching': { icon: '📥', text: 'Fetching' },
    'uploading': { icon: '📤', text: 'Uploading' },
    'processing': { icon: '⚙️', text: 'Processing' },
    'converting': { icon: '🔄', text: 'Converting' },
    'completed': { icon: '✅', text: 'Completed' },
    'error': { icon: '❌', text: 'Error' }
  };

  return statusMap[status] || { icon: '❓', text: 'Unknown' };
}

/**
 * Truncate URL for display
 */
function truncateUrl(url) {
  if (!url) return '';
  const maxLength = 40;
  if (url.length <= maxLength) return url;

  const parts = url.split('/');
  const filename = parts[parts.length - 1];

  if (filename.length <= maxLength) {
    return '.../' + filename;
  }

  return url.substring(0, maxLength - 3) + '...';
}

/**
 * Load processing queue (from background script)
 */
async function loadQueue() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_QUEUE'
    });

    if (response.success) {
      renderQueue(response.queue);
    }
  } catch (error) {
    console.error('Error loading queue:', error);
  }
}

/**
 * Render processing queue
 */
function renderQueue(queue) {
  if (queue.length === 0) {
    pageQueueSection.style.display = 'none';
    return;
  }

  pageQueueSection.style.display = 'block';
  pageQueueList.innerHTML = '';

  queue.forEach((item) => {
    const queueItem = createQueueItem(item);
    pageQueueList.appendChild(queueItem);
  });
}

/**
 * Handle clear cache button
 */
async function handleClearCache() {
  clearCacheBtn.disabled = true;
  clearCacheBtn.textContent = 'Clearing...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CLEAR_CACHE'
    });

    if (response.success) {
      await loadStatistics();
      showMessage('Cache cleared successfully');
    } else {
      showMessage('Failed to clear cache: ' + response.error, true);
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    showMessage('Error clearing cache', true);
  } finally {
    clearCacheBtn.disabled = false;
    clearCacheBtn.textContent = 'Clear Cache';
  }
}

/**
 * Handle check server button
 */
async function handleCheckServer() {
  checkServerBtn.disabled = true;
  checkServerBtn.textContent = 'Checking...';

  await checkServer();
  await loadStatistics();

  checkServerBtn.disabled = false;
  checkServerBtn.textContent = 'Check Server';
}

/**
 * Show temporary message
 */
function showMessage(message, isError = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isError ? 'error' : 'success'}`;
  messageDiv.textContent = message;
  messageDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: ${isError ? '#f44336' : '#4caf50'};
    color: white;
    border-radius: 4px;
    z-index: 10000;
  `;

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    messageDiv.remove();
  }, 3000);
}

// Auto-refresh statistics and page stats every 1 second for real-time updates
setInterval(() => {
  // Only refresh if statistics tab is active, but always refresh page stats
  const activeTab = document.querySelector('.tab-content.active').id;
  
  if (activeTab === 'statistics-tab') {
    loadStatistics();
  }
  
  loadPageStatistics();
}, 1000);
