#!/bin/bash

# ################################################
# #                                              #
# #           RemGo - Easy Launcher (Mac)        #
# #                                              #
# ################################################

# Set script directory as root
cd "$(dirname "$0")"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    exit 1
fi

echo "[INFO] Starting unified TypeScript launcher..."
cd backend
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing backend dependencies..."
    npm install
fi
npm run launcher:dev
