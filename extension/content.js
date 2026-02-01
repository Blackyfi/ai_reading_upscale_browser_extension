// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  minImageWidth: 200,
  minImageHeight: 200,
  maxImageWidth: 2000,
  maxImageHeight: 20000,
  enabledByDefault: false
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let isEnabled = CONFIG.enabledByDefault;
let processedImages = new Set();
let imageCache = new Map();
let imageQueue = [];
let isProcessingQueue = false;
let currentSiteHandler = null;

let pageStats = {
  totalDetected: 0,
  totalUpscaled: 0,
  startTime: Date.now(),
  upscaleTimes: [],
  queue: []
};

// =============================================================================
// SITE HANDLER REGISTRY
// =============================================================================

/**
 * Registry of site-specific handlers
 * Each handler defines how to process images for that specific site
 */
const SITE_HANDLERS = {
  'mangadex.org': {
    name: 'MangaDex',
    isReadingPage: mangadexIsReadingPage,
    isMangaImage: mangadexIsMangaImage,
    getImageUrl: mangadexGetImageUrl,
    needsBackgroundFetch: false
  },
  'webtoons.com': {
    name: 'Webtoon',
    isReadingPage: webtoonIsReadingPage,
    isMangaImage: webtoonIsMangaImage,
    getImageUrl: webtoonGetImageUrl,
    needsBackgroundFetch: false // Webtoon CDN supports CORS
  },
  'asuracomic.net': {
    name: 'AsuraScans',
    isReadingPage: asuraIsReadingPage,
    isMangaImage: asuraIsMangaImage,
    getImageUrl: asuraGetImageUrl,
    needsBackgroundFetch: true // Asura CDN does NOT support CORS
  }
};

// =============================================================================
// MANGADEX SITE HANDLER
// =============================================================================

function mangadexIsReadingPage() {
  // MangaDex reader pages have specific URL patterns
  return window.location.pathname.includes('/chapter/');
}

function mangadexIsMangaImage(img) {
  const className = img.className ? img.className.toLowerCase() : '';

  // MangaDex uses blob URLs for chapter pages with class "img ls limit-width"
  if (className.includes('img') && className.includes('limit-width')) {
    return true;
  }

  return false;
}

function mangadexGetImageUrl(img) {
  // MangaDex uses blob URLs directly in src
  return img.src || null;
}

// =============================================================================
// WEBTOON SITE HANDLER
// =============================================================================

function webtoonIsReadingPage() {
  // Webtoon viewer pages have /viewer in the URL
  return window.location.href.toLowerCase().includes('/viewer');
}

function webtoonIsMangaImage(img) {
  const className = img.className ? img.className.toLowerCase() : '';
  const src = (img.src || '').toLowerCase();
  const dataUrl = (img.getAttribute('data-url') || '').toLowerCase();
  const urlToCheck = dataUrl || src;

  // Only process images with _images class (actual chapter content)
  // Skip _thumbnailImages class (episode thumbnails)
  if (!className.includes('_images') || className.includes('_thumbnailimages')) {
    return false;
  }

  // Filter out thumbnails by URL pattern
  if (urlToCheck.includes('/thumb_') || urlToCheck.includes('thumb_poster')) {
    return false;
  }

  return true;
}

function webtoonGetImageUrl(img) {
  // Webtoon uses data-url attribute for lazy loading
  const dataUrl = img.getAttribute('data-url');
  if (dataUrl && !dataUrl.includes('bg_transparency') && !dataUrl.includes('placeholder')) {
    return dataUrl;
  }

  const src = img.src || '';
  if (src.includes('bg_transparency') || src.includes('placeholder')) {
    return null; // Still loading
  }

  return src || null;
}

// =============================================================================
// ASURASCANS SITE HANDLER
// =============================================================================

function asuraIsReadingPage() {
  // AsuraScans chapter pages typically have chapter in URL or specific page structure
  // Check if we're on a page with manga images
  return document.querySelector('img[src*="/storage/media/"]') !== null;
}

