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
pip install -r requirements_remgo.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install Python dependencies from requirements_remgo.txt.
    pause
    exit /b 1
)

echo [INFO] Installing PyTorch (CUDA 12.1)...
pip install torch==2.2.1 torchvision==0.17.1 torchaudio==2.2.1 --index-url https://download.pytorch.org/whl/cu121
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install PyTorch.
    pause
    exit /b 1
)

:: Setup Frontend
echo [INFO] Setting up frontend dependencies...
cd frontend
if not exist node_modules (
    call npm install
)
cd ..

:: Setup Backend (Node.js)
echo [INFO] Setting up backend dependencies...
cd backend
if not exist node_modules (
    call npm install
)
cd ..

:: Start Backend in a new window (Node.js version)
echo [INFO] Starting Node.js Backend API Server...
start "RemGo Backend" cmd /k "cd /d %~dp0\backend && npm run dev"

:: Wait a moment for backend to start
timeout /t 3 /nobreak >nul

:: Start Frontend
echo [INFO] Starting Frontend Dev Server...
echo [INFO] Once started, you can access RemGo from other devices using your IP.
cd frontend
call npm run dev

pause
