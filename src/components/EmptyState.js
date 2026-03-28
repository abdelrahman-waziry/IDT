/**
 * EmptyState Component
 * 
 * Shown when no devices are connected.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.EmptyState = {
    name: 'EmptyState',
    template: `
        <div class="empty-state">
            <div class="empty-icon">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="1.5"
                        opacity="0.3" />
                    <circle cx="12" cy="18" r="1.5" fill="currentColor" opacity="0.3" />
                    <line x1="9" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" opacity="0.3" />
                    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" />
                </svg>
            </div>
            <h2>No iOS Devices Detected</h2>
            <p>Connect an iOS device via USB to get started.</p>
            <p class="hint">Make sure to unlock your device and tap "Trust" when prompted.</p>
        </div>
    `
};
