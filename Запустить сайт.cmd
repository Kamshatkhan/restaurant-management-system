@echo off
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do taskkill /PID %%a /F >nul 2>&1
start "EMBER server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:8000
