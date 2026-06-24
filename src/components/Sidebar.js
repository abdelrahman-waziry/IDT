/**
 * Sidebar Component – IMTI
 *
 * Fixed left sidebar with branding, navigation, and logout.
 * Based on the Stitch "F1: Dashboard" design.
 */

window.AppComponents = window.AppComponents || {};

window.AppComponents.Sidebar = {
    name: 'Sidebar',
    props: {
        /** Currently active route key: 'dashboard' | 'assessment' | 'apps' | 'settings' */
        activeRoute: { type: String, default: 'dashboard' },
        /** Operator badge / ID displayed in footer area (optional) */
        operatorId: { type: String, default: '' }
    },
    emits: ['navigate', 'logout'],
    setup(props, { emit }) {
        const navItems = [
            { key: 'dashboard',   label: 'Dashboard',       icon: 'grid_view' },
            { key: 'assessment',  label: 'New Assessment',  icon: 'add_circle' },
            { key: 'apps',        label: 'Apps',            icon: 'apps' },
            { key: 'settings',    label: 'Settings',        icon: 'settings' }
        ];

        function onNav(key) { emit('navigate', key); }
        function onLogout()  { emit('logout'); }

        return { navItems, onNav, onLogout };
    },
    template: `
        <aside class="sidebar">
            <!-- Brand -->
            <div class="sidebar__brand">
                <img src="assets/images/imti-logo.png" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px; background: white;" alt="Logo" />
                <div class="sidebar__brand-text" style="margin-left: 12px;">
                    <span class="sidebar__brand-name">IMTI</span>
                    <span class="sidebar__brand-sub">Assessment Platform</span>
                </div>
            </div>

            <!-- Navigation -->
            <nav class="sidebar__nav">
                <a v-for="item in navItems"
                   :key="item.key"
                   class="sidebar__nav-item"
                   :class="{ 'sidebar__nav-item--active': activeRoute === item.key }"
                   href="#"
                   @click.prevent="onNav(item.key)">
                    <span class="sidebar__nav-icon material-symbols-outlined">{{ item.icon }}</span>
                    <span class="sidebar__nav-label">{{ item.label }}</span>
                </a>
            </nav>

            <!-- Footer / logout -->
            <div class="sidebar__footer">
                <a class="sidebar__nav-item" href="#" @click.prevent="onLogout">
                    <span class="sidebar__nav-icon material-symbols-outlined">logout</span>
                    <span class="sidebar__nav-label">Logout</span>
                </a>
            </div>
        </aside>
    `
};
