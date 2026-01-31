# AI Reading Upscale Server

Local REST API server for upscaling manga/manhwa images using RealESRGAN.

## Prerequisites

- Python 3.8 or higher
- NVIDIA GPU with CUDA support (recommended for RTX 5070 Ti)
- RealESRGAN_x4plus_anime_6B.pth model in `../upscale_model/` directory

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
```

2. Activate the virtual environment:
- Windows: `venv\Scripts\activate`
- Linux/Mac: `source venv/bin/activate`

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Install PyTorch with CUDA support (for GPU acceleration):
```bash
# For CUDA 11.8
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# For CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

## Running the Server

```bash
python app.py
```

The server will start on `http://127.0.0.1:5000`

## API Endpoints

### Health Check
```
GET /health
```

Returns server status and GPU availability.

### Upscale Image
```
POST /upscale
Content-Type: multipart/form-data
Body: image file

Returns: Upscaled image (PNG)
```

### Clear Cache
```
POST /clear-cache
```

Clears all cached upscaled images.

### Statistics
```
GET /stats
```

Returns cache statistics and server info.

## Performance

- Expected upscaling time: 5-6 seconds per image (with RTX 5070 Ti)
- Supports JPG, PNG, WebP formats
- Images are cached to avoid re-processing
- Max file size: 10MB

## Troubleshooting

### CUDA not available
If GPU acceleration is not working:
1. Check NVIDIA drivers are installed
2. Verify CUDA toolkit is installed
3. Reinstall PyTorch with correct CUDA version

### Out of memory
If you encounter GPU memory errors:
- Reduce tile size in app.py (modify `tile` parameter)
- Process smaller images
