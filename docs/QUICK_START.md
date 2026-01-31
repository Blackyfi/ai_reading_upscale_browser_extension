# Quick Start Guide

Get up and running with AI Reading Upscale in 5 minutes!

## Prerequisites Check

- [ ] Python 3.8+ installed
- [ ] Chrome browser installed
- [ ] NVIDIA GPU (recommended)
- [ ] Model file in `upscale_model/` directory

## 5-Minute Setup

### 1. Set Up Server (2 minutes)

```bash
# Navigate to server directory
cd server

# Create and activate virtual environment
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install PyTorch with CUDA (adjust version as needed)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 2. Start Server (30 seconds)

```bash
# From server directory, with venv activated
python app.py
```

Leave this terminal open!

### 3. Add Extension Icons (1 minute)

Quick placeholder solution:
1. Create any small PNG image
2. Copy it 4 times and rename to: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
3. Place all in `extension/icons/` directory

### 4. Load Extension (1 minute)

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `extension` folder
5. Done!

### 5. Test It (30 seconds)

1. Click the extension icon
2. Verify "Server Status" shows "Online"
3. Visit [MangaDex](https://mangadex.org/)
4. Open any manga chapter
5. Watch images get upscaled!

## Verify It's Working

✅ Server terminal shows: "Model loaded successfully on cuda"
✅ Extension popup shows: Server Status "Online" (green)
✅ Manga images show loading overlay then get sharper
✅ Console (F12) shows: "AI Reading Upscale Extension loaded"

## Daily Usage

### Start Your Reading Session
```bash
cd server
venv\Scripts\activate  # Windows
# or: source venv/bin/activate  # Linux/Mac
python app.py
```

### Stop the Server
Press `Ctrl+C` in the server terminal

### Toggle Extension
Click extension icon → Toggle the switch on/off

## Common Issues

### "Server Status: Offline"
→ Start the server: `cd server && python app.py`

### "CUDA not available"
→ Install/reinstall PyTorch with CUDA: See [INSTALLATION.md](INSTALLATION.md#24-install-pytorch-with-cuda)

### Images not upscaling
→ Check extension is enabled in popup
→ Verify you're on a manga site
→ Open console (F12) for errors

## Performance Tips

⚡ **Expected speed**: 5-6 seconds per image (RTX 5070 Ti)
💾 **Cache**: Images are cached - second view is instant!
🎯 **Best sites**: MangaDex, Webtoon, MangaPlus
🔧 **Clear cache**: Extension popup → "Clear Cache" button

## What's Next?

- 📖 Read the full [User Guide](USER_GUIDE.md)
- 🔍 Check [Supported Sites](SUPPORTED_SITES.md)
- 🛠️ See [Troubleshooting](TROUBLESHOOTING.md)

## Need Help?

- Check the browser console (F12)
- Check the server terminal output
- Review the [Troubleshooting Guide](TROUBLESHOOTING.md)

Happy reading! 📚✨
