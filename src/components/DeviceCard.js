/**
 * DeviceCard Component
 * 
 * Displays a device summary card with status badge, basic info,
 * expandable hardware diagnostics, and report button.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.DeviceCard = {
    name: 'DeviceCard',
    props: {
        device: { type: Object, required: true }
    },
    emits: ['generate-report'],
    data() {
        return {
            diagnosticsExpanded: false,
            diagnosticsLoaded: false,
            diagnosticsLoading: false,
            diagnosticsError: null,
            diagnosticsData: null
        };
    },
    computed: {
        isError() { return this.device.error === true; },
        isActivated() { return this.device.ActivationState === 'Activated'; },
        isLocked() { return this.device.ActivationState === 'Locked' || this.device.ActivationState === 'Error'; },

        statusCardClass() {
            if (this.isError) return 'status-error';
            if (this.isActivated) return 'status-activated';
            if (this.isLocked) return 'status-locked';
            return 'status-unknown';
        },
        badgeClass() {
            if (this.isError) return 'badge-error';
            if (this.isActivated) return 'badge-activated';
            if (this.isLocked) return 'badge-locked';
            return 'badge-unknown';
        },
        badgeText() {
            if (this.isError) return 'Error';
            if (this.isActivated) return 'Activated';
            if (this.isLocked) return 'Locked';
            return this.device.ActivationState || 'Unknown';
        }
    },
    methods: {
        onCardClick(e) {
            if (e.target.closest('button')) return;
            window.location.hash = `#/device/${encodeURIComponent(this.device.uuid)}`;
        },
        async toggleDiagnostics() {
            this.diagnosticsExpanded = !this.diagnosticsExpanded;
            if (this.diagnosticsExpanded && !this.diagnosticsLoaded && !this.isError) {
                await this.loadDiagnostics();
            }
        },
        async loadDiagnostics() {
            this.diagnosticsLoading = true;
            this.diagnosticsError = null;
            try {
                const result = await window.electronAPI.getHardwareDiagnostics(this.device.uuid);
                if (result.success && result.data) {
                    this.diagnosticsData = result.data;
                    this.diagnosticsLoaded = true;
                } else {
                    throw new Error(result.error || 'Failed to load diagnostics');
                }
            } catch (error) {
                this.diagnosticsError = error.message;
            } finally {
                this.diagnosticsLoading = false;
            }
        },
        healthColor(percent) {
            if (percent >= 80) return '#4ade80';
            if (percent >= 60) return '#fbbf24';
            return '#f87171';
        },
        overallStatusClass(status) {
            return 'status-value overall-status status-' + status;
        }
    },
    template: `
        <div class="device-card" :class="statusCardClass" :data-uuid="device.uuid"
             style="cursor: pointer;" @click="onCardClick">
            <div class="card-header">
                <div class="device-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="1.5" />
                        <circle cx="12" cy="18" r="1.5" fill="currentColor" />
                        <line x1="9" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="1.5"
                            stroke-linecap="round" />
                    </svg>
                </div>
                <div class="card-header-right">
                    <div class="device-status-badge" :class="badgeClass">
                        <span class="badge-text">{{ badgeText }}</span>
                    </div>
                    <span class="click-hint">Click for details →</span>
                </div>
            </div>

            <div class="card-body">
                <h3 class="device-name">{{ device.DeviceName || 'Unknown Device' }}</h3>
                <p class="device-model">{{ device.ModelName || device.Model || 'Unknown Model' }}</p>

                <div class="device-details">
                    <div class="detail-row">
                        <span class="detail-label">iOS Version</span>
                        <span class="detail-value">{{ device.iOSVersion || '--' }}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Serial Number</span>
                        <span class="detail-value">{{ device.SerialNumber || '--' }}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">IMEI</span>
                        <span class="detail-value">{{ device.IMEI || 'N/A' }}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Battery</span>
                        <span class="detail-value">{{ device.BatteryLevel || '--' }}</span>
                    </div>
                </div>

                <!-- Hardware Diagnostics -->
                <div class="hardware-diagnostics">
                    <div class="diagnostics-header" @click.stop="toggleDiagnostics">
                        <span class="diagnostics-title">🔧 Hardware Diagnostics</span>
                        <button class="btn-expand">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                 :style="{ transform: diagnosticsExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }">
                                <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2"
                                    stroke-linecap="round" />
                            </svg>
                        </button>
                    </div>
                    <div class="diagnostics-content" v-if="diagnosticsExpanded">
                        <div class="diagnostics-loading" v-if="diagnosticsLoading">
                            <span class="loader-small"></span> Loading diagnostics...
                        </div>
                        <div class="diagnostics-data" v-if="diagnosticsLoaded && diagnosticsData">
                            <div class="detail-row">
                                <span class="detail-label">Battery Health</span>
                                <span class="detail-value"
                                      :style="{ color: diagnosticsData.battery.healthPercent !== null ? healthColor(diagnosticsData.battery.healthPercent) : '' }">
                                    {{ diagnosticsData.battery.healthPercent !== null ? diagnosticsData.battery.healthPercent + '%' : '--' }}
                                </span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Cycle Count</span>
                                <span class="detail-value">{{ diagnosticsData.battery.cycleCount ?? '--' }}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Battery Serial</span>
                                <span class="detail-value">{{ diagnosticsData.battery.serial || '--' }}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Design Capacity</span>
                                <span class="detail-value">{{ diagnosticsData.battery.designCapacity ? diagnosticsData.battery.designCapacity + ' mAh' : '--' }}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Current Max</span>
                                <span class="detail-value">{{ diagnosticsData.battery.currentMaxCapacity ? diagnosticsData.battery.currentMaxCapacity + ' mAh' : '--' }}</span>
                            </div>
                            <div class="diagnostics-status">
                                <span class="status-label">Status:</span>
                                <span :class="overallStatusClass(diagnosticsData.summary.overallStatus)">
                                    {{ diagnosticsData.summary.overallStatus.toUpperCase() }}
                                </span>
                            </div>
                        </div>
                        <div class="diagnostics-error" v-if="diagnosticsError">
                            <span class="error-text">{{ diagnosticsError }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card-footer">
                <button class="btn btn-secondary btn-report" @click.stop="$emit('generate-report', device)"
                        :disabled="isError" :title="isError ? 'Cannot generate report for device with errors' : ''">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                        <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                    <span>Print Report</span>
                </button>
            </div>

            <div class="card-error" v-if="isError && device.errorMessage">
                <p class="error-message">{{ device.errorMessage }}</p>
            </div>
        </div>
    `
};
