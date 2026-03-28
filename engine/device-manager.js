/**
 * Device Manager - iOS Device Information Retrieval
 * 
 * This module handles communication with iOS devices using libimobiledevice CLI tools.
 * It wraps idevice_id and ideviceinfo binaries to:
 * - List connected device UUIDs
 * - Retrieve detailed device information
 * - Parse plist XML output into clean JSON
 */

const { execFile } = require('child_process');
const path = require('path');
const plist = require('plist');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Determine if we're running in production (packaged) mode
 */
function isPackaged() {
    return process.mainModule && process.mainModule.filename.indexOf('app.asar') !== -1;
}

/**
 * Get the correct path to binary files based on environment and platform
 * @param {string} binaryName - Name of the binary (without extension)
 * @returns {string} Full path to the binary
 */
function getBinaryPath(binaryName) {
    const platform = process.platform === 'win32' ? 'win32' : 'darwin';
    const extension = process.platform === 'win32' ? '.exe' : '';
    const binaryFileName = `${binaryName}${extension}`;

    if (isPackaged()) {
        // Production: binaries are in resources/bin/platform/
        return path.join(process.resourcesPath, 'bin', platform, binaryFileName);
    } else {
        // Development: binaries are in project root resources/bin/platform/
        return path.join(__dirname, '..', 'resources', 'bin', platform, binaryFileName);
    }
}

/**
 * Execute a binary and return stdout
 * @param {string} binaryName - Name of the binary to execute
 * @param {string[]} args - Arguments to pass to the binary
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<string>} stdout output
 */
async function executeBinary(binaryName, args = [], timeout = 30000) {
    const binaryPath = getBinaryPath(binaryName);

    console.log(`[DeviceManager] Executing: ${binaryPath} ${args.join(' ')}`);

    try {
        const { stdout, stderr } = await execFileAsync(binaryPath, args, {
            timeout,
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large plist output
            windowsHide: true
        });

        if (stderr && stderr.trim()) {
            console.warn(`[DeviceManager] stderr: ${stderr}`);
        }

        return stdout;
    } catch (error) {
        // Handle specific error cases
        if (error.code === 'ENOENT') {
            throw new Error(`Binary not found: ${binaryPath}. Please ensure libimobiledevice tools are installed.`);
        }
        if (error.killed) {
            throw new Error(`Command timed out after ${timeout}ms`);
        }
        if (error.stderr && error.stderr.includes('Could not connect to lockdownd')) {
            throw new Error('Device is locked or not trusted. Please unlock and trust this computer.');
        }
        if (error.stderr && error.stderr.includes('No device found')) {
            throw new Error('No device found');
        }
        throw error;
    }
}

/**
 * Get list of connected device UUIDs
 * Runs: idevice_id -l
 * @returns {Promise<string[]>} Array of device UUIDs
 */
async function getConnectedUUIDs() {
    try {
        const stdout = await executeBinary('idevice_id', ['-l']);

        // Parse output - each line is a UUID
        const uuids = stdout
            .trim()
            .split('\n')
            .map(uuid => uuid.trim())
            .filter(uuid => uuid.length > 0);

        console.log(`[DeviceManager] Found ${uuids.length} device(s):`, uuids);
        return uuids;

    } catch (error) {
        if (error.message.includes('No device found')) {
            return [];
        }
        console.error('[DeviceManager] Error getting UUIDs:', error);
        throw error;
    }
}

/**
 * Get detailed device information for a specific UUID
 * Runs: ideviceinfo -u UUID -x (XML plist output)
 * @param {string} uuid - Device UUID
 * @returns {Promise<object>} Parsed device information
 */
async function getDeviceInfo(uuid) {
    try {
        // Get main device info
        const stdout = await executeBinary('ideviceinfo', ['-u', uuid, '-x']);

        // Parse the XML plist output
        const rawInfo = plist.parse(stdout);

        // Get battery info from separate domain
        let batteryInfo = {};
        try {
            const batteryStdout = await executeBinary('ideviceinfo', ['-u', uuid, '-q', 'com.apple.mobile.battery', '-x']);
            batteryInfo = plist.parse(batteryStdout);
            console.log(`[DeviceManager] Battery info for ${uuid}:`, batteryInfo);
        } catch (batteryError) {
            console.warn(`[DeviceManager] Could not get battery info for ${uuid}:`, batteryError.message);
        }

        // Get disk usage info from separate domain
        let diskInfo = {};
        try {
            const diskStdout = await executeBinary('ideviceinfo', ['-u', uuid, '-q', 'com.apple.disk_usage', '-x']);
            diskInfo = plist.parse(diskStdout);
            console.log(`[DeviceManager] Disk info for ${uuid}:`, diskInfo);
        } catch (diskError) {
            console.warn(`[DeviceManager] Could not get disk info for ${uuid}:`, diskError.message);
        }

        // Merge battery and disk info into raw info
        const mergedInfo = { ...rawInfo, ...batteryInfo, ...diskInfo };

        // Extract and normalize the relevant fields
        const deviceInfo = normalizeDeviceInfo(mergedInfo);

        console.log(`[DeviceManager] Device info for ${uuid}:`, deviceInfo);
        return deviceInfo;

    } catch (error) {
        console.error(`[DeviceManager] Error getting device info for ${uuid}:`, error);

        // Return error object with helpful message
        if (error.message.includes('locked') || error.message.includes('trust')) {
            return {
                error: true,
                errorMessage: 'Device Locked - Please unlock and trust this computer',
                ActivationState: 'Locked'
            };
        }

        return {
            error: true,
            errorMessage: error.message || 'Unknown error',
            ActivationState: 'Error'
        };
    }
}

/**
 * Normalize raw plist data into a clean, consistent format
 * @param {object} rawInfo - Raw plist parsed object
 * @returns {object} Normalized device information
 */
