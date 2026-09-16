@echo off
cd /d "%~dp0"
title Podcast Clipper Setup

echo Installing dependencies...
call npm install
if errorlevel 1 goto :fail

echo.
echo Setting up yt-dlp, pot-provider, and Python (this can take a few minutes)...
node scripts\setup.js
if errorlevel 1 goto :fail

echo.
echo All set. Run start.bat to launch Podcast Clipper.
pause
exit /b 0

:fail
echo.
echo Setup failed -- see the error above.
pause
exit /b 1
