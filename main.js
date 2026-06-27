/**
 * iOS Device Manager - Main Process
 * 
 * This is the main Electron process that orchestrates:
 * - Window management
 * - IPC communication with renderer
 * - Device scanning coordination
 * - Report generation
 */

const electron = require('electron');
const path = require('path');

const { app, BrowserWindow, ipcMain } = electron;

// Keep a global reference of the window object
let mainWindow = null;
let deviceScanner = null;

// Lazy load modules to ensure they're loaded after app is ready
let DeviceScanner, DeviceManager, ReportGenerator, HardwareDiagnostics, APIService, AuthenticityService, CosmeticServer, CosmeticGrader, DashboardAPI;
let PythonBridge, DeepDiagnostics, VerificationOrchestrator;

/**
 * Creates the main application window
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false // Disable sandbox to allow preload to work properly
        },
        icon: path.join(__dirname, 'resources', 'icon.png'),
        title: 'IMTI',
        backgroundColor: '#FAFAFE'
    });

    // Load the main HTML file
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Initialize device scanning after window is ready
    mainWindow.webContents.on('did-finish-load', () => {
        initializeDeviceScanning();
    });
}

/**
 * Initialize USB device scanning and event listeners
 */
function initializeDeviceScanning() {
    deviceScanner = new DeviceScanner();

    deviceScanner.on('change', async (eventData) => {
        const cosmeticActive = CosmeticServer.isSessionActive && CosmeticServer.isSessionActive();
        if (cosmeticActive && eventData && eventData.type === 'remove') {
            console.log('[Main] Device removed during active cosmetic session — server stays alive');
        }
        console.log('[Main] Device change detected, refreshing device list...');
        await refreshDeviceList();
    });

    deviceScanner.on('error', (error) => {
        console.error('[Main] Device scanner error:', error);
        sendToRenderer('device-error', { message: error.message });
    });

    // Start scanning
    deviceScanner.startScanning();

    // Initial device scan
    refreshDeviceList();
}

/**
 * Refresh the list of connected devices and send to renderer
 */
async function refreshDeviceList() {
    try {
        sendToRenderer('devices-loading', true);

        const uuids = await DeviceManager.getConnectedUUIDs();
        const devices = [];

        const results = await Promise.allSettled(uuids.map(u => DeviceManager.getDeviceInfo(u)));
        results.forEach((r, i) => {
            devices.push(
                r.status === 'fulfilled'
                    ? { uuid: uuids[i], ...r.value }
                    : { uuid: uuids[i], error: true, errorMessage: r.reason?.message || 'Unknown error', ActivationState: 'Error' }
            );
        });

        sendToRenderer('devices-updated', devices);
        sendToRenderer('devices-loading', false);

    } catch (error) {
        console.error('[Main] Error refreshing device list:', error);
        sendToRenderer('device-error', { message: error.message });
        sendToRenderer('devices-loading', false);
    }
}

/**
 * Send data to the renderer process
 */
