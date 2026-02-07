#!/bin/bash
# Start RemGo with Node.js API Server

cd "$(dirname "$0")"

# Start Node.js backend
cd backend
npm run dev
