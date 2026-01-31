# Installation Guide - AI Reading Upscale Server

This guide covers the installation process for the AI Reading Upscale Server, with special considerations for **NVIDIA RTX 5070 Ti (Blackwell architecture)** GPUs.

## System Requirements

### Hardware Requirements
- **GPU**: NVIDIA GPU with CUDA support
  - For RTX 50-series (Blackwell architecture): RTX 5070 Ti or similar
  - Minimum 8GB VRAM recommended
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 2GB for models and cache

### Software Requirements
- **Python**: 3.14+ (tested with 3.14.2)
- **Operating System**: Windows 10/11, Linux, or macOS
- **NVIDIA Driver**:
  - **RTX 50-series (Blackwell)**: Version 570+ or higher (tested with 591.86)
  - Other GPUs: Latest stable driver

## CRITICAL: PyTorch Installation for RTX 5070 Ti (Blackwell Architecture)

### Why Special Installation is Required

The RTX 5070 Ti uses NVIDIA's **Blackwell architecture** with Compute Capability 12.0 (sm_120). This requires:

1. **PyTorch 2.10.0 or newer**
2. **CUDA 12.8 or 12.9**
3. **NVIDIA Driver 570.xx or higher**

**DO NOT use older CUDA versions** (like CUDA 11.8 or 12.1) - they will not work with Blackwell GPUs.

### Compatibility Check

| Component | Required Version |
|-----------|-----------------|
| GPU Architecture | Blackwell (sm_120) |
| PyTorch Version | 2.10.0+ |
| CUDA Version | 12.8 or 12.9 |
| NVIDIA Driver | 570.xx+ (Windows/Linux) |
| Compute Capability | 12.0 |

### Installation Steps

#### Step 1: Verify Your Driver Version

```bash
# Windows
nvidia-smi

# Linux
nvidia-smi
```

Ensure your driver version is **570 or higher**. If not, update your drivers first.

#### Step 2: Install PyTorch 2.10 with CUDA 12.8

**IMPORTANT**: You must use the specific index URL for CUDA 12.8. The standard PyPI version will install an incompatible CUDA version.

```bash
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

**Alternative: Nightly Build with CUDA 12.9** (if stable version has issues)

```bash
python -m pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu129
```

#### Step 3: Verify PyTorch Installation

```python
import torch

print(f"PyTorch version: {torch.__version__}")
# Should output: 2.10.0+cu128 (or similar)

print(f"CUDA available: {torch.cuda.is_available()}")
# Should output: True

print(f"GPU name: {torch.cuda.get_device_name(0)}")
# Should output: NVIDIA GeForce RTX 5070 Ti Laptop GPU (or similar)

print(f"Compute capability: {torch.cuda.get_device_capability(0)}")
# Should output: (12, 0)
```

If CUDA is not available or the compute capability is wrong, your PyTorch installation is incorrect.

## Installing Other Dependencies

### Known Issue: BasicSR on Python 3.14

BasicSR has a compatibility issue with Python 3.14. If you encounter a `KeyError: '__version__'` error, follow these steps:

#### Option 1: Manual Fix (Recommended)

1. Clone BasicSR repository:
```bash
git clone https://github.com/XPixelGroup/BasicSR.git basicsr_temp
cd basicsr_temp
```

2. Edit `setup.py` and fix the `get_version()` function (around line 76-79):

**Before:**
```python
def get_version():
    with open(version_file, 'r') as f:
        exec(compile(f.read(), version_file, 'exec'))
    return locals()['__version__']
```

**After:**
```python
def get_version():
    with open(version_file, 'r') as f:
        exec_locals = {}
        exec(compile(f.read(), version_file, 'exec'), {}, exec_locals)
    return exec_locals['__version__']
```

3. Install the fixed version:
```bash
python -m pip install -e .
```

#### Option 2: Wait for Official Fix

Check if BasicSR has been updated to support Python 3.14 on PyPI.

### Install Remaining Dependencies

After BasicSR is installed, install the other dependencies:

```bash
# Navigate to the server directory
cd server

# Install all dependencies
python -m pip install flask flask-cors pillow opencv-python realesrgan
```

Or use the requirements file (after PyTorch is installed separately):

```bash
python -m pip install -r requirements.txt
```

**Note**: The requirements.txt does not include PyTorch because it requires a specific installation command with the CUDA 12.8 index URL.

## Common Installation Errors

### Error: "CUDA error: no kernel image is available"

**Cause**: Your NVIDIA driver is too old for the Blackwell architecture.

**Solution**: Update to driver version 570 or higher.

### Error: "KeyError: '__version__'" when installing BasicSR

**Cause**: BasicSR's setup.py has a bug on Python 3.14.

**Solution**: Follow the "BasicSR on Python 3.14" section above.

### Error: torch.cuda.is_available() returns False

**Possible causes**:
1. Wrong PyTorch version installed (check with `torch.__version__`)
2. Installed CPU-only version of PyTorch
3. Driver issues

**Solution**: Reinstall PyTorch with the correct CUDA 12.8 index URL.

## Running the Server

After successful installation:

```bash
cd server
python app.py
```

Expected output:
```
INFO:__main__:Starting AI Reading Upscale Server...
INFO:__main__:Loading RealESRGAN model...
INFO:__main__:GPU detected: NVIDIA GeForce RTX 5070 Ti Laptop GPU
INFO:__main__:Model loaded successfully on GPU
 * Running on http://127.0.0.1:5000
```

## Verifying Installation

Test the health endpoint:

```bash
curl http://127.0.0.1:5000/health
```

Expected response:
```json
{
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 5070 Ti Laptop GPU",
  "model_loaded": true,
  "status": "healthy"
}
```

## Architecture-Specific Notes

### For Blackwell GPUs (RTX 50-series)

- **Do NOT use** `cu118` or `cu121` CUDA versions
- **Always use** CUDA 12.8 or newer
- Update drivers to 570+ before attempting installation
- The RTX 50-series physically requires newer CUDA binary formats

### For Compiling Extensions (Advanced)

If you need to build custom CUDA extensions (like flash-attention or xformers), set the architecture flag:

```bash
export TORCH_CUDA_ARCH_LIST="12.0"
# Windows PowerShell:
# $env:TORCH_CUDA_ARCH_LIST="12.0"
```

Then install the extension.

## Troubleshooting

### Check Installed Packages

```bash
python -m pip list | grep -E "torch|basicsr|realesrgan"
```

Should show:
```
basicsr                1.4.2
realesrgan             0.3.0
torch                  2.10.0+cu128
torchaudio             2.10.0+cu128
torchvision            0.25.0+cu128
```

### Reinstall PyTorch

If you need to start over:

```bash
# Uninstall old versions
python -m pip uninstall torch torchvision torchaudio -y

# Install correct version
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

## Additional Resources

- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/)
- [NVIDIA CUDA Toolkit Documentation](https://docs.nvidia.com/cuda/)
- [BasicSR GitHub](https://github.com/XPixelGroup/BasicSR)
- [RealESRGAN GitHub](https://github.com/xinntao/Real-ESRGAN)

## Summary

The key takeaway for RTX 5070 Ti users:

1. Use PyTorch 2.10+ with CUDA 12.8+
2. Install via: `python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128`
3. Ensure driver version is 570+
4. Fix BasicSR for Python 3.14 if needed
5. Verify with the health endpoint

Your Blackwell GPU requires these specific versions - older tutorials using CUDA 11.8 or 12.1 will not work.
