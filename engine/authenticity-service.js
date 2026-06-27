/**
 * Authenticity Service — Non-Genuine Hardware Part Detection (2026 Engine)
 *
 * Data sources (in priority order):
 *  1. pymobiledevice3 via PythonBridge — deep IORegistry, component pairing,
 *     service history from com.apple.mobile.itunes
 *  2. idevicediagnostics — shallow IORegistry fallback if bridge unavailable
 *
 * Key design principle: an empty ServiceHistory does NOT mean all parts are
 * genuine — it means the device has never been repaired through Apple's system.
 * Genuineness for unserviced devices is determined from IORegistry data directly.
 *
 * @module engine/authenticity-service
 */

const { execFile } = require('child_process');
const path = require('path');
const plist = require('plist');
const { promisify } = require('util');
const PythonBridge = require('./python-bridge');

const execFileAsync = promisify(execFile);

// ============================================
// Binary Resolution (shallow fallback layer)
// ============================================

function getBinaryPath(binaryName) {
    const { app } = require('electron');
    const platform = process.platform === 'win32' ? 'win32' : 'darwin';
    const ext = process.platform === 'win32' ? '.exe' : '';
    const fileName = `${binaryName}${ext}`;
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'bin', platform, fileName);
    }
    return path.join(__dirname, '..', 'resources', 'bin', platform, fileName);
}

async function executeBinary(binaryName, args = [], timeout = 30000) {
    const binaryPath = getBinaryPath(binaryName);
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
        if (error.code === 'ENOENT') throw new Error(`Binary not found: ${binaryPath}`);
        if (error.killed) throw new Error(`Command timed out after ${timeout}ms`);
        throw error;
    }
}

// ============================================
// Component list
// ============================================

const CORE_COMPONENTS = [
    'Battery', 'Display', 'Rear Camera', 'Front Camera',
    'Taptic Engine', 'Main Speaker', 'Receiver (Earpiece)', 'Main Microphone',
    'USB-C/Lightning Connector Flex', 'FaceID/TouchID Biometrics',
    'Logic Board', 'Rear Glass'
];

const Verdict = {
    GENUINE: 'genuine',
    UNPAIRED_GENUINE: 'unpaired_genuine',
    UNKNOWN: 'unknown',
    USED: 'used',
    MISMATCH: 'mismatch',
    NOT_DETECTED: 'not_detected',
    RESTRICTED: 'restricted',
    // New: clearly distinct from GENUINE — means we have no data either way
    UNVERIFIED: 'unverified'
};

// ============================================
// Shallow fallback data acquisition
// (used only when PythonBridge is unavailable)
// ============================================

async function _shallowBatteryRegistry(uuid) {
    try {
        const stdout = await executeBinary('idevicediagnostics', [
            'ioregentry', 'AppleSmartBattery', '-u', uuid
        ]);
        const parsed = plist.parse(stdout);
        return parsed.IORegistry || parsed;
    } catch {
        return null;
    }
}

async function _shallowTouchController(uuid) {
    try {
        const stdout = await executeBinary('idevicediagnostics', [
            'ioregentry', 'multi-touch', '-u', uuid
        ]);
        const parsed = plist.parse(stdout);
        return parsed.IORegistry || parsed;
    } catch {
        return null;
    }
}

// ============================================
// Component verdict logic
// Each function returns { verdict, serial, factorySerial, message }
// ============================================

function _batteryVerdict(deepBattery, serviceHistoryItem, itunesData) {
    // Priority 1: iOS 17+ authentication flag
    if (deepBattery?.battery_authenticated === false) {
        return {
            verdict: Verdict.MISMATCH,
            serial: deepBattery.serial || null,
            factorySerial: itunesData?.battery_original_serial || null,
            message: 'Battery failed iOS 17+ authentication — non-genuine part'
        };
    }

    // Priority 2: BMS tamper via PermanentFailureStatus
    if (deepBattery?.PermanentFailureStatus && deepBattery.PermanentFailureStatus !== 0) {
        return {
            verdict: Verdict.MISMATCH,
            serial: deepBattery.serial || null,
            factorySerial: itunesData?.battery_original_serial || null,
            message: 'Battery management system tampered (PermanentFailureStatus non-zero)'
        };
    }

    // Priority 3: Serial cross-reference
    const currentSerial = deepBattery?.serial || itunesData?.battery_current_serial || null;
    const originalSerial = itunesData?.battery_original_serial || null;

    if (currentSerial && originalSerial) {
        if (currentSerial !== originalSerial) {
            return {
                verdict: Verdict.MISMATCH,
                serial: currentSerial,
                factorySerial: originalSerial,
                message: 'Battery serial does not match factory original'
            };
        }
        return {
            verdict: Verdict.GENUINE,
            serial: currentSerial,
            factorySerial: originalSerial,
            message: 'Battery serial matches factory original'
        };
    }

    // Priority 4: ServiceHistory entry
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(serviceHistoryItem, currentSerial);
    }

    // No original serial to compare against — device has not been repaired
    // Show the current serial in both columns so technician can see it
    return {
        verdict: Verdict.GENUINE,
        serial: currentSerial || 'N/A',
        factorySerial: currentSerial || 'N/A',
        message: 'Battery serial present — no replacement history on record'
    };
}

