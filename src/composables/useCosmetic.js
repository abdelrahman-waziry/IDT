/**
 * useCosmetic Composable
 *
 * Manages the cosmetic photo capture session:
 * - Starts/stops the local HTTP server
 * - Listens for live photo uploads from the mobile capture page
 * - Triggers cosmetic grading via Claude Sonnet AI
 */

(function () {
    'use strict';

    const { ref, computed, readonly } = Vue;

    const PHOTO_VIEWS = [
        {
            key: 'front_face', label: 'Front Face', angle: 'Angle 01',
            icon: 'smartphone',
            instruction: 'Align the full screen within the corner guides. Ensure no glare from overhead lighting.',
            focusHint: 'center',
            captureType: 'wide'
        },
        {
            key: 'back_chassis', label: 'Back Chassis', angle: 'Angle 02',
            icon: 'flip_to_back',
            instruction: 'Capture the full back panel. Include camera module and any visible scratches.',
            focusHint: 'center',
            captureType: 'wide'
        },
        {
            key: 'left_edge', label: 'Left Edge', angle: 'Angle 03',
            icon: 'phone_android',
            instruction: 'Hold device at a slight angle to expose the left side frame. Check for dents or scratches.',
            focusHint: 'center',
            captureType: 'macro'
        },
        {
            key: 'right_edge', label: 'Right Edge', angle: 'Angle 04',
            icon: 'phone_android',
            instruction: 'Align the right side of the device within the green corner guides. Ensure no glare on metallic surfaces.',
            focusHint: 'center',
            captureType: 'macro'
        },
        {
            key: 'top_profile', label: 'Top Profile', angle: 'Angle 05',
            icon: 'straighten',
            instruction: 'Capture the top edge straight-on. Look for chips or antenna band separation.',
            focusHint: 'center',
            captureType: 'macro'
        },
        {
            key: 'port_detail', label: 'Port Detail', angle: 'Angle 06',
            icon: 'electrical_services',
            instruction: 'Close-up of the charging port. Check for debris, bent pins, or corrosion.',
            focusHint: 'center-bottom',
            captureType: 'detail'
        }
    ];

    // --- Singleton State (shared across all instances) ---
    const sessionState = ref('idle'); // 'idle' | 'waiting' | 'capturing' | 'grading' | 'graded' | 'error'
    const serverUrl = ref(null);
    const localUrl = ref(null);
    const qrDataUrl = ref(null);
    const error = ref(null);

    // Photo state — reactive map of view key → { status, url }
    const photos = ref({});

    // Grading result
    const gradeReport = ref(null);

    // Cleanup function for IPC listener
    let photoListenerCleanup = null;
    let unpluggedListenerCleanup = null;
    let reconnectedListenerCleanup = null;

    // Paused state
    const isPaused = ref(false);

    function useCosmetic() {

        // Computed
        const capturedCount = computed(() =>
            Object.values(photos.value).filter(p => p.status === 'captured').length
        );

        const totalSlots = computed(() => PHOTO_VIEWS.length);

        const allCaptured = computed(() => capturedCount.value >= totalSlots.value);

        // True when a cosmetic session is actively running (server started, capturing, or grading)
        const isCosmeticActive = computed(() =>
            ['waiting', 'capturing', 'grading'].includes(sessionState.value)
        );

        const photoSlots = computed(() =>
            PHOTO_VIEWS.map(v => ({
                ...v,
                status: photos.value[v.key]?.status || 'empty',
                url: photos.value[v.key]?.url || null,
                syncFile: photos.value[v.key]?.syncFile || null
            }))
        );

        /**
         * Start the cosmetic capture session
         */
        async function startSession(uuid) {
            if (!uuid) {
                error.value = 'No device UUID';
                sessionState.value = 'error';
                return;
            }

            sessionState.value = 'waiting';
            error.value = null;
            photos.value = {};
            gradeReport.value = null;

            try {
                if (!window.electronAPI?.startCosmeticSession) {
                    throw new Error('Cosmetic session API not available');
                }

                // Start the server
                const result = await window.electronAPI.startCosmeticSession(uuid);

                if (!result.success) {
                    throw new Error(result.error || 'Failed to start cosmetic session');
                }

                serverUrl.value = result.url;
                localUrl.value = result.localUrl;
                qrDataUrl.value = result.qrDataUrl;

                console.log(`[useCosmetic] Server started at ${result.url} (local: ${result.localUrl})`);

                // Listen for incoming photos
                if (window.electronAPI.onCosmeticPhotoUploaded) {
                    photoListenerCleanup = window.electronAPI.onCosmeticPhotoUploaded((data) => {
                        console.log(`[useCosmetic] Event received: ${data.view} (${data.status || 'captured'})`);

                        // Update photo state reactively
                        const updated = { ...photos.value };
                        
                        if (data.status === 'syncing') {
                            updated[data.view] = {
                                status: 'syncing',
                                syncFile: 'Transferring...'
                            };
                        } else {
                            updated[data.view] = {
                                status: 'captured',
                                // Prefer file:// URL which persists even after server stops
                                url: data.localFileUrl || data.url,
                                localPath: data.localPath
                            };
                            
                            window.ToastManager?.show(`Photo captured: ${data.view.replace(/_/g, ' ')}`, 'success');
                        }
                        
                        photos.value = updated;

                        // Update session state
                        if (sessionState.value === 'waiting') {
                            sessionState.value = 'capturing';
                        }
                    });
                }

                if (window.electronAPI.onCosmeticDeviceUnplugged) {
                    unpluggedListenerCleanup = window.electronAPI.onCosmeticDeviceUnplugged((data) => {
                        console.log('[useCosmetic] USB Unplugged, pausing sync...');
                        isPaused.value = true;
                        
                        // Cache progress locally through session API
                        if (window.useSession) {
                            const session = window.useSession();
                            session.updatePhaseData('cosmetic', { cachedPhotos: photos.value, isIntermediate: true });
                        }
                        window.ToastManager?.show('Device Unplugged. Capture Paused.', 'info');
                    });
                }

                if (window.electronAPI.onCosmeticDeviceReconnected) {
                    reconnectedListenerCleanup = window.electronAPI.onCosmeticDeviceReconnected((data) => {
                        console.log('[useCosmetic] USB Reconnected, resuming sync...');
                        isPaused.value = false;
                        window.ToastManager?.show('Device Reconnected. Sync resumed.', 'success');
                    });
                }

            } catch (err) {
                console.error('[useCosmetic] Session start failed:', err);
                error.value = err.message || 'Failed to start session';
                sessionState.value = 'error';
            }
        }

        /**
         * Stop the session and clean up
         */
        async function stopSession() {
            if (photoListenerCleanup) {
                photoListenerCleanup();
                photoListenerCleanup = null;
            }
            if (unpluggedListenerCleanup) {
                unpluggedListenerCleanup();
                unpluggedListenerCleanup = null;
            }
            if (reconnectedListenerCleanup) {
                reconnectedListenerCleanup();
                reconnectedListenerCleanup = null;
            }
            isPaused.value = false;

            try {
                if (window.electronAPI?.stopCosmeticSession) {
                    await window.electronAPI.stopCosmeticSession();
                }
            } catch (err) {
                console.warn('[useCosmetic] Stop session error:', err);
            }

            serverUrl.value = null;
            qrDataUrl.value = null;
        }

        /**
         * Grade the captured photos
         */
        async function gradePhotos(uuid) {
            if (capturedCount.value === 0) {
                error.value = 'No photos to grade';
                return null;
            }

            sessionState.value = 'grading';
            error.value = null;

            try {
                if (!window.electronAPI?.gradeCosmeticPhotos) {
                    throw new Error('Grading API not available');
                }

                const result = await window.electronAPI.gradeCosmeticPhotos(uuid);

                if (!result.success) {
                    throw new Error(result.error || 'Grading failed');
                }

                gradeReport.value = result.data;
                sessionState.value = 'graded';

                console.log('[useCosmetic] ===== FULL AI GRADE RESULT FROM BACKEND =====');
                console.log(JSON.stringify(result.data, null, 2));
                console.log('[useCosmetic] ===== END GRADE RESULT =====');
                console.log(`[useCosmetic] Grade: ${result.data.grade} (${result.data.overallScore}/100)`);
                return result.data;

            } catch (err) {
                console.error('[useCosmetic] Grading failed:', err);
                error.value = err.message;
                sessionState.value = 'error';
                return null;
            }
        }

        /**
         * Reset everything
         */
        function reset() {
            stopSession();
            sessionState.value = 'idle';
            photos.value = {};
            gradeReport.value = null;
            error.value = null;
        }

        /**
         * Restore state from previously saved session data without re-running.
         * @param {object} savedData - The cosmetic data saved via updatePhaseData
         * @returns {boolean} True if successfully restored
         */
        function restore(savedData) {
            if (!savedData) return false;
            gradeReport.value = savedData;
            sessionState.value = 'graded';
            console.log('[useCosmetic] Restored from session cache');
            return true;
        }

        return {
            // State
            sessionState: readonly(sessionState),
            serverUrl: readonly(serverUrl),
            localUrl: readonly(localUrl),
            qrDataUrl: readonly(qrDataUrl),
            error: readonly(error),
            photos: readonly(photos),
            gradeReport: readonly(gradeReport),
            isPaused: readonly(isPaused),

            // Computed
            capturedCount,
            totalSlots,
            allCaptured,
            isCosmeticActive,
            photoSlots,

            // Actions
            startSession,
            stopSession,
            gradePhotos,
            reset,
            restore,

            // Constants
            PHOTO_VIEWS
        };
    }

    window.useCosmetic = useCosmetic;
})();
