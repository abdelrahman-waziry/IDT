/**
 * HomeView – Fixtech Operator Command Center
 *
 * Dashboard view based on the Stitch "F1: Dashboard" design.
 * All data is bound dynamically through props and computed properties —
 * nothing is hard-coded so backend data can be plugged in later.
 */

window.AppViews = window.AppViews || {};

window.AppViews.HomeView = {
    name: 'HomeView',
    props: {
        devices:        { type: Array,   default: () => [] },
        isLoading:      { type: Boolean, default: false },
        statusType:     { type: String,  default: 'ready' },
        statusText:     { type: String,  default: 'Initializing...' },
        refreshLoading: { type: Boolean, default: false },
        /** Dynamic stats pushed from parent / IPC */
        stats: {
            type: Object,
            default: () => ({
                todayAssessments: 0,
                assessmentsDelta: 0,
                acceptedOffers: 0,
                offersDeltaPct: 0,
                pendingReview: 0,
                pendingAlert: ''
            })
        },
        /** Recent assessment rows – array of objects */
        recentAssessments: { type: Array, default: () => [] },
        /** Operator info */
        operatorId: { type: String, default: '' }
    },
    emits: ['refresh', 'generate-report', 'start-assessment', 'navigate', 'logout', 'view-all-assessments', 'resume-session'],

    setup(props, { emit }) {
        const { computed } = Vue;

        // --- Formatted date ---
        const todayLabel = computed(() => {
            const d = new Date();
            const opts = { weekday: 'long', month: 'long', day: 'numeric' };
            return `Overview for ${d.toLocaleDateString('en-US', opts)}`;
        });

        // --- System status badge ---
        const systemOnline = computed(() => props.statusType !== 'error');
        const systemLabel  = computed(() => systemOnline.value ? 'System Online' : 'System Offline');

        // --- Stats cards (dynamic) ---
        const statCards = computed(() => [
            {
                label: "Today's Assessments",
                value: props.stats.todayAssessments,
                delta: props.stats.assessmentsDelta > 0 ? `+${props.stats.assessmentsDelta}` : null,
                deltaType: 'positive',
                icon: 'assignment'
            },
            {
                label: 'Accepted Offers',
                value: formatCurrency(props.stats.acceptedOffers),
                delta: props.stats.offersDeltaPct > 0 ? `+${props.stats.offersDeltaPct}%` : null,
                deltaType: 'positive',
                icon: 'payments'
            },
            {
                label: 'Pending Review',
                value: props.stats.pendingReview,
                delta: props.stats.pendingAlert || null,
                deltaType: 'warning',
                icon: 'warning'
            }
        ]);

        // --- Assessment status styling ---
        function statusClass(status) {
            const map = {
                accepted:       'dash-status--accepted',
                draft:          'dash-status--draft',
                pending_review: 'dash-status--pending',
                rejected:       'dash-status--rejected',
                failed:         'dash-status--failed'
            };
            return map[(status || '').toLowerCase().replace(/\s+/g, '_')] || 'dash-status--draft';
        }

        function authIcon(passed) {
            return passed ? 'check_circle' : 'error';
        }
        function authClass(passed) {
            return passed ? 'dash-auth--pass' : 'dash-auth--fail';
        }

        function hwBadgeClass(score) {
            if (score == null) return '';
            if (score >= 90) return 'dash-hw--good';
            if (score >= 70) return 'dash-hw--warn';
            return 'dash-hw--fail';
        }

        function formatCurrency(val) {
            if (val == null || val === 0) return 'EGP 0';
            return 'EGP ' + Number(val).toLocaleString('en-EG');
        }

        return {
            todayLabel,
            systemOnline,
            systemLabel,
            statCards,
            statusClass,
            authIcon,
            authClass,
            hwBadgeClass,
            formatCurrency
        };
    },

    template: `
        <div class="dash-layout">
            <!-- Sidebar -->
            <Sidebar
                active-route="dashboard"
                :operator-id="operatorId"
                @navigate="$emit('navigate', $event)"
                @logout="$emit('logout')"
            />

            <!-- Main Canvas -->
            <main class="dash-main">
                <!-- Loading overlay -->
                <LoadingOverlay v-if="isLoading" message="Scanning for devices..." />

                <!-- Header -->
                <header class="dash-header">
                    <div class="dash-header__left">
                        <div class="dash-header__title-row">
                            <h1 class="dash-header__title">Operator Command Center</h1>
                            <span class="dash-header__badge"
                                  :class="systemOnline ? 'dash-header__badge--online' : 'dash-header__badge--offline'">
                                <span class="dash-header__badge-dot"></span>
                                {{ systemLabel }}
                            </span>
                        </div>
                        <p class="dash-header__subtitle">{{ todayLabel }}</p>
                    </div>
                    <div class="dash-header__right">
                        <button id="refresh-btn"
                                class="dash-header__icon-btn"
                                @click="$emit('refresh')"
                                :disabled="refreshLoading"
                                :class="{ 'is-spinning': refreshLoading }"
                                title="Refresh devices">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <path d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C15.3 3 18.19 4.78 19.75 7.43"
                                    stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                                <path d="M21 3V8H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        </button>
                        <div v-if="operatorId" class="dash-header__operator">
                            <div class="dash-header__operator-avatar">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
                                    <path d="M20 21C20 16.58 16.42 13 12 13C7.58 13 4 16.58 4 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                </svg>
                            </div>
                            <span class="dash-header__operator-id">{{ operatorId }}</span>
                        </div>
                    </div>
                </header>

                <!-- Stats Row -->
                <section class="dash-stats">
                    <div v-for="(card, i) in statCards" :key="i" class="dash-stat-card">
                        <div class="dash-stat-card__body">
                            <p class="dash-stat-card__label">{{ card.label }}</p>
                            <div class="dash-stat-card__value-row">
                                <span class="dash-stat-card__value">{{ card.value }}</span>
                                <span v-if="card.delta"
                                      class="dash-stat-card__delta"
                                      :class="'dash-stat-card__delta--' + card.deltaType">
                                    {{ card.delta }}
                                </span>
                            </div>
                        </div>
                        <span class="dash-stat-card__bg-icon material-symbols-outlined">{{ card.icon }}</span>
                    </div>
                </section>

                <!-- Hero CTA -->
                <section class="dash-hero">
                    <div class="dash-hero__visual">
                        <div class="dash-hero__gradient"></div>
                        <div class="dash-hero__icon-wrap">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                                <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/>
                                <circle cx="12" cy="18" r="1.25" fill="currentColor"/>
                                <line x1="9.5" y1="5" x2="14.5" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </div>
                    </div>
                    <div class="dash-hero__content">
                        <div class="dash-hero__heading-row">
                            <h2 class="dash-hero__heading">Start New Assessment</h2>
                            <span class="dash-hero__time-badge">Under 3 minutes</span>
                        </div>
                        <p class="dash-hero__desc">
                            Connect the customer's iPhone to begin automated hardware validation
                            and cosmetic grading. Real-time telemetry will sync with the command center.
                        </p>
                        <button class="dash-hero__btn" @click="$emit('start-assessment')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                                <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                            Initialize Diagnostics
                        </button>
                    </div>
                </section>

                <!-- Recent Assessments Table -->
                <section class="dash-table-section">
                    <div class="dash-table-section__header">
                        <h3 class="dash-table-section__title">Recent Assessments</h3>
                        <a class="dash-table-section__link" href="#" @click.prevent="$emit('view-all-assessments')">
                            View All
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </a>
                    </div>
                    <div class="dash-table-wrap">
                        <!-- Empty state -->
                        <div v-if="recentAssessments.length === 0 && !isLoading" class="dash-table-empty">
                            <p>No assessments yet. Connect a device to get started.</p>
                        </div>

                        <table v-else class="dash-table">
                            <thead>
                                <tr>
                                    <th>Session ID</th>
                                    <th>Device</th>
                                    <th>Auth</th>
                                    <th>Hardware</th>
                                    <th>Cosmetic</th>
                                    <th>Offer</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in recentAssessments" :key="row.sessionId">
                                    <td class="dash-table__mono">{{ row.sessionId }}</td>
                                    <td>
                                        <div class="dash-table__device">
                                            <span class="dash-table__device-name">{{ row.deviceName }}</span>
                                            <span class="dash-table__device-sn">SN: {{ row.serialNumber }}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span class="material-symbols-outlined dash-table__auth"
                                              :class="authClass(row.authPassed)"
                                              style="font-variation-settings: 'FILL' 1;">
                                            {{ authIcon(row.authPassed) }}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="dash-hw-badge" :class="hwBadgeClass(row.hardwareScore)">
                                            {{ row.hardwareScore != null ? row.hardwareScore + '/100' : '—' }}
                                        </span>
                                    </td>
                                    <td class="dash-table__cosmetic">{{ row.cosmeticGrade || '—' }}</td>
                                    <td class="dash-table__mono dash-table__offer">{{ row.offer ? formatCurrency(row.offer) : '—' }}</td>
                                    <td>
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            <span class="dash-status-badge" :class="statusClass(row.status)">
                                                {{ row.status }}
                                            </span>
                                            <button v-if="row.status === 'Draft' || row.status === 'Abandoned'" 
                                                    @click="$emit('resume-session', { rawSessionId: row.rawSessionId, uuid: row.uuid })"
                                                    class="dash-header__icon-btn" 
                                                    style="width:28px;height:28px;background:white;border:1px solid #E2E8F0;color:#711FFF"
                                                    title="Resume Session">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                                    <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    `
};
