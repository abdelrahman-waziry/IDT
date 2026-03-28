@echo off
REM Unset ELECTRON_RUN_AS_NODE to ensure Electron runs as a proper application
set ELECTRON_RUN_AS_NODE=
set NODE_ENV=%1

REM Run Electron
"%~dp0node_modules\electron\dist\electron.exe" .
