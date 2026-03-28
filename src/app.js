/**
 * iOS Device Manager - Main Vue Application
 * 
 * Single-page application entry point with hash-based routing.
 * Routes:
 *   (splash)       → Splash (shown briefly on startup)
 *   #/             → HomeView (device list)
 *   #/device/:uuid → DeviceDetailView (single device)
 */

const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

const app = createApp({
    setup() {
        // --- Routing ---
        const currentRoute = ref('splash');
        const routeParams = ref({});

        function parseHash() {
            const hash = window.location.hash || '#/';

            // Device detail: #/device/:uuid
            const deviceMatch = hash.match(/^#\/device\/(.+)$/);
            if (deviceMatch) {
                currentRoute.value = 'detail';
                routeParams.value = { uuid: decodeURIComponent(deviceMatch[1]) };
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
            if (currentRoute.value === 'detail') return 'DeviceDetailView';
            return 'HomeView';
        });

        const currentProps = computed(() => {
            if (currentRoute.value === 'splash') return {};
            if (currentRoute.value === 'detail') {
                return { uuid: routeParams.value.uuid };
            }
            return {
                devices: devices.value,
                isLoading: isLoading.value,
                statusType: statusType.value,
                statusText: statusText.value,
                refreshLoading: refreshLoading.value
            };
        });

        const currentEvents = computed(() => {
            if (currentRoute.value === 'home') {
                return {
                    refresh: refreshDevices,
                    'generate-report': handleGenerateReport
                };
            }
            return {};
        });

        // --- Lifecycle ---
        onMounted(() => {
            console.log('[App] Vue app mounted');
            setupIPCListeners();
            statusType.value = 'ready';
            statusText.value = 'Ready - Waiting for devices';

            // Show splash briefly, then transition to the real route
            setTimeout(() => {
                parseHash();
                window.addEventListener('hashchange', parseHash);
            }, 1500);
        });

        onUnmounted(() => {
            window.removeEventListener('hashchange', parseHash);
            cleanupFns.forEach(fn => fn && fn());
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
