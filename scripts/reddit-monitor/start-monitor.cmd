@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-monitor.ps1" %*
if errorlevel 1 (
  echo.
  echo Start failed. See the error above.
  pause
  exit /b 1
)
endlocal
