/**
 * useHardwareTest Composable
 * 
 * Manages the state and execution of hardware diagnostics.
 * Maps real-time telemetry from IDT SDK to the HardwareTestView UI.
 */

(function () {
    'use strict';

    const { ref, computed, readonly } = Vue;

    // --- Singleton State ---
    const state = ref('idle'); // 'idle' | 'running' | 'complete' | 'error'
    const results = ref(null);
    const error = ref(null);
    const progress = ref(0);

    function useHardwareTest() {

        async function run(uuid) {
            if (!uuid) {
                error.value = 'No device UUID';
                state.value = 'error';
                return;
            }

            state.value = 'running';
            progress.value = 0;
            error.value = null;

            try {
                // Initial delay to simulate "preparing"
                await new Promise(r => setTimeout(r, 800));
                progress.value = 10;

                // Call real SDK with timeout
                if (!window.IDT) throw new Error('IDT SDK not found');
                
                const TIMEOUT = 20000;
                const data = await Promise.race([
                    window.IDT.diagnostics.getFull(uuid, false),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Hardware diagnostics timed out after 20s')), TIMEOUT))
                ]);
                
                // Progressive loading for visual feedback
                progress.value = 30;
                await new Promise(r => setTimeout(r, 800));
                
                progress.value = 60;
                await new Promise(r => setTimeout(r, 600));
                
                progress.value = 100;
                results.value = data;
                state.value = 'complete';

            } catch (err) {
                console.error('[useHardwareTest] Failed:', err);
                error.value = err.message || 'Hardware scan failed';
                state.value = 'error';
            }
        }

        function reset() {
            state.value = 'idle';
            results.value = null;
            error.value = null;
            progress.value = 0;
        }

        /**
         * Restore state from previously saved session data without re-running.
         * @param {object} savedData - The hardware data saved via updatePhaseData
         * @returns {boolean} True if successfully restored
         */
        function restore(savedData) {
            if (!savedData) return false;
            results.value = savedData;
            state.value = 'complete';
            progress.value = 100;
            console.log('[useHardwareTest] Restored from session cache');
            return true;
        }

        return {
            state: readonly(state),
            results: readonly(results),
            error: readonly(error),
            progress: readonly(progress),
            run,
            reset,
            restore
        };
    }

    window.useHardwareTest = useHardwareTest;
})();
