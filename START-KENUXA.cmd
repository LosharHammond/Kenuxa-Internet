@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then try again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:3210 after the server starts.
node --env-file-if-exists=.env server.mjs
pause
