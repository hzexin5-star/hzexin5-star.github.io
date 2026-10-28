@echo off
chcp 65001 >nul
echo 正在把本地代码改动上传到 GitHub（自动触发重新构建）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0github.ps1" push
echo.
pause
