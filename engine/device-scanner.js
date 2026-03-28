/**
 * Device Scanner - Polling-Based Device Detection
 * 
 * This module monitors for iOS device connections using a polling approach.
 * It periodically calls idevice_id to check for device changes, which is
 * more reliable than USB event detection and doesn't require native modules.
 * 
 * Benefits of polling approach:
 * - No native module compilation required (works without Visual Studio)
 * - More reliable detection (USB events can be missed)
 * - Works consistently across all platforms
 * - Handles driver initialization delays automatically
 */

const EventEmitter = require('events');
const DeviceManager = require('./device-manager');

// Polling configuration
const POLL_INTERVAL = 2000;       // Check every 2 seconds
const INITIAL_DELAY = 1000;       // Wait 1 second before first poll
const DEBOUNCE_DELAY = 500;       // Debounce rapid changes

class DeviceScanner extends EventEmitter {
    constructor(options = {}) {
        super();

        this.pollInterval = options.pollInterval || POLL_INTERVAL;
        this.isScanning = false;
        this.pollTimer = null;
        this.debounceTimer = null;

        // Track connected devices to detect changes
        this.connectedDevices = new Set();
        this.lastDeviceList = [];
    }

    /**
     * Start polling for device changes
     */
    startScanning() {
        if (this.isScanning) {
            console.log('[DeviceScanner] Already scanning');
            return;
        }

        console.log('[DeviceScanner] Starting device polling...');
        this.isScanning = true;

        // Initial delay to allow app to fully initialize
        setTimeout(() => {
            // Do initial scan
            this.pollDevices();

            // Start periodic polling
            this.pollTimer = setInterval(() => {
                this.pollDevices();
            }, this.pollInterval);

        }, INITIAL_DELAY);

        console.log(`[DeviceScanner] Polling started (interval: ${this.pollInterval}ms)`);
    }

    /**
     * Stop polling for device changes
     */
    stopScanning() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.isScanning = false;
        console.log('[DeviceScanner] Polling stopped');
    }

    /**
     * Poll for connected devices and detect changes
     */
    async pollDevices() {
        try {
            const currentDevices = await DeviceManager.getConnectedUUIDs();
            const currentSet = new Set(currentDevices);

            // Check for changes
            const added = currentDevices.filter(uuid => !this.connectedDevices.has(uuid));
            const removed = [...this.connectedDevices].filter(uuid => !currentSet.has(uuid));

            if (added.length > 0 || removed.length > 0) {
                console.log('[DeviceScanner] Device change detected:');
                if (added.length > 0) console.log('  Added:', added);
                if (removed.length > 0) console.log('  Removed:', removed);

                // Update state
                this.connectedDevices = currentSet;
                this.lastDeviceList = currentDevices;

                // Emit change event with debouncing
                this.emitChangeDebounced({
                    type: added.length > 0 ? 'add' : 'remove',
                    added,
                    removed,
                    devices: currentDevices
                });
            }

        } catch (error) {
            // Only log if it's not an expected "no device" error
            if (!error.message.includes('No device') && !error.message.includes('Binary not found')) {
                console.error('[DeviceScanner] Poll error:', error.message);
            }

            // If we had devices before but now have an error, emit change
            if (this.connectedDevices.size > 0) {
                this.connectedDevices.clear();
                this.lastDeviceList = [];
                this.emitChangeDebounced({
                    type: 'remove',
                    added: [],
                    removed: [...this.connectedDevices],
                    devices: []
                });
            }
        }
    }

    /**
     * Emit change event with debouncing to prevent rapid firing
     * @param {object} eventData - Event data to emit
     */
    emitChangeDebounced(eventData) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            console.log('[DeviceScanner] Emitting change event');
            this.emit('change', eventData);
            this.debounceTimer = null;
        }, DEBOUNCE_DELAY);
    }

    /**
     * Force an immediate scan and emit results
     */
    async triggerManualScan() {
        console.log('[DeviceScanner] Manual scan triggered');

        try {
            const devices = await DeviceManager.getConnectedUUIDs();
            this.connectedDevices = new Set(devices);
            this.lastDeviceList = devices;

            this.emit('change', {
                type: 'manual',
                added: devices,
                removed: [],
                devices
            });

            return devices;
        } catch (error) {
            console.error('[DeviceScanner] Manual scan error:', error);
            this.emit('error', error);
            return [];
        }
    }

    /**
     * Get the current list of connected device UUIDs
     * @returns {string[]} Array of device UUIDs
     */
    getConnectedDevices() {
        return [...this.connectedDevices];
    }

    /**
     * Check if a specific device is connected
     * @param {string} uuid - Device UUID to check
     * @returns {boolean}
     */
    isDeviceConnected(uuid) {
        return this.connectedDevices.has(uuid);
    }

    /**
     * Get scanner status
     * @returns {object} Scanner status info
     */
    getStatus() {
        return {
            isScanning: this.isScanning,
            pollInterval: this.pollInterval,
            connectedCount: this.connectedDevices.size,
            devices: [...this.connectedDevices]
        };
    }
}

module.exports = DeviceScanner;
