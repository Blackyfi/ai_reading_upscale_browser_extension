// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  minImageWidth: 200,
  minImageHeight: 200,
  maxImageWidth: 3000,
  maxImageHeight: 20000,
  enabledByDefault: false,
  debug: true // Enable detailed logging
};

// =============================================================================
// DEBUG LOGGING
// =============================================================================

function debugLog(category, message, data = null) {
  if (!CONFIG.debug) return;
  const prefix = `[AI Upscale][${category}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function debugWarn(category, message, data = null) {
  if (!CONFIG.debug) return;
  const prefix = `[AI Upscale][${category}]`;
  if (data) {
    console.warn(prefix, message, data);
  } else {
    console.warn(prefix, message);
  }
}

function debugError(category, message, data = null) {
  const prefix = `[AI Upscale][${category}]`;
  if (data) {
    console.error(prefix, message, data);
  } else {
    console.error(prefix, message);
  }
}

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
  },
  'asurascans.com': {
    name: 'AsuraScans',
    isReadingPage: asuraIsReadingPage,
    isMangaImage: asuraIsMangaImage,
    getImageUrl: asuraGetImageUrl,
    needsBackgroundFetch: true // Asura CDN does NOT support CORS
  },
  'demonicscans.org': {
    name: 'DemonicScans',
    isReadingPage: demonicIsReadingPage,
    isMangaImage: demonicIsMangaImage,
    getImageUrl: demonicGetImageUrl,
    needsBackgroundFetch: true // Images served from external CDN (demoniclibs.com / librarydm.com)
  },
  'en-thunderscans.com': {
    name: 'ThunderScans',
    isReadingPage: thunderscansIsReadingPage,
    isMangaImage: thunderscansIsMangaImage,
    getImageUrl: thunderscansGetImageUrl,
    needsBackgroundFetch: true
  },
  'utoon.net': {
    name: 'Utoon',
    isReadingPage: utoonIsReadingPage,
    isMangaImage: utoonIsMangaImage,
    getImageUrl: utoonGetImageUrl,
    needsBackgroundFetch: true
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
  const url = window.location.href;
  // New layout: asurascans.com/comics/{slug}/chapter/{num}
  const hasChapterInUrl = /\/comics\/[^/]+\/chapter\/\d+/.test(url);
  // New layout: images from cdn.asurascans.com
  const hasCdnImages = document.querySelector('img[src*="cdn.asurascans.com/asura-images/chapters/"]') !== null;
  // Old layout: /storage/media/ images
  const hasMediaImages = document.querySelector('img[src*="/storage/media/"]') !== null;
  const result = hasChapterInUrl || hasCdnImages || hasMediaImages;
  debugLog('Asura', `isReadingPage check: hasChapterInUrl=${hasChapterInUrl}, hasCdnImages=${hasCdnImages}, hasMediaImages=${hasMediaImages}, URL=${url}`);
  return result;
}

function asuraIsMangaImage(img) {
  const src = img.src ? img.src.toLowerCase() : '';
  const alt = img.alt ? img.alt.toLowerCase() : '';

  debugLog('Asura', `Checking image: src="${src.substring(0, 100)}..."`, { alt, className: img.className });

  // New layout: images from cdn.asurascans.com/asura-images/chapters/
  if (src.includes('cdn.asurascans.com/asura-images/chapters/')) {
    // Verify it's inside a data-page container (chapter page wrapper)
    const pageWrapper = img.closest('[data-page]');
    if (pageWrapper) {
      debugLog('Asura', `ACCEPTED: CDN chapter image inside data-page container`);
      return true;
    }
    // Even without data-page, accept if it matches the chapter image URL pattern
    const isChapterImage = /\/chapters\/[^/]+\/\d+\/\d+\.\w+/.test(src);
    if (isChapterImage) {
      debugLog('Asura', `ACCEPTED: CDN chapter image matching URL pattern`);
      return true;
    }
    debugLog('Asura', `SKIP: CDN image but not a chapter page image`);
    return false;
  }

  // Old layout: /storage/media/ path
  if (src.includes('/storage/media/')) {
    const isChapterPage = /\/storage\/media\/\d+\/(\d{2}\.(jpg|png|webp)|conversions\/\d{2}-optimized\.(jpg|png|webp))/.test(src);
    const hasChapterAlt = alt.includes('chapter page');
    if (isChapterPage || hasChapterAlt) {
      debugLog('Asura', `ACCEPTED: Old layout chapter image`);
      return true;
    }
  }

  debugLog('Asura', `SKIP: Does not match any Asura image pattern`);
  return false;
}

function asuraGetImageUrl(img) {
  // AsuraScans uses direct src URLs
  const url = img.src || null;
  debugLog('Asura', `getImageUrl: ${url}`);
  return url;
}

// =============================================================================
// DEMONICSCANS SITE HANDLER
// =============================================================================

function demonicIsReadingPage() {
  // Chapter pages have /chapter/ in the URL path
  return window.location.pathname.includes('/chapter/');
}

function demonicIsMangaImage(img) {
  const className = img.className ? img.className.toLowerCase() : '';
  const src = img.src || '';

  // Chapter images use the 'imgholder' class
  if (!className.includes('imgholder')) {
    return false;
  }

  // Chapter images are served from the CDN domains; filter out local site images (ads, etc.)
  if (!src.includes('demoniclibs.com') && !src.includes('librarydm.com')) {
    return false;
  }

  return true;
}

function demonicGetImageUrl(img) {
  return img.src || null;
}

// =============================================================================
// THUNDERSCANS SITE HANDLER
// =============================================================================

function thunderscansIsReadingPage() {
  // Chapter reading pages contain the #readerarea element and chapterbody class
  return !!document.querySelector('#readerarea') || !!document.querySelector('.chapterbody');
}

function thunderscansIsMangaImage(img) {
  const className = img.className || '';
  const src = img.src || '';

  // Chapter images use the 'ts-main-image' class
  if (!className.includes('ts-main-image')) {
    return false;
  }

  // Images are served from wp-content/uploads/manga/
  if (!src.includes('/wp-content/uploads/manga/')) {
    return false;
  }

  return true;
}

function thunderscansGetImageUrl(img) {
  return img.src || null;
}

// =============================================================================
// UTOON SITE HANDLER (Madara / WP-Manga theme)
// =============================================================================

function utoonIsReadingPage() {
  // Madara theme reading pages have the 'reading-manga' body class and /chapter-* in URL
  return document.body.classList.contains('reading-manga') ||
         /\/chapter-\d+/.test(window.location.pathname);
}

function utoonIsMangaImage(img) {
  const src = img.src || '';

  // Chapter images are served from /wp-content/uploads/WP-manga/data/
  if (!src.includes('/wp-content/uploads/WP-manga/data/')) {
    return false;
  }

  // Verify the image is inside the reading content area
  const readingContent = img.closest('.reading-content');
  if (!readingContent) {
    return false;
  }

  return true;
}

function utoonGetImageUrl(img) {
  return img.src ? img.src.trim() : null;
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

  debugLog('Size', `Initial dimensions: ${width}x${height}, complete=${img.complete}`, { src: img.src?.substring(0, 80) });

  // For lazy-loaded images, check explicit dimensions
  const actualUrl = currentSiteHandler.getImageUrl(img);
  const isPlaceholderLoaded = img.src && (img.src.includes('bg_transparency') || img.src.includes('placeholder'));

  if (isPlaceholderLoaded && actualUrl) {
    const attrWidth = parseInt(img.getAttribute('width'), 10);
    const attrHeight = parseInt(img.getAttribute('height'), 10);
    if (attrWidth > 0 && attrHeight > 0) {
      width = attrWidth;
      height = attrHeight;
      debugLog('Size', `Using attribute dimensions: ${width}x${height}`);
    }
  }

  // Wait for lazy-loaded images to have dimensions
  if (width === 0 || height === 0 || (!img.complete && !isPlaceholderLoaded)) {
    debugLog('Size', `DEFER: Image not loaded yet (${width}x${height}, complete=${img.complete}), adding load listener`);
    if (!img.dataset.loadListenerAdded) {
      img.dataset.loadListenerAdded = 'true';
      img.addEventListener('load', () => {
        debugLog('Size', `Image load event fired, reprocessing`);
        delete img.dataset.loadListenerAdded;
        processImage(img);
      }, { once: true });
    }
    return false;
  }

  if (width < CONFIG.minImageWidth || height < CONFIG.minImageHeight) {
    debugLog('Size', `SKIP: Too small (${width}x${height}), min required: ${CONFIG.minImageWidth}x${CONFIG.minImageHeight}`);
    return false;
  }

  if (width > CONFIG.maxImageWidth || height > CONFIG.maxImageHeight) {
    debugLog('Size', `SKIP: Too large (${width}x${height}), max allowed: ${CONFIG.maxImageWidth}x${CONFIG.maxImageHeight}`);
    return false;
  }

  debugLog('Size', `ACCEPTED: Dimensions OK (${width}x${height})`);
  return true;
}

// =============================================================================
// IMAGE FETCHING (CORS HANDLING)
// =============================================================================

/**
 * Extract image data using canvas (works for images with CORS support)
 */
async function extractImageAsBase64(img, imageUrl) {
  debugLog('Fetch', `Starting extraction for: ${imageUrl}`);
  debugLog('Fetch', `Site needsBackgroundFetch: ${currentSiteHandler.needsBackgroundFetch}`);

  return new Promise((resolve, reject) => {
    try {
      // If site needs background fetch, skip canvas attempt entirely
      if (currentSiteHandler.needsBackgroundFetch) {
        debugLog('Fetch', `Skipping canvas (site requires background fetch), going directly to fetchImageWithFallback`);
        fetchImageWithFallback(imageUrl).then(resolve).catch(reject);
        return;
      }

      debugLog('Fetch', `Attempting canvas extraction with crossOrigin='anonymous'`);
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';

      tempImg.onload = () => {
        debugLog('Fetch', `Canvas: Image loaded (${tempImg.naturalWidth}x${tempImg.naturalHeight})`);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = tempImg.naturalWidth;
          canvas.height = tempImg.naturalHeight;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(tempImg, 0, 0);

          let dataUrl;
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            debugLog('Fetch', `Canvas: Successfully extracted as JPEG (${dataUrl.length} chars)`);
          } catch (e) {
            debugLog('Fetch', `Canvas: JPEG failed, trying PNG`);
            dataUrl = canvas.toDataURL('image/png');
            debugLog('Fetch', `Canvas: Successfully extracted as PNG (${dataUrl.length} chars)`);
          }

          resolve(dataUrl);
        } catch (canvasError) {
          // Canvas tainted - try fetch methods
          debugWarn('Fetch', `Canvas TAINTED (CORS issue), falling back to fetch methods`, canvasError.message);
          fetchImageWithFallback(imageUrl).then(resolve).catch(reject);
        }
      };

      tempImg.onerror = (err) => {
        // Image failed to load with crossOrigin, try fetch methods
        debugWarn('Fetch', `Canvas: Image failed to load with crossOrigin, trying fetch fallback`, err);
        fetchImageWithFallback(imageUrl).then(resolve).catch(reject);
      };

      tempImg.src = imageUrl;
    } catch (error) {
      debugError('Fetch', `Canvas extraction threw exception`, error);
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
  debugLog('Fetch', `fetchImageWithFallback called for: ${imageUrl}`);

  // If site is known to need background fetch, skip direct attempt
  if (currentSiteHandler.needsBackgroundFetch) {
    debugLog('Fetch', `Site requires background fetch, skipping direct fetch attempt`);
    return fetchImageViaBackground(imageUrl);
  }

  // Try direct fetch first
  debugLog('Fetch', `Attempting direct CORS fetch first`);
  try {
    const base64 = await fetchImageDirect(imageUrl);
    debugLog('Fetch', `Direct fetch succeeded (${base64.length} chars)`);
    return base64;
  } catch (directError) {
    debugWarn('Fetch', `Direct fetch FAILED: ${directError.message}, trying background fetch`);
    // Fall back to background fetch
    return fetchImageViaBackground(imageUrl);
  }
}

/**
 * Direct fetch (works for CDNs that support CORS)
 */
async function fetchImageDirect(imageUrl) {
  debugLog('Fetch', `fetchImageDirect: Starting fetch with mode='cors'`);

  const response = await fetch(imageUrl, {
    mode: 'cors',
    credentials: 'omit'
  });

  debugLog('Fetch', `fetchImageDirect: Response status=${response.status}, ok=${response.ok}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const blob = await response.blob();
  debugLog('Fetch', `fetchImageDirect: Got blob, size=${blob.size}, type=${blob.type}`);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      debugLog('Fetch', `fetchImageDirect: FileReader complete (${reader.result?.length} chars)`);
      resolve(reader.result);
    };
    reader.onerror = (err) => {
      debugError('Fetch', `fetchImageDirect: FileReader error`, err);
      reject(err);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch image via background script (bypasses CORS restrictions)
 */
async function fetchImageViaBackground(imageUrl) {
  debugLog('Fetch', `fetchImageViaBackground: Sending FETCH_IMAGE message to background script`);
  debugLog('Fetch', `fetchImageViaBackground: URL = ${imageUrl}`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_IMAGE',
      imageUrl: imageUrl
    });

    debugLog('Fetch', `fetchImageViaBackground: Got response from background`, {
      success: response?.success,
      hasBase64: !!response?.base64,
      base64Length: response?.base64?.length,
      error: response?.error
    });

    if (!response) {
      throw new Error('No response from background script (extension may need reload)');
    }

    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch image via background');
    }

    debugLog('Fetch', `fetchImageViaBackground: SUCCESS (${response.base64?.length} chars)`);
    return response.base64;
  } catch (err) {
    debugError('Fetch', `fetchImageViaBackground: FAILED`, err.message);
    throw err;
  }
}

