/**
 * Authenticity View
 * 
 * Standalone page for Authenticity Verification.
 * Implements the exact Stitch F3B design using Tailwind CSS (light mode).
 */

window.AppViews = window.AppViews || {};

window.AppViews.AuthenticityView = {
    name: 'AuthenticityView',
    props: {
        uuid: { type: String, required: true }
    },
    emits: ['go-back', 'navigate-phase'],
    setup(props, { emit }) {
        const { ref, computed, onMounted, onUnmounted, watch } = Vue;
        const auth = window.useAuthenticity();
        const session = window.useSession();
        const deviceData = ref(null);
        const showSuccessToast = ref(false);

        watch(() => auth.state.value === 'result' && auth.isAllGenuine.value, (isSuccess) => {
            if (isSuccess) {
                showSuccessToast.value = true;
                setTimeout(() => {
                    showSuccessToast.value = false;
                }, 5000);
            }
        }, { immediate: true });

        onMounted(async () => {
            console.log('[AuthenticityView] Mounted for UUID:', props.uuid);
            
            // First, load the device data with a short timeout to prevent hanging
            try {
                const device = await Promise.race([
                    window.IDT.devices.get(props.uuid),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Device metadata timeout')), 3000))
                ]);
                if (device) {
                    deviceData.value = device;
                }
            } catch (err) {
                console.warn('[AuthenticityView] Could not load device info (proceeding with UUID only):', err.message);
            }

            // Check if session already has authenticity data (tab revisit)
            const existingSession = session.currentSession.value;
            if (existingSession?.data?.authenticity) {
                console.log('[AuthenticityView] Restoring cached authenticity data');
                auth.restore(existingSession.data.authenticity);
                return;
            }

            // Start authenticity scan
            if (props.uuid) {
                console.log('[AuthenticityView] Initiating scan for:', props.uuid);
                try {
                    const result = await auth.scan(props.uuid);
                    if (result) {
                        console.log('[AuthenticityView] Scan success');
                        await session.updatePhaseData('authenticity', result);
                    } else {
                        console.warn('[AuthenticityView] Scan returned no result (likely timeout)');
                    }
                } catch (err) {
                    console.error('[AuthenticityView] Scan error caught in view:', err);
                }
            }
        });

        const goHome = () => {
            emit('go-back');
            window.location.hash = '#/';
        };

        const proceedToHardware = () => {
            emit('navigate-phase', 'hardware');
        };

        const cancelSession = () => {
            // Can be tied to a session API in the future
            goHome();
        };

        // Format device model and IMEI
        const deviceModel = computed(() => deviceData.value?.ModelName || deviceData.value?.Model || 'Unknown Device');
        const imei = computed(() => deviceData.value?.IMEI || 'Unknown IMEI');

        const sealStatus = computed(() => {
            if (auth.state.value !== 'result' || !auth.result.value) return 'Pending';
            return auth.result.value.sealStatus || 'Pending';
        });

        // Score computation
        const scorePercent = computed(() => {
            if (auth.state.value !== 'result' || !auth.result.value) return 0;
            const s = auth.summary.value;
            if (s.total === 0) return 0;
            return Math.round((s.genuine / s.total) * 100);
        });

        const ringCircumference = 2 * Math.PI * 110; // ~691
        const ringOffset = computed(() => {
            const pct = scorePercent.value / 100;
            return ringCircumference - (pct * ringCircumference);
        });

        // IMEI verification status
        const imeiStatus = computed(() => {
            if (!auth.result.value) return 'PENDING';
            return auth.result.value.isVerificationFailed ? 'MISMATCH' : 'MATCHED';
        });

        // Part rows mapped to the new image design
        const partRows = computed(() => {
            if (!auth.auditTrailBadges.value) return [];

            const iconMap = {
                'logic board': 'memory',
                'display': 'display_settings',
                'battery': 'battery_full',
                'camera': 'photo_camera',
                'rear camera': 'photo_camera',
                'front camera': 'camera_front',
                'taptic engine': 'vibration',
                'main speaker': 'speaker',
                'receiver': 'speaker_phone',
                'microphone': 'mic',
                'connector': 'cable',
                'biometrics': 'fingerprint',
                'rear glass': 'crop_portrait'
            };

            const bgMap = {
                genuine: 'bg-white border-[#10b981]',
                unpaired_genuine: 'bg-white border-[#ef4444]',
                restricted: 'bg-white border-[#10b981]',
                used: 'bg-white border-[#3b82f6]',
                mismatch: 'bg-white border-[#ef4444]',
                unknown: 'bg-white border-[#ef4444]',
                not_detected: 'bg-white border-[#f97316]'
            };

            const iconBgMap = {
                genuine: 'bg-[#d1fae5] text-[#10b981]',
                unpaired_genuine: 'bg-[#fee2e2] text-[#ef4444]',
                restricted: 'bg-[#d1fae5] text-[#10b981]',
                used: 'bg-[#dbeafe] text-[#3b82f6]',
                mismatch: 'bg-[#fee2e2] text-[#ef4444]',
                unknown: 'bg-[#fee2e2] text-[#ef4444]',
                not_detected: 'bg-[#ffedd5] text-[#f97316]'
            };

            const textMap = {
                genuine: 'text-[#10b981]',
                unpaired_genuine: 'text-[#ef4444]',
                restricted: 'text-[#10b981]',
                used: 'text-[#3b82f6]',
                mismatch: 'text-[#ef4444]',
                unknown: 'text-[#ef4444]',
                not_detected: 'text-[#f97316]'
            };

            return auth.auditTrailBadges.value.map((part, index) => {
                const lowerName = part.component.toLowerCase();
                let icon = 'settings';
                for (const [key, val] of Object.entries(iconMap)) {
                    if (lowerName.includes(key)) {
                        icon = val;
                        break;
                    }
                }

                let subtitle = `SN: ${part.serial}`;
                if (part.message) {
                    subtitle += ` — ${part.message}`;
                }

                return {
                    id: index,
                    name: part.component,
                    icon: icon,
                    subtitle: subtitle,
                    verdict: part.status,
                    verdictLabel: part.badge.label.toUpperCase(),
                    verdictIcon: part.badge.icon,
                    rowClass: bgMap[part.status] || bgMap.unknown,
                    iconWrapClass: iconBgMap[part.status] || iconBgMap.unknown,
                    textClass: textMap[part.status] || textMap.unknown
                };
            });
        });

        return {
            auth,
            deviceModel,
            imeiStatus,
            scorePercent,
            ringCircumference,
            ringOffset,
            partRows,
            sealStatus,
            showSuccessToast,
            goHome,
            proceedToHardware,
            cancelSession,
            uuid: props.uuid
        };
    },
    template: `
        <div class="flex-1 flex flex-col w-full h-full overflow-hidden bg-[#f4f6f8] font-body text-[#191c1d] mt-10">
            <!-- Loading / Error States -->
            <main v-if="auth.state.value === 'idle' || auth.state.value === 'scanning'" class="flex-1 flex flex-col items-center justify-center p-10 h-full">
                <div class="flex flex-col items-center gap-6 text-center max-w-md">
                    <div class="relative w-32 h-32 flex items-center justify-center">
                        <svg class="w-full h-full transform -rotate-90 animate-spin" viewBox="0 0 128 128">
                            <circle class="text-gray-200" cx="64" cy="64" fill="transparent" r="56" stroke="currentColor" stroke-width="8"></circle>
                            <circle class="cyan-glow" cx="64" cy="64" fill="transparent" r="56" stroke="#00e5ff" stroke-dasharray="351" stroke-dashoffset="100" stroke-linecap="round" stroke-width="8"></circle>
                        </svg>
                        <span class="material-symbols-outlined absolute text-4xl text-[#00e5ff]">search</span>
                    </div>
                    <h2 class="text-2xl font-bold text-[#111827]">Verifying Authenticity...</h2>
                    <p class="text-[#4b5563]">Querying device telemetry and verifying component serials securely.</p>
                </div>
            </main>

            <main v-else-if="auth.state.value === 'error'" class="flex-1 flex flex-col items-center justify-center p-10 h-full">
                <div class="flex flex-col items-center gap-6 text-center max-w-md bg-red-50 p-8 rounded-2xl border border-red-200">
                    <span class="material-symbols-outlined text-5xl text-red-500">error</span>
                    <h2 class="text-2xl font-bold text-red-700">Authenticity Scan Failed</h2>
                    <p class="text-red-600">{{ auth.error.value }}</p>
                    <div class="flex gap-3 mt-2">
                        <button @click="auth.scan(uuid)" class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined">refresh</span>
                            Retry Scan
                        </button>
                        <button @click="proceedToHardware" class="bg-[#4b5563] hover:bg-[#374151] text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined">arrow_forward</span>
                            Proceed Anyway
                        </button>
                    </div>
                </div>
            </main>

            <!-- Main Content Area (Result State) -->
            <main v-else-if="auth.state.value === 'result'" class="flex-1 flex flex-col md:flex-row p-6 md:p-10 gap-10 max-w-[1440px] mx-auto w-full overflow-hidden">
                <!-- Left Panel: Score & Summary -->
                <section class="w-full md:w-[400px] flex flex-col gap-4 shrink-0">
                    <div class="bg-white p-6 rounded-[20px] flex flex-col items-center text-center shadow-sm relative">
                        <!-- Decorative background elements -->
                        <div class="absolute w-48 h-48 bg-cyan-50 rounded-full blur-3xl"></div>
                        
                        <h2 class="text-[#3a4868] font-bold text-[13px] uppercase tracking-widest mb-4">Authenticity Score</h2>
                        
                        <!-- Score Ring -->
                        <div class="relative w-52 h-52 flex items-center justify-center">
                            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 256 256">
                                <circle class="text-gray-100" cx="128" cy="128" fill="transparent" r="110" stroke="currentColor" stroke-width="16"></circle>
                                <circle class="cyan-glow" cx="128" cy="128" fill="transparent" r="110" :stroke="scorePercent === 100 ? '#00e5ff' : (scorePercent >= 50 ? '#f59e0b' : '#ef4444')" :stroke-dasharray="ringCircumference" :stroke-dashoffset="ringOffset" stroke-linecap="round" stroke-width="16" style="filter: drop-shadow(0px 0px 12px rgba(0, 229, 255, 0.4)); transition: stroke-dashoffset 1s ease-out;"></circle>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span class="text-6xl font-black tracking-tighter text-[#111827]">{{ scorePercent }}</span>
                                <span class="text-[#4b5563] font-bold text-sm tracking-widest mt-[-4px]">{{ scorePercent === 100 ? 'VERIFIED' : 'FLAGGED' }}</span>
                            </div>
                        </div>
                        
                        <div class="mt-4 px-6 py-2.5 bg-[#e0fafa] text-[#008f99] border border-[#00e5ff] rounded-full flex items-center gap-2" :class="scorePercent === 100 ? '' : 'bg-red-50 text-red-600 border-red-200'">
                            <span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' 1;">{{ scorePercent === 100 ? 'verified' : 'warning' }}</span>
                            <span class="font-bold text-[13px]">{{ auth.summary.value.genuine }} of {{ auth.summary.value.total }} Passed</span>
                        </div>
                        
                        <div class="mt-5 w-full text-left space-y-3">
                            <div class="flex justify-between items-center p-4 bg-[#f8f9fb] rounded-xl">
                                <span class="text-[#4b5563] text-xs font-bold">DEVICE MODEL</span>
                                <span class="technical-font text-[14px] font-bold text-black">{{ deviceModel }}</span>
                            </div>
                            <div class="flex gap-3">
                                <div class="flex-1 flex flex-col items-start gap-1.5 p-4 bg-[#f8f9fb] rounded-xl">
                                    <span class="text-[#4b5563] text-xs font-bold">IMEI VERIFICATION</span>
                                    <span class="technical-font text-[14px] font-bold" :class="imeiStatus === 'MATCHED' ? 'text-[#008f99]' : 'text-red-500'">{{ imeiStatus }}</span>
                                </div>
                                <div class="flex-1 flex flex-col items-start gap-1.5 p-4 bg-[#f8f9fb] rounded-xl">
                                    <span class="text-[#4b5563] text-xs font-bold">SEAL INTEGRITY</span>
                                    <span class="technical-font text-[14px] font-bold" :class="sealStatus === 'Intact' ? 'text-[#008f99]' : (sealStatus === 'Compromised' ? 'text-[#ef4444]' : 'text-[#f59e0b]')">{{ sealStatus }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Session Status Progress -->
                    <div class="flex items-start justify-between px-6 py-2 w-full">
                        <div class="flex flex-col items-center gap-2">
                            <div class="w-10 h-10 rounded-full bg-[#00e5ff] flex items-center justify-center text-white relative shadow-sm ring-4 ring-[#00e5ff]/20 shrink-0">
                                <span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' 1;">check</span>
                            </div>
                            <span class="text-[10px] font-bold text-[#008f99] uppercase text-center">Auth</span>
                        </div>
                        <div class="flex-1 h-[2px] bg-[#e5e7eb] mx-2 mt-[19px]"></div>
                        <div class="flex flex-col items-center gap-2">
                            <div class="w-10 h-10 rounded-full bg-[#f3f4f6] flex items-center justify-center text-[#4b5563] shrink-0">
                                <span class="text-[14px] font-bold">2</span>
                            </div>
                            <span class="text-[10px] font-bold text-[#4b5563] uppercase text-center">Hardware</span>
                        </div>
                        <div class="flex-1 h-[2px] bg-[#e5e7eb] mx-2 mt-[19px]"></div>
                        <div class="flex flex-col items-center gap-2">
                            <div class="w-10 h-10 rounded-full bg-[#f3f4f6] flex items-center justify-center text-[#4b5563] shrink-0">
                                <span class="text-[14px] font-bold">3</span>
                            </div>
                            <span class="text-[10px] font-bold text-[#4b5563] uppercase text-center">Cosmetic</span>
                        </div>
                    </div>
                </section>

                <!-- Right Panel: Test Results List -->
                <section class="flex-1 flex flex-col pl-4 pb-4 h-full overflow-hidden">
                    <div class="flex justify-between items-end mb-8 shrink-0">
                        <div>
                            <h1 class="text-4xl font-extrabold text-[#111827] leading-tight">Authenticity Report</h1>
                            <p class="text-[#4b5563] text-[15px] mt-2 font-medium">Component-level validation for internal serial matching.</p>
                        </div>
                        <div class="flex gap-3">
                            <button class="w-12 h-12 bg-white text-[#4b5563] rounded-xl flex items-center justify-center shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
                                <span class="material-symbols-outlined text-[22px]">download</span>
                            </button>
                            <button class="w-12 h-12 bg-white text-[#4b5563] rounded-xl flex items-center justify-center shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
                                <span class="material-symbols-outlined text-[22px]">print</span>
                            </button>
                        </div>
                    </div>

                    <div class="flex flex-col gap-4 flex-1 overflow-y-auto max-h-[350px] pr-4 pb-4">
                        <!-- Test Rows -->
                        <div v-for="part in partRows" :key="part.id" :class="['p-4 rounded-xl flex items-center justify-between border-l-[6px] shadow-sm transition-all hover:translate-x-1 shrink-0', part.rowClass]">
                            <div class="flex items-center gap-6">
                                <div :class="['w-12 h-12 rounded-[10px] flex items-center justify-center', part.iconWrapClass]">
                                    <span class="material-symbols-outlined text-[22px]">{{ part.icon }}</span>
                                </div>
                                <div class="flex flex-col gap-1">
                                    <p class="font-bold text-[#111827] text-[14px] uppercase tracking-wide">{{ part.name }}</p>
                                    <p class="technical-font text-[13px] text-[#4b5563]">{{ part.subtitle }}</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <span :class="['text-[11px] font-bold uppercase tracking-wide', part.textClass]">{{ part.verdictLabel }}</span>
                                <span :class="['material-symbols-outlined text-[20px]', part.textClass]" style="font-variation-settings: 'FILL' 1;">{{ part.verdictIcon }}</span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-6 flex justify-end shrink-0">
                        <button @click="proceedToHardware" class="bg-[#5B4FE6] hover:bg-[#463BC9] text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-all shadow-[0_8px_20px_rgba(91,79,230,0.3)] active:scale-95 text-[15px]">
                            <span>Proceed to Hardware Test</span>
                            <span class="material-symbols-outlined text-xl">arrow_forward</span>
                        </button>
                    </div>
                </section>
            </main>

            <!-- Success Toast (Floating) -->
            <transition enter-active-class="transition duration-300 ease-out" enter-from-class="transform translate-y-2 opacity-0" enter-to-class="transform translate-y-0 opacity-100" leave-active-class="transition duration-300 ease-in" leave-from-class="transform translate-y-0 opacity-100" leave-to-class="transform translate-y-2 opacity-0">
                <div v-if="auth.state.value === 'result' && auth.isAllGenuine.value && showSuccessToast" class="fixed bottom-10 right-10 bg-white border border-gray-100 px-6 py-4 rounded-2xl flex items-center gap-4 shadow-[0_10px_40px_rgba(0,0,0,0.08)] animate-bounce-subtle z-50">
                    <div class="w-10 h-10 bg-[#10b981] rounded-full flex items-center justify-center text-white">
                        <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                    </div>
                    <div>
                        <p class="font-bold text-[#111827]">Validation Complete</p>
                        <p class="text-xs text-[#4b5563]">All primary identifiers are verified authentic.</p>
                    </div>
                </div>
            </transition>
        </div>
    `
};

