#!/bin/bash

# Root folder
ROOT="ios-diagnostics-app"

# Create folders
mkdir -p $ROOT/{src/{main/{services/device,services/airplay,native/bindings,native/ios},renderer/{components,pages,utils,assets/{icons,images}}},tests/{unit,integration},scripts}

# Root files with minimal boilerplate
echo '{}' > $ROOT/package.json
echo '# Electron Builder config' > $ROOT/electron-builder.yml
echo '// Vite / Webpack config' > $ROOT/vite.config.js
echo '# iOS Diagnostics App README' > $ROOT/README.md

# Main process files
echo "import { app, BrowserWindow } from 'electron';

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: __dirname + '/preload.js'
        }
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);" > $ROOT/src/main/main.ts

echo "// Preload script" > $ROOT/src/main/preload.ts
echo "// Environment variables" > $ROOT/src/main/env.ts

# Device services
for f in iosDeviceManager.ts iosConnection.ts iosDiagnostics.ts iosScreenshot.ts iosSyslog.ts; do
    echo "// $f - iOS device service stub" > $ROOT/src/main/services/device/$f
done

# AirPlay services
for f in airplayServer.ts airplaySession.ts; do
    echo "// $f - AirPlay service stub" > $ROOT/src/main/services/airplay/$f
done

# Native bindings
echo "// Node native bindings entry" > $ROOT/src/main/native/bindings/index.js
touch $ROOT/src/main/native/ios/airplay-receiver.dylib
touch $ROOT/src/main/native/ios/libimobiledevice-wrapper.node

# Renderer root files
echo "import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);" > $ROOT/src/renderer/App.tsx

echo "/* Global styles */" > $ROOT/src/renderer/main.css
echo "<!DOCTYPE html>
<html lang='en'>
<head><meta charset='UTF-8'><title>iOS Diagnostics</title></head>
<body><div id='root'></div></body>
</html>" > $ROOT/src/renderer/index.html

# Renderer components
for f in Sidebar.tsx Header.tsx DeviceStatusCard.tsx DiagnosticsCard.tsx ReportSummary.tsx ScreenStreamView.tsx; do
    echo "import React from 'react';
const ${f%.tsx} = () => <div>$f component</div>;
export default ${f%.tsx};" > $ROOT/src/renderer/components/$f
done

# Renderer pages
for f in Home.tsx DeviceInfo.tsx Diagnostics.tsx ScreenMirroring.tsx Reports.tsx; do
    echo "import React from 'react';
const ${f%.tsx} = () => <div>$f page</div>;
export default ${f%.tsx};" > $ROOT/src/renderer/pages/$f
done

# Renderer utils
for f in formatters.ts validators.ts ipc.ts; do
    echo "// $f utility stub" > $ROOT/src/renderer/utils/$f
done

# Scripts
for f in start.sh build.sh dev.sh; do
    echo "#!/bin/bash
echo '$f script'" > $ROOT/scripts/$f
    chmod +x $ROOT/scripts/$f
done

echo "✅ iOS Diagnostics Electron app skeleton created successfully!"
