/**
 * Splash View – Fixtech Egypt
 *
 * Premium splash screen based on the Stitch design brief.
 * Features:
 *   - Deep navy backdrop with blurred violet / cyan orb decorations
 *   - Glassmorphic smartphone logo card
 *   - Animated progress bar with gradient fill + glow
 */

window.AppViews = window.AppViews || {};

window.AppViews.Splash = {
    name: 'Splash',
    setup() {
        const progress = Vue.ref(0);
        let rafId = null;

        Vue.onMounted(() => {
            const start = performance.now();
            const duration = 1400; // ms – keeps it snappy

            function tick(now) {
                const elapsed = now - start;
                progress.value = Math.min(Math.round((elapsed / duration) * 100), 100);
                if (elapsed < duration) {
                    rafId = requestAnimationFrame(tick);
                }
            }
            rafId = requestAnimationFrame(tick);
        });

        Vue.onUnmounted(() => {
            if (rafId) cancelAnimationFrame(rafId);
        });

        return { progress };
    },
    template: `
        <div class="splash-screen">
            <!-- Background decoration orbs -->
            <div class="splash-bg-decorations">
                <div class="splash-orb splash-orb--violet"></div>
                <div class="splash-orb splash-orb--cyan"></div>
            </div>

            <!-- Main content -->
            <div class="splash-content">
                <!-- Logo card (glassmorphic) -->
                <div class="splash-logo-card" style="padding: 16px;">
                    <img src="assets/images/coreinspect-logo.png" style="width: 72px; height: 72px; object-fit: contain; border-radius: 12px;" alt="Logo" />
                </div>

                <!-- Brand identity -->
                <div class="splash-brand">
                    <h1 class="splash-brand__name">CoreInspect</h1>
                    <p class="splash-brand__tagline">iPhone Assessment Platform</p>
                </div>

                <!-- Progress / loading block -->
                <div class="splash-loader">
                    <div class="splash-loader__meta">
                        <span class="splash-loader__label">INITIALIZING MODULES</span>
                        <span class="splash-loader__pct">{{ progress }}%</span>
                    </div>
                    <div class="splash-loader__track">
                        <div class="splash-loader__glow" :style="{ width: progress + '%' }"></div>
                        <div class="splash-loader__fill" :style="{ width: progress + '%' }"></div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <p class="splash-footer">v0.0.1 · Authorized Use Only</p>
        </div>
    `
};