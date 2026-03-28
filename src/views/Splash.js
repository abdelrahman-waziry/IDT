/**
 * Splash View
 * 
 * Displays a splash screen with the app logo and loading indicator.
 */

window.AppViews = window.AppViews || {};

window.AppViews.Splash = {
    name: 'Splash',
    template: `
        <div class="app-container">
            <div class="splash-screen">
                <div class="splash-logo">
                    <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="2" />
                        <circle cx="12" cy="18" r="1.5" fill="currentColor" />
                        <line x1="9" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" />
                    </svg>
                </div>
                <h1 class="splash-title">iOS Device Manager</h1>
                <p class="splash-subtitle">Loading...</p>
            </div>
        </div>
    `
};