/**
 * iOS Device Diagnostic Tool - Frontend SDK
 * 
 * A unified SDK for accessing all device diagnostic functionality.
 * Access via `window.IDT` after the page loads.
 * 
 * @example
 * const idt = window.IDT;
 * const devices = await idt.devices.list();
 * const battery = await idt.diagnostics.getBattery(devices[0].uuid);
 */

// ============================================
// Type Definitions (JSDoc for IDE support)
// ============================================

/**
 * @typedef {Object} Device
 * @property {string} uuid - Unique device identifier
 * @property {string} Model - Device model code (e.g., "iPhone14,2")
 * @property {string} ModelName - Human-readable model name
 * @property {string} DeviceName - User-defined device name
 * @property {string} Color - Device color
 * @property {string} iOSVersion - iOS version
 * @property {string} BuildVersion - iOS build version
 * @property {string} SerialNumber - Device serial number
 * @property {string} IMEI - IMEI or "N/A (WiFi Only)"
 * @property {string} UDID - Unique device ID
 * @property {string} ActivationState - "Activated" | "Unactivated" | "Locked"
 * @property {string} BatteryLevel - Battery percentage (e.g., "85%")
 * @property {string} TotalDiskCapacity - Total storage
 * @property {string} AvailableDiskSpace - Free storage
 * @property {string} WiFiAddress - WiFi MAC address
 * @property {string} BluetoothAddress - Bluetooth MAC address
 * @property {string} CarrierName - Carrier name or "N/A"
 * @property {boolean} [error] - True if there was an error getting info
 * @property {string} [errorMessage] - Error message if error is true
 */

/**
 * @typedef {Object} BatteryInfo
 * @property {number|null} healthPercent - Battery health percentage (0-100)
 * @property {number|null} cycleCount - Number of charge cycles
 * @property {string|null} serial - Battery serial number
 * @property {number|null} designCapacity - Original capacity in mAh
 * @property {number|null} currentMaxCapacity - Current max capacity in mAh
 * @property {number|null} voltage - Current voltage in mV
 * @property {number|null} temperature - Temperature in °C
 * @property {boolean} isCharging - Whether device is charging
 * @property {boolean|null} builtIn - Whether battery is original/built-in
 */

/**
 * @typedef {Object} ComponentInfo
 * @property {string} name - Human-readable component name
 * @property {string} icon - Emoji icon
 * @property {boolean} detected - Whether component was detected
 * @property {'ok'|'warning'|'error'|'unknown'} status - Component status
 * @property {string} ioregEntry - IORegistry entry name
 */

/**
 * @typedef {Object} FullDiagnostics
 * @property {BatteryInfo} battery - Battery diagnostics
 * @property {Object} display - Display diagnostics
 * @property {Object.<string, ComponentInfo>} components - All components
 * @property {Object} summary - Summary statistics
 */

/**
 * @typedef {function(): void} Unsubscribe - Function to unsubscribe from events
 */

// ============================================
// SDK Implementation
// ============================================

class IDTDeviceSDK {
    constructor() {
        /** @private */
        this._cache = {
            devices: [],
            lastRefresh: 0
        };

        /** @private */
        this._cacheTimeout = 5000; // 5 seconds

        // Initialize sub-modules
        this.devices = new DevicesModule(this);
        this.diagnostics = new DiagnosticsModule(this);
        this.reports = new ReportsModule(this);
        this.events = new EventsModule();

        console.log('[IDT SDK] Initialized');
    }

    /**
     * Check if the Electron API is available
     * @returns {boolean}
     */
    isAvailable() {
        return typeof window.electronAPI !== 'undefined';
    }

    /**
     * Get the underlying Electron API
     * @private
     * @returns {Object}
     */
    _getAPI() {
        if (!this.isAvailable()) {
            throw new Error('IDT SDK: electronAPI not available. Are you running in Electron?');
        }
        return window.electronAPI;
    }
}

// ============================================
// Devices Module
// ============================================

class DevicesModule {
    /**
     * @param {IDTDeviceSDK} sdk 
     */
    constructor(sdk) {
        /** @private */
        this._sdk = sdk;
        /** @private */
        this._devices = [];
    }

    /**
     * List all connected devices
     * @returns {Promise<Device[]>}
     */
    async list() {
        // Return cached if fresh
        const now = Date.now();
        if (this._devices.length > 0 && (now - this._sdk._cache.lastRefresh) < this._sdk._cacheTimeout) {
            return [...this._devices];
        }

        await this.refresh();
        return [...this._devices];
    }

    /**
     * Get a specific device by UUID
     * @param {string} uuid - Device UUID
     * @returns {Promise<Device>}
     */
    async get(uuid) {
        const api = this._sdk._getAPI();

        const result = await api.getDeviceInfo(uuid);

        if (!result.success) {
            throw new Error(result.error || 'Failed to get device info');
        }

        return { uuid, ...result.data };
    }

    /**
     * Force refresh of the device list
     * @returns {Promise<void>}
     */
    async refresh() {
        const api = this._sdk._getAPI();
        await api.refreshDevices();
        this._sdk._cache.lastRefresh = Date.now();
    }

    /**
     * Get device count
     * @returns {number}
     */
    get count() {
        return this._devices.length;
    }

    /**
     * Update internal device cache (called by events)
     * @private
     * @param {Device[]} devices 
     */
    _updateCache(devices) {
        this._devices = devices;
        this._sdk._cache.lastRefresh = Date.now();
    }
}

// ============================================
// Diagnostics Module
// ============================================

