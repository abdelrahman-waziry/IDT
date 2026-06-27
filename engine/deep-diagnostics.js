/**
 * Deep Diagnostics — pymobiledevice3 high-level wrapper.
 *
 * Bridges the gap between libimobiledevice's limited IORegistry access
 * and the deeper lockdown services available through pymobiledevice3.
 * Provides per-component genuineness verdicts matching 3uTools logic.
 *
 * All methods catch bridge failures and return null rather than throwing.
 *
 * @module engine/deep-diagnostics
 */

const PythonBridge = require('./python-bridge');

const LOG_PREFIX = '[DeepDiagnostics]';

// Known Apple display vendor IDs (internal LCD/OLED suppliers)
const APPLE_DISPLAY_VENDOR_IDS = [
    0x0610, // Samsung
    0x0614, // LG Display
    0x0618, // BOE
    0x061C, // Sharp
];

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Enrich existing hardware diagnostics with deep pymobiledevice3 data.
 *
 * @param {string} uuid  Device UUID / UDID.
 * @param {object} existingHardwareResult  Result from HardwareDiagnostics.getHardwareDiagnostics().
 * @returns {Promise<object>}  Enriched result, or existing result + deepDiagnosticsAvailable:false on failure.
 */
async function enrichComponentData(uuid, existingHardwareResult) {
    const base = existingHardwareResult || {};

    if (!PythonBridge.isReady()) {
        console.warn(`${LOG_PREFIX} Python bridge not ready — skipping deep diagnostics`);
        return { ...base, deepDiagnosticsAvailable: false };
    }

    let pairingResult = null;
    let historyResult = null;

    try {
        const [pairingSettled, historySettled] = await Promise.allSettled([
            PythonBridge.send('get_component_pairing', { udid: uuid }),
            PythonBridge.send('get_service_history', { udid: uuid }),
        ]);

        if (pairingSettled.status === 'fulfilled') pairingResult = pairingSettled.value;
        if (historySettled.status === 'fulfilled') historyResult = historySettled.value;
    } catch (err) {
        console.error(`${LOG_PREFIX} Bridge call failed:`, err.message);
    }

    if (!pairingResult && !historyResult) {
        console.warn(`${LOG_PREFIX} Both deep-diag calls failed for ${uuid}`);
        return { ...base, deepDiagnosticsAvailable: false };
    }

    console.log(`${LOG_PREFIX} Deep diagnostics acquired for ${uuid}`);

    // Convenience aliases
    const pairing = pairingResult || {};
    const history = historyResult || {};

    const nonGenuineParts = history.non_genuine_parts || [];
    const batteryOriginalSerial = history.battery_original_serial || null;
    const batteryCurrentSerial = history.battery_current_serial || null;

    // ── Per-component verdicts ───────────────────────────────────────────

    const battery = _batteryVerdict(base.battery, pairing.battery, batteryOriginalSerial);
    const display = _displayVerdict(base.display, pairing.display, nonGenuineParts);
    const faceId = _faceIdVerdict(pairing.face_id);
    const frontCamera = _cameraVerdict(pairing.front_camera);
    const rearCamera = _cameraVerdict(pairing.rear_camera);
    const touchController = _touchControllerVerdict(pairing.touch_controller);
    const usbController = _usbControllerVerdict(pairing.usb_controller);
    const nfc = pairing.nfc || { detected: false };
    const haptics = pairing.haptics || { detected: false };
    const baseband = pairing.baseband || { detected: false };

    return {
        ...base,
        deepDiagnosticsAvailable: true,

        battery,
        display,
        faceId,
        frontCamera,
        rearCamera,
        touchController,
        usbController,
        nfc,
        haptics,
        baseband,

        serviceHistory: history.service_history || [],
        nonGenuineParts,
    };
}

// ─── Verdict helpers ─────────────────────────────────────────────────────────