function sendToRenderer(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

/**
 * Register all IPC handlers
 */
function registerIPCHandlers() {
    /**
     * Handle manual refresh request from renderer
     */
    ipcMain.handle('refresh-devices', async () => {
        console.log('[Main] Manual refresh requested');
        await refreshDeviceList();
        return { success: true };
    });

    /**
     * Handle PDF report generation request
     */
    ipcMain.handle('generate-report', async (event, deviceData) => {
        try {
            console.log('[Main] Generating report for device:', deviceData.uuid);

            const reportPath = await ReportGenerator.generateReport(deviceData);

            return {
                success: true,
                path: reportPath,
                message: `Report saved to: ${reportPath}`
            };
        } catch (error) {
            console.error('[Main] Report generation error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    /**
     * Get single device info
     */
    ipcMain.handle('get-device-info', async (event, uuid) => {
        try {
            const deviceInfo = await DeviceManager.getDeviceInfo(uuid);
            return { success: true, data: deviceInfo };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    /**
     * Get hardware diagnostics (battery health, cycle count, serials)
     */
    ipcMain.handle('get-hardware-diagnostics', async (event, uuid) => {
        try {
            console.log('[Main] Getting hardware diagnostics for:', uuid);
            const diagnostics = await HardwareDiagnostics.getHardwareDiagnostics(uuid);
            return { success: true, data: diagnostics };
        } catch (error) {
            console.error('[Main] Hardware diagnostics error:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * Get GSX info for IMEI
     */
    ipcMain.handle('get-gsx-info', async (event, imei) => {
        try {
            console.log('[Main] Getting GSX info for IMEI:', imei);
            const info = await APIService.getGSXInfo(imei);
            return { success: true, data: info };
        } catch (error) {
            console.error('[Main] GSX lookup error:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * Get IMEI info
     */
    ipcMain.handle('get-imei-info', async (event, imei) => {
        try {
            console.log('[Main] Getting IMEI info for IMEI:', imei);
            const info = await APIService.getIMEIInfo(imei);
            return { success: true, data: info };
        } catch (error) {
            console.error('[Main] IMEI lookup error:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * Check hardware authenticity for a device
     */
    ipcMain.handle('check-authenticity', async (event, uuid) => {
        try {
            console.log('[Main] Checking authenticity for device:', uuid);
            const result = await AuthenticityService.checkAuthenticity(uuid);
            return { success: true, data: result };
        } catch (error) {
            console.error('[Main] Authenticity check error:', error);
            return { success: false, error: error.message };
        }
    });

    // ============================================
    // Cosmetic Photo Session
    // ============================================

    ipcMain.handle('start-cosmetic-session', async (event, sessionId) => {
        try {
            console.log('[Main] Starting cosmetic session for:', sessionId);
            const result = await CosmeticServer.startServer(sessionId, (photoData) => {
                // Forward photo upload event to renderer
                sendToRenderer('cosmetic-photo-uploaded', photoData);
            });
            return { success: true, ...result };
        } catch (error) {
            console.error('[Main] Cosmetic session error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-cosmetic-session', async () => {
        try {
            await CosmeticServer.stopServer();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('grade-cosmetic-photos', async (event, sessionId) => {
        try {
            console.log('[Main] Grading cosmetic photos for:', sessionId);

            // Get local file paths
            const photos = CosmeticServer.getSessionPhotos(sessionId);

            // Map to local file URLs (file://) so they persist after HTTP server stops
            const photoUrls = {};
            for (const [view, filePath] of Object.entries(photos)) {
                photoUrls[view] = `file:///${filePath.replace(/\\/g, '/')}`;
            }

            const apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) return { success: false, error: 'OPENROUTER_API_KEY not set' };
            const report = await CosmeticGrader.gradePhotos(photos, apiKey);

            // Attach the photo URLs in the requested format
            report.photos = photoUrls;

            return { success: true, data: report };
        } catch (error) {
            console.error('[Main] Cosmetic grading error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('cleanup-cosmetic-photos', async (event, sessionId) => {
        try {
            console.log('[Main] Cleaning up cosmetic photos for:', sessionId);
            CosmeticServer.cleanupSessionPhotos(sessionId);
            return { success: true };
        } catch (error) {
            console.error('[Main] Photo cleanup error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-cosmetic-status', async () => {
        try {
            return {
                success: true,
                active: CosmeticServer.isSessionActive ? CosmeticServer.isSessionActive() : false
            };
        } catch (error) {
            return { success: false, active: false };
        }
    });

    // ============================================
    // Dashboard Diagnostic Report Submission
    // ============================================

    ipcMain.handle('submit-diagnostic-reports', async (event, { uuid, hardwareData, cosmeticData, photoPaths }) => {
        try {
            console.log('[Main] Submitting diagnostic reports to dashboard for:', uuid);
            const result = await DashboardAPI.submitAllReports(uuid, hardwareData, cosmeticData, photoPaths);
            return { success: true, data: result };
        } catch (error) {
            console.error('[Main] Dashboard submission error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('run-verification', async (event, uuid) => {
        try {
            return { success: true, data: await VerificationOrchestrator.runVerification(uuid) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('check-python-bridge', async () => {
        return { success: true, ready: PythonBridge.isReady() };
    });
}

// ============================================
// App Lifecycle Events
// ============================================

app.whenReady().then(async () => {
    // Load modules after app is ready
    DeviceScanner = require('./engine/device-scanner');
    DeviceManager = require('./engine/device-manager');
    ReportGenerator = require('./engine/report-generator');
    HardwareDiagnostics = require('./engine/hardware-diagnostics');
    APIService = require('./engine/api-service');
    AuthenticityService = require('./engine/authenticity-service');
    CosmeticServer = require('./engine/cosmetic-server');
    CosmeticGrader = require('./engine/cosmetic-grader');
    DashboardAPI = require('./engine/dashboard-api');
    PythonBridge = require('./engine/python-bridge');
    DeepDiagnostics = require('./engine/deep-diagnostics');
    VerificationOrchestrator = require('./engine/verification-orchestrator');

    // Register IPC handlers
    registerIPCHandlers();

    // Initialize Python sidecar (non-blocking)
    await PythonBridge.initialize().catch(err => console.warn('[Main] Python sidecar failed:', err.message));

    // Create window
    createWindow();

    app.on('activate', () => {
        // On macOS re-create window when dock icon is clicked
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Stop device scanning
    if (deviceScanner) {
        deviceScanner.stopScanning();
    }

    // On macOS, apps typically stay active until explicitly quit
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    if (deviceScanner) {
        deviceScanner.stopScanning();
    }
    PythonBridge.shutdown();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason);
});