class DiagnosticsModule {
    /**
     * @param {IDTDeviceSDK} sdk 
     */
    constructor(sdk) {
        /** @private */
        this._sdk = sdk;
        /** @private */
        this._diagnosticsCache = new Map();
    }

    /**
     * Get battery health and diagnostics
     * @param {string} uuid - Device UUID
     * @returns {Promise<BatteryInfo>}
     */
    async getBattery(uuid) {
        const full = await this.getFull(uuid);
        return full.battery;
    }

    /**
     * Get all hardware components status
     * @param {string} uuid - Device UUID
     * @returns {Promise<Object.<string, ComponentInfo>>}
     */
    async getComponents(uuid) {
        const full = await this.getFull(uuid);
        return full.components;
    }

    /**
     * Get complete hardware diagnostics
     * @param {string} uuid - Device UUID
     * @param {boolean} [useCache=true] - Whether to use cached data
     * @returns {Promise<FullDiagnostics>}
     */
    async getFull(uuid, useCache = true) {
        // Check cache
        if (useCache && this._diagnosticsCache.has(uuid)) {
            const cached = this._diagnosticsCache.get(uuid);
            if (Date.now() - cached.timestamp < 30000) { // 30 second cache
                return cached.data;
            }
        }

        const api = this._sdk._getAPI();
        const result = await api.getHardwareDiagnostics(uuid);

        if (!result.success) {
            throw new Error(result.error || 'Failed to get diagnostics');
        }

        // Cache the result
        this._diagnosticsCache.set(uuid, {
            data: result.data,
            timestamp: Date.now()
        });

        return result.data;
    }

    /**
     * Get battery health status label
     * @param {BatteryInfo} battery 
     * @returns {'good'|'fair'|'poor'|'unknown'}
     */
    getBatteryStatus(battery) {
        if (!battery || battery.healthPercent === null) return 'unknown';
        if (battery.healthPercent >= 80) return 'good';
        if (battery.healthPercent >= 60) return 'fair';
        return 'poor';
    }

    /**
     * Clear the diagnostics cache
     * @param {string} [uuid] - Specific UUID to clear, or all if not provided
     */
    clearCache(uuid) {
        if (uuid) {
            this._diagnosticsCache.delete(uuid);
        } else {
            this._diagnosticsCache.clear();
        }
    }
}

// ============================================
// Reports Module
// ============================================

class ReportsModule {
    /**
     * @param {IDTDeviceSDK} sdk 
     */
    constructor(sdk) {
        /** @private */
        this._sdk = sdk;
    }

    /**
     * Generate a PDF diagnostic report
     * @param {Device|Object} deviceData - Device data object
     * @returns {Promise<string>} Path to generated PDF
     */
    async generate(deviceData) {
        const api = this._sdk._getAPI();

        const result = await api.generateReport(deviceData);

        if (!result.success) {
            throw new Error(result.error || 'Failed to generate report');
        }

        return result.path;
    }

    /**
     * Generate a report for a device by UUID
     * @param {string} uuid - Device UUID
     * @param {boolean} [includeDiagnostics=true] - Include hardware diagnostics
     * @returns {Promise<string>} Path to generated PDF
     */
    async generateForDevice(uuid, includeDiagnostics = true) {
        const device = await this._sdk.devices.get(uuid);

        if (includeDiagnostics) {
            const diagnostics = await this._sdk.diagnostics.getFull(uuid);
            return this.generate({ ...device, diagnostics });
        }

        return this.generate(device);
    }
}

// ============================================
// Events Module
// ============================================

class EventsModule {
    constructor() {
        /** @private */
        this._listeners = new Map();
    }

    /**
     * Subscribe to device list updates
     * @param {function(Device[]): void} callback 
     * @returns {Unsubscribe}
     */
    onDevicesUpdated(callback) {
        if (!window.electronAPI) {
            console.warn('[IDT SDK] electronAPI not available');
            return () => { };
        }

        const unsubscribe = window.electronAPI.onDevicesUpdated((devices) => {
            // Update the SDK cache
            if (window.IDT?.devices) {
                window.IDT.devices._updateCache(devices);
            }
            callback(devices);
        });

        return unsubscribe;
    }

    /**
     * Subscribe to loading state changes
     * @param {function(boolean): void} callback 
     * @returns {Unsubscribe}
     */
    onLoading(callback) {
        if (!window.electronAPI) {
            console.warn('[IDT SDK] electronAPI not available');
            return () => { };
        }

        return window.electronAPI.onDevicesLoading(callback);
    }

    /**
     * Subscribe to error events
     * @param {function({message: string}): void} callback 
     * @returns {Unsubscribe}
     */
    onError(callback) {
        if (!window.electronAPI) {
            console.warn('[IDT SDK] electronAPI not available');
            return () => { };
        }

        return window.electronAPI.onDeviceError(callback);
    }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format bytes to human-readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Parse storage string to bytes
 * @param {string} str - e.g., "256 GB"
 * @returns {number|null}
 */
function parseStorageValue(str) {
    if (!str || str === 'Unknown') return null;

    const match = str.match(/([\d.]+)\s*(GB|MB|TB|KB|Bytes)/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers = {
        'BYTES': 1,
        'KB': 1024,
        'MB': 1024 * 1024,
        'GB': 1024 * 1024 * 1024,
        'TB': 1024 * 1024 * 1024 * 1024
    };

    return value * (multipliers[unit] || 1);
}

// ============================================
// Global Export
// ============================================

// Create and expose SDK instance
const sdk = new IDTDeviceSDK();

// Expose globally
window.IDT = sdk;

// Also expose utilities
window.IDT.utils = {
    formatBytes,
    parseStorageValue
};

console.log('[IDT SDK] Ready. Access via window.IDT');
