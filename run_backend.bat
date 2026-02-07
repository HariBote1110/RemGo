@echo off
REM Start RemGo with Node.js API Server

cd /d "%~dp0"

REM Start Node.js backend
cd backend
npm run dev
