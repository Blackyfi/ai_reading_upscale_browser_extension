const SERVER_URL = 'http://127.0.0.1:5000';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

// Map<imageId, {status, progress, startTime, imageUrl}>
let processingQueue = new Map();
let serverAvailable = false;

checkServerHealth();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPSCALE_IMAGE') {
    handleUpscaleRequest(request, sender.tab.id)
      .then(sendResponse)
      .catch(error => {
        console.error('Upscale error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }

  if (request.type === 'GET_STATUS') {
    sendResponse({
      success: true,
      serverAvailable,
      queueSize: processingQueue.size
    });
    return false;
  }

  if (request.type === 'GET_QUEUE') {
    const queueArray = Array.from(processingQueue.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
    sendResponse({
      success: true,
      queue: queueArray
    });
    return false;
  }

  if (request.type === 'FETCH_IMAGE') {
    // Fetch image from background script (bypasses CORS)
    fetchImageAsBase64(request.imageUrl)
      .then(base64 => sendResponse({ success: true, base64 }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'CLEAR_CACHE') {
    clearServerCache()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'CHECK_SERVER') {
    checkServerHealth()
      .then(() => sendResponse({ success: true, available: serverAvailable }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'GET_MODELS') {
    getModels()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.type === 'SWITCH_MODEL') {
    switchModel(request.model)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

/**
 * Check if server is running and healthy
 */
async function checkServerHealth() {
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      mode: 'cors'
    });

    if (response.ok) {
      const data = await response.json();
      serverAvailable = data.status === 'healthy';
      return serverAvailable;
    } else {
      serverAvailable = false;
      return false;
    }
  } catch (error) {
    serverAvailable = false;
    return false;
  }
}

/**
 * Handle image upscale request
 */
async function handleUpscaleRequest(request, tabId) {
  const { imageUrl, imageId, imageData } = request;

  if (processingQueue.has(imageId)) {
    return { success: false, error: 'Already processing this image' };
  }

  if (!serverAvailable) {
    const isAvailable = await checkServerHealth();
    if (!isAvailable) {
      return { success: false, error: 'Server not available' };
    }
  }

  try {
    updateProgress(imageId, 'queued', 0, imageUrl);

    let imageBlob;

    // Use base64 data if provided (fetched by content script), otherwise fetch URL
    if (imageData) {
      updateProgress(imageId, 'converting', 20, imageUrl);
      imageBlob = await dataUrlToBlob(imageData);
    } else {
      updateProgress(imageId, 'fetching', 20, imageUrl);
      imageBlob = await fetchImageWithRetry(imageUrl);
    }

    updateProgress(imageId, 'uploading', 40, imageUrl);
    const upscaledBlob = await upscaleImage(imageBlob, imageId);
    updateProgress(imageId, 'converting', 90, imageUrl);
    const dataUrl = await blobToDataUrl(upscaledBlob);
    updateProgress(imageId, 'completed', 100, imageUrl);

    // Remove from queue after delay to show completion
    setTimeout(() => processingQueue.delete(imageId), 1000);

    return {
      success: true,
      dataUrl,
      imageId
    };
  } catch (error) {
    updateProgress(imageId, 'error', 0, imageUrl);
    setTimeout(() => processingQueue.delete(imageId), 2000);
    throw error;
  }
}

/**
 * Update progress for an image
 */
function updateProgress(imageId, status, progress, imageUrl) {
  processingQueue.set(imageId, {
    status,
    progress,
    startTime: processingQueue.get(imageId)?.startTime || Date.now(),
    imageUrl: imageUrl || processingQueue.get(imageId)?.imageUrl
  });
}

/**
 * Fetch image with retry logic
 */
async function fetchImageWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.blob();
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
      await delay(RETRY_DELAY);
    }
  }
}

/**
 * Send image to server for upscaling
 */
async function upscaleImage(imageBlob, imageId, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');

      if (imageId) {
        const queueItem = processingQueue.get(imageId);
        if (queueItem) {
          updateProgress(imageId, 'processing', 60, queueItem.imageUrl);
        }
      }

      const response = await fetch(`${SERVER_URL}/upscale`, {
        method: 'POST',
        body: formData,
        mode: 'cors'
      });

      if (!response.ok) {
        throw new Error(`Server error! status: ${response.status}`);
      }

      return await response.blob();
    } catch (error) {
      console.error(`Upscale attempt ${i + 1} failed:`, error);
      if (i === retries - 1) {
        serverAvailable = false;
        throw error;
      }
      await delay(RETRY_DELAY);
    }
  }
}

/**
 * Convert blob to data URL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert data URL to blob
 */
async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Fetch image and convert to base64 (used by content script to bypass CORS)
 */
async function fetchImageAsBase64(imageUrl) {
  const blob = await fetchImageWithRetry(imageUrl);
  return blobToDataUrl(blob);
}

/**
 * Clear server cache
 */
async function clearServerCache() {
  try {
    const response = await fetch(`${SERVER_URL}/clear-cache`, {
      method: 'POST',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`Server error! status: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error) {
    throw new Error(`Failed to clear cache: ${error.message}`);
  }
}

/**
 * Get available models from server
 */
async function getModels() {
  try {
    const response = await fetch(`${SERVER_URL}/models`, {
      method: 'GET',
      mode: 'cors'
    });

    if (!response.ok) {
      throw new Error(`Server error! status: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, ...data };
  } catch (error) {
    throw new Error(`Failed to get models: ${error.message}`);
  }
}

/**
 * Switch to a different model
 */
async function switchModel(modelKey) {
  try {
    const response = await fetch(`${SERVER_URL}/switch-model`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: modelKey })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Server error! status: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, ...data };
  } catch (error) {
    throw new Error(`Failed to switch model: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Periodic health check every 30 seconds
setInterval(checkServerHealth, 30000);
