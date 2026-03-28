/**
 * HomeView
 * 
 * Main view showing the list of connected iOS devices.
 * Uses DeviceCard, StatusBar, LoadingOverlay, and EmptyState components.
 */

window.AppViews = window.AppViews || {};

window.AppViews.HomeView = {
    name: 'HomeView',
    props: {
        devices: { type: Array, default: () => [] },
        isLoading: { type: Boolean, default: false },
        statusType: { type: String, default: 'ready' },
        statusText: { type: String, default: 'Initializing...' },
        refreshLoading: { type: Boolean, default: false }
    },
    emits: ['refresh', 'generate-report'],
    template: `
        <div class="app-container">
            <!-- Header -->
            <AppHeader title="iOS Device Manager" subtitle="Device Diagnostics & Reporting" :show-logo="true">
                <template #actions>
                    <button id="refresh-btn" class="btn btn-primary" @click="$emit('refresh')"
                            :disabled="refreshLoading" :class="{ loading: refreshLoading }">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C15.3019 3 18.1885 4.77814 19.7545 7.42909"
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                            <path d="M21 3V8H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round" />
                        </svg>
                        <span>Refresh</span>
                    </button>
                </template>
            </AppHeader>

            <!-- Status Bar -->
            <StatusBar :status-type="statusType" :status-text="statusText" :device-count="devices.length" />

            <!-- Main Content -->
            <main class="main-content">
                <LoadingOverlay v-if="isLoading" message="Scanning for devices..." />

                <EmptyState v-if="!isLoading && devices.length === 0" />

                <div class="device-grid" v-if="!isLoading && devices.length > 0">
                    <DeviceCard v-for="device in devices" :key="device.uuid" :device="device"
                        @generate-report="$emit('generate-report', $event)" />
                </div>
            </main>
        </div>
    `
};
