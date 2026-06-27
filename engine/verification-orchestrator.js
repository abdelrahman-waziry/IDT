/**
 * Verification Orchestrator — end-to-end device verification pipeline.
 *
 * Collects data from all engine modules in parallel where possible,
 * cross-references serials, scores risk, and returns a single
 * VerificationResult object.
 *
 * @module engine/verification-orchestrator
 */

const DeviceManager = require('./device-manager');
const HardwareDiagnostics = require('./hardware-diagnostics');
const AuthenticityService = require('./authenticity-service');
const APIService = require('./api-service');
const DeepDiagnostics = require('./deep-diagnostics');
const PythonBridge = require('./python-bridge');

const LOG_PREFIX = '[VerificationOrchestrator]';

// ─── Risk rule definitions ──────────────────────────────────────────────────

const RISK_RULES = [
    { id: 'ICLOUD_LOCKED',              points: 60, level: 'BLOCKED', test: ctx => ctx.gsxResult?.findMyIphone === 'ON' },
    { id: 'BLACKLISTED',                points: 70, level: 'BLOCKED', test: ctx => {
        const bs = ctx.imeiResult?.blacklistStatus;
        return bs && bs !== 'Clean' && !String(bs).includes('Mock');
    }},
    { id: 'SERIAL_MISMATCH',            points: 50, level: 'FAIL',    test: ctx => ctx.serialCrossRef.status === 'MISMATCH' },
    { id: 'ACTIVATION_LOCKED',          points: 40, level: 'FAIL',    test: ctx => ctx.deviceInfo?.ActivationState && ctx.deviceInfo.ActivationState !== 'Activated' },
    { id: 'MDM_SUPERVISED',             points: 25, level: 'WARN',    test: ctx => ctx.isSupervised === true },
    { id: 'BATTERY_UNAUTHENTICATED',    points: 25, level: 'WARN',    test: ctx => ctx.battery?.genuineness === 'unauthenticated' },
    { id: 'BATTERY_MISMATCH',           points: 20, level: 'WARN',    test: ctx => ctx.battery?.genuineness === 'mismatch' },
    { id: 'BATTERY_REPLACED',           points: 15, level: 'WARN',    test: ctx => ctx.battery?.genuineness === 'replaced_genuine' },
    { id: 'PARTS_FLAGGED',              points: 20, level: 'WARN',    test: ctx => ctx.overallVerdict === 'parts_flagged' },
    { id: 'FACE_ID_UNPAIRED',           points: 20, level: 'WARN',    test: ctx => ctx.faceId?.verdict === 'unpaired' },
    { id: 'TOUCH_NON_GENUINE',          points: 15, level: 'WARN',    test: ctx => ctx.touchController?.verdict === 'non_genuine_vendor' },
    { id: 'DISPLAY_NON_GENUINE',        points: 15, level: 'WARN',    test: ctx => ctx.display?.verdict === 'non_genuine_vendor' || ctx.display?.verdict === 'flagged_non_genuine' },
    { id: 'USB_CONTROLLER_UNPAIRED',    points: 15, level: 'WARN',    test: ctx => ctx.usbController?.verdict === 'unpaired' },
    { id: 'BATTERY_HEALTH_LOW',         points: 10, level: 'WARN',    test: ctx => ctx.battery?.healthPercent != null && ctx.battery.healthPercent < 80 },
    { id: 'IMEI_CHECK_UNAVAILABLE',     points: 5,  level: 'INFO',    test: ctx => ctx.dataSources.imeiCheck !== 'ok' },
    { id: 'DEEP_DIAGNOSTICS_UNAVAILABLE', points: 5, level: 'INFO',   test: ctx => ctx.dataSources.deepDiagnostics !== 'ok' },
    { id: 'SERIAL_UNVERIFIED',          points: 5,  level: 'INFO',    test: ctx => ctx.serialCrossRef.status === 'UNVERIFIED' },
];

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Run the full verification pipeline for a connected device.
 *
 * @param {string} uuid  Device UUID.
 * @returns {Promise<object>}  VerificationResult.
 */
