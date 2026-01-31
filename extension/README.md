# AI Reading Upscale - Chrome Extension

Chrome extension for upscaling manga and manhwa images in real-time using AI.

## Features

- Automatic detection of manga/manhwa images on supported sites
- Real-time upscaling using RealESRGAN AI model
- Visual loading indicators during processing
- Image caching to avoid re-processing
- On/off toggle for easy control
- Works on popular manga sites (MangaDex, Webtoon, etc.)

## Installation

### 1. Add Extension Icons

Before loading the extension, add icon files to the `icons/` directory:
- icon16.png (16x16)
- icon32.png (32x32)
- icon48.png (48x48)
- icon128.png (128x128)

See [icons/README.md](icons/README.md) for icon creation guidance.

### 2. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. The extension should now appear in your extensions list

### 3. Pin the Extension (Optional)

1. Click the extensions icon (puzzle piece) in Chrome toolbar
2. Find "AI Reading Upscale"
3. Click the pin icon to keep it visible

## Usage

1. **Start the local server** (see [server/README.md](../server/README.md))
2. **Navigate to a manga/manhwa site**
   - Supported sites include: MangaDex, Webtoon, Tapas, etc.
   - The extension will automatically detect eligible images
3. **Images will be upscaled automatically**
   - Look for the loading indicator overlay on images
   - Images will be replaced with upscaled versions when ready
4. **Use the popup to control the extension**
   - Click the extension icon to open the popup
   - Toggle the extension on/off
   - View statistics and server status
   - Clear cache if needed

## Extension Popup

The popup provides:
- **Extension Toggle** - Enable/disable image upscaling
- **Server Status** - Check if local server is running
- **Statistics** - View cached images, cache size, and processing queue
- **Clear Cache** - Remove all cached upscaled images
- **Check Server** - Manually refresh server status

## Image Detection Criteria

Images are processed if they meet these criteria:
- Width: 200px - 2000px
- Height: 200px - 4000px
- Aspect ratio: 0.2 - 5.0
- Supported formats: JPG, PNG, WebP

## Supported Websites

Pre-configured for:
- MangaDex (mangadex.org)
- MangaPlus (mangaplus.shueisha.co.jp)
- Webtoon (webtoons.com)
- Tapas (tapas.io)
- Manganelo (manganelo.com)
- MangaKakalot (mangakakalot.com)
- ReadM (readm.org)
- MangaHere (mangahere.cc)
- And more...

The extension will work on any site, but these are optimized for manga/manhwa content.

## Troubleshooting

### Server Status Shows "Offline"
- Make sure the local server is running on port 5000
- Check that no firewall is blocking localhost:5000
- Click "Check Server" button to refresh status

### Images Not Being Upscaled
- Verify the extension is enabled (toggle should be on)
- Check that images meet size criteria
- Open browser console (F12) to check for errors
- Ensure you're on a supported manga/manhwa site

### Extension Not Appearing
- Verify all required icon files are present
- Check Chrome extensions page for error messages
- Try reloading the extension

### Performance Issues
- Clear cache to free up storage
- Reduce number of open manga pages
- Check server performance (see server logs)

## Development

### File Structure
```
extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (API communication)
├── content.js            # Content script (image detection)
├── popup.html            # Popup UI
├── popup.js              # Popup logic
├── popup.css             # Popup styles
└── icons/                # Extension icons
```

### Debugging

1. **Background Service Worker**
   - Go to `chrome://extensions/`
   - Click "service worker" link under the extension
   - View console logs and network requests

2. **Content Script**
   - Open developer tools on any webpage (F12)
   - Check console for content script logs
   - Look for "AI Reading Upscale Extension loaded" message

3. **Popup**
   - Right-click the extension icon
   - Select "Inspect popup"
   - View popup console and debug

## Privacy

- All processing is done locally on your computer
- No images are sent to external servers
- No data collection or tracking
- Server runs only on localhost (127.0.0.1)

## Permissions

The extension requires these permissions:
- **storage** - To save extension settings and cache
- **activeTab** - To interact with current tab
- **scripting** - To inject content scripts
- **host_permissions** - To access localhost server and web images

## License

See LICENSE file in project root.
