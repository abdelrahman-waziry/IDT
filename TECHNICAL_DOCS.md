# iOS Device Diagnostic Tool - Technical Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend SDK Reference](#frontend-sdk-reference)
3. [Device Manager API](#device-manager-api)
4. [Hardware Diagnostics API](#hardware-diagnostics-api)
5. [Data Structures](#data-structures)
6. [IPC Communication](#ipc-communication)
7. [IORegistry Component Reference](#ioregistry-component-reference)
8. [Error Handling](#error-handling)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐         ┌─────────────────────────┐   │
│  │  Renderer       │   IPC   │  Main Process            │   │
│  │  (Frontend)     │◄───────►│                          │   │
│  │                 │         │  ┌─────────────────────┐ │   │
│  │  ┌───────────┐  │         │  │  device-manager.js  │ │   │
│  │  │  sdk.js   │  │         │  └─────────────────────┘ │   │
│  │  └───────────┘  │         │  ┌─────────────────────┐ │   │
│  │  ┌───────────┐  │         │  │ hardware-diagnostics│ │   │
│  │  │  UI/HTML  │  │         │  └─────────────────────┘ │   │
│  │  └───────────┘  │         │  ┌─────────────────────┐ │   │
│  └─────────────────┘         │  │  device-scanner.js  │ │   │
│                              │  └─────────────────────┘ │   │
│                              └─────────────────────────┘   │
│                                           │                  │
│                                           ▼                  │
│                              ┌─────────────────────────┐   │
│                              │   libimobiledevice CLI   │   │
│                              │   (ideviceinfo, etc.)    │   │
│                              └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                        ┌───────────────┐
                        │  iOS Device   │
                        │  (via USB)    │
                        └───────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Main Process | `main.js` | Window management, IPC handling |
| Preload | `preload.js` | Secure bridge between main/renderer |
| SDK | `src/sdk.js` | Frontend API wrapper |
| Device Manager | `engine/device-manager.js` | Device listing & info |
| Hardware Diagnostics | `engine/hardware-diagnostics.js` | Battery & component health |
| Device Scanner | `engine/device-scanner.js` | USB connection monitoring |
| Report Generator | `engine/report-generator.js` | PDF report creation |

---

## Frontend SDK Reference

The SDK is available globally via `window.IDT` after the page loads.

### Quick Start

```javascript
// Get the SDK instance
const idt = window.IDT;

// List all connected devices
const devices = await idt.devices.list();

// Get device details
const device = await idt.devices.get('device-uuid');

// Get battery health
const battery = await idt.diagnostics.getBattery('device-uuid');

// Generate a report
const reportPath = await idt.reports.generate(device);
```

### SDK Methods

#### `idt.devices.list()`
Returns an array of all connected devices.

```javascript
const devices = await idt.devices.list();
// Returns: Device[]
```

#### `idt.devices.get(uuid)`
Get detailed information for a specific device.

```javascript
const device = await idt.devices.get('00008110-001938AA0120A01E');
// Returns: Device
```

#### `idt.devices.refresh()`
Force a refresh of the device list.

```javascript
await idt.devices.refresh();
```

#### `idt.diagnostics.getBattery(uuid)`
Get battery health and diagnostics.

```javascript
const battery = await idt.diagnostics.getBattery('device-uuid');
// Returns: BatteryInfo
```

#### `idt.diagnostics.getComponents(uuid)`
Get all hardware component statuses.

```javascript
const components = await idt.diagnostics.getComponents('device-uuid');
// Returns: { [id: string]: ComponentInfo }
```

#### `idt.diagnostics.getFull(uuid)`
Get complete hardware diagnostics including battery, display, and all components.

```javascript
const diagnostics = await idt.diagnostics.getFull('device-uuid');
// Returns: FullDiagnostics
```

#### `idt.reports.generate(deviceData)`
Generate a PDF diagnostic report.

```javascript
const path = await idt.reports.generate(deviceData);
// Returns: string (file path)
```

### Event Subscriptions

#### `idt.events.onDevicesUpdated(callback)`
Subscribe to device list changes.

```javascript
const unsubscribe = idt.events.onDevicesUpdated((devices) => {
    console.log('Devices updated:', devices);
});

// To unsubscribe:
unsubscribe();
```

#### `idt.events.onLoading(callback)`
Subscribe to loading state changes.

```javascript
const unsubscribe = idt.events.onLoading((isLoading) => {
    console.log('Loading:', isLoading);
});
```

#### `idt.events.onError(callback)`
Subscribe to error events.

```javascript
const unsubscribe = idt.events.onError((error) => {
    console.error('Error:', error.message);
});
```

---

## Device Manager API

Backend module for device communication via libimobiledevice.

### `getConnectedUUIDs()`
Lists all connected device UUIDs.

```javascript
const uuids = await DeviceManager.getConnectedUUIDs();
// Returns: ['uuid1', 'uuid2', ...]
```

**CLI Command:** `idevice_id -l`

### `getDeviceInfo(uuid)`
Gets comprehensive device information.

```javascript
const info = await DeviceManager.getDeviceInfo('device-uuid');
// Returns: DeviceInfo object
```

**CLI Commands:**
- `ideviceinfo -u UUID -x` (main device info)
- `ideviceinfo -u UUID -q com.apple.mobile.battery -x` (battery)
- `ideviceinfo -u UUID -q com.apple.disk_usage -x` (storage)

---

## Hardware Diagnostics API

### `getBatteryDiagnostics(uuid)`
Get detailed battery health information.

```javascript
const battery = await HardwareDiagnostics.getBatteryDiagnostics('uuid');
```

**Returns:**
```javascript
{
    healthPercent: 86,        // Battery health percentage
    cycleCount: 977,          // Charge cycles
    serial: 'F8Y3274080...',  // Battery serial number
    designCapacity: 3208,     // Original mAh
    currentMaxCapacity: 2754, // Current max mAh
    voltage: 4200,            // Current voltage in mV
    temperature: 25.5,        // Temperature in °C
    isCharging: true,         // Currently charging
    builtIn: true             // Is it the original battery
}
```

### `getAllComponentsDiagnostics(uuid)`
Queries IORegistry for hardware component presence.

```javascript
const components = await HardwareDiagnostics.getAllComponentsDiagnostics('uuid');
```

**Returns:** Object with detected components (see IORegistry Reference below)

### `getHardwareDiagnostics(uuid)`
Complete hardware diagnostics including battery, display, and all components.

```javascript
const diagnostics = await HardwareDiagnostics.getHardwareDiagnostics('uuid');
```

---

## Data Structures

### Device

```typescript
interface Device {
    uuid: string;
    Model: string;              // e.g., "iPhone14,2"
    ModelName: string;          // e.g., "iPhone 13 Pro"
    DeviceName: string;         // User-set device name
    Color: string;              // Device color
    HardwareModel: string;      // Hardware identifier
    iOSVersion: string;         // e.g., "17.2.1"
    BuildVersion: string;       // e.g., "21C66"
    SerialNumber: string;       // Device serial
    IMEI: string;               // IMEI or "N/A (WiFi Only)"
    MEID: string;               // MEID or "N/A"
    UDID: string;               // Unique Device ID
    ActivationState: string;    // "Activated" | "Unactivated" | "Locked"
    BatteryLevel: string;       // e.g., "85%"
    BatteryHealth: string;      // e.g., "Good"
    TotalDiskCapacity: string;  // e.g., "256 GB"
    AvailableDiskSpace: string; // e.g., "48.5 GB"
    WiFiAddress: string;        // MAC address
    BluetoothAddress: string;   // MAC address
    PhoneNumber: string;        // Phone number or "N/A"
    CarrierName: string;        // Carrier or "N/A"
    RegionInfo: string;         // Region code
    TimeZone: string;           // Timezone
}
```

### BatteryInfo

```typescript
interface BatteryInfo {
    healthPercent: number | null;
    cycleCount: number | null;
    serial: string | null;
    designCapacity: number | null;
    currentMaxCapacity: number | null;
    voltage: number | null;
    temperature: number | null;
    isCharging: boolean;
    builtIn: boolean | null;
    error?: boolean;
    errorMessage?: string;
}
```

### ComponentInfo

```typescript
interface ComponentInfo {
    name: string;      // Human-readable name
    icon: string;      // Emoji icon
    detected: boolean; // Whether component was found
    status: 'ok' | 'warning' | 'error' | 'unknown';
    ioregEntry: string; // IORegistry entry name
}
```

### FullDiagnostics

```typescript
interface FullDiagnostics {
    battery: BatteryInfo;
    display: DisplayInfo;
    components: { [id: string]: ComponentInfo };
    summary: {
        batteryHealth: string;
        cycleCount: string;
        batterySerial: string;
        overallStatus: 'good' | 'fair' | 'poor' | 'error' | 'unknown';
        componentsDetected: number;
        totalComponents: number;
    };
}
```

---

## IPC Communication

### Channels (Main → Renderer)

| Channel | Payload | Description |
|---------|---------|-------------|
| `devices-updated` | `Device[]` | Device list has changed |
| `devices-loading` | `boolean` | Loading state changed |
| `device-error` | `{ message: string }` | Error occurred |

### Handlers (Renderer → Main)

| Handler | Args | Returns | Description |
|---------|------|---------|-------------|
| `refresh-devices` | none | `{ success: boolean }` | Force refresh |
| `get-device-info` | `uuid: string` | `{ success, data?, error? }` | Get device details |
| `get-hardware-diagnostics` | `uuid: string` | `{ success, data?, error? }` | Get diagnostics |
| `generate-report` | `deviceData: object` | `{ success, path?, error? }` | Generate PDF |

---

## IORegistry Component Reference

Components detected via `idevicediagnostics ioregentry <name>`:

| Component | IORegistry Entry | Description |
|-----------|-----------------|-------------|
| Display | `disp0` | Main display controller |
| Touch Screen | `multi-touch` | Touch digitizer |
| Face ID | `AppleH13PearlCam` | TrueDepth camera (iPhone X+) |
| Rear Camera | `AppleH13CamIn` | Main camera |
| Speaker | `Speaker` | Audio output |
| Microphone | `audio-lp-mic-in` | Audio input |
| WiFi | `AppleBCMWLANSkywalkInterface` | WiFi module |
| Bluetooth | `bluetooth` | Bluetooth module |
| Gyroscope | `gyro` | Motion sensor |
| Accelerometer | `accel` | Motion sensor |
| Compass | `compass` | Magnetometer |
| Proximity | `prox` | Proximity sensor |
| Haptic Engine | `AppleAOPHaptics` | Taptic engine |
| Cellular Modem | `baseband` | Cellular radio |
| Backlight | `backlight` | Display backlight |
| GPU | `AGXAcceleratorG14P` | Graphics processor |
| Lightning Port | `Port-Lightning` | Charging port |
| Ambient Light | `als` | Light sensor |

> **Note:** IORegistry entry names vary by device model. The names above are for iPhone 12/13/14 series.

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Device Locked | Device screen is locked | Unlock device and tap "Trust" |
| No device found | Device not connected | Check USB cable connection |
| Command timed out | Device not responding | Reconnect device |
| Binary not found | libimobiledevice missing | Reinstall application |

### Error Response Format

```javascript
{
    success: false,
    error: "Error message description"
}
```

### Retry Strategy

The SDK automatically retries failed operations once before returning an error. For manual retry:

```javascript
try {
    const device = await idt.devices.get(uuid);
} catch (error) {
    // Wait and retry
    await new Promise(r => setTimeout(r, 1000));
    const device = await idt.devices.get(uuid);
}
```

---

## CLI Tools Reference

The application uses these libimobiledevice binaries:

| Binary | Purpose |
|--------|---------|
| `idevice_id` | List connected device UUIDs |
| `ideviceinfo` | Get device information (plist) |
| `idevicediagnostics` | Access IORegistry data |

### Binary Locations

- **Windows:** `resources/bin/win32/`
- **macOS:** `resources/bin/darwin/`
- **Linux:** `resources/bin/linux/`
