@echo off
cd /d "%~dp0"
title Podcast Clipper Launcher

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4416 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Starting PO token provider...
  start "PO Token Provider" /min cmd /c "cd /d pot-provider\server && node build\main.js"
) else (
  echo PO token provider already running.
)

echo Starting Podcast Clipper server...
start "Podcast Clipper Server" cmd /k node server\index.js
timeout /t 3 /nobreak >nul
start "" http://localhost:4173
