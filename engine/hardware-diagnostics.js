/**
 * Hardware Diagnostics - Component Authenticity & Health
 * 
 * This module fetches detailed hardware diagnostic information from iOS devices
 * using idevicediagnostics. It provides:
 * - Battery health and authenticity info
 * - Hardware serial numbers
 * - Component health metrics
 */

const { execFile } = require('child_process');
const path = require('path');
const plist = require('plist');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Get the correct path to binary files based on environment and platform
 * @param {string} binaryName - Name of the binary (without extension)
 * @returns {string} Full path to the binary
 */
function getBinaryPath(binaryName) {
    const platform = process.platform === 'win32' ? 'win32' : 'darwin';
    const extension = process.platform === 'win32' ? '.exe' : '';
    const binaryFileName = `${binaryName}${extension}`;

    const isPackaged = process.mainModule && process.mainModule.filename.indexOf('app.asar') !== -1;

    if (isPackaged) {
        return path.join(process.resourcesPath, 'bin', platform, binaryFileName);
    } else {
        return path.join(__dirname, '..', 'resources', 'bin', platform, binaryFileName);
    }
}

/**
 * Execute idevicediagnostics command
 * @param {string[]} args - Arguments to pass
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string>} stdout output
 */
async function executeDiagnostics(args = [], timeout = 30000) {
    const binaryPath = getBinaryPath('idevicediagnostics');

    console.log(`[HardwareDiagnostics] Executing: ${binaryPath} ${args.join(' ')}`);

    try {
        const { stdout, stderr } = await execFileAsync(binaryPath, args, {
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            windowsHide: true
        });

        if (stderr && stderr.trim()) {
            console.warn(`[HardwareDiagnostics] stderr: ${stderr}`);
        }

        return stdout;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Binary not found: ${binaryPath}`);
        }
        if (error.killed) {
            throw new Error(`Command timed out after ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Get detailed battery diagnostics including health and authenticity indicators
 * @param {string} uuid - Device UUID
 * @returns {Promise<object>} Battery diagnostic data
 */
async function getBatteryDiagnostics(uuid) {
    try {
        const stdout = await executeDiagnostics(['ioregentry', 'AppleSmartBattery', '-u', uuid]);

        // Parse the XML plist output
        const parsedPlist = plist.parse(stdout);

        // The data is nested inside IORegistry key
        const rawData = parsedPlist.IORegistry || parsedPlist;

        console.log('[HardwareDiagnostics] Raw data keys:', Object.keys(rawData));

        // Extract key battery metrics
        const batteryData = {
            // Health Metrics
            designCapacity: rawData.DesignCapacity || null,
            currentMaxCapacity: rawData.AppleRawMaxCapacity || null,
            nominalChargeCapacity: rawData.NominalChargeCapacity || null,
            cycleCount: rawData.CycleCount || null,

            // Calculate battery health percentage
            healthPercent: null,

            // Authenticity Indicators
            serial: rawData.Serial || null,
            manufacturerData: rawData.ManufacturerData || null,
            builtIn: rawData['built-in'] !== undefined ? rawData['built-in'] : null,

            // Current State
            currentCapacity: rawData.AppleRawCurrentCapacity || null,
            voltage: rawData.Voltage || null,
            temperature: rawData.Temperature ? (rawData.Temperature / 100).toFixed(1) : null, // Convert to Celsius
            isCharging: rawData.IsCharging || false,
            instantAmperage: rawData.InstantAmperage || null,
            timeRemaining: rawData.TimeRemaining || null,

            // Additional Data
            updateTime: rawData.UpdateTime || null,

            // Authenticity flags
            isGenuine: null, // Will be determined based on available indicators
            authenticityNote: null
        };

        // Calculate battery health
        if (batteryData.currentMaxCapacity && batteryData.designCapacity) {
            batteryData.healthPercent = Math.round(
                (batteryData.currentMaxCapacity / batteryData.designCapacity) * 100
            );
        }

        // Determine authenticity indicators
        // Note: Without Apple's private APIs, we can only provide indirect indicators
        if (batteryData.serial && batteryData.builtIn === true) {
            batteryData.authenticityNote = 'Battery serial present. Built-in flag set.';
            // Genuine Apple batteries typically have specific serial formats
            // This is a heuristic - not 100% reliable
            if (batteryData.serial.length >= 12) {
                batteryData.isGenuine = 'likely';
            } else {
                batteryData.isGenuine = 'unknown';
            }
        } else if (batteryData.builtIn === false) {
            batteryData.isGenuine = 'replaced';
            batteryData.authenticityNote = 'Battery marked as not built-in (may be replaced)';
        } else {
            batteryData.isGenuine = 'unknown';
            batteryData.authenticityNote = 'Unable to determine battery authenticity';
        }

        console.log('[HardwareDiagnostics] Battery diagnostics:', batteryData);
        return batteryData;

    } catch (error) {
        console.error('[HardwareDiagnostics] Error getting battery diagnostics:', error);
        return {
            error: true,
            errorMessage: error.message || 'Failed to get battery diagnostics'
        };
    }
}

/**
 * Get display/screen diagnostics
 * @param {string} uuid - Device UUID
 * @returns {Promise<object>} Display diagnostic data
 */
async function getDisplayDiagnostics(uuid) {
    try {
        const stdout = await executeDiagnostics(['ioregentry', 'AppleCLCD2', '-u', uuid]);
        const parsedPlist = plist.parse(stdout);
        const rawData = parsedPlist.IORegistry || parsedPlist;

        return {
            available: true,
            detected: true,
            displayController: 'AppleCLCD2',
            status: 'ok'
        };
    } catch (error) {
        console.warn('[HardwareDiagnostics] Could not get display diagnostics:', error.message);
        return {
            available: false,
            detected: false,
            status: 'unknown'
        };
    }
}

/**
 * Query a specific IORegistry component
 * @param {string} uuid - Device UUID
 * @param {string} componentName - IORegistry component name
 * @returns {Promise<object>} Component data or null
 */
async function queryComponent(uuid, componentName) {
    try {
        const stdout = await executeDiagnostics(['ioregentry', componentName, '-u', uuid]);
        const parsedPlist = plist.parse(stdout);
        const rawData = parsedPlist.IORegistry || parsedPlist;
        return { detected: true, data: rawData };
    } catch (error) {
        return { detected: false, data: null };
    }
}

/**
 * Get all hardware components diagnostics
 * @param {string} uuid - Device UUID
 * @returns {Promise<object>} All components status
 */
async function getAllComponentsDiagnostics(uuid) {
    console.log('[HardwareDiagnostics] Querying all hardware components...');

    // Define components to query with their IORegistry names
    // These names were discovered by analyzing the IOService dump from the device
    const componentQueries = [
        { id: 'display', name: 'Display', ioreg: 'disp0', icon: '<i class="fa-solid fa-mobile-screen"></i>' },
        { id: 'touch', name: 'Touch Screen', ioreg: 'multi-touch', icon: '<i class="fa-solid fa-hand-pointer"></i>' },
        { id: 'faceid', name: 'Face ID', ioreg: 'AppleH13PearlCam', icon: '<i class="fa-solid fa-face-smile"></i>' },
        { id: 'rear_camera', name: 'Rear Camera', ioreg: 'AppleH13CamIn', icon: '<i class="fa-solid fa-camera"></i>' },
        { id: 'speaker', name: 'Speaker', ioreg: 'Speaker', icon: '<i class="fa-solid fa-volume-high"></i>' },
        { id: 'microphone', name: 'Microphone', ioreg: 'audio-lp-mic-in', icon: '<i class="fa-solid fa-microphone"></i>' },
        { id: 'wifi', name: 'WiFi', ioreg: 'AppleBCMWLANSkywalkInterface', icon: '<i class="fa-solid fa-wifi"></i>' },
        { id: 'bluetooth', name: 'Bluetooth', ioreg: 'bluetooth', icon: '<i class="fa-brands fa-bluetooth"></i>' },
        { id: 'gyroscope', name: 'Gyroscope', ioreg: 'gyro', icon: '<i class="fa-solid fa-arrows-spin"></i>' },
        { id: 'accelerometer', name: 'Accelerometer', ioreg: 'accel', icon: '<i class="fa-solid fa-ruler-combined"></i>' },
        { id: 'compass', name: 'Compass', ioreg: 'compass', icon: '<i class="fa-regular fa-compass"></i>' },
        { id: 'proximity', name: 'Proximity Sensor', ioreg: 'prox', icon: '<i class="fa-solid fa-eye"></i>' },
        { id: 'haptics', name: 'Haptic Engine', ioreg: 'AppleAOPHaptics', icon: '<i class="fa-solid fa-mobile-button"></i>' },
        { id: 'baseband', name: 'Cellular Modem', ioreg: 'baseband', icon: '<i class="fa-solid fa-tower-cell"></i>' },
        { id: 'backlight', name: 'Backlight', ioreg: 'backlight', icon: '<i class="fa-regular fa-lightbulb"></i>' },
        { id: 'gpu', name: 'GPU', ioreg: 'AGXAcceleratorG14P', icon: '<i class="fa-solid fa-microchip"></i>' },
        { id: 'lightning', name: 'Lightning Port', ioreg: 'Port-Lightning', icon: '<i class="fa-solid fa-bolt"></i>' },
        { id: 'ambient_light', name: 'Ambient Light', ioreg: 'als', icon: '<i class="fa-solid fa-sun"></i>' }
    ];

    const components = {};

    // Query each component in parallel
    const results = await Promise.all(
        componentQueries.map(async (comp) => {
            const result = await queryComponent(uuid, comp.ioreg);
            return {
                ...comp,
                detected: result.detected,
                status: result.detected ? 'ok' : 'unknown',
                rawData: result.data
            };
        })
    );

    // Build components object
    results.forEach(result => {
        components[result.id] = {
            name: result.name,
            icon: result.icon,
            detected: result.detected,
            status: result.status,
            ioregEntry: result.ioreg
        };
    });

    console.log('[HardwareDiagnostics] Component detection complete:',
        Object.values(components).filter(c => c.detected).length, 'detected');

    return components;
}

/**
 * Get comprehensive hardware diagnostics for a device
 * @param {string} uuid - Device UUID
 * @returns {Promise<object>} Complete hardware diagnostics
 */
async function getHardwareDiagnostics(uuid) {
    console.log(`[HardwareDiagnostics] Getting hardware diagnostics for ${uuid}`);

    const [battery, display, components] = await Promise.all([
        getBatteryDiagnostics(uuid),
        getDisplayDiagnostics(uuid),
        getAllComponentsDiagnostics(uuid)
    ]);

    return {
        battery,
        display,
        components,
        // Summary
        summary: {
            batteryHealth: battery.healthPercent ? `${battery.healthPercent}%` : 'Unknown',
            cycleCount: battery.cycleCount || 'Unknown',
            batterySerial: battery.serial || 'Unknown',
            overallStatus: determineOverallStatus(battery, display),
            componentsDetected: Object.values(components).filter(c => c.detected).length,
            totalComponents: Object.keys(components).length
        }
    };
}

/**
 * Determine overall hardware status based on diagnostics
 * @param {object} battery - Battery diagnostics
 * @param {object} display - Display diagnostics
 * @returns {string} Overall status
 */
function determineOverallStatus(battery, display) {
    if (battery.error) {
        return 'error';
    }

    if (battery.healthPercent !== null) {
        if (battery.healthPercent >= 80) {
            return 'good';
        } else if (battery.healthPercent >= 60) {
            return 'fair';
        } else {
            return 'poor';
        }
    }

    return 'unknown';
}

module.exports = {
    getBatteryDiagnostics,
    getDisplayDiagnostics,
    getAllComponentsDiagnostics,
    getHardwareDiagnostics
};