function asuraIsMangaImage(img) {
  const src = img.src ? img.src.toLowerCase() : '';
  const alt = img.alt ? img.alt.toLowerCase() : '';

  // Only process images from the storage/media path (actual chapter images)
  if (!src.includes('/storage/media/')) {
    return false;
  }

  // Check for chapter page pattern: /storage/media/{id}/{number}.jpg
  const isChapterPage = /\/storage\/media\/\d+\/(\d{2}\.(jpg|png|webp)|conversions\/\d{2}-optimized\.(jpg|png|webp))/.test(src);
  const hasChapterAlt = alt.includes('chapter page');

  return isChapterPage || hasChapterAlt;
}

function asuraGetImageUrl(img) {
  // AsuraScans uses direct src URLs
  return img.src || null;
}

// =============================================================================
// GENERIC SITE HANDLER (FALLBACK)
// =============================================================================

function genericIsReadingPage() {
  return true; // Always try on unknown sites
}

function genericIsMangaImage(img) {
  const src = img.src ? img.src.toLowerCase() : '';
  const alt = img.alt ? img.alt.toLowerCase() : '';
  const className = img.className ? img.className.toLowerCase() : '';

  // Filter out common UI patterns
  const uiPatterns = [
    'icon', 'logo', 'avatar', 'profile', 'button', 'banner',
    'badge', 'emoji', 'spinner', 'loading', 'placeholder',
    'thumbnail', 'arrow', 'chevron', 'menu', 'nav', 'header',
    'footer', 'sidebar', 'ad', 'advertisement'
  ];

  for (const pattern of uiPatterns) {
    if (src.includes(pattern) || alt.includes(pattern) || className.includes(pattern)) {
      return false;
    }
  }

  // Filter out circular images (usually avatars)
  if (className.includes('rounded-full') || className.includes('rounded-circle')) {
    return false;
  }

  // Filter out images with non-manga alt text
  if (alt && !alt.includes('chapter') && !alt.includes('page') && !alt.includes('comic')) {
    const nonMangaAltPatterns = ['user', 'profile', 'close', 'menu', 'search'];
    for (const pattern of nonMangaAltPatterns) {
      if (alt.includes(pattern)) return false;
    }
  }

  return true;
}

function genericGetImageUrl(img) {
  // Try common lazy loading patterns
  const dataSrc = img.getAttribute('data-src');
  if (dataSrc && !dataSrc.includes('placeholder')) {
    return dataSrc;
  }

  const dataUrl = img.getAttribute('data-url');
  if (dataUrl && !dataUrl.includes('placeholder')) {
    return dataUrl;
  }

  return img.src || null;
}

// =============================================================================
// SITE DETECTION & HANDLER SELECTION
// =============================================================================

/**
 * Get the appropriate handler for the current site
 */
function getSiteHandler() {
  const hostname = window.location.hostname;

  for (const [domain, handler] of Object.entries(SITE_HANDLERS)) {
    if (hostname.includes(domain)) {
      console.log(`[AI Upscale] Using ${handler.name} handler`);
      return handler;
    }
  }

  // Return generic handler for unknown sites
  console.log('[AI Upscale] Using generic handler');
  return {
    name: 'Generic',
    isReadingPage: genericIsReadingPage,
    isMangaImage: genericIsMangaImage,
    getImageUrl: genericGetImageUrl,
    needsBackgroundFetch: true // Default to background fetch for unknown sites
  };
}

/**
 * Check if current site is supported
 */
function isSupportedSite() {
  const hostname = window.location.hostname;
  return Object.keys(SITE_HANDLERS).some(domain => hostname.includes(domain));
}

// =============================================================================
// IMAGE UTILITIES
// =============================================================================

/**
 * Check if image is animated (GIF, emoji, spinner)
 */
function isAnimatedImage(src) {
  if (!src) return false;
  const lowerSrc = src.toLowerCase();
  return lowerSrc.endsWith('.gif') || lowerSrc.includes('.gif?') ||
         lowerSrc.includes('/gif/') || lowerSrc.includes('emoji') || lowerSrc.includes('spinner');
}

/**
 * Get vertical position of an image on the page
 */
function getImageVerticalPosition(img) {
  const rect = img.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  return rect.top + scrollTop;
}

