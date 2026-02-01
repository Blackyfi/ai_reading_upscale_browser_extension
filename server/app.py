import os
import hashlib
import logging
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from pathlib import Path
import torch
import numpy as np
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan.archs.srvgg_arch import SRVGGNetCompact
from PIL import Image
import io
import time
import gc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

SCRIPT_DIR = Path(__file__).parent
UPLOAD_FOLDER = SCRIPT_DIR / 'uploads'
CACHE_FOLDER = SCRIPT_DIR / 'cache'
MODEL_DIR = SCRIPT_DIR.parent / 'upscale_model'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
MAX_FILE_SIZE = 10 * 1024 * 1024

UPLOAD_FOLDER.mkdir(exist_ok=True)
CACHE_FOLDER.mkdir(exist_ok=True)

# Model configurations
MODELS = {
    'slow': {
        'name': 'High Quality (Slow)',
        'file': 'RealESRGAN_x4plus_anime_6B.pth',
        'arch': 'rrdbnet',
        'description': 'Higher quality, slower processing'
    },
    'fast': {
        'name': 'Fast (Compact)',
        'file': 'realesr-animevideov3.pth',
        'arch': 'compact',
        'description': 'Faster processing, optimized for video/animation'
    }
}

# Global upscaler instance and current model
upscaler = None
current_model = 'slow'
model_loading = False

def init_upscaler(model_key='slow'):
    """Initialize RealESRGAN model"""
    global upscaler, current_model, model_loading

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

    if model_key not in MODELS:
        logger.error(f"Unknown model: {model_key}")
        return False

    model_config = MODELS[model_key]
    model_path = MODEL_DIR / model_config['file']

    if not model_path.exists():
        logger.error(f"Model file not found: {model_path}")
        return False

    try:
        model_loading = True
        logger.info(f"Loading {model_config['name']} model...")
        logger.info(f"GPU detected: {torch.cuda.get_device_name(0)}")

        # Clean up previous model if exists
        if upscaler is not None:
            del upscaler
            gc.collect()
            torch.cuda.empty_cache()
            torch.cuda.synchronize()

        # Create model based on architecture
        if model_config['arch'] == 'rrdbnet':
            model = RRDBNet(
                num_in_ch=3,
                num_out_ch=3,
                num_feat=64,
                num_block=6,
                num_grow_ch=32,
                scale=4
            )
        elif model_config['arch'] == 'compact':
            model = SRVGGNetCompact(
                num_in_ch=3,
                num_out_ch=3,
                num_feat=64,
                num_conv=16,
                upscale=4,
                act_type='prelu'
            )
        else:
            logger.error(f"Unknown architecture: {model_config['arch']}")
            model_loading = False
            return False

        upscaler = RealESRGANer(
            scale=4,
            model_path=str(model_path),
            model=model,
            tile=512,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device='cuda'
        )

        current_model = model_key
        model_loading = False
        logger.info(f"Model '{model_config['name']}' loaded successfully on GPU")
        return True
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        model_loading = False
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
        'model_loaded': model_loaded,
        'current_model': current_model,
        'model_name': MODELS[current_model]['name'] if current_model in MODELS else None,
        'model_loading': model_loading
    })


@app.route('/models', methods=['GET'])
def get_models():
    """Get available models"""
    models_list = []
    for key, config in MODELS.items():
        model_path = MODEL_DIR / config['file']
        models_list.append({
            'id': key,
            'name': config['name'],
            'description': config['description'],
            'available': model_path.exists(),
            'active': key == current_model
        })

    return jsonify({
        'models': models_list,
        'current': current_model,
        'loading': model_loading
    })


@app.route('/switch-model', methods=['POST'])
def switch_model():
    """Switch to a different model"""
    global model_loading

    if model_loading:
        return jsonify({'error': 'Model is currently loading'}), 409

    data = request.get_json()
    if not data or 'model' not in data:
        return jsonify({'error': 'No model specified'}), 400

    model_key = data['model']
    if model_key not in MODELS:
        return jsonify({'error': f'Unknown model: {model_key}'}), 400

    if model_key == current_model:
        return jsonify({
            'success': True,
            'message': 'Model already active',
            'model': model_key
        })

    logger.info(f"Switching model from {current_model} to {model_key}...")

    if init_upscaler(model_key):
        return jsonify({
            'success': True,
            'message': f'Switched to {MODELS[model_key]["name"]}',
            'model': model_key
        })
    else:
        return jsonify({'error': 'Failed to load model'}), 500


@app.route('/upscale', methods=['POST'])
def upscale_image():
    """Upscale image endpoint"""
    if upscaler is None:
        return jsonify({'error': 'Model not loaded'}), 500

    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400

    file = request.files['image']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'File type not allowed'}), 400

    try:
        start_time = time.time()
        image_bytes = file.read()

        if len(image_bytes) > MAX_FILE_SIZE:
            return jsonify({'error': 'File size exceeds limit'}), 400

        cache_key = get_image_hash(image_bytes)
        cache_path = CACHE_FOLDER / f"{cache_key}.png"

        if cache_path.exists():
            logger.info(f"Cache hit for {cache_key}")
            return send_file(cache_path, mimetype='image/png')

        image = Image.open(io.BytesIO(image_bytes))

        if image.mode != 'RGB':
            image = image.convert('RGB')

        img_np = np.array(image)

        logger.info(f"Upscaling image {cache_key} with model '{current_model}'...")
        output, _ = upscaler.enhance(img_np, outscale=2)

        output_image = Image.fromarray(output)
        output_image.save(cache_path, 'PNG')

        # Clean up GPU memory
        del output
        gc.collect()
        torch.cuda.empty_cache()
        torch.cuda.synchronize()

        elapsed_time = time.time() - start_time
        logger.info(f"Upscaling completed in {elapsed_time:.2f} seconds")

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
            'gpu_available': torch.cuda.is_available(),
            'current_model': current_model,
            'model_name': MODELS[current_model]['name'] if current_model in MODELS else None
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    logger.info("Starting AI Reading Upscale Server...")

    if not init_upscaler():
        logger.error("Failed to initialize upscaler. Exiting.")
        exit(1)

    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
