const SERVER_URL = 'http://127.0.0.1:5000';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const FETCH_TIMEOUT = 30000; // 30 seconds timeout for fetch requests
const DEBUG = true;

// Map<imageId, {status, progress, startTime, imageUrl}>
let processingQueue = new Map();
let serverAvailable = false;

function debugLog(category, message, data = null) {
  if (!DEBUG) return;
  const prefix = `[AI Upscale BG][${category}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function debugError(category, message, data = null) {
  const prefix = `[AI Upscale BG][${category}]`;
  if (data) {
    console.error(prefix, message, data);
  } else {
    console.error(prefix, message);
  }
}

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
    debugLog('FETCH_IMAGE', `Received request for: ${request.imageUrl}`);
    fetchImageAsBase64(request.imageUrl)
      .then(base64 => {
        debugLog('FETCH_IMAGE', `Success! Got base64 (${base64?.length} chars)`);
        sendResponse({ success: true, base64 });
      })
      .catch(error => {
        debugError('FETCH_IMAGE', `Failed: ${error.message}`, error);
        sendResponse({ success: false, error: error.message });
      });
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
    debugLog('Health', `Checking server health at ${SERVER_URL}/health...`);
    const response = await fetchWithTimeout(`${SERVER_URL}/health`, {
      method: 'GET',
      mode: 'cors'
    }, 5000); // 5 second timeout for health checks

    if (response.ok) {
      const data = await response.json();
      serverAvailable = data.status === 'healthy';
      debugLog('Health', `Server is ${serverAvailable ? 'healthy' : 'unhealthy'}`);
      return serverAvailable;
    } else {
      serverAvailable = false;
      debugError('Health', `Server returned status ${response.status}`);
      return false;
    }
  } catch (error) {
    serverAvailable = false;
    debugError('Health', `Server health check failed: ${error.message}`);
    return false;
  }
}

/**
 * Handle image upscale request
 */
async function handleUpscaleRequest(request, tabId) {
  const { imageUrl, imageId, imageData } = request;

  debugLog('Upscale', `handleUpscaleRequest called`, {
    imageUrl: imageUrl?.substring(0, 80),
    imageId: imageId?.substring(0, 20),
    hasImageData: !!imageData,
    imageDataLength: imageData?.length
  });

  if (processingQueue.has(imageId)) {
    debugLog('Upscale', `SKIP: Already processing this image`);
    return { success: false, error: 'Already processing this image' };
  }

  if (!serverAvailable) {
    debugLog('Upscale', `Server not available, checking health...`);
    const isAvailable = await checkServerHealth();
    if (!isAvailable) {
      debugError('Upscale', `Server not available after health check`);
      return { success: false, error: 'Server not available' };
    }
    debugLog('Upscale', `Server is now available`);
  }

  try {
    updateProgress(imageId, 'queued', 0, imageUrl);

    let imageBlob;

    // Use base64 data if provided (fetched by content script), otherwise fetch URL
    if (imageData) {
      debugLog('Upscale', `Converting base64 data to blob...`);
      updateProgress(imageId, 'converting', 20, imageUrl);
      imageBlob = await dataUrlToBlob(imageData);
      debugLog('Upscale', `Blob created: size=${imageBlob.size}, type=${imageBlob.type}`);
    } else {
      debugLog('Upscale', `Fetching image from URL...`);
      updateProgress(imageId, 'fetching', 20, imageUrl);
      imageBlob = await fetchImageWithRetry(imageUrl);
    }

    debugLog('Upscale', `Sending to upscale server...`);
    updateProgress(imageId, 'uploading', 40, imageUrl);
    const upscaledBlob = await upscaleImage(imageBlob, imageId);
    debugLog('Upscale', `Upscaled blob received: size=${upscaledBlob.size}`);

    updateProgress(imageId, 'converting', 90, imageUrl);
    const dataUrl = await blobToDataUrl(upscaledBlob);
    debugLog('Upscale', `Conversion complete (${dataUrl?.length} chars)`);

    updateProgress(imageId, 'completed', 100, imageUrl);

    // Remove from queue after delay to show completion
    setTimeout(() => processingQueue.delete(imageId), 1000);

    debugLog('Upscale', `SUCCESS: Image upscaled`);
    return {
      success: true,
      dataUrl,
      imageId
    };
  } catch (error) {
    debugError('Upscale', `FAILED: ${error.message}`, error);
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
  debugLog('FetchRetry', `Starting fetch for: ${url} (max ${retries} retries)`);

  for (let i = 0; i < retries; i++) {
    try {
      debugLog('FetchRetry', `Attempt ${i + 1}/${retries}...`);
      const response = await fetchWithTimeout(url, {}, FETCH_TIMEOUT);
      debugLog('FetchRetry', `Response: status=${response.status}, ok=${response.ok}, type=${response.type}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      debugLog('FetchRetry', `Success! Got blob: size=${blob.size}, type=${blob.type}`);
      return blob;
    } catch (error) {
      debugError('FetchRetry', `Attempt ${i + 1} failed: ${error.message}`, error);
      if (i === retries - 1) {
        debugError('FetchRetry', `All ${retries} attempts failed, giving up`);
        throw error;
      }
      debugLog('FetchRetry', `Waiting ${RETRY_DELAY}ms before retry...`);
      await delay(RETRY_DELAY);
    }
  }
}

