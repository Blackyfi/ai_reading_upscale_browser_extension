// Background service worker for AI Reading Upscale Extension

const SERVER_URL = 'http://127.0.0.1:5000';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Store for processing queue
let processingQueue = new Map();
let serverAvailable = false;

// Check server health on startup
checkServerHealth();

// Listen for messages from content scripts
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
      console.log('Server health check:', data);
      return serverAvailable;
    } else {
      serverAvailable = false;
      return false;
    }
  } catch (error) {
    console.error('Server health check failed:', error);
    serverAvailable = false;
    return false;
  }
}

/**
 * Handle image upscale request
 */
async function handleUpscaleRequest(request, tabId) {
  const { imageUrl, imageId } = request;

  // Check if already processing
  if (processingQueue.has(imageId)) {
    return { success: false, error: 'Already processing this image' };
  }

  // Check server availability
  if (!serverAvailable) {
    const isAvailable = await checkServerHealth();
    if (!isAvailable) {
      return { success: false, error: 'Server not available' };
    }
  }

  try {
    // Add to processing queue
    processingQueue.set(imageId, { status: 'processing', startTime: Date.now() });

    // Fetch the original image
    const imageBlob = await fetchImageWithRetry(imageUrl);

    // Send to server for upscaling
    const upscaledBlob = await upscaleImage(imageBlob);

    // Convert to data URL
    const dataUrl = await blobToDataUrl(upscaledBlob);

    // Remove from queue
    processingQueue.delete(imageId);

    return {
      success: true,
      dataUrl,
      imageId
    };
  } catch (error) {
    processingQueue.delete(imageId);
    throw error;
  }
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
async function upscaleImage(imageBlob, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const formData = new FormData();
      formData.append('image', imageBlob, 'image.png');

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
 * Utility: delay function
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Periodic health check (every 30 seconds)
setInterval(checkServerHealth, 30000);
