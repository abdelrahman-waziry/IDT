# iOS Device Manager

A production-ready Electron application for iOS device diagnostics and management, similar to 3uTools.

## Features

- 🔌 **Hot-Plug Detection**: Automatically detects iOS devices when connected/disconnected via USB
- 📱 **Device Information**: Fetches detailed device info including IMEI, Serial, Battery, iOS version
- 🎨 **Modern UI**: Professional dark-themed responsive grid interface
- 📄 **PDF Reports**: Generate diagnostic reports for any connected device
- 🔒 **Secure**: Uses Electron's contextBridge for secure IPC communication

## Project Structure

```
ios-device-manager/
├── package.json           # Project config and dependencies
├── main.js                # Electron main process
├── preload.js             # Secure context bridge
├── src/
│   ├── index.html         # Dashboard UI
│   ├── renderer.js        # Frontend logic
│   └── styles.css         # Professional styling
├── engine/
│   ├── device-manager.js  # CLI wrapper for libimobiledevice
│   ├── device-scanner.js  # USB hot-plug detection
│   └── report-generator.js# PDF report generation
└── resources/
    └── bin/
        ├── win32/         # Windows binaries (.exe)
        └── darwin/        # macOS binaries
```

## Prerequisites

### libimobiledevice Binaries

This application requires `libimobiledevice` CLI tools. Place the following binaries in the appropriate `resources/bin/` subdirectory:

- `idevice_id` - Lists connected device UUIDs
- `ideviceinfo` - Retrieves device information

**Windows:** Place `idevice_id.exe` and `ideviceinfo.exe` in `resources/bin/win32/`

**macOS:** Place `idevice_id` and `ideviceinfo` in `resources/bin/darwin/`

#### Getting the binaries:

**Windows:**
- Download from [libimobiledevice-win32](https://github.com/libimobiledevice-win32/imobiledevice-net) releases
- Or install via Chocolatey: `choco install libimobiledevice`

**macOS:**
- Install via Homebrew: `brew install libimobiledevice`
- Copy from `/opt/homebrew/bin/` or `/usr/local/bin/`

### iTunes/Apple Mobile Device Support

On Windows, ensure iTunes or Apple Mobile Device Support is installed for USB drivers.

## Installation

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npm rebuild usb-detection
```

## Development

```bash
# Start in development mode
npm start

# Or on Windows
npm run dev:win
```

## Building

```bash
# Build for current platform
npm run dist

# Build for specific platform
npm run dist:win   # Windows
npm run dist:mac   # macOS
npm run dist:linux # Linux
```

## Architecture

### CLI Wrapper Pattern

This application uses a "CLI Wrapper" architecture instead of FFI:

1. **Device Scanner** (`device-scanner.js`) monitors USB events using `usb-detection`
2. On device change, **Device Manager** (`device-manager.js`) spawns CLI processes
3. CLI output (XML plist) is parsed using the `plist` library
4. Clean JSON data is sent to the renderer via IPC

### Security

- Context isolation enabled
- Node integration disabled
- Secure IPC via contextBridge
- Sandboxed renderer process

## Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop application framework |
| `usb-detection` | USB hot-plug event detection |
| `plist` | Parse iOS XML plist output |
| `pdfkit` | Generate PDF diagnostic reports |
| `electron-builder` | Package and distribute the app |

## Status Indicators

| Color | Status |
|-------|--------|
| 🟢 Green | Device Activated |
| 🔴 Red | Device Locked/Error |
| 🟡 Yellow | Unknown Status |

## Troubleshooting

### Device Not Detected

1. Ensure iTunes/Apple Mobile Device Support is installed (Windows)
2. Unlock the device and tap "Trust" when prompted
3. Check USB cable and try different ports

### Binary Not Found

1. Verify binaries are in the correct `resources/bin/<platform>/` directory
2. Check file permissions (executable bit on macOS/Linux)
3. Run the binary directly in terminal to check for errors

### USB Detection Issues

If `usb-detection` fails to initialize, the app falls back to polling mode (5-second intervals).

## License

MIT

## Author

MezaTech
