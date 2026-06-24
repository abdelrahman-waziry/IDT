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
        const apiPrice = ref(null);

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

                // Fire-and-forget: submit diagnostic reports to dashboard
                submitReportsToDashboard(props.uuid, hwData.value, cosData.value);

                // --- Calculate Price via API ---
                try {
                    const loginRes = await fetch('https://bestrepairegypt.com/v1/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: 'a@b.c', password: '123654789@A!' })
                    });
                    
                    if (loginRes.ok) {
                        const loginData = await loginRes.json();
                        const token = loginData.token;

                        let resolvedProductId = deviceData.value?.productId || 1;
                        let resolvedVariantId = deviceData.value?.variantId || 1;

                        try {
                            const deviceModelName = deviceData.value?.ModelName || '';
                            const deviceStorage = window.IDT?.utils?.parseStorageValue(deviceData.value?.TotalDiskCapacity || '');

                            // 1. Fetch Products to resolve Product ID
                            const productsRes = await fetch('https://bestrepairegypt.com/v1/products', {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            
                            if (productsRes.ok) {
                                const productsData = await productsRes.json();
                                const products = productsData.products || [];
                                
                                // Match by exact or partial string matching
                                const matchedProduct = products.find(p => 
                                    p.name.toLowerCase() === deviceModelName.toLowerCase() || 
                                    deviceModelName.toLowerCase().includes(p.name.toLowerCase())
                                );
                                
                                if (matchedProduct) {
                                    resolvedProductId = matchedProduct.id;
                                    
                                    // 2. Fetch Variants to resolve Variant ID
                                    const variantsRes = await fetch(`https://bestrepairegypt.com/v1/variants?productId=${resolvedProductId}`, {
                                        headers: { 'Authorization': `Bearer ${token}` }
                                    });
                                    
                                    if (variantsRes.ok) {
                                        const variantsData = await variantsRes.json();
                                        const variants = variantsData.variants || [];
                                        
                                        let matchedVariant = null;
                                        if (deviceStorage && variants.length > 0) {
                                            matchedVariant = variants.find(v => {
                                                const vStorage = window.IDT?.utils?.parseStorageValue(v.name || '');
                                                // Some variance might happen due to formatting, but parseStorageValue normalizes to bytes
                                                return vStorage === deviceStorage;
                                            });
                                        }
                                        
                                        if (matchedVariant) {
                                            resolvedVariantId = matchedVariant.id;
                                            console.log(`[PricingView] Resolved Product ID: ${resolvedProductId}, Variant ID: ${resolvedVariantId}`);
                                        } else if (variants.length > 0) {
                                            resolvedVariantId = variants[0].id;
                                            console.log(`[PricingView] Storage not matched precisely. Defaulting to Variant ID: ${resolvedVariantId}`);
                                        }
                                    }
                                } else {
                                    console.warn(`[PricingView] No matching product found for model: ${deviceModelName}`);
                                }
                            }
                        } catch (resolveErr) {
                            console.error('[PricingView] Error resolving variant details:', resolveErr);
                        }

                        // Fetch parts to map by type dynamically
                        const partsRes = await fetch(`https://bestrepairegypt.com/v1/parts?productId=${resolvedProductId}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const partsData = partsRes.ok ? await partsRes.json() : { parts: [] };
                        const allParts = partsData.parts || [];

                        const repairedParts = [];
                        const partsWithValuesMap = {};

                        // Helper to get component status (0 for error/mismatch, 1 for ok/genuine)
                        const getComponentValue = (compName) => {
                            let isError = false;
                            
                            // Check Hardware Diagnostics
                            if (hwData.value?.components && hwData.value.components[compName]) {
                                if (hwData.value.components[compName].status === 'error') isError = true;
                            }
                            
                            // Check Authenticity Audit Trail
                            if (authData.value?.auditTrail) {
                                const authItem = authData.value.auditTrail.find(i => i.component === compName);
                                if (authItem && ['mismatch', 'unknown'].includes(authItem.status)) isError = true;
                            }
                            
                            return isError ? 0 : 1;
                        };

                        // Map cosmetic grade to 1, 2, 3
                        let cosmeticsNum = 3; // Flawless default
                        if (cosData.value?.grade) {
                            if (cosData.value.grade === 'B') cosmeticsNum = 2; // Light
                            else if (cosData.value.grade === 'C' || cosData.value.grade === 'D') cosmeticsNum = 1; // Visible/Heavy
                        }

                        allParts.filter(part => part.type !== null && part.type !== undefined).forEach(part => {
                            let value = 1;
                            switch (part.type) {
                                case 0: // Functional Device
                                    value = 1; // IDT is connected, so it's functional
                                    break;
                                case 1: // Repaired Before
                                    value = 0; // Will be set to 1 later if repairedParts has items
                                    break;
                                case 2: // Battery
                                    value = hwData.value?.battery?.healthPercent !== undefined 
                                            ? Math.round(hwData.value.battery.healthPercent) 
                                            : 98;
                                    break;
                                case 3: // Screen / Display
                                    value = getComponentValue('Display') === 0 ? 0 : cosmeticsNum;
                                    break;
                                case 4: // Back Glass
                                    value = getComponentValue('Rear Glass') === 0 ? 0 : cosmeticsNum;
                                    break;
                                case 5: // Charging port
                                    value = getComponentValue('USB-C/Lightning Connector Flex');
                                    break;
                                case 7: // Ear speaker
                                    value = getComponentValue('Receiver (Earpiece)');
                                    break;
                                case 8: // Loudspeaker
                                    value = getComponentValue('Main Speaker');
                                    break;
                                case 9: // Main mic
                                    value = getComponentValue('Main Microphone');
                                    break;
                                case 12: // Back camera
                                    value = getComponentValue('Rear Camera');
                                    break;
                                case 13: // Front camera
                                    value = getComponentValue('Front Camera');
                                    break;
                                case 17: // Vibration motor
                                    value = getComponentValue('Taptic Engine');
                                    break;
                                case 20: // Fingerprint
                                case 21: // Face ID
                                    value = getComponentValue('FaceID/TouchID Biometrics');
                                    break;
                                default:
                                    value = 1; // Default to functional for unmapped parts
                                    break;
                            }
                            partsWithValuesMap[part.id] = value;
                        });

                        // Automatically add defective parts (value 0) to repairedParts list
                        const specialTypes = new Set([0, 1, 2]);
                        allParts.forEach(part => {
                            if (part.type !== null && part.type !== undefined && !specialTypes.has(part.type)) {
                                const val = partsWithValuesMap[part.id];
                                if (val === 0 && !repairedParts.includes(part.id)) {
                                    repairedParts.push(part.id);
                                }
                            }
                        });

                        // If there are repaired parts, mark 'Repaired before' (type 1) as 1
                        if (repairedParts.length > 0) {
                            const repairedBeforePart = allParts.find(p => p.type === 1);
                            if (repairedBeforePart) {
                                partsWithValuesMap[repairedBeforePart.id] = 1;
                            }
                        }

                        const calcPayload = {
                            variantId: resolvedVariantId,
                            repairedPartsBefore: repairedParts,
                            partsWithValuesMap: partsWithValuesMap,
                            customer: {
                                name: "Retail Customer",
                                email: "customer@example.com",
                                phoneNumber: "01000000000"
                            }
                        };

                        const calcRes = await fetch('https://bestrepairegypt.com/v1/products/calculate', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify(calcPayload)
                        });

                        if (calcRes.ok) {
                            const calcData = await calcRes.json();
                            apiPrice.value = calcData.price;
                            console.log('[PricingView] Price calculated from API:', apiPrice.value);
                        } else {
                            console.warn('[PricingView] Calculate API returned status:', calcRes.status);
                        }
                    } else {
                        console.warn('[PricingView] Login API returned status:', loginRes.status);
                    }
                } catch (apiErr) {
                    console.error('[PricingView] API integration error:', apiErr);
                }

            } catch (err) {
                console.error('[PricingView] Failed to fetch summary data:', err);
                window.ToastManager?.show('Failed to load assessment data', 'error');
            } finally {
                loading.value = false;
            }
        }

        onMounted(fetchData);

        // --- Submit reports to dashboard (fire-and-forget) ---
        async function submitReportsToDashboard(uuid, hw, cos) {
            try {
                if (!window.electronAPI?.submitDiagnosticReports) {
                    console.warn('[PricingView] submitDiagnosticReports not available in preload');
                    return;
                }

                // Extract photo file paths from cosmetic data
                // cosData.photos is { view: "file:///path/to/file" }
                const photoPaths = cos?.photos || {};

                const result = await window.electronAPI.submitDiagnosticReports({
                    uuid,
                    hardwareData: hw ? JSON.parse(JSON.stringify(hw)) : null,
                    cosmeticData: cos ? JSON.parse(JSON.stringify(cos)) : null,
                    photoPaths: photoPaths,
                });

                if (result.success) {
                    console.log('[PricingView] Diagnostic reports submitted to dashboard:', result.data);
                } else {
                    console.warn('[PricingView] Dashboard submission failed:', result.error);
                }
            } catch (err) {
                // Non-critical — don't disturb user flow
                console.error('[PricingView] Dashboard submission error (non-blocking):', err.message);
            }
        }

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

            const subtotal = apiPrice.value !== null ? apiPrice.value : (base - cosDeduction - authDeduction - battDeduction - partDeduction);
            const final = subtotal + Number(offerAdjustment.value);

            return {
                base: apiPrice.value !== null ? apiPrice.value : base,
                cosDeduction: apiPrice.value !== null ? 0 : cosDeduction,
                authDeduction: apiPrice.value !== null ? 0 : authDeduction,
                battDeduction: apiPrice.value !== null ? 0 : battDeduction,
                partDeduction: apiPrice.value !== null ? 0 : partDeduction,
                final: Math.max(0, final),
                isApiPrice: apiPrice.value !== null
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
        <div class="flex-1 flex flex-col w-full h-full bg-surface font-body text-on-surface antialiased overflow-hidden relative">
            <transition name="fade" mode="out-in">
                <!-- Loading State -->
                <div v-if="loading" key="loading" class="w-full h-full flex flex-col items-center justify-center bg-surface absolute inset-0 z-[100]">
                    <div class="w-20 h-20 mb-6 animate-[spin_1.5s_linear_infinite]">
                        <svg viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="45" fill="none" class="stroke-[#0F1E3C]/20" stroke-width="8" />
                            <circle cx="50" cy="50" r="45" fill="none" class="stroke-[#01DFE1]" stroke-width="8" stroke-dasharray="283" stroke-dashoffset="100" />
                        </svg>
                    </div>
                    <h2 class="text-2xl font-bold text-on-surface mb-2">Calculating Valuation...</h2>
                    <p class="text-slate-500 text-center max-w-[400px]">Synthesizing authenticity reports, hardware telemetry, and cosmetic grading into a final trade-in offer.</p>
                </div>

                <div v-else key="content" class="w-full h-full flex flex-col overflow-hidden bg-surface">
                    <!-- TopAppBar Execution -->
                    <header class="flex-shrink-0 flex justify-between items-center px-6 bg-[#0F1E3C] text-white h-[56px] shadow-[0px_4px_20px_rgba(15,30,60,0.4)] relative z-50">
                        <div class="flex items-center gap-8">
                            <span class="text-lg font-black tracking-tighter text-white uppercase">Diagnostic Lab</span>
                            <nav class="hidden md:flex items-center gap-6">
                                <a class="text-slate-400 font-medium hover:text-white transition-colors duration-200" href="#" @click.prevent="emit('navigate-phase', 'authenticity')">Authenticity</a>
                                <a class="text-slate-400 font-medium hover:text-white transition-colors duration-200" href="#" @click.prevent="emit('navigate-phase', 'hardware')">Hardware</a>
                                <a class="text-slate-400 font-medium hover:text-white transition-colors duration-200" href="#" @click.prevent="emit('navigate-phase', 'cosmetic')">Cosmetic</a>
                                <a class="text-[#01DFE1] font-bold border-b-2 border-[#01DFE1] pb-1 hover:text-white transition-colors duration-200" href="#">Pricing</a>
                            </nav>
                        </div>
                        <div class="flex items-center gap-4">
                            <div class="flex items-center gap-2 bg-[#00696A]/20 px-3 py-1 rounded-full hidden sm:flex">
                                <span class="material-symbols-outlined text-[#01DFE1] text-[14px]" style="font-variation-settings: 'FILL' 1;">check_circle</span>
                                <span class="text-[12px] font-semibold text-[#01DFE1] tracking-wide">All diagnostics complete</span>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="material-symbols-outlined text-slate-400 cursor-pointer hover:text-white hidden sm:block">timer</span>
                                <span class="material-symbols-outlined text-slate-400 cursor-pointer hover:text-white hidden sm:block">info</span>
                                <button @click="emit('go-back')" class="bg-error px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider scale-95 active:scale-90 transition-transform">End Session</button>
                            </div>
                        </div>
                    </header>

                    <!-- Main Scrollable Content -->
                    <main class="flex-grow overflow-y-auto w-full">
                        <div class="py-8 px-6 max-w-[1440px] mx-auto w-full">
                            <div class="flex flex-col lg:flex-row gap-8">
                                <!-- LEFT PANEL: Session Summary -->
                                <aside class="w-full lg:w-[340px] shrink-0 space-y-6">
                                    <div class="bg-surface-container-low rounded-xl p-6 shadow-sm border border-slate-100">
                                        <div class="flex flex-col items-center mb-6">
                                            <div class="relative w-32 h-64 mb-4">
                                                <img v-if="cosData?.photos && Object.keys(cosData.photos).length > 0" :src="Object.values(cosData.photos)[0]" class="w-full h-full object-contain" alt="Device">
                                                <div v-else class="w-full h-full flex items-center justify-center bg-slate-100 rounded-xl border border-slate-200">
                                                    <span class="material-symbols-outlined text-[48px] text-slate-400">smartphone</span>
                                                </div>
                                            </div>
                                            <div class="flex items-center gap-1.5 bg-[#00696A]/10 px-3 py-1 rounded-full mb-3">
                                                <span class="material-symbols-outlined text-[#01DFE1] text-sm">timer</span>
                                                <span class="text-[11px] font-bold text-[#00696A]">Completed in {{ currentTime }}</span>
                                            </div>
                                            <h2 class="text-xl font-bold tracking-tight text-on-surface text-center">{{ deviceData?.ModelName || 'Unknown iPhone' }}</h2>
                                            <p class="text-sm text-slate-500 font-medium mt-1">{{ deviceData?.TotalDiskCapacity || '---' }} • {{ deviceData?.Color || 'Default' }}</p>
                                        </div>

                                        <div class="space-y-3">
                                            <div class="flex justify-between items-center py-2.5 px-3 bg-white rounded-lg border border-slate-100">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-green-500 text-lg" style="font-variation-settings: 'FILL' 1;">verified_user</span>
                                                    <span class="text-xs font-semibold text-slate-600">Authenticity</span>
                                                </div>
                                                <span class="font-mono text-xs font-bold text-green-600">{{ authSummary }}</span>
                                            </div>
                                            <div class="flex justify-between items-center py-2.5 px-3 bg-white rounded-lg border border-slate-100">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-green-500 text-lg" style="font-variation-settings: 'FILL' 1;">memory</span>
                                                    <span class="text-xs font-semibold text-slate-600">Hardware</span>
                                                </div>
                                                <span class="font-mono text-xs font-bold text-green-600">{{ hwSummary }}</span>
                                            </div>
                                            <div class="flex justify-between items-center py-2.5 px-3 bg-white rounded-lg border border-slate-100">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-primary text-lg" style="font-variation-settings: 'FILL' 1;">camera_alt</span>
                                                    <span class="text-xs font-semibold text-slate-600">Cosmetic</span>
                                                </div>
                                                <span class="font-mono text-xs font-bold text-primary">Grade {{ cosData?.grade || '---' }}</span>
                                            </div>
                                            <div class="flex justify-between items-center py-2.5 px-3 bg-white rounded-lg border border-slate-100">
                                                <div class="flex items-center gap-2">
                                                    <span class="material-symbols-outlined text-slate-500 text-lg" style="font-variation-settings: 'FILL' 1;">battery_full</span>
                                                    <span class="text-xs font-semibold text-slate-600">Battery</span>
                                                </div>
                                                <span class="font-mono text-xs font-bold text-slate-700">{{ batteryDisplay }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Diagnostic Report Card -->
                                    <div class="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                                        <div class="flex justify-between items-start mb-4">
                                            <h3 class="font-bold text-on-surface">Diagnostic Report</h3>
                                            <span class="bg-[#01DFE1]/10 text-[#00696A] text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">PDF Ready</span>
                                        </div>
                                        <div class="bg-surface-container-low p-4 rounded-lg mb-4 border border-slate-100">
                                            <div class="flex items-center gap-3">
                                                <span class="material-symbols-outlined text-slate-400 text-3xl">description</span>
                                                <div>
                                                    <p class="text-[13px] font-bold text-on-surface">Assessment Report #FX-{{ displayUuid }}</p>
                                                    <p class="text-[11px] text-slate-500 font-mono uppercase tracking-tighter">Generated {{ currentTime }}</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-2">
                                            <button @click="generateReport" class="flex items-center justify-center gap-2 py-2 px-3 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-sm">picture_as_pdf</span> Export PDF
                                            </button>
                                            <button class="flex items-center justify-center gap-2 py-2 px-3 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-sm">share</span> Share Link
                                            </button>
                                            <button class="flex items-center justify-center gap-2 py-2 px-3 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-sm">chat</span> WhatsApp
                                            </button>
                                            <button class="flex items-center justify-center gap-2 py-2 px-3 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-sm">print</span> Print
                                            </button>
                                        </div>
                                    </div>
                                </aside>

                                <!-- RIGHT PANEL: Pricing Breakdown & Final Offer -->
                                <section class="flex-1 space-y-6">
                                    <div>
                                        <h2 class="text-[22px] font-extrabold text-on-surface tracking-tight">Final Price Calculation</h2>
                                        <p class="text-[13px] text-slate-500 font-medium">Based on live market pricing + automated diagnostics</p>
                                    </div>

                                    <!-- Price Breakdown Bento Section -->
                                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <!-- Main Calculation Card -->
                                        <div class="md:col-span-2 bg-white rounded-xl p-6 shadow-[0px_10px_40px_rgba(15,30,60,0.06)] border border-slate-100/50">
                                            <label class="text-[11px] font-bold text-slate-400 tracking-[0.1em] uppercase block mb-6">Price Breakdown
                                                <span v-if="pricing.isApiPrice" class="text-[#01DFE1] bg-[#01DFE1]/10 px-2 py-0.5 rounded-full lowercase tracking-normal ml-2">(Live API Price)</span>
                                            </label>
                                            <div class="space-y-4">
                                                <div class="flex justify-between items-center text-sm">
                                                    <span class="text-slate-600">Base Market Value</span>
                                                    <span class="font-mono font-bold text-on-surface">EGP {{ pricing.base.toLocaleString() }}</span>
                                                </div>
                                                <template v-if="!pricing.isApiPrice">
                                                    <div class="flex justify-between items-center text-sm">
                                                        <span class="text-slate-600">Cosmetic Deduction — Grade {{ cosData?.grade || '---' }}</span>
                                                        <span class="font-mono font-bold text-error">−EGP {{ pricing.cosDeduction.toLocaleString() }}</span>
                                                    </div>
                                                    <div class="flex justify-between items-center text-sm">
                                                        <span class="text-slate-600">Authenticity Flag (Secure Enclave)</span>
                                                        <span class="font-mono font-bold text-error">−EGP {{ pricing.authDeduction.toLocaleString() }}</span>
                                                    </div>
                                                    <div class="flex justify-between items-center text-sm">
                                                        <span class="text-slate-600">Battery Health Adjustment ({{ hwData?.battery?.healthPercent || '---' }}%)</span>
                                                        <span class="font-mono font-bold" :class="pricing.battDeduction > 0 ? 'text-error' : 'text-slate-400'">−EGP {{ pricing.battDeduction.toLocaleString() }}</span>
                                                    </div>
                                                    <div class="flex justify-between items-center text-sm">
                                                        <span class="text-slate-600">Part Replacement Deduction</span>
                                                        <span class="font-mono font-bold text-error">−EGP {{ pricing.partDeduction.toLocaleString() }}</span>
                                                    </div>
                                                </template>
                                                
                                                <div class="pt-6 mt-6 border-t border-dashed border-slate-200">
                                                    <div class="flex justify-between items-center p-5 bg-green-50 rounded-xl">
                                                        <span class="text-sm font-bold text-green-800 uppercase tracking-wider">Final Offer Price</span>
                                                        <span class="text-2xl font-black text-green-900 font-mono">EGP {{ pricing.final.toLocaleString() }}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Side Cards -->
                                        <div class="space-y-6">
                                            <!-- Adjust Offer / Interaction Card -->
                                            <div class="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
                                                <label class="text-[11px] font-bold text-slate-400 tracking-[0.1em] uppercase block mb-4">Adjust Offer</label>
                                                <div class="flex justify-between items-end mb-4">
                                                    <span class="text-[20px] font-black text-on-surface font-mono">EGP {{ (pricing.final + Number(offerAdjustment)).toLocaleString() }}</span>
                                                    <span class="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">AUTO-SET</span>
                                                </div>
                                                <input class="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-[#711FFF]" max="5000" min="-5000" step="100" type="range" v-model="offerAdjustment" />
                                                <div class="flex justify-between mt-2 text-[10px] font-bold text-slate-400 uppercase">
                                                    <span>Min Adjustment</span>
                                                    <span>Max Adjustment</span>
                                                </div>
                                            </div>

                                            <!-- Live Market Insight -->
                                            <div class="bg-[#0F1E3C] rounded-xl p-5 text-white">
                                                <div class="flex items-center gap-2 mb-3">
                                                    <span class="material-symbols-outlined text-[#01DFE1] text-sm" style="font-variation-settings: 'FILL' 1;">trending_up</span>
                                                    <span class="text-[11px] font-bold uppercase tracking-widest text-[#01DFE1]">Market Insight</span>
                                                </div>
                                                <p class="text-xs text-slate-300 leading-relaxed mb-4">Demand for <strong class="text-white">{{ deviceData?.ModelName || 'this model' }}</strong> is <span class="text-white font-bold">High</span> in your region. Resell time estimated at <span class="text-[#01DFE1] font-bold">4-6 days</span>.</p>
                                                <div class="h-1 bg-slate-700 rounded-full overflow-hidden">
                                                    <div class="h-full bg-[#01DFE1] w-4/5 rounded-full"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- CTA Section -->
                                    <div class="flex flex-col gap-4 mt-8">
                                        <button @click="presentOffer" class="w-full h-[52px] bg-[#01DFE1] text-[#004F50] rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-[0px_4px_20px_rgba(1,223,225,0.3)] hover:brightness-105 active:scale-[0.98] transition-all">
                                            Present Offer to Customer
                                            <span class="material-symbols-outlined font-bold">arrow_forward</span>
                                        </button>
                                        <div class="grid grid-cols-2 gap-4">
                                            <button class="h-[48px] border-2 border-slate-200 text-slate-600 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-[18px]">edit</span> Manual Override
                                            </button>
                                            <button class="h-[48px] border-2 border-slate-200 text-slate-600 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                                                <span class="material-symbols-outlined text-[18px]">history</span> Price History
                                            </button>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>
                    </main>

                    <!-- SideNavBar Execution (Mobile Only Mockup) -->
                    <nav class="md:hidden flex-shrink-0 bg-white border-t border-slate-100 flex justify-around items-center h-[64px] relative z-50">
                        <div class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer">
                            <span class="material-symbols-outlined">inventory_2</span>
                            <span class="text-[10px] font-semibold">Inventory</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 text-primary cursor-pointer">
                            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">biotech</span>
                            <span class="text-[10px] font-bold">Active</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer">
                            <span class="material-symbols-outlined">analytics</span>
                            <span class="text-[10px] font-semibold">Analytics</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer">
                            <span class="material-symbols-outlined">history</span>
                            <span class="text-[10px] font-semibold">History</span>
                        </div>
                        <div class="flex flex-col items-center gap-1 text-slate-400 cursor-pointer">
                            <span class="material-symbols-outlined">settings</span>
                            <span class="text-[10px] font-semibold">Settings</span>
                        </div>
                    </nav>
                </div>
            </transition>
        </div>
    `
};
