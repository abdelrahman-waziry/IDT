/**
 * iOS Device Manager - Main Vue Application
 * 
 * Single-page application entry point with hash-based routing.
 * Routes:
 *   (splash)       → Splash (shown briefly on startup)
 *   #/             → HomeView (dashboard)
 *   #/connect      → ConnectDeviceView (device connection)
 *   #/device/:uuid → AuthenticityView (single device)
 */

const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

const app = createApp({
    setup() {
        const session = window.useSession();
        
        // --- Routing ---
        const currentRoute = ref('splash');
        const routeParams = ref({});

        function parseHash() {
            const hash = window.location.hash || '#/';

            // Connect device: #/connect
            if (hash === '#/connect') {
                currentRoute.value = 'connect';
                routeParams.value = {};
                return;
            }

            // Device authenticity: #/device/:uuid/:phase?
            const deviceMatch = hash.match(/^#\/device\/([^\/]+)(?:\/(.+))?$/);
            if (deviceMatch) {
                currentRoute.value = 'connect';
                routeParams.value = { 
                    uuid: decodeURIComponent(deviceMatch[1]), 
                    phase: deviceMatch[2] || 'authenticity' 
                };
                return;
            }

            // Default: home
            currentRoute.value = 'home';
            routeParams.value = {};
        }

        // --- App State ---
        const devices = ref([]);
        const isLoading = ref(false);
        const refreshLoading = ref(false);
        const statusType = ref('ready');
        const statusText = ref('Initializing...');
        const toasts = ref([]);

        // --- Dashboard State (will be populated via IPC / API) ---
        const dashboardStats = ref({
            todayAssessments: 0,
            assessmentsDelta: 0,
            acceptedOffers: 0,
            offersDeltaPct: 0,
            pendingReview: 0,
            pendingAlert: ''
        });
        const recentAssessments = ref([]);
        const operatorId = ref('OP-742'); // Mock operator

        /**
         * Load persistent data from DB
         */
        async function syncWithDB() {
            await session.refreshHistory();
            
            // Map DB history to dashboard rows
            recentAssessments.value = session.sessionHistory.value.slice(0, 5).map(s => {
                const idParts = (s.sessionId || s.uuid || '').split('_');
                const displayId = idParts.length > 1 ? idParts[idParts.length - 1].substring(0, 8) : idParts[0].substring(0, 8).toUpperCase();
                
                return {
                    rawSessionId: s.sessionId,
                    uuid: s.uuid,
                    sessionId: `FX-${displayId}`,
                deviceName: s.device?.ModelName || 'Unknown iPhone',
                serialNumber: s.device?.SerialNumber || '---',
                authPassed: s.data?.authenticity?.overallVerdict === 'all_genuine',
                hardwareScore: s.data?.hardware?.battery?.healthPercent,
                cosmeticGrade: s.data?.cosmetic?.grade,
                offer: s.data?.pricing?.final,
                status: s.status === 'completed' ? 'Accepted' : (s.status === 'abandoned' ? 'Abandoned' : 'Draft')
                };
            });

            // Update stats
            dashboardStats.value.todayAssessments = session.sessionHistory.value.filter(s => {
                const today = new Date().setHours(0,0,0,0);
                return s.createdAt >= today;
            }).length;
            
            dashboardStats.value.acceptedOffers = session.sessionHistory.value
                .filter(s => s.status === 'completed')
                .reduce((acc, s) => acc + (s.data?.pricing?.final || 0), 0);
        }

        // Initialize toast manager
        window.ToastManager.init(toasts);

        // --- IPC Listeners ---
        let cleanupFns = [];

        function setupIPCListeners() {
            const unsub1 = window.electronAPI.onDevicesUpdated((deviceList) => {
                console.log('[App] Devices updated:', deviceList.length);
                devices.value = deviceList;

                if (deviceList.length > 0) {
                    statusType.value = 'connected';
                    statusText.value = `${deviceList.length} device(s) connected`;
                } else {
                    statusType.value = 'disconnected';
                    statusText.value = 'No devices connected';
                }
            });

            const unsub2 = window.electronAPI.onDevicesLoading((loading) => {
                isLoading.value = loading;
            });

            const unsub3 = window.electronAPI.onDeviceError((error) => {
                console.error('[App] Device error:', error);
                window.ToastManager.show(error.message || 'An error occurred', 'error');
                statusType.value = 'error';
                statusText.value = 'Error: ' + (error.message || 'Unknown error');
            });

            cleanupFns = [unsub1, unsub2, unsub3];
        }

        // --- Actions ---
        async function refreshDevices() {
            refreshLoading.value = true;
            try {
                await window.electronAPI.refreshDevices();
            } catch (error) {
                window.ToastManager.show('Failed to refresh devices', 'error');
            } finally {
                refreshLoading.value = false;
            }
        }

        async function handleGenerateReport(device) {
            window.ToastManager.show('Generating report...', 'info');
            try {
                const result = await window.electronAPI.generateReport(device);
                if (result.success) {
                    window.ToastManager.show(`Report saved: ${result.path}`, 'success', 5000);
                } else {
                    window.ToastManager.show(`Failed: ${result.error}`, 'error');
                }
            } catch (error) {
                window.ToastManager.show('Failed to generate report', 'error');
            }
        }

        // --- Computed ---
        const currentComponent = computed(() => {
            if (currentRoute.value === 'splash') return 'Splash';
            if (currentRoute.value === 'connect') return 'ConnectDeviceView';
            return 'HomeView';
        });

        const currentProps = computed(() => {
            if (currentRoute.value === 'splash') return {};
            if (currentRoute.value === 'connect') {
                return {
                    uuid: routeParams.value.uuid,
                    activePhase: routeParams.value.phase || 'connect',
                    devices: devices.value,
                    statusType: statusType.value,
                    statusText: statusText.value,
                    operatorId: operatorId.value
                };
            }
            return {
                devices: devices.value,
                isLoading: isLoading.value,
                statusType: statusType.value,
                statusText: statusText.value,
                refreshLoading: refreshLoading.value,
                stats: dashboardStats.value,
                recentAssessments: recentAssessments.value,
                operatorId: operatorId.value
            };
        });

        const currentEvents = computed(() => {
            if (currentRoute.value === 'connect') {
                return {
                    'cancel-session': async () => { await session.cancelSession(); window.location.hash = '#/'; },
                    'navigate-phase': (phase) => { 
                        if (routeParams.value.uuid) {
                            window.location.hash = `#/device/${encodeURIComponent(routeParams.value.uuid)}/${phase}`;
                        }
                    },
                    'device-detected': (device) => {
                        if (device && device.uuid) {
                            window.location.hash = `#/device/${encodeURIComponent(device.uuid)}`;
                        } else {
                            console.log('[App] Simulate device detected (no real device)');
                        }
                    },
                    'go-back': () => { window.location.hash = '#/'; }
                };
            }
            if (currentRoute.value === 'home') {
                return {
                    refresh: refreshDevices,
                    'generate-report': handleGenerateReport,
                    'start-assessment': () => { window.location.hash = '#/connect'; },
                    'resume-session': async (data) => {
                        window.ToastManager.show('Resuming assessment...', 'info');
                        const s = await session.resumeSessionById(data.rawSessionId);
                        if (s) {
                            window.location.hash = `#/device/${encodeURIComponent(data.uuid)}/${s.activePhase || 'authenticity'}`;
                        } else {
                            window.ToastManager.show('Failed to resume session', 'error');
                        }
                    },
                    'navigate': (key) => { console.log('[App] Navigate:', key); },
                    'logout': () => { console.log('[App] Logout requested'); },
                    'view-all-assessments': () => { console.log('[App] View all assessments'); }
                };
            }
            return {};
        });

        // --- Lifecycle ---
        onMounted(async () => {
            console.log('[App] Vue app mounted');
            setupIPCListeners();
            await session.cleanupStaleSessions();
            await syncWithDB();
            
            statusType.value = 'ready';
            statusText.value = 'Ready - Waiting for devices';

            // Show splash briefly, then transition to the real route
            setTimeout(async () => {
                parseHash();
                window.addEventListener('hashchange', parseHash);

                // Resume check
                const resumeUuid = localStorage.getItem('idt_active_uuid');
                if (resumeUuid && currentRoute.value === 'home') {
                    const s = await session.loadSession(resumeUuid);
                    if (s && s.status === 'in-progress') {
                        window.location.hash = `#/device/${encodeURIComponent(resumeUuid)}/${s.activePhase || 'authenticity'}`;
                    }
                }
            }, 1500);
        });

        onUnmounted(() => {
            window.removeEventListener('hashchange', parseHash);
            cleanupFns.forEach(fn => fn && fn());
        });

        // --- Watchers ---
        // Refresh DB when returning to the dashboard
        watch(currentRoute, async (newRoute) => {
            if (newRoute === 'home') {
                console.log('[App] Returned to home route, syncing with DB...');
                await syncWithDB();
            }
        });

        return {
            currentComponent,
            currentProps,
            currentEvents,
            toasts
        };
    },
    template: `
        <component :is="currentComponent" v-bind="currentProps" v-on="currentEvents" />
        <ToastContainer :toasts="toasts" />
    `
});

// --- Register all components ---
Object.entries(window.AppComponents || {}).forEach(([name, comp]) => {
    app.component(name, comp);
});

// --- Register all views ---
Object.entries(window.AppViews || {}).forEach(([name, view]) => {
    app.component(name, view);
});

// --- Mount ---
app.mount('#app');

console.log('[App] iOS Device Manager Vue app ready');
