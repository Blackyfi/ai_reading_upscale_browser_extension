const CONFIG = {
  minImageWidth: 200,
  minImageHeight: 200,
  maxImageWidth: 2000,
  maxImageHeight: 20000,  // Increased for manhwa/webtoons
  enabledByDefault: false
};

let isEnabled = CONFIG.enabledByDefault;
let processedImages = new Set();
let imageCache = new Map();
let imageQueue = [];
let isProcessingQueue = false;

let pageStats = {
  totalDetected: 0,
  totalUpscaled: 0,
  startTime: Date.now(),
  upscaleTimes: [],
  queue: []
};

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

init();

/**
 * Initialize content script
 */
function init() {
  chrome.storage.local.get(['enabled', 'whitelist', 'blacklist'], (result) => {
    isEnabled = result.enabled !== undefined ? result.enabled : CONFIG.enabledByDefault;

    if (isEnabled && shouldProcessSite()) {
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
          queue: imageQueue.map((item) => ({
            id: item.imageId,
            imageUrl: item.actualUrl || getActualImageUrl(item.img) || item.img.src,
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

/**
 * Check if current site is a known manga/manhwa site
 */
function shouldProcessSite() {
  return MANGA_SITES.some(site => window.location.hostname.includes(site));
}

/**
 * Start image detection with MutationObserver for dynamic content
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
 * Get vertical position of an image on the page
 */
function getImageVerticalPosition(img) {
  const rect = img.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  return rect.top + scrollTop;
}

/**
 * Detect and process all images on the page
 */
function detectAndProcessImages() {
  const images = Array.from(document.querySelectorAll('img'));

  // Sort images by their vertical position (top of page first)
  images.sort((a, b) => getImageVerticalPosition(a) - getImageVerticalPosition(b));

  images.forEach((img) => {
    processImage(img);
  });
}

/**
 * Get the actual image URL, handling lazy-loading patterns
 * Some sites (like Webtoons) use data-url attribute for lazy loading
 */
function getActualImageUrl(img) {
  // Check for data-url attribute (used by Webtoons)
  const dataUrl = img.getAttribute('data-url');
  if (dataUrl && !dataUrl.includes('bg_transparency') && !dataUrl.includes('placeholder')) {
    return dataUrl;
  }

  // Check for data-src attribute (common lazy loading pattern)
  const dataSrc = img.getAttribute('data-src');
  if (dataSrc && !dataSrc.includes('bg_transparency') && !dataSrc.includes('placeholder')) {
    return dataSrc;
  }

  // Check if current src is a placeholder
  const src = img.src || '';
  if (src.includes('bg_transparency') || src.includes('placeholder')) {
    return null; // No actual URL available yet
  }

  return src;
}

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
 * Check if image is a UI element rather than manga content
 */
function isUIElement(img) {
  if (!img) return false;

  const src = img.src ? img.src.toLowerCase() : '';
  const alt = img.alt ? img.alt.toLowerCase() : '';
  const className = img.className ? img.className.toLowerCase() : '';

  // MangaDex uses blob URLs for chapter pages with class="img ls limit-width"
  // Must check before other filters that might reject manga images
  if (window.location.hostname.includes('mangadex.org')) {
    if (className.includes('img') && className.includes('limit-width')) {
      return false;
    }
    return true;
  }

  // AsuraComic: Only process chapter page images, not covers or thumbnails
  if (window.location.hostname.includes('asuracomic.net')) {
    const isMangaPath = src.includes('/storage/media/');
    if (isMangaPath) {
      const isChapterPage = /\/storage\/media\/\d+\/(\d{2}\.(jpg|png|webp)|conversions\/\d{2}-optimized\.(jpg|png|webp))/.test(src);
      const hasChapterAlt = alt.includes('chapter page');
      if (isChapterPage || hasChapterAlt) {
        return false;
      }
      return true;
    }
    return true;
  }

  // Webtoon: Only process images on viewer pages (actual chapter reading)
  // Skip thumbnails/posters on homepage, list pages, and rankings
  if (window.location.hostname.includes('webtoons.com')) {
    const currentUrl = window.location.href.toLowerCase();
    const isViewerPage = currentUrl.includes('/viewer');

    // If not on a viewer page, skip all images (homepage, list, rankings, etc.)
    if (!isViewerPage) {
      return true;
    }

    // On viewer pages, only process actual chapter content images
    // Chapter content images have class "_images" and are in the #_imageList container
    // Episode thumbnails have class "_thumbnailImages" and should be skipped
    if (className.includes('_images') && !className.includes('_thumbnailimages')) {
      // Get the actual URL (might be in data-url for lazy-loaded images)
      const actualUrl = getActualImageUrl(img);
      const urlToCheck = (actualUrl || src).toLowerCase();

      // Filter out any remaining thumbnails by URL pattern
      if (urlToCheck.includes('/thumb_') || urlToCheck.includes('thumb_poster')) {
        return true;
      }
      return false; // This is actual chapter content
    }

    // Skip all other images on viewer pages (thumbnails, UI, etc.)
    return true;
  }

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

  if (className.includes('rounded-full') || className.includes('rounded-circle')) {
    return true;
  }

  if (alt && !alt.includes('chapter') && !alt.includes('page') && !alt.includes('comic')) {
    const nonMangaAltPatterns = ['user', 'profile', 'close', 'menu', 'search'];
    for (const pattern of nonMangaAltPatterns) {
      if (alt.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Process individual image
 */
async function processImage(img) {
  if (!isEnabled) return;

  // Get actual image URL (handles lazy-loading patterns)
  const actualUrl = getActualImageUrl(img);
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

  if (isAnimatedImage(actualUrl)) {
    return;
  }

  if (isUIElement(img)) {
    return;
  }

  const imageId = getImageId(img);

  // Check size criteria before processing (allows re-checking lazy-loaded images)
  if (!meetsImageCriteria(img)) {
    return;
  }

  // Skip if already processed (after size check for lazy-loaded image re-evaluation)
  if (processedImages.has(imageId)) {
    return;
  }

  if (imageQueue.some(item => item.imageId === imageId)) {
    return;
  }

  // Only count as detected after all validation and deduplication checks pass
  pageStats.totalDetected++;

  const queueItem = {
    img,
    imageId,
    actualUrl, // Store the actual URL for upscaling
    verticalPosition: getImageVerticalPosition(img), // Store position for sorting
    status: 'queued',
    progress: 0,
    startTime: Date.now()
  };
  imageQueue.push(queueItem);

  // Sort queue by vertical position to ensure top images are processed first
  imageQueue.sort((a, b) => a.verticalPosition - b.verticalPosition);
  updatePageStatsQueue();
  addLoadingIndicator(img);
  processQueue();
}

/**
 * Update page stats queue
 */
function updatePageStatsQueue() {
  pageStats.queue = imageQueue.map((item) => ({
    id: item.imageId,
    imageUrl: item.actualUrl || getActualImageUrl(item.img) || item.img.src,
    status: item.status || 'queued',
    progress: item.progress || 0,
    startTime: item.startTime || Date.now()
  }));

  chrome.runtime.sendMessage({
    type: 'PAGE_STATS_UPDATE',
    data: pageStats
  }).catch(() => {}); // Popup not open
}

/**
 * Extract image data using canvas (works for already-loaded images)
 * This bypasses CORS since the image is already rendered in the DOM
 */
async function extractImageAsBase64(img, imageUrl) {
  return new Promise((resolve, reject) => {
    try {
      // Create a temporary image to ensure it's fully loaded
      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';

      tempImg.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = tempImg.naturalWidth;
          canvas.height = tempImg.naturalHeight;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(tempImg, 0, 0);

          // Try to get as JPEG for smaller size, fallback to PNG
          let dataUrl;
          try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          } catch (e) {
            dataUrl = canvas.toDataURL('image/png');
          }

          resolve(dataUrl);
        } catch (canvasError) {
          // Canvas tainted - fall back to fetch method
          console.warn('Canvas tainted, trying fetch fallback:', canvasError);
          fetchImageAsBase64Fallback(imageUrl).then(resolve).catch(reject);
        }
      };

      tempImg.onerror = () => {
        // Image failed to load with crossOrigin, try fetch fallback
        fetchImageAsBase64Fallback(imageUrl).then(resolve).catch(reject);
      };

      // Try loading with the actual URL
      tempImg.src = imageUrl;
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Fallback: Fetch image without credentials (for CDNs that don't require auth)
 */
async function fetchImageAsBase64Fallback(imageUrl) {
  try {
    // Try without credentials first (works for public CDNs like Webtoon)
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
  } catch (error) {
    console.error('Failed to fetch image:', error);
    throw error;
  }
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

    // Use actualUrl if available, otherwise get it again
    const imageUrl = actualUrl || getActualImageUrl(img) || img.src;

    try {
      const startTime = Date.now();

      // Extract image data using canvas or fetch fallback
      const imageBase64 = await extractImageAsBase64(img, imageUrl);

      const response = await chrome.runtime.sendMessage({
        type: 'UPSCALE_IMAGE',
        imageData: imageBase64,  // Send base64 data instead of URL
        imageUrl: imageUrl,      // Keep URL for reference/logging
        imageId: imageId
      });

      if (response.success) {
        const endTime = Date.now();
        const upscaleTime = (endTime - startTime) / 1000;

        // Mark as processed only after successful upscaling
        processedImages.add(imageId);
        replaceImage(img, response.dataUrl);
        removeLoadingIndicator(img);
        imageCache.set(imageId, response.dataUrl);
        pageStats.totalUpscaled++;
        pageStats.upscaleTimes.push(upscaleTime);
      } else {
        console.error(`Failed to upscale image: ${response.error}`);
        removeLoadingIndicator(img);
        // Don't mark as processed to allow retry
      }
    } catch (error) {
      console.error('Error processing image:', error);
      removeLoadingIndicator(img);
      // Don't mark as processed to allow retry
    }

    updatePageStatsQueue();
    // Small delay to avoid overwhelming server
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  isProcessingQueue = false;
  saveSessionStatistics();
}

/**
 * Check if image meets criteria for upscaling
 */
function meetsImageCriteria(img) {
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  // For lazy-loaded images, naturalWidth/Height might be from placeholder
  // Check if src is a placeholder and we have explicit dimensions
  const actualUrl = getActualImageUrl(img);
  const isPlaceholderLoaded = img.src && (img.src.includes('bg_transparency') || img.src.includes('placeholder'));

  if (isPlaceholderLoaded && actualUrl) {
    // Use explicit width/height attributes if available (common on Webtoons)
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

/**
 * Generate unique ID for image using base64 encoded actual URL
 */
function getImageId(img) {
  const actualUrl = getActualImageUrl(img) || img.src;
  return btoa(actualUrl);
}

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
 * Remove loading indicator and restore visibility if needed
 */
function removeLoadingIndicator(img) {
  if (img.loadingOverlay && img.loadingOverlay.parentNode) {
    img.loadingOverlay.parentNode.removeChild(img.loadingOverlay);
    img.loadingOverlay = null;
    delete img.dataset.loadingOverlay;
  }

  // Restore visibility if upscaling failed
  if (img.style.opacity === '0' || img.style.visibility === 'hidden') {
    img.style.opacity = img.dataset.originalOpacity || '1';
    img.style.visibility = img.dataset.originalVisibility || 'visible';
    delete img.dataset.originalOpacity;
    delete img.dataset.originalVisibility;
  }
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
      avgTime: pageStats.upscaleTimes.length > 0
        ? pageStats.upscaleTimes.reduce((a, b) => a + b, 0) / pageStats.upscaleTimes.length
        : 0
    };

    stats.sessions = (stats.sessions || []).concat(sessionEntry);

    // Keep only last 100 sessions
    if (stats.sessions.length > 100) {
      stats.sessions = stats.sessions.slice(-100);
    }

    chrome.storage.local.set({ sessionStats: stats });
  });
}