// =============================================================================
// IMAGE PROCESSING
// =============================================================================

/**
 * Process individual image
 */
async function processImage(img) {
  const imgSrc = img.src?.substring(0, 80) || 'no-src';

  if (!isEnabled) {
    debugLog('Process', `SKIP: Extension is disabled`, { src: imgSrc });
    return;
  }

  if (!currentSiteHandler) {
    debugLog('Process', `SKIP: No site handler available`, { src: imgSrc });
    return;
  }

  // Check if on reading page
  if (!currentSiteHandler.isReadingPage()) {
    debugLog('Process', `SKIP: Not on a reading page`, { src: imgSrc });
    return;
  }

  // Get actual image URL using site-specific handler
  const actualUrl = currentSiteHandler.getImageUrl(img);
  if (!actualUrl) {
    debugLog('Process', `DEFER: No URL available yet, adding observer`, { src: imgSrc });
    // Image might still be lazy loading, add observer
    if (!img.dataset.urlObserverAdded) {
      img.dataset.urlObserverAdded = 'true';
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' &&
              (mutation.attributeName === 'src' || mutation.attributeName === 'data-url')) {
            debugLog('Process', `URL attribute changed, reprocessing`);
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
    debugLog('Process', `SKIP: Animated image (GIF/emoji)`, { url: actualUrl });
    return;
  }

  // Check if this is a manga image using site-specific handler
  if (!currentSiteHandler.isMangaImage(img)) {
    debugLog('Process', `SKIP: Not a manga image (handler rejected)`, { url: actualUrl?.substring(0, 80) });
    return;
  }

  const imageId = getImageId(img);

  // Check size criteria
  if (!meetsImageCriteria(img)) {
    debugLog('Process', `SKIP: Does not meet size criteria`, { url: actualUrl?.substring(0, 80) });
    return;
  }

  // Skip if already processed — but serve from cache if this DOM element wasn't replaced yet
  if (processedImages.has(imageId)) {
    if (imageCache.has(imageId) && !img.dataset.upscaled) {
      debugLog('Process', `CACHE HIT: Applying cached upscale to new DOM element`, { url: actualUrl?.substring(0, 80) });
      replaceImage(img, imageCache.get(imageId));
    } else {
      debugLog('Process', `SKIP: Already processed`, { url: actualUrl?.substring(0, 80) });
    }
    return;
  }

  // Skip if already in queue
  if (imageQueue.some(item => item.imageId === imageId)) {
    debugLog('Process', `SKIP: Already in queue`, { url: actualUrl?.substring(0, 80) });
    return;
  }

  debugLog('Process', `QUEUED: Adding image to upscale queue`, { url: actualUrl, imageId: imageId.substring(0, 20) });
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
  // Don't hide the original image yet — keep it visible so the user can read
  // while earlier images are being upscaled. The loading indicator will be
  // added only when this image starts being actively processed.
  processQueue();
}

/**
 * Process the image queue sequentially
 */
async function processQueue() {
  if (isProcessingQueue) {
    debugLog('Queue', `Queue already processing, skipping`);
    return;
  }
  if (imageQueue.length === 0) {
    debugLog('Queue', `Queue is empty, nothing to process`);
    return;
  }

  debugLog('Queue', `Starting queue processing, ${imageQueue.length} items`);
  isProcessingQueue = true;

  while (imageQueue.length > 0) {
    const queueItem = imageQueue.shift();
    const { img, imageId, actualUrl } = queueItem;

    const imageUrl = actualUrl || currentSiteHandler.getImageUrl(img) || img.src;
    debugLog('Queue', `Processing image: ${imageUrl?.substring(0, 80)}...`);

    // Show loading indicator only when actively processing this image
    addLoadingIndicator(img);

    try {
      const startTime = Date.now();

      // Extract image data using canvas or fetch fallback
      debugLog('Queue', `Step 1: Extracting image data...`);
      const imageBase64 = await extractImageAsBase64(img, imageUrl);
      debugLog('Queue', `Step 1 COMPLETE: Got base64 (${imageBase64?.length} chars)`);

      // Check if image is too large
      const imageSizeMB = imageBase64?.length / 1024 / 1024;
      if (imageSizeMB > 20) {
        debugError('Queue', `Image is too large (${imageSizeMB.toFixed(2)} MB), skipping`);
        showNotification('Image Too Large', `Image is ${imageSizeMB.toFixed(1)}MB - skipping to avoid memory issues.`, 'warning');
        removeLoadingIndicator(img);
        continue; // Skip to next image
      }

      debugLog('Queue', `Step 2: Sending UPSCALE_IMAGE to background...`);
      debugLog('Queue', `Message size: ${imageBase64?.length} chars (${imageSizeMB.toFixed(2)} MB)`);

      const response = await chrome.runtime.sendMessage({
        type: 'UPSCALE_IMAGE',
        imageData: imageBase64,
        imageUrl: imageUrl,
        imageId: imageId
      }).catch(err => {
        debugError('Queue', `chrome.runtime.sendMessage failed: ${err.message}`, err);
        throw new Error(`Failed to send message to background: ${err.message}`);
      });

      if (chrome.runtime.lastError) {
        throw new Error(`Chrome runtime error: ${chrome.runtime.lastError.message}`);
      }

      debugLog('Queue', `Step 2 COMPLETE: Got response`, {
        success: response?.success,
        hasDataUrl: !!response?.dataUrl,
        dataUrlLength: response?.dataUrl?.length,
        error: response?.error
      });

      if (!response) {
        throw new Error('No response from background script - message may have failed to send');
      }

      if (response.success) {
        const endTime = Date.now();
        const upscaleTime = (endTime - startTime) / 1000;

        processedImages.add(imageId);
        replaceImage(img, response.dataUrl);
        removeLoadingIndicator(img);
        imageCache.set(imageId, response.dataUrl);
        pageStats.totalUpscaled++;
        pageStats.upscaleTimes.push(upscaleTime);
        debugLog('Queue', `SUCCESS: Image upscaled in ${upscaleTime.toFixed(2)}s`);
      } else {
        debugError('Queue', `FAILED: Upscale returned error: ${response?.error}`);
        removeLoadingIndicator(img);

        // Show notification if server is not available
        if (response?.error && response.error.includes('Server not available')) {
          showNotification('AI Upscale Server Not Running', 'Please start the upscale server at http://127.0.0.1:5000', 'error');
        } else if (response?.error && response.error.includes('timed out')) {
          showNotification('AI Upscale Timeout', 'The upscale server took too long to respond. It may be overloaded.', 'warning');
        }
      }
    } catch (error) {
      debugError('Queue', `EXCEPTION during processing: ${error.message}`, error);
      removeLoadingIndicator(img);

      // Show notification for errors
      if (error.message.includes('Extension context invalidated')) {
        debugLog('Queue', 'Extension was reloaded, stopping queue processing');
        isProcessingQueue = false;
        return; // Exit the queue processing
      } else if (error.message.includes('message may have failed to send')) {
        showNotification('Message Send Failed', 'The image may be too large to send to the upscale server.', 'error');
      } else {
        showNotification('Upscale Error', error.message, 'error');
      }

      // Continue processing next image even if this one failed
      debugLog('Queue', `Continuing to next image in queue...`);
    }

    updatePageStatsQueue();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  debugLog('Queue', `Queue processing complete. Total upscaled: ${pageStats.totalUpscaled}`);
  isProcessingQueue = false;
  saveSessionStatistics();
}

/**
 * Detect and process all images on the page
 */
function detectAndProcessImages() {
  const images = Array.from(document.querySelectorAll('img'));
  debugLog('Detect', `Found ${images.length} total <img> elements on page`);

  // Sort images by vertical position
  images.sort((a, b) => getImageVerticalPosition(a) - getImageVerticalPosition(b));

  debugLog('Detect', `Processing images in order of vertical position...`);
  images.forEach((img, index) => {
    debugLog('Detect', `--- Image ${index + 1}/${images.length} ---`);
    processImage(img);
  });

  debugLog('Detect', `Initial scan complete. Queue size: ${imageQueue.length}, Detected: ${pageStats.totalDetected}`);
}

// =============================================================================
// UI HELPERS
// =============================================================================

/**
 * Replace image with upscaled version
 */
function replaceImage(img, dataUrl) {
  img.dataset.originalSrc = img.src;
  // Remove loading overlay attribute first so CSS stops applying 0.3 opacity
  delete img.dataset.loadingOverlay;
  // Setting data-upscaled makes the CSS rule `img[data-upscaled="true"] { opacity: 1 !important }`
  // kick in immediately and persistently — no site JS can override it.
  img.dataset.upscaled = 'true';
  img.src = dataUrl;
  // Force full opacity inline as well — some sites (e.g. AsuraScans) use framework-driven
  // transitions/lazy-load CSS that can override even !important stylesheet rules.
  img.style.setProperty('opacity', '1', 'important');
  img.style.setProperty('visibility', 'visible', 'important');
  // Also ensure the parent container is fully visible (some sites fade the wrapper div)
  const parent = img.parentElement;
  if (parent) {
    parent.style.setProperty('opacity', '1', 'important');
    parent.style.setProperty('visibility', 'visible', 'important');
  }
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
  //img.style.setProperty('opacity', '0.3', 'important');
  img.style.setProperty('visibility', 'visible', 'important');

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

  // Ensure styles are injected (in case startImageDetection hasn't run yet)
  injectUpscaleStyles();

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

  // On the success path, replaceImage owns visibility restoration via decode/load.
  if (img.dataset.upscaled) return;

  // Restore original opacity on failure/cancellation. Check for any non-normal
  // opacity value (loading state uses '0.3').
  if (img.dataset.originalOpacity !== undefined || img.style.opacity !== '' && img.style.opacity !== '1') {
    img.style.setProperty('opacity', img.dataset.originalOpacity || '1', 'important');
    img.style.setProperty('visibility', img.dataset.originalVisibility || 'visible', 'important');
    delete img.dataset.originalOpacity;
    delete img.dataset.originalVisibility;
  }
}

/**
 * Show a notification to the user
 */
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 10000; // 10 seconds between notifications

function showNotification(title, message, type = 'info') {
  // Prevent notification spam
  const now = Date.now();
  if (now - lastNotificationTime < NOTIFICATION_COOLDOWN) {
    debugLog('Notification', 'Skipping notification (cooldown active)');
    return;
  }
  lastNotificationTime = now;

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'error' ? '#ff4444' : type === 'warning' ? '#ff9800' : '#4CAF50'};
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 999999;
    max-width: 400px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    animation: slideIn 0.3s ease-out;
  `;

  notification.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
    <div style="opacity: 0.95;">${message}</div>
  `;

  document.body.appendChild(notification);

  // Remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

// Add notification animations
if (!document.getElementById('ai-upscale-notification-styles')) {
  const style = document.createElement('style');
  style.id = 'ai-upscale-notification-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
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
function injectUpscaleStyles() {
  if (document.getElementById('ai-upscale-styles')) return;
  const style = document.createElement('style');
  style.id = 'ai-upscale-styles';
  style.textContent = `
    @keyframes ai-upscale-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    /* Force upscaled images to be fully visible regardless of site CSS/JS */
    img[data-upscaled="true"] {
      opacity: 1 !important;
      visibility: visible !important;
    }
    /* Force loading state to be visible at reduced opacity */
    img[data-loading-overlay="true"] {
      opacity: 1 !important;
      visibility: visible !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function startImageDetection() {
  injectUpscaleStyles();
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
      // Also catch attribute changes (e.g. src set on existing img)
      if (mutation.type === 'attributes' && mutation.target.nodeName === 'IMG') {
        processImage(mutation.target);
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'data-url']
  });

  // Periodic rescan for sites with lazy-loading that adds images on scroll
  // (e.g. AsuraScans only injects <img> when scrolled into viewport)
  let rescanInterval = setInterval(() => {
    if (!isEnabled) return;
    const images = document.querySelectorAll('img');
    images.forEach((img) => {
      if (!img.dataset.upscaled && !img.dataset.loadListenerAdded && !img.dataset.urlObserverAdded) {
        processImage(img);
      }
    });
  }, 2000);

  // Clean up interval when page unloads
  window.addEventListener('beforeunload', () => clearInterval(rescanInterval));
}

/**
 * Initialize content script
 */
function init() {
  console.log('[AI Upscale] ========================================');
  console.log('[AI Upscale] Content script initializing...');
  console.log('[AI Upscale] URL:', window.location.href);
  console.log('[AI Upscale] Hostname:', window.location.hostname);
  console.log('[AI Upscale] ========================================');

  // Get site handler first
  currentSiteHandler = getSiteHandler();
  debugLog('Init', `Site handler selected: ${currentSiteHandler.name}`, {
    needsBackgroundFetch: currentSiteHandler.needsBackgroundFetch
  });

  // Only proceed if on a supported site
  if (!isSupportedSite()) {
    console.log('[AI Upscale] Not a supported site, extension inactive');
    console.log('[AI Upscale] Supported sites:', Object.keys(SITE_HANDLERS).join(', '));
    return;
  }

  debugLog('Init', `Site is supported, checking storage settings...`);

  chrome.storage.local.get(['enabled', 'whitelist', 'blacklist'], (result) => {
    isEnabled = result.enabled !== undefined ? result.enabled : CONFIG.enabledByDefault;
    debugLog('Init', `Extension enabled: ${isEnabled} (from storage: ${result.enabled}, default: ${CONFIG.enabledByDefault})`);

    const isReading = currentSiteHandler.isReadingPage();
    debugLog('Init', `Is reading page: ${isReading}`);

    if (isEnabled && isReading) {
      debugLog('Init', `Starting image detection...`);
      startImageDetection();
    } else if (!isEnabled) {
      debugLog('Init', `Extension is disabled, not starting detection`);
    } else if (!isReading) {
      debugLog('Init', `Not on a reading page, not starting detection`);
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    debugLog('Message', `Received message: ${request.type}`);
    if (request.type === 'TOGGLE_EXTENSION') {
      isEnabled = request.enabled;
      debugLog('Message', `Extension toggled: ${isEnabled}`);
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