/**
 * Send image to server for upscaling
 */
async function upscaleImage(imageBlob, imageId, retries = MAX_RETRIES) {
  debugLog('UpscaleServer', `Sending to server: blob size=${imageBlob.size}, type=${imageBlob.type}`);

  for (let i = 0; i < retries; i++) {
    try {
      debugLog('UpscaleServer', `Attempt ${i + 1}/${retries}...`);
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');

      if (imageId) {
        const queueItem = processingQueue.get(imageId);
        if (queueItem) {
          updateProgress(imageId, 'processing', 60, queueItem.imageUrl);
        }
      }

      debugLog('UpscaleServer', `POSTing to ${SERVER_URL}/upscale`);
      const response = await fetchWithTimeout(`${SERVER_URL}/upscale`, {
        method: 'POST',
        body: formData,
        mode: 'cors'
      }, 120000); // 2 minute timeout for upscaling

      debugLog('UpscaleServer', `Response: status=${response.status}, ok=${response.ok}`);

      if (!response.ok) {
        throw new Error(`Server error! status: ${response.status}`);
      }

      const resultBlob = await response.blob();
      debugLog('UpscaleServer', `Success! Result blob: size=${resultBlob.size}, type=${resultBlob.type}`);
      return resultBlob;
    } catch (error) {
      debugError('UpscaleServer', `Attempt ${i + 1} failed: ${error.message}`, error);
      if (i === retries - 1) {
        serverAvailable = false;
        debugError('UpscaleServer', `All attempts failed, marking server as unavailable`);
        throw error;
      }
      debugLog('UpscaleServer', `Waiting ${RETRY_DELAY}ms before retry...`);
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
  debugLog('FetchBase64', `fetchImageAsBase64 called for: ${imageUrl}`);
  try {
    const blob = await fetchImageWithRetry(imageUrl);
    debugLog('FetchBase64', `Got blob, converting to data URL...`);
    const dataUrl = await blobToDataUrl(blob);
    debugLog('FetchBase64', `Conversion complete (${dataUrl?.length} chars)`);
    return dataUrl;
  } catch (error) {
    debugError('FetchBase64', `Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Clear server cache
 */
async function clearServerCache() {
  try {
    const response = await fetchWithTimeout(`${SERVER_URL}/clear-cache`, {
      method: 'POST',
      mode: 'cors'
    }, 10000); // 10 second timeout

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
    const response = await fetchWithTimeout(`${SERVER_URL}/models`, {
      method: 'GET',
      mode: 'cors'
    }, 10000); // 10 second timeout

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
    const response = await fetchWithTimeout(`${SERVER_URL}/switch-model`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: modelKey })
    }, 30000); // 30 second timeout

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

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// Periodic health check every 30 seconds
setInterval(checkServerHealth, 30000);
