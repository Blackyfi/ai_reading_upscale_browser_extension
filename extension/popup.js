// Popup script for AI Reading Upscale Extension

// DOM elements
const toggleExtension = document.getElementById('toggleExtension');
const extensionStatus = document.getElementById('extensionStatus');
const serverStatus = document.getElementById('serverStatus');
const cacheCount = document.getElementById('cacheCount');
const cacheSize = document.getElementById('cacheSize');
const queueSize = document.getElementById('queueSize');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const checkServerBtn = document.getElementById('checkServerBtn');
const queueSection = document.getElementById('queueSection');
const queueList = document.getElementById('queueList');

// Initialize popup
init();

function init() {
  // Load saved state
  chrome.storage.local.get(['enabled'], (result) => {
    const enabled = result.enabled !== undefined ? result.enabled : true;
    toggleExtension.checked = enabled;
    updateExtensionStatus(enabled);
  });

  // Check server status
  checkServer();

  // Load statistics
  loadStatistics();

  // Load processing queue
  loadQueue();

  // Set up event listeners
  toggleExtension.addEventListener('change', handleToggle);
  clearCacheBtn.addEventListener('click', handleClearCache);
  checkServerBtn.addEventListener('click', handleCheckServer);
}

/**
 * Handle extension toggle
 */
function handleToggle() {
  const enabled = toggleExtension.checked;

  // Save to storage
  chrome.storage.local.set({ enabled });

  // Update UI
  updateExtensionStatus(enabled);

  // Notify all tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_EXTENSION',
        enabled
      }).catch(() => {
        // Tab might not have content script, ignore error
      });
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
    // Get queue size from background
    const statusResponse = await chrome.runtime.sendMessage({
      type: 'GET_STATUS'
    });

    if (statusResponse.success) {
      queueSize.textContent = statusResponse.queueSize || 0;
    }

    // Get cache stats from server
    const response = await fetch('http://127.0.0.1:5000/stats');
    if (response.ok) {
      const data = await response.json();
      cacheCount.textContent = data.cache_count || 0;
      cacheSize.textContent = `${data.cache_size_mb || 0} MB`;
    }
  } catch (error) {
    console.error('Error loading statistics:', error);
    cacheCount.textContent = '-';
    cacheSize.textContent = '-';
  }
}

/**
 * Load processing queue
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
  // Show/hide queue section based on queue length
  if (queue.length === 0) {
    queueSection.style.display = 'none';
    return;
  }

  queueSection.style.display = 'block';

  // Clear existing items
  queueList.innerHTML = '';

  // Render each queue item
  queue.forEach((item) => {
    const queueItem = createQueueItem(item);
    queueList.appendChild(queueItem);
  });
}

/**
 * Create queue item element
 */
function createQueueItem(item) {
  const div = document.createElement('div');
  div.className = 'queue-item';
  div.dataset.imageId = item.id;

  // Get status text and icon
  const statusInfo = getStatusInfo(item.status);

  // Calculate elapsed time
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

  // Try to extract filename
  const parts = url.split('/');
  const filename = parts[parts.length - 1];

  if (filename.length <= maxLength) {
    return '.../' + filename;
  }

  return url.substring(0, maxLength - 3) + '...';
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
      // Reload statistics
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

// Auto-refresh statistics and queue every 1 second for real-time updates
setInterval(() => {
  loadStatistics();
  loadQueue();
}, 1000);