function _batteryVerdict(existingBattery, pairingBattery, originalSerial) {
    const merged = { ...(existingBattery || {}), ...(pairingBattery || {}) };

    const serial = merged.Serial || merged.serial || null;
    const authenticated = merged.battery_authenticated;
    const permanentFailure = merged.PermanentFailureStatus;

    let genuineness = 'unknown';

    if (permanentFailure != null && permanentFailure !== 0) {
        // BMS tampered
        genuineness = 'mismatch';
    } else if (serial && originalSerial) {
        if (serial === originalSerial) {
            // Serials match — genuine unless auth says otherwise
            genuineness = (authenticated === false) ? 'unauthenticated' : 'genuine';
        } else {
            // Serials differ
            if (authenticated === true) {
                genuineness = 'replaced_genuine';
            } else if (authenticated === false) {
                genuineness = 'unauthenticated';
            } else {
                // Can't tell auth status but serials differ
                genuineness = 'replaced_genuine';
            }
        }
    } else if (authenticated === false) {
        genuineness = 'unauthenticated';
    }
    // else: insufficient data → stays 'unknown'

    return {
        ...merged,
        genuineness,
    };
}

function _displayVerdict(existingDisplay, pairingDisplay, nonGenuineParts) {
    const data = pairingDisplay || {};
    const moduleSerial = data.DisplayModuleSerial || null;
    const moduleVendorID = data.DisplayModuleVendorID || null;

    let verdict = 'unverifiable';
    let note = null;

    if (moduleVendorID != null && !APPLE_DISPLAY_VENDOR_IDS.includes(moduleVendorID)) {
        verdict = 'non_genuine_vendor';
    } else if (nonGenuineParts.includes('Display')) {
        verdict = 'flagged_non_genuine';
    } else {
        verdict = 'unverifiable';
        note = 'Display pairing state is Secure Enclave gated and cannot be read externally';
    }

    return {
        ...(existingDisplay || {}),
        moduleSerial,
        moduleVendorID,
        verdict,
        note,
    };
}

function _faceIdVerdict(pairingFaceId) {
    const data = pairingFaceId || {};
    const pairingState = data.PairingState != null ? data.PairingState : null;

    let verdict = 'unknown';
    if (pairingState === 2) verdict = 'paired_calibrated';
    else if (pairingState === 1) verdict = 'paired';
    else if (pairingState === 0) verdict = 'unpaired';

    return {
        pairingState,
        moduleSerial: data.ModuleSerial || null,
        firmwareVersion: data.FirmwareVersion || null,
        verdict,
    };
}

function _cameraVerdict(pairingCamera) {
    const data = pairingCamera || {};

    const moduleSerial = data.ModuleSerial || null;
    const verdict = moduleSerial ? 'serial_present' : 'unverifiable';

    return {
        moduleSerial,
        sensorSerial: data.SensorSerial || null,
        vendorID: data.VendorID || null,
        verdict,
    };
}

function _touchControllerVerdict(pairingTouch) {
    const data = pairingTouch || {};
    const vid = data.VendorID;
    const knownGenuineVendor = data.known_genuine_vendor;

    let verdict = 'restricted';
    if (knownGenuineVendor === true) verdict = 'genuine_vendor';
    else if (knownGenuineVendor === false) verdict = 'non_genuine_vendor';

    return {
        cpId: data.CpId || null,
        vendorID: vid || null,
        knownGenuineVendor: knownGenuineVendor != null ? knownGenuineVendor : null,
        verdict,
    };
}

function _usbControllerVerdict(pairingUsb) {
    const data = pairingUsb || {};

    if (!data.detected) {
        return {
            serial: null,
            pairingStatus: null,
            verdict: 'not_applicable',
        };
    }

    const pairingStatus = data.PairingStatus || null;
    let verdict = 'not_applicable';

    if (pairingStatus != null) {
        // Any truthy/string 'paired' value
        const isPaired = typeof pairingStatus === 'string'
            ? pairingStatus.toLowerCase().includes('paired')
            : !!pairingStatus;
        verdict = isPaired ? 'paired' : 'unpaired';
    }

    return {
        serial: data.ControllerSerial || null,
        pairingStatus,
        verdict,
    };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { enrichComponentData };
