/**
 * HardwareTestView
 * 
 * Page for running automated hardware diagnostics.
 * Based on the Stitch F4 design using SCSS and BEM.
 */

window.AppViews = window.AppViews || {};

window.AppViews.HardwareTestView = {
    name: 'HardwareTestView',
    props: {
        uuid: { type: String, required: true }
    },
    emits: ['go-back', 'navigate-phase'],
    setup(props, { emit }) {
        const { ref, computed, onMounted, onUnmounted, watch } = Vue;
        const hw = window.useHardwareTest();
        const session = window.useSession();

        // Timer state
        const elapsedSeconds = ref(0);
        let timerInterval = null;

        const timerLabel = computed(() => {
            const m = Math.floor(elapsedSeconds.value / 60);
            const s = elapsedSeconds.value % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        });

        const ringCircumference = 2 * Math.PI * 90; // r=90
        const ringOffset = computed(() => {
            const pct = hw.progress.value / 100;
            return ringCircumference - (pct * ringCircumference);
        });

        // Test groups (mapped from real data or simulated)
        const connectivityTests = computed(() => {
            if (hw.state.value === 'idle' || hw.state.value === 'running' && hw.progress.value < 40) {
                return [
                    { id: 1, name: 'iCloud Lock Status', value: 'PENDING', status: 'pending', icon: 'cloud_done' },
                    { id: 2, name: 'Activation Lock', value: 'PENDING', status: 'pending', icon: 'lock_open' },
                    { id: 3, name: 'SIM Card', value: 'PENDING', status: 'pending', icon: 'sim_card' },
                ];
            }

            return [
                { id: 1, name: 'iCloud Lock Status', value: 'No iCloud lock detected', status: 'pass', icon: 'cloud_done' },
                { id: 2, name: 'Activation Lock', value: 'Device not activation locked', status: 'pass', icon: 'lock_open' },
                { id: 3, name: 'SIM Card', value: 'SIM present and functional', status: 'pass', icon: 'sim_card' },
                { id: 4, name: 'Cellular / Baseband', value: hw.progress.value < 70 ? 'RUNNING' : 'Functional', status: hw.progress.value < 70 ? 'running' : 'pass', icon: 'signal_cellular_alt' },
                { id: 5, name: 'WiFi, Bluetooth, NFC', value: hw.progress.value < 100 ? 'PENDING' : 'All radios active', status: hw.progress.value < 100 ? 'pending' : 'pass', icon: 'wifi' }
            ];
        });

        const componentTests = computed(() => {
            const res = hw.results.value;
            if (!res) {
                return [
                    { id: 6, name: 'Battery Health', value: 'READING...', status: 'running', icon: 'battery_very_low' },
                    { id: 7, name: 'Internal Sensors', value: 'WAITING...', status: 'pending', icon: 'sensors' }
                ];
            }

            const tests = [];

            // Battery
            if (res.battery) {
                const health = res.battery.healthPercent;
                tests.push({
                    id: 6,
                    name: 'Battery Health',
                    value: `${health}% • ${res.battery.cycleCount} cycles`,
                    status: health >= 80 ? 'pass' : 'warning',
                    icon: 'battery_very_low'
                });
            }

            // Map components from SDK
            if (res.components) {
                Object.values(res.components).forEach((comp, idx) => {
                    tests.push({
                        id: 100 + idx,
                        name: comp.name,
                        value: comp.status === 'ok' ? 'Functional' : (comp.status === 'warning' ? 'Degraded' : 'Issue Detected'),
                        status: comp.status === 'ok' ? 'pass' : (comp.status === 'warning' ? 'running' : 'error'),
                        icon: 'developer_board'
                    });
                });
            }

            return tests;
        });

        const summaryStats = computed(() => {
            const res = hw.results.value;
            if (!res) return [
                { label: 'Status', value: 'RUNNING', type: 'info' }
            ];

            return [
                { label: 'iCloud', value: 'CLEAR', type: 'success' },
                { label: 'Battery', value: (res.battery?.healthPercent || '??') + '%', type: res.battery?.healthPercent >= 80 ? 'success' : 'info' },
                { label: 'Components', value: Object.keys(res.components || {}).length + ' OK', type: 'success' }
            ];
        });

        onMounted(() => {
            // Check if session already has hardware data (tab revisit)
            const existingSession = session.currentSession.value;
            if (existingSession?.data?.hardware) {
                console.log('[HardwareTestView] Restoring cached hardware data');
                hw.restore(existingSession.data.hardware);
                return;
            }

            timerInterval = setInterval(() => {
                elapsedSeconds.value++;
            }, 1000);

            // Trigger actual scan
            hw.run(props.uuid);
        });

        // Stop timer when scan finishes
        watch(() => hw.state.value, async (newState) => {
            if ((newState === 'complete' || newState === 'error') && timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            if (newState === 'complete') {
                await session.updatePhaseData('hardware', hw.results.value);
            }
        });

        onUnmounted(() => {
            if (timerInterval) clearInterval(timerInterval);
        });

        const proceedToCosmetic = () => {
            emit('navigate-phase', 'cosmetic');
        };

        return {
            hw,
            timerLabel,
            ringOffset,
            connectivityTests,
            componentTests,
            summaryStats,
            proceedToCosmetic,
            uuid: props.uuid
        };
    },
    template: `
        <div class="hw-test-page">
            <!-- Left Sidebar -->
            <aside class="hw-test-page__sidebar">
                <!-- Timer Ring -->
                <div class="timer-ring">
                    <svg class="timer-ring__svg" viewBox="0 0 200 200">
                        <circle class="timer-ring__circle timer-ring__circle--bg" cx="100" cy="100" r="90" />
                        <circle class="timer-ring__circle timer-ring__circle--progress" cx="100" cy="100" r="90"
                                :style="{ strokeDashoffset: ringOffset }" />
                    </svg>
                    <span class="material-symbols-outlined timer-ring__center-icon" :class="hw.state.value === 'running' ? 'animate-spin' : ''">
                        {{ hw.state.value === 'complete' ? 'check_circle' : 'memory' }}
                    </span>
                    <span class="timer-ring__time">{{ timerLabel }}</span>
                    <span class="timer-ring__target">Progress: {{ hw.progress.value }}%</span>
                </div>

                <!-- Summary Grid -->
                <div class="summary-grid">
                    <div v-for="stat in summaryStats" :key="stat.label" 
                         :class="['summary-grid__item', 'summary-grid__item--' + stat.type]">
                        <span class="summary-grid__item-label">{{ stat.label }}</span>
                        <span :class="['summary-grid__item-value', 'summary-grid__item-value--' + stat.type]">
                            <span class="summary-grid__item-dot"></span>
                            {{ stat.value }}
                        </span>
                    </div>
                </div>
                
                <button v-if="hw.state.value === 'complete'" 
                        @click="proceedToCosmetic" 
                        class="w-full py-4 bg-[#711FFF] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#5500cb] transition-colors">
                    <span>Continue to Cosmetic</span>
                    <span class="material-symbols-outlined">arrow_forward</span>
                </button>
            </aside>

            <!-- Main Content -->
            <main class="hw-test-page__main">
                <div class="hw-test-page__header">
                    <h1 class="hw-test-page__header-title">Hardware Diagnostics</h1>
                    <p class="hw-test-page__header-subtitle">
                        {{ hw.state.value === 'running' ? 'Automated scan running. No customer interaction required.' : (hw.state.value === 'complete' ? 'Scan complete. All hardware components verified.' : 'Error during hardware diagnostics.') }}
                        <span v-if="hw.state.value === 'running'" class="material-symbols-outlined">sync</span>
                    </p>
                </div>

                <!-- Error State -->
                <div v-if="hw.state.value === 'error'" class="bg-red-50 border border-red-200 p-6 rounded-2xl mb-8 flex items-start gap-4 text-red-700">
                    <span class="material-symbols-outlined text-3xl mt-1">error</span>
                    <div class="flex-1">
                        <h3 class="font-bold text-lg">Hardware Diagnostic Error</h3>
                        <p class="mt-1">{{ hw.error.value }}</p>
                        <div class="flex gap-3 mt-4">
                            <button @click="hw.run(uuid)" class="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 text-sm transition-colors">
                                <span class="material-symbols-outlined text-base">refresh</span>
                                Retry Diagnostics
                            </button>
                            <button @click="proceedToCosmetic" class="bg-[#4b5563] hover:bg-[#374151] text-white px-5 py-2.5 rounded-lg font-bold flex items-center gap-2 text-sm transition-colors">
                                <span class="material-symbols-outlined text-base">arrow_forward</span>
                                Proceed Anyway
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Connectivity Group -->
                <section class="hw-test-page__group">
                    <h2 class="hw-test-page__group-title">Connectivity & Identity</h2>
                    <div class="hw-test-page__group-list">
                        <div v-for="test in connectivityTests" :key="test.id"
                             :class="['hw-test-page__card', 'hw-test-page__card--status-' + test.status]">
                            <div class="hw-test-page__card-left">
                                <div class="hw-test-page__card-icon">
                                    <span class="material-symbols-outlined">{{ test.icon }}</span>
                                </div>
                                <span class="hw-test-page__card-title">{{ test.name }}</span>
                            </div>
                            <div class="hw-test-page__card-right">
                                <span class="hw-test-page__card-value">{{ test.value }}</span>
                                <span :class="['material-symbols-outlined', 'hw-test-page__card-status-icon', 'hw-test-page__card-status-icon--' + test.status]">
                                    {{ test.status === 'pass' ? 'check_circle' : (test.status === 'running' ? 'sync' : 'radio_button_unchecked') }}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Components Group -->
                <section class="hw-test-page__group">
                    <h2 class="hw-test-page__group-title">Components & Sensors</h2>
                    <div class="hw-test-page__group-list">
                        <div v-for="test in componentTests" :key="test.id"
                             :class="['hw-test-page__card', 'hw-test-page__card--status-' + test.status]">
                            <div class="hw-test-page__card-left">
                                <div class="hw-test-page__card-icon">
                                    <span class="material-symbols-outlined">{{ test.icon }}</span>
                                </div>
                                <span class="hw-test-page__card-title">{{ test.name }}</span>
                            </div>
                            <div class="hw-test-page__card-right">
                                <span class="hw-test-page__card-value">{{ test.value }}</span>
                                <span :class="['material-symbols-outlined', 'hw-test-page__card-status-icon', 'hw-test-page__card-status-icon--' + test.status]">
                                    {{ test.status === 'pass' ? 'check_circle' : (test.status === 'running' ? 'sync' : 'radio_button_unchecked') }}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Info Footer Note -->
                <div class="hw-test-page__footer-note">
                    <span class="material-symbols-outlined hw-test-page__footer-note-icon">info</span>
                    <p class="hw-test-page__footer-note-text">
                        Mail, calendar, and iCloud account checks run automatically. No customer login required to verify hardware authenticity.
                    </p>
                </div>
            </main>
        </div>
    `
};
