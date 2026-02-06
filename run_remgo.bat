@echo off
setlocal enabledelayedexpansion
set PYTHONUTF8=1

echo ################################################
echo #                                              #
echo #           RemGo - Easy Launcher              #
echo #                                              #
echo ################################################

cd /d %~dp0

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    pause
    exit /b 1
)

:: Check for Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

:: Setup Python Environment (optional but recommended)
if not exist venv (
    echo [INFO] Creating Python virtual environment...
    python -m venv venv
)

echo [INFO] Activating virtual environment and installing dependencies...
call venv\Scripts\activate
pip install -r requirements_versions.txt
if %errorlevel% neq 0 (
    echo [WARNING] Failed to install from requirements_versions.txt. Attempting manual install...
)

echo [INFO] Installing PyTorch (CUDA 12.1)...
pip install torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 --index-url https://download.pytorch.org/whl/cu121
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install PyTorch.
    pause
    exit /b 1
)

echo [INFO] Ensuring critical packages are installed...
pip install --upgrade --force-reinstall fastapi==0.111.0 uvicorn[standard]==0.30.1 websockets==12.0 python-multipart "numpy<2" pillow==10.4.0 requests tqdm==4.66.4 opencv-contrib-python-headless==4.10.0.84 scipy==1.14.0 psutil==6.0.0 supervision safetensors==0.4.3 transformers==4.42.4 accelerate==0.32.1 einops==0.8.0 pyyaml==6.0.1 groundingdino-py==0.4.0 segment-anything==1.0 rembg==2.0.57 onnxruntime==1.18.1
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

:: Setup Frontend
echo [INFO] Setting up frontend dependencies...
cd frontend
if not exist node_modules (
    call npm install
)

:: Start Backend in a new window
echo [INFO] Starting Backend API Server...
start "RemGo Backend" cmd /k "cd /d %~dp0 && call venv\Scripts\activate && python api_server.py"

:: Start Frontend
echo [INFO] Starting Frontend Dev Server...
echo [INFO] Once started, you can access RemGo from other devices using your IP.
call npm run dev

pause
