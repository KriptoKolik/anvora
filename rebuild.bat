@echo off
cd /d "%~dp0"
echo Rebuilding the site...
call npm.cmd run build > build-log.txt 2>&1
if errorlevel 1 (echo BUILD FAILED >> build-log.txt & echo Build failed. Tell Claude. & pause & exit /b 1)
echo BUILD OK >> build-log.txt
echo Done. Refresh http://localhost:3000 in your browser.
timeout /t 4 >nul
