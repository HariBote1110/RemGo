@echo off
setlocal enabledelayedexpansion
set PYTHONUTF8=1

echo ################################################
echo #                                              #
echo #           RemGo - Easy Launcher              #
echo #                                              #
echo ################################################

cd /d %~dp0

:: Check for Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

echo [INFO] Starting unified TypeScript launcher...
cd backend
if not exist node_modules (
    echo [INFO] Installing backend dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install backend dependencies.
        pause
        exit /b 1
    )
)
call npm run launcher:dev

pause
