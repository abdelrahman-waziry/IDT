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
        const { ref, computed, onMounted, watch } = Vue;
        const auth = window.useAuthenticity();
        const session = window.useSession();
        const deviceData = ref(null);
        const showSuccessToast = ref(false);

        // Only show success toast when ALL parts are genuinely verified
        // 'unverifiable' overall verdict does NOT count as success
        watch(() => auth.state.value === 'result' && auth.isAllGenuine.value, (isSuccess) => {
            if (isSuccess) {
                showSuccessToast.value = true;
                setTimeout(() => { showSuccessToast.value = false; }, 5000);
            }
        }, { immediate: true });

        onMounted(async () => {
            console.log('[AuthenticityView] Mounted for UUID:', props.uuid);

            try {
                const device = await Promise.race([
                    window.IDT.devices.get(props.uuid),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
                ]);
                if (device) deviceData.value = device;
            } catch (err) {
                console.warn('[AuthenticityView] Could not load device info:', err.message);
            }

            const existingSession = session.currentSession.value;
            if (existingSession?.data?.authenticity) {
                console.log('[AuthenticityView] Restoring cached authenticity data');
                auth.restore(existingSession.data.authenticity);
                return;
            }

            if (props.uuid) {
                try {
                    const result = await auth.scan(props.uuid);
                    if (result) {
                        await session.updatePhaseData('authenticity', result);
                    }
                } catch (err) {
                    console.error('[AuthenticityView] Scan error:', err);
                }
            }
        });

        const goHome = () => {
            emit('go-back');
            window.location.hash = '#/';
        };

        const proceedToHardware = () => emit('navigate-phase', 'hardware');
        const cancelSession = () => goHome();

        const deviceModel = computed(() =>
            deviceData.value?.ModelName || deviceData.value?.Model || 'Unknown Device'
        );

        const imei = computed(() => deviceData.value?.IMEI || 'Unknown IMEI');

        // Deep scan availability — new field from updated authenticity-service
        const deepDataUsed = computed(() =>
            auth.result.value?.deepDataUsed === true
        );

        // Score: only count components that have a definitive verdict
        // unverified components are excluded — they are not failures
        const scorePercent = computed(() => {
            if (auth.state.value !== 'result' || !auth.result.value) return 0;
            const trail = auth.result.value.auditTrail || [];
            const definitive = trail.filter(p =>
                !['unverified', 'restricted'].includes(p.status)
            );
            if (definitive.length === 0) return 0;
            const passed = definitive.filter(p =>
                ['genuine', 'used'].includes(p.status)
            ).length;
            return Math.round((passed / definitive.length) * 100);
        });

        // Summary counts for the badge
        const scoreSummary = computed(() => {
            if (auth.state.value !== 'result' || !auth.result.value) {
                return { passed: 0, flagged: 0, unverified: 0, total: 0 };
            }
            const trail = auth.result.value.auditTrail || [];
            const passed = trail.filter(p => ['genuine', 'used'].includes(p.status)).length;
            const flagged = trail.filter(p => ['mismatch', 'unknown', 'not_detected', 'unpaired_genuine'].includes(p.status)).length;
            const unverified = trail.filter(p => ['unverified', 'restricted'].includes(p.status)).length;
            return { passed, flagged, unverified, total: trail.length };
        });

        const ringCircumference = 2 * Math.PI * 110;
        const ringOffset = computed(() => {
            const pct = scorePercent.value / 100;
            return ringCircumference - (pct * ringCircumference);
        });

        const ringColor = computed(() => {
            if (scorePercent.value === 100) return '#00e5ff';
            if (scorePercent.value >= 70) return '#f59e0b';
            return '#ef4444';
        });

        const imeiStatus = computed(() => {
            if (!auth.result.value) return 'PENDING';
            return auth.result.value.isVerificationFailed ? 'MISMATCH' : 'MATCHED';
        });

        // Overall verdict label for the score ring
        const overallLabel = computed(() => {
            if (auth.state.value !== 'result' || !auth.result.value) return '—';
            const v = auth.result.value.overallVerdict;
            if (v === 'all_genuine') return 'VERIFIED';
            if (v === 'parts_flagged') return 'FLAGGED';
            if (v === 'unverifiable') return 'LIMITED';
            if (v === 'unable_to_determine') return 'ERROR';
            return v.toUpperCase();
        });

        const overallLabelColor = computed(() => {
            const v = auth.result.value?.overallVerdict;
            if (v === 'all_genuine') return 'text-[#008f99]';
            if (v === 'unverifiable') return 'text-[#f59e0b]';
            return 'text-[#ef4444]';
        });

        // Part rows
        const partRows = computed(() => {
            if (!auth.auditTrailBadges?.value) return [];

            const iconMap = {
                'logic board': 'memory',
                'display': 'display_settings',
                'battery': 'battery_full',
                'rear camera': 'photo_camera',
                'front camera': 'camera_front',
                'camera': 'photo_camera',
                'taptic engine': 'vibration',
                'main speaker': 'speaker',
                'receiver': 'speaker_phone',
                'microphone': 'mic',
                'connector': 'cable',
                'biometrics': 'fingerprint',
                'rear glass': 'crop_portrait'
            };

            // Added 'unverified' and 'restricted' — shown in amber, not red
            const bgMap = {
                genuine: 'bg-white border-[#10b981]',
                unpaired_genuine: 'bg-white border-[#f59e0b]',
                restricted: 'bg-white border-[#d1d5db]',
                unverified: 'bg-white border-[#d1d5db]',
                used: 'bg-white border-[#3b82f6]',
                mismatch: 'bg-white border-[#ef4444]',
                unknown: 'bg-white border-[#ef4444]',
                not_detected: 'bg-white border-[#f97316]'
            };

            const iconBgMap = {
                genuine: 'bg-[#d1fae5] text-[#10b981]',
                unpaired_genuine: 'bg-[#fef3c7] text-[#f59e0b]',
                restricted: 'bg-[#f3f4f6] text-[#6b7280]',
                unverified: 'bg-[#f3f4f6] text-[#6b7280]',
                used: 'bg-[#dbeafe] text-[#3b82f6]',
                mismatch: 'bg-[#fee2e2] text-[#ef4444]',
                unknown: 'bg-[#fee2e2] text-[#ef4444]',
                not_detected: 'bg-[#ffedd5] text-[#f97316]'
            };

            const textMap = {
                genuine: 'text-[#10b981]',
                unpaired_genuine: 'text-[#f59e0b]',
                restricted: 'text-[#6b7280]',
                unverified: 'text-[#6b7280]',
                used: 'text-[#3b82f6]',
                mismatch: 'text-[#ef4444]',
                unknown: 'text-[#ef4444]',
                not_detected: 'text-[#f97316]'
            };

            return auth.auditTrailBadges.value.map((part, index) => {
                const lowerName = part.component.toLowerCase();
                let icon = 'settings';
                for (const [key, val] of Object.entries(iconMap)) {
                    if (lowerName.includes(key)) { icon = val; break; }
                }

                // Use updated field names from authenticity-service.js
                // serial = what the device currently reports
                // factorySerial = what it should be (from service history or factory manifest)
                const factoryValue = part.factorySerial || 'N/A';
                const readValue = part.serial || 'N/A';

                // Highlight mismatch only when both values are real serials that differ
                const isMismatch = (
                    factoryValue !== readValue &&
                    factoryValue !== 'N/A' &&
                    readValue !== 'N/A'
                );

                const status = part.status || 'unverified';

                return {
                    id: index,
                    name: part.component,
                    icon,
                    factoryValue,
                    readValue,
                    message: part.message,
                    verdict: status,
                    verdictLabel: (part.badge?.label || status).toUpperCase(),
                    verdictIcon: part.badge?.icon || 'help',
                    rowClass: bgMap[status] || bgMap.unverified,
                    iconWrapClass: iconBgMap[status] || iconBgMap.unverified,
                    textClass: textMap[status] || textMap.unverified,
                    isMismatch
                };
            });
        });

        return {
            auth,
            deviceModel,
            imei,
            imeiStatus,
            deepDataUsed,
            scorePercent,
            scoreSummary,
            overallLabel,
            overallLabelColor,
            ringCircumference,
            ringOffset,
            ringColor,
            partRows,
            showSuccessToast,
            goHome,
            proceedToHardware,
            cancelSession,
            uuid: props.uuid
        };
    },
    template: `
        <div class="flex-1 flex flex-col w-full h-full overflow-hidden bg-[#f4f6f8] font-body text-[#191c1d] mt-10">

            <!-- Loading State -->
            <main v-if="auth.state.value === 'idle' || auth.state.value === 'scanning'"
                  class="flex-1 flex flex-col items-center justify-center p-10 h-full">
                <div class="flex flex-col items-center gap-6 text-center max-w-md">
                    <div class="relative w-32 h-32 flex items-center justify-center">
                        <svg class="w-full h-full transform -rotate-90 animate-spin" viewBox="0 0 128 128">
                            <circle class="text-gray-200" cx="64" cy="64" fill="transparent" r="56"
                                    stroke="currentColor" stroke-width="8"></circle>
                            <circle cx="64" cy="64" fill="transparent" r="56" stroke="#00e5ff"
                                    stroke-dasharray="351" stroke-dashoffset="100"
                                    stroke-linecap="round" stroke-width="8"></circle>
                        </svg>
                        <span class="material-symbols-outlined absolute text-4xl text-[#00e5ff]">search</span>
                    </div>
                    <h2 class="text-2xl font-bold text-[#111827]">Verifying Authenticity...</h2>
                    <p class="text-[#4b5563]">Querying device telemetry and verifying component serials securely.</p>
                </div>
            </main>

            <!-- Error State -->
            <main v-else-if="auth.state.value === 'error'"
                  class="flex-1 flex flex-col items-center justify-center p-10 h-full">
                <div class="flex flex-col items-center gap-6 text-center max-w-md bg-red-50 p-8 rounded-2xl border border-red-200">
                    <span class="material-symbols-outlined text-5xl text-red-500">error</span>
                    <h2 class="text-2xl font-bold text-red-700">Authenticity Scan Failed</h2>
                    <p class="text-red-600">{{ auth.error.value }}</p>
                    <div class="flex gap-3 mt-2">
                        <button @click="auth.scan(uuid)"
                                class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined">refresh</span>
                            Retry Scan
                        </button>
                        <button @click="proceedToHardware"
                                class="bg-[#4b5563] hover:bg-[#374151] text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-colors">
                            <span class="material-symbols-outlined">arrow_forward</span>
                            Proceed Anyway
                        </button>
                    </div>
                </div>
            </main>

            <!-- Result State -->
            <main v-else-if="auth.state.value === 'result'"
                  class="flex-1 flex flex-col md:flex-row p-6 md:p-10 gap-10 max-w-[1440px] mx-auto w-full overflow-hidden">

                <!-- Left Panel -->
                <section class="w-full md:w-[400px] flex flex-col gap-4 shrink-0">
                    <div class="bg-white p-6 rounded-[20px] flex flex-col items-center text-center shadow-sm relative">
                        <div class="absolute w-48 h-48 bg-cyan-50 rounded-full blur-3xl"></div>

                        <h2 class="text-[#3a4868] font-bold text-[13px] uppercase tracking-widest mb-4">
                            Authenticity Score
                        </h2>

                        <!-- Score Ring -->
                        <div class="relative w-52 h-52 flex items-center justify-center">
                            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 256 256">
                                <circle class="text-gray-100" cx="128" cy="128" fill="transparent"
                                        r="110" stroke="currentColor" stroke-width="16"></circle>
                                <circle cx="128" cy="128" fill="transparent" r="110"
                                        :stroke="ringColor"
                                        :stroke-dasharray="ringCircumference"
                                        :stroke-dashoffset="ringOffset"
                                        stroke-linecap="round" stroke-width="16"
                                        style="filter: drop-shadow(0px 0px 12px rgba(0,229,255,0.4)); transition: stroke-dashoffset 1s ease-out;">
                                </circle>
                            </svg>
                            <div class="absolute inset-0 flex flex-col items-center justify-center">
                                <span class="text-6xl font-black tracking-tighter text-[#111827]">
                                    {{ scorePercent }}
                                </span>
                                <span :class="['font-bold text-sm tracking-widest mt-[-4px]', overallLabelColor]">
                                    {{ overallLabel }}
                                </span>
                            </div>
                        </div>

                        <!-- Score Badge -->
                        <div class="mt-4 px-6 py-2.5 rounded-full flex items-center gap-2"
                             :class="scorePercent === 100
                                ? 'bg-[#e0fafa] text-[#008f99] border border-[#00e5ff]'
                                : (scorePercent >= 70
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : 'bg-red-50 text-red-600 border border-red-200')">
                            <span class="material-symbols-outlined text-[18px]"
                                  style="font-variation-settings: 'FILL' 1;">
                                {{ scorePercent === 100 ? 'verified' : (scorePercent >= 70 ? 'warning' : 'cancel') }}
                            </span>
                            <span class="font-bold text-[13px]">
                                {{ scoreSummary.passed }} passed
                                <template v-if="scoreSummary.flagged > 0"> · {{ scoreSummary.flagged }} flagged</template>
                                <template v-if="scoreSummary.unverified > 0"> · {{ scoreSummary.unverified }} unverified</template>
                            </span>
                        </div>

                        <div class="mt-5 w-full text-left space-y-3">
                            <div class="flex justify-between items-center p-4 bg-[#f8f9fb] rounded-xl">
                                <span class="text-[#4b5563] text-xs font-bold">DEVICE MODEL</span>
                                <span class="technical-font text-[14px] font-bold text-black">{{ deviceModel }}</span>
                            </div>
                            <div class="flex gap-3">
                                <div class="flex-1 flex flex-col items-start gap-1.5 p-4 bg-[#f8f9fb] rounded-xl">
                                    <span class="text-[#4b5563] text-xs font-bold">IMEI</span>
                                    <span class="technical-font text-[14px] font-bold"
                                          :class="imeiStatus === 'MATCHED' ? 'text-[#008f99]' : 'text-red-500'">
                                        {{ imeiStatus }}
                                    </span>
                                </div>
                                <!-- Deep scan indicator replaces unreliable seal status -->
                                <div class="flex-1 flex flex-col items-start gap-1.5 p-4 bg-[#f8f9fb] rounded-xl">
                                    <span class="text-[#4b5563] text-xs font-bold">SCAN DEPTH</span>
                                    <span class="technical-font text-[14px] font-bold"
                                          :class="deepDataUsed ? 'text-[#008f99]' : 'text-[#f59e0b]'">
                                        {{ deepDataUsed ? 'Deep' : 'Shallow' }}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Session Progress -->
                    <div class="flex items-start justify-between px-6 py-2 w-full">
                        <div class="flex flex-col items-center gap-2">
                            <div class="w-10 h-10 rounded-full bg-[#00e5ff] flex items-center justify-center text-white relative shadow-sm ring-4 ring-[#00e5ff]/20 shrink-0">
                                <span class="material-symbols-outlined text-[20px]"
                                      style="font-variation-settings: 'FILL' 1;">check</span>
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

                <!-- Right Panel: Results Table -->
                <section class="flex-1 flex flex-col pl-4 pb-4 h-full overflow-hidden">
                    <div class="flex justify-between items-end mb-8 shrink-0">
                        <div>
                            <h1 class="text-4xl font-extrabold text-[#111827] leading-tight">
                                Authenticity Report
                            </h1>
                            <p class="text-[#4b5563] text-[15px] mt-2 font-medium">
                                Component-level validation for internal serial matching.
                                <span v-if="!deepDataUsed"
                                      class="ml-2 text-amber-600 font-semibold">
                                    ⚠ Shallow scan — connect deeper for full pairing data
                                </span>
                            </p>
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

                    <div class="flex-1 overflow-auto max-h-[400px] bg-white rounded-[20px] shadow-sm border border-gray-100 mr-4 mb-4">
                        <table class="w-full text-left border-collapse">
                            <thead class="bg-white sticky top-0 z-10">
                                <tr>
                                    <th class="py-4 px-6 text-[11px] font-bold text-gray-400 uppercase tracking-[0.1em] w-[25%] border-b border-gray-100">
                                        Component
                                    </th>
                                    <th class="py-4 px-6 text-[11px] font-bold text-gray-400 uppercase tracking-[0.1em] w-[28%] border-b border-gray-100">
                                        Expected (Factory)
                                    </th>
                                    <th class="py-4 px-6 text-[11px] font-bold text-gray-400 uppercase tracking-[0.1em] w-[28%] border-b border-gray-100">
                                        Detected (Read)
                                    </th>
                                    <th class="py-4 px-6 text-[11px] font-bold text-gray-400 uppercase tracking-[0.1em] w-[19%] border-b border-gray-100 text-right">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-50">
                                <tr v-for="part in partRows" :key="part.id"
                                    class="hover:bg-[#f8f9fb] transition-colors">
                                    <td class="py-5 px-6">
                                        <div class="flex items-center gap-4">
                                            <div :class="['w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0', part.iconWrapClass]">
                                                <span class="material-symbols-outlined text-[18px]">{{ part.icon }}</span>
                                            </div>
                                            <span class="font-bold text-[#191c1d] text-[14px]">{{ part.name }}</span>
                                        </div>
                                    </td>
                                    <td class="py-5 px-6">
                                        <div class="inline-flex items-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
                                            <span class="technical-font text-[13px] text-gray-600 tracking-wide"
                                                  :class="part.isMismatch ? 'font-bold' : ''">
                                                {{ part.factoryValue }}
                                            </span>
                                        </div>
                                    </td>
                                    <td class="py-5 px-6">
                                        <div class="inline-flex items-center px-3 py-1.5 rounded-lg border"
                                             :class="part.isMismatch ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'">
                                            <span class="technical-font text-[13px] tracking-wide"
                                                  :class="part.isMismatch ? 'font-bold text-red-600' : 'text-gray-600'">
                                                {{ part.readValue }}
                                            </span>
                                        </div>
                                    </td>
                                    <td class="py-5 px-6">
                                        <div class="flex flex-col items-end gap-1">
                                            <div class="flex items-center gap-1.5">
                                                <span :class="['text-[11px] font-extrabold uppercase tracking-widest', part.textClass]">
                                                    {{ part.verdictLabel }}
                                                </span>
                                                <span :class="['material-symbols-outlined text-[18px]', part.textClass]"
                                                      style="font-variation-settings: 'FILL' 1;">
                                                    {{ part.verdictIcon }}
                                                </span>
                                            </div>
                                            <div v-if="part.verdict !== 'genuine' || (part.factoryValue === 'N/A' && part.readValue === 'N/A')"
                                                 class="text-[11px] text-gray-500 font-medium text-right max-w-[180px] leading-snug"
                                                 :title="part.message">
                                                {{ part.message }}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Unverifiable notice -->
                    <div v-if="auth.result.value?.overallVerdict === 'unverifiable'"
                         class="mx-4 mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 shrink-0">
                        <span class="material-symbols-outlined text-amber-500 shrink-0 mt-0.5">info</span>
                        <p class="text-amber-800 text-[13px] font-medium leading-snug">
                            This device has no repair history on record. Component authenticity cannot be
                            fully verified without Apple Repair Assistant or a deep IORegistry scan.
                            Results shown are from available telemetry only.
                        </p>
                    </div>

                    <div class="mt-2 flex justify-end shrink-0">
                        <button @click="proceedToHardware"
                                class="bg-[#5B4FE6] hover:bg-[#463BC9] text-white px-8 py-4 rounded-xl font-bold flex items-center gap-3 transition-all shadow-[0_8px_20px_rgba(91,79,230,0.3)] active:scale-95 text-[15px]">
                            <span>Proceed to Hardware Test</span>
                            <span class="material-symbols-outlined text-xl">arrow_forward</span>
                        </button>
                    </div>
                </section>
            </main>

            <!-- Success Toast -->
            <transition
                enter-active-class="transition duration-300 ease-out"
                enter-from-class="transform translate-y-2 opacity-0"
                enter-to-class="transform translate-y-0 opacity-100"
                leave-active-class="transition duration-300 ease-in"
                leave-from-class="transform translate-y-0 opacity-100"
                leave-to-class="transform translate-y-2 opacity-0">
                <div v-if="auth.state.value === 'result' && auth.isAllGenuine.value && showSuccessToast"
                     class="fixed bottom-10 right-10 bg-white border border-gray-100 px-6 py-4 rounded-2xl flex items-center gap-4 shadow-[0_10px_40px_rgba(0,0,0,0.08)] z-50">
                    <div class="w-10 h-10 bg-[#10b981] rounded-full flex items-center justify-center text-white">
                        <span class="material-symbols-outlined"
                              style="font-variation-settings: 'FILL' 1;">check_circle</span>
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