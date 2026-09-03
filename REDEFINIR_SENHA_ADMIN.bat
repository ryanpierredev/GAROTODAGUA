@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0redefinir-senha-admin.ps1"
echo.
pause
