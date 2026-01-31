# AI Reading Upscale Browser Extension - TODO List

## Setup & Dependencies

- [x] Set up project structure (folders for extension, server, models)
- [x] Download and verify RealESRGAN_x4plus_anime_6B.pth model (17.9 MB)
- [ ] Install realesrgan-ncnn-vulkan executable (optional, using Python library instead)
- [x] Set up Python environment for local server
- [ ] Configure NVIDIA CUDA/Vulkan for RTX 5070 Ti (user setup required)

## Local Upscaling Server

- [x] Create REST API server (Python Flask)
- [x] Implement image upload endpoint
- [x] Set up RealESRGAN_x4plus_anime_6B model loading
- [x] Implement image queue management system
- [x] Add support for JPG, PNG, WebP formats
- [x] Create image caching mechanism
- [x] Add health check endpoint
- [x] Implement error handling and logging
- [ ] Test GPU acceleration performance (target: 5-6 sec/image) - requires user testing
- [x] Add configuration options (upscale factor 2x-4x)

## Chrome Extension - Manifest & Structure

- [x] Create manifest.json (Manifest V3)
- [x] Define required permissions (storage, host permissions, activeTab)
- [x] Set up content scripts configuration
- [x] Configure background service worker
- [x] Create popup HTML structure
- [ ] Set up extension icons (16x16, 32x32, 48x48, 128x128) - requires user to add icons

## Chrome Extension - Content Script

- [x] Implement image detection on page load
- [x] Create MutationObserver for dynamically loaded images
- [x] Identify manga/manhwa/webtoon image patterns
- [x] Extract image URLs and metadata
- [x] Send images to background service worker
- [x] Replace original images with upscaled versions
- [x] Preserve original image attributes (alt, class, dimensions)
- [x] Maintain page layout during replacement
- [x] Add visual loading indicator during upscaling
- [x] Handle image replacement errors gracefully

## Chrome Extension - Background Service Worker

- [x] Create communication bridge with content scripts
- [x] Implement server communication (localhost API calls)
- [x] Handle image upload to local server
- [x] Receive and process upscaled images
- [x] Implement retry logic for failed requests
- [x] Add request queue management
- [x] Handle server unavailable scenarios

## Chrome Extension - Popup UI

- [x] Design and create popup.html
- [x] Add on/off toggle button
- [x] Display extension status indicator
- [x] Show upscaling progress/statistics
- [x] Create settings panel (basic version)
- [ ] Add whitelist/blacklist management UI (basic site detection implemented)
- [ ] Implement upscale factor selector (2x-4x) - server supports it, UI not yet
- [x] Add cache clear button
- [x] Style with CSS

## Chrome Extension - Storage & Caching

- [x] Implement chrome.storage API for settings
- [x] Create cache system for upscaled images (server-side)
- [x] Store user preferences (on/off state)
- [ ] Implement cache expiration logic (manual clear available)
- [ ] Add cache size limit management (stats available)
- [x] Store processed image hashes to avoid re-upscaling

## Site Detection & Compatibility

- [x] Identify popular manga sites (MangaDex, MangaPlus, etc.)
- [x] Identify manhwa sites (Webtoon, Tapas, etc.)
- [x] Create site-specific selectors for image detection
- [ ] Test compatibility with different site layouts - requires user testing
- [x] Implement site whitelist/blacklist functionality (basic)
- [x] Add auto-detection for manga/webtoon images

## Testing & Optimization

- [ ] Test image interception on multiple sites - requires user testing
- [ ] Verify GPU acceleration is working - requires user testing
- [ ] Measure upscaling performance (5-6 sec target) - requires user testing
- [ ] Test cache hit/miss scenarios - requires user testing
- [ ] Verify memory usage is acceptable - requires user testing
- [ ] Test with different image sizes and formats - requires user testing
- [ ] Test extension on/off toggle - requires user testing
- [ ] Validate image quality improvements - requires user testing
- [ ] Test concurrent image processing - requires user testing
- [ ] Check for memory leaks - requires user testing

## Documentation

- [x] Write installation instructions
- [x] Document server setup process
- [x] Create user guide for extension usage
- [x] Document supported websites
- [x] Add troubleshooting section
- [x] Document API endpoints
- [x] Create development setup guide

## Future Enhancements (Optional)

- [ ] Support for other browsers (Firefox, Edge)
- [ ] Multiple AI model support
- [ ] Cloud-based processing option
- [ ] Batch upscaling settings
- [ ] Custom upscale factor per site
- [ ] Image comparison view (before/after)
- [ ] Performance statistics dashboard
- [ ] Auto-update for models
