/**
 * PricingView
 * 
 * F6: Final Pricing & Valuation phase.
 * Aggregates all diagnostic data (Auth, Hardware, Cosmetic) and calculates
 * the final trade-in offer.
 * 
 * Built with SCSS + BEM based on the Stitch F6 design.
 */

window.AppViews = window.AppViews || {};

window.AppViews.PricingView = {
    name: 'PricingView',
    props: {
        uuid: { type: String, required: true }
    },
    emits: ['go-back', 'navigate-phase'],
    setup(props, { emit }) {
        const { ref, computed, onMounted, watch, toRaw } = Vue;
        const session = window.useSession();

        // --- State ---
        const loading = ref(true);
        const deviceData = ref(null);
        const authData = ref(null);
        const hwData = ref(null);
        const cosData = ref(null);
        const offerAdjustment = ref(0);
        const manualOffer = ref(null);

        // --- Fetch Data ---
        async function fetchData() {
            loading.value = true;
            try {
                // Pull from session or singleton composables (in case they haven't synced yet)
                const existingSession = session.currentSession.value;
                
                const auth = window.useAuthenticity();
                const hw = window.useHardwareTest();
                const cos = window.useCosmetic();

                // Always fetch device data (it's fast and needed for base pricing)
                const device = await window.IDT.devices.get(props.uuid);
                deviceData.value = device;

                authData.value = existingSession?.data?.authenticity || auth.result.value || null;
                hwData.value = existingSession?.data?.hardware || hw.results.value || null;
                cosData.value = existingSession?.data?.cosmetic || cos.gradeReport.value || null;

                console.log('[PricingView] Loaded summary data:', {
                    auth: !!authData.value,
                    hw: !!hwData.value,
                    cos: !!cosData.value
                });

                // Initial loading animation delay
                await new Promise(r => setTimeout(r, 1200));

            } catch (err) {
                console.error('[PricingView] Failed to fetch summary data:', err);
                window.ToastManager?.show('Failed to load assessment data', 'error');
            } finally {
                loading.value = false;
            }
        }

        onMounted(fetchData);

        // --- Pricing Logic (Mocked) ---
        const pricing = computed(() => {
            if (!deviceData.value) return null;

            // Base price based on model (very rough mock)
            let base = 22000; // EGP
            const model = deviceData.value.ModelName || '';
            if (model.includes('15')) base = 35000;
            else if (model.includes('14')) base = 22000;
            else if (model.includes('13')) base = 15000;
            else base = 10000;

            // Cosmetic Deductions
            let cosDeduction = 0;
            if (cosData.value) {
                const grade = cosData.value.grade;
                if (grade === 'B') cosDeduction = 1500;
                else if (grade === 'C') cosDeduction = 4000;
                else if (grade === 'D') cosDeduction = 8000;
            }

            // Authenticity Deductions
            let authDeduction = 0;
            if (authData.value && authData.value.overallVerdict === 'parts_flagged') {
                authDeduction = 500; // Generic flag fee
            }

            // Battery Deduction
            let battDeduction = 0;
            if (hwData.value?.battery?.healthPercent) {
                const health = hwData.value.battery.healthPercent;
                if (health < 80) battDeduction = 1000;
                else if (health < 85) battDeduction = 500;
            }

            // Part replacements (from auth audit trail)
            let partDeduction = 0;
            if (authData.value?.auditTrail) {
                authData.value.auditTrail.forEach(item => {
                    if (['mismatch', 'unknown'].includes(item.status)) {
                        partDeduction += 800;
                    }
                });
            }

            const subtotal = base - cosDeduction - authDeduction - battDeduction - partDeduction;
            const final = subtotal + Number(offerAdjustment.value);

            return {
                base,
                cosDeduction,
                authDeduction,
                battDeduction,
                partDeduction,
                final: Math.max(0, final)
            };
        });

        // --- Computed Values for UI ---
        const displayUuid = computed(() => props.uuid ? props.uuid.substring(0, 8).toUpperCase() : 'UNKNOWN');
        const currentTime = computed(() => {
            const now = new Date();
            return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        });

        const batteryDisplay = computed(() => {
            if (!hwData.value?.battery) return 'N/A';
            const health = hwData.value.battery.healthPercent;
            const isOem = hwData.value.battery.builtIn !== false;
            return `${health}% • ${isOem ? 'OEM' : 'Non-OEM'}`;
        });

        const authSummary = computed(() => {
            if (!authData.value?.auditTrail) return 'Not Verified';
            const total = authData.value.auditTrail.length;
            const pass = authData.value.auditTrail.filter(p => ['genuine', 'used', 'restricted'].includes(p.status)).length;
            return `${pass}/${total} Pass`;
        });

        const hwSummary = computed(() => {
            if (!hwData.value?.components) return 'Not Verified';
            const components = Object.values(hwData.value.components);
            const total = components.length;
            const pass = components.filter(c => c.status === 'ok').length;
            return `${pass}/${total} Pass`;
        });

        // --- Actions ---
        const handleAdjustment = (e) => {
            offerAdjustment.value = e.target.value - (pricing.value?.final - offerAdjustment.value);
        };

        const generateReport = async () => {
            window.ToastManager?.show('Generating PDF report...', 'info');
            try {
                const path = await window.IDT.reports.generateForDevice(props.uuid);
                window.ToastManager?.show(`Report saved: ${path}`, 'success');
            } catch (err) {
                window.ToastManager?.show('Failed to generate report', 'error');
            }
        };

        const presentOffer = async () => {
            window.ToastManager?.show('Offer presented to customer', 'success');
            
            // Save final pricing to session
            if (pricing.value) {
                await session.updatePhaseData('pricing', {
                    ...pricing.value,
                    adjustment: Number(offerAdjustment.value)
                });
            }

            // Mark session as completed
            await session.completeSession();
            
            // Navigate back home or to a summary screen
            emit('go-back');
        };

        return {
            loading,
            deviceData,
            authData,
            hwData,
            cosData,
            pricing,
            offerAdjustment,
            displayUuid,
            currentTime,
            batteryDisplay,
            authSummary,
            hwSummary,
            generateReport,
            presentOffer
        };
    },
    template: `
        <div class="pricing-page">
            <!-- Loading State -->
            <div v-if="loading" class="pricing-page__loading">
                <div class="pricing-page__loading-spinner">
                    <svg viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#E2E8F0" stroke-width="8" />
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#711FFF" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="210" />
                    </svg>
                </div>
                <h2 class="pricing-page__loading-title">Calculating Valuation...</h2>
                <p class="pricing-page__loading-subtitle">Synthesizing authenticity reports, hardware telemetry, and cosmetic grading into a final trade-in offer.</p>
            </div>

            <template v-else>
                <!-- LEFT SIDEBAR -->
                <aside class="pricing-page__sidebar">
                    <div class="pricing-page__device-card">
                        <!-- We use a fixed high-quality image for the demo/brief or first photo if available -->
                        <img v-if="cosData?.photos && Object.keys(cosData.photos).length > 0" :src="Object.values(cosData.photos)[0]" class="pricing-page__device-img" alt="Device">
                        <div v-else class="pricing-page__device-img-placeholder">
                            <span class="material-symbols-outlined" style="font-size: 48px;">smartphone</span>
                        </div>

                        <div class="pricing-page__time-badge">
                            <span class="material-symbols-outlined">timer</span>
                            <span>Completed in 2:47</span>
                        </div>
                        <h2 class="pricing-page__device-name">{{ deviceData?.ModelName || 'Unknown iPhone' }}</h2>
                        <p class="pricing-page__device-meta">{{ deviceData?.TotalDiskCapacity || '---' }} • {{ deviceData?.Color || 'Default' }}</p>
                    </div>

                    <div class="pricing-page__phase-list">
                        <div class="pricing-page__phase-row">
                            <div class="pricing-page__phase-left">
                                <span class="material-symbols-outlined pricing-page__phase-icon pricing-page__phase-icon--pass" style="font-variation-settings: 'FILL' 1">verified_user</span>
                                <span class="pricing-page__phase-label">Authenticity</span>
                            </div>
                            <span class="pricing-page__phase-value pricing-page__phase-value--pass">{{ authSummary }}</span>
                        </div>
                        <div class="pricing-page__phase-row">
                            <div class="pricing-page__phase-left">
                                <span class="material-symbols-outlined pricing-page__phase-icon pricing-page__phase-icon--pass" style="font-variation-settings: 'FILL' 1">memory</span>
                                <span class="pricing-page__phase-label">Hardware</span>
                            </div>
                            <span class="pricing-page__phase-value pricing-page__phase-value--pass">{{ hwSummary }}</span>
                        </div>
                        <div class="pricing-page__phase-row">
                            <div class="pricing-page__phase-left">
                                <span class="material-symbols-outlined pricing-page__phase-icon pricing-page__phase-icon--info" style="font-variation-settings: 'FILL' 1">camera_alt</span>
                                <span class="pricing-page__phase-label">Cosmetic</span>
                            </div>
                            <span class="pricing-page__phase-value pricing-page__phase-value--info">Grade {{ cosData?.grade || '---' }}</span>
                        </div>
                        <div class="pricing-page__phase-row">
                            <div class="pricing-page__phase-left">
                                <span class="material-symbols-outlined pricing-page__phase-icon pricing-page__phase-icon--neutral" style="font-variation-settings: 'FILL' 1">battery_full</span>
                                <span class="pricing-page__phase-label">Battery</span>
                            </div>
                            <span class="pricing-page__phase-value pricing-page__phase-value--neutral">{{ batteryDisplay }}</span>
                        </div>
                    </div>

                    <!-- Diagnostic Report Card -->
                    <div class="pricing-page__report-card">
                        <div class="pricing-page__report-header">
                            <h3 class="pricing-page__report-title">Diagnostic Report</h3>
                            <span class="pricing-page__report-badge">PDF Ready</span>
                        </div>
                        <div class="pricing-page__report-file">
                            <span class="material-symbols-outlined pricing-page__report-file-icon">description</span>
                            <div>
                                <div class="pricing-page__report-file-name">Assessment #FX-{{ displayUuid }}</div>
                                <div class="pricing-page__report-file-time">Generated {{ currentTime }}</div>
                            </div>
                        </div>
                        <div class="pricing-page__report-actions">
                            <button class="pricing-page__report-btn" @click="generateReport">
                                <span class="material-symbols-outlined">picture_as_pdf</span> Export
                            </button>
                            <button class="pricing-page__report-btn">
                                <span class="material-symbols-outlined">share</span> Share
                            </button>
                            <button class="pricing-page__report-btn">
                                <span class="material-symbols-outlined">chat</span> WhatsApp
                            </button>
                            <button class="pricing-page__report-btn">
                                <span class="material-symbols-outlined">print</span> Print
                            </button>
                        </div>
                    </div>
                </aside>

                <!-- MAIN CONTENT -->
                <main class="pricing-page__main">
                    <div class="pricing-page__main-inner">
                        <div class="pricing-page__header">
                            <h1 class="pricing-page__header-title">Final Price Calculation</h1>
                            <p class="pricing-page__header-subtitle">Based on live market pricing + automated diagnostics</p>
                        </div>

                        <div class="pricing-page__bento">
                            <!-- Calculation Card -->
                            <div class="pricing-page__breakdown-card">
                                <label class="pricing-page__breakdown-label">Price Breakdown</label>
                                <div class="pricing-page__breakdown-rows">
                                    <div class="pricing-page__breakdown-row">
                                        <span class="pricing-page__breakdown-row-name">Base Market Value</span>
                                        <span class="pricing-page__breakdown-row-value pricing-page__breakdown-row-value--base">EGP {{ pricing.base.toLocaleString() }}</span>
                                    </div>
                                    <div class="pricing-page__breakdown-row">
                                        <span class="pricing-page__breakdown-row-name">Cosmetic Deduction — Grade {{ cosData?.grade || '---' }}</span>
                                        <span class="pricing-page__breakdown-row-value pricing-page__breakdown-row-value--deduction">−EGP {{ pricing.cosDeduction.toLocaleString() }}</span>
                                    </div>
                                    <div class="pricing-page__breakdown-row">
                                        <span class="pricing-page__breakdown-row-name">Authenticity Flag (Secure Enclave)</span>
                                        <span class="pricing-page__breakdown-row-value pricing-page__breakdown-row-value--deduction">−EGP {{ pricing.authDeduction.toLocaleString() }}</span>
                                    </div>
                                    <div class="pricing-page__breakdown-row">
                                        <span class="pricing-page__breakdown-row-name">Battery Health Adjustment ({{ hwData?.battery?.healthPercent || '---' }}%)</span>
                                        <span class="pricing-page__breakdown-row-value" :class="pricing.battDeduction > 0 ? 'pricing-page__breakdown-row-value--deduction' : 'pricing-page__breakdown-row-value--zero'">−EGP {{ pricing.battDeduction.toLocaleString() }}</span>
                                    </div>
                                    <div class="pricing-page__breakdown-row">
                                        <span class="pricing-page__breakdown-row-name">Part Replacement Deduction</span>
                                        <span class="pricing-page__breakdown-row-value pricing-page__breakdown-row-value--deduction">−EGP {{ pricing.partDeduction.toLocaleString() }}</span>
                                    </div>

                                    <div class="pricing-page__breakdown-divider">
                                        <div class="pricing-page__final-offer-box">
                                            <span class="pricing-page__final-label">Final Offer Price</span>
                                            <span class="pricing-page__final-amount">EGP {{ pricing.final.toLocaleString() }}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Side Cards -->
                            <div class="pricing-page__side-cards">
                                <!-- Adjust Offer -->
                                <div class="pricing-page__adjust-card">
                                    <label class="pricing-page__adjust-label">Adjust Offer</label>
                                    <div class="pricing-page__adjust-value-row">
                                        <span class="pricing-page__adjust-amount">EGP {{ (pricing.final + Number(offerAdjustment)).toLocaleString() }}</span>
                                        <span class="pricing-page__adjust-auto-badge">AUTO-SET</span>
                                    </div>
                                    <input type="range" 
                                           class="pricing-page__adjust-slider" 
                                           min="-5000" 
                                           max="5000" 
                                           step="100"
                                           v-model="offerAdjustment">
                                    <div class="pricing-page__adjust-range">
                                        <span>Min Adjustment</span>
                                        <span>Max Adjustment</span>
                                    </div>
                                </div>

                                <!-- Market Insight -->
                                <div class="pricing-page__insight-card">
                                    <div class="pricing-page__insight-header">
                                        <span class="material-symbols-outlined">trending_up</span>
                                        <span>Market Insight</span>
                                    </div>
                                    <p class="pricing-page__insight-text">
                                        Demand for <strong>{{ deviceData?.ModelName || 'this model' }}</strong> is <span class="highlight">High</span> in your region. Resell time estimated at <span class="highlight">4-6 days</span>.
                                    </p>
                                    <div class="pricing-page__insight-bar">
                                        <div class="pricing-page__insight-bar-fill" style="width: 85%"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- CTA Section -->
                        <div class="pricing-page__cta">
                            <button class="pricing-page__cta-primary" @click="presentOffer">
                                Present Offer to Customer
                                <span class="material-symbols-outlined">arrow_forward</span>
                            </button>
                            <div class="pricing-page__cta-secondary-row">
                                <button class="pricing-page__cta-secondary">
                                    <span class="material-symbols-outlined">edit</span> Manual Override
                                </button>
                                <button class="pricing-page__cta-secondary">
                                    <span class="material-symbols-outlined">history</span> Price History
                                </button>
                            </div>
                        </div>
                    </div>
                </main>
            </template>
        </div>
    `
};