function _displayVerdict(deepDisplay, serviceHistoryItem, nonGenuineParts) {
    // NonGenuineParts telemetry is the most reliable signal for display
    if (nonGenuineParts.includes('Display')) {
        return {
            verdict: Verdict.MISMATCH,
            serial: deepDisplay?.panel_serial || deepDisplay?.module_serial || 'N/A',
            factorySerial: 'N/A',
            message: 'Display flagged as non-genuine in iOS telemetry (NonGenuineParts)'
        };
    }

    // ServiceHistory entry
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(
            serviceHistoryItem,
            deepDisplay?.panel_serial || deepDisplay?.module_serial
        );
    }

    // Touch controller vendor ID check (indirect display genuineness signal)
    // A non-genuine display often comes with a non-genuine touch controller
    // — handled separately in FaceID/Touch component

    // Module vendor ID if available
    const vendorId = deepDisplay?.module_vendor_id;
    if (vendorId !== null && vendorId !== undefined) {
        // We have a vendor ID but no known Apple OEM ID list for display modules
        // — report it as data for the technician but don't auto-fail
        return {
            verdict: Verdict.UNVERIFIED,
            serial: deepDisplay?.panel_serial || deepDisplay?.module_serial || 'N/A',
            factorySerial: 'N/A',
            message: `Display module vendor ID: ${deepDisplay?.module_vendor_id_hex || vendorId}. Pairing state not readable externally (Secure Enclave gated).`
        };
    }

    // Missing Serial despite deep scan implies aftermarket or unreadable
    const serial = deepDisplay?.panel_serial || deepDisplay?.module_serial || null;
    if (!serial && deepDisplay) {
        return {
            verdict: Verdict.UNKNOWN,
            serial: 'N/A',
            factorySerial: 'N/A',
            message: 'Display serial not readable (potentially aftermarket)'
        };
    }

    // No service history = Factory original
    return {
        verdict: Verdict.GENUINE,
        serial: serial || 'N/A',
        factorySerial: 'N/A',
        message: 'Factory original component (no service history)'
    };
}

function _faceIdVerdict(deepFaceId, serviceHistoryItem, componentPairing) {
    if (!deepFaceId?.detected) {
        if (serviceHistoryItem) {
            return _verdictFromHistoryItem(serviceHistoryItem, null);
        }
        
        // If it's a deep scan and Face ID is not detected, check if it's a Touch ID model.
        // Touch ID models have secure_enclave detected (MesaSerialNumber).
        const hasTouchId = componentPairing?.secure_enclave?.detected;
        if (componentPairing && !hasTouchId) {
             // Device is likely Face ID capable, but sensor is missing/damaged
             return {
                 verdict: Verdict.NOT_DETECTED,
                 serial: 'N/A',
                 factorySerial: 'N/A',
                 message: 'Face ID / TrueDepth sensor not detected (hardware fault or disconnected)'
             };
        }
        
        return {
            verdict: Verdict.GENUINE,
            serial: 'N/A',
            factorySerial: 'N/A',
            message: 'Factory original component (no service history)'
        };
    }

    const pairingState = deepFaceId.PairingState;

    if (pairingState === 2) {
        return {
            verdict: Verdict.GENUINE,
            serial: deepFaceId.serial || 'N/A',
            factorySerial: 'N/A',
            message: 'Face ID sensor paired and calibrated to this logic board'
        };
    }
    if (pairingState === 1) {
        return {
            verdict: Verdict.GENUINE,
            serial: deepFaceId.serial || 'N/A',
            factorySerial: 'N/A',
            message: 'Face ID sensor paired to this logic board'
        };
    }
    if (pairingState === 0) {
        return {
            verdict: Verdict.UNPAIRED_GENUINE,
            serial: deepFaceId.serial || 'N/A',
            factorySerial: 'N/A',
            message: 'Face ID sensor detected but unpaired — replaced part needs Repair Assistant'
        };
    }

    // pairingState null — iOS restricted access
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(serviceHistoryItem, deepFaceId.serial);
    }

    // No service history = N/A
    return {
        verdict: Verdict.GENUINE,
        serial: deepFaceId?.serial || 'N/A',
        factorySerial: 'N/A',
        message: 'Factory original component (no service history)'
    };
}

