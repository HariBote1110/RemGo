#!/bin/bash

# ################################################
# #                                              #
# #           RemGo - Easy Launcher (Mac)        #
# #                                              #
# ################################################

# Set script directory as root
cd "$(dirname "$0")"

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python3 is not installed."
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    exit 1
fi

# Setup Python Environment
if [ ! -d "venv" ]; then
    echo "[INFO] Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "[INFO] Activating virtual environment and installing dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements_versions.txt

# Setup Frontend
echo "[INFO] Setting up frontend dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..

# Kill existing backend if running
pkill -f "python3 api_server.py" || true

# Start Backend in background
echo "[INFO] Starting Backend API Server..."
source venv/bin/activate
python3 api_server.py > api_server.log 2>&1 &
BACKEND_PID=$!

# Function to kill background process on exit
trap "kill $BACKEND_PID; exit" INT TERM EXIT

# Start Frontend
echo "[INFO] Starting Frontend Dev Server..."
echo "[INFO] Once started, you can access RemGo from other devices using your IP."
cd frontend
npm run dev
