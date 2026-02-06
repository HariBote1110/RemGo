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
pip install fastapi uvicorn[standard] websockets==11.0.3 python-multipart "numpy<2" pillow requests tqdm opencv-contrib-python-headless scipy psutil supervision safetensors transformers accelerate einops pyyaml groundingdino-py segment-anything rembg onnxruntime
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