function normalizeDeviceInfo(rawInfo) {
    return {
        // Device Identification
        Model: rawInfo.ProductType || rawInfo.DeviceClass || 'Unknown',
        ModelName: getModelName(rawInfo.ProductType),
        DeviceName: rawInfo.DeviceName || 'Unknown Device',

        // Hardware Details
        Color: rawInfo.DeviceColor || rawInfo.DeviceEnclosureColor || 'Unknown',
        HardwareModel: rawInfo.HardwareModel || 'Unknown',

        // Software
        iOSVersion: rawInfo.ProductVersion || 'Unknown',
        BuildVersion: rawInfo.BuildVersion || 'Unknown',

        // Identifiers
        SerialNumber: rawInfo.SerialNumber || 'Unknown',
        IMEI: rawInfo.InternationalMobileEquipmentIdentity ||
            rawInfo.IMEI ||
            'N/A (WiFi Only)',
        MEID: rawInfo.MobileEquipmentIdentifier || 'N/A',
        UDID: rawInfo.UniqueDeviceID || 'Unknown',

        // Status
        ActivationState: rawInfo.ActivationState || 'Unknown',

        // Battery (if available)
        BatteryLevel: rawInfo.BatteryCurrentCapacity !== undefined
            ? `${rawInfo.BatteryCurrentCapacity}%`
            : 'Unknown',
        BatteryHealth: rawInfo.BatteryHealth || 'Unknown',

        // Storage (from com.apple.disk_usage domain)
        TotalDiskCapacity: formatBytes(rawInfo.TotalDiskCapacity || rawInfo.TotalDataCapacity),
        AvailableDiskSpace: formatBytes(rawInfo.AmountDataAvailable || rawInfo.AvailableInternalCapacity),

        // Network
        WiFiAddress: rawInfo.WiFiAddress || 'Unknown',
        BluetoothAddress: rawInfo.BluetoothAddress || 'Unknown',
        PhoneNumber: rawInfo.PhoneNumber || 'N/A',

        // Carrier
        CarrierName: rawInfo.CarrierBundleInfoArray?.[0]?.CFBundleIdentifier ||
            rawInfo.SIMCarrierNetwork ||
            'N/A',

        // Additional
        RegionInfo: rawInfo.RegionInfo || 'Unknown',
        TimeZone: rawInfo.TimeZone || 'Unknown',

        // Raw data for debugging
        _raw: rawInfo
    };
}

/**
 * Convert ProductType to human-readable model name
 * @param {string} productType - e.g., "iPhone14,2"
 * @returns {string} Human-readable model name
 */
function getModelName(productType) {
    const modelMap = {
        // iPhone 15 Series
        'iPhone16,1': 'iPhone 15 Pro',
        'iPhone16,2': 'iPhone 15 Pro Max',
        'iPhone15,4': 'iPhone 15',
        'iPhone15,5': 'iPhone 15 Plus',

        // iPhone 14 Series
        'iPhone15,2': 'iPhone 14 Pro',
        'iPhone15,3': 'iPhone 14 Pro Max',
        'iPhone14,7': 'iPhone 14',
        'iPhone14,8': 'iPhone 14 Plus',

        // iPhone 13 Series
        'iPhone14,2': 'iPhone 13 Pro',
        'iPhone14,3': 'iPhone 13 Pro Max',
        'iPhone14,4': 'iPhone 13 mini',
        'iPhone14,5': 'iPhone 13',

        // iPhone 12 Series
        'iPhone13,1': 'iPhone 12 mini',
        'iPhone13,2': 'iPhone 12',
        'iPhone13,3': 'iPhone 12 Pro',
        'iPhone13,4': 'iPhone 12 Pro Max',

        // iPhone 11 Series
        'iPhone12,1': 'iPhone 11',
        'iPhone12,3': 'iPhone 11 Pro',
        'iPhone12,5': 'iPhone 11 Pro Max',

        // iPhone SE Series
        'iPhone14,6': 'iPhone SE (3rd gen)',
        'iPhone12,8': 'iPhone SE (2nd gen)',

        // iPhone X Series
        'iPhone11,2': 'iPhone XS',
        'iPhone11,4': 'iPhone XS Max',
        'iPhone11,6': 'iPhone XS Max',
        'iPhone11,8': 'iPhone XR',
        'iPhone10,3': 'iPhone X',
        'iPhone10,6': 'iPhone X',

        // iPad Pro Series
        'iPad13,4': 'iPad Pro 11" (3rd gen)',
        'iPad13,5': 'iPad Pro 11" (3rd gen)',
        'iPad13,8': 'iPad Pro 12.9" (5th gen)',
        'iPad13,9': 'iPad Pro 12.9" (5th gen)',

        // iPad Air
        'iPad13,1': 'iPad Air (4th gen)',
        'iPad13,2': 'iPad Air (4th gen)',
        'iPad13,16': 'iPad Air (5th gen)',
        'iPad13,17': 'iPad Air (5th gen)',

        // iPad mini
        'iPad14,1': 'iPad mini (6th gen)',
        'iPad14,2': 'iPad mini (6th gen)',

        // Regular iPad
        'iPad12,1': 'iPad (9th gen)',
        'iPad12,2': 'iPad (9th gen)',
        'iPad13,18': 'iPad (10th gen)',
        'iPad13,19': 'iPad (10th gen)'
    };

    return modelMap[productType] || productType || 'Unknown Model';
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "64 GB")
 */
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null) return 'Unknown';

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);

    return `${size} ${sizes[i]}`;
}

module.exports = {
    getConnectedUUIDs,
    getDeviceInfo,
    getBinaryPath,
    normalizeDeviceInfo,
    getModelName,
    formatBytes
};
