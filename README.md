# ai_reading_upscale_browser_extension
Main Objective:
Automatically intercept and upscale low-resolution images on manga, manhwa, and webtoon websites in real-time, replacing them with high-quality AI-enhanced versions.
Platform & Environment:

Operating System: Windows 11
Browser: Google Chrome
GPU: NVIDIA RTX 5070 Ti
AI Model: RealESRGAN_x4plus_anime_6B (anime/manga optimized, 4x upscaling)

Core Features:

Automatic Image Interception - Detects and intercepts manga/manhwa/webtoon images on websites
GPU-Accelerated AI Upscaling - Uses Real-ESRGAN with anime-optimized model (4x resolution increase)
Seamless Image Replacement - Displays upscaled images in original positions without breaking page layout
Smart Caching System - Stores processed images to avoid re-upscaling the same content
Extension Toggle Control - On/Off button in Chrome extension popup (click extension icon)
Site Whitelist/Blacklist - Optional control over which websites trigger upscaling

Technical Architecture:
1. Browser Extension (Chrome)

Content Script: Intercepts images on manga/webtoon sites
Background Service Worker: Manages server communication
Popup UI: Toggle on/off, settings, status indicator
Local Storage: Caching upscaled images, user preferences

2. Local Upscaling Server (Python/Node.js)

Uses realesrgan-ncnn-vulkan executable (GPU-accelerated)
RealESRGAN_x4plus_anime_6B model
REST API running on localhost
Image queue management for batch processing

Upscaling Configuration:

Primary Model: RealESRGAN_x4plus_anime_6B.pth (17.9 MB)
Upscale Factor: 4x (can be adjusted 2x-4x)
Processing Speed: ~5-6 seconds per image (RTX 5070 Ti)
Supported Formats: JPG, PNG, WebP

User Experience:

Automatic activation on supported manga/webtoon sites
Visual indicator showing upscaling progress
One-click enable/disable from extension popup
Persistent settings across browser sessions

Ressources : 

/upscale_model/RealESRGAN_x4plus_anime_6B.pth