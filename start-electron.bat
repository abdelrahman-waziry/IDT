@echo off
REM Unset ELECTRON_RUN_AS_NODE to ensure Electron runs as a proper application
set ELECTRON_RUN_AS_NODE=
set NODE_ENV=%1
REM set OPENROUTER_API_KEY=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
REM set IMEIORG_API_KEY=h8AyIejVjLrDPkzrVLnxbT2ap2R1r31oPaSXwjansM8Ao9YK8IuHtaIDKbMn
REM Run Electron
"%~dp0node_modules\electron\dist\electron.exe" .
