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
    // Authenticity Verification
    // ============================================

    /**
     * Check hardware authenticity for a device
     * Detects non-genuine parts (battery, display, camera) by parsing
     * the com.apple.mobile.itunes lockdown domain and performing
     * deep IORegistry verification.
     * @param {string} uuid - The device UUID
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    checkAuthenticity: (uuid) => ipcRenderer.invoke('check-authenticity', uuid),

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
    },

    // ============================================
    // Cosmetic Photo Session
    // ============================================

    /**
     * Start the cosmetic capture server
     * @param {string} sessionId - The device UUID / session identifier
     * @returns {Promise<{success: boolean, url?: string, port?: number, qrDataUrl?: string}>}
     */
    startCosmeticSession: (sessionId) => ipcRenderer.invoke('start-cosmetic-session', sessionId),

    /**
     * Stop the cosmetic capture server
     * @returns {Promise<{success: boolean}>}
     */
    stopCosmeticSession: () => ipcRenderer.invoke('stop-cosmetic-session'),

    /**
     * Grade cosmetic photos via Claude Sonnet AI
     * @param {string} sessionId - The session identifier
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    gradeCosmeticPhotos: (sessionId) => ipcRenderer.invoke('grade-cosmetic-photos', sessionId),

    /**
     * Listen for cosmetic photo uploads
     * @param {function} callback - Callback receiving { view, url, localPath, sessionId }
     * @returns {function} Cleanup function to remove listener
     */
    onCosmeticPhotoUploaded: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('cosmetic-photo-uploaded', subscription);
        return () => ipcRenderer.removeListener('cosmetic-photo-uploaded', subscription);
    },

    /**
     * Clean up cosmetic photos for a completed session
     * @param {string} sessionId - The session identifier
     * @returns {Promise<{success: boolean}>}
     */
    cleanupCosmeticPhotos: (sessionId) => ipcRenderer.invoke('cleanup-cosmetic-photos', sessionId),

    /**
     * Listen for cosmetic device unplugged
     * @param {function} callback 
     */
    onCosmeticDeviceUnplugged: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('cosmetic-device-unplugged', subscription);
        return () => ipcRenderer.removeListener('cosmetic-device-unplugged', subscription);
    },

    /**
     * Listen for cosmetic device reconnected
     * @param {function} callback 
     */
    onCosmeticDeviceReconnected: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('cosmetic-device-reconnected', subscription);
        return () => ipcRenderer.removeListener('cosmetic-device-reconnected', subscription);
    },

    // ============================================
    // Dashboard Diagnostic Report Submission
    // ============================================

    /**
     * Submit diagnostic reports to the MezaTech dashboard API
     * @param {object} params - { uuid, hardwareData, cosmeticData, photoPaths }
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    submitDiagnosticReports: (params) => ipcRenderer.invoke('submit-diagnostic-reports', params)
});

// Log that preload script has loaded successfully
console.log('[Preload] iOS Device Manager API exposed to renderer');