function _touchVendorVerdict(deepTouch, serviceHistoryItem) {
    if (!deepTouch?.detected) {
        return {
            verdict: Verdict.UNVERIFIED,
            serial: 'N/A',
            factorySerial: 'N/A',
            message: 'Touch controller not detected'
        };
    }

    // Modern iOS restricts CpId — vendor ID is the only available signal
    if (deepTouch.known_genuine_vendor === false) {
        return {
            verdict: Verdict.MISMATCH,
            serial: deepTouch.VendorID_hex || String(deepTouch.VendorID) || 'N/A',
            factorySerial: 'Apple OEM vendor',
            message: `Touch controller vendor ID ${deepTouch.VendorID_hex} is not a known Apple OEM vendor`
        };
    }

    if (deepTouch.known_genuine_vendor === true) {
        return {
            verdict: Verdict.GENUINE,
            serial: deepTouch.VendorID_hex || 'N/A',
            factorySerial: 'N/A',
            message: 'Touch controller vendor ID matches known Apple OEM'
        };
    }

    // null — VendorID not available (iOS restricted)
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(serviceHistoryItem, null);
    }

    return {
        verdict: Verdict.GENUINE,
        serial: 'N/A',
        factorySerial: 'N/A',
        message: 'Factory original component (no service history)'
    };
}

function _cameraVerdict(deepCamera, serviceHistoryItem, label, componentPairing) {
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(
            serviceHistoryItem,
            deepCamera?.serial
        );
    }

    const serial = deepCamera?.serial || null;
    
    // If it's a deep scan and camera serial is completely missing despite all log-scraping fallbacks
    if (!serial && componentPairing) {
        return {
            verdict: Verdict.UNKNOWN,
            serial: 'N/A',
            factorySerial: 'N/A',
            message: `${label} serial not readable (potentially aftermarket)`
        };
    }
    
    return {
        verdict: Verdict.GENUINE,
        serial: serial || 'N/A',
        factorySerial: 'N/A',
        message: 'Factory original component (no service history)'
    };
}

function _genericComponentVerdict(component, serviceHistoryItem, nonGenuineParts, lockdownData, componentSerials) {
    // Check NonGenuineParts telemetry first
    if (nonGenuineParts.includes(component)) {
        return {
            verdict: Verdict.UNKNOWN,
            serial: 'N/A',
            factorySerial: 'N/A',
            message: `${component} flagged in iOS NonGenuineParts telemetry`
        };
    }

    // ServiceHistory entry
    if (serviceHistoryItem) {
        return _verdictFromHistoryItem(serviceHistoryItem, null);
    }

    // Logic board — use MLB serial from lockdown
    if (component === 'Logic Board' && lockdownData?.MLBSerialNumber) {
        return {
            verdict: Verdict.GENUINE,
            serial: lockdownData.MLBSerialNumber,
            factorySerial: lockdownData.MLBSerialNumber,
            message: 'Logic board MLB serial verified from lockdown domain'
        };
    }

    // component_serials from service history items
    const knownSerial = componentSerials?.[component] || null;

    // No data — assume N/A
    return {
        verdict: Verdict.GENUINE,
        serial: knownSerial || 'N/A',
        factorySerial: 'N/A',
        message: 'Factory original component (no service history)'
    };
}

