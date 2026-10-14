@echo off
setlocal
title Enviar Cota D'Agua para o GitHub

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0subir-github.ps1"
set "RESULTADO=%ERRORLEVEL%"

echo.
if not "%RESULTADO%"=="0" (
    echo O envio nao foi concluido. Leia a mensagem de erro acima.
)
pause
exit /b %RESULTADO%
