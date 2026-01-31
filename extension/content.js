// Content script for AI Reading Upscale Extension

// Configuration
const CONFIG = {
  minImageWidth: 200,
  minImageHeight: 200,
  maxImageWidth: 2000,
  maxImageHeight: 4000,
  enabledByDefault: true
};

// State
let isEnabled = CONFIG.enabledByDefault;
let processedImages = new Set();
let imageCache = new Map();

// Manga/Manhwa site patterns
const MANGA_SITES = [
  'mangadex.org',
  'mangaplus.shueisha.co.jp',
  'webtoons.com',
  'tapas.io',
  'manganelo.com',
  'mangakakalot.com',
  'readm.org',
  'mangahere.cc',
  'mangareader.net',
  'mangapark.net'
];

// Initialize
init();

/**
 * Initialize content script
 */
function init() {
  // Load settings from storage
  chrome.storage.local.get(['enabled', 'whitelist', 'blacklist'], (result) => {
    isEnabled = result.enabled !== undefined ? result.enabled : CONFIG.enabledByDefault;

    if (isEnabled) {
      // Check if current site should be processed
      if (shouldProcessSite()) {
        startImageDetection();
      }
    }
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TOGGLE_EXTENSION') {
      isEnabled = request.enabled;
      if (isEnabled) {
        startImageDetection();
      } else {
        // Optionally revert images
      }
      sendResponse({ success: true });
    }
    return false;
  });
}

/**
 * Check if current site should be processed
 */
function shouldProcessSite() {
  const hostname = window.location.hostname;

  // Check if it's a known manga site
  return MANGA_SITES.some(site => hostname.includes(site));
}

/**
 * Start image detection and processing
 */
function startImageDetection() {
  // Process existing images
  detectAndProcessImages();

  // Set up MutationObserver for dynamically loaded images
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === 'IMG') {
          processImage(node);
        } else if (node.querySelectorAll) {
          const images = node.querySelectorAll('img');
          images.forEach(processImage);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Detect and process all images on the page
 */
function detectAndProcessImages() {
  const images = document.querySelectorAll('img');
  console.log(`Found ${images.length} images on page`);

  images.forEach((img) => {
    processImage(img);
  });
}

/**
 * Process individual image
 */
async function processImage(img) {
  if (!isEnabled) return;
  if (!img.src) return;

  // Generate unique ID for this image
  const imageId = getImageId(img);

  // Skip if already processed
  if (processedImages.has(imageId)) return;

  // Check if image meets size criteria
  if (!meetsImageCriteria(img)) return;

  // Mark as processed
  processedImages.add(imageId);

  // Add loading indicator
  addLoadingIndicator(img);

  try {
    // Request upscaling from background script
    const response = await chrome.runtime.sendMessage({
      type: 'UPSCALE_IMAGE',
      imageUrl: img.src,
      imageId: imageId
    });

    if (response.success) {
      // Replace image with upscaled version
      replaceImage(img, response.dataUrl);
      removeLoadingIndicator(img);

      // Cache the result
      imageCache.set(imageId, response.dataUrl);

      console.log(`Image upscaled: ${imageId}`);
    } else {
      console.error(`Failed to upscale image: ${response.error}`);
      removeLoadingIndicator(img);
      processedImages.delete(imageId);
    }
  } catch (error) {
    console.error('Error processing image:', error);
    removeLoadingIndicator(img);
    processedImages.delete(imageId);
  }
}

/**
 * Check if image meets criteria for upscaling
 */
function meetsImageCriteria(img) {
  // Wait for image to load
  if (!img.complete) {
    img.addEventListener('load', () => processImage(img));
    return false;
  }

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // Check size constraints
  if (width < CONFIG.minImageWidth || height < CONFIG.minImageHeight) {
    return false;
  }

  if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
    return false;
  }

  // Check aspect ratio (typical for manga/manhwa)
  const aspectRatio = width / height;
  if (aspectRatio < 0.2 || aspectRatio > 5) {
    return false;
  }

  return true;
}

/**
 * Generate unique ID for image
 */
function getImageId(img) {
  // Use src as base, but could use hash of image data for more accuracy
  return btoa(img.src).substring(0, 32);
}

/**
 * Replace image with upscaled version
 */
function replaceImage(img, dataUrl) {
  // Store original attributes
  const originalSrc = img.src;
  img.dataset.originalSrc = originalSrc;
  img.dataset.upscaled = 'true';

  // Replace src with upscaled version
  img.src = dataUrl;

  // Show the image now that it's upscaled
  img.style.opacity = '1';
  img.style.visibility = 'visible';

  // Clean up stored states
  delete img.dataset.originalOpacity;
  delete img.dataset.originalVisibility;
}

/**
 * Add loading indicator to image
 */
function addLoadingIndicator(img) {
  // Store original display state
  img.dataset.originalOpacity = img.style.opacity || '1';
  img.dataset.originalVisibility = img.style.visibility || 'visible';

  // Get image dimensions before hiding
  const computedStyle = window.getComputedStyle(img);
  const width = img.offsetWidth || img.naturalWidth;
  const height = img.offsetHeight || img.naturalHeight;

  // Preserve dimensions and hide the image
  if (width && height) {
    img.style.width = width + 'px';
    img.style.height = height + 'px';
  }
  img.style.opacity = '0';
  img.style.visibility = 'hidden';

  // Add a semi-transparent overlay with loading animation
  const overlay = document.createElement('div');
  overlay.className = 'ai-upscale-loading';
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    pointer-events: none;
  `;

  const spinner = document.createElement('div');
  spinner.style.cssText = `
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top: 4px solid white;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: ai-upscale-spin 1s linear infinite;
  `;

  overlay.appendChild(spinner);

  // Add CSS animation if not already added
  if (!document.getElementById('ai-upscale-styles')) {
    const style = document.createElement('style');
    style.id = 'ai-upscale-styles';
    style.textContent = `
      @keyframes ai-upscale-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  // Position relative to image
  const parent = img.parentElement;
  if (parent && parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
    parent.style.position = 'relative';
  }

  img.dataset.loadingOverlay = 'true';
  parent.appendChild(overlay);
  img.loadingOverlay = overlay;
}

/**
 * Remove loading indicator
 */
function removeLoadingIndicator(img) {
  if (img.loadingOverlay && img.loadingOverlay.parentNode) {
    img.loadingOverlay.parentNode.removeChild(img.loadingOverlay);
    img.loadingOverlay = null;
    delete img.dataset.loadingOverlay;
  }

  // If image is still hidden (upscaling failed), restore visibility
  if (img.style.opacity === '0' || img.style.visibility === 'hidden') {
    img.style.opacity = img.dataset.originalOpacity || '1';
    img.style.visibility = img.dataset.originalVisibility || 'visible';
    delete img.dataset.originalOpacity;
    delete img.dataset.originalVisibility;
  }
}

console.log('AI Reading Upscale Extension loaded');
