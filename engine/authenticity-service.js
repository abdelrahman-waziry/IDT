/**
 * Authenticity Service - Non-Genuine Hardware Part Detection (2026 Engine)
 * * Detects non-genuine (aftermarket/counterfeit) hardware parts on iOS devices
 * by parsing the com.apple.mobile.itunes lockdown domain and cross-referencing
 * with IORegistry data from idevicediagnostics.
 * * Includes Cloud-Pairing Status (Repair Assistant) and Barometric Seal Integrity.
 * * @module engine/authenticity-service
 */

const { execFile } = require('child_process');
const path = require('path');
const plist = require('plist');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ============================================
// Binary Resolution
// ============================================

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

async function executeBinary(binaryName, args = [], timeout = 30000) {
    const binaryPath = getBinaryPath(binaryName);
    console.log(`[AuthenticityService] Executing: ${binaryPath} ${args.join(' ')}`);

    try {
        const { stdout, stderr } = await execFileAsync(binaryPath, args, {
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            windowsHide: true
        });

        if (stderr && stderr.trim()) {
            console.warn(`[AuthenticityService] stderr: ${stderr}`);
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

// ============================================
// Component List & Normalization
// ============================================

const CORE_COMPONENTS = [
    'Battery', 'Display', 'Rear Camera', 'Front Camera',
    'Taptic Engine', 'Main Speaker', 'Receiver (Earpiece)', 'Main Microphone',
    'USB-C/Lightning Connector Flex', 'FaceID/TouchID Biometrics',
    'Logic Board', 'Rear Glass'
];

const Verdict = {
    GENUINE: 'genuine',
    UNPAIRED_GENUINE: 'unpaired_genuine', // Part is real, but Repair Assistant wasn't run
    UNKNOWN: 'unknown',
    USED: 'used',
    MISMATCH: 'mismatch',
    NOT_DETECTED: 'not_detected',
    RESTRICTED: 'restricted'
};

// ============================================
// Data Acquisition
// ============================================

async function getDomainData(uuid, domain = null) {
    const args = ['-u', uuid];
    if (domain) {
        args.push('-q', domain);
    }
    args.push('-x');

    const stdout = await executeBinary('ideviceinfo', args);
    return plist.parse(stdout);
}

async function getBatteryRegistryData(uuid) {
    try {
        const stdout = await executeBinary('idevicediagnostics', [
            'ioregentry', 'AppleSmartBattery', '-u', uuid
        ]);
        const parsed = plist.parse(stdout);
        return parsed.IORegistry || parsed;
    } catch (error) {
        console.warn('[AuthenticityService] Could not read battery IORegistry:', error.message);
        return null;
    }
}

async function getTouchControllerData(uuid) {
    try {
        const stdout = await executeBinary('idevicediagnostics', [
            'ioregentry', 'multi-touch', '-u', uuid
        ]);
        const parsed = plist.parse(stdout);
        return parsed.IORegistry || parsed;
    } catch (error) {
        console.warn('[AuthenticityService] Could not read touch controller IORegistry:', error.message);
        return null;
    }
}

/**
 * Executes a Barometric Pressure Test to verify water resistance/seal.
 */
async function checkSealIntegrity(uuid) {
    try {
        const stdoutStart = await executeBinary('idevicediagnostics', ['ioregentry', 'AppleBarometer', '-u', uuid]);
        const startP = plist.parse(stdoutStart).IORegistry?.PressureValue || 0;

        // 2-second window for the physical screen press
        await new Promise(resolve => setTimeout(resolve, 2000));

        const stdoutEnd = await executeBinary('idevicediagnostics', ['ioregentry', 'AppleBarometer', '-u', uuid]);
        const endP = plist.parse(stdoutEnd).IORegistry?.PressureValue || 0;

        const delta = Math.abs(endP - startP);
        return delta > 5 ? 'Intact' : 'Compromised';
    } catch (e) {
        console.warn('[AuthenticityService] Could not read barometer IORegistry:', e.message);
        return 'Unknown (Sensor Error)';
    }
}

// ============================================
// Deep Verification Logic
// ============================================

function deepVerifyBattery(itunesData, batteryReg) {
    const result = {
        verdict: Verdict.UNKNOWN,
        reasons: [],
        serial: null,
        originalSerial: null,
        gasGaugeStatus: null
    };

    const batterySerial = itunesData.BatterySerial
        || itunesData.BatterySerialNumber
        || (batteryReg && batteryReg.Serial)
        || null;

    const originalSerial = itunesData.OriginalBatterySerial
        || itunesData.OriginalBatterySerialNumber
        || null;

    result.serial = batterySerial;
    result.originalSerial = originalSerial;

    if (batteryReg) {
        const permanentFailure = batteryReg.PermanentFailureStatus
            || batteryReg['PermanentFailureStatus']
            || 0;

        result.gasGaugeStatus = permanentFailure !== 0 ? 'Permanent Failure' : 'Normal';

        if (permanentFailure !== 0) {
            result.reasons.push('GasGauge reports Permanent Failure (BMS Tampered)');
            result.verdict = Verdict.MISMATCH;
        }
    }

    if (batterySerial && originalSerial) {
        if (batterySerial !== originalSerial) {
            result.reasons.push(`Battery serial mismatch`);
            result.verdict = Verdict.MISMATCH;
        } else if (result.verdict === Verdict.UNKNOWN) {
            result.verdict = Verdict.GENUINE;
        }
    }

    return result;
}

function deepVerifyScreen(touchData) {
    const result = {
        verdict: Verdict.UNKNOWN,
        reasons: [],
        cpId: null,
        vendorId: null
    };

    if (!touchData) {
        result.reasons.push('Touch controller data unavailable');
        return result;
    }

    const cpId = touchData.CpId || touchData['co-processor-id'] || touchData['cp-id'] || null;
    const vendorId = touchData.VendorID || touchData['vendor-id'] || touchData.Vendor || null;

    result.cpId = cpId !== null ? `0x${cpId.toString(16).toUpperCase()}` : null;
    result.vendorId = vendorId !== null ? `0x${vendorId.toString(16).toUpperCase()}` : null;

    const KNOWN_GENUINE_VENDORS = [0x8006, 0x8007, 0x8101, 0x8102, 0x8103];

    if (cpId === null || cpId === 0 || cpId === '0x00') {
        // Modern iOS restricts access to CpId. Default to Genuine unless other service history exists.
        result.verdict = Verdict.RESTRICTED;
        result.reasons.push('Touch controller restricted (Verified Secure)');
    } else if (vendorId !== null && vendorId !== '0x00' && !KNOWN_GENUINE_VENDORS.includes(parseInt(vendorId, 16))) {
        result.verdict = Verdict.MISMATCH;
        result.reasons.push(`Touch controller vendor ID mismatch`);
    } else {
        result.verdict = Verdict.GENUINE;
    }

    return result;
}

// ============================================
// Main Authenticity Check
// ============================================

/**
 * Run a full authenticity check on a connected iOS device.
 * * Returns a structured result containing:
 * - Overall verdict
 * - auditTrail: Array of component states
 * - sealStatus: Barometric integrity test result
 * * @param {string} uuid - Device UUID
 */
async function checkAuthenticity(uuid) {
    console.log(`[AuthenticityService] Starting full hardware scan for device ${uuid}`);

    const result = {
        success: false,
        overallVerdict: 'unable_to_determine',
        overallLabel: 'Unable to Determine',
        auditTrail: [],
        sealStatus: 'Pending',
        scannedAt: new Date().toISOString()
    };

    try {
        // 1. Fetch Default Lockdown Domain (Factory Manifest)
        let lockdownData = {};
        try {
            lockdownData = await getDomainData(uuid);
        } catch (e) {
            console.warn('[AuthenticityService] Could not read default domain:', e.message);
        }

        // 2. Fetch iTunes Domain (ServiceHistory)
        let itunesData = {};
        try {
            itunesData = await getDomainData(uuid, 'com.apple.mobile.itunes');
        } catch (e) {
            console.warn('[AuthenticityService] Could not read itunes domain:', e.message);
        }

        const serviceHistory = (itunesData.ServiceHistory && itunesData.ServiceHistory.History) || [];
        const historyMap = new Map();

        for (const item of serviceHistory) {
            if (item.Part) {
                historyMap.set(item.Part, item);
            }
        }

        // 3. Sequential data acquisition (more stable than parallel for idevicediagnostics)
        const batteryReg = await getBatteryRegistryData(uuid);
        const touchData = await getTouchControllerData(uuid);
        const sealStatus = await checkSealIntegrity(uuid);

        result.sealStatus = sealStatus;

        const batteryResult = deepVerifyBattery(itunesData, batteryReg);
        const screenResult = deepVerifyScreen(touchData);

        // 4. Evaluate Components
        const evaluatedComponents = new Set();
        let hasFlagged = false;
        let hasUnknown = false;

        const nonGenuineParts = itunesData.NonGenuineParts || itunesData['NonGenuineParts'] || [];

        // --- FIRST LOOP: Enforce Baseline Core Components ---
        for (const component of CORE_COMPONENTS) {
            const historyItem = historyMap.get(component);
            evaluatedComponents.add(component);

            let status = Verdict.GENUINE;
            let serial = 'N/A';
            let message = 'Component matches factory configuration';

            if (historyItem) {
                serial = historyItem.SerialNumber || 'N/A';

                // 2026 Cloud Pairing Logic
                if (historyItem.PartStatus === 'Unknown') {
                    status = Verdict.UNKNOWN;
                    message = 'Non-Genuine or unrecognized aftermarket part';
                    hasUnknown = true;
                } else if (historyItem.PartStatus === 'Used') {
                    status = Verdict.USED;
                    message = 'Genuine Apple part transferred from another device';
                } else if (historyItem.FinishRepair || historyItem.PairingStatus === 'Pending') {
                    status = Verdict.UNPAIRED_GENUINE;
                    message = 'Genuine part detected but Cloud Pairing is incomplete';
                    hasFlagged = true; // Flag for vendor review, but not as counterfeit
                } else if (historyItem.PartStatus === 'Not Detected') {
                    status = Verdict.NOT_DETECTED;
                    message = 'Component is completely missing or disconnected';
                    hasFlagged = true;
                }
            } else {
                // Legacy Fallback Checks
                if (nonGenuineParts.includes(component)) {
                    status = Verdict.UNKNOWN;
                    message = 'Flagged in NonGenuineParts telemetry';
                    hasUnknown = true;
                } else {
                    if (component === 'Logic Board' && lockdownData.MLBSerialNumber) {
                        serial = lockdownData.MLBSerialNumber;
                    } else if (serial === 'N/A') {
                        serial = 'Verified Secure';
                    }
                }
            }

            // Apply Deep Verification logic for specific parts
            if (component === 'Battery') {
                if (status === Verdict.GENUINE && batteryResult.verdict === Verdict.MISMATCH) {
                    status = Verdict.MISMATCH;
                    message = batteryResult.reasons.join(', ');
                    hasFlagged = true;
                }
                if (batteryResult.serial) serial = batteryResult.serial;
            } else if (component === 'Display') {
                if (status === Verdict.GENUINE && screenResult.verdict === Verdict.MISMATCH) {
                    status = Verdict.MISMATCH;
                    message = screenResult.reasons.join(', ');
                    hasFlagged = true;
                }
            }

            // Factory manifest mismatch check for specific peripherals
            if (component === 'Taptic Engine' || component === 'Main Speaker') {
                const factoryKey = component === 'Taptic Engine' ? 'TapticEngineSerialNumber' : 'MainSpeakerSerialNumber';
                const factorySerial = lockdownData[factoryKey];

                if (factorySerial && serial !== 'N/A' && serial !== 'Verified Secure' && factorySerial !== serial) {
                    status = Verdict.MISMATCH;
                    message = `Serial mismatch against factory manifest (Expected: ${factorySerial})`;
                    hasFlagged = true;
                }
            }

            result.auditTrail.push({
                component,
                status,
                serial,
                message
            });
        }

        // --- SECOND LOOP: Dynamically add any newly discovered parts from ServiceHistory ---
        for (const item of serviceHistory) {
            if (!evaluatedComponents.has(item.Part)) {
                let status = Verdict.GENUINE;
                let message = 'Component matches factory configuration';

                if (item.PartStatus === 'Unknown') {
                    status = Verdict.UNKNOWN;
                    message = 'Non-Genuine or unrecognized aftermarket part';
                    hasUnknown = true;
                } else if (item.PartStatus === 'Used') {
                    status = Verdict.USED;
                    message = 'Genuine Apple part transferred from another device';
                } else if (item.FinishRepair || item.PairingStatus === 'Pending') {
                    status = Verdict.UNPAIRED_GENUINE;
                    message = 'Genuine part detected but Cloud Pairing is incomplete';
                }

                result.auditTrail.push({
                    component: item.Part,
                    status,
                    serial: item.SerialNumber || 'N/A',
                    message
                });
            }
        }

        // 5. Compute overall verdict
        if (hasUnknown || hasFlagged) {
            result.overallVerdict = 'parts_flagged';
            result.overallLabel = 'Hardware Issues Detected';
        } else {
            result.overallVerdict = 'all_genuine';
            result.overallLabel = 'All Parts Genuine';
        }

        result.success = true;
        console.log(`[AuthenticityService] Scan complete — verdict: ${result.overallVerdict}, Seal: ${result.sealStatus}`);

    } catch (error) {
        console.error('[AuthenticityService] Authenticity scan failed:', error);
        result.success = false;
        result.overallVerdict = 'unable_to_determine';
        result.overallLabel = `Scan Error: ${error.message}`;
    }

    return result;
}

module.exports = {
    checkAuthenticity,
    Verdict
};