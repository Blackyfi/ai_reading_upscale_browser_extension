# Installation Guide

Complete installation guide for the AI Reading Upscale Browser Extension.

## Prerequisites

Before you begin, ensure you have:

### Required Software
- **Python 3.8 or higher** - [Download](https://www.python.org/downloads/)
- **Google Chrome** - [Download](https://www.google.com/chrome/)
- **Git** - [Download](https://git-scm.com/downloads)

### Hardware Requirements
- **GPU**: NVIDIA GPU with CUDA support (highly recommended)
  - RTX 5070 Ti or equivalent for optimal performance
  - CPU-only mode is supported but much slower
- **RAM**: At least 8GB (16GB recommended)
- **Storage**: 2GB free space for dependencies and cache

### Model File
- RealESRGAN_x4plus_anime_6B.pth (already in `upscale_model/` directory)

## Step 1: Clone or Download the Project

If you haven't already:

```bash
git clone <repository-url>
cd ai_reading_upscale_browser_extension
```

Verify the model file exists:
```bash
# Windows
dir upscale_model\RealESRGAN_x4plus_anime_6B.pth

# Linux/Mac
ls -lh upscale_model/RealESRGAN_x4plus_anime_6B.pth
```

You should see a file of approximately 17.9 MB.

## Step 2: Set Up the Local Server

### 2.1 Create Virtual Environment

Navigate to the server directory:
```bash
cd server
```

Create a Python virtual environment:
```bash
python -m venv venv
```

### 2.2 Activate Virtual Environment

**Windows:**
```bash
venv\Scripts\activate
```

**Linux/Mac:**
```bash
source venv/bin/activate
```

You should see `(venv)` in your command prompt.

### 2.3 Install Dependencies

Install the required Python packages:
```bash
pip install -r requirements.txt
```

### 2.4 Install PyTorch with CUDA (for GPU support)

Check your CUDA version:
```bash
nvidia-smi
```

Install PyTorch with appropriate CUDA version:

**For CUDA 11.8:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

**For CUDA 12.1:**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

**For CPU only (not recommended):**
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### 2.5 Verify Installation

Test that PyTorch can detect your GPU:
```bash
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"
```

Expected output (with GPU):
```
CUDA available: True
GPU: NVIDIA GeForce RTX 5070 Ti
```

## Step 3: Set Up the Chrome Extension

### 3.1 Create Extension Icons

The extension requires icon files. You have two options:

**Option A: Create Custom Icons**
1. Create PNG files in these sizes: 16x16, 32x32, 48x48, 128x128
2. Save them as `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
3. Place them in the `extension/icons/` directory

**Option B: Use Placeholder Icons (for testing)**
1. Create simple placeholder images with any image editor
2. Use an online icon generator like [favicon.io](https://favicon.io/)
3. Download and rename the files appropriately

See [extension/icons/README.md](../extension/icons/README.md) for more details.

### 3.2 Load Extension in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **"Load unpacked"** button
5. Browse to and select the `extension` folder in this project
6. The extension should now appear in your extensions list

### 3.3 Pin the Extension (Optional but Recommended)

1. Click the extensions icon (puzzle piece) in the Chrome toolbar
2. Find "AI Reading Upscale" in the list
3. Click the pin icon to keep it visible in the toolbar

## Step 4: Start the Server

### 4.1 Navigate to Server Directory

If not already there:
```bash
cd server
```

### 4.2 Activate Virtual Environment

If not already activated:

**Windows:**
```bash
venv\Scripts\activate
```

**Linux/Mac:**
```bash
source venv/bin/activate
```

### 4.3 Run the Server

```bash
python app.py
```

You should see output like:
```
INFO:__main__:Starting AI Reading Upscale Server...
INFO:__main__:Loading RealESRGAN model...
INFO:__main__:Model loaded successfully on cuda
 * Serving Flask app 'app'
 * Running on http://127.0.0.1:5000
```

**Important:** Keep this terminal window open while using the extension!

## Step 5: Verify Installation

### 5.1 Check Server Health

Open a new terminal and run:
```bash
curl http://127.0.0.1:5000/health
```

Or visit `http://127.0.0.1:5000/health` in your browser.

Expected response:
```json
{
  "status": "healthy",
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 5070 Ti",
  "model_loaded": true
}
```

### 5.2 Check Extension Status

1. Click the extension icon in Chrome
2. The popup should show:
   - Extension Status: **Enabled** (green)
   - Server Status: **Online** (green dot)

### 5.3 Test on a Manga Site

1. Navigate to a supported manga site (e.g., [MangaDex](https://mangadex.org/))
2. Open a manga chapter
3. Images should show a loading overlay, then be replaced with upscaled versions
4. Check the browser console (F12) for logs

## Troubleshooting

### Server Won't Start

**Error: Model file not found**
- Verify the model file is in `upscale_model/RealESRGAN_x4plus_anime_6B.pth`
- Check the path in `server/app.py` if you moved the file

**Error: CUDA not available**
- Install NVIDIA GPU drivers
- Install CUDA toolkit matching your PyTorch version
- Reinstall PyTorch with correct CUDA version

**Error: Port 5000 already in use**
- Another application is using port 5000
- Stop the other application or change the port in `server/app.py`

### Extension Issues

**Extension won't load**
- Verify all icon files are present in `extension/icons/`
- Check for errors on `chrome://extensions/` page
- Try removing and re-adding the extension

**Server shows offline**
- Ensure the server is running (check terminal)
- Verify no firewall is blocking localhost:5000
- Click "Check Server" button in the extension popup

**Images not being upscaled**
- Check that extension is enabled in popup
- Verify you're on a supported manga/manhwa site
- Open browser console (F12) to check for errors
- Ensure images meet size criteria (200-2000px width)

### Performance Issues

**Upscaling is slow**
- Verify GPU is being used (check server startup logs)
- Close other GPU-intensive applications
- Check system resource usage
- Consider reducing image quality/size on the manga site

**Out of memory errors**
- Reduce the number of open manga pages
- Clear the cache in the extension popup
- Close other applications
- Restart the server

## Next Steps

- Read the [User Guide](USER_GUIDE.md) for usage instructions
- See [Supported Sites](SUPPORTED_SITES.md) for a list of compatible websites
- Check [Troubleshooting Guide](TROUBLESHOOTING.md) for common issues

## Uninstallation

### Remove Extension
1. Go to `chrome://extensions/`
2. Find "AI Reading Upscale"
3. Click "Remove"

### Remove Server
1. Deactivate virtual environment: `deactivate`
2. Delete the `server/venv` directory
3. Delete the `server/cache` and `server/uploads` directories

### Remove Project
Simply delete the entire project directory.
