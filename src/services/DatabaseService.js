/**
 * DatabaseService
 * 
 * Native IndexedDB wrapper for local data persistence.
 * Stores assessment sessions, diagnostic results, and history.
 * 
 * Key: sessionId (uuid + timestamp) — supports multiple sessions per device.
 * Indexes: uuid, updatedAt, status
 */

(function () {
    'use strict';

    const DB_NAME = 'IDT_Database';
    const DB_VERSION = 2;
    const STORE_SESSIONS = 'sessions';

    class DatabaseService {
        constructor() {
            this.db = null;
        }

        /**
         * Initialize the database
         */
        async init() {
            if (this.db) return this.db;

            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = (event) => {
                    console.error('[DatabaseService] Error opening DB:', event.target.error);
                    reject(event.target.error);
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    console.log('[DatabaseService] Database initialized (v' + DB_VERSION + ')');
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Migration: drop old store if upgrading from v1
                    if (db.objectStoreNames.contains(STORE_SESSIONS)) {
                        db.deleteObjectStore(STORE_SESSIONS);
                        console.log('[DatabaseService] Migrated: dropped old sessions store (v1 → v2)');
                    }

                    // Create sessions store with sessionId as primary key
                    const sessionStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
                    sessionStore.createIndex('uuid', 'uuid', { unique: false });
                    sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    sessionStore.createIndex('status', 'status', { unique: false });
                    console.log('[DatabaseService] Created sessions store (v2, key=sessionId)');
                };
            });
        }

        /**
         * Get a session by its unique sessionId
         * @param {string} sessionId - The unique session identifier (uuid_timestamp)
         */
        async getSession(sessionId) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_SESSIONS], 'readonly');
                const store = transaction.objectStore(STORE_SESSIONS);
                const request = store.get(sessionId);

                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * Get all sessions for a given device UUID (for history)
         * @param {string} uuid - The device UUID
         * @returns {Promise<Array>} Sessions sorted by updatedAt descending
         */
        async getSessionsByUuid(uuid) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_SESSIONS], 'readonly');
                const store = transaction.objectStore(STORE_SESSIONS);
                const index = store.index('uuid');
                const request = index.getAll(uuid);

                request.onsuccess = () => {
                    const results = request.result || [];
                    // Sort by updatedAt descending (most recent first)
                    results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
                    resolve(results);
                };
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * Get the latest in-progress session for a UUID (crash recovery)
         * @param {string} uuid - The device UUID
         * @returns {Promise<Object|null>} The most recent in-progress session, or null
         */
        async getLatestInProgressSession(uuid) {
            const sessions = await this.getSessionsByUuid(uuid);
            return sessions.find(s => s.status === 'in-progress') || null;
        }

        /**
         * Save or update a session
         * @param {Object} session - Must include sessionId
         */
        async saveSession(session) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_SESSIONS], 'readwrite');
                const store = transaction.objectStore(STORE_SESSIONS);
                
                // Deep clone to strip Vue Proxies and prevent "could not be cloned" errors
                const plainSession = JSON.parse(JSON.stringify(session));

                const data = {
                    ...plainSession,
                    updatedAt: Date.now()
                };

                const request = store.put(data);

                request.onsuccess = () => resolve(data);
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * List all sessions (sorted by date, most recent first)
         */
        async listSessions() {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_SESSIONS], 'readonly');
                const store = transaction.objectStore(STORE_SESSIONS);
                const index = store.index('updatedAt');
                const request = index.getAll();

                request.onsuccess = () => {
                    // Reverse to get most recent first
                    resolve((request.result || []).reverse());
                };
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * Delete a session by sessionId
         * @param {string} sessionId - The unique session identifier
         */
        async deleteSession(sessionId) {
            await this.init();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_SESSIONS], 'readwrite');
                const store = transaction.objectStore(STORE_SESSIONS);
                const request = store.delete(sessionId);

                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        }

        /**
         * Mark stale in-progress sessions as abandoned (older than cutoffMs)
         * @param {number} cutoffMs - Max age in ms (default: 24 hours)
         * @returns {Promise<number>} Number of sessions marked abandoned
         */
        async cleanupStaleSessions(cutoffMs = 24 * 60 * 60 * 1000) {
            const allSessions = await this.listSessions();
            const cutoff = Date.now() - cutoffMs;
            let cleaned = 0;

            for (const s of allSessions) {
                if (s.status === 'in-progress' && s.updatedAt < cutoff) {
                    s.status = 'abandoned';
                    await this.saveSession(s);
                    cleaned++;
                }
            }

            if (cleaned > 0) {
                console.log(`[DatabaseService] Marked ${cleaned} stale session(s) as abandoned`);
            }
            return cleaned;
        }
    }

    // Global instance
    window.IDT_DB = new DatabaseService();
})();
