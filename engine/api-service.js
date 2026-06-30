/**
 * API Service — IMEI & GSX Lookups
 *
 * Primary:  IMEI.org API (paid per-check, ~$0.05–0.15)
 *           Service 171 = Apple Advanced Check (FMI, serial, warranty, SIM lock, iCloud)
 *           Service 30  = Apple Carrier + GSMA Blacklist Check
 *
 * Fallback: IMEI TAC lookup via imeidb.xyz (free, no key, model/brand from IMEI prefix only)
 *
 * On any failure this module throws — it never returns mock data.
 * Callers must handle failures explicitly.
 */

const IMEIORG_BASE = 'https://api-client.imei.org/api/dhru';
const IMEIORG_SUBMIT = `${IMEIORG_BASE}/submit`;
const IMEIORG_RESULT = `${IMEIORG_BASE}/result`;
const IMEIORG_SERVICES = `${IMEIORG_BASE}/services`;
const TAC_FALLBACK_BASE = 'https://imeidb.xyz/api/v3';

// Service IDs on IMEI.org
const SERVICE = {
    APPLE_ADVANCED: 171,   // Serial, FMI, iCloud, Activated, SIM lock, Warranty — $0.15/check
};

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15; // 30 seconds total

function getApiKey() {
    const key = process.env.IMEIORG_API_KEY;
    if (!key) throw new Error('IMEIORG_API_KEY environment variable is not set');
    return key;
}

/**
 * Submit a check to IMEI.org and poll until result is ready.
 * @param {string} imei
 * @param {number} serviceId
 * @returns {Promise<object>} Raw response object from IMEI.org
 */
async function submitAndPoll(imei, serviceId) {
    const apiKey = getApiKey();

    // Submit
    const submitUrl = `${IMEIORG_SUBMIT}?apikey=${apiKey}&service_id=${serviceId}&input=${imei}&dontWait=1`;
    const submitRes = await fetch(submitUrl, { signal: AbortSignal.timeout(15000) });

    if (!submitRes.ok) {
        throw new Error(`IMEI.org submit failed (${submitRes.status}): ${await submitRes.text()}`);
    }

    const submitData = await submitRes.json();

    if (submitData.status !== 1) {
        throw new Error(`IMEI.org submit error: ${JSON.stringify(submitData)}`);
    }

    const orderId = submitData.response?.orderId || submitData.response?.order_id;
    if (!orderId) {
        // Some service IDs return results immediately without polling
        if (submitData.response && typeof submitData.response === 'object') {
            return submitData.response;
        }
        throw new Error('IMEI.org: no orderId in submit response');
    }

    // Poll for result
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

        const resultUrl = `${IMEIORG_RESULT}?apikey=${apiKey}&order_id=${orderId}`;
        const resultRes = await fetch(resultUrl, { signal: AbortSignal.timeout(15000) });

        if (!resultRes.ok) continue;

        const resultData = await resultRes.json();

        if (resultData.status === 1 && resultData.response) {
            return resultData.response;
        }
        // status 2 = pending, keep polling
        // status 0 = error
        if (resultData.status === 0) {
            throw new Error(`IMEI.org result error: ${JSON.stringify(resultData)}`);
        }
    }

    throw new Error(`IMEI.org: result not ready after ${POLL_MAX_ATTEMPTS} attempts`);
}

/**
 * Normalise IMEI.org Apple Advanced Check response (service 171).
 * Field names vary slightly across API versions — check all known aliases.
 */
function normaliseAdvanced(raw) {
    // Serial number — the key field for cross-reference
    const serial =
        raw['Serial Number'] ||
        raw.SerialNumber ||
        raw.serial_number ||
        raw.serial ||
        null;

    // FMI / iCloud lock
    const fmiRaw = raw['FMI'] || raw.fmi || raw['Find My iPhone'] || '';
    const fmiOn = /^on$/i.test(fmiRaw.trim());

    const icloudRaw = raw['iCloud'] || raw.icloud || '';
    const icloudLocked = /lost|erased|locked/i.test(icloudRaw);

    // SIM lock
    const simRaw = raw['Simlock'] || raw.simlock || raw['SIM Lock'] || raw.simLock || '';
    const simLocked = /locked/i.test(simRaw) && !/unlocked/i.test(simRaw);

    // Warranty
    const warrantyStatus =
        raw['Warranty Status'] ||
        raw.warrantyStatus ||
        raw.warranty ||
        'Unknown';

    // Activation
    const activatedRaw = raw['Activated'] || raw.activated || '';
    const activated = /yes/i.test(activatedRaw);

    return {
        serial,
        model: raw['Model'] || raw.model || null,
        imei: raw['IMEI'] || raw.imei || null,
        fmiOn,
        icloudStatus: icloudRaw || null,
        icloudLocked,
        simLocked,
        simLockDetail: simRaw || null,
        warrantyStatus,
        estimatedPurchaseDate: raw['Estimated Purchase Date'] || raw.estimatedPurchaseDate || null,
        activated,
        purchaseCountry: raw['Purchase Country'] || raw.purchaseCountry || null,
        _raw: raw
    };
}

/**
 * Normalise IMEI.org Blacklist Check response (service 30).
 */
function normaliseBlacklist(raw) {
    const blacklistRaw =
        raw['Blacklist Status'] ||
        raw.blacklistStatus ||
        raw.blacklist ||
        raw['GSMA Blacklist'] ||
        'Unknown';

    const isBlacklisted = /blacklisted|blocked|stolen|lost/i.test(blacklistRaw);
    const isClean = /clean|ok|not blacklisted/i.test(blacklistRaw);

    return {
        blacklistStatus: isBlacklisted ? 'Blacklisted' : isClean ? 'Clean' : blacklistRaw,
        blacklisted: isBlacklisted,
        carrier: raw['Network'] || raw.network || raw['Carrier'] || raw.carrier || null,
        carrierCountry: raw['Country'] || raw.country || null,
        _raw: raw
    };
}

/**
 * TAC (Type Allocation Code) fallback — free, no API key, model/brand only.
 * Uses first 8 digits of IMEI.
 */
async function getTACInfo(imei) {
    const tac = imei.substring(0, 8);

    try {
        const res = await fetch(
            `${TAC_FALLBACK_BASE}/imei/${imei}`,
            { signal: AbortSignal.timeout(10000) }
        );

        if (!res.ok) throw new Error(`TAC lookup HTTP ${res.status}`);

        const data = await res.json();

        if (!data.success) throw new Error('TAC lookup returned success:false');

        return {
            tacAvailable: true,
            brand: data.data?.brand || null,
            model: data.data?.name || data.data?.model || null,
            tac,
            _raw: data.data
        };
    } catch (err) {
        console.warn(`[APIService] TAC fallback failed: ${err.message}`);
        return { tacAvailable: false, brand: null, model: null, tac };
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Full Apple GSX-style check via IMEI.org service 171.
 * Returns serial number, FMI, iCloud status, SIM lock, warranty, activation.
 * Throws on failure — never returns mock data.
 *
 * @param {string} imei
 * @returns {Promise<object>}
 */
async function getGSXInfo(imei) {
    if (!imei || typeof imei !== 'string' || imei.length < 15) {
        throw new Error(`Invalid IMEI: ${imei}`);
    }

    console.log(`[APIService] GSX check for IMEI: ${imei}`);

    const raw = await submitAndPoll(imei, SERVICE.APPLE_ADVANCED);
    const result = normaliseAdvanced(raw);

    console.log(`[APIService] GSX result — serial: ${result.serial}, FMI: ${result.fmiOn}, iCloud: ${result.icloudStatus}`);
    return result;
}

/**
 * Blacklist + carrier check via IMEI.org service 30.
 * Throws on failure — never returns mock data.
 *
 * @param {string} imei
 * @returns {Promise<object>}
 */
async function getIMEIInfo(imei) {
    if (!imei || typeof imei !== 'string' || imei.length < 15) {
        throw new Error(`Invalid IMEI: ${imei}`);
    }

    console.log(`[APIService] Blacklist check for IMEI: ${imei}`);

    const raw = await submitAndPoll(imei, SERVICE.APPLE_BLACKLIST);
    const result = normaliseBlacklist(raw);

    console.log(`[APIService] Blacklist result — status: ${result.blacklistStatus}, carrier: ${result.carrier}`);
    return result;
}

/**
 * Run both GSX and blacklist checks in parallel.
 * Returns { gsx, blacklist, tac } where any failed check is null (not thrown).
 * tac is always attempted as a free baseline regardless of paid check results.
 *
 * @param {string} imei
 * @returns {Promise<{ gsx: object|null, blacklist: object|null, tac: object, anyFailed: boolean }>}
 */
async function runFullIMEICheck(imei) {
    const [gsxResult, blacklistResult, tacResult] = await Promise.allSettled([
        getGSXInfo(imei),
        getIMEIInfo(imei),
        getTACInfo(imei)
    ]);

    const gsx = gsxResult.status === 'fulfilled' ? gsxResult.value : null;
    const blacklist = blacklistResult.status === 'fulfilled' ? blacklistResult.value : null;
    const tac = tacResult.status === 'fulfilled' ? tacResult.value : { tacAvailable: false };

    if (gsxResult.status === 'rejected') {
        console.error(`[APIService] GSX check failed: ${gsxResult.reason?.message}`);
    }
    if (blacklistResult.status === 'rejected') {
        console.error(`[APIService] Blacklist check failed: ${blacklistResult.reason?.message}`);
    }

    return {
        gsx,
        blacklist,
        tac,
        anyFailed: !gsx || !blacklist
    };
}

/**
 * Fetch available services from IMEI.org (useful for verifying API key and discovering service IDs).
 * @returns {Promise<Array>}
 */
async function listServices() {
    const apiKey = getApiKey();
    const res = await fetch(`${IMEIORG_SERVICES}?apikey=${apiKey}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`listServices HTTP ${res.status}`);
    const data = await res.json();
    return data.response?.services || [];
}

module.exports = {
    getGSXInfo,
    getIMEIInfo,
    runFullIMEICheck,
    getTACInfo,
    listServices,
    SERVICE
};