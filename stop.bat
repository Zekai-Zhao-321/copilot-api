@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\gateway-control.ps1" stop
set "result=%errorlevel%"
if not "%COPILOT_API_NONINTERACTIVE%"=="1" if not "%result%"=="0" pause
exit /b %result%
