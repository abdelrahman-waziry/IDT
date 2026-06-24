/**
 * Dashboard API Service — Diagnostic Report Submission
 *
 * Sends hardware and cosmetic diagnostic reports to the MezaTech
 * dashboard backend for storage and admin panel viewing.
 *
 * @module engine/dashboard-api
 */

const fs = require('fs');
const path = require('path');

// Dashboard API base URL — override via env variable if needed
const DASHBOARD_API_BASE = process.env.MEZATECH_DASHBOARD_URL || 'http://127.0.0.1:8000';
const API_PREFIX = '/api/v1/diagnostics';

/**
 * Submit a hardware diagnostic report to the dashboard
 * @param {string} deviceUuid - The device UUID
 * @param {object} hardwareData - Full hardware diagnostics object from HardwareDiagnostics.getHardwareDiagnostics()
 * @returns {Promise<object>} API response
 */
async function submitHardwareReport(deviceUuid, hardwareData) {
    if (!hardwareData) {
        console.warn('[DashboardAPI] No hardware data to submit');
        return { success: false, error: 'No hardware data' };
    }

    const payload = {
        device_id: deviceUuid,
        timestamp: new Date().toISOString(),
        summary: hardwareData.summary || null,
        battery: hardwareData.battery || null,
        display: hardwareData.display || null,
        components: hardwareData.components || null,
    };

    console.log(`[DashboardAPI] Submitting hardware report for device: ${deviceUuid}`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${DASHBOARD_API_BASE}${API_PREFIX}/hardware`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DashboardAPI] Hardware report submission failed (${response.status}): ${errorText}`);
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json();
        console.log(`[DashboardAPI] Hardware report submitted successfully. Report ID: ${result.report_id}`);
        return { success: true, reportId: result.report_id };

    } catch (err) {
        console.error(`[DashboardAPI] Hardware report submission error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

/**
 * Submit a cosmetic diagnostic report to the dashboard
 * @param {string} deviceUuid - The device UUID
 * @param {object} cosmeticData - Full cosmetic grade report from CosmeticGrader.gradePhotos()
 * @param {object} photoPaths - Map of { [view]: filePath } — local file paths to the captured images
 * @returns {Promise<object>} API response
 */
async function submitCosmeticReport(deviceUuid, cosmeticData, photoPaths) {
    if (!cosmeticData) {
        console.warn('[DashboardAPI] No cosmetic data to submit');
        return { success: false, error: 'No cosmetic data' };
    }

    // Convert photo files to base64 for upload
    const images = {};
    if (photoPaths && typeof photoPaths === 'object') {
        for (const [view, filePath] of Object.entries(photoPaths)) {
            try {
                // Handle both file:/// URLs and raw paths
                let resolvedPath = filePath;
                if (resolvedPath.startsWith('file:///')) {
                    resolvedPath = resolvedPath.replace('file:///', '');
                }
                // Normalize path separators
                resolvedPath = resolvedPath.replace(/\//g, path.sep);

                if (fs.existsSync(resolvedPath)) {
                    const buffer = fs.readFileSync(resolvedPath);
                    const base64 = buffer.toString('base64');
                    images[view] = `data:image/jpeg;base64,${base64}`;
                    console.log(`[DashboardAPI] Encoded photo "${view}" (${(buffer.length / 1024).toFixed(1)} KB)`);
                } else {
                    console.warn(`[DashboardAPI] Photo file not found for "${view}": ${resolvedPath}`);
                }
            } catch (readErr) {
                console.warn(`[DashboardAPI] Failed to read photo "${view}": ${readErr.message}`);
            }
        }
    }

    const payload = {
        device_id: deviceUuid,
        timestamp: new Date().toISOString(),
        grade: cosmeticData.grade || null,
        label: cosmeticData.label || null,
        color: cosmeticData.color || null,
        description: cosmeticData.description || null,
        overall_score: cosmeticData.overallScore || null,
        total_defects: cosmeticData.totalDefects || null,
        defect_summary: cosmeticData.defectSummary || null,
        image_scores: cosmeticData.imageScores || null,
        images: Object.keys(images).length > 0 ? images : null,
    };

    console.log(`[DashboardAPI] Submitting cosmetic report for device: ${deviceUuid} (${Object.keys(images).length} photos)`);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // Longer timeout for images

        const response = await fetch(`${DASHBOARD_API_BASE}${API_PREFIX}/cosmetic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DashboardAPI] Cosmetic report submission failed (${response.status}): ${errorText}`);
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json();
        console.log(`[DashboardAPI] Cosmetic report submitted successfully. Report ID: ${result.report_id}`);
        return { success: true, reportId: result.report_id };

    } catch (err) {
        console.error(`[DashboardAPI] Cosmetic report submission error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

/**
 * Submit both hardware and cosmetic reports in parallel
 * @param {string} deviceUuid - The device UUID
 * @param {object} hardwareData - Hardware diagnostics data
 * @param {object} cosmeticData - Cosmetic grade report
 * @param {object} photoPaths - Map of { [view]: filePath }
 * @returns {Promise<object>} Combined result
 */
async function submitAllReports(deviceUuid, hardwareData, cosmeticData, photoPaths) {
    console.log(`[DashboardAPI] Submitting all diagnostic reports for device: ${deviceUuid}`);

    const results = await Promise.allSettled([
        hardwareData ? submitHardwareReport(deviceUuid, hardwareData) : Promise.resolve({ success: false, error: 'No hardware data' }),
        cosmeticData ? submitCosmeticReport(deviceUuid, cosmeticData, photoPaths) : Promise.resolve({ success: false, error: 'No cosmetic data' }),
    ]);

    const hardwareResult = results[0].status === 'fulfilled' ? results[0].value : { success: false, error: results[0].reason?.message };
    const cosmeticResult = results[1].status === 'fulfilled' ? results[1].value : { success: false, error: results[1].reason?.message };

    console.log(`[DashboardAPI] Submission complete — Hardware: ${hardwareResult.success ? 'OK' : 'FAILED'}, Cosmetic: ${cosmeticResult.success ? 'OK' : 'FAILED'}`);

    return {
        hardware: hardwareResult,
        cosmetic: cosmeticResult,
    };
}

module.exports = {
    submitHardwareReport,
    submitCosmeticReport,
    submitAllReports,
};