/**
 * Generate unique ID for image
 */
function getImageId(img) {
  const actualUrl = currentSiteHandler.getImageUrl(img) || img.src;
  return btoa(actualUrl);
}

/**
 * Check if image meets size criteria for upscaling
 */
function meetsImageCriteria(img) {
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  // For lazy-loaded images, check explicit dimensions
  const actualUrl = currentSiteHandler.getImageUrl(img);
  const isPlaceholderLoaded = img.src && (img.src.includes('bg_transparency') || img.src.includes('placeholder'));

  if (isPlaceholderLoaded && actualUrl) {
    const attrWidth = parseInt(img.getAttribute('width'), 10);
    const attrHeight = parseInt(img.getAttribute('height'), 10);
    if (attrWidth > 0 && attrHeight > 0) {
      width = attrWidth;
      height = attrHeight;
    }
  }

  // Wait for lazy-loaded images to have dimensions
  if (width === 0 || height === 0 || (!img.complete && !isPlaceholderLoaded)) {
    if (!img.dataset.loadListenerAdded) {
      img.dataset.loadListenerAdded = 'true';
      img.addEventListener('load', () => {
        delete img.dataset.loadListenerAdded;
        processImage(img);
      }, { once: true });
    }
    return false;
  }

  if (width < CONFIG.minImageWidth || height < CONFIG.minImageHeight) {
    return false;
  }

  if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
    return false;
  }

  return true;
}

// =============================================================================
// IMAGE FETCHING (CORS HANDLING)
// =============================================================================

/**
 * Extract image data using canvas (works for images with CORS support)
 */
async function extractImageAsBase64(img, imageUrl) {
  return new Promise((resolve, reject) => {
    try {
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';

      tempImg.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = tempImg.naturalWidth;
          canvas.height = tempImg.naturalHeight;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(tempImg, 0, 0);

          let dataUrl;
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          } catch (e) {
            dataUrl = canvas.toDataURL('image/png');
          }

          resolve(dataUrl);
        } catch (canvasError) {
          // Canvas tainted - try fetch methods
          console.warn('[AI Upscale] Canvas tainted, trying fetch fallback');
          fetchImageWithFallback(imageUrl).then(resolve).catch(reject);
        }
      };

      tempImg.onerror = () => {
        // Image failed to load with crossOrigin, try fetch methods
        fetchImageWithFallback(imageUrl).then(resolve).catch(reject);
      };

      tempImg.src = imageUrl;
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Fetch image with fallback chain:
 * 1. Try direct CORS fetch (works for Webtoon, etc.)
 * 2. Fall back to background script fetch (works for Asura, etc.)
 */
async function fetchImageWithFallback(imageUrl) {
  // If site is known to need background fetch, skip direct attempt
  if (currentSiteHandler.needsBackgroundFetch) {
    console.log('[AI Upscale] Using background fetch (site requires it)');
    return fetchImageViaBackground(imageUrl);
  }

  // Try direct fetch first
  try {
    const base64 = await fetchImageDirect(imageUrl);
    return base64;
  } catch (directError) {
    console.warn('[AI Upscale] Direct fetch failed, trying background:', directError.message);
    // Fall back to background fetch
    return fetchImageViaBackground(imageUrl);
  }
}

/**
 * Direct fetch (works for CDNs that support CORS)
 */
async function fetchImageDirect(imageUrl) {
  const response = await fetch(imageUrl, {
    mode: 'cors',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch image via background script (bypasses CORS restrictions)
 */
async function fetchImageViaBackground(imageUrl) {
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_IMAGE',
    imageUrl: imageUrl
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to fetch image via background');
  }

  return response.base64;
}

// =============================================================================
// IMAGE PROCESSING
// =============================================================================

/**
 * Process individual image
 */
async function processImage(img) {
  if (!isEnabled || !currentSiteHandler) return;

  // Check if on reading page
  if (!currentSiteHandler.isReadingPage()) {
    return;
  }

  // Get actual image URL using site-specific handler
  const actualUrl = currentSiteHandler.getImageUrl(img);
  if (!actualUrl) {
    // Image might still be lazy loading, add observer
    if (!img.dataset.urlObserverAdded) {
      img.dataset.urlObserverAdded = 'true';
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' &&
              (mutation.attributeName === 'src' || mutation.attributeName === 'data-url')) {
            observer.disconnect();
            delete img.dataset.urlObserverAdded;
            processImage(img);
          }
        });
      });
      observer.observe(img, { attributes: true, attributeFilter: ['src', 'data-url'] });
    }
    return;
  }

  // Skip animated images
  if (isAnimatedImage(actualUrl)) {
    return;
  }

  // Check if this is a manga image using site-specific handler
  if (!currentSiteHandler.isMangaImage(img)) {
    return;
  }

  const imageId = getImageId(img);

  // Check size criteria
  if (!meetsImageCriteria(img)) {
    return;
  }

  // Skip if already processed
  if (processedImages.has(imageId)) {
    return;
  }

  // Skip if already in queue
  if (imageQueue.some(item => item.imageId === imageId)) {
    return;
  }

  pageStats.totalDetected++;

  const queueItem = {
    img,
    imageId,
    actualUrl,
    verticalPosition: getImageVerticalPosition(img),
    status: 'queued',
    progress: 0,
    startTime: Date.now()
  };
  imageQueue.push(queueItem);

  // Sort queue by vertical position
  imageQueue.sort((a, b) => a.verticalPosition - b.verticalPosition);
  updatePageStatsQueue();
  addLoadingIndicator(img);
  processQueue();
}

/**
 * Process the image queue sequentially
 */
async function processQueue() {
  if (isProcessingQueue) return;
  if (imageQueue.length === 0) return;

  isProcessingQueue = true;

  while (imageQueue.length > 0) {
    const queueItem = imageQueue.shift();
    const { img, imageId, actualUrl } = queueItem;

    const imageUrl = actualUrl || currentSiteHandler.getImageUrl(img) || img.src;

    try {
      const startTime = Date.now();

      // Extract image data using canvas or fetch fallback
      const imageBase64 = await extractImageAsBase64(img, imageUrl);

      const response = await chrome.runtime.sendMessage({
        type: 'UPSCALE_IMAGE',
        imageData: imageBase64,
        imageUrl: imageUrl,
        imageId: imageId
      });

      if (response.success) {
        const endTime = Date.now();
        const upscaleTime = (endTime - startTime) / 1000;

        processedImages.add(imageId);
        replaceImage(img, response.dataUrl);
        removeLoadingIndicator(img);
        imageCache.set(imageId, response.dataUrl);
        pageStats.totalUpscaled++;
        pageStats.upscaleTimes.push(upscaleTime);
      } else {
        console.error(`[AI Upscale] Failed to upscale image: ${response.error}`);
        removeLoadingIndicator(img);
      }
    } catch (error) {
      console.error('[AI Upscale] Error processing image:', error);
      removeLoadingIndicator(img);
    }

    updatePageStatsQueue();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessingQueue = false;
  saveSessionStatistics();
}

/**
 * Detect and process all images on the page
 */
function detectAndProcessImages() {
  const images = Array.from(document.querySelectorAll('img'));

  // Sort images by vertical position
  images.sort((a, b) => getImageVerticalPosition(a) - getImageVerticalPosition(b));

  images.forEach((img) => {
    processImage(img);
  });
}

// =============================================================================
// UI HELPERS
// =============================================================================

/**
 * Replace image with upscaled version
 */
function replaceImage(img, dataUrl) {
  img.dataset.originalSrc = img.src;
  img.dataset.upscaled = 'true';
  img.src = dataUrl;
  img.style.opacity = '1';
  img.style.visibility = 'visible';
  delete img.dataset.originalOpacity;
  delete img.dataset.originalVisibility;
}

/**
 * Add loading indicator overlay to image
 */
function addLoadingIndicator(img) {
  img.dataset.originalOpacity = img.style.opacity || '1';
  img.dataset.originalVisibility = img.style.visibility || 'visible';

  const width = img.offsetWidth || img.naturalWidth;
  const height = img.offsetHeight || img.naturalHeight;

  if (width && height) {
    img.style.width = width + 'px';
    img.style.height = height + 'px';
  }
  img.style.opacity = '0';
  img.style.visibility = 'hidden';

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

  if (img.style.opacity === '0' || img.style.visibility === 'hidden') {
    img.style.opacity = img.dataset.originalOpacity || '1';
    img.style.visibility = img.dataset.originalVisibility || 'visible';
    delete img.dataset.originalOpacity;
    delete img.dataset.originalVisibility;
  }
}

// =============================================================================
// STATS & MESSAGING
// =============================================================================

/**
 * Update page stats queue
 */
function updatePageStatsQueue() {
  pageStats.queue = imageQueue.map((item) => ({
    id: item.imageId,
    imageUrl: item.actualUrl || currentSiteHandler.getImageUrl(item.img) || item.img.src,
    status: item.status || 'queued',
    progress: item.progress || 0,
    startTime: item.startTime || Date.now()
  }));

  chrome.runtime.sendMessage({
    type: 'PAGE_STATS_UPDATE',
    data: pageStats
  }).catch(() => {});
}

/**
 * Save session statistics to storage
 */
function saveSessionStatistics() {
  if (pageStats.totalUpscaled === 0) return;

  const sessionDuration = (Date.now() - pageStats.startTime) / 1000;

  chrome.storage.local.get(['sessionStats'], (result) => {
    const stats = result.sessionStats || {
      totalUpscaled: 0,
      totalTime: 0,
      upscaleTimes: [],
      sessions: []
    };

    stats.totalUpscaled = (stats.totalUpscaled || 0) + pageStats.totalUpscaled;
    stats.totalTime = (stats.totalTime || 0) + sessionDuration;
    stats.upscaleTimes = (stats.upscaleTimes || []).concat(pageStats.upscaleTimes);

    const sessionEntry = {
      timestamp: new Date().toISOString(),
      imagesUpscaled: pageStats.totalUpscaled,
      totalDetected: pageStats.totalDetected,
      totalTime: sessionDuration,
      upscaleTimes: pageStats.upscaleTimes,
      pageUrl: window.location.href,
      siteName: currentSiteHandler?.name || 'Unknown',
      avgTime: pageStats.upscaleTimes.length > 0
        ? pageStats.upscaleTimes.reduce((a, b) => a + b, 0) / pageStats.upscaleTimes.length
        : 0
    };

    stats.sessions = (stats.sessions || []).concat(sessionEntry);

    if (stats.sessions.length > 100) {
      stats.sessions = stats.sessions.slice(-100);
    }

    chrome.storage.local.set({ sessionStats: stats });
  });
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Start image detection with MutationObserver
 */
function startImageDetection() {
  detectAndProcessImages();

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
 * Initialize content script
 */
function init() {
  // Get site handler first
  currentSiteHandler = getSiteHandler();

  // Only proceed if on a supported site
  if (!isSupportedSite()) {
    console.log('[AI Upscale] Not a supported site, extension inactive');
    return;
  }

  chrome.storage.local.get(['enabled', 'whitelist', 'blacklist'], (result) => {
    isEnabled = result.enabled !== undefined ? result.enabled : CONFIG.enabledByDefault;

    if (isEnabled && currentSiteHandler.isReadingPage()) {
      startImageDetection();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'TOGGLE_EXTENSION') {
      isEnabled = request.enabled;
      if (isEnabled) {
        startImageDetection();
      }
      sendResponse({ success: true });
    } else if (request.type === 'GET_PAGE_STATS') {
      sendResponse({
        success: true,
        stats: {
          ...pageStats,
          siteName: currentSiteHandler?.name || 'Unknown',
          queue: imageQueue.map((item) => ({
            id: item.imageId,
            imageUrl: item.actualUrl || currentSiteHandler.getImageUrl(item.img) || item.img.src,
            status: item.status || 'queued',
            progress: item.progress || 0,
            startTime: item.startTime || Date.now()
          }))
        }
      });
    }
    return true;
  });
}

// Start initialization
init();
