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
import spandrel
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
    'general_x2': {
        'name': 'General x2 (RealESRGAN)',
        'file': 'RealESRGAN_x2plus.pth',
        'arch': 'rrdbnet',
        'scale': 2,
        'num_block': 23,
        'description': 'General purpose 2x upscaling'
    },
    'manga_x2': {
        'name': 'Manga x2 (MangaScale)',
        'file': '2x_MangaScaleV3.pth',
        'arch': 'spandrel',
        'scale': 2,
        'description': 'Best for manga/manhwa, preserves halftones'
    },
    'anime_x4': {
        'name': 'Anime x4 (High Quality)',
        'file': 'RealESRGAN_x4plus_anime_6B.pth',
        'arch': 'rrdbnet',
        'scale': 4,
        'num_block': 6,
        'description': 'High quality 4x for anime/manga, slower'
    },
    'fast_x4': {
        'name': 'Fast x4 (Compact)',
        'file': 'realesr-animevideov3.pth',
        'arch': 'compact',
        'scale': 4,
        'description': 'Fast 4x upscaling, optimized for video/animation'
    }
}

# Global upscaler instance and current model
upscaler = None
current_model = 'anime_x4'
model_loading = False


class AutoTuner:
    """Automatically adjusts tile size and padding based on GPU capabilities and runtime metrics."""

    MIN_TILE = 128
    MAX_TILE = 1024
    VRAM_HEADROOM = 0.85  # Use at most 85% of VRAM
    VRAM_LOW = 0.50       # Below 50% means we can try larger tiles
    STABLE_THRESHOLD = 5  # Lock in after N stable iterations

    def __init__(self):
        self.total_vram = 0
        self.model_profiles = {}  # {model_key: {'tile': int, 'stable_count': int}}
        self._detect_gpu()

    def _detect_gpu(self):
        if not torch.cuda.is_available():
            return
        props = torch.cuda.get_device_properties(0)
        self.total_vram = props.total_mem
        initial_tile = self._vram_to_tile(self.total_vram)
        logger.info(f"AutoTuner: GPU {props.name}, VRAM {self.total_vram / (1024**3):.1f}GB, initial tile {initial_tile}px")

    def _vram_to_tile(self, vram_bytes):
        """Pick initial tile size based on total VRAM."""
        gb = vram_bytes / (1024 ** 3)
        if gb >= 12:
            return 768
        elif gb >= 8:
            return 512
        elif gb >= 6:
            return 384
        elif gb >= 4:
            return 256
        else:
            return 192

    def _calc_padding(self, tile):
        """Tile padding scales with tile size, clamped 8-32."""
        return max(8, min(32, tile // 40))

    def get_params(self, model_key):
        """Get current tile size and padding for a model."""
        if model_key not in self.model_profiles:
            self.model_profiles[model_key] = {
                'tile': self._vram_to_tile(self.total_vram) if self.total_vram else 640,
                'stable_count': 0,
            }
        profile = self.model_profiles[model_key]
        return profile['tile'], self._calc_padding(profile['tile'])

    def is_locked(self, model_key):
        """Check if this model's profile has converged."""
        profile = self.model_profiles.get(model_key)
        return profile is not None and profile['stable_count'] >= self.STABLE_THRESHOLD

    def record_result(self, model_key, elapsed_seconds, image_pixels):
        """After an upscale, adjust tile size based on VRAM usage."""
        if self.total_vram == 0:
            return

        profile = self.model_profiles.get(model_key)
        if profile is None or profile['stable_count'] >= self.STABLE_THRESHOLD:
            return  # Already converged

        peak_vram = torch.cuda.max_memory_allocated(0)
        vram_ratio = peak_vram / self.total_vram
        old_tile = profile['tile']

        if vram_ratio > self.VRAM_HEADROOM:
            # Too much VRAM used — shrink tiles
            new_tile = max(self.MIN_TILE, int(old_tile * 0.75))
            profile['stable_count'] = 0
            logger.info(f"AutoTuner [{model_key}]: VRAM {vram_ratio:.0%} > {self.VRAM_HEADROOM:.0%}, "
                        f"tile {old_tile} -> {new_tile}")
        elif vram_ratio < self.VRAM_LOW and elapsed_seconds < 5:
            # Plenty of headroom and fast — try larger tiles for speed
            new_tile = min(self.MAX_TILE, int(old_tile * 1.25))
            profile['stable_count'] = 0
            logger.info(f"AutoTuner [{model_key}]: VRAM {vram_ratio:.0%} < {self.VRAM_LOW:.0%}, "
                        f"tile {old_tile} -> {new_tile}")
        else:
            new_tile = old_tile
            profile['stable_count'] += 1
            if profile['stable_count'] == self.STABLE_THRESHOLD:
                logger.info(f"AutoTuner [{model_key}]: Converged at tile {old_tile}")

        # Round to multiple of 32 for GPU alignment
        new_tile = (new_tile // 32) * 32
        new_tile = max(self.MIN_TILE, min(self.MAX_TILE, new_tile))
        profile['tile'] = new_tile

        # Reset peak tracking for next image
        torch.cuda.reset_peak_memory_stats(0)

    def get_status(self, model_key=None):
        """Return current tuning status for API responses."""
        status = {
            'total_vram_mb': round(self.total_vram / (1024 ** 2)) if self.total_vram else 0,
            'current_vram_mb': round(torch.cuda.memory_allocated(0) / (1024 ** 2)) if torch.cuda.is_available() else 0,
            'vram_usage_pct': round(torch.cuda.memory_allocated(0) / self.total_vram * 100, 1) if self.total_vram else 0,
        }
        if model_key and model_key in self.model_profiles:
            profile = self.model_profiles[model_key]
            status['tile_size'] = profile['tile']
            status['tile_padding'] = self._calc_padding(profile['tile'])
            status['converged'] = profile['stable_count'] >= self.STABLE_THRESHOLD
        return status


# Global auto-tuner instance
auto_tuner = AutoTuner()


class SpandrelUpscaler:
    """Wrapper for spandrel models to match RealESRGANer interface"""

    def __init__(self, model_path, scale, tile=640, tile_pad=16, half=True, device='cuda'):
        self.scale = scale
        self.tile = tile
        self.tile_pad = tile_pad
        self.half = half
        self.device = device

        # Load model using spandrel
        self.model = spandrel.ModelLoader().load_from_file(model_path).model
        self.model = self.model.to(device)
        if half:
            self.model = self.model.half()
        self.model.eval()

    def enhance(self, img, outscale=None):
        """Upscale image, returns (output, None) to match RealESRGANer interface"""
        if outscale is None:
            outscale = self.scale

        h, w = img.shape[:2]

        # Convert to tensor
        img_tensor = torch.from_numpy(img).permute(2, 0, 1).float() / 255.0
        img_tensor = img_tensor.unsqueeze(0).to(self.device)
        if self.half:
            img_tensor = img_tensor.half()

        # Process with tiling for large images
        with torch.no_grad():
            if h * w > self.tile * self.tile:
                output = self._tile_process(img_tensor)
            else:
                output = self.model(img_tensor)

        # Convert back to numpy
        output = output.squeeze(0).permute(1, 2, 0).float().cpu().numpy()
        output = (output * 255.0).clip(0, 255).astype(np.uint8)

        # Resize if outscale differs from model scale
        if outscale != self.scale:
            h_out, w_out = int(h * outscale), int(w * outscale)
            output = np.array(Image.fromarray(output).resize((w_out, h_out), Image.LANCZOS))

        return output, None

    def _tile_process(self, img):
        """Process image in tiles to save memory"""
        batch, channel, height, width = img.shape
        output_height = height * self.scale
        output_width = width * self.scale
        output = torch.zeros((batch, channel, output_height, output_width),
                           dtype=img.dtype, device=img.device)

        tile = self.tile
        tile_pad = self.tile_pad

        tiles_x = (width + tile - 1) // tile
        tiles_y = (height + tile - 1) // tile

        for y in range(tiles_y):
            for x in range(tiles_x):
                # Calculate tile boundaries with padding
                x_start = x * tile
                y_start = y * tile
                x_end = min(x_start + tile, width)
                y_end = min(y_start + tile, height)

                # Add padding
                x_start_pad = max(x_start - tile_pad, 0)
                y_start_pad = max(y_start - tile_pad, 0)
                x_end_pad = min(x_end + tile_pad, width)
                y_end_pad = min(y_end + tile_pad, height)

                # Extract and process tile
                tile_input = img[:, :, y_start_pad:y_end_pad, x_start_pad:x_end_pad]
                tile_output = self.model(tile_input)

                # Calculate output positions
                out_x_start = x_start * self.scale
                out_y_start = y_start * self.scale
                out_x_end = x_end * self.scale
                out_y_end = y_end * self.scale

                # Calculate padding offsets in output
                pad_left = (x_start - x_start_pad) * self.scale
                pad_top = (y_start - y_start_pad) * self.scale
                pad_right = pad_left + (x_end - x_start) * self.scale
                pad_bottom = pad_top + (y_end - y_start) * self.scale

                output[:, :, out_y_start:out_y_end, out_x_start:out_x_end] = \
                    tile_output[:, :, pad_top:pad_bottom, pad_left:pad_right]

        return output


def init_upscaler(model_key='general_x2'):
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
        scale = model_config.get('scale', 2)
        num_block = model_config.get('num_block', 23)

        # Get auto-tuned tile parameters
        tile_size, tile_pad = auto_tuner.get_params(model_key)
        logger.info(f"Using auto-tuned tile={tile_size}, tile_pad={tile_pad}")

        if model_config['arch'] == 'spandrel':
            # Use spandrel for models with non-standard architectures
            upscaler = SpandrelUpscaler(
                model_path=str(model_path),
                scale=scale,
                tile=tile_size,
                tile_pad=tile_pad,
                half=True,
                device='cuda'
            )
        elif model_config['arch'] == 'rrdbnet':
            model = RRDBNet(
                num_in_ch=3,
                num_out_ch=3,
                num_feat=64,
                num_block=num_block,
                num_grow_ch=32,
                scale=scale
            )
            upscaler = RealESRGANer(
                scale=scale,
                model_path=str(model_path),
                model=model,
                tile=tile_size,
                tile_pad=tile_pad,
                pre_pad=0,
                half=True,
                device='cuda'
            )
        elif model_config['arch'] == 'compact':
            model = SRVGGNetCompact(
                num_in_ch=3,
                num_out_ch=3,
                num_feat=64,
                num_conv=16,
                upscale=scale,
                act_type='prelu'
            )
            upscaler = RealESRGANer(
                scale=scale,
                model_path=str(model_path),
                model=model,
                tile=tile_size,
                tile_pad=tile_pad,
                pre_pad=0,
                half=True,
                device='cuda'
            )
        else:
            logger.error(f"Unknown architecture: {model_config['arch']}")
            model_loading = False
            return False

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
        'model_loading': model_loading,
        'auto_tuner': auto_tuner.get_status(current_model)
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

        image_hash = get_image_hash(image_bytes)
        model_scale = MODELS[current_model]['scale']

        # Use x2 output for x4 models, otherwise use native scale
        output_scale = 2 if model_scale == 4 else model_scale

        cache_key = f"{image_hash}_{current_model}_x{output_scale}"
        cache_path = CACHE_FOLDER / f"{cache_key}.png"

        if cache_path.exists():
            logger.info(f"Cache hit for {cache_key}")
            return send_file(cache_path, mimetype='image/png')

        image = Image.open(io.BytesIO(image_bytes))

        if image.mode != 'RGB':
            image = image.convert('RGB')

        img_np = np.array(image)

        # Apply auto-tuned tile size before processing
        if not auto_tuner.is_locked(current_model):
            tile_size, tile_pad = auto_tuner.get_params(current_model)
            if hasattr(upscaler, 'tile'):
                upscaler.tile = tile_size
                upscaler.tile_pad = tile_pad
            elif hasattr(upscaler, 'tile_size'):
                upscaler.tile_size = tile_size
                upscaler.tile_pad = tile_pad

        # Reset peak memory stats before processing
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats(0)

        image_pixels = img_np.shape[0] * img_np.shape[1]
        logger.info(f"Upscaling image {image_hash} with model '{current_model}' (native x{model_scale}, output x{output_scale})...")
        enhance_start = time.time()
        output, _ = upscaler.enhance(img_np, outscale=output_scale)
        enhance_elapsed = time.time() - enhance_start

        # Feed metrics back to auto-tuner
        auto_tuner.record_result(current_model, enhance_elapsed, image_pixels)

        output_image = Image.fromarray(output)
        output_image.save(cache_path, 'PNG')
        del output
        torch.cuda.empty_cache()

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
            'model_name': MODELS[current_model]['name'] if current_model in MODELS else None,
            'auto_tuner': auto_tuner.get_status(current_model)
        })
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    logger.info("Starting AI Reading Upscale Server...")

    if not init_upscaler('anime_x4'):
        logger.error("Failed to initialize upscaler. Exiting.")
        exit(1)

    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
