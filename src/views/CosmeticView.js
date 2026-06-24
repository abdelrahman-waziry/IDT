/**
 * CosmeticView
 *
 * F5: Cosmetic QR Handover — operator scans QR to begin the
 * cosmetic photo-verification process. Photos sync in real-time
 * from the mobile capture page and are graded via Claude Sonnet AI.
 *
 * Built with SCSS + BEM (no Tailwind).
 */

window.AppViews = window.AppViews || {};

window.AppViews.CosmeticView = {
    name: 'CosmeticView',
    props: {
        uuid: { type: String, required: true }
    },
    emits: ['go-back', 'navigate-phase'],
    setup(props, { emit }) {
        const { ref, computed, onMounted, onUnmounted, watch } = Vue;
        const cosmetic = window.useCosmetic();
        const session = window.useSession();

        const showResultsModal = ref(false);

        // Start session on mount (or restore from cache)
        onMounted(() => {
            const existingSession = session.currentSession.value;
            if (existingSession?.data?.cosmetic) {
                console.log('[CosmeticView] Restoring cached cosmetic data');
                cosmetic.restore(existingSession.data.cosmetic);
            } else {
                cosmetic.startSession(props.uuid);
            }
        });

        // Clean up on unmount
        onUnmounted(() => {
            // Only stop server if we're still in a capture session (not restored)
            if (cosmetic.sessionState.value !== 'graded') {
                cosmetic.stopSession();
            }
        });

        // ── Session Tag ──────────────────────────
        const sessionTag = computed(() => {
            const prefix = props.uuid ? props.uuid.substring(0, 4).toUpperCase() : '0000';
            return `#FX-${prefix}-PHOTO`;
        });

        const getScoreGrade = (score) => {
            if (score >= 95) return 'A+';
            if (score >= 85) return 'A';
            if (score >= 75) return 'B+';
            if (score >= 60) return 'B';
            if (score >= 40) return 'C';
            return 'D';
        };

        // ── Grade button handler ─────────────────
        const runGrading = async () => {
            const result = await cosmetic.gradePhotos(props.uuid);
            if (result) {
                window.ToastManager?.show(`Cosmetic grade: ${result.grade} — ${result.label}`, 'success');
                showResultsModal.value = true;
            }
        };

        const confirmAndProceed = async () => {
            if (cosmetic.gradeReport.value) {
                await session.updatePhaseData('cosmetic', cosmetic.gradeReport.value);
            }
            showResultsModal.value = false;
            emit('navigate-phase', 'pricing');
        };

        // ── Navigation ───────────────────────────
        const skipCosmetic = () => {
            emit('navigate-phase', 'pricing');
        };

        const proceedToPricing = () => {
            emit('navigate-phase', 'pricing');
        };

        return {
            cosmetic,
            sessionTag,
            runGrading,
            confirmAndProceed,
            getScoreGrade,
            showResultsModal,
            skipCosmetic,
            proceedToPricing,
            uuid: props.uuid
        };
    },
    template: `
        <div class="flex-1 flex flex-col w-full h-full bg-surface text-on-surface font-body selection:bg-primary-fixed overflow-hidden relative">
            <transition name="fade" mode="out-in">
                <div key="content" class="w-full h-full flex flex-col overflow-hidden bg-surface">
                    <!-- TopAppBar -->
                    <header class="flex-shrink-0 flex items-center justify-between px-6 bg-[#0F1E3C] h-[56px] shadow-2xl shadow-black/20 relative z-50">
                        <div class="flex items-center gap-4">
                            <span class="text-lg font-extrabold text-white tracking-tight">Fixtech Egypt</span>
                            <div class="h-4 w-[1px] bg-white/20"></div>
                            <span class="font-mono text-[12px] text-[#01DFE1] font-medium tracking-widest uppercase">Diagnostic Session</span>
                        </div>
                        <div class="flex items-center gap-6">
                            <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 hidden sm:flex">
                                <span class="material-symbols-outlined text-[18px] text-white/60">timer</span>
                                <span class="font-mono text-white text-sm">--:--:--</span>
                            </div>
                            <div class="flex items-center gap-4">
                                <span class="material-symbols-outlined text-white/40 hover:text-white cursor-pointer transition-colors hidden sm:block">info</span>
                                <button @click="$emit('go-back')" class="bg-error/10 text-error hover:bg-error/20 px-4 py-1.5 rounded-lg text-sm font-bold transition-all active:scale-95">
                                    Cancel Session
                                </button>
                            </div>
                        </div>
                    </header>

                    <!-- Main Scrollable Content -->
                    <main class="flex-grow overflow-y-auto w-full">
                        <div class="flex flex-col lg:flex-row h-full min-h-[calc(100vh-56px)]">
                            <!-- Left Panel: QR and Status -->
                            <aside class="w-full lg:w-[400px] flex-shrink-0 bg-surface-container-low flex flex-col p-8 border-r border-outline-variant/10 min-h-[600px]">
                                <div class="space-y-6 flex-grow flex flex-col">
                                    <div class="space-y-2">
                                        <h3 class="text-2xl font-bold text-on-surface tracking-tight leading-none">Hand Work Phone to Operator</h3>
                                        <p class="text-on-surface-variant leading-relaxed">Please pass the device to the cosmetic station operator. They will scan the QR code to begin the visual verification process.</p>
                                    </div>

                                    <!-- Amber Reminder -->
                                    <div class="flex items-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-200/50">
                                        <div class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-[pulse-amber_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"></div>
                                        <span class="text-amber-800 font-bold text-sm uppercase tracking-wide">Action Required: Unplug USB Cable</span>
                                    </div>

                                    <!-- Server Error -->
                                    <div v-if="cosmetic.error.value" class="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200/50 mt-4">
                                        <span class="material-symbols-outlined text-red-500">error</span>
                                        <span class="text-red-800 font-bold text-sm uppercase tracking-wide">{{ cosmetic.error.value }}</span>
                                    </div>

                                    <!-- QR Container -->
                                    <div class="mt-8 flex flex-col items-center">
                                        <div class="relative p-6 bg-white rounded-2xl shadow-xl shadow-black/5 border border-outline-variant/20">
                                            <div class="w-[200px] h-[200px] flex items-center justify-center bg-surface-container">
                                                <img v-if="cosmetic.qrDataUrl.value" :src="cosmetic.qrDataUrl.value" alt="Session QR Code" class="w-full h-full object-contain mix-blend-multiply" />
                                                <div v-else class="flex flex-col items-center gap-2">
                                                    <span class="material-symbols-outlined text-3xl text-slate-400">qr_code_2</span>
                                                    <span class="text-[11px] text-slate-400 font-mono tracking-widest uppercase">Starting Server...</span>
                                                </div>
                                            </div>
                                            <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-on-surface text-white rounded-full whitespace-nowrap shadow-md">
                                                <span class="font-mono text-xs font-medium tracking-tighter">{{ sessionTag }}</span>
                                            </div>
                                        </div>

                                        <!-- Server URL display -->
                                        <div v-if="cosmetic.serverUrl.value" class="mt-8 flex flex-col items-center gap-2 text-center w-full max-w-[280px]">
                                            <p class="font-mono text-[11px] text-on-surface-variant break-all">{{ cosmetic.serverUrl.value }}</p>
                                            <div v-if="cosmetic.localUrl.value && cosmetic.localUrl.value !== cosmetic.serverUrl.value" class="pt-3 border-t border-outline-variant/20 w-full mt-2">
                                                <p class="text-[10px] text-outline mb-1 uppercase font-bold tracking-widest">WiFi Fallback:</p>
                                                <p class="font-mono text-[10px] text-outline break-all">{{ cosmetic.localUrl.value }}</p>
                                            </div>
                                        </div>

                                        <div class="mt-8 flex flex-col items-center gap-3">
                                            <div class="flex items-center gap-2">
                                                <span class="relative flex h-3 w-3" v-if="cosmetic.sessionState.value === 'waiting'">
                                                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                                    <span class="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                                                </span>
                                                <span class="font-bold text-sm text-on-surface-variant uppercase tracking-widest text-center">
                                                    {{ cosmetic.sessionState.value === 'waiting' ? 'Waiting for Operator' :
                                                       cosmetic.sessionState.value === 'capturing' ? 'Receiving Photos' :
                                                       cosmetic.sessionState.value === 'grading' ? 'Grading Photos...' :
                                                       cosmetic.sessionState.value === 'graded' ? 'Grading Complete' :
                                                       cosmetic.sessionState.value === 'error' ? 'Error' : 'Initializing...' }}
                                                </span>
                                            </div>
                                            <p class="text-xs text-outline text-center">
                                                {{ cosmetic.sessionState.value === 'waiting' ? 'Session will auto-resume once scan is detected' :
                                                   cosmetic.sessionState.value === 'capturing' ? cosmetic.capturedCount.value + ' of ' + cosmetic.totalSlots.value + ' photos received' :
                                                   cosmetic.sessionState.value === 'grading' ? 'Analyzing photos via AI vision...' :
                                                   cosmetic.sessionState.value === 'graded' ? cosmetic.gradeReport.value?.label || 'Done' :
                                                   cosmetic.error.value || '' }}
                                            </p>
                                        </div>
                                    </div>

                                    <div class="flex-grow"></div>

                                    <!-- Grade Button (when photos are in) -->
                                    <div class="mt-8" v-if="cosmetic.capturedCount.value > 0 && cosmetic.sessionState.value !== 'grading' && cosmetic.sessionState.value !== 'graded'">
                                        <button @click="runGrading" class="w-full h-[52px] bg-[#01DFE1] hover:brightness-105 text-[#004F50] rounded-xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-[0_4px_20px_rgba(1,223,225,0.3)]">
                                            <span class="material-symbols-outlined text-[18px]">auto_awesome</span>
                                            Grade {{ cosmetic.capturedCount.value }} Photo{{ cosmetic.capturedCount.value > 1 ? 's' : '' }} with AI
                                        </button>
                                    </div>

                                    <!-- Grade Result Card -->
                                    <div v-if="cosmetic.gradeReport.value" class="mt-6 bg-white p-5 rounded-xl border border-outline-variant/30 shadow-sm flex flex-col gap-4">
                                        <div class="flex justify-between items-center">
                                            <span class="text-3xl font-black font-headline tracking-tighter" :style="{ color: cosmetic.gradeReport.value.color }">{{ cosmetic.gradeReport.value.grade }}</span>
                                            <span class="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant bg-surface px-2 py-1 rounded">{{ cosmetic.gradeReport.value.label }}</span>
                                        </div>
                                        <p class="text-xs text-on-surface-variant leading-relaxed">{{ cosmetic.gradeReport.value.description }}</p>
                                        <div class="flex justify-between items-center text-sm font-bold pt-4 border-t border-outline-variant/20">
                                            <span class="text-slate-500">Overall Score</span>
                                            <span class="font-mono text-on-surface">{{ cosmetic.gradeReport.value.overallScore }}/100</span>
                                        </div>
                                        <button @click="showResultsModal = true" class="mt-2 text-[#01DFE1] font-bold text-[11px] uppercase tracking-widest text-center hover:underline bg-[#0F1E3C] py-2.5 rounded-lg shadow-sm w-full">View Detailed Breakdown</button>
                                    </div>
                                </div>

                                <!-- Skip Banner -->
                                <div class="mt-8" v-if="!cosmetic.gradeReport.value">
                                    <div class="p-4 bg-amber-100/50 rounded-2xl border border-amber-200 flex flex-col gap-3">
                                        <div class="flex items-start gap-3">
                                            <span class="material-symbols-outlined text-amber-700 text-[18px]">warning</span>
                                            <p class="text-[13px] text-amber-900 leading-snug">Skipping this step will mark the device as "Unverified" for cosmetic authenticity.</p>
                                        </div>
                                        <button @click="skipCosmetic" class="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg transition-colors text-sm shadow-sm active:scale-95">
                                            Skip Cosmetic Evaluation
                                        </button>
                                    </div>
                                </div>
                            </aside>

                            <!-- Right Panel: Photo Grid -->
                            <section class="flex-grow p-8 bg-surface">
                                <div class="max-w-5xl mx-auto space-y-8">
                                    <div class="flex items-baseline justify-between border-b border-outline-variant/10 pb-4">
                                        <h2 class="text-[1.75rem] font-bold text-on-surface tracking-tight">Cosmetic Photo Grid</h2>
                                        <span class="font-mono text-[11px] text-[#01DFE1] tracking-widest font-bold px-3 py-1.5 bg-[#0F1E3C] rounded-lg">LIVE_UPLOADS: {{ cosmetic.capturedCount.value }}/{{ cosmetic.totalSlots.value }}</span>
                                    </div>

                                    <!-- Bento Grid Layout -->
                                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                                        <template v-for="(slot, index) in cosmetic.photoSlots.value" :key="slot.key">
                                            <!-- Captured -->
                                            <div v-if="slot.status === 'captured'" class="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-surface-container-low border border-outline-variant/10 shadow-sm">
                                                <img class="w-full h-full object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all duration-500" :src="slot.url" :alt="slot.label" />
                                                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-80 group-hover:opacity-100 transition-opacity"></div>
                                                <div class="absolute top-3 right-3 bg-green-500 text-white rounded-full p-1 shadow-lg transform scale-90">
                                                    <span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                                                </div>
                                                <div class="absolute bottom-4 left-4">
                                                    <p class="text-white text-[10px] font-mono tracking-widest uppercase opacity-60">Angle 0{{ index + 1 }}</p>
                                                    <p class="text-white font-bold tracking-wide">{{ slot.label }}</p>
                                                </div>
                                            </div>

                                            <!-- Syncing -->
                                            <div v-else-if="slot.status === 'syncing'" class="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-primary/5 border-2 border-primary/40 border-dashed">
                                                <div class="absolute inset-0 flex flex-col items-center justify-center gap-4">
                                                    <div v-if="!cosmetic.isPaused.value" class="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                                                    <span v-else class="material-symbols-outlined text-4xl text-amber-500">pause_circle</span>

                                                    <div class="text-center px-4">
                                                        <p class="font-bold text-sm" :class="cosmetic.isPaused.value ? 'text-amber-700' : 'text-primary'">{{ cosmetic.isPaused.value ? 'Sync Paused' : 'Syncing...' }}</p>
                                                        <p class="font-mono text-[10px] uppercase mt-1 truncate max-w-full" :class="cosmetic.isPaused.value ? 'text-amber-700/60' : 'text-primary/60'">{{ cosmetic.isPaused.value ? 'Waiting' : slot.syncFile || 'Receiving...' }}</p>
                                                    </div>
                                                </div>
                                                <div class="absolute bottom-4 left-4">
                                                    <p class="text-[10px] font-mono tracking-widest uppercase" :class="cosmetic.isPaused.value ? 'text-amber-700/60' : 'text-primary/60'">Angle 0{{ index + 1 }}</p>
                                                    <p class="font-bold tracking-wide" :class="cosmetic.isPaused.value ? 'text-amber-800' : 'text-primary'">{{ slot.label }}</p>
                                                </div>
                                            </div>

                                            <!-- Empty -->
                                            <div v-else class="group aspect-[3/4] rounded-2xl border-2 border-outline-variant/30 border-dashed flex flex-col items-center justify-center gap-2 bg-surface-container-lowest hover:bg-surface-container-low transition-colors cursor-default">
                                                <span class="material-symbols-outlined text-outline/40 text-3xl group-hover:scale-110 transition-transform">add_a_photo</span>
                                                <div class="flex flex-col items-center gap-1">
                                                    <p class="text-outline text-[10px] font-mono uppercase tracking-widest">Angle 0{{ index + 1 }}</p>
                                                    <p class="text-outline text-xs font-bold uppercase tracking-widest text-center px-2">{{ slot.label }}</p>
                                                </div>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </main>

                    <!-- BottomNavBar (Mobile) -->
                    <nav class="md:hidden flex-shrink-0 bg-white/90 border-t border-slate-100 flex justify-around items-center h-[64px] relative z-50 backdrop-blur-md pb-safe">
                        <div @click="$emit('navigate-phase', 'authenticity')" class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer hover:text-slate-600 transition-colors">
                            <span class="material-symbols-outlined">verified</span>
                            <span class="text-[10px] font-semibold tracking-wider uppercase">Auth</span>
                        </div>
                        <div @click="$emit('navigate-phase', 'hardware')" class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer hover:text-slate-600 transition-colors">
                            <span class="material-symbols-outlined">memory</span>
                            <span class="text-[10px] font-semibold tracking-wider uppercase">Hardware</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 text-[#01DFE1] cursor-pointer">
                            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">potted_plant</span>
                            <span class="text-[10px] font-bold tracking-wider uppercase">Cosmetic</span>
                        </div>
                        <div @click="$emit('navigate-phase', 'pricing')" class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer hover:text-slate-600 transition-colors">
                            <span class="material-symbols-outlined">payments</span>
                            <span class="text-[10px] font-semibold tracking-wider uppercase">Pricing</span>
                        </div>
                    </nav>
                </div>
            </transition>

            <!-- RESULTS MODAL OVERLAY (Stitch Integration) -->
            <transition name="fade">
                <div v-if="showResultsModal && cosmetic.gradeReport.value" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-8 font-body">
                    <div class="w-full max-w-[1200px] h-[85vh] bg-surface rounded-2xl shadow-2xl flex overflow-hidden border border-outline-variant/30 text-on-surface relative m-auto">

                        <!-- Close Button -->
                        <button @click="showResultsModal = false" class="absolute top-4 right-4 z-10 w-10 h-10 bg-surface hover:bg-surface-container rounded-full flex items-center justify-center text-on-surface-variant transition-colors shadow-sm">
                            <span class="material-symbols-outlined">close</span>
                        </button>

                        <!-- Left Panel: Diagnostics & Grading -->
                        <aside class="w-[350px] flex-shrink-0 bg-surface-container-low flex flex-col overflow-y-auto border-r border-outline-variant/20">
                            <div class="p-8 flex flex-col gap-8 h-full">
                                <!-- Grade Summary Card -->
                                <section class="flex flex-col items-center gap-4">
                                    <div class="w-20 h-20 bg-gradient-to-br from-[#711FFF] to-[#01DFE1] rounded-xl flex items-center justify-center shadow-[0_4px_20px_rgba(113,31,255,0.3)]">
                                        <span class="text-white text-4xl font-headline font-extrabold">{{ cosmetic.gradeReport.value.grade }}</span>
                                    </div>
                                    <div class="text-center">
                                        <p class="font-mono text-[#00696A] bg-[#01DFE1]/10 px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase">Confidence: {{ cosmetic.gradeReport.value.overallScore }}%</p>
                                        <p class="text-on-surface-variant text-xs mt-2 font-medium">AI Diagnostic Calculation</p>
                                    </div>
                                </section>

                                <!-- Surface Breakdown -->
                                <section class="flex flex-col gap-4">
                                    <h3 class="font-headline font-bold text-xs uppercase tracking-widest text-on-surface-variant px-1 border-b border-outline-variant/20 pb-2">Surface Breakdown</h3>
                                    <div class="flex flex-col gap-2">
                                        <div v-for="scoreItem in cosmetic.gradeReport.value.imageScores" :key="scoreItem.view" class="bg-surface-container-lowest p-4 rounded-xl flex justify-between items-center shadow-sm border border-outline-variant/10">
                                            <span class="font-headline font-semibold text-[13px] capitalize">{{ scoreItem.view.replace(/_/g, ' ') }}</span>
                                            <div class="flex items-center gap-3">
                                                <span class="font-mono text-xs text-outline font-bold">AI:</span>
                                                <span class="font-mono font-black" :class="scoreItem.score >= 75 ? 'text-[#00696A]' : (scoreItem.score >= 60 ? 'text-amber-600' : 'text-error')">{{ getScoreGrade(scoreItem.score) }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <!-- Operator Override -->
                                <section class="bg-white rounded-xl p-5 shadow-md border border-outline-variant/10 mt-auto">
                                    <h4 class="font-headline font-bold text-[13px] mb-4 text-[#0F1E3C]">Operator Override</h4>
                                    <div class="grid grid-cols-4 gap-2">
                                        <button class="h-10 border border-outline-variant/30 rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">A</button>
                                        <button class="h-10 bg-[#0F1E3C] text-white rounded-lg font-mono font-bold shadow-sm">B</button>
                                        <button class="h-10 border border-outline-variant/30 rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">C</button>
                                        <button class="h-10 border border-outline-variant/30 rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">D</button>
                                    </div>
                                    <p class="text-[10px] text-outline mt-3 leading-relaxed italic">
                                        Manual selection will override AI pricing logic for this session.
                                    </p>
                                </section>
                            </div>
                        </aside>

                        <!-- Right Panel: Review & Action -->
                        <div class="flex-1 overflow-y-auto bg-surface relative">
                            <div class="max-w-3xl mx-auto p-12">
                                <div class="mb-10 pb-6 border-b border-outline-variant/10">
                                    <h2 class="text-[2rem] font-headline font-extrabold tracking-tight text-[#0F1E3C]">Cosmetic Grade Review</h2>
                                    <p class="text-on-surface-variant mt-2 text-sm">Validate machine assessment and provide operational context.</p>
                                </div>

                                <!-- AI Insights Bento Section -->
                                <div class="grid grid-cols-1 gap-8">
                                    <!-- Notes Card -->
                                    <div class="bg-blue-50/50 border border-blue-100 rounded-2xl p-8 flex gap-6 items-start">
                                        <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border border-blue-100/50">
                                            <span class="material-symbols-outlined text-blue-600" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
                                        </div>
                                        <div class="space-y-3 w-full">
                                            <h4 class="font-headline font-bold text-[17px] text-blue-900 tracking-tight">AI Diagnostic Notes</h4>
                                            <div class="text-blue-900/80 leading-relaxed text-[13px]">
                                                <p v-if="!cosmetic.gradeReport.value.defectSummary.length" class="font-medium">No significant defects detected by AI vision.</p>
                                                <ul v-else class="space-y-2 mb-3">
                                                    <li v-for="(defect, i) in cosmetic.gradeReport.value.defectSummary" :key="i" class="flex gap-2">
                                                        <span class="material-symbols-outlined text-[16px] text-blue-400 shrink-0 mt-0.5">info</span>
                                                        <span><strong><span class="capitalize">{{ defect.viewLabel }}</span> — {{ defect.type }} <span class="uppercase text-[10px] opacity-70 bg-blue-100 px-1 py-0.5 rounded ml-1">{{ defect.severity }}</span>:</strong> {{ defect.description }}</span>
                                                    </li>
                                                </ul>
                                                <p class="font-bold mt-4 text-blue-900 bg-blue-100/50 inline-block px-3 py-1.5 rounded-lg border border-blue-200/50">Recommendation: Proceed with Grade {{ cosmetic.gradeReport.value.grade }}.</p>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Operator Notes Area -->
                                    <div class="flex flex-col gap-3">
                                        <label class="font-headline font-bold text-[13px] text-on-surface flex items-center gap-2 tracking-wide uppercase">
                                            Session Remarks
                                            <span class="text-[10px] font-mono text-outline uppercase tracking-wider font-normal">(Optional)</span>
                                        </label>
                                        <textarea class="w-full bg-white border border-outline-variant/30 rounded-xl p-5 min-h-[120px] focus:ring-2 focus:ring-[#01DFE1]/50 focus:border-[#01DFE1] focus:outline-none font-body text-sm text-on-surface placeholder:text-outline/50 shadow-sm transition-all" placeholder="Add internal notes about cosmetic defects, lens clarity, or button tactile feel..."></textarea>
                                    </div>

                                    <!-- Action Footer -->
                                    <div class="pt-8 mt-2 flex items-center justify-between border-t border-outline-variant/10">
                                        <div class="flex items-center gap-4">
                                            <div class="w-10 h-10 rounded-full overflow-hidden bg-surface-container flex items-center justify-center border border-outline-variant/20">
                                                <span class="material-symbols-outlined text-outline">person</span>
                                            </div>
                                            <div class="flex flex-col">
                                                <span class="text-[10px] font-bold uppercase tracking-widest text-outline">Assigned Tech</span>
                                                <span class="text-sm font-mono text-on-surface font-bold">STATION_01</span>
                                            </div>
                                        </div>
                                        <button @click="confirmAndProceed" class="bg-[#01DFE1] hover:brightness-105 text-[#004F50] px-8 py-4 rounded-xl font-headline font-bold flex items-center gap-3 transition-all active:scale-95 shadow-[0_4px_20px_rgba(1,223,225,0.3)]">
                                            Confirm Grade {{ cosmetic.gradeReport.value.grade }} → Calculate Pricing
                                            <span class="material-symbols-outlined text-[20px]">payments</span>
                                        </button>
                                    </div>
                                </div>

                                <!-- Visual Reference Grid -->
                                <div class="mt-16 grid grid-cols-4 gap-4">
                                    <div v-for="slot in cosmetic.photoSlots.value.filter(s => s.status === 'captured')" :key="slot.key" class="aspect-[3/4] rounded-xl overflow-hidden relative group border border-outline-variant/20 shadow-sm">
                                        <img :src="slot.url" class="w-full h-full object-cover grayscale transition-all duration-500 group-hover:grayscale-0 group-hover:scale-105" />
                                        <div class="absolute inset-0 bg-[#0F1E3C]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                                        <div class="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                            <span class="bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-md">{{ slot.label }}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </transition>
        </div>
    `
};
