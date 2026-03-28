/**
 * iOS Device Manager - Preload Script
 * 
 * This script runs in the renderer context before the webpage loads.
 * It exposes a secure API to the renderer through contextBridge.
 * 
 * Security: contextIsolation is enabled, so this is the only bridge
 * between the renderer and the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose protected methods that allow the renderer process to use
 * ipcRenderer without exposing the entire Electron API
 */
contextBridge.exposeInMainWorld('electronAPI', {

    // ============================================
    // Device Operations
    // ============================================

    /**
     * Request a manual refresh of the device list
     * @returns {Promise<{success: boolean}>}
     */
    refreshDevices: () => ipcRenderer.invoke('refresh-devices'),

    /**
     * Get detailed info for a specific device
     * @param {string} uuid - The device UUID
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    getDeviceInfo: (uuid) => ipcRenderer.invoke('get-device-info', uuid),

    /**
     * Get hardware diagnostics (battery health, cycle count, part serials)
     * @param {string} uuid - The device UUID
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    getHardwareDiagnostics: (uuid) => ipcRenderer.invoke('get-hardware-diagnostics', uuid),

    /**
     * Get GSX info for IMEI
     * @param {string} imei - The device IMEI
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    getGSXInfo: (imei) => ipcRenderer.invoke('get-gsx-info', imei),

    /**
     * Get IMEI info
     * @param {string} imei - The device IMEI
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    getIMEIInfo: (imei) => ipcRenderer.invoke('get-imei-info', imei),

    // ============================================
    // Report Generation
    // ============================================

    /**
     * Generate a PDF report for a device
     * @param {object} deviceData - The device data object
     * @returns {Promise<{success: boolean, path?: string, error?: string}>}
     */
    generateReport: (deviceData) => ipcRenderer.invoke('generate-report', deviceData),

    // ============================================
    // Event Listeners
    // ============================================

    /**
     * Listen for device list updates
     * @param {function} callback - Callback function receiving device array
     * @returns {function} Cleanup function to remove listener
     */
    onDevicesUpdated: (callback) => {
        const subscription = (event, devices) => callback(devices);
        ipcRenderer.on('devices-updated', subscription);
        return () => ipcRenderer.removeListener('devices-updated', subscription);
    },

    /**
     * Listen for loading state changes
     * @param {function} callback - Callback function receiving boolean loading state
     * @returns {function} Cleanup function to remove listener
     */
    onDevicesLoading: (callback) => {
        const subscription = (event, isLoading) => callback(isLoading);
        ipcRenderer.on('devices-loading', subscription);
        return () => ipcRenderer.removeListener('devices-loading', subscription);
    },

    /**
     * Listen for device-related errors
     * @param {function} callback - Callback function receiving error object
     * @returns {function} Cleanup function to remove listener
     */
    onDeviceError: (callback) => {
        const subscription = (event, error) => callback(error);
        ipcRenderer.on('device-error', subscription);
        return () => ipcRenderer.removeListener('device-error', subscription);
    }
});

// Log that preload script has loaded successfully
console.log('[Preload] iOS Device Manager API exposed to renderer');
