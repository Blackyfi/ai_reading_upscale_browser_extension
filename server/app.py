import os
import hashlib
import logging
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pathlib import Path
import torch
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet
from PIL import Image
import io
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome extension

# Configuration
UPLOAD_FOLDER = Path('uploads')
CACHE_FOLDER = Path('cache')
MODEL_PATH = Path('../upscale_model/RealESRGAN_x4plus_anime_6B.pth')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# Create necessary directories
UPLOAD_FOLDER.mkdir(exist_ok=True)
CACHE_FOLDER.mkdir(exist_ok=True)

# Global upscaler instance
upscaler = None


def init_upscaler():
    """Initialize RealESRGAN model"""
    global upscaler

    # Check for GPU availability
    if not torch.cuda.is_available():
        logger.error("=" * 60)
        logger.error("ERROR: CUDA GPU is required but not available!")
        logger.error("This application requires an NVIDIA GPU with CUDA support.")
        logger.error("Please ensure:")
        logger.error("  1. You have an NVIDIA GPU installed")
        logger.error("  2. NVIDIA drivers are installed")
        logger.error("  3. CUDA toolkit is installed")
        logger.error("  4. PyTorch with CUDA support is installed")
        logger.error("=" * 60)
        return False

    try:
        logger.info("Loading RealESRGAN model...")
        logger.info(f"GPU detected: {torch.cuda.get_device_name(0)}")

        # Define model architecture
        model = RRDBNet(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_block=6,
            num_grow_ch=32,
            scale=4
        )

        # Initialize upscaler with GPU
        upscaler = RealESRGANer(
            scale=4,
            model_path=str(MODEL_PATH),
            model=model,
            tile=0,  # 0 for no tiling, adjust if GPU memory is limited
            tile_pad=10,
            pre_pad=0,
            half=True,
            device='cuda'
        )

        logger.info(f"Model loaded successfully on GPU")
        return True
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return False


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_image_hash(image_bytes):
    """Generate hash for image caching"""
    return hashlib.md5(image_bytes).hexdigest()


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    gpu_available = torch.cuda.is_available()
    model_loaded = upscaler is not None

    return jsonify({
        'status': 'healthy' if model_loaded else 'unhealthy',
        'gpu_available': gpu_available,
        'gpu_name': torch.cuda.get_device_name(0) if gpu_available else None,
        'model_loaded': model_loaded
    })


@app.route('/upscale', methods=['POST'])
def upscale_image():
    """Upscale image endpoint"""
    if upscaler is None:
        return jsonify({'error': 'Model not loaded'}), 500

    # Check if image file is in request
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400

    file = request.files['image']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400

    try:
        start_time = time.time()

        # Read image bytes
        image_bytes = file.read()

        # Check file size
        if len(image_bytes) > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds limit'}), 400

        # Generate cache key
        cache_key = get_image_hash(image_bytes)
        cache_path = CACHE_FOLDER / f"{cache_key}.png"

        # Check if cached version exists
        if cache_path.exists():
            logger.info(f"Cache hit for {cache_key}")
            return send_file(cache_path, mimetype='image/png')

        # Load image
        image = Image.open(io.BytesIO(image_bytes))

        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')

        # Convert to numpy array
        import numpy as np
        img_np = np.array(image)

        # Upscale
        logger.info(f"Upscaling image {cache_key}...")
        output, _ = upscaler.enhance(img_np, outscale=4)

        # Convert back to PIL Image
        output_image = Image.fromarray(output)

        # Save to cache
        output_image.save(cache_path, 'PNG')

        elapsed_time = time.time() - start_time
        logger.info(f"Upscaling completed in {elapsed_time:.2f} seconds")

        # Return upscaled image
        return send_file(cache_path, mimetype='image/png')

    except Exception as e:
        logger.error(f"Error during upscaling: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Clear cache endpoint"""
    try:
        count = 0
        for file_path in CACHE_FOLDER.glob('*'):
            if file_path.is_file():
                file_path.unlink()
                count += 1

        return jsonify({'message': f'Cache cleared, {count} files deleted'})
    except Exception as e:
        logger.error(f"Error clearing cache: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/stats', methods=['GET'])
def get_stats():
    """Get server statistics"""
    try:
        cache_files = list(CACHE_FOLDER.glob('*'))
        cache_count = len(cache_files)
        cache_size = sum(f.stat().st_size for f in cache_files if f.is_file())

        return jsonify({
            'cache_count': cache_count,
            'cache_size_mb': round(cache_size / (1024 * 1024), 2),
            'gpu_available': torch.cuda.is_available()
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    logger.info("Starting AI Reading Upscale Server...")

    # Initialize model
    if not init_upscaler():
        logger.error("Failed to initialize upscaler. Exiting.")
        exit(1)

    # Run Flask app
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
