/**
 * ToastContainer Component
 * 
 * Manages toast notifications with auto-dismiss and slide animation.
 */

window.AppComponents = window.AppComponents || {};

const TOAST_ICONS = {
    success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M15 9L9 15M9 9L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 16V12M12 8H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 9V13M12 17H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.29 3.86L1.82 18C1.64 18.3 1.55 18.64 1.55 19C1.55 19.36 1.64 19.71 1.82 20.01C2 20.32 2.25 20.57 2.56 20.75C2.87 20.93 3.22 21.02 3.58 21.02H20.42C20.78 21.02 21.13 20.93 21.44 20.75C21.75 20.57 22 20.32 22.18 20.01C22.36 19.71 22.45 19.36 22.45 19C22.45 18.64 22.36 18.3 22.18 18L13.71 3.86C13.53 3.56 13.28 3.31 12.97 3.13C12.66 2.95 12.31 2.86 11.95 2.86C11.59 2.86 11.24 2.95 10.93 3.13C10.62 3.31 10.37 3.56 10.29 3.86Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

// Global toast manager (shared across views)
window.ToastManager = {
    _toasts: null, // Will be set to Vue ref
    _counter: 0,

    init(toastsRef) {
        this._toasts = toastsRef;
    },

    show(message, type = 'info', duration = 3000) {
        if (!this._toasts) return;
        const id = ++this._counter;
        this._toasts.value.push({ id, message, type });
        setTimeout(() => this.remove(id), duration);
    },

    remove(id) {
        if (!this._toasts) return;
        const idx = this._toasts.value.findIndex(t => t.id === id);
        if (idx !== -1) this._toasts.value.splice(idx, 1);
    }
};

window.AppComponents.ToastContainer = {
    name: 'ToastContainer',
    props: {
        toasts: { type: Array, required: true }
    },
    methods: {
        icon(type) {
            return TOAST_ICONS[type] || TOAST_ICONS.info;
        },
        remove(id) {
            window.ToastManager.remove(id);
        }
    },
    template: `
        <div class="toast-container">
            <div v-for="toast in toasts" :key="toast.id"
                 :class="['toast', 'toast-' + toast.type, 'toast-visible']">
                <span class="toast-icon" v-html="icon(toast.type)"></span>
                <span class="toast-message">{{ toast.message }}</span>
                <button class="toast-close" @click="remove(toast.id)">&times;</button>
            </div>
        </div>
    `
};
