/**
 * AppHeader Component
 * 
 * Shared header with back button (optional), title, and action buttons.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.AppHeader = {
    name: 'AppHeader',
    props: {
        title: { type: String, default: 'iOS Device Manager' },
        subtitle: { type: String, default: 'Device Diagnostics & Reporting' },
        showBack: { type: Boolean, default: false },
        showLogo: { type: Boolean, default: false }
    },
    emits: ['back'],
    template: `
        <header class="app-header">
            <div class="header-left">
                <!-- Back Button -->
                <button v-if="showBack" id="back-btn" class="btn btn-secondary" @click="$emit('back')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span>Back</span>
                </button>

                <!-- Logo -->
                <div v-if="showLogo" class="logo">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="2" />
                        <circle cx="12" cy="18" r="1.5" fill="currentColor" />
                        <line x1="9" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" />
                    </svg>
                </div>

                <div class="header-title">
                    <h1>{{ title }}</h1>
                    <span class="subtitle">{{ subtitle }}</span>
                </div>
            </div>
            <div class="header-actions">
                <slot name="actions"></slot>
            </div>
        </header>
    `
};