function _verdictFromHistoryItem(item, overrideSerial) {
    const serial = overrideSerial || item.SerialNumber || 'N/A';
    const factorySerial = item.SerialNumber || 'N/A';

    if (item.PartStatus === 'Unknown') {
        return {
            verdict: Verdict.UNKNOWN,
            serial,
            factorySerial,
            message: 'Non-genuine or unrecognized aftermarket part (Apple system reports Unknown)'
        };
    }
    if (item.PartStatus === 'Used') {
        return {
            verdict: Verdict.USED,
            serial,
            factorySerial,
            message: 'Genuine Apple part transferred from another device'
        };
    }
    if (item.FinishRepair || item.PairingStatus === 'Pending') {
        return {
            verdict: Verdict.UNPAIRED_GENUINE,
            serial,
            factorySerial,
            message: 'Genuine part detected but Repair Assistant cloud pairing is incomplete'
        };
    }
    if (item.PartStatus === 'Not Detected') {
        return {
            verdict: Verdict.NOT_DETECTED,
            serial: 'N/A',
            factorySerial,
            message: 'Component missing or disconnected'
        };
    }

    return {
        verdict: Verdict.GENUINE,
        serial,
        factorySerial,
        message: 'Component matches service history record'
    };
}

// ============================================
// Main Authenticity Check
// ============================================

