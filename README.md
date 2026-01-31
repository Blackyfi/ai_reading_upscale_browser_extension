# AI Reading Upscale Browser Extension

Automatically intercept and upscale low-resolution manga, manhwa, and webtoon images in real-time using AI-powered enhancement.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%2011-blue)
![Chrome](https://img.shields.io/badge/browser-Chrome-green)
![GPU](https://img.shields.io/badge/GPU-NVIDIA%20RTX-green)

## Overview

This project provides a Chrome extension that automatically detects manga/manhwa images on websites and upscales them in real-time using the RealESRGAN AI model. Images are processed locally on your GPU for fast, high-quality enhancement without sending data to external servers.

### Main Objective

Enhance your manga and webtoon reading experience by replacing low-resolution images with crisp, AI-upscaled versions - seamlessly and automatically.

## Features

- **Automatic Image Detection** - Intelligently detects manga/manhwa images on websites
- **GPU-Accelerated AI Upscaling** - Uses RealESRGAN with anime-optimized model (4x resolution)
- **Seamless Replacement** - Displays upscaled images without breaking page layout
- **Smart Caching** - Stores processed images to avoid re-upscaling
- **Easy Toggle Control** - Simple on/off button in extension popup
- **Privacy-Focused** - All processing happens locally on your computer
- **Visual Indicators** - Loading overlays show upscaling progress
- **Supported Sites** - Works on MangaDex, Webtoon, Tapas, and many more

## Quick Start

Get started in 5 minutes! See the [Quick Start Guide](docs/QUICK_START.md).

```bash
# 1. Set up server
cd server
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# 2. Start server
python app.py

# 3. Load extension in Chrome
# Go to chrome://extensions/ → Enable Developer mode → Load unpacked → Select 'extension' folder
```

## System Requirements

### Platform & Environment
- **Operating System**: Windows 11 (or Windows 10, Linux, macOS)
- **Browser**: Google Chrome (or Chromium-based browsers)
- **GPU**: NVIDIA RTX 5070 Ti (or any CUDA-compatible GPU)
- **Python**: 3.8 or higher

### Hardware Requirements
- **GPU**: NVIDIA GPU with CUDA support (highly recommended)
- **RAM**: 8GB minimum (16GB recommended)
- **Storage**: 2GB free space

### AI Model
- **Model**: RealESRGAN_x4plus_anime_6B.pth ✅ (included in `upscale_model/`)
- **Size**: 17.9 MB
- **Optimization**: Specialized for anime/manga content

## Architecture

### 1. Chrome Extension
- **Content Script** - Intercepts images on manga/webtoon sites
- **Background Service Worker** - Manages server communication
- **Popup UI** - Toggle, settings, and status display
- **Local Storage** - Caching and user preferences

### 2. Local Upscaling Server (Python/Flask)
- **REST API** - Runs on localhost:5000
- **RealESRGAN Integration** - GPU-accelerated upscaling
- **Image Queue** - Manages processing requests
- **Cache System** - Stores upscaled images

## Performance

- **Upscale Factor**: 4x resolution increase (configurable 2x-4x)
- **Processing Speed**: ~5-6 seconds per image (RTX 5070 Ti)
- **Supported Formats**: JPG, PNG, WebP
- **GPU Acceleration**: Full CUDA support for NVIDIA GPUs

## Documentation

- **[Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions
- **[Quick Start](docs/QUICK_START.md)** - Get running in 5 minutes
- **[Server README](server/README.md)** - Server setup and API docs
- **[Extension README](extension/README.md)** - Extension details and troubleshooting

## Project Structure

```
ai_reading_upscale_browser_extension/
├── extension/              # Chrome extension files
│   ├── manifest.json       # Extension configuration
│   ├── background.js       # Service worker
│   ├── content.js          # Content script
│   ├── popup.html/js/css   # Extension popup UI
│   └── icons/              # Extension icons
├── server/                 # Local upscaling server
│   ├── app.py              # Flask application
│   ├── requirements.txt    # Python dependencies
│   └── README.md           # Server documentation
├── upscale_model/          # AI model files
│   └── RealESRGAN_x4plus_anime_6B.pth  ✅
├── docs/                   # Documentation
│   ├── INSTALLATION.md     # Setup guide
│   └── QUICK_START.md      # Quick start
├── TODO.md                 # Project roadmap
└── README.md               # This file
```

## Usage

1. **Start the local server** (keep terminal open)
   ```bash
   cd server
   python app.py
   ```

2. **Navigate to a manga site** (e.g., MangaDex, Webtoon)

3. **Images are automatically upscaled** when detected

4. **Control via extension popup**
   - Click extension icon
   - Toggle on/off
   - View statistics
   - Clear cache

## Supported Websites

Pre-configured for popular manga/manhwa sites:
- MangaDex
- MangaPlus
- Webtoon
- Tapas
- Manganelo
- MangaKakalot
- And many more...

The extension works on any website but is optimized for manga/webtoon content.

## Privacy & Security

- **100% Local Processing** - No external servers, no data collection
- **No Tracking** - No analytics or user monitoring
- **Localhost Only** - Server accessible only from your computer
- **Open Source** - Full transparency of code

## Troubleshooting

### Server shows "Offline"
- Ensure server is running: `cd server && python app.py`
- Check firewall settings for localhost:5000

### Images not upscaling
- Verify extension is enabled in popup
- Check browser console (F12) for errors
- Ensure you're on a supported manga site

### CUDA not available
- Install/update NVIDIA GPU drivers
- Reinstall PyTorch with correct CUDA version

See [docs/INSTALLATION.md](docs/INSTALLATION.md#troubleshooting) for more solutions.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **RealESRGAN** - For the excellent AI upscaling model
- **BasicSR** - For the deep learning framework
- Manga and webtoon community for inspiration

## Resources

- **Model File**: `/upscale_model/RealESRGAN_x4plus_anime_6B.pth` ✅
- **RealESRGAN**: https://github.com/xinntao/Real-ESRGAN
- **Chrome Extensions**: https://developer.chrome.com/docs/extensions/

---

**Enjoy enhanced manga and webtoon reading!** 📚✨