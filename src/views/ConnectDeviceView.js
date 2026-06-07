/**
 * ConnectDeviceView – Fixtech Egypt
 *
 * Assessment flow screen (F2) for device connection / detection.
 * Based on the Stitch "F2: Connect Device" design.
 *
 * All data is dynamically bound — the checklist, status ring,
 * device info, and timer respond to props from the parent.
 */

window.AppViews = window.AppViews || {};

window.AppViews.ConnectDeviceView = {
    name: 'ConnectDeviceView',
    props: {
        /** Currently connected devices from IPC */
        devices: { type: Array, default: () => [] },
        /** Device UUID for phase testing */
        uuid: { type: String, default: null },
        /** Overall system status */
        statusType: { type: String, default: 'ready' },
        statusText: { type: String, default: '' },
        /** Operator badge */
        operatorId: { type: String, default: '' },
        /** Active assessment phase: 'connect' | 'authenticity' | 'hardware' | 'cosmetic' | 'pricing' */
        activePhase: { type: String, default: 'connect' },
        /** Engine / build version string */
        engineVersion: { type: String, default: '4.2.0-STABLE' }
    },
    emits: ['cancel-session', 'navigate-phase', 'device-detected', 'go-back'],

    setup(props, { emit }) {
        const { ref, computed, onMounted, onUnmounted, watch } = Vue;
        const session = window.useSession();
        const cosmetic = window.useCosmetic();

        // ------ Timer ------
        const elapsedSeconds = ref(0);
        let timerInterval = null;

        const timerLabel = computed(() => {
            const m = String(Math.floor(elapsedSeconds.value / 60)).padStart(2, '0');
            const s = String(elapsedSeconds.value % 60).padStart(2, '0');
            return `${m}:${s}`;
        });

        function startTimer() {
            timerInterval = setInterval(() => { elapsedSeconds.value++; }, 1000);
        }
        function stopTimer() {
            if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        }

        // ------ Phase tabs (clickable when completed) ------
        const phaseOrder = ['authenticity', 'hardware', 'cosmetic', 'pricing'];
        const phases = [
            { key: 'authenticity', label: 'AUTHENTICITY' },
            { key: 'hardware', label: 'HARDWARE' },
            { key: 'cosmetic', label: 'COSMETIC' },
            { key: 'pricing', label: 'PRICING' }
        ];
        const currentPhaseIndex = computed(() => phaseOrder.indexOf(props.activePhase));

        // Track the highest phase the user has reached during this session
        const highestPhaseReached = ref(currentPhaseIndex.value);
        watch(currentPhaseIndex, (newIdx) => {
            if (newIdx > highestPhaseReached.value) {
                highestPhaseReached.value = newIdx;
            }
        });

        function phaseState(phaseKey) {
            const idx = phaseOrder.indexOf(phaseKey);
            if (idx < currentPhaseIndex.value) return 'done';
            if (idx === currentPhaseIndex.value) return 'active';
            // Mark as reachable (done) if user has been to this phase before
            if (idx <= highestPhaseReached.value) return 'done';
            return 'upcoming';
        }

        function isPhaseClickable(phaseKey) {
            const idx = phaseOrder.indexOf(phaseKey);
            // Can click any phase that's been reached, except the currently active one
            return idx <= highestPhaseReached.value && idx !== currentPhaseIndex.value;
        }

        function navigateToPhase(phaseKey) {
            if (isPhaseClickable(phaseKey)) {
                emit('navigate-phase', phaseKey);
            }
        }

        // ------ Device detection state ------
        const deviceDetected = computed(() => props.devices.length > 0);
        const firstDevice = computed(() => props.devices[0] || null);

        // True when the cosmetic capture phase is active (USB disconnect expected)
        const isCosmeticPhase = computed(() => props.activePhase === 'cosmetic' && cosmetic.isCosmeticActive.value);

        // ------ Checklist (dynamic) ------
        const checklist = computed(() => {
            const dev = firstDevice.value;
            return [
                {
                    label: 'Device powered on',
                    done: !!dev   // if we see a device, it's powered on
                },
                {
                    label: 'Screen unlocked',
                    done: dev ? dev.ActivationState === 'Activated' : false
                },
                {
                    label: 'USB connected',
                    done: !!dev
                },
                {
                    label: "'Trust This Computer' tapped",
                    done: dev ? (dev.ActivationState === 'Activated') : false
                }
            ];
        });

        const checklistProgress = computed(() => {
            const total = checklist.value.length;
            const done = checklist.value.filter(c => c.done).length;
            return done / total;
        });

        // ------ Status ring SVG ------
        const ringCircumference = 2 * Math.PI * 58; // r=58
        const ringOffset = computed(() => {
            return ringCircumference - (checklistProgress.value * ringCircumference);
        });

        // ------ Info banner ------
        const bannerMessage = computed(() => {
            if (deviceDetected.value) return 'Device detected! Preparing assessment session.';
            return 'Waiting for iPhone via USB cable connection.';
        });
        const bannerType = computed(() => deviceDetected.value ? 'success' : 'info');

        // ------ Hardware port label ------
        const portLabel = computed(() => {
            if (!firstDevice.value) return 'HARDWARE PORT: AWAITING DEVICE';
            return `HARDWARE PORT: ${firstDevice.value.uuid ? firstDevice.value.uuid.substring(0, 16).toUpperCase() : 'CONNECTED'}`;
        });

        // ------ System status ------
        const systemReady = computed(() => props.statusType !== 'error');

        // ------ Session ID Display ------
        const displaySessionId = computed(() => {
            const cur = session.currentSession.value;
            if (!cur || !cur.sessionId) return props.uuid ? props.uuid.substring(0, 8).toUpperCase() : '----';
            const parts = cur.sessionId.split('_');
            return parts.length > 1 ? parts[parts.length - 1].substring(0, 8) : parts[0].substring(0, 8).toUpperCase();
        });

        // ------ Persistence Lifecycle ------
        onMounted(async () => { 
            startTimer();
            if (props.uuid) {
                await session.loadSession(props.uuid, firstDevice.value);
            }
        });
        onUnmounted(() => { stopTimer(); });

        // Sync UUID change (navigation)
        watch(() => props.uuid, async (newUuid) => {
            if (newUuid) {
                await session.loadSession(newUuid, firstDevice.value);
            }
        });

        // Sync active phase to persistence
        watch(() => props.activePhase, (newPhase) => {
            if (newPhase) {
                session.updateMetadata({ activePhase: newPhase });
            }
        });

        // When a device appears, emit event (skip during cosmetic phase — USB is intentionally disconnected)
        watch(deviceDetected, (isDetected) => {
            if (isDetected && firstDevice.value && !isCosmeticPhase.value) {
                emit('device-detected', firstDevice.value);
            }
        });

        // Helper for checklist icon fill style
        function checkIconStyle(done) {
            return done ? { fontVariationSettings: "'FILL' 1" } : {};
        }

        const reactiveUuid = Vue.toRef(props, 'uuid');

        return {
            // Timer
            timerLabel,
            // Phases
            phases,
            phaseState,
            isPhaseClickable,
            navigateToPhase,
            // Device
            deviceDetected,
            firstDevice,
            // Checklist
            checklist,
            checklistProgress,
            checkIconStyle,
            // Ring
            ringCircumference,
            ringOffset,
            // Banner
            bannerMessage,
            bannerType,
            // Port
            portLabel,
            // System
            systemReady,
            uuid: reactiveUuid,
            displaySessionId,
            isCosmeticPhase
        };
    },

    template: `
        <div class="connect-layout">
            <!-- ========== TOP APP BAR ========== -->
            <header class="connect-topbar">
                <div class="connect-topbar__left">
                    <div class="connect-topbar__brand">
                        <img src="assets/images/coreinspect-logo.png" style="width: 24px; height: 24px; object-fit: contain; border-radius: 4px; background: white; margin-right: 8px;" alt="Logo" />
                        <span class="connect-topbar__brand-name">CoreInspect</span>
                        <span v-if="operatorId" class="connect-topbar__operator-badge">{{ operatorId }}</span>
                    </div>
                    <nav class="connect-topbar__phases">
                        <span v-for="phase in phases"
                           :key="phase.key"
                           class="connect-topbar__phase"
                           :class="{
                               'connect-topbar__phase--active': phaseState(phase.key) === 'active',
                               'connect-topbar__phase--done': phaseState(phase.key) === 'done',
                               'connect-topbar__phase--upcoming': phaseState(phase.key) === 'upcoming',
                               'connect-topbar__phase--clickable': isPhaseClickable(phase.key)
                           }"
                           @click="navigateToPhase(phase.key)">
                            <span v-if="phaseState(phase.key) === 'done'" class="material-symbols-outlined" style="font-size:14px;font-variation-settings:'FILL' 1;">check_circle</span>
                            {{ phase.label }}
                        </span>
                    </nav>
                    <!-- All diagnostics complete badge (Stitch F6) -->
                    <div v-if="activePhase === 'pricing'" class="flex items-center gap-2 bg-[#00696A]/20 px-3 py-1 rounded-full ml-4">
                        <span class="material-symbols-outlined text-[#01DFE1] text-[14px]" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                        <span class="text-[12px] font-semibold text-[#01DFE1] tracking-wide">All diagnostics complete</span>
                    </div>
                </div>
                <div class="connect-topbar__right">
                    <div class="connect-topbar__timer">
                        <span class="material-symbols-outlined connect-topbar__timer-icon">timer</span>
                        <span>{{ timerLabel }}</span>
                    </div>
                    <div class="text-right flex flex-col justify-center mr-4" v-if="uuid">
                        <span class="text-white text-[9px] font-bold leading-none tracking-widest uppercase">Session ID</span>
                        <span class="technical-font text-[#00e5ff] text-[13px] font-bold leading-tight">FX-{{ displaySessionId }}</span>
                    </div>
                    <button class="connect-topbar__cancel" @click="$emit('cancel-session')">
                        Cancel Session
                    </button>
                </div>
            </header>

            <!-- ========== MAIN CONTENT ========== -->
            <AuthenticityView v-if="activePhase === 'authenticity'" :uuid="uuid" @go-back="$emit('go-back')" @navigate-phase="(p) => $emit('navigate-phase', p)" />
            <HardwareTestView v-else-if="activePhase === 'hardware'" :uuid="uuid" @go-back="$emit('go-back')" @navigate-phase="(p) => $emit('navigate-phase', p)" />
            <CosmeticView v-else-if="activePhase === 'cosmetic'" :uuid="uuid" @go-back="$emit('go-back')" @navigate-phase="(p) => $emit('navigate-phase', p)" />
            <PricingView v-else-if="activePhase === 'pricing'" :uuid="uuid" @go-back="$emit('go-back')" @navigate-phase="(p) => $emit('navigate-phase', p)" />
            <main v-else class="connect-main">
                <!-- LEFT PANEL -->
                <aside class="connect-left">
                    <div class="connect-left__header">
                        <h2 class="connect-left__title">Connect Device</h2>
                        <p class="connect-left__subtitle">Plug in the iPhone to begin diagnostic scan.</p>
                    </div>

                    <!-- Diagnostic Status Ring -->
                    <div class="connect-ring-wrap">
                        <div class="connect-ring">
                            <svg class="connect-ring__svg" viewBox="0 0 128 128">
                                <circle cx="64" cy="64" r="58" fill="transparent"
                                        stroke="#E2E8F0" stroke-width="6"/>
                                <circle cx="64" cy="64" r="58" fill="transparent"
                                        stroke="url(#connectGradient)"
                                        stroke-width="6"
                                        stroke-linecap="round"
                                        :stroke-dasharray="ringCircumference"
                                        :stroke-dashoffset="ringOffset"
                                        class="connect-ring__progress"/>
                                <defs>
                                    <linearGradient id="connectGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#711FFF"/>
                                        <stop offset="100%" stop-color="#01DFE1"/>
                                    </linearGradient>
                                </defs>
                            </svg>
                            <span class="material-symbols-outlined connect-ring__icon">usb</span>
                        </div>
                    </div>

                    <!-- Info Banner -->
                    <div class="connect-banner" :class="'connect-banner--' + bannerType">
                        <span class="material-symbols-outlined connect-banner__icon">
                            {{ bannerType === 'success' ? 'check_circle' : 'info' }}
                        </span>
                        <p class="connect-banner__text">{{ bannerMessage }}</p>
                    </div>

                    <!-- Preparation Checklist -->
                    <div class="connect-checklist">
                        <p class="connect-checklist__heading">Preparation Checklist</p>
                        <div v-for="(item, i) in checklist" :key="i" class="connect-checklist__item">
                            <span class="material-symbols-outlined connect-checklist__icon"
                                  :class="item.done ? 'connect-checklist__icon--done' : ''"
                                  :style="checkIconStyle(item.done)">
                                {{ item.done ? 'check_circle' : 'radio_button_unchecked' }}
                            </span>
                            <span class="connect-checklist__label">{{ item.label }}</span>
                        </div>
                    </div>
                </aside>

                <!-- RIGHT PANEL -->
                <section class="connect-right">
                    <div class="connect-right__content">
                        <!-- Hero icon -->
                        <div class="connect-right__hero-icon">
                            <span class="material-symbols-outlined">usb</span>
                        </div>

                        <h3 class="connect-right__heading">
                            {{ deviceDetected ? 'Device Connected' : 'Awaiting Connection' }}
                        </h3>
                        <p class="connect-right__desc">
                            Connect the device using an Apple-certified Lightning or USB-C cable.
                            Ensure the port is free of debris for a stable diagnostic link.
                        </p>

                        <!-- Time badge -->
                        <div class="connect-right__time-badge">
                            <span class="material-symbols-outlined">schedule</span>
                            <span>Under 3 minutes estimated</span>
                        </div>

                        <!-- Action area -->
                        <div class="connect-right__actions">
                            <!-- If device detected, show proceed; else show simulate -->
                            <button v-if="deviceDetected"
                                    class="connect-right__btn connect-right__btn--primary"
                                    @click="$emit('device-detected', firstDevice)">
                                <span class="material-symbols-outlined">play_arrow</span>
                                Begin Assessment
                            </button>
                            <button v-else
                                    class="connect-right__btn connect-right__btn--primary"
                                    @click="$emit('device-detected', null)">
                                <span class="material-symbols-outlined">usb</span>
                                Simulate Device Detected
                            </button>

                            <p class="connect-right__port-label">{{ portLabel }}</p>
                        </div>
                    </div>

                    <!-- Blueprint visual (CSS-only placeholder) -->
                    <div class="connect-right__blueprint">
                        <svg class="connect-right__blueprint-svg" viewBox="0 0 200 360" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="20" y="10" width="160" height="340" rx="24" stroke="currentColor" stroke-width="1" opacity="0.3"/>
                            <rect x="30" y="50" width="140" height="260" rx="4" stroke="currentColor" stroke-width="0.5" opacity="0.2"/>
                            <circle cx="100" cy="335" r="8" stroke="currentColor" stroke-width="0.5" opacity="0.2"/>
                            <line x1="75" y1="25" x2="125" y2="25" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.3"/>
                            <!-- Internal "circuit" lines -->
                            <line x1="50" y1="100" x2="150" y2="100" stroke="currentColor" stroke-width="0.3" opacity="0.15"/>
                            <line x1="50" y1="150" x2="150" y2="150" stroke="currentColor" stroke-width="0.3" opacity="0.15"/>
                            <line x1="50" y1="200" x2="150" y2="200" stroke="currentColor" stroke-width="0.3" opacity="0.15"/>
                            <line x1="50" y1="250" x2="150" y2="250" stroke="currentColor" stroke-width="0.3" opacity="0.15"/>
                            <rect x="60" y="110" width="30" height="20" rx="2" stroke="currentColor" stroke-width="0.3" opacity="0.12"/>
                            <rect x="110" y="110" width="30" height="20" rx="2" stroke="currentColor" stroke-width="0.3" opacity="0.12"/>
                            <rect x="60" y="160" width="80" height="30" rx="2" stroke="currentColor" stroke-width="0.3" opacity="0.12"/>
                            <rect x="70" y="210" width="60" height="25" rx="2" stroke="currentColor" stroke-width="0.3" opacity="0.12"/>
                            <circle cx="100" cy="280" r="12" stroke="currentColor" stroke-width="0.3" opacity="0.12"/>
                        </svg>
                    </div>
                </section>
            </main>

            <!-- ========== FOOTER ========== -->
            <footer class="connect-footer">
                <div class="connect-footer__left">
                    <span class="connect-footer__meta">ENGINE VERSION: {{ engineVersion }}</span>
                    <span class="connect-footer__meta">SECURE TUNNEL: ACTIVE</span>
                </div>
                <div class="connect-footer__right">
                    <span class="connect-footer__dot" :class="systemReady ? 'connect-footer__dot--online' : 'connect-footer__dot--offline'"></span>
                    <span class="connect-footer__status">{{ systemReady ? 'System Ready' : 'System Error' }}</span>
                </div>
            </footer>
        </div>
    `
};
