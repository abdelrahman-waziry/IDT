/**
 * DeviceDetailView
 * 
 * Detailed view for a single device showing battery, storage,
 * network, hardware components, and raw data.
 */

window.AppViews = window.AppViews || {};

// --- Component definitions ---
const COMPONENT_DEFS = [
    { id: 'display', fallbackDetail: 'Display Controller' },
    { id: 'touch', fallbackDetail: 'Touch Controller' },
    { id: 'faceid', fallbackDetail: 'Biometric Sensor' },
    { id: 'rear_camera', fallbackDetail: 'Camera Module' },
    { id: 'speaker', fallbackDetail: 'Audio Output' },
    { id: 'microphone', fallbackDetail: 'Audio Input' },
    { id: 'wifi', fallbackDetail: 'WiFi Module' },
    { id: 'bluetooth', fallbackDetail: 'Bluetooth' },
    { id: 'gyroscope', fallbackDetail: 'Motion Sensor' },
    { id: 'accelerometer', fallbackDetail: 'Motion Sensor' },
    { id: 'compass', fallbackDetail: 'Magnetometer' },
    { id: 'proximity', fallbackDetail: 'Proximity Sensor' },
    { id: 'haptics', fallbackDetail: 'Haptic Engine' },
    { id: 'baseband', fallbackDetail: 'Cellular Modem' },
    { id: 'backlight', fallbackDetail: 'Display Backlight' },
    { id: 'gpu', fallbackDetail: 'Graphics Processor' },
    { id: 'lightning', fallbackDetail: 'Charging Port' },
    { id: 'ambient_light', fallbackDetail: 'Light Sensor' }
];

// --- Utility Functions ---
function parseStorageValue(str) {
    if (!str || str === 'Unknown') return null;
    const match = str.match(/([\d.]+)\s*(GB|MB|TB|KB|Bytes)/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers = { 'BYTES': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024, 'TB': 1024 * 1024 * 1024 * 1024 };
    return value * (multipliers[unit] || 1);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

window.AppViews.DeviceDetailView = {
    name: 'DeviceDetailView',
    props: {
        uuid: { type: String, required: true }
    },
    data() {
        return {
            loading: false,
            refreshLoading: false,
            rawDataExpanded: false,
            d: {},          // device data
            diag: null      // diagnostics data
        };
    },
    computed: {
        headerDeviceName() { return this.d.DeviceName || 'Device Details'; },
        headerModel() { return this.d.ModelName || this.d.Model || 'Loading...'; },

        // Battery computed
        bat() { return this.diag?.battery || {}; },
        batteryHealthColor() {
            const hp = this.bat.healthPercent;
            if (hp == null) return '';
            if (hp >= 80) return 'var(--color-success)';
            if (hp >= 60) return 'var(--color-warning)';
            return 'var(--color-danger)';
        },
        batteryHealthBadgeClass() {
            const hp = this.bat.healthPercent;
            if (hp == null) return '';
            if (hp >= 80) return 'good';
            if (hp >= 60) return 'fair';
            return 'poor';
        },
        batteryHealthLabel() {
            const hp = this.bat.healthPercent;
            if (hp == null) return '--';
            if (hp >= 80) return 'Good';
            if (hp >= 60) return 'Fair';
            return 'Replace Soon';
        },
        batteryBuiltInLabel() {
            const val = this.bat.builtIn;
            if (val === true) return 'Yes ✅';
            if (val === false) return 'No ⚠️';
            return '--';
        },

        // Storage computed
        storageUsedPercent() {
            const total = parseStorageValue(this.d.TotalDiskCapacity);
            const available = parseStorageValue(this.d.AvailableDiskSpace);
            if (!total || !available) return 0;
            return ((total - available) / total) * 100;
        },
        storageUsedLabel() {
            const total = parseStorageValue(this.d.TotalDiskCapacity);
            const available = parseStorageValue(this.d.AvailableDiskSpace);
            if (!total || !available) return 'Used: --';
            return `Used: ${formatBytes(total - available)}`;
        },
        storageAvailableLabel() {
            const available = parseStorageValue(this.d.AvailableDiskSpace);
            if (!available) return 'Available: --';
            return `Available: ${formatBytes(available)}`;
        },

        // Components
        components() {
            const detected = this.diag?.components || {};
            const batteryStatus = (() => {
                if (!this.diag?.battery?.healthPercent) return 'unknown';
                if (this.diag.battery.healthPercent >= 80) return 'ok';
                if (this.diag.battery.healthPercent >= 60) return 'warning';
                return 'error';
            })();

            const list = [{
                name: 'Battery', icon: '🔋', status: batteryStatus,
                detail: this.diag?.battery?.healthPercent ? `${this.diag.battery.healthPercent}% Health` : null
            }];

            COMPONENT_DEFS.forEach(item => {
                const comp = detected[item.id];
                let detail = item.fallbackDetail;
                if (item.id === 'wifi' && this.d.WiFiAddress) detail = this.d.WiFiAddress;
                else if (item.id === 'bluetooth' && this.d.BluetoothAddress) detail = this.d.BluetoothAddress;

                list.push({
                    name: comp?.name || item.id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    icon: comp?.icon || '📦',
                    status: comp?.detected ? 'ok' : 'unknown',
                    detail: comp?.detected ? 'Detected ✓' : detail
                });
            });

            list.push({
                name: 'Carrier Info', icon: '📡',
                status: this.d.IMEI && this.d.IMEI !== 'N/A (WiFi Only)' ? 'ok' : 'unknown',
                detail: this.d.CarrierName || (this.d.IMEI ? 'Cellular Modem' : 'WiFi Only')
            });

            return list;
        },

        rawDataJson() {
            const combined = { deviceInfo: { ...this.d }, diagnostics: this.diag };
            if (combined.deviceInfo._raw) delete combined.deviceInfo._raw;
            return JSON.stringify(combined, null, 2);
        }
    },
    methods: {
        goBack() { window.location.hash = '#/'; },

        statusLabel(status) {
            return { ok: 'OK', warning: 'Warning', error: 'Issue', unknown: 'Unknown' }[status] || 'Unknown';
        },

        async loadDeviceData() {
            this.loading = true;
            try {
                const infoResult = await window.electronAPI.getDeviceInfo(this.uuid);
                if (infoResult.success) {
                    this.d = { uuid: this.uuid, ...infoResult.data };
                } else {
                    throw new Error(infoResult.error || 'Failed to get device info');
                }

                const diagResult = await window.electronAPI.getHardwareDiagnostics(this.uuid);
                if (diagResult.success) {
                    this.diag = diagResult.data;
                }

                window.ToastManager.show('Device data loaded', 'success');
            } catch (error) {
                console.error('[DeviceDetail] Error loading data:', error);
                window.ToastManager.show('Failed to load device data: ' + error.message, 'error');
            } finally {
                this.loading = false;
            }
        },

        async refreshData() {
            this.refreshLoading = true;
            await this.loadDeviceData();
            this.refreshLoading = false;
        },

        async generateReport() {
            if (!this.d.uuid) return;
            window.ToastManager.show('Generating report...', 'info');
            try {
                const result = await window.electronAPI.generateReport({
                    ...this.d, diagnostics: this.diag
                });
                if (result.success) {
                    window.ToastManager.show(`Report saved: ${result.path}`, 'success', 5000);
                } else {
                    window.ToastManager.show(`Failed: ${result.error}`, 'error');
                }
            } catch (error) {
                window.ToastManager.show('Failed to generate report', 'error');
            }
        }
    },
    async mounted() {
        console.log('[DeviceDetail] Initializing with UUID:', this.uuid);
        if (!this.uuid) {
            window.ToastManager.show('No device UUID provided', 'error');
            return;
        }
        await this.loadDeviceData();
    },
    template: `
        <div class="app-container detail-page">
            <!-- Header -->
            <AppHeader :title="headerDeviceName" :subtitle="headerModel" :show-back="true" @back="goBack">
                <template #actions>
                    <button class="btn btn-primary" @click="refreshData" :disabled="refreshLoading">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C15.3019 3 18.1885 4.77814 19.7545 7.42909"
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                            <path d="M21 3V8H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round" />
                        </svg>
                        <span>Refresh</span>
                    </button>
                    <button class="btn btn-secondary" @click="generateReport">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
                                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                            <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                                stroke-linejoin="round" />
                        </svg>
                        <span>Generate Report</span>
                    </button>
                </template>
            </AppHeader>

            <!-- Main Content -->
            <main class="main-content">
                <LoadingOverlay v-if="loading" message="Loading device details..." />

                <!-- Device Summary -->
                <section class="detail-section">
                    <div class="section-header"><h2>📱 Device Overview</h2></div>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">Device Name</span>
                            <span class="info-value">{{ d.DeviceName || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Model</span>
                            <span class="info-value">{{ d.ModelName || d.Model || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">iOS Version</span>
                            <span class="info-value">{{ d.iOSVersion || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Build Version</span>
                            <span class="info-value">{{ d.BuildVersion || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Serial Number</span>
                            <span class="info-value monospace">{{ d.SerialNumber || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">UDID</span>
                            <span class="info-value monospace">{{ d.UDID || uuid || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">IMEI</span>
                            <span class="info-value monospace">{{ d.IMEI || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Activation Status</span>
                            <span class="info-value"
                                :style="{ color: d.ActivationState === 'Activated' ? 'var(--color-success)' : 'var(--color-warning)' }">
                                {{ d.ActivationState || '--' }}
                            </span>
                        </div>
                    </div>
                </section>

                <!-- Battery & Power -->
                <section class="detail-section">
                    <div class="section-header">
                        <h2>🔋 Battery &amp; Power</h2>
                        <span class="health-badge" :class="batteryHealthBadgeClass">{{ batteryHealthLabel }}</span>
                    </div>
                    <div class="info-grid">
                        <div class="info-item highlight">
                            <span class="info-label">Battery Health</span>
                            <span class="info-value large" :style="{ color: batteryHealthColor }">
                                {{ bat.healthPercent != null ? bat.healthPercent + '%' : '--' }}
                            </span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Current Charge</span>
                            <span class="info-value">{{ d.BatteryLevel || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Cycle Count</span>
                            <span class="info-value">{{ bat.cycleCount ?? '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Design Capacity</span>
                            <span class="info-value">{{ bat.designCapacity ? bat.designCapacity + ' mAh' : '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Current Max Capacity</span>
                            <span class="info-value">{{ bat.currentMaxCapacity ? bat.currentMaxCapacity + ' mAh' : '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Battery Serial</span>
                            <span class="info-value monospace">{{ bat.serial || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Voltage</span>
                            <span class="info-value">{{ bat.voltage ? bat.voltage + ' mV' : '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Temperature</span>
                            <span class="info-value">{{ bat.temperature ? bat.temperature + '°C' : '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Charging</span>
                            <span class="info-value" v-html="bat.isCharging ? 'Yes ⚡' : 'No'"></span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Built-in Battery</span>
                            <span class="info-value" v-html="batteryBuiltInLabel"></span>
                        </div>
                    </div>
                </section>

                <!-- Storage -->
                <section class="detail-section">
                    <div class="section-header"><h2>💾 Storage</h2></div>
                    <div class="storage-bar-container">
                        <div class="storage-bar">
                            <div class="storage-used" :style="{ width: storageUsedPercent + '%' }"></div>
                        </div>
                        <div class="storage-labels">
                            <span>{{ storageUsedLabel }}</span>
                            <span>{{ storageAvailableLabel }}</span>
                        </div>
                    </div>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">Total Capacity</span>
                            <span class="info-value">{{ d.TotalDiskCapacity || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Available Space</span>
                            <span class="info-value">{{ d.AvailableDiskSpace || '--' }}</span>
                        </div>
                    </div>
                </section>

                <!-- Network -->
                <section class="detail-section">
                    <div class="section-header"><h2>📡 Network &amp; Connectivity</h2></div>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">WiFi MAC Address</span>
                            <span class="info-value monospace">{{ d.WiFiAddress || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Bluetooth MAC</span>
                            <span class="info-value monospace">{{ d.BluetoothAddress || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Carrier</span>
                            <span class="info-value">{{ d.CarrierName || '--' }}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Phone Number</span>
                            <span class="info-value">{{ d.PhoneNumber || '--' }}</span>
                        </div>
                    </div>
                </section>

                <!-- Hardware Components -->
                <section class="detail-section">
                    <div class="section-header"><h2>🔧 Hardware Components</h2></div>
                    <div class="component-grid">
                        <div class="component-summary" v-if="diag && diag.summary">
                            <span class="summary-text">
                                <strong>{{ diag.summary.componentsDetected || 0 }}</strong> of
                                <strong>{{ diag.summary.totalComponents || components.length }}</strong>
                                components detected via IORegistry
                            </span>
                        </div>
                        <div class="component-card" v-for="comp in components" :key="comp.name">
                            <span class="component-icon" v-html="comp.icon"></span>
                            <span class="component-name">{{ comp.name }}</span>
                            <span class="component-status" :class="comp.status">{{ statusLabel(comp.status) }}</span>
                            <span class="component-detail" v-if="comp.detail" v-html="comp.detail"></span>
                        </div>
                        <div class="component-card loading" v-if="!diag">
                            <div class="loader-small"></div>
                            <span>Loading components...</span>
                        </div>
                    </div>
                </section>

                <!-- Raw Data -->
                <section class="detail-section collapsible">
                    <div class="section-header clickable" @click="rawDataExpanded = !rawDataExpanded">
                        <h2>📋 Raw Device Data</h2>
                        <svg class="expand-icon" :class="{ rotated: rawDataExpanded }" width="20" height="20"
                            viewBox="0 0 24 24" fill="none">
                            <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                        </svg>
                    </div>
                    <div class="section-content" v-if="rawDataExpanded">
                        <pre id="raw-data-json">{{ rawDataJson }}</pre>
                    </div>
                </section>
            </main>
        </div>
    `
};