async function runVerification(uuid) {
    console.log(`${LOG_PREFIX} Starting verification for ${uuid}`);

    const dataSources = {
        deviceInfo: 'skipped',
        hardware: 'skipped',
        deepDiagnostics: 'skipped',
        authenticity: 'skipped',
        imeiCheck: 'skipped',
    };

    // ──────────────────────────────────────────────────────────────────────
    // STEP 1 — Collect data
    // ──────────────────────────────────────────────────────────────────────

    // Phase A: sequential collection to prevent USB lockdown conflicts (AMDS)
    const deviceInfoResult = await DeviceManager.getDeviceInfo(uuid).catch(e => ({ error: true, message: e.message }));
    const authenticityResult = await AuthenticityService.checkAuthenticity(uuid).catch(e => ({ success: false, message: e.message }));

    const deviceInfoSettled = { status: deviceInfoResult.error ? 'rejected' : 'fulfilled', value: deviceInfoResult };
    const authenticitySettled = { status: authenticityResult.success === false && !authenticityResult.deepDataUsed ? 'rejected' : 'fulfilled', value: authenticityResult };

    // Device info
    let deviceInfo = null;
    if (deviceInfoSettled.status === 'fulfilled' && !deviceInfoSettled.value?.error) {
        deviceInfo = deviceInfoSettled.value;
        dataSources.deviceInfo = 'ok';
    } else {
        dataSources.deviceInfo = 'failed';
    }

    // Authenticity
    let authResult = null;
    if (authenticitySettled.status === 'fulfilled' && authenticitySettled.value?.success) {
        authResult = authenticitySettled.value;
        dataSources.authenticity = 'ok';
    } else {
        dataSources.authenticity = 'failed';
    }

    // Blocked early exit
    if (!deviceInfo) {
        console.warn(`${LOG_PREFIX} Device unreachable — aborting verification`);
        return {
            success: false,
            blocked: true,
            blockReason: 'DEVICE_UNREACHABLE',
            riskResult: 'BLOCKED',
            riskScore: 100,
            flags: ['DEVICE_UNREACHABLE'],
            dataSources,
        };
    }

    // IMEI-dependent calls
    const imei = deviceInfo.IMEI && deviceInfo.IMEI !== 'N/A (WiFi Only)' ? deviceInfo.IMEI : null;

    let gsxResult = null;
    let imeiResult = null;

    if (imei) {
        const [gsxSettled, imeiSettled] = await Promise.allSettled([
            APIService.getGSXInfo(imei),
            APIService.getIMEIInfo(imei),
        ]);

        if (gsxSettled.status === 'fulfilled') {
            gsxResult = gsxSettled.value;
            // Check for mock/failure marker
            const hasMock = Object.values(gsxResult || {}).some(v => typeof v === 'string' && v.includes('Mock'));
            if (!hasMock) dataSources.imeiCheck = 'ok';
            else dataSources.imeiCheck = 'failed';
        } else {
            dataSources.imeiCheck = 'failed';
        }

        if (imeiSettled.status === 'fulfilled') {
            imeiResult = imeiSettled.value;
            const hasMock = Object.values(imeiResult || {}).some(v => typeof v === 'string' && v.includes('Mock'));
            if (hasMock && dataSources.imeiCheck !== 'ok') dataSources.imeiCheck = 'failed';
            else if (!hasMock) dataSources.imeiCheck = 'ok';
        }
    } else {
        dataSources.imeiCheck = 'skipped';
    }

    // Phase B: sequential hardware + deep diagnostics
    let hardwareResult = null;
    try {
        hardwareResult = await HardwareDiagnostics.getHardwareDiagnostics(uuid);
        dataSources.hardware = 'ok';
    } catch (err) {
        console.error(`${LOG_PREFIX} Hardware diagnostics failed:`, err.message);
        dataSources.hardware = 'failed';
    }

    let enrichedHardware = null;
    try {
        enrichedHardware = await DeepDiagnostics.enrichComponentData(uuid, hardwareResult);
        if (enrichedHardware?.deepDiagnosticsAvailable) {
            dataSources.deepDiagnostics = 'ok';
        } else {
            dataSources.deepDiagnostics = 'failed';
        }
    } catch (err) {
        console.error(`${LOG_PREFIX} Deep diagnostics failed:`, err.message);
        dataSources.deepDiagnostics = 'failed';
        enrichedHardware = hardwareResult ? { ...hardwareResult, deepDiagnosticsAvailable: false } : null;
    }

    // Attempt to get activation details from Python bridge for extra fields
    let deepActivation = null;
    try {
        if (PythonBridge.isReady()) {
            deepActivation = await PythonBridge.send('get_activation_details', { udid: uuid });
        }
    } catch (err) {
        console.warn(`${LOG_PREFIX} Deep activation fetch failed:`, err.message);
    }

    // ──────────────────────────────────────────────────────────────────────
    // STEP 2 — Serial cross-reference
    // ──────────────────────────────────────────────────────────────────────

    const deviceSerial = deviceInfo.SerialNumber || null;
    const mlbSerial = deviceInfo._raw?.MLBSerialNumber || deepActivation?.MLBSerialNumber || null;
    const ecid = deviceInfo._raw?.UniqueChipID || deepActivation?.UniqueChipID || null;
    const imei2 = deepActivation?.IMEI2 || null;

    // Find serial from GSX result (any key containing 'serial' case-insensitively)
    let imeiSerial = null;
    if (gsxResult) {
        for (const [key, val] of Object.entries(gsxResult)) {
            if (key.toLowerCase().includes('serial') && typeof val === 'string') {
                imeiSerial = val;
                break;
            }
        }
    }

    const serialCrossRef = { deviceSerial, imeiSerial, status: 'MISSING' };
    if (deviceSerial && imeiSerial) {
        serialCrossRef.status = deviceSerial === imeiSerial ? 'MATCH' : 'MISMATCH';
    } else if (deviceSerial && !imeiSerial) {
        serialCrossRef.status = 'UNVERIFIED';
    } else {
        serialCrossRef.status = 'MISSING';
    }

    // ──────────────────────────────────────────────────────────────────────
    // STEP 3 — Risk scoring
    // ──────────────────────────────────────────────────────────────────────

    const isSupervised = deviceInfo._raw?.IsSupervised || deepActivation?.IsSupervised || false;
    const battery = enrichedHardware?.battery || hardwareResult?.battery || null;
    const display = enrichedHardware?.display || null;
    const faceId = enrichedHardware?.faceId || null;
    const touchController = enrichedHardware?.touchController || null;
    const usbController = enrichedHardware?.usbController || null;
    const overallVerdict = authResult?.overallVerdict || 'unable_to_determine';
    const overallLabel = authResult?.overallLabel || 'Scan Failed';
    const auditTrail = authResult?.auditTrail || [];
    const sealStatus = authResult?.sealStatus || 'Unknown';
    const summary = enrichedHardware?.summary || hardwareResult?.summary || null;

    const riskContext = {
        gsxResult, imeiResult, serialCrossRef, deviceInfo, isSupervised,
        battery, display, faceId, touchController, usbController,
        overallVerdict, dataSources,
    };

    let riskScore = 0;
    const flags = [];

    for (const rule of RISK_RULES) {
        try {
            if (rule.test(riskContext)) {
                riskScore += rule.points;
                flags.push(rule.id);
            }
        } catch {
            // Rule evaluation error — skip silently
        }
    }

    let riskResult;
    const hasBlocked = flags.some(f => RISK_RULES.find(r => r.id === f)?.level === 'BLOCKED');
    const hasFail = flags.some(f => RISK_RULES.find(r => r.id === f)?.level === 'FAIL');

    if (hasBlocked) riskResult = 'BLOCKED';
    else if (hasFail) riskResult = 'FAIL';
    else if (riskScore >= 20) riskResult = 'WARN';
    else riskResult = 'PASS';

    // ──────────────────────────────────────────────────────────────────────
    // STEP 4 — Assemble result
    // ──────────────────────────────────────────────────────────────────────

    const result = {
        success: true,
        verifiedAt: new Date().toISOString(),
        uuid,

        device: {
            serial: deviceSerial,
            mlbSerial,
            ecid,
            imei: deviceInfo.IMEI,
            imei2,
            model: deviceInfo.Model,
            modelName: deviceInfo.ModelName,
            iosVersion: deviceInfo.iOSVersion,
            activationState: deviceInfo.ActivationState,
            isSupervised,
            color: deviceInfo.Color,
            storage: deviceInfo.TotalDiskCapacity,
        },

        hardware: {
            batteryHealth: battery?.healthPercent || null,
            batteryCycleCount: battery?.cycleCount || null,
            batterySerial: battery?.serial || null,
            batteryGenuineness: battery?.genuineness || 'unknown',
            batteryAuthenticated: battery?.battery_authenticated ?? null,
            displayVerdict: display?.verdict || 'unknown',
            displayModuleSerial: display?.moduleSerial || null,
            faceIdVerdict: faceId?.verdict || 'unknown',
            faceIdPairingState: faceId?.pairingState ?? null,
            touchVerdict: touchController?.verdict || 'unknown',
            usbControllerVerdict: usbController?.verdict || 'not_applicable',
            componentsDetected: summary?.componentsDetected || null,
            deepDiagnosticsAvailable: enrichedHardware?.deepDiagnosticsAvailable || false,
        },

        authenticity: {
            verdict: overallVerdict || 'unable_to_determine',
            label: overallLabel || 'Scan Failed',
            auditTrail: auditTrail || [],
            sealStatus: sealStatus || 'Unknown',
        },

        imeiCheck: {
            available: dataSources.imeiCheck === 'ok',
            simLock: gsxResult?.simLock || null,
            findMyiPhone: gsxResult?.findMyIphone || null,
            blacklistStatus: imeiResult?.blacklistStatus || null,
            carrier: imeiResult?.carrier || null,
            warrantyStatus: gsxResult?.warrantyStatus || null,
        },

        serialCrossRef,

        risk: {
            score: riskScore,
            result: riskResult,
            flags,
        },

        dataSources,
    };

    console.log(`${LOG_PREFIX} Verification complete — risk: ${riskResult} (${riskScore}), flags: [${flags.join(', ')}]`);
    return result;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { runVerification };
