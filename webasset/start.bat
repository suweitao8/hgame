@echo off
cd /d "%~dp0\.."
if not exist "node_modules\three\package.json" (
  echo Installing HGame + WebAsset dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Run npm install and try again.
    pause
    exit /b 1
  )
)
node webasset/server.mjs
pause