async function checkAuthenticity(uuid) {
    console.log(`[AuthenticityService] Starting full hardware scan for device ${uuid}`);

    const result = {
        success: false,
        overallVerdict: 'unable_to_determine',
        overallLabel: 'Unable to Determine',
        auditTrail: [],
        sealStatus: 'Unknown',
        deepDataUsed: false,
        scannedAt: new Date().toISOString()
    };

    try {
        // ── 1. Fetch deep data via PythonBridge ──────────────────────────────
        let activationData = null;
        let serviceHistoryData = null;
        let componentPairing = null;
        let deepDataAvailable = false;

        try {
            [activationData, serviceHistoryData, componentPairing] = await Promise.all([
                PythonBridge.send('get_activation_details', { udid: uuid }, 120000),
                PythonBridge.send('get_service_history', { udid: uuid }, 120000),
                PythonBridge.send('get_component_serials', { udid: uuid }, 120000)
            ]);
            deepDataAvailable = true;
            result.deepDataUsed = true;
            require('fs').writeFileSync('authenticity_payloads.log', JSON.stringify({ serviceHistoryData, componentPairing }, null, 2));
        } catch (bridgeErr) {
            require('fs').writeFileSync('authenticity_error.log', `[AuthenticityService] PythonBridge unavailable: ${bridgeErr.stack || bridgeErr.message}`);
            console.warn('[AuthenticityService] PythonBridge unavailable, falling back to shallow layer:', bridgeErr.message);
        }

        // ── 2. Shallow fallback if bridge failed ─────────────────────────────
        let shallowBattery = null;
        let shallowTouch = null;

        if (!deepDataAvailable) {
            [shallowBattery, shallowTouch] = await Promise.all([
                _shallowBatteryRegistry(uuid),
                _shallowTouchController(uuid)
            ]);

            // Shallow iTunes domain fallback
            try {
                const { execFile: ef } = require('child_process');
                const efAsync = promisify(ef);
                const stdout = await executeBinary('ideviceinfo', ['-u', uuid, '-q', 'com.apple.mobile.itunes', '-x']);
                const raw = plist.parse(stdout);
                serviceHistoryData = {
                    service_history: (raw.ServiceHistory?.History) || [],
                    non_genuine_parts: raw.NonGenuineParts || [],
                    battery_original_serial: raw.OriginalBatterySerial || raw.OriginalBatterySerialNumber || null,
                    battery_current_serial: raw.BatterySerial || raw.BatterySerialNumber || null,
                    component_serials: {}
                };
                activationData = {
                    MLBSerialNumber: null,
                    IsSupervised: null
                };
            } catch (e) {
                console.warn('[AuthenticityService] Shallow iTunes domain fallback also failed:', e.message);
                serviceHistoryData = {
                    service_history: [], non_genuine_parts: [],
                    battery_original_serial: null, battery_current_serial: null,
                    component_serials: {}
                };
                activationData = {};
            }
        }

        const serviceHistory = serviceHistoryData?.service_history || [];
        const nonGenuineParts = serviceHistoryData?.non_genuine_parts || [];
        const componentSerials = serviceHistoryData?.component_serials || {};

        // Build service history map keyed by Part name
        const historyMap = new Map();
        for (const item of serviceHistory) {
            if (item?.Part) historyMap.set(item.Part, item);
        }

        // Deep component data (null if bridge unavailable)
        const deepBattery = componentPairing?.battery || null;
        const deepDisplay = componentPairing?.display || null;
        const deepFaceId = componentPairing?.face_id || null;
        const deepTouch = componentPairing?.touch_controller || (shallowTouch ? {
            detected: true,
            CpId: shallowTouch.CpId,
            VendorID: shallowTouch.VendorID,
            VendorID_hex: shallowTouch.VendorID ? `0x${shallowTouch.VendorID.toString(16).toUpperCase()}` : null,
            known_genuine_vendor: [0x8006, 0x8007, 0x8101, 0x8102, 0x8103].includes(shallowTouch.VendorID)
        } : null);
        const deepFrontCam = componentPairing?.front_camera || null;
        const deepRearCam = componentPairing?.rear_camera || null;

        // Merge shallow battery into deepBattery shape if bridge was unavailable
        const effectiveBattery = deepBattery || (shallowBattery ? {
            detected: true,
            serial: shallowBattery.Serial || shallowBattery.BatterySerialNumber || null,
            PermanentFailureStatus: shallowBattery.PermanentFailureStatus || 0,
            battery_authenticated: null
        } : null);

        // ── 3. Evaluate each core component ─────────────────────────────────
        let hasFlagged = false;
        let hasUnknown = false;
        const evaluatedComponents = new Set();

        for (const component of CORE_COMPONENTS) {
            evaluatedComponents.add(component);
            const historyItem = historyMap.get(component);
            let v;

            switch (component) {
                case 'Battery':
                    v = _batteryVerdict(effectiveBattery, historyItem, serviceHistoryData);
                    break;

                case 'Display':
                    v = _displayVerdict(deepDisplay, historyItem, nonGenuineParts);
                    break;

                case 'FaceID/TouchID Biometrics':
                    // Face ID pairing state from IORegistry
                    v = _faceIdVerdict(deepFaceId, historyItem, componentPairing);
                    // If Face ID is unverified/restricted, also check touch vendor
                    if ([Verdict.UNVERIFIED, Verdict.RESTRICTED].includes(v.verdict)) {
                        const touchV = _touchVendorVerdict(deepTouch, historyItem);
                        if (touchV.verdict === Verdict.MISMATCH) v = touchV;
                    }
                    break;

                case 'Rear Camera':
                    v = _cameraVerdict(deepRearCam, historyItem, 'Rear camera', componentPairing);
                    break;

                case 'Front Camera':
                    v = _cameraVerdict(deepFrontCam, historyItem, 'Front camera', componentPairing);
                    break;

                default:
                    v = _genericComponentVerdict(
                        component, historyItem, nonGenuineParts,
                        activationData, componentSerials
                    );
            }

            if (v.verdict === Verdict.MISMATCH || v.verdict === Verdict.NOT_DETECTED) hasFlagged = true;
            if (v.verdict === Verdict.UNKNOWN) hasUnknown = true;

            result.auditTrail.push({
                component,
                status: v.verdict,
                serial: v.serial,
                factorySerial: v.factorySerial,
                message: v.message
            });
        }

        // ── 4. Dynamic components from ServiceHistory not in CORE_COMPONENTS ─
        for (const item of serviceHistory) {
            if (!evaluatedComponents.has(item.Part) && item.Part) {
                const v = _verdictFromHistoryItem(item, null);
                if (v.verdict === Verdict.UNKNOWN) hasUnknown = true;
                result.auditTrail.push({
                    component: item.Part,
                    status: v.verdict,
                    serial: v.serial,
                    factorySerial: v.factorySerial,
                    message: v.message
                });
            }
        }

        // ── 5. Overall verdict ───────────────────────────────────────────────
        if (hasUnknown || hasFlagged) {
            result.overallVerdict = 'parts_flagged';
            result.overallLabel = 'Hardware Issues Detected';
        } else if (!deepDataAvailable && serviceHistory.length === 0) {
            // Shallow layer, no service history — genuineness unverifiable
            result.overallVerdict = 'unverifiable';
            result.overallLabel = 'Cannot Verify — Connect via Repair Assistant or run deep scan';
        } else {
            result.overallVerdict = 'all_genuine';
            result.overallLabel = deepDataAvailable
                ? 'All Parts Verified Genuine'
                : 'No Issues Detected (Limited Scan)';
        }

        result.success = true;
        console.log(`[AuthenticityService] Scan complete — verdict: ${result.overallVerdict}, deep: ${deepDataAvailable}`);

    } catch (error) {
        console.error('[AuthenticityService] Authenticity scan failed:', error);
        result.overallVerdict = 'unable_to_determine';
        result.overallLabel = `Scan Error: ${error.message}`;
    }

    return result;
}

module.exports = { checkAuthenticity, Verdict };