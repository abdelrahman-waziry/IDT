/**
 * StatusBar Component
 * 
 * Shows connection status indicator and device count.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.StatusBar = {
    name: 'StatusBar',
    props: {
        statusType: { type: String, default: 'ready' },
        statusText: { type: String, default: 'Initializing...' },
        deviceCount: { type: Number, default: 0 }
    },
    computed: {
        statusClass() {
            return 'status-indicator status-' + this.statusType;
        }
    },
    template: `
        <div class="status-bar">
            <div :class="statusClass">
                <span class="status-dot"></span>
                <span class="status-text">{{ statusText }}</span>
            </div>
            <div class="device-count">
                <span>{{ deviceCount }}</span> device(s) connected
            </div>
        </div>
    `
};
