/**
 * LoadingOverlay Component
 * 
 * Full-screen loading overlay with spinner.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.LoadingOverlay = {
    name: 'LoadingOverlay',
    props: {
        message: { type: String, default: 'Loading...' }
    },
    template: `
        <div class="loading-overlay">
            <div class="loader">
                <div class="loader-spinner"></div>
                <p>{{ message }}</p>
            </div>
        </div>
    `
};
