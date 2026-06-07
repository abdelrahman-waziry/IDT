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
        <div class="cosmetic-page">
            <!-- ══════ LEFT SIDEBAR ══════ -->
            <aside class="cosmetic-page__sidebar">
                <div class="cosmetic-page__sidebar-content">
                    <!-- Header -->
                    <div>
                        <h3 class="cosmetic-page__sidebar-title">Hand Work Phone to Operator</h3>
                        <p class="cosmetic-page__sidebar-description">
                            Please pass the device to the cosmetic station operator. They will scan the QR code to begin the visual verification process.
                        </p>
                    </div>

                    <!-- Amber Alert -->
                    <div class="cosmetic-page__alert">
                        <div class="cosmetic-page__alert-dot"></div>
                        <span class="cosmetic-page__alert-text">Action Required: Unplug USB Cable</span>
                    </div>

                    <!-- QR Code Section -->
                    <div class="cosmetic-page__qr-section">
                        <div class="cosmetic-page__qr-frame">
                            <div class="cosmetic-page__qr-code">
                                <!-- Real QR code from server -->
                                <img v-if="cosmetic.qrDataUrl.value" :src="cosmetic.qrDataUrl.value" alt="Session QR Code" />
                                <!-- Loading state -->
                                <div v-else style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                                    <span class="material-symbols-outlined" style="font-size:32px;color:#7B7488;">qr_code_2</span>
                                    <span style="font-size:11px;color:#7B7488;">Starting server...</span>
                                </div>
                            </div>
                            <div class="cosmetic-page__qr-tag">{{ sessionTag }}</div>
                        </div>

                        <!-- Server URL display -->
                        <div v-if="cosmetic.serverUrl.value" style="margin-top:24px;text-align:center;display:flex;flex-direction:column;gap:8px;">
                            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#4A4457;word-break:break-all;">
                                {{ cosmetic.serverUrl.value }}
                            </p>
                            <div v-if="cosmetic.localUrl.value && cosmetic.localUrl.value !== cosmetic.serverUrl.value" style="padding-top:8px;border-top:1px solid #F3F1F5;">
                                <p style="font-size:10px;color:#7B7488;margin-bottom:4px;">WiFi Fallback:</p>
                                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#7B7488;word-break:break-all;">
                                    {{ cosmetic.localUrl.value }}
                                </p>
                            </div>
                        </div>

                        <!-- Waiting / Capturing Status -->
                        <div class="cosmetic-page__waiting">
                            <div class="cosmetic-page__waiting-row">
                                <span class="cosmetic-page__waiting-ping"></span>
                                <span class="cosmetic-page__waiting-label">
                                    {{ cosmetic.sessionState.value === 'waiting' ? 'Waiting for Operator' :
                                       cosmetic.sessionState.value === 'capturing' ? 'Receiving Photos' :
                                       cosmetic.sessionState.value === 'grading' ? 'Grading Photos...' :
                                       cosmetic.sessionState.value === 'graded' ? 'Grading Complete' :
                                       cosmetic.sessionState.value === 'error' ? 'Error' : 'Initializing...' }}
                                </span>
                            </div>
                            <p class="cosmetic-page__waiting-sublabel">
                                {{ cosmetic.sessionState.value === 'waiting' ? 'Session will auto-resume once scan is detected' :
                                   cosmetic.sessionState.value === 'capturing' ? cosmetic.capturedCount.value + ' of ' + cosmetic.totalSlots.value + ' photos received' :
                                   cosmetic.sessionState.value === 'grading' ? 'Analyzing photos via AI vision...' :
                                   cosmetic.sessionState.value === 'graded' ? cosmetic.gradeReport.value?.label || 'Done' :
                                   cosmetic.error.value || '' }}
                            </p>
                        </div>
                    </div>

                    <!-- Grade Button (when photos are in) -->
                    <button v-if="cosmetic.capturedCount.value > 0 && cosmetic.sessionState.value !== 'grading' && cosmetic.sessionState.value !== 'graded'"
                            @click="runGrading"
                            class="cosmetic-page__grade-button">
                        <span class="material-symbols-outlined">auto_awesome</span>
                        Grade {{ cosmetic.capturedCount.value }} Photo{{ cosmetic.capturedCount.value > 1 ? 's' : '' }} with AI
                    </button>

                    <!-- Grade Result Card -->
                    <div v-if="cosmetic.gradeReport.value" class="cosmetic-page__grade-result">
                        <div class="cosmetic-page__grade-result-header">
                            <span class="cosmetic-page__grade-result-grade" :style="{ color: cosmetic.gradeReport.value.color }">
                                {{ cosmetic.gradeReport.value.grade }}
                            </span>
                            <span class="cosmetic-page__grade-result-label">{{ cosmetic.gradeReport.value.label }}</span>
                        </div>
                        <p class="cosmetic-page__grade-result-desc">{{ cosmetic.gradeReport.value.description }}</p>
                        <div class="cosmetic-page__grade-result-score">
                            <span>Overall Score</span>
                            <strong>{{ cosmetic.gradeReport.value.overallScore }}/100</strong>
                        </div>
                        <button @click="proceedToPricing" class="cosmetic-page__proceed-button">
                            <span>Proceed to Pricing</span>
                            <span class="material-symbols-outlined">arrow_forward</span>
                        </button>
                    </div>

                    <!-- Skip Warning -->
                    <div v-if="!cosmetic.gradeReport.value" class="cosmetic-page__skip-banner">
                        <div class="cosmetic-page__skip-banner-row">
                            <span class="material-symbols-outlined cosmetic-page__skip-banner-icon">warning</span>
                            <p class="cosmetic-page__skip-banner-text">Skipping this step will mark the device as "Unverified" for cosmetic authenticity.</p>
                        </div>
                        <button class="cosmetic-page__skip-banner-button" @click="skipCosmetic">
                            Skip Cosmetic Evaluation
                        </button>
                    </div>
                </div>
            </aside>

            <!-- ══════ MAIN CONTENT ══════ -->
            <main class="cosmetic-page__main">
                <div class="cosmetic-page__main-inner">
                    <!-- Header Row -->
                    <div class="cosmetic-page__header">
                        <h2 class="cosmetic-page__header-title">Cosmetic Photo Grid</h2>
                        <span class="cosmetic-page__header-badge">LIVE_UPLOADS: {{ cosmetic.capturedCount.value }}/{{ cosmetic.totalSlots.value }}</span>
                    </div>

                    <!-- Error State -->
                    <div v-if="cosmetic.error.value" style="background:#FEF2F2;border:1px solid #FECACA;padding:16px;border-radius:12px;margin-bottom:24px;display:flex;align-items:center;gap:12px;color:#991B1B;">
                        <span class="material-symbols-outlined" style="font-size:24px;">error</span>
                        <div>
                            <p style="font-weight:700;">Session Error</p>
                            <p style="font-size:13px;margin-top:2px;">{{ cosmetic.error.value }}</p>
                        </div>
                    </div>

                    <!-- Paused / Unplugged State -->
                    <div v-if="cosmetic.isPaused.value" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.5);padding:16px;border-radius:12px;margin-bottom:24px;display:flex;align-items:center;gap:12px;color:#B45309;">
                        <span class="material-symbols-outlined" style="font-size:28px;">cable</span>
                        <div>
                            <p style="font-weight:700;">USB Cable Disconnected — Sync Paused</p>
                            <p style="font-size:13px;margin-top:2px;">Take the necessary full-angle photos. Reconnect the cable to resume sync automatically.</p>
                        </div>
                    </div>

                    <!-- Bento Photo Grid -->
                    <div class="cosmetic-page__grid">
                        <template v-for="slot in cosmetic.photoSlots.value" :key="slot.key">
                            <!-- Captured -->
                            <div v-if="slot.status === 'captured'" class="cosmetic-page__photo">
                                <img :src="slot.url" :alt="slot.label" class="cosmetic-page__photo-img" />
                                <div class="cosmetic-page__photo-gradient"></div>
                                <div class="cosmetic-page__photo-check">
                                    <span class="material-symbols-outlined">check_circle</span>
                                </div>
                                <div class="cosmetic-page__photo-label">
                                    <p class="cosmetic-page__photo-angle">{{ slot.angle }}</p>
                                    <p class="cosmetic-page__photo-name">{{ slot.label }}</p>
                                </div>
                            </div>

                            <!-- Syncing (uploading) -->
                            <div v-else-if="slot.status === 'syncing'" class="cosmetic-page__syncing">
                                <div class="cosmetic-page__syncing-shimmer" v-if="!cosmetic.isPaused.value"></div>
                                <div class="cosmetic-page__syncing-content">
                                    <div class="cosmetic-page__syncing-icon-ring" :style="cosmetic.isPaused.value ? 'background: rgba(245,158,11,0.15)' : ''">
                                        <span class="material-symbols-outlined cosmetic-page__syncing-icon" :style="cosmetic.isPaused.value ? 'color: #B45309;' : ''">
                                            {{ cosmetic.isPaused.value ? 'pause_circle' : 'sync' }}
                                        </span>
                                    </div>
                                    <div class="cosmetic-page__syncing-text">
                                        <p class="cosmetic-page__syncing-status" :style="cosmetic.isPaused.value ? 'color: #B45309;' : ''">
                                            {{ cosmetic.isPaused.value ? 'Sync Paused' : 'Syncing Photo' }}
                                        </p>
                                        <p class="cosmetic-page__syncing-detail">
                                            {{ cosmetic.isPaused.value ? 'Waiting for reconnection' : (slot.syncFile || 'Transferring...') }}
                                        </p>
                                    </div>
                                    <div class="cosmetic-page__syncing-progress-track">
                                        <div class="cosmetic-page__syncing-progress-fill" :style="cosmetic.isPaused.value ? 'width: 100%; background: #F59E0B; animation: none;' : ''"></div>
                                    </div>
                                </div>
                                <div class="cosmetic-page__syncing-label">
                                    <p class="cosmetic-page__syncing-angle">{{ slot.angle }}</p>
                                    <p class="cosmetic-page__syncing-name">{{ slot.label }}</p>
                                </div>
                            </div>

                            <!-- Empty -->
                            <div v-else class="cosmetic-page__empty">
                                <span class="material-symbols-outlined cosmetic-page__empty-icon">add_a_photo</span>
                                <p class="cosmetic-page__empty-label">{{ slot.label }}</p>
                            </div>
                        </template>
                    </div>
                </div>
            </main>

            <!-- RESULTS MODAL OVERLAY (Stitch Integration) -->
            <div v-if="showResultsModal && cosmetic.gradeReport.value" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-8" style="font-family: 'Inter', sans-serif; position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center;">
                <div class="w-full max-w-[1200px] h-[85vh] bg-surface rounded-2xl shadow-2xl flex overflow-hidden border border-outline-variant/30 text-on-surface relative" style="margin: auto;">
                    
                    <!-- Close Button -->
                    <button @click="showResultsModal = false" class="absolute top-4 right-4 z-10 w-10 h-10 bg-white/50 hover:bg-white rounded-full flex items-center justify-center text-on-surface-variant transition-colors shadow-sm">
                        <span class="material-symbols-outlined">close</span>
                    </button>

                    <!-- Left Panel: Diagnostics & Grading -->
                    <aside class="w-[350px] flex-shrink-0 bg-surface-container-low flex flex-col overflow-y-auto border-r border-outline-variant/20">
                        <div class="p-8 flex flex-col gap-8">
                            <!-- Grade Summary Card -->
                            <section class="flex flex-col items-center gap-4">
                                <div class="w-20 h-20 bg-gradient-to-br from-[#711FFF] to-[#01DFE1] rounded-xl flex items-center justify-center shadow-[0_4px_20px_rgba(113,31,255,0.3)]">
                                    <span class="text-white text-4xl font-headline font-extrabold">{{ cosmetic.gradeReport.value.grade }}</span>
                                </div>
                                <div class="text-center">
                                    <p class="font-mono text-secondary text-sm font-semibold tracking-tighter uppercase">Confidence: {{ cosmetic.gradeReport.value.overallScore }}%</p>
                                    <p class="text-on-surface-variant text-xs mt-1">AI Diagnostic Calculation</p>
                                </div>
                            </section>

                            <!-- Surface Breakdown -->
                            <section class="flex flex-col gap-4">
                                <h3 class="font-headline font-bold text-xs uppercase tracking-widest text-on-surface-variant px-1">Surface Breakdown</h3>
                                <div class="flex flex-col gap-2">
                                    <div v-for="scoreItem in cosmetic.gradeReport.value.imageScores" :key="scoreItem.view" class="bg-surface-container-lowest p-4 rounded-xl flex justify-between items-center shadow-sm">
                                        <span class="font-headline font-semibold text-sm capitalize">{{ scoreItem.view.replace(/_/g, ' ') }}</span>
                                        <div class="flex items-center gap-3">
                                            <span class="font-mono text-xs text-on-surface-variant opacity-60">AI:</span>
                                            <span class="font-mono font-bold" :class="scoreItem.score >= 75 ? 'text-primary' : (scoreItem.score >= 60 ? 'text-secondary' : 'text-error')">{{ getScoreGrade(scoreItem.score) }}</span>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <!-- Operator Override -->
                            <section class="bg-white rounded-xl p-5 shadow-[0_10px_40px_rgba(15,30,60,0.06)] mt-auto">
                                <h4 class="font-headline font-bold text-sm mb-4">Operator Override</h4>
                                <div class="grid grid-cols-4 gap-2">
                                    <button class="h-12 border border-outline-variant rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">A</button>
                                    <button class="h-12 bg-primary text-white rounded-lg font-mono font-bold shadow-[0_4px_12px_rgba(113,31,255,0.3)]">B</button>
                                    <button class="h-12 border border-outline-variant rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">C</button>
                                    <button class="h-12 border border-outline-variant rounded-lg font-mono font-bold text-on-surface-variant hover:bg-surface-container transition-colors">D</button>
                                </div>
                                <p class="text-[10px] text-on-surface-variant mt-4 leading-relaxed italic">
                                    Manual selection will override AI pricing logic for this session.
                                </p>
                            </section>
                        </div>
                    </aside>

                    <!-- Right Panel: Review & Action -->
                    <div class="flex-1 overflow-y-auto bg-surface-bright relative">
                        <div class="max-w-3xl mx-auto p-12">
                            <div class="mb-10">
                                <h2 class="text-4xl font-headline font-extrabold tracking-tight text-on-background">Cosmetic Grade Review</h2>
                                <p class="text-on-surface-variant mt-2">Validate machine assessment and provide operational context.</p>
                            </div>

                            <!-- AI Insights Bento Section -->
                            <div class="grid grid-cols-1 gap-8">
                                <!-- Notes Card -->
                                <div class="bg-[#EDE9FE] border border-[#C4B5FD] rounded-2xl p-8 flex gap-6 items-start">
                                    <div class="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                                        <span class="material-symbols-outlined text-[#711FFF]" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
                                    </div>
                                    <div class="space-y-3 w-full">
                                        <h4 class="font-headline font-bold text-lg text-primary">AI Diagnostic Notes</h4>
                                        <div class="text-primary/80 leading-relaxed text-sm">
                                            <p v-if="!cosmetic.gradeReport.value.defectSummary.length">No significant defects detected by AI vision.</p>
                                            <ul v-else class="list-disc pl-4 mb-2">
                                                <li v-for="(defect, i) in cosmetic.gradeReport.value.defectSummary" :key="i" class="mb-1">
                                                    <strong><span class="capitalize">{{ defect.viewLabel }}</span> — {{ defect.type }} <span class="uppercase text-[10px] opacity-70">({{ defect.severity }})</span>:</strong> {{ defect.description }}
                                                </li>
                                            </ul>
                                            <p class="font-bold mt-2">Recommendation: Grade {{ cosmetic.gradeReport.value.grade }}.</p>
                                        </div>
                                    </div>
                                </div>

                                <!-- Operator Notes Area -->
                                <div class="flex flex-col gap-3">
                                    <label class="font-headline font-semibold text-sm text-on-surface flex items-center gap-2">
                                        Session Remarks
                                        <span class="text-[10px] font-mono text-outline uppercase tracking-wider">(Optional)</span>
                                    </label>
                                    <textarea class="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-6 min-h-[160px] focus:ring-2 focus:ring-primary/50 focus:outline-none font-body text-on-surface placeholder:text-outline/50 shadow-inner" placeholder="Add internal notes about cosmetic defects, lens clarity, or button tactile feel..."></textarea>
                                </div>

                                <!-- Action Footer -->
                                <div class="pt-8 flex items-center justify-between">
                                    <div class="flex items-center gap-4">
                                        <div class="w-10 h-10 rounded-full overflow-hidden bg-surface-container flex items-center justify-center">
                                            <span class="material-symbols-outlined text-outline">person</span>
                                        </div>
                                        <div class="flex flex-col">
                                            <span class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Assigned Tech</span>
                                            <span class="text-sm font-mono text-on-surface">STATION_01</span>
                                        </div>
                                    </div>
                                    <button @click="confirmAndProceed" class="bg-primary hover:bg-[#711FFF] text-white px-8 py-4 rounded-xl font-headline font-bold flex items-center gap-4 transition-all hover:translate-y-[-2px] shadow-[0_4px_20px_rgba(113,31,255,0.3)]">
                                        Confirm Grade {{ cosmetic.gradeReport.value.grade }} → Calculate Pricing
                                        <span class="material-symbols-outlined">payments</span>
                                    </button>
                                </div>
                            </div>

                            <!-- Visual Reference Grid -->
                            <div class="mt-16 grid grid-cols-3 gap-4">
                                <div v-for="slot in cosmetic.photoSlots.value.filter(s => s.status === 'captured')" :key="slot.key" class="aspect-square rounded-xl overflow-hidden relative group">
                                    <img :src="slot.url" class="w-full h-full object-cover grayscale transition-all duration-300 group-hover:grayscale-0" />
                                    <div class="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    `
};
