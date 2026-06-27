/**
 * useAuthenticity Composable
 * 
 * Vue 3 composable that manages the reactive state of a hardware
 * authenticity scan. Provides a clean API for the Authenticity tab
 * to trigger scans and render results.
 * 
 * States: idle → scanning → result | error
 * 
 * Usage:
 *   const { state, result, error, scan, reset, verdictBadge } = useAuthenticity();
 *   await scan(deviceUUID);
 *   // result.value now contains the full AuthenticityResult
 * 
 * @module composables/useAuthenticity
 */

(function () {
    'use strict';

    const { ref, computed, readonly } = Vue;

    const VERDICT_BADGE_MAP = {
        genuine: { cssClass: 'bg-green-100 text-green-700', label: 'Genuine', icon: 'verified', tokenColor: '#15803d' },
        restricted: { cssClass: 'bg-green-50 text-green-700', label: 'Genuine', icon: 'lock_open', tokenColor: '#15803d' },
        used: { cssClass: 'bg-blue-100 text-blue-700', label: 'Genuine Used (Swapped)', icon: 'swap_horiz', tokenColor: '#1d4ed8' },
        unknown: { cssClass: 'bg-red-100 text-red-700', label: 'Unknown/Non-Genuine', icon: 'error', tokenColor: '#b91c1c' },
        unpaired_genuine: { cssClass: 'bg-red-100 text-red-700', label: 'Unknown/Non-Genuine', icon: 'cloud_off', tokenColor: '#b91c1c' },
        mismatch: { cssClass: 'bg-red-100 text-red-700', label: 'Unknown/Non-Genuine', icon: 'error', tokenColor: '#b91c1c' },
        not_detected: { cssClass: 'bg-orange-100 text-orange-700', label: 'Not Detected', icon: 'remove_circle', tokenColor: '#c2410c' },
        unverified: { cssClass: 'bg-gray-100 text-gray-600', label: 'Unverified', icon: 'help_outline', tokenColor: '#6b7280' }
    };

    const OVERALL_BADGE_MAP = {
        all_genuine: { cssClass: 'bg-green-100 text-green-800', label: 'All Parts Genuine', icon: 'verified_user', tokenColor: '#15803d' },
        parts_flagged: { cssClass: 'bg-red-100 text-red-800', label: 'Hardware Issues Detected', icon: 'gpp_maybe', tokenColor: '#b91c1c' },
        unable_to_determine: { cssClass: 'bg-yellow-100 text-yellow-800', label: 'Unable to Fully Verify', icon: 'help_outline', tokenColor: '#a16207' }
    };

    const state = ref('idle');
    const result = ref(null);
    const error = ref(null);
    const scanDuration = ref(0);

    function useAuthenticity() {

        function restore(savedData) {
            if (!savedData) return false;
            result.value = savedData;
            state.value = 'result';
            console.log('[useAuthenticity] Restored from session cache');
            return true;
        }

        const overallBadge = computed(() => {
            if (!result.value || state.value !== 'result') {
                return { cssClass: '', label: 'Not Scanned', icon: 'pending', tokenColor: '#6b7280' };
            }
            return OVERALL_BADGE_MAP[result.value.overallVerdict]
                || OVERALL_BADGE_MAP.unable_to_determine;
        });

        const auditTrailBadges = computed(() => {
            if (!result.value || !result.value.auditTrail) return [];
            return result.value.auditTrail.map(item => ({
                ...item,
                badge: VERDICT_BADGE_MAP[item.status] || VERDICT_BADGE_MAP.unknown
            }));
        });

        const summary = computed(() => {
            if (!result.value || !result.value.auditTrail) {
                return { total: 0, genuine: 0, flagged: 0, unknown: 0 };
            }

            const parts = result.value.auditTrail;
            return {
                total: parts.length,
                genuine: parts.filter(p => ['genuine', 'used', 'restricted'].includes(p.status)).length,
                flagged: parts.filter(p => ['mismatch', 'not_detected', 'unpaired_genuine'].includes(p.status)).length,
                unknown: parts.filter(p => p.status === 'unknown').length
            };
        });

        const hasNonGenuineParts = computed(() => {
            return result.value?.overallVerdict === 'parts_flagged';
        });

        const isAllGenuine = computed(() => {
            return result.value?.overallVerdict === 'all_genuine';
        });

        async function scan(uuid) {
            if (!uuid) {
                error.value = 'No device UUID provided';
                state.value = 'error';
                return null;
            }

            if (state.value === 'scanning') {
                console.warn('[useAuthenticity] Scan already in progress');
                return null;
            }

            state.value = 'scanning';
            error.value = null;
            result.value = null;
            scanDuration.value = 0;

            const startTime = performance.now();

            try {
                if (!window.electronAPI?.checkAuthenticity) {
                    throw new Error('checkAuthenticity API not available. Is the preload bridge configured?');
                }

                const SCAN_TIMEOUT = 60000;
                console.log(`[useAuthenticity] Starting scan race (timeout: ${SCAN_TIMEOUT}ms)`);

                const response = await Promise.race([
                    window.electronAPI.checkAuthenticity(uuid),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Scan timed out after 60 seconds. Some hardware diagnostics are taking longer than expected.')), SCAN_TIMEOUT))
                ]);

                scanDuration.value = Math.round(performance.now() - startTime);

                if (!response.success) {
                    throw new Error(response.error || 'Authenticity check returned failure');
                }

                // 🛑 DEBUG LOG ADDED HERE: Inspect data right before assigning to Vue state
                console.log('\n[useAuthenticity] Raw IPC Response Data:', JSON.parse(JSON.stringify(response.data)));

                result.value = response.data;
                state.value = 'result';

                console.log(
                    `[useAuthenticity] Scan complete in ${scanDuration.value}ms — verdict: ${response.data.overallVerdict}`
                );

                return response.data;

            } catch (err) {
                scanDuration.value = Math.round(performance.now() - startTime);
                error.value = err.message || 'Unknown error during authenticity scan';
                state.value = 'error';
                console.error('[useAuthenticity] Scan failed:', err);
                return null;
            }
        }

        function reset() {
            state.value = 'idle';
            result.value = null;
            error.value = null;
            scanDuration.value = 0;
        }

        function verdictBadge(verdict) {
            return VERDICT_BADGE_MAP[verdict] || VERDICT_BADGE_MAP.unknown;
        }

        return {
            state: readonly(state),
            result: readonly(result),
            error: readonly(error),
            scanDuration: readonly(scanDuration),
            overallBadge,
            auditTrailBadges,
            summary,
            hasNonGenuineParts,
            isAllGenuine,
            scan,
            reset,
            restore,
            verdictBadge
        };
    }

    window.useAuthenticity = useAuthenticity;
    console.log('[useAuthenticity] Composable registered');
})();