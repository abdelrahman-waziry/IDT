/**
 * useSession Composable
 * 
 * Manages the persistence and lifecycle of a diagnostic session.
 * - Stores current session progress in LocalStorage for quick resume.
 * - Persists full diagnostic data (Auth, HW, Cosmetic, Pricing) in IndexedDB.
 * - Provides a unified state for all phases to read/write their results.
 * 
 * Data consistency guarantees:
 * - sessionId (uuid + timestamp) prevents history overwrite
 * - Write mutex prevents concurrent save race conditions
 * - Crash recovery checks IndexedDB before creating fresh sessions
 * - Phase validation prevents invalid data writes
 */

(function () {
    'use strict';

    const { ref, reactive, toRaw, watch } = Vue;

    // --- Singleton State ---
    const currentSession = ref(null);
    const sessionHistory = ref([]);
    const isLoading = ref(false);

    // --- Write Mutex ---
    // Serializes all writes to prevent race conditions where concurrent
    // updatePhaseData calls overwrite each other's changes.
    let _writeLock = Promise.resolve();

    // --- Valid Phases ---
    const VALID_PHASES = ['authenticity', 'hardware', 'cosmetic', 'pricing'];

    function useSession() {
        
        /**
         * Generate a unique session ID from UUID + base36 timestamp
         */
        function generateSessionId(uuid) {
            const timestamp = Date.now().toString(36).toUpperCase();
            return `${uuid}_${timestamp}`;
        }

        /**
         * Initialize or Load a session by UUID
         * 
         * Priority:
         * 1. Reuse in-memory session (tab switch, re-mount)
         * 2. Recover from IndexedDB (crash recovery, app restart)
         * 3. Create fresh session (new assessment)
         */
        async function loadSession(uuid, deviceInfo = null) {
            if (!uuid) return null;
            
            isLoading.value = true;
            try {
                // 1. Fast path: reuse in-memory session (handles tab switches, USB reconnect)
                if (currentSession.value && 
                    currentSession.value.uuid === uuid && 
                    currentSession.value.status === 'in-progress') {
                    console.log('[useSession] Reusing in-progress session for', uuid);
                    return currentSession.value;
                }

                // 2. Crash recovery: check IndexedDB for an existing in-progress session
                const dbSession = await window.IDT_DB.getLatestInProgressSession(uuid);
                if (dbSession) {
                    console.log('[useSession] Recovered in-progress session from DB:', dbSession.sessionId);
                    currentSession.value = dbSession;
                    localStorage.setItem('idt_active_session', dbSession.sessionId);
                    localStorage.setItem('idt_active_uuid', uuid);
                    return dbSession;
                }

                // 3. Create a fresh session for a new assessment
                const sessionId = generateSessionId(uuid);
                const session = {
                    sessionId,
                    uuid,
                    status: 'in-progress',
                    activePhase: 'authenticity',
                    device: deviceInfo,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    data: {
                        authenticity: null,
                        hardware: null,
                        cosmetic: null,
                        pricing: null
                    }
                };
                await window.IDT_DB.saveSession(session);
                
                currentSession.value = session;
                
                // Track in LocalStorage for quick resume
                localStorage.setItem('idt_active_session', sessionId);
                localStorage.setItem('idt_active_uuid', uuid);
                
                console.log('[useSession] Created new session:', sessionId);
                return session;
            } catch (err) {
                console.error('[useSession] Load failed:', err);
                return null;
            } finally {
                isLoading.value = false;
            }
        }

        /**
         * Forcefully resume a specific session by ID (e.g., from the dashboard)
         */
        async function resumeSessionById(sessionId) {
            isLoading.value = true;
            try {
                const dbSession = await window.IDT_DB.getSession(sessionId);
                if (!dbSession) throw new Error('Session not found');

                // If it was abandoned, mark it back as in-progress
                if (dbSession.status === 'abandoned' || dbSession.status === 'draft') {
                    dbSession.status = 'in-progress';
                    dbSession.updatedAt = Date.now();
                    await window.IDT_DB.saveSession(dbSession);
                }

                currentSession.value = dbSession;
                localStorage.setItem('idt_active_session', dbSession.sessionId);
                localStorage.setItem('idt_active_uuid', dbSession.uuid);
                
                console.log('[useSession] Resumed session by ID:', sessionId);
                return dbSession;
            } catch (err) {
                console.error('[useSession] Resume failed:', err);
                return null;
            } finally {
                isLoading.value = false;
            }
        }

        /**
         * Update specific phase data (mutex-protected)
         * @param {string} phase - One of: 'authenticity', 'hardware', 'cosmetic', 'pricing'
         * @param {*} data - The phase result data (must not be undefined)
         */
        async function updatePhaseData(phase, data) {
            // Validation
            if (!VALID_PHASES.includes(phase)) {
                console.error(`[useSession] Invalid phase: "${phase}". Must be one of: ${VALID_PHASES.join(', ')}`);
                return;
            }
            if (data === undefined) {
                console.warn(`[useSession] Ignoring undefined data for phase: ${phase}`);
                return;
            }

            // Mutex: serialize writes to prevent race conditions
            _writeLock = _writeLock.then(async () => {
                if (!currentSession.value) return;

                const updatedSession = {
                    ...currentSession.value,
                    data: {
                        ...currentSession.value.data,
                        [phase]: toRaw(data)
                    },
                    updatedAt: Date.now()
                };

                // Save to IndexedDB
                await window.IDT_DB.saveSession(updatedSession);
                currentSession.value = updatedSession;
            }).catch(err => {
                console.error(`[useSession] Failed to save phase "${phase}":`, err);
            });

            return _writeLock;
        }

        /**
         * Update session metadata (mutex-protected)
         */
        async function updateMetadata(updates) {
            _writeLock = _writeLock.then(async () => {
                if (!currentSession.value) return;

                const updatedSession = {
                    ...currentSession.value,
                    ...updates,
                    // Never allow metadata updates to overwrite these core fields
                    sessionId: currentSession.value.sessionId,
                    uuid: currentSession.value.uuid,
                    updatedAt: Date.now()
                };

                await window.IDT_DB.saveSession(updatedSession);
                currentSession.value = updatedSession;
            }).catch(err => {
                console.error('[useSession] Failed to save metadata:', err);
            });

            return _writeLock;
        }

        /**
         * Fetch history from IndexedDB
         */
        async function refreshHistory() {
            sessionHistory.value = await window.IDT_DB.listSessions();
        }

        /**
         * Complete the session and clean up temporary files
         */
        async function completeSession() {
            const uuid = currentSession.value?.uuid;
            await updateMetadata({ status: 'completed' });
            
            // Clean up temporary cosmetic photos now that session is submitted
            if (uuid && window.electronAPI?.cleanupCosmeticPhotos) {
                try {
                    await window.electronAPI.cleanupCosmeticPhotos(uuid);
                    console.log('[useSession] Cleaned up cosmetic photos for:', uuid);
                } catch (err) {
                    console.warn('[useSession] Photo cleanup failed:', err);
                }
            }
            
            localStorage.removeItem('idt_active_session');
            localStorage.removeItem('idt_active_uuid');
            currentSession.value = null;
        }

        /**
         * Clear/Reset current state (without completing)
         */
        function clearActiveSession() {
            currentSession.value = null;
            localStorage.removeItem('idt_active_session');
            localStorage.removeItem('idt_active_uuid');
        }

        /**
         * Cancel the current session — marks it as abandoned in DB,
         * cleans up cosmetic photos, and clears localStorage.
         */
        async function cancelSession() {
            const uuid = currentSession.value?.uuid;
            const sessionId = currentSession.value?.sessionId;

            // Mark as abandoned in IndexedDB so it won't auto-resume
            if (currentSession.value) {
                await updateMetadata({ status: 'abandoned' });
                console.log('[useSession] Session cancelled and marked as abandoned:', sessionId);
            }

            // Clean up temporary cosmetic photos
            if (uuid && window.electronAPI?.cleanupCosmeticPhotos) {
                try {
                    await window.electronAPI.cleanupCosmeticPhotos(uuid);
                    console.log('[useSession] Cleaned up cosmetic photos for cancelled session:', uuid);
                } catch (err) {
                    console.warn('[useSession] Photo cleanup on cancel failed:', err);
                }
            }

            // Stop any active cosmetic server
            if (window.electronAPI?.stopCosmeticSession) {
                try {
                    await window.electronAPI.stopCosmeticSession();
                } catch (err) {
                    console.warn('[useSession] Cosmetic server stop on cancel failed:', err);
                }
            }

            // Clear in-memory and localStorage
            currentSession.value = null;
            localStorage.removeItem('idt_active_session');
            localStorage.removeItem('idt_active_uuid');
        }

        /**
         * Clean up stale sessions on app start
         */
        async function cleanupStaleSessions() {
            try {
                const cleaned = await window.IDT_DB.cleanupStaleSessions();
                if (cleaned > 0) {
                    console.log(`[useSession] Cleaned up ${cleaned} stale session(s)`);
                }
            } catch (err) {
                console.warn('[useSession] Stale session cleanup failed:', err);
            }
        }

        return {
            // State
            currentSession,
            sessionHistory,
            isLoading,

            // Actions
            loadSession,
            resumeSessionById,
            updatePhaseData,
            updateMetadata,
            refreshHistory,
            completeSession,
            cancelSession,
            clearActiveSession,
            cleanupStaleSessions
        };
    }

    // Export globally
    window.useSession = useSession;
})();
