// Content script for AI Reading Upscale Extension

// Configuration
const CONFIG = {
  minImageWidth: 200,
  minImageHeight: 200,
  maxImageWidth: 2000,
  maxImageHeight: 20000,  // Increased for manhwa/webtoons (typically 15000-16000px tall)
  enabledByDefault: false
};

// State
let isEnabled = CONFIG.enabledByDefault;
let processedImages = new Set();
let imageCache = new Map();
let imageQueue = [];
let isProcessingQueue = false;

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
  'mangapark.net',
  'asuracomic.net'
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
 * Check if image is animated (GIF, APNG, WebP animation)
 */
function isAnimatedImage(src) {
  if (!src) return false;

  const lowerSrc = src.toLowerCase();

  // Block GIF files
  if (lowerSrc.endsWith('.gif') || lowerSrc.includes('.gif?')) {
    return true;
  }

  // Block common animated formats
  if (lowerSrc.includes('/gif/') || lowerSrc.includes('emoji') || lowerSrc.includes('spinner')) {
    return true;
  }

  return false;
}

/**
 * Check if image is a UI element (icon, logo, profile picture, etc.)
 */
function isUIElement(img) {
  if (!img) return false;

  const src = img.src ? img.src.toLowerCase() : '';
  const alt = img.alt ? img.alt.toLowerCase() : '';
  const className = img.className ? img.className.toLowerCase() : '';

  // Check for common UI element patterns in src
  const uiPatterns = [
    'icon', 'logo', 'avatar', 'profile', 'button', 'banner',
    'badge', 'emoji', 'spinner', 'loading', 'placeholder',
    'thumbnail', 'arrow', 'chevron', 'menu', 'nav', 'header',
    'footer', 'sidebar', 'ad', 'advertisement'
  ];

  for (const pattern of uiPatterns) {
    if (src.includes(pattern) || alt.includes(pattern) || className.includes(pattern)) {
      return true;
    }
  }

  // Check for profile pictures and UI images by class
  if (className.includes('rounded-full') || className.includes('rounded-circle')) {
    return true;
  }

  // Check if alt text indicates it's not a manga page
  if (alt && !alt.includes('chapter') && !alt.includes('page') && !alt.includes('comic')) {
    // If alt exists but doesn't mention chapter/page/comic, it might be UI
    const nonMangaAltPatterns = ['user', 'profile', 'close', 'menu', 'search'];
    for (const pattern of nonMangaAltPatterns) {
      if (alt.includes(pattern)) {
        return true;
      }
    }
  }

  // For asuracomic.net, only process images that are clearly manga panels
  if (window.location.hostname.includes('asuracomic.net')) {
    // Check if the src is from the storage/media path (manga images)
    const isMangaPath = src.includes('/storage/media/');

    // If it's from /storage/media/, check if it's a chapter page (not a thumbnail/cover)
    if (isMangaPath) {
      // Chapter page images have patterns like:
      // - /storage/media/<ID>/<number>.jpg (e.g., /storage/media/411950/00.jpg)
      // - /storage/media/<ID>/conversions/<number>-optimized.webp
      const isChapterPage = /\/storage\/media\/\d+\/(\d{2}\.(jpg|png|webp)|conversions\/\d{2}-optimized\.(jpg|png|webp))/.test(src);

      // Also check alt text for "chapter page"
      const hasChapterAlt = alt.includes('chapter page');

      console.log('[ASURA DEBUG] Image:', src, '| isChapterPage:', isChapterPage, '| hasChapterAlt:', hasChapterAlt);

      // If it matches the chapter page pattern OR has chapter page alt text, it's NOT a UI element
      if (isChapterPage || hasChapterAlt) {
        console.log('[ASURA] Processing chapter image:', src);
        return false;
      }

      // If it's from storage/media but not a chapter page, it's likely a cover/thumbnail (UI element)
      console.log('[ASURA] Skipping non-chapter image:', src);
      return true;
    }

    // If not from /storage/media/, it's likely a UI element
    return true;
  }

  return false;
}

/**
 * Process individual image
 */
async function processImage(img) {
  if (!isEnabled) return;
  if (!img.src) return;

  // Skip GIF files and other animated formats
  if (isAnimatedImage(img.src)) {
    console.log('[SKIP] Animated image:', img.src);
    return;
  }

  // Skip UI elements, icons, and other non-manga images
  if (isUIElement(img)) {
    console.log('[SKIP] UI element:', img.src);
    return;
  }

  console.log('[DETECT] Found manga image:', img.src, 'alt:', img.alt);

  // Generate unique ID for this image
  const imageId = getImageId(img);

  // Check if image meets size criteria BEFORE checking if processed
  // This allows images to be re-checked after they load
  if (!meetsImageCriteria(img)) {
    console.log('[SKIP] Does not meet size criteria:', img.src, 'Size:', img.naturalWidth, 'x', img.naturalHeight);
    return;
  }

  // Skip if already processed (after size check, so lazy-loaded images can be re-evaluated)
  if (processedImages.has(imageId)) {
    console.log('[SKIP] Already processed:', img.src);
    return;
  }

  // Skip if already in queue
  if (imageQueue.some(item => item.imageId === imageId)) {
    console.log('[SKIP] Already in queue:', img.src);
    return;
  }

  // Add to queue
  console.log('[QUEUE] Adding image to queue:', img.src);
  imageQueue.push({ img, imageId });
  
  // Add loading indicator
  addLoadingIndicator(img);
  
  // Start processing queue if not already running
  processQueue();
}

/**
 * Process the image queue sequentially
 */
async function processQueue() {
  // If already processing, exit
  if (isProcessingQueue) {
    return;
  }
  
  // If queue is empty, exit
  if (imageQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (imageQueue.length > 0) {
    const { img, imageId } = imageQueue.shift();
    
    console.log(`[PROCESSING] Processing image ${imageId} (${imageQueue.length} remaining in queue)`);
    
    try {
      // Request upscaling from background script
      const response = await chrome.runtime.sendMessage({
        type: 'UPSCALE_IMAGE',
        imageUrl: img.src,
        imageId: imageId
      });

      if (response.success) {
        // Mark as processed ONLY after successful upscaling
        processedImages.add(imageId);
        
        // Replace image with upscaled version
        replaceImage(img, response.dataUrl);
        removeLoadingIndicator(img);

        // Cache the result
        imageCache.set(imageId, response.dataUrl);

        console.log(`[SUCCESS] Image upscaled: ${imageId}`);
      } else {
        console.error(`[ERROR] Failed to upscale image: ${response.error}`);
        removeLoadingIndicator(img);
        // Don't mark as processed so it can be retried
      }
    } catch (error) {
      console.error('[ERROR] Error processing image:', error);
      removeLoadingIndicator(img);
      // Don't mark as processed so it can be retried
    }
    
    // Small delay between images to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  isProcessingQueue = false;
  console.log('[QUEUE] All images processed');
}

/**
 * Check if image meets criteria for upscaling
 */
function meetsImageCriteria(img) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // If dimensions are not available yet (lazy-loaded images), wait for load
  if (width === 0 || height === 0 || !img.complete) {
    // Check if we already added a load listener to avoid duplicates
    if (!img.dataset.loadListenerAdded) {
      img.dataset.loadListenerAdded = 'true';
      img.addEventListener('load', () => {
        console.log('[LOAD EVENT] Image loaded, reprocessing:', img.src, 'New size:', img.naturalWidth, 'x', img.naturalHeight);
        delete img.dataset.loadListenerAdded; // Remove marker so it can be processed
        processImage(img);
      }, { once: true });
    }
    return false;
  }

  // Check size constraints
  if (width < CONFIG.minImageWidth || height < CONFIG.minImageHeight) {
    console.log('[SKIP] Does not meet minImageWidth criteria:', img.src, 'Size:', img.naturalWidth, 'x', img.naturalHeight, 'Min required:', CONFIG.minImageWidth, 'x', CONFIG.minImageHeight);
    return false;
  }

  if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
    console.log('[SKIP] Does not meet maxImageWidth criteria:', img.src, 'Size:', img.naturalWidth, 'x', img.naturalHeight, 'Max allowed:', CONFIG.maxImageWidth, 'x', CONFIG.maxImageHeight);
    return false;
  }

  console.log('[SIZE OK] Image meets criteria:', img.src, 'Size:', width, 'x', height);
  return true;
}

/**
 * Generate unique ID for image
 */
function getImageId(img) {
  // Use full base64 encoded src for unique ID
  return btoa(img.src);
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
