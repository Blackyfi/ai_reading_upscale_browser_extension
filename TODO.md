# AI Reading Upscale Browser Extension - TODO List

## Setup & Dependencies

- [ ] Set up project structure (folders for extension, server, models)
- [ ] Download and verify RealESRGAN_x4plus_anime_6B.pth model (17.9 MB)
- [ ] Install realesrgan-ncnn-vulkan executable
- [ ] Set up Python/Node.js environment for local server
- [ ] Configure NVIDIA CUDA/Vulkan for RTX 5070 Ti

## Local Upscaling Server

- [ ] Create REST API server (Python Flask/FastAPI or Node.js Express)
- [ ] Implement image upload endpoint
- [ ] Integrate realesrgan-ncnn-vulkan executable wrapper
- [ ] Set up RealESRGAN_x4plus_anime_6B model loading
- [ ] Implement image queue management system
- [ ] Add support for JPG, PNG, WebP formats
- [ ] Create image caching mechanism
- [ ] Add health check endpoint
- [ ] Implement error handling and logging
- [ ] Test GPU acceleration performance (target: 5-6 sec/image)
- [ ] Add configuration options (upscale factor 2x-4x)

## Chrome Extension - Manifest & Structure

- [ ] Create manifest.json (Manifest V3)
- [ ] Define required permissions (storage, host permissions, activeTab)
- [ ] Set up content scripts configuration
- [ ] Configure background service worker
- [ ] Create popup HTML structure
- [ ] Set up extension icons (16x16, 32x32, 48x48, 128x128)

## Chrome Extension - Content Script

- [ ] Implement image detection on page load
- [ ] Create MutationObserver for dynamically loaded images
- [ ] Identify manga/manhwa/webtoon image patterns
- [ ] Extract image URLs and metadata
- [ ] Send images to background service worker
- [ ] Replace original images with upscaled versions
- [ ] Preserve original image attributes (alt, class, dimensions)
- [ ] Maintain page layout during replacement
- [ ] Add visual loading indicator during upscaling
- [ ] Handle image replacement errors gracefully

## Chrome Extension - Background Service Worker

- [ ] Create communication bridge with content scripts
- [ ] Implement server communication (localhost API calls)
- [ ] Handle image upload to local server
- [ ] Receive and process upscaled images
- [ ] Implement retry logic for failed requests
- [ ] Add request queue management
- [ ] Handle server unavailable scenarios

## Chrome Extension - Popup UI

- [ ] Design and create popup.html
- [ ] Add on/off toggle button
- [ ] Display extension status indicator
- [ ] Show upscaling progress/statistics
- [ ] Create settings panel
- [ ] Add whitelist/blacklist management UI
- [ ] Implement upscale factor selector (2x-4x)
- [ ] Add cache clear button
- [ ] Style with CSS

## Chrome Extension - Storage & Caching

- [ ] Implement chrome.storage API for settings
- [ ] Create cache system for upscaled images
- [ ] Store user preferences (on/off state, whitelist/blacklist)
- [ ] Implement cache expiration logic
- [ ] Add cache size limit management
- [ ] Store processed image hashes to avoid re-upscaling

## Site Detection & Compatibility

- [ ] Identify popular manga sites (MangaDex, MangaPlus, etc.)
- [ ] Identify manhwa sites (Webtoon, Tapas, etc.)
- [ ] Create site-specific selectors for image detection
- [ ] Test compatibility with different site layouts
- [ ] Implement site whitelist/blacklist functionality
- [ ] Add auto-detection for manga/webtoon images

## Testing & Optimization

- [ ] Test image interception on multiple sites
- [ ] Verify GPU acceleration is working
- [ ] Measure upscaling performance (5-6 sec target)
- [ ] Test cache hit/miss scenarios
- [ ] Verify memory usage is acceptable
- [ ] Test with different image sizes and formats
- [ ] Test extension on/off toggle
- [ ] Validate image quality improvements
- [ ] Test concurrent image processing
- [ ] Check for memory leaks

## Documentation

- [ ] Write installation instructions
- [ ] Document server setup process
- [ ] Create user guide for extension usage
- [ ] Document supported websites
- [ ] Add troubleshooting section
- [ ] Document API endpoints
- [ ] Create development setup guide

## Future Enhancements (Optional)

- [ ] Support for other browsers (Firefox, Edge)
- [ ] Multiple AI model support
- [ ] Cloud-based processing option
- [ ] Batch upscaling settings
- [ ] Custom upscale factor per site
- [ ] Image comparison view (before/after)
- [ ] Performance statistics dashboard
- [ ] Auto-update for models
