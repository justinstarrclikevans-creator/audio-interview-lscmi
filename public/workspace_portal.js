// Turn90 Progressive-Disclosure Operations Workspace Controller
(function () {
    'use strict';

    // Conditional Popover API polyfill (only when native popover is missing)
    if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
        const polyScript = document.createElement('script');
        polyScript.type = 'module';
        polyScript.src = 'https://unpkg.com/@oddbird/popover-polyfill@latest/dist/popover.min.js';
        document.head.appendChild(polyScript);
    }

    const VALID_CENTERS = [
        'Charleston',
        'Columbia',
        'Spartanburg',
        'Reentry Navigation',
        'Prison Program'
    ];

    const state = {
        overview: null,
        caseloads: [],
        todos: null,
        searchParticipants: [],
        activeFileSlug: null,
        activeFile: null,
        searchQuery: '',
        searchCenter: 'all',
        searchFilter: 'all',
        showCompletedTodos: false,
        ssnRevealed: false
    };

    const esc = (v) => {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(v);
        if (v === null || v === undefined) return '';
        return String(v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const renderMd = (mdText, emptyText = 'None recorded yet.') => {
        if (!mdText || !String(mdText).trim()) {
            return `<p style="color: #475569; font-style: italic; margin: 0;">${esc(emptyText)}</p>`;
        }
        try {
            if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
                return `<div class="cfp-md-rendered" style="font-size: 0.92rem; line-height: 1.6; color: #1e293b;">${marked.parse(String(mdText))}</div>`;
            }
        } catch (e) {}
        return `<pre style="white-space: pre-wrap; font-size: 0.88rem; color: #1e293b; margin: 0;">${esc(mdText)}</pre>`;
    };

    async function wpAuthFetch(url, options = {}) {
        const token = localStorage.getItem('fs_token');
        const headers = new Headers(options.headers || {});
        if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        const res = await fetch(url, { ...options, headers });
        const raw = await res.text();
        let data = {};
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch (e) {
            data = { error: `Unexpected server response (HTTP ${res.status}).` };
        }
        if (res.status === 401) {
            if (typeof window.handleLogout === 'function') window.handleLogout();
            throw new Error(data.error || 'Session expired. Please sign in again.');
        }
        if (!res.ok) {
            const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    window.wpAuthFetch = wpAuthFetch;

    function isUserAdmin(u) {
        if (!u) return false;
        const ut = String(u.user_type || '').toLowerCase();
        const role = String(u.role || '').toLowerCase();
        const pt = String(u.portal_type || '').toLowerCase();
        return ut === 'admin' || role === 'admin' || role === 'director' || pt === 'admin' || pt === 'supervisor';
    }

    function showGlobalStatus(message, isError = false) {
        const box = document.getElementById('wp-global-status');
        if (!box) return;
        box.textContent = message;
        box.className = isError ? 'wp-error-banner' : 'wp-status-banner';
        box.classList.remove('hidden');
        clearTimeout(showGlobalStatus._timer);
        showGlobalStatus._timer = setTimeout(() => {
            box.classList.add('hidden');
        }, 6500);
    }

    function hideToolsPopover() {
        const pop = document.getElementById('wp-tools-popover');
        if (!pop) return;
        try {
            if (typeof pop.hidePopover === 'function') pop.hidePopover();
            else pop.classList.remove(':popover-open');
        } catch (e) {}
    }

    function renderToolsPopover(user) {
        const pop = document.getElementById('wp-tools-popover');
        if (!pop || !user) return;
        const admin = isUserAdmin(user);
        pop.innerHTML = `
            <div class="wp-popover-list">
                <div class="wp-popover-heading">Turn90 Operations Tools</div>
                <button type="button" class="wp-popover-btn" data-wp-tool="coaching">🎓 Class &amp; CM Coaching</button>
                <button type="button" class="wp-popover-btn" data-wp-tool="supervision">📊 Supervision Report (SkillCat + Apricot)</button>
                <button type="button" class="wp-popover-btn" data-wp-tool="voice">🎙️ Voice Recognition (30s Staff Script)</button>
                <button type="button" class="wp-popover-btn" data-wp-tool="templates">📐 CM &amp; Screening Templates / Skills</button>
                ${admin ? `
                    <div class="wp-popover-heading" style="margin-top: 4px; border-top: 1px solid #e2e8f0; padding-top: 8px;">Admin Tools</div>
                    <button type="button" class="wp-popover-btn" data-wp-tool="manage-users">👥 Manage Staff Accounts &amp; Permissions</button>
                    <button type="button" class="wp-popover-btn" data-wp-tool="toggle-legacy-bar">🧭 Show / Hide Legacy 6-Dashboard Bar</button>
                ` : ''}
                <div class="wp-popover-heading" style="margin-top: 4px; border-top: 1px solid #e2e8f0; padding-top: 8px;">Account</div>
                <button type="button" class="wp-popover-btn" data-wp-tool="change-password">🔑 Change My Password</button>
            </div>
        `;
    }

    window.renderWorkspaceHeaderControls = function (user) {
        const navRight = document.getElementById('nav-user-section');
        const dashBar = document.getElementById('six-dashboards-bar');
        if (dashBar) {
            dashBar.classList.add('hidden');
            dashBar.classList.add('wp-hidden');
        }
        if (!navRight) return;
        if (!user) {
            navRight.innerHTML = `<span style="font-size: 0.86rem; color: #cbd5e1; font-weight: 600;">🔒 Protected Staff Portal</span>`;
            return;
        }
        const admin = isUserAdmin(user);
        const roleBadge = admin
            ? 'Admin • All 5 Centers'
            : `User • ${esc(user.assigned_center || user.location || 'Center')}`;

        navRight.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span style="font-size: 0.82rem; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.14); color: #f8fafc; font-weight: 700; border: 1px solid rgba(255,255,255,0.28);">
                    ${esc(user.name)} (${esc(roleBadge)})
                </span>
                <button type="button" id="btn-wp-nav-home" class="btn btn-outline" style="padding: 5px 12px; font-size: 0.85rem; min-height: 36px;">
                    🏠 Workspace
                </button>
                <button type="button" popovertarget="wp-tools-popover" id="btn-wp-tools-trigger" class="btn btn-outline" style="padding: 5px 12px; font-size: 0.85rem; min-height: 36px;">
                    🧰 Tools ▾
                </button>
                <button type="button" id="btn-wp-signout" class="btn btn-outline" style="padding: 5px 12px; font-size: 0.85rem; min-height: 36px;">
                    Sign Out
                </button>
            </div>
        `;
        renderToolsPopover(user);

        const homeBtn = document.getElementById('btn-wp-nav-home');
        if (homeBtn) {
            homeBtn.addEventListener('click', () => {
                hideToolsPopover();
                if (typeof window.showView === 'function') window.showView('view-workspace-portal');
                if (typeof window.initWorkspacePortal === 'function') window.initWorkspacePortal();
            });
        }

        const signOutBtn = document.getElementById('btn-wp-signout');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => {
                hideToolsPopover();
                if (typeof window.handleLogout === 'function') window.handleLogout();
            });
        }
    };

    async function handleEmailLoginSubmit(e) {
        e.preventDefault();
        const emailEl = document.getElementById('login-email');
        const passEl = document.getElementById('login-password');
        const errBox = document.getElementById('email-login-error');
        const btn = document.getElementById('btn-email-signin');

        const email = (emailEl?.value || '').trim();
        const password = passEl?.value || '';

        if (errBox) {
            errBox.textContent = '';
            errBox.classList.add('hidden');
        }
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Signing in...';
        }

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Invalid email or password.');

            localStorage.setItem('fs_token', data.token);
            window.currentUser = data.user;
            if (typeof currentUser !== 'undefined') currentUser = data.user;

            if (typeof window.updateNav === 'function') window.updateNav();
            if (typeof window.routeUserToPortal === 'function') window.routeUserToPortal();
        } catch (err) {
            if (errBox) {
                errBox.textContent = err.message || 'Sign in failed.';
                errBox.classList.remove('hidden');
            }
            if (passEl) passEl.focus();
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Sign In';
            }
        }
    }

    // ------------------------------------------------------------------------
    // WORKSPACE OVERVIEW LOADING & RENDERING (CASELOADS -> TO-DOS -> SEARCH)
    // ------------------------------------------------------------------------
    window.initWorkspacePortal = async function (forceRefresh = false) {
        const user = (typeof currentUser !== 'undefined' ? currentUser : null) || window.currentUser;
        if (!user) return;

        const heading = document.getElementById('wp-workspace-heading');
        const sub = document.getElementById('wp-workspace-subtitle');
        const admin = isUserAdmin(user);

        if (heading) {
            heading.textContent = admin
                ? 'Turn90 Master Operations Workspace'
                : `${user.assigned_center || user.location || 'Center'} Workspace`;
        }
        if (sub) {
            sub.textContent = admin
                ? 'Admin View — Access across Charleston, Columbia, Spartanburg, Reentry Navigation, and Prison Program.'
                : `Center User View — Scoped to ${user.assigned_center || user.location}.`;
        }

        try {
            const data = await wpAuthFetch(`/api/workspace/overview${forceRefresh ? '?refresh=1' : ''}`);
            state.overview = data;
            state.caseloads = data.caseloads || [];
            state.todos = data.todos || { open_count: 0, completed_count: 0, groups: [], items: [] };
            const allMap = new Map();
            for (const bucket of state.caseloads) {
                for (const p of bucket.participants || []) {
                    allMap.set(p.participant_key, p);
                }
            }
            state.searchParticipants = Array.from(allMap.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));

            renderCaseloadSection();
            renderTodosSection();
            renderSearchSection();

            if (state.activeFileSlug) {
                await window.openWorkspaceParticipantFile(state.activeFileSlug, { preserveScroll: true });
            }
        } catch (err) {
            showGlobalStatus(`Could not load workspace: ${err.message}`, true);
        }
    };

    window.refreshActiveParticipantFileIfOpen = function () {
        const fileShell = document.getElementById('wp-participant-file-shell');
        if (state.activeFileSlug && fileShell && !fileShell.classList.contains('hidden')) {
            window.openWorkspaceParticipantFile(state.activeFileSlug, { preserveScroll: true });
        }
    };

    function renderParticipantCardHtml(p, centerContext = '') {
        const isDualHere = Boolean(p.is_dual_attached_reentry && p.dual_attached_center);
        const dualLabel = isDualHere
            ? `<span class="wp-pill wp-pill-purple">RN + ${esc(p.dual_attached_center)}</span>`
            : '';
        const statusPill = p.status === 'active'
            ? `<span class="wp-pill wp-pill-green">Active</span>`
            : `<span class="wp-pill">${esc(p.status || 'Archived')}</span>`;
        const wlPill = `<span class="wp-pill ${p.waitlist_ready ? 'wp-pill-green' : 'wp-pill-amber'}">Briefcase ${Number(p.waitlist_met_count || 0)}/9</span>`;
        const todoPill = p.open_todos_count > 0
            ? `<span class="wp-pill wp-pill-amber">${p.open_todos_count} To-Do</span>`
            : '';
        const docPill = (p.has_lscmi_brief || p.has_action_plan)
            ? `<span class="wp-pill wp-pill-blue">LS/CMI Ready</span>`
            : '';

        const otherCenters = (p.centers || []).filter(c => c !== centerContext);
        const attachedLine = otherCenters.length > 0 && centerContext
            ? `Also in: ${otherCenters.join(', ')}`
            : `Centers: ${(p.centers || []).join(', ')}`;

        return `
            <button type="button" class="wp-client-card" data-open-participant="${esc(p.participant_key)}">
                <div class="wp-client-card-head">
                    <span class="wp-client-name">${esc(p.name)}</span>
                    ${statusPill}
                </div>
                <div style="font-size: 0.82rem; color: #475569;">
                    PM: <strong>${esc(p.assigned_program_manager || 'Unassigned')}</strong> • ${esc(attachedLine)}
                </div>
                <div class="wp-pill-row">
                    ${dualLabel}
                    ${wlPill}
                    ${todoPill}
                    ${docPill}
                </div>
            </button>
        `;
    }

    function renderCaseloadSection() {
        const body = document.getElementById('wp-caseload-body');
        const badge = document.getElementById('wp-caseload-summary-badge');
        if (!body) return;

        const buckets = state.caseloads || [];
        const uniqueTotal = state.searchParticipants.length;
        if (badge) {
            badge.textContent = `${buckets.length} Center${buckets.length === 1 ? '' : 's'} • ${uniqueTotal} Clients`;
        }

        if (buckets.length === 0) {
            body.innerHTML = `<p style="color: #475569; margin: 0;">No centers assigned to this account.</p>`;
            return;
        }

        const autoOpenSingle = buckets.length === 1;
        body.innerHTML = buckets.map((b, idx) => `
            <details class="wp-disclosure wp-subdisclosure" ${(autoOpenSingle || idx === 0 && buckets.length <= 1) ? 'open' : ''}>
                <summary>
                    <span class="wp-summary-title">${esc(b.center)}</span>
                    <span class="wp-summary-badge wp-summary-badge-blue">${b.total} total (${b.active_count} active)</span>
                    ${b.dual_attached_count > 0 ? `<span class="wp-summary-badge wp-summary-badge-purple">${b.dual_attached_count} RN + Center</span>` : ''}
                </summary>
                <div class="wp-disclosure-body">
                    ${b.participants.length === 0
                        ? `<p style="color: #475569; margin: 0;">No participants currently listed in ${esc(b.center)}.</p>`
                        : `<div class="wp-client-grid">${b.participants.map(p => renderParticipantCardHtml(p, b.center)).join('')}</div>`}
                </div>
            </details>
        `).join('');
    }

    function renderTodosSection() {
        const body = document.getElementById('wp-todos-body');
        const badge = document.getElementById('wp-todos-summary-badge');
        if (!body) return;

        const td = state.todos || { open_count: 0, completed_count: 0, groups: [], items: [] };
        if (badge) {
            badge.textContent = `${td.open_count} open / ${td.completed_count} done`;
        }

        const clientOptions = state.searchParticipants
            .map(p => `<option value="${esc(p.participant_key)}">${esc(p.name)} (${esc((p.centers || []).join(', '))})</option>`)
            .join('');

        const groupsHtml = (td.groups || []).map(g => {
            const visibleItems = (g.todos || []).filter(t => state.showCompletedTodos || !t.completed);
            if (visibleItems.length === 0) return '';
            return `
                <div class="wp-todo-group">
                    <div class="wp-todo-group-header">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <strong style="font-size: 0.98rem; color: #0f172a;">${esc(g.participant_name)}</strong>
                            <span class="wp-pill wp-pill-blue">${esc((g.centers || []).join(', '))}</span>
                            ${g.assigned_program_manager ? `<span class="wp-pill">PM: ${esc(g.assigned_program_manager)}</span>` : ''}
                        </div>
                        <button type="button" class="wp-btn wp-btn-sm" data-open-participant="${esc(g.participant_key)}">Open File</button>
                    </div>
                    ${visibleItems.map(item => `
                        <div class="wp-todo-item ${item.completed ? 'is-completed' : ''}">
                            <input
                                type="checkbox"
                                id="wp-todo-cb-${item.id}"
                                data-todo-toggle="${item.id}"
                                ${item.completed ? 'checked' : ''}
                                aria-label="Mark completed: ${esc(item.title)}"
                            >
                            <div style="flex: 1;">
                                <label for="wp-todo-cb-${item.id}" class="wp-todo-title" style="cursor: pointer;">${esc(item.title)}</label>
                                <div class="wp-todo-meta">
                                    ${item.source === 'manual' ? 'Manual' : (item.source === 'apricot_eval' ? 'Case Plan / Note Step' : 'Case Note')}
                                    ${item.source_date ? ` • ${esc(item.source_date)}` : ''}
                                    ${item.details ? ` — ${esc(item.details)}` : ''}
                                </div>
                            </div>
                            ${item.source === 'manual'
                                ? `<button type="button" class="wp-btn wp-btn-sm" data-todo-delete="${item.id}" aria-label="Delete manual to-do">✕</button>`
                                : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }).filter(Boolean).join('');

        body.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
                <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer;">
                    <input type="checkbox" id="wp-toggle-show-completed-todos" ${state.showCompletedTodos ? 'checked' : ''} style="width: 18px; height: 18px;">
                    Show completed items (${td.completed_count})
                </label>
                <div class="wp-actions-row">
                    <button type="button" id="btn-wp-refresh-todos" class="wp-btn wp-btn-sm">🔄 Re-scan Case Notes</button>
                </div>
            </div>

            <details class="wp-disclosure wp-subdisclosure" style="margin-bottom: 14px;">
                <summary><span class="wp-summary-title">+ Add Manual Next Step</span></summary>
                <div class="wp-disclosure-body">
                    <form id="form-wp-add-todo">
                        <div class="wp-form-grid">
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-add-todo-client">Participant</label>
                                <select id="wp-add-todo-client" class="wp-select" required>${clientOptions}</select>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-add-todo-title">Next Step</label>
                                <input type="text" id="wp-add-todo-title" class="wp-input" required placeholder="e.g. Verify SCDMV fee waiver receipt">
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-add-todo-details">Notes (Optional)</label>
                                <input type="text" id="wp-add-todo-details" class="wp-input" placeholder="Context or target date">
                            </div>
                        </div>
                        <div style="margin-top: 10px;">
                            <button type="submit" class="wp-btn wp-btn-primary wp-btn-sm">Save Next Step</button>
                        </div>
                    </form>
                </div>
            </details>

            ${groupsHtml || '<p style="color: #475569; margin: 0;">All open next steps are checked off! Check "Show completed items" or re-scan case notes.</p>'}
        `;
    }

    function getFilteredSearchParticipants() {
        const qLow = (state.searchQuery || '').trim().toLowerCase();
        return (state.searchParticipants || []).filter(p => {
            if (state.searchCenter !== 'all' && !(p.centers || []).includes(state.searchCenter)) {
                return false;
            }
            if (state.searchFilter === 'has_brief' && !p.has_lscmi_brief) return false;
            if (state.searchFilter === 'has_action_plan' && !p.has_action_plan) return false;
            if (state.searchFilter === 'waitlist_ready' && !p.waitlist_ready) return false;
            if (state.searchFilter === 'needs_waitlist' && p.waitlist_ready) return false;
            if (state.searchFilter === 'dual_reentry' && !p.is_dual_attached_reentry) return false;
            if (state.searchFilter === 'has_todos' && !(p.open_todos_count > 0)) return false;

            if (qLow) {
                const hay = [
                    p.name,
                    p.participant_key,
                    (p.centers || []).join(' '),
                    p.assigned_program_manager,
                    p.apricot_id,
                    p.phone,
                    p.email
                ].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(qLow)) return false;
            }
            return true;
        });
    }

    function renderSearchResultsIntoGrid() {
        const grid = document.getElementById('wp-search-results-grid');
        const badge = document.getElementById('wp-search-summary-badge');
        const matches = getFilteredSearchParticipants();
        if (badge) badge.textContent = `${matches.length} client${matches.length === 1 ? '' : 's'}`;
        if (!grid) return;

        grid.innerHTML = matches.length === 0
            ? `<p style="color: #475569; margin: 0;">No accessible clients match your search filter.</p>`
            : `<div class="wp-client-grid">${matches.map(p => renderParticipantCardHtml(p, '')).join('')}</div>`;
    }

    function renderSearchSection() {
        const body = document.getElementById('wp-search-body');
        if (!body) return;

        const allowedCenters = (state.overview && state.overview.allowed_centers) || VALID_CENTERS;
        const centerOpts = allowedCenters.length > 1
            ? `<option value="all">All Centers</option>${allowedCenters.map(c => `<option value="${esc(c)}" ${state.searchCenter === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}`
            : `<option value="${esc(allowedCenters[0])}">${esc(allowedCenters[0])} Only</option>`;

        const newClientCenterOpts = allowedCenters
            .map(c => `<option value="${esc(c)}">${esc(c)}</option>`)
            .join('');

        body.innerHTML = `
            <search>
                <form id="form-wp-search-clients" action="/api/workspace/search" method="GET">
                    <div class="wp-form-grid" style="align-items: end; margin-bottom: 12px;">
                        <div class="wp-field" style="margin-block-end: 0; grid-column: span 2;">
                            <label for="wp-client-search-input">Find Participant</label>
                            <input
                                type="search"
                                id="wp-client-search-input"
                                name="q"
                                class="wp-input"
                                value="${esc(state.searchQuery)}"
                                placeholder="Search by name, center, PM, Apricot ID, phone, or email..."
                                autocorrect="off"
                                autocapitalize="none"
                                spellcheck="false"
                                enterkeyhint="search"
                            >
                        </div>
                        <div class="wp-field" style="margin-block-end: 0;">
                            <label for="wp-client-center-filter">Center Scope</label>
                            <select id="wp-client-center-filter" class="wp-select">
                                ${centerOpts}
                            </select>
                        </div>
                        <div class="wp-field" style="margin-block-end: 0;">
                            <label for="wp-client-doc-filter">Filter Status</label>
                            <select id="wp-client-doc-filter" class="wp-select">
                                <option value="all" ${state.searchFilter === 'all' ? 'selected' : ''}>All Clients</option>
                                <option value="has_todos" ${state.searchFilter === 'has_todos' ? 'selected' : ''}>Has Open To-Dos</option>
                                <option value="dual_reentry" ${state.searchFilter === 'dual_reentry' ? 'selected' : ''}>Reentry Nav + Center PM</option>
                                <option value="waitlist_ready" ${state.searchFilter === 'waitlist_ready' ? 'selected' : ''}>Briefcase Waitlist Ready (9/9)</option>
                                <option value="needs_waitlist" ${state.searchFilter === 'needs_waitlist' ? 'selected' : ''}>Needs Briefcase Items</option>
                                <option value="has_brief" ${state.searchFilter === 'has_brief' ? 'selected' : ''}>Has LS/CMI Brief</option>
                                <option value="has_action_plan" ${state.searchFilter === 'has_action_plan' ? 'selected' : ''}>Has Action Plan</option>
                            </select>
                        </div>
                    </div>
                </form>
            </search>

            <details class="wp-disclosure wp-subdisclosure" style="margin-bottom: 14px;">
                <summary><span class="wp-summary-title">+ Create New Client File</span></summary>
                <div class="wp-disclosure-body">
                    <form id="form-wp-create-client">
                        <div class="wp-form-grid">
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-new-client-name">Full Name</label>
                                <input type="text" id="wp-new-client-name" class="wp-input" autocomplete="name" required placeholder="First and Last Name">
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-new-client-center">Primary Center</label>
                                <select id="wp-new-client-center" class="wp-select" required>${newClientCenterOpts}</select>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-new-client-pm">Assigned Program Manager</label>
                                <input type="text" id="wp-new-client-pm" class="wp-input" placeholder="e.g. Terrence Brown">
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-new-client-phone">Phone</label>
                                <input type="tel" id="wp-new-client-phone" class="wp-input" autocomplete="tel" placeholder="(843) 555-0100">
                            </div>
                        </div>
                        <div style="margin-top: 10px;">
                            <button type="submit" class="wp-btn wp-btn-primary wp-btn-sm">Create Participant File</button>
                        </div>
                    </form>
                </div>
            </details>

            <div id="wp-search-results-grid"></div>
        `;

        renderSearchResultsIntoGrid();
    }

    // ------------------------------------------------------------------------
    // INDIVIDUAL 5-SECTION PROGRESSIVE-DISCLOSURE PARTICIPANT FILE
    // ------------------------------------------------------------------------
    window.openWorkspaceParticipantFile = async function (slug, { preserveScroll = false } = {}) {
        const mainSections = document.getElementById('wp-main-sections');
        const fileShell = document.getElementById('wp-participant-file-shell');
        if (!fileShell) return;

        state.activeFileSlug = slug;
        if (!preserveScroll) {
            state.ssnRevealed = false;
            fileShell.innerHTML = `<div class="wp-file-header"><p style="margin: 0; color: #475569;">⏳ Loading participant file...</p></div>`;
            if (mainSections) mainSections.classList.add('hidden');
            fileShell.classList.remove('hidden');
        }

        try {
            const file = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(slug)}`);
            state.activeFile = file;
            renderParticipantFileShell(file);
            if (mainSections) mainSections.classList.add('hidden');
            fileShell.classList.remove('hidden');
            if (!preserveScroll) {
                fileShell.focus({ preventScroll: false });
            }
        } catch (err) {
            showGlobalStatus(`Could not open participant file: ${err.message}`, true);
            if (!preserveScroll) {
                closeWorkspaceParticipantFile();
            }
        }
    };

    function closeWorkspaceParticipantFile() {
        state.activeFileSlug = null;
        state.activeFile = null;
        const mainSections = document.getElementById('wp-main-sections');
        const fileShell = document.getElementById('wp-participant-file-shell');
        if (fileShell) {
            fileShell.classList.add('hidden');
            fileShell.innerHTML = '';
        }
        if (mainSections) mainSections.classList.remove('hidden');
        renderCaseloadSection();
        renderTodosSection();
        renderSearchResultsIntoGrid();
    }

    function renderDocRowsHtml(slug, list = [], lscmiClientId = '') {
        if (!list || list.length === 0) {
            return `<p style="font-size: 0.85rem; color: #64748b; margin: 4px 0;">None on file.</p>`;
        }
        return list.map(doc => {
            const isPdf = String(doc.filename || '').toLowerCase().endsWith('.pdf');
            const viewAction = isPdf
                ? `<a class="wp-btn wp-btn-sm" href="${esc(doc.raw_url)}?token=${encodeURIComponent(localStorage.getItem('fs_token') || '')}" target="_blank" rel="noopener">📄 Open PDF</a>`
                : `<button type="button" class="wp-btn wp-btn-sm" onclick="previewDocument('${esc(doc.filename).replace(/'/g, "\\'")}')">👁️ View</button>`;
            const dlUrl = `/api/participants/folder/${encodeURIComponent(slug)}/file/${encodeURIComponent(doc.scope || 'documents')}/${encodeURIComponent(doc.filename)}?download=1&token=${encodeURIComponent(localStorage.getItem('fs_token') || '')}`;
            const printUrl = `/api/participants/folder/${encodeURIComponent(slug)}/file/${encodeURIComponent(doc.scope || 'documents')}/${encodeURIComponent(doc.filename)}?print=1&autoprint=true&token=${encodeURIComponent(localStorage.getItem('fs_token') || '')}`;
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; margin-bottom: 6px;">
                    <div style="min-width: 180px;">
                        <div style="font-size: 0.86rem; font-weight: 700; color: #0f172a;">${esc(doc.filename)}</div>
                        <div style="font-size: 0.76rem; color: #64748b;">${doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : ''}</div>
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${viewAction}
                        ${!isPdf ? `<a class="wp-btn wp-btn-sm" href="${printUrl}" target="_blank" rel="noopener">🖨️ Print</a>` : ''}
                        <a class="wp-btn wp-btn-sm" href="${dlUrl}" download>⬇️ Download</a>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderParticipantFileShell(file) {
        const shell = document.getElementById('wp-participant-file-shell');
        if (!shell || !file) return;

        // Populate legacy currentInterviewsData map so Supervisor Phase 2 HITL modal works directly
        window.currentInterviewsData = window.currentInterviewsData || {};
        if (file.lscmi?.lscmi_client_id) {
            window.currentInterviewsData[file.lscmi.lscmi_client_id] = file.lscmi.lscmi_files || [];
        }

        const bi = file.basic_info || {};
        const scr = file.screening || {};
        const con = file.consultation || {};
        const ls = file.lscmi || {};
        const docs = ls.lscmi_documents || {};
        const bcSchema = (file.briefcase && file.briefcase.schema) || { waitlist_requirements: [], employment_and_pathways: [], benefits_and_financial: [] };
        const bc = (file.briefcase && file.briefcase.state) || {};
        const bcItems = bc.items || {};
        const hasChronic = bc.has_chronic_health_condition === 'yes';

        const admin = isUserAdmin((typeof currentUser !== 'undefined' ? currentUser : null) || window.currentUser);
        const lscmiIdEsc = esc(ls.lscmi_client_id || `${file.participant_key}_Charleston`).replace(/'/g, "\\'");
        const nameEsc = esc(file.name).replace(/'/g, "\\'");
        const primaryBriefMd = (docs.briefs && docs.briefs.find(f => f.ext === '.md')?.filename) || '';
        const primaryPlanMd = (docs.action_plans && docs.action_plans.find(f => f.ext === '.md')?.filename) || '';
        const primaryScoringMd = (docs.scoring_forms && (docs.scoring_forms.find(f => f.filename.includes('_final_scoring_form.md')) || docs.scoring_forms.find(f => f.ext === '.md'))?.filename) || '';
        const hasScoringOrDraft = Boolean((docs.scoring_forms && docs.scoring_forms.length) || ls.lscmi_scoring_md);
        const hasTranscriptOrGuide = Boolean((docs.transcripts && docs.transcripts.length) || (docs.interview_guides && docs.interview_guides.length) || ls.lscmi_transcript_txt);
        const hasCrimHistory = Boolean(docs.criminal_history && docs.criminal_history.some(f => f.filename.includes('_criminal_history.md')));

        const centerChecksHtml = VALID_CENTERS.map(c => {
            const checked = (bi.attached_centers || file.centers || []).includes(c);
            return `
                <label class="wp-center-check-label">
                    <input type="checkbox" name="attached_centers" value="${esc(c)}" ${checked ? 'checked' : ''} ${!admin ? 'disabled' : ''}>
                    ${esc(c)}
                </label>
            `;
        }).join('');

        const scrManual = scr.manual_record || {};
        const apricotScrRows = scr.apricot_screenings || [];
        const conManual = con.manual_record || {};
        const apricotConRows = con.apricot_consultations || [];
        const conInfoRows = con.consultation_info_rows || [];

        const renderBriefcaseField = (field) => {
            if (field.key === 'health_coverage_welvista' && !hasChronic) {
                return `
                    <div class="wp-briefcase-card">
                        <div style="font-weight: 800; font-size: 0.92rem; color: #334155;">${esc(field.title)}</div>
                        <div style="font-size: 0.84rem; color: #059669; font-weight: 700; margin-top: 6px;">✅ N/A — No chronic health conditions requiring daily medication or medical appointments.</div>
                    </div>
                `;
            }
            const cur = bcItems[field.key] || {};
            const curVal = cur.value || field.default_value;
            const curOpt = (field.options || []).find(o => o.value === curVal) || (field.options || [])[0];
            const isReady = Boolean(curOpt && curOpt.ready);
            const srcBadgeMap = {
                manual_dropdown: 'Manual Entry',
                manual_entry: 'Manual Entry',
                consultation: 'Consultation',
                case_notes: 'Case Notes',
                case_plan: 'Case Plan',
                skillcat_scraper: 'SkillCat',
                db_import: 'Program Record',
                loaded_text: 'Loaded Text',
                default: 'Not Set'
            };
            const srcLabel = srcBadgeMap[cur.source] || cur.source || 'Not Set';

            return `
                <div class="wp-briefcase-card ${field.required_for_waitlist ? (isReady ? 'is-ready' : 'is-missing') : ''}">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
                        <label for="wp-bc-sel-${esc(field.key)}" style="font-weight: 800; font-size: 0.9rem; color: #0f172a;">${esc(field.title)}</label>
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                            <span class="wp-pill wp-pill-blue">${esc(srcLabel)}</span>
                            ${field.required_for_waitlist ? `<span class="wp-pill ${isReady ? 'wp-pill-green' : 'wp-pill-amber'}">${isReady ? 'Waitlist Ready' : 'Required'}</span>` : ''}
                        </div>
                    </div>
                    <select id="wp-bc-sel-${esc(field.key)}" class="wp-select wp-bc-select" data-bc-key="${esc(field.key)}" style="margin-bottom: 6px;">
                        ${(field.options || []).map(opt => `<option value="${esc(opt.value)}" ${opt.value === curVal ? 'selected' : ''}>${esc(opt.label)}</option>`).join('')}
                    </select>
                    <input
                        type="text"
                        id="wp-bc-note-${esc(field.key)}"
                        class="wp-input wp-bc-note"
                        data-bc-note-key="${esc(field.key)}"
                        value="${esc(cur.notes || '')}"
                        placeholder="Optional note / evidence..."
                        style="min-height: 36px; font-size: 0.86rem; padding: 0.35rem 0.65rem;"
                    >
                </div>
            `;
        };

        const discLog = ls.lscmi_discrepancies;
        const ans158 = ls.lscmi_158_answers;
        const caseNotes = file.case_notes || [];
        const apBriefcaseRows = (file.briefcase && file.briefcase.apricot_briefcase_rows) || [];

        shell.innerHTML = `
            <div class="wp-file-header">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
                            <button type="button" id="btn-wp-back-overview" class="wp-btn wp-btn-sm">← Back to Workspace</button>
                            <span class="wp-pill ${bc.waitlist_ready ? 'wp-pill-green' : 'wp-pill-amber'}">
                                Briefcase: ${Number(bc.waitlist_met_count || 0)}/9 ${bc.waitlist_ready ? 'Ready' : ''}
                            </span>
                            ${(file.centers || []).map(c => `<span class="wp-pill wp-pill-blue">${esc(c)}</span>`).join('')}
                            ${file.is_dual_attached_reentry ? `<span class="wp-pill wp-pill-purple">Dual Attached (RN + ${esc(file.dual_attached_center)})</span>` : ''}
                        </div>
                        <h2 id="wp-file-heading" style="margin: 0 0 4px 0; font-size: 1.5rem; font-weight: 800; color: #0f172a;">${esc(file.name)}</h2>
                        <div style="font-size: 0.88rem; color: #475569;">
                            Program Manager: <strong>${esc(file.assigned_program_manager || 'Unassigned')}</strong>
                            ${file.apricot_id ? ` • Apricot ID: <code>#${esc(file.apricot_id)}</code>` : ''}
                            • Status: <strong>${esc(file.status || 'active')}</strong>
                        </div>
                    </div>
                    <div class="wp-actions-row">
                        <button type="button" id="btn-wp-toggle-file-sections" commandfor="wp-file-accordion" command="--toggle-all" aria-expanded="false" class="wp-btn wp-btn-sm">
                            <span class="expand">Expand All</span>
                            <span class="collapse">Collapse All</span>
                        </button>
                        <button type="button" id="btn-wp-refresh-file" class="wp-btn wp-btn-sm">🔄 Refresh File</button>
                    </div>
                </div>
            </div>

            <section id="wp-file-accordion" class="wp-accordion" aria-label="Participant File Sections">
                <!-- CARET 1: BASIC INFORMATION -->
                <details id="wp-pf-basic" class="wp-disclosure" open>
                    <summary>
                        <span class="wp-summary-title">1. Basic Information</span>
                        <span class="wp-summary-badge">${esc(bi.phone || 'No Phone')} • ${esc(bi.dob || 'No DOB')}</span>
                    </summary>
                    <div class="wp-disclosure-body">
                        <form id="form-wp-basic-info">
                            <div class="wp-form-grid">
                                <div class="wp-field">
                                    <label for="wp-bi-name">Full Name</label>
                                    <input type="text" id="wp-bi-name" name="full_name" class="wp-input" autocomplete="name" value="${esc(bi.full_name || file.name)}" required>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-phone">Phone Number</label>
                                    <input type="tel" id="wp-bi-phone" name="phone" class="wp-input" autocomplete="tel" value="${esc(bi.phone || '')}" placeholder="(843) 555-0100">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-email">Email</label>
                                    <input type="email" id="wp-bi-email" name="email" class="wp-input" autocomplete="email" spellcheck="false" value="${esc(bi.email || '')}" placeholder="client@example.com">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-dob">Date of Birth</label>
                                    <input type="text" id="wp-bi-dob" name="dob" class="wp-input" autocomplete="bday" value="${esc(bi.dob || '')}" placeholder="YYYY-MM-DD or MM/DD/YYYY">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-ssn">SSN</label>
                                    <div class="wp-password-wrap">
                                        <input type="${state.ssnRevealed ? 'text' : 'password'}" id="wp-bi-ssn" name="ssn" class="wp-input" value="${esc(bi.ssn || '')}" placeholder="***-**-1234 or full SSN">
                                        <button type="button" id="btn-wp-toggle-ssn" class="wp-btn wp-btn-sm" aria-pressed="${state.ssnRevealed ? 'true' : 'false'}">${state.ssnRevealed ? 'Hide' : 'Show'}</button>
                                    </div>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-pm">Assigned Program Manager</label>
                                    <input type="text" id="wp-bi-pm" name="assigned_program_manager" class="wp-input" value="${esc(bi.assigned_program_manager || '')}" placeholder="e.g. Terrence Brown">
                                </div>
                                <div class="wp-field" style="grid-column: span 2;">
                                    <label for="wp-bi-street">Street Address</label>
                                    <input type="text" id="wp-bi-street" name="street_address" class="wp-input" autocomplete="street-address" value="${esc(bi.street_address || '')}" placeholder="123 Main St">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-city">City</label>
                                    <input type="text" id="wp-bi-city" name="city" class="wp-input" autocomplete="address-level2" value="${esc(bi.city || '')}">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-state">State</label>
                                    <input type="text" id="wp-bi-state" name="state" class="wp-input" autocomplete="address-level1" value="${esc(bi.state || 'SC')}">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-zip">ZIP Code</label>
                                    <input type="text" id="wp-bi-zip" name="zip" class="wp-input" autocomplete="postal-code" inputmode="numeric" value="${esc(bi.zip || '')}">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-bi-status">Enrollment Status</label>
                                    <select id="wp-bi-status" name="status" class="wp-select">
                                        <option value="active" ${(bi.status || file.status) === 'active' ? 'selected' : ''}>Active</option>
                                        <option value="waitlist" ${(bi.status || file.status) === 'waitlist' ? 'selected' : ''}>Waitlist</option>
                                        <option value="archived" ${(bi.status || file.status) === 'archived' ? 'selected' : ''}>Archived / Exited</option>
                                    </select>
                                </div>
                            </div>

                            <fieldset style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;">
                                <legend style="font-size: 0.86rem; font-weight: 700; padding: 0 6px; color: #334155;">Attached Centers (Dual-attachment applies automatically if Reentry Nav + Center PM)</legend>
                                <div class="wp-center-checks">${centerChecksHtml}</div>
                            </fieldset>

                            <button type="submit" id="btn-wp-save-basic" class="wp-btn wp-btn-primary">💾 Save Basic Information</button>
                        </form>
                    </div>
                </details>

                <!-- CARET 2: SCREENING -->
                <details id="wp-pf-screening" class="wp-disclosure">
                    <summary>
                        <span class="wp-summary-title">2. Screening</span>
                        <span class="wp-summary-badge wp-summary-badge-teal">${scrManual.eligibility_status ? esc(scrManual.eligibility_status) : (apricotScrRows.length ? `${apricotScrRows.length} Apricot Record(s)` : 'Log Screening')}</span>
                    </summary>
                    <div class="wp-disclosure-body">
                        ${apricotScrRows.length > 0 ? `
                            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin-bottom: 14px;">
                                <div style="font-weight: 800; font-size: 0.88rem; margin-bottom: 6px; color: #0f172a;">Apricot Resource Coordination Screenings (${apricotScrRows.length})</div>
                                ${apricotScrRows.map(r => `
                                    <div style="font-size: 0.86rem; color: #334155; padding: 4px 0; border-top: 1px solid #e2e8f0;">
                                        Date: <strong>${esc(r['Date of resource coordination screening'] || 'N/A')}</strong> • Eligible for Reentry Consultation: <strong>${esc(r['Eligible for Reentry Consultation. Is...'] || 'Recorded')}</strong>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}

                        <form id="form-wp-screening">
                            <div class="wp-form-grid">
                                <div class="wp-field">
                                    <label for="wp-scr-date">Screening Date</label>
                                    <input type="date" id="wp-scr-date" name="screening_date" class="wp-input" value="${esc(scrManual.screening_date || new Date().toISOString().split('T')[0])}">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-scr-eligibility">Eligibility Verdict</label>
                                    <select id="wp-scr-eligibility" name="eligibility_status" class="wp-select">
                                        <option value="Eligible for Consultation" ${scrManual.eligibility_status === 'Eligible for Consultation' ? 'selected' : ''}>Eligible for Consultation</option>
                                        <option value="First Shift Eligible" ${scrManual.eligibility_status === 'First Shift Eligible' ? 'selected' : ''}>First Shift Eligible</option>
                                        <option value="Reentry Navigation Eligible" ${scrManual.eligibility_status === 'Reentry Navigation Eligible' ? 'selected' : ''}>Reentry Navigation Eligible</option>
                                        <option value="Resource Coordination Only" ${scrManual.eligibility_status === 'Resource Coordination Only' ? 'selected' : ''}>Resource Coordination Only</option>
                                        <option value="Ineligible / Pending Review" ${scrManual.eligibility_status === 'Ineligible / Pending Review' ? 'selected' : ''}>Ineligible / Pending Review</option>
                                    </select>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-scr-referral">Referral Source</label>
                                    <input type="text" id="wp-scr-referral" name="referral_source" class="wp-input" value="${esc(scrManual.referral_source || '')}" placeholder="e.g. SCDC / Parole / Walk-in">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-scr-age-ok">Age 25–50 Check</label>
                                    <select id="wp-scr-age-ok" name="age_25_to_50" class="wp-select">
                                        <option value="yes" ${scrManual.age_25_to_50 !== 'no' ? 'selected' : ''}>Yes (Ages 25–50)</option>
                                        <option value="no" ${scrManual.age_25_to_50 === 'no' ? 'selected' : ''}>No (Outside 25–50)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="wp-field">
                                <label for="wp-scr-notes">Screening Notes</label>
                                <textarea id="wp-scr-notes" name="notes" class="wp-textarea" placeholder="Initial screening details and next routing step...">${esc(scrManual.notes || '')}</textarea>
                            </div>
                            <button type="submit" id="btn-wp-save-screening" class="wp-btn wp-btn-primary">💾 Save Screening Record</button>
                        </form>
                    </div>
                </details>

                <!-- CARET 3: CONSULTATION -->
                <details id="wp-pf-consultation" class="wp-disclosure">
                    <summary>
                        <span class="wp-summary-title">3. Consultation</span>
                        <span class="wp-summary-badge wp-summary-badge-blue">${conInfoRows.length + apricotConRows.length > 0 ? `${conInfoRows.length + apricotConRows.length} Record(s)` : (conManual.consultation_date ? esc(conManual.consultation_date) : 'Log Consultation')}</span>
                    </summary>
                    <div class="wp-disclosure-body">
                        ${(apricotConRows.length > 0 || conInfoRows.length > 0) ? `
                            <details class="wp-disclosure wp-subdisclosure" open>
                                <summary><span class="wp-summary-title">Apricot Consultation &amp; Intake Records (${apricotConRows.length + conInfoRows.length})</span></summary>
                                <div class="wp-disclosure-body">
                                    ${apricotConRows.map(r => `
                                        <div style="font-size: 0.86rem; padding: 6px 0; border-bottom: 1px solid #e2e8f0;">
                                            Date: <strong>${esc(r['Date of Reentry Consultation'] || 'N/A')}</strong> • Preferred Center: <strong>${esc(r['Preferred enrollment location'] || 'N/A')}</strong> • Referral: <strong>${esc(r['Referral Source'] || 'N/A')}</strong> • Eligible for First Shift: <strong>${esc(r['Elgible for First Shift?'] || 'N/A')}</strong>
                                        </div>
                                    `).join('')}
                                    ${conInfoRows.map(r => `
                                        <div style="font-size: 0.84rem; padding: 8px 0; border-bottom: 1px solid #e2e8f0; color: #334155;">
                                            <strong>Apricot Consultation Info:</strong>
                                            Housing: <em>${esc(r['Current Housing Status'] || 'N/A')}</em> •
                                            Birth Cert: <em>${esc(r['Do you have a birth certificate?'] || 'N/A')}</em> •
                                            SS Card: <em>${esc(r['Do you have your social security card?'] || 'N/A')}</em> •
                                            State ID: <em>${esc(r['Do you have a state issued ID?'] || 'N/A')}</em> •
                                            DL: <em>${esc(r['Do you have a drivers license?'] || 'N/A')}</em> •
                                            Transportation: <em>${esc(r['What is your transportation plan? (verify...'] || 'N/A')}</em>
                                        </div>
                                    `).join('')}
                                </div>
                            </details>
                        ` : ''}

                        <form id="form-wp-consultation">
                            <p style="font-size: 0.86rem; color: #475569; margin: 0 0 12px 0;">Saving a consultation updates the participant's history and auto-populates matching Briefcase items.</p>
                            <div class="wp-form-grid">
                                <div class="wp-field">
                                    <label for="wp-con-date">Consultation Date</label>
                                    <input type="date" id="wp-con-date" name="consultation_date" class="wp-input" value="${esc(conManual.consultation_date || new Date().toISOString().split('T')[0])}">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-decision">Routing Decision</label>
                                    <select id="wp-con-decision" name="eligibility_decision" class="wp-select">
                                        <option value="first_shift_waitlist" ${conManual.eligibility_decision === 'first_shift_waitlist' ? 'selected' : ''}>First Shift Waitlist</option>
                                        <option value="reentry_navigation" ${!conManual.eligibility_decision || conManual.eligibility_decision === 'reentry_navigation' ? 'selected' : ''}>Reentry Navigation</option>
                                        <option value="resource_coordination" ${conManual.eligibility_decision === 'resource_coordination' ? 'selected' : ''}>Resource Coordination</option>
                                    </select>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-id">State ID / Driver's License</label>
                                    <select id="wp-con-id" name="has_state_id_or_dl" class="wp-select">
                                        <option value="">-- Select --</option>
                                        <option value="valid_dl" ${conManual.has_state_id_or_dl === 'valid_dl' ? 'selected' : ''}>Valid Driver's License</option>
                                        <option value="valid_state_id" ${conManual.has_state_id_or_dl === 'valid_state_id' ? 'selected' : ''}>Valid State ID</option>
                                        <option value="dl_suspended_has_state_id" ${conManual.has_state_id_or_dl === 'dl_suspended_has_state_id' ? 'selected' : ''}>DL Suspended (Has State ID)</option>
                                        <option value="dl_suspended_no_id" ${conManual.has_state_id_or_dl === 'dl_suspended_no_id' ? 'selected' : ''}>DL Suspended &amp; No ID</option>
                                        <option value="missing" ${conManual.has_state_id_or_dl === 'missing' ? 'selected' : ''}>Missing ID / DL</option>
                                    </select>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-ss">Social Security Card</label>
                                    <select id="wp-con-ss" name="has_ss_card" class="wp-select">
                                        <option value="">-- Select --</option>
                                        <option value="verified_card" ${conManual.has_ss_card === 'verified_card' ? 'selected' : ''}>Yes — Physical Card Verified</option>
                                        <option value="verified_ssa_receipt" ${conManual.has_ss_card === 'verified_ssa_receipt' ? 'selected' : ''}>SSA Receipt</option>
                                        <option value="missing" ${conManual.has_ss_card === 'missing' ? 'selected' : ''}>Missing</option>
                                    </select>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-bc">Birth Certificate</label>
                                    <select id="wp-con-bc" name="has_birth_certificate" class="wp-select">
                                        <option value="">-- Select --</option>
                                        <option value="verified_copy" ${conManual.has_birth_certificate === 'verified_copy' ? 'selected' : ''}>Yes — Certified Copy</option>
                                        <option value="ordered_in_transit" ${conManual.has_birth_certificate === 'ordered_in_transit' ? 'selected' : ''}>Ordered / In Transit</option>
                                        <option value="missing" ${conManual.has_birth_certificate === 'missing' ? 'selected' : ''}>Missing</option>
                                    </select>
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-housing">Housing Status</label>
                                    <input type="text" id="wp-con-housing" name="housing_status" class="wp-input" value="${esc(conManual.housing_status || '')}" placeholder="e.g. Stable family home, Transitional, Shelter">
                                </div>
                                <div class="wp-field">
                                    <label for="wp-con-chronic">Any Chronic Health Condition?</label>
                                    <select id="wp-con-chronic" name="has_chronic_health_condition" class="wp-select">
                                        <option value="no" ${conManual.has_chronic_health_condition !== 'yes' ? 'selected' : ''}>No (Do not ask medical appts)</option>
                                        <option value="yes" ${conManual.has_chronic_health_condition === 'yes' ? 'selected' : ''}>Yes — Chronic / Daily Meds</option>
                                    </select>
                                </div>
                                <div id="wp-con-chronic-status-wrap" class="wp-field ${conManual.has_chronic_health_condition === 'yes' ? '' : 'hidden'}">
                                    <label for="wp-con-chronic-status">Chronic Treatment / Daily Meds</label>
                                    <select id="wp-con-chronic-status" name="chronic_health_and_meds" class="wp-select">
                                        <option value="treated_and_has_daily_meds" ${conManual.chronic_health_and_meds === 'treated_and_has_daily_meds' ? 'selected' : ''}>Treated &amp; Has Daily Meds</option>
                                        <option value="needs_daily_med_access" ${conManual.chronic_health_and_meds === 'needs_daily_med_access' ? 'selected' : ''}>Needs Daily Med Access / Welvista</option>
                                        <option value="needs_medical_appointment" ${conManual.chronic_health_and_meds === 'needs_medical_appointment' ? 'selected' : ''}>Needs Medical Appointment</option>
                                    </select>
                                </div>
                            </div>
                            <div class="wp-field">
                                <label for="wp-con-supervision">Supervision / Pending Charges Notes</label>
                                <input type="text" id="wp-con-supervision" name="supervision_notes" class="wp-input" value="${esc(conManual.supervision_notes || '')}" placeholder="PO name, reporting schedule, or clearance notes">
                            </div>
                            <div class="wp-field">
                                <label for="wp-con-summary">Consultation Summary Notes</label>
                                <textarea id="wp-con-summary" name="summary_notes" class="wp-textarea" placeholder="Consultation highlights and immediate needs...">${esc(conManual.summary_notes || '')}</textarea>
                            </div>
                            <button type="submit" id="btn-wp-save-consultation" class="wp-btn wp-btn-primary">💾 Save Consultation &amp; Update Briefcase</button>
                        </form>
                    </div>
                </details>

                <!-- CARET 4: LS/CMI (BRIEF, ACTION PLAN & HUMAN-IN-THE-LOOP) -->
                <details id="wp-pf-lscmi" class="wp-disclosure">
                    <summary>
                        <span class="wp-summary-title">4. LS/CMI (Brief, Action Plan &amp; Human-in-the-Loop)</span>
                        <span class="wp-summary-badge wp-summary-badge-purple">
                            ${ls.lscmi_brief_md ? 'Brief On File' : 'No Brief'} • ${ls.action_plan_md ? 'Action Plan On File' : 'No Plan'}
                        </span>
                    </summary>
                    <div class="wp-disclosure-body">
                        <!-- Human-in-the-Loop Action Bar (Classic HITL + Direct Actions) -->
                        <div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 10px; padding: 14px; margin-bottom: 14px;">
                            <div style="font-size: 0.85rem; font-weight: 800; color: #0369a1; text-transform: uppercase; margin-bottom: 8px;">LS/CMI Human-in-the-Loop Review &amp; Adjustments</div>
                            <div class="wp-actions-row">
                                <button type="button" class="wp-btn wp-btn-primary wp-btn-sm" onclick="openSupervisorReviewModal('${lscmiIdEsc}', '${nameEsc}')">✍️ Phase 2 HITL Review &amp; Approve / Override</button>
                                <button type="button" class="wp-btn wp-btn-sm" style="color: #059669; border-color: #059669; background: #ecfdf5;" onclick="openAdjustActionPlanModal('${lscmiIdEsc}', '${nameEsc}')">🎯 Adjust Action Plan Only</button>
                                ${hasScoringOrDraft ? `<button type="button" class="wp-btn wp-btn-sm" onclick="previewScoringWithGuide('${lscmiIdEsc}', '${nameEsc}')">⚖️ Dual Review: Scoring &amp; Guide</button>` : ''}
                                ${hasTranscriptOrGuide ? `<button type="button" class="wp-btn wp-btn-sm" onclick="triggerGenerateAiDraft('${lscmiIdEsc}', '${nameEsc}')">${hasScoringOrDraft ? '🔄 Re-Score with AI' : '⚡ Generate AI Scoring Review'}</button>` : ''}
                                ${!hasCrimHistory ? `<button type="button" class="wp-btn wp-btn-sm" onclick="quickGenerateCriminalHistory('${lscmiIdEsc}', '${nameEsc}')">⚖️ + Criminal History</button>` : ''}
                                <button type="button" class="wp-btn wp-btn-teal wp-btn-sm" onclick="openInterviewModal()">🎙️ Record New LS/CMI</button>
                            </div>
                        </div>

                        <!-- LS/CMI Case Brief -->
                        <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 14px; background: white;">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                                <strong style="font-size: 1rem;">📘 LS/CMI Case Brief</strong>
                                <div class="wp-actions-row">
                                    ${primaryBriefMd ? `
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="previewDocument('${esc(primaryBriefMd).replace(/'/g, "\\'")}')">👁️ View</button>
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="printActiveDraftDocument('${esc(primaryBriefMd).replace(/'/g, "\\'")}')">🖨️ Print</button>
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="openActiveDraftPdf('${esc(primaryBriefMd).replace(/'/g, "\\'")}')">📄 PDF</button>
                                    ` : ''}
                                    <button type="button" class="wp-btn wp-btn-sm" data-wp-toggle-doc="brief">✏️ Edit Brief Directly</button>
                                </div>
                            </div>
                            <div id="wp-doc-editor-brief" class="hidden" style="margin-bottom: 12px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #93c5fd;">
                                <label for="wp-doc-textarea-brief" style="font-weight: 700; font-size: 0.86rem; display: block; margin-bottom: 6px;">Edit LS/CMI Case Brief (Markdown)</label>
                                <textarea id="wp-doc-textarea-brief" rows="10" class="wp-textarea" style="font-family: monospace; font-size: 0.85rem;">${esc(ls.lscmi_brief_md || '')}</textarea>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                    <input type="text" id="wp-doc-reason-brief" class="wp-input" style="flex: 1; min-width: 200px; min-height: 36px;" placeholder="Reason for adjustment...">
                                    <button type="button" class="wp-btn wp-btn-primary wp-btn-sm" data-wp-save-doc="brief">💾 Save &amp; Archive Prior Version</button>
                                    <button type="button" class="wp-btn wp-btn-sm" data-wp-toggle-doc="brief">Cancel</button>
                                </div>
                            </div>
                            <div style="max-height: 320px; overflow-y: auto; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                                ${renderMd(ls.lscmi_brief_md, 'No LS/CMI Case Brief stored yet. Use Phase 2 HITL Review or Edit Brief Directly.')}
                            </div>
                        </div>

                        <!-- Participant Action Plan & Feedback Loop -->
                        <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 14px; background: white;">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">
                                <strong style="font-size: 1rem;">🎯 Participant Action Plan</strong>
                                <div class="wp-actions-row">
                                    ${primaryPlanMd ? `
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="previewDocument('${esc(primaryPlanMd).replace(/'/g, "\\'")}')">👁️ View</button>
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="printActiveDraftDocument('${esc(primaryPlanMd).replace(/'/g, "\\'")}')">🖨️ Print</button>
                                        <button type="button" class="wp-btn wp-btn-sm" onclick="openActiveDraftPdf('${esc(primaryPlanMd).replace(/'/g, "\\'")}')">📄 PDF</button>
                                    ` : ''}
                                    <button type="button" class="wp-btn wp-btn-sm" style="color: #059669; border-color: #059669;" onclick="openAdjustActionPlanModal('${lscmiIdEsc}', '${nameEsc}')">🎯 Adjust Plan with AI</button>
                                    <button type="button" class="wp-btn wp-btn-sm" data-wp-toggle-doc="action_plan">✏️ Edit Plan Directly</button>
                                </div>
                            </div>
                            <div id="wp-doc-editor-action_plan" class="hidden" style="margin-bottom: 12px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #86efac;">
                                <label for="wp-doc-textarea-action_plan" style="font-weight: 700; font-size: 0.86rem; display: block; margin-bottom: 6px;">Edit Participant Action Plan (Markdown)</label>
                                <textarea id="wp-doc-textarea-action_plan" rows="10" class="wp-textarea" style="font-family: monospace; font-size: 0.85rem;">${esc(ls.action_plan_md || '')}</textarea>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                    <input type="text" id="wp-doc-reason-action_plan" class="wp-input" style="flex: 1; min-width: 200px; min-height: 36px;" placeholder="Reason for adjustment...">
                                    <button type="button" class="wp-btn wp-btn-teal wp-btn-sm" data-wp-save-doc="action_plan">💾 Save &amp; Archive Prior Version</button>
                                    <button type="button" class="wp-btn wp-btn-sm" data-wp-toggle-doc="action_plan">Cancel</button>
                                </div>
                            </div>
                            <div style="max-height: 320px; overflow-y: auto; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                                ${renderMd(ls.action_plan_md, 'No Action Plan stored yet. Use "Adjust Plan with AI" or "Edit Plan Directly" to create one.')}
                            </div>

                            <details class="wp-disclosure wp-subdisclosure" style="margin-top: 12px; margin-bottom: 0;">
                                <summary><span class="wp-summary-title">🔄 Log Participant Action Plan Agreement / 4-Step Feedback Loop Revision</span></summary>
                                <div class="wp-disclosure-body">
                                    <form id="form-wp-feedback-loop">
                                        <div class="wp-form-grid">
                                            <div class="wp-field" style="margin-block-end: 0;">
                                                <label for="wp-fl-status">Agreement Status</label>
                                                <select id="wp-fl-status" class="wp-select">
                                                    <option value="resolved_via_feedback_loop">Disagreed → Resolved via Feedback Loop</option>
                                                    <option value="agreed">Agreed with Current Action Plan</option>
                                                </select>
                                            </div>
                                            <div class="wp-field" style="margin-block-end: 0;">
                                                <label for="wp-fl-disagreed">Original Target Disagreed With</label>
                                                <input type="text" id="wp-fl-disagreed" class="wp-input" placeholder="e.g. Family / Authority">
                                            </div>
                                            <div class="wp-field" style="margin-block-end: 0;">
                                                <label for="wp-fl-replacement">Agreed Focus Target &amp; Tool Kit (1A–1N)</label>
                                                <input type="text" id="wp-fl-replacement" class="wp-input" placeholder="e.g. Impulsivity — Stop &amp; Think (1I)">
                                            </div>
                                            <div class="wp-field" style="margin-block-end: 0;">
                                                <label for="wp-fl-quote">Participant Input / Verbatim Quote</label>
                                                <input type="text" id="wp-fl-quote" class="wp-input" placeholder="Participant feedback...">
                                            </div>
                                        </div>
                                        <div style="margin-top: 10px;">
                                            <button type="submit" id="btn-wp-submit-feedback-loop" class="wp-btn wp-btn-teal wp-btn-sm">💾 Save Feedback Loop Revision</button>
                                        </div>
                                    </form>
                                </div>
                            </details>
                        </div>

                        <!-- Nested LS/CMI Supporting Documents & Staff-Only Discrepancies -->
                        <details class="wp-disclosure wp-subdisclosure">
                            <summary><span class="wp-summary-title">Scoring Forms, Interview Guides, Legacy Briefs &amp; Criminal History (${(docs.scoring_forms?.length || 0) + (docs.legacy_case_briefs?.length || 0) + (docs.interview_guides?.length || 0) + (docs.transcripts?.length || 0) + (docs.criminal_history?.length || 0)})</span></summary>
                            <div class="wp-disclosure-body">
                                ${primaryScoringMd ? `<div style="margin-bottom: 8px;"><button type="button" class="wp-btn wp-btn-sm" onclick="previewDocument('${esc(primaryScoringMd).replace(/'/g, "\\'")}')">📊 View Primary Scoring Form</button></div>` : ''}
                                <div class="wp-form-grid">
                                    <div>
                                        <strong style="font-size: 0.85rem;">Scoring Forms</strong>
                                        ${renderDocRowsHtml(file.participant_key, docs.scoring_forms, ls.lscmi_client_id)}
                                    </div>
                                    <div>
                                        <strong style="font-size: 0.85rem;">Legacy Case Briefs</strong>
                                        ${renderDocRowsHtml(file.participant_key, docs.legacy_case_briefs, ls.lscmi_client_id)}
                                    </div>
                                    <div>
                                        <strong style="font-size: 0.85rem;">Interview Guides &amp; Transcripts</strong>
                                        ${renderDocRowsHtml(file.participant_key, [...(docs.interview_guides || []), ...(docs.transcripts || [])], ls.lscmi_client_id)}
                                    </div>
                                    <div>
                                        <strong style="font-size: 0.85rem;">Criminal History &amp; Reentry Docs</strong>
                                        ${renderDocRowsHtml(file.participant_key, [...(docs.criminal_history || []), ...(docs.reentry_plans || [])], ls.lscmi_client_id)}
                                    </div>
                                </div>
                                ${(discLog || ans158) ? `
                                    <div style="margin-top: 12px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 0.84rem; color: #7f1d1d;">
                                        <strong>Staff-Only Intake Checks:</strong> Checklist ${ans158 ? `${ans158.answered_count || 0}/${ans158.total_questions || 158}` : 'N/A'} • Discrepancies: ${discLog ? (discLog.discrepancy_count || (discLog.discrepancies || []).length) : 0}
                                    </div>
                                ` : ''}
                            </div>
                        </details>
                    </div>
                </details>

                <!-- CARET 5: BRIEFCASE (MANUAL ENTRY + AUTO-FILL FROM CASE NOTES, CONSULTATION & CASE PLAN) -->
                <details id="wp-pf-briefcase" class="wp-disclosure">
                    <summary>
                        <span class="wp-summary-title">5. Briefcase (Waitlist &amp; Readiness)</span>
                        <span class="wp-summary-badge ${bc.waitlist_ready ? 'wp-summary-badge-teal' : 'wp-summary-badge-amber'}">${Number(bc.waitlist_met_count || 0)}/9 Ready</span>
                    </summary>
                    <div class="wp-disclosure-body">
                        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                            <div>
                                <div style="font-weight: 800; font-size: 0.96rem; color: #0f172a;">Manual Entry + Automatic Sync from Case Notes, Consultation &amp; Case Plan</div>
                                <div style="font-size: 0.84rem; color: #475569;">Manual edits are saved immediately and protected unless you force an overwrite.</div>
                            </div>
                            <div class="wp-actions-row">
                                <button type="button" id="btn-wp-autofill-briefcase" class="wp-btn wp-btn-teal wp-btn-sm">✨ Auto-Fill from Notes, Consultation &amp; Plan</button>
                                <button type="button" id="btn-wp-save-briefcase" class="wp-btn wp-btn-primary wp-btn-sm">💾 Save All Manual Changes</button>
                            </div>
                        </div>

                        <div class="wp-form-grid" style="margin-bottom: 14px; align-items: end;">
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-bc-chronic-toggle">Chronic Health Condition? (Suppresses Medical Appts when No)</label>
                                <select id="wp-bc-chronic-toggle" class="wp-select">
                                    <option value="no" ${!hasChronic ? 'selected' : ''}>No — Do NOT ask for medical appointments (N/A)</option>
                                    <option value="yes" ${hasChronic ? 'selected' : ''}>Yes — Requires treatment &amp;/or daily medications</option>
                                </select>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="wp-bc-manual-notes">Overall Briefcase Notes (Manual Entry)</label>
                                <input type="text" id="wp-bc-manual-notes" class="wp-input" value="${esc(bc.manual_notes || '')}" placeholder="Enter manual Briefcase notes or barriers...">
                            </div>
                        </div>

                        <div style="font-size: 0.84rem; font-weight: 800; text-transform: uppercase; color: #1e3a8a; margin-bottom: 8px;">9 Mandatory First Shift Waitlist Items</div>
                        <div class="wp-form-grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 16px;">
                            ${(bcSchema.waitlist_requirements || []).map(renderBriefcaseField).join('')}
                        </div>

                        <div style="font-size: 0.84rem; font-weight: 800; text-transform: uppercase; color: #1e3a8a; margin-bottom: 8px;">SkillCat Pathway, Employment &amp; Benefits</div>
                        <div class="wp-form-grid" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-bottom: 16px;">
                            ${[...(bcSchema.employment_and_pathways || []), ...(bcSchema.benefits_and_financial || [])].map(renderBriefcaseField).join('')}
                        </div>

                        <details class="wp-disclosure wp-subdisclosure">
                            <summary><span class="wp-summary-title">+ Add Case Note &amp; View Source Case Notes (${caseNotes.length}) / Apricot Briefcase (${apBriefcaseRows.length})</span></summary>
                            <div class="wp-disclosure-body">
                                <form id="form-wp-add-case-note" style="margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0;">
                                    <div class="wp-form-grid">
                                        <div class="wp-field" style="margin-block-end: 0;">
                                            <label for="wp-cn-date">Session Date</label>
                                            <input type="date" id="wp-cn-date" class="wp-input" value="${new Date().toISOString().split('T')[0]}">
                                        </div>
                                        <div class="wp-field" style="margin-block-end: 0;">
                                            <label for="wp-cn-type">Note Type</label>
                                            <select id="wp-cn-type" class="wp-select">
                                                <option value="Individual Session">Individual Session</option>
                                                <option value="Check-In">Check-In</option>
                                                <option value="Court / Supervision">Court / Supervision</option>
                                                <option value="Document Update">Document Update</option>
                                            </select>
                                        </div>
                                        <div class="wp-field" style="margin-block-end: 0;">
                                            <label for="wp-cn-category">Category</label>
                                            <select id="wp-cn-category" class="wp-select">
                                                <option value="Case Management">Case Management</option>
                                                <option value="Barriers & Stability">Barriers &amp; Stability</option>
                                                <option value="Employment & SkillCat">Employment &amp; SkillCat</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="wp-field" style="margin-top: 10px;">
                                        <label for="wp-cn-content">Case Note (Auto-updates To-Dos &amp; Briefcase)</label>
                                        <textarea id="wp-cn-content" class="wp-textarea" required placeholder="Document what happened, documents received, and concrete next steps..."></textarea>
                                    </div>
                                    <button type="submit" id="btn-wp-save-case-note" class="wp-btn wp-btn-primary wp-btn-sm">💾 Save Case Note &amp; Sync To-Dos / Briefcase</button>
                                </form>

                                ${caseNotes.slice(0, 8).map(n => `
                                    <div style="border-left: 3px solid #0284c7; background: #f8fafc; padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; font-size: 0.85rem;">
                                        <div style="font-weight: 700; color: #0f172a;">${esc(n.date || 'N/A')} • ${esc(n.staff)} <span style="font-weight: 500; color: #475569;">(${esc(n.source)}${n.context ? ` — ${esc(n.context)}` : ''})</span></div>
                                        <div style="margin-top: 4px; white-space: pre-wrap; color: #1e293b;">${esc(n.text)}</div>
                                    </div>
                                `).join('') || '<p style="color: #475569; margin: 0;">No case notes recorded yet.</p>'}
                            </div>
                        </details>
                    </div>
                </details>
            </section>
        `;
    }

    // ------------------------------------------------------------------------
    // ADMIN USER MANAGEMENT & CHANGE PASSWORD MODALS
    // ------------------------------------------------------------------------
    async function openAdminUsersModal() {
        const modal = document.getElementById('modal-admin-users');
        const body = document.getElementById('admin-users-modal-body');
        if (!modal || !body) return;
        modal.classList.remove('hidden');
        body.innerHTML = `<p style="color: #475569;">Loading staff accounts...</p>`;

        try {
            const data = await wpAuthFetch('/api/admin/staff-users');
            renderAdminUsersBody(data.users || [], data.valid_centers || VALID_CENTERS);
        } catch (err) {
            body.innerHTML = `<div class="wp-error-banner">${esc(err.message)}</div>`;
        }
    }

    function renderAdminUsersBody(users, centers) {
        const body = document.getElementById('admin-users-modal-body');
        if (!body) return;

        const centerOpts = centers.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

        body.innerHTML = `
            <details class="wp-disclosure wp-subdisclosure" open>
                <summary><span class="wp-summary-title">+ Create New Staff Account</span></summary>
                <div class="wp-disclosure-body">
                    <form id="form-admin-create-user">
                        <div class="wp-form-grid">
                            <div class="wp-field">
                                <label for="adm-new-name">Full Name</label>
                                <input type="text" id="adm-new-name" class="wp-input" required placeholder="Staff Full Name">
                            </div>
                            <div class="wp-field">
                                <label for="adm-new-email">Email</label>
                                <input type="email" id="adm-new-email" class="wp-input" required spellcheck="false" placeholder="staff@turnninety.com">
                            </div>
                            <div class="wp-field">
                                <label for="adm-new-pass">Initial Password (min 8 chars)</label>
                                <input type="password" id="adm-new-pass" class="wp-input" required minlength="8" autocomplete="new-password">
                            </div>
                            <div class="wp-field">
                                <label for="adm-new-type">User Type</label>
                                <select id="adm-new-type" class="wp-select">
                                    <option value="User" selected>User (Center Scoped)</option>
                                    <option value="Admin">Admin (All Centers + User Admin)</option>
                                </select>
                            </div>
                            <div class="wp-field" id="adm-new-center-wrap">
                                <label for="adm-new-center">Assigned Center</label>
                                <select id="adm-new-center" class="wp-select">${centerOpts}</select>
                            </div>
                        </div>
                        <button type="submit" class="wp-btn wp-btn-primary wp-btn-sm">Create Staff Login</button>
                    </form>
                </div>
            </details>

            <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
                ${users.map(u => `
                    <form class="wp-admin-user-row" data-user-id="${u.id}" style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; background: ${u.is_active ? '#ffffff' : '#f8fafc'};">
                        <div class="wp-form-grid" style="align-items: end;">
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="adm-u-name-${u.id}">Name</label>
                                <input type="text" id="adm-u-name-${u.id}" name="name" class="wp-input" value="${esc(u.name)}" required>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="adm-u-email-${u.id}">Email</label>
                                <input type="email" id="adm-u-email-${u.id}" name="email" class="wp-input" value="${esc(u.email || '')}" spellcheck="false" required>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="adm-u-type-${u.id}">User Type</label>
                                <select id="adm-u-type-${u.id}" name="user_type" class="wp-select">
                                    <option value="User" ${u.user_type === 'User' ? 'selected' : ''}>User</option>
                                    <option value="Admin" ${u.user_type === 'Admin' ? 'selected' : ''}>Admin</option>
                                </select>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="adm-u-center-${u.id}">Center</label>
                                <select id="adm-u-center-${u.id}" name="location" class="wp-select">
                                    <option value="All" ${u.user_type === 'Admin' ? 'selected' : ''}>All Centers</option>
                                    ${centers.map(c => `<option value="${esc(c)}" ${u.assigned_center === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="wp-field" style="margin-block-end: 0;">
                                <label for="adm-u-pass-${u.id}">Reset Password (Optional)</label>
                                <input type="password" id="adm-u-pass-${u.id}" name="password" class="wp-input" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep">
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
                            <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.86rem; font-weight: 700;">
                                <input type="checkbox" name="is_active" ${u.is_active ? 'checked' : ''} style="width: 18px; height: 18px;">
                                Active Account
                            </label>
                            <div class="wp-actions-row">
                                <button type="submit" class="wp-btn wp-btn-primary wp-btn-sm">Save Changes</button>
                                <button type="button" class="wp-btn wp-btn-sm" data-adm-delete-user="${u.id}">Delete</button>
                            </div>
                        </div>
                    </form>
                `).join('')}
            </div>
        `;
    }

    function openChangePasswordModal() {
        const modal = document.getElementById('modal-change-password');
        const msg = document.getElementById('cp-status-msg');
        const cur = document.getElementById('cp-current-password');
        const next = document.getElementById('cp-new-password');
        if (cur) cur.value = '';
        if (next) next.value = '';
        if (msg) {
            msg.textContent = '';
            msg.className = 'hidden';
        }
        if (modal) modal.classList.remove('hidden');
    }

    // ------------------------------------------------------------------------
    // EVENT DELEGATION & PROGRESSIVE ENHANCEMENT LISTENERS
    // ------------------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const loginForm = document.getElementById('form-email-login');
        if (loginForm) loginForm.addEventListener('submit', handleEmailLoginSubmit);

        const togglePwBtn = document.getElementById('btn-toggle-login-password');
        if (togglePwBtn) {
            togglePwBtn.addEventListener('click', () => {
                const pw = document.getElementById('login-password');
                if (!pw) return;
                const showing = pw.type === 'text';
                pw.type = showing ? 'password' : 'text';
                togglePwBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
                togglePwBtn.textContent = showing ? 'Show' : 'Hide';
            });
        }

        const loginRecBtn = document.getElementById('btn-login-record-lscmi');
        if (loginRecBtn) {
            loginRecBtn.addEventListener('click', () => {
                if (typeof window.openInterviewModal === 'function') window.openInterviewModal();
            });
        }

        const topRecBtn = document.getElementById('btn-wp-record-lscmi');
        if (topRecBtn) {
            topRecBtn.addEventListener('click', () => {
                if (typeof window.openInterviewModal === 'function') window.openInterviewModal();
            });
        }

        const topRefreshBtn = document.getElementById('btn-wp-refresh');
        if (topRefreshBtn) {
            topRefreshBtn.addEventListener('click', () => window.initWorkspacePortal(true));
        }

        // Tools Popover actions
        const pop = document.getElementById('wp-tools-popover');
        if (pop) {
            pop.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-wp-tool]');
                if (!btn) return;
                const tool = btn.getAttribute('data-wp-tool');
                hideToolsPopover();
                if (tool === 'coaching') {
                    const user = (typeof currentUser !== 'undefined' ? currentUser : null) || window.currentUser;
                    const admin = isUserAdmin(user);
                    const targetCenter = String(user?.assigned_center || user?.location || 'Charleston').toLowerCase();
                    if (admin && typeof window.switchSixDashboard === 'function') {
                        window.switchSixDashboard('supervisor');
                    } else if (typeof window.switchSixDashboard === 'function' && ['charleston', 'columbia', 'spartanburg'].includes(targetCenter)) {
                        window.switchSixDashboard(targetCenter);
                    } else if (typeof window.showView === 'function') {
                        window.showView('view-pm-portal');
                    }
                    if (typeof window.switchPmSubView === 'function') {
                        window.switchPmSubView('facilitation');
                    }
                } else if (tool === 'supervision' && typeof window.openCombinedSupervisionReportModal === 'function') {
                    window.openCombinedSupervisionReportModal();
                } else if (tool === 'voice' && typeof window.openVoiceRecognitionModal === 'function') {
                    window.openVoiceRecognitionModal();
                } else if (tool === 'templates' && typeof window.openTemplatesAndSkillsModal === 'function') {
                    window.openTemplatesAndSkillsModal();
                } else if (tool === 'manage-users') {
                    openAdminUsersModal();
                } else if (tool === 'change-password') {
                    openChangePasswordModal();
                } else if (tool === 'toggle-legacy-bar') {
                    const bar = document.getElementById('six-dashboards-bar');
                    if (bar) {
                        const isHidden = bar.classList.contains('hidden');
                        bar.classList.toggle('hidden', !isHidden);
                        bar.classList.toggle('wp-hidden', !isHidden);
                    }
                }
            });
        }

        // Expand/Collapse All accordion command handler + capture-phase toggle sync + click fallback
        document.addEventListener('command', (e) => {
            if (e.command !== '--toggle-all') return;
            const expand = e.source && e.source.getAttribute('aria-expanded') !== 'true';
            for (const d of e.target.querySelectorAll(':scope > details')) {
                d.open = expand;
            }
        }, { capture: true });

        document.addEventListener('toggle', (e) => {
            if (!(e.target instanceof HTMLDetailsElement)) return;
            if (!e.target.matches('#wp-file-accordion > details')) return;
            const btn = document.getElementById('btn-wp-toggle-file-sections');
            if (!btn) return;
            const items = document.querySelectorAll('#wp-file-accordion > details');
            btn.setAttribute('aria-expanded', Array.prototype.every.call(items, d => d.open) ? 'true' : 'false');
        }, { capture: true });

        // Workspace Portal delegated clicks, changes, and form submissions
        const portal = document.getElementById('view-workspace-portal');
        if (portal) {
            portal.addEventListener('click', async (e) => {
                if (!Object.hasOwn(HTMLButtonElement.prototype, 'commandForElement')) {
                    const toggleAllBtn = e.target.closest('#btn-wp-toggle-file-sections');
                    if (toggleAllBtn) {
                        const acc = document.getElementById('wp-file-accordion');
                        if (acc) {
                            const expand = toggleAllBtn.getAttribute('aria-expanded') !== 'true';
                            for (const d of acc.querySelectorAll(':scope > details')) d.open = expand;
                            toggleAllBtn.setAttribute('aria-expanded', expand ? 'true' : 'false');
                        }
                        return;
                    }
                }

                const openCard = e.target.closest('[data-open-participant]');
                if (openCard) {
                    const slug = openCard.getAttribute('data-open-participant');
                    if (slug) await window.openWorkspaceParticipantFile(slug);
                    return;
                }

                if (e.target.closest('#btn-wp-back-overview')) {
                    closeWorkspaceParticipantFile();
                    return;
                }

                if (e.target.closest('#btn-wp-refresh-file') && state.activeFileSlug) {
                    await window.openWorkspaceParticipantFile(state.activeFileSlug, { preserveScroll: true });
                    return;
                }

                if (e.target.closest('#btn-wp-refresh-todos')) {
                    try {
                        const res = await wpAuthFetch('/api/workspace/todos/refresh', { method: 'POST' });
                        state.todos = res.todos;
                        renderTodosSection();
                        showGlobalStatus('Re-scanned case notes for next steps.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                const delTodoBtn = e.target.closest('[data-todo-delete]');
                if (delTodoBtn) {
                    const tid = delTodoBtn.getAttribute('data-todo-delete');
                    try {
                        await wpAuthFetch(`/api/workspace/todos/${encodeURIComponent(tid)}`, { method: 'DELETE' });
                        state.todos = await wpAuthFetch('/api/workspace/todos');
                        renderTodosSection();
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (e.target.closest('#btn-wp-toggle-ssn')) {
                    state.ssnRevealed = !state.ssnRevealed;
                    const ssnInput = document.getElementById('wp-bi-ssn');
                    const ssnBtn = document.getElementById('btn-wp-toggle-ssn');
                    if (ssnInput) ssnInput.type = state.ssnRevealed ? 'text' : 'password';
                    if (ssnBtn) {
                        ssnBtn.setAttribute('aria-pressed', state.ssnRevealed ? 'true' : 'false');
                        ssnBtn.textContent = state.ssnRevealed ? 'Hide' : 'Show';
                    }
                    return;
                }

                const toggleDocBtn = e.target.closest('[data-wp-toggle-doc]');
                if (toggleDocBtn) {
                    const docType = toggleDocBtn.getAttribute('data-wp-toggle-doc');
                    const ed = document.getElementById(`wp-doc-editor-${docType}`);
                    if (ed) ed.classList.toggle('hidden');
                    return;
                }

                const saveDocBtn = e.target.closest('[data-wp-save-doc]');
                if (saveDocBtn && state.activeFileSlug) {
                    const docType = saveDocBtn.getAttribute('data-wp-save-doc');
                    const content = document.getElementById(`wp-doc-textarea-${docType}`)?.value || '';
                    const reason = document.getElementById(`wp-doc-reason-${docType}`)?.value?.trim() || '';
                    if (!content.trim()) return alert('Document content cannot be empty.');
                    saveDocBtn.disabled = true;
                    try {
                        await wpAuthFetch(`/api/participants/folder/${encodeURIComponent(state.activeFileSlug)}/save-document`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ docType, content, reason })
                        });
                        showGlobalStatus('Document updated and prior version archived.');
                        await window.openWorkspaceParticipantFile(state.activeFileSlug, { preserveScroll: true });
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    } finally {
                        saveDocBtn.disabled = false;
                    }
                    return;
                }

                if (e.target.closest('#btn-wp-autofill-briefcase') && state.activeFileSlug) {
                    const btn = e.target.closest('#btn-wp-autofill-briefcase');
                    btn.disabled = true;
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/briefcase/autofill`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ overwrite_manual: false })
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const bcDet = document.getElementById('wp-pf-briefcase');
                        if (bcDet) bcDet.open = true;
                        showGlobalStatus(`Auto-filled Briefcase from Case Notes, Consultation & Case Plan (${(res.updated_fields || []).length} field(s) evaluated).`);
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    } finally {
                        btn.disabled = false;
                    }
                    return;
                }

                if (e.target.closest('#btn-wp-save-briefcase') && state.activeFileSlug) {
                    const items = {};
                    portal.querySelectorAll('.wp-bc-select').forEach(sel => {
                        const k = sel.getAttribute('data-bc-key');
                        const noteEl = document.getElementById(`wp-bc-note-${k}`);
                        items[k] = {
                            value: sel.value,
                            notes: noteEl ? noteEl.value : '',
                            source: 'manual_dropdown'
                        };
                    });
                    const hasChronic = document.getElementById('wp-bc-chronic-toggle')?.value || 'no';
                    const manualNotes = document.getElementById('wp-bc-manual-notes')?.value || '';
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/briefcase`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                has_chronic_health_condition: hasChronic,
                                manual_notes: manualNotes,
                                items
                            })
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const bcDet = document.getElementById('wp-pf-briefcase');
                        if (bcDet) bcDet.open = true;
                        showGlobalStatus('Briefcase saved successfully.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }
            });

            portal.addEventListener('input', (e) => {
                if (e.target && e.target.id === 'wp-client-search-input') {
                    state.searchQuery = e.target.value || '';
                    renderSearchResultsIntoGrid();
                }
            });

            portal.addEventListener('change', async (e) => {
                const t = e.target;
                if (!t) return;

                if (t.id === 'wp-client-center-filter') {
                    state.searchCenter = t.value;
                    renderSearchResultsIntoGrid();
                    return;
                }
                if (t.id === 'wp-client-doc-filter') {
                    state.searchFilter = t.value;
                    renderSearchResultsIntoGrid();
                    return;
                }
                if (t.id === 'wp-toggle-show-completed-todos') {
                    state.showCompletedTodos = Boolean(t.checked);
                    renderTodosSection();
                    return;
                }
                if (t.hasAttribute('data-todo-toggle')) {
                    const tid = t.getAttribute('data-todo-toggle');
                    try {
                        await wpAuthFetch(`/api/workspace/todos/${encodeURIComponent(tid)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ completed: Boolean(t.checked) })
                        });
                        state.todos = await wpAuthFetch('/api/workspace/todos');
                        renderTodosSection();
                    } catch (err) {
                        t.checked = !t.checked;
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }
                if (t.id === 'wp-con-chronic') {
                    const wrap = document.getElementById('wp-con-chronic-status-wrap');
                    if (wrap) wrap.classList.toggle('hidden', t.value !== 'yes');
                    return;
                }
                if (t.id === 'wp-bc-chronic-toggle' && state.activeFileSlug) {
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/briefcase`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                has_chronic_health_condition: t.value,
                                items: {
                                    chronic_health_and_meds: {
                                        value: t.value === 'yes' ? 'needs_medical_appointment' : 'no_chronic_conditions_na',
                                        source: 'manual_dropdown'
                                    }
                                }
                            })
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const bcDet = document.getElementById('wp-pf-briefcase');
                        if (bcDet) bcDet.open = true;
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }
            });

            portal.addEventListener('submit', async (e) => {
                const form = e.target;
                if (!form) return;

                if (form.id === 'form-wp-search-clients') {
                    e.preventDefault();
                    renderSearchResultsIntoGrid();
                    return;
                }

                if (form.id === 'form-wp-add-todo') {
                    e.preventDefault();
                    const pKey = document.getElementById('wp-add-todo-client')?.value;
                    const title = document.getElementById('wp-add-todo-title')?.value?.trim();
                    const details = document.getElementById('wp-add-todo-details')?.value?.trim() || '';
                    if (!pKey || !title) return;
                    try {
                        await wpAuthFetch('/api/workspace/todos', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ participant_key: pKey, title, details })
                        });
                        state.todos = await wpAuthFetch('/api/workspace/todos');
                        renderTodosSection();
                        showGlobalStatus('Added manual next step to To-Dos.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-create-client') {
                    e.preventDefault();
                    const full_name = document.getElementById('wp-new-client-name')?.value?.trim();
                    const primary_center = document.getElementById('wp-new-client-center')?.value;
                    const assigned_program_manager = document.getElementById('wp-new-client-pm')?.value?.trim();
                    const phone = document.getElementById('wp-new-client-phone')?.value?.trim();
                    if (!full_name) return;
                    try {
                        const res = await wpAuthFetch('/api/workspace/participants', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ full_name, primary_center, assigned_program_manager, phone })
                        });
                        await window.initWorkspacePortal(true);
                        await window.openWorkspaceParticipantFile(res.file.participant_key);
                        showGlobalStatus(`Created participant file for ${full_name}.`);
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-basic-info' && state.activeFileSlug) {
                    e.preventDefault();
                    const centers = Array.from(form.querySelectorAll('input[name="attached_centers"]:checked')).map(cb => cb.value);
                    const payload = {
                        full_name: document.getElementById('wp-bi-name')?.value?.trim(),
                        phone: document.getElementById('wp-bi-phone')?.value?.trim(),
                        email: document.getElementById('wp-bi-email')?.value?.trim(),
                        dob: document.getElementById('wp-bi-dob')?.value?.trim(),
                        ssn: document.getElementById('wp-bi-ssn')?.value?.trim(),
                        assigned_program_manager: document.getElementById('wp-bi-pm')?.value?.trim(),
                        street_address: document.getElementById('wp-bi-street')?.value?.trim(),
                        city: document.getElementById('wp-bi-city')?.value?.trim(),
                        state: document.getElementById('wp-bi-state')?.value?.trim(),
                        zip: document.getElementById('wp-bi-zip')?.value?.trim(),
                        status: document.getElementById('wp-bi-status')?.value,
                        attached_centers: centers
                    };
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/basic-info`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        showGlobalStatus('Basic Information saved.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-screening' && state.activeFileSlug) {
                    e.preventDefault();
                    const payload = {
                        screening_date: document.getElementById('wp-scr-date')?.value,
                        eligibility_status: document.getElementById('wp-scr-eligibility')?.value,
                        referral_source: document.getElementById('wp-scr-referral')?.value?.trim(),
                        age_25_to_50: document.getElementById('wp-scr-age-ok')?.value,
                        notes: document.getElementById('wp-scr-notes')?.value?.trim()
                    };
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/screening`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const scrDet = document.getElementById('wp-pf-screening');
                        if (scrDet) scrDet.open = true;
                        showGlobalStatus('Screening record saved.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-consultation' && state.activeFileSlug) {
                    e.preventDefault();
                    const payload = {
                        consultation_date: document.getElementById('wp-con-date')?.value,
                        eligibility_decision: document.getElementById('wp-con-decision')?.value,
                        has_state_id_or_dl: document.getElementById('wp-con-id')?.value,
                        has_ss_card: document.getElementById('wp-con-ss')?.value,
                        has_birth_certificate: document.getElementById('wp-con-bc')?.value,
                        housing_status: document.getElementById('wp-con-housing')?.value?.trim(),
                        has_chronic_health_condition: document.getElementById('wp-con-chronic')?.value,
                        chronic_health_and_meds: document.getElementById('wp-con-chronic-status')?.value,
                        supervision_notes: document.getElementById('wp-con-supervision')?.value?.trim(),
                        summary_notes: document.getElementById('wp-con-summary')?.value?.trim()
                    };
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/consultation`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const conDet = document.getElementById('wp-pf-consultation');
                        if (conDet) conDet.open = true;
                        showGlobalStatus('Consultation saved and synced to Briefcase.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-feedback-loop' && state.activeFileSlug) {
                    e.preventDefault();
                    try {
                        await wpAuthFetch('/api/lscmi/feedback-loop', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                participant_name: state.activeFile?.name || state.activeFileSlug,
                                agreement_status: document.getElementById('wp-fl-status')?.value || 'resolved_via_feedback_loop',
                                disagreed_target: document.getElementById('wp-fl-disagreed')?.value?.trim() || 'Initial Focus Area',
                                agreed_replacement_target: document.getElementById('wp-fl-replacement')?.value?.trim() || 'Stop & Think (1I)',
                                participant_objection_quote: document.getElementById('wp-fl-quote')?.value?.trim() || 'Reviewed in 1-on-1 Feedback Loop.'
                            })
                        });
                        await window.openWorkspaceParticipantFile(state.activeFileSlug, { preserveScroll: true });
                        const lsDet = document.getElementById('wp-pf-lscmi');
                        if (lsDet) lsDet.open = true;
                        showGlobalStatus('Action Plan Feedback Loop saved.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                    return;
                }

                if (form.id === 'form-wp-add-case-note' && state.activeFileSlug) {
                    e.preventDefault();
                    const payload = {
                        session_date: document.getElementById('wp-cn-date')?.value,
                        note_type: document.getElementById('wp-cn-type')?.value,
                        category: document.getElementById('wp-cn-category')?.value,
                        content: document.getElementById('wp-cn-content')?.value?.trim(),
                        auto_fill_briefcase: true
                    };
                    if (!payload.content) return;
                    try {
                        const res = await wpAuthFetch(`/api/workspace/participant/${encodeURIComponent(state.activeFileSlug)}/case-note`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        state.activeFile = res.file;
                        renderParticipantFileShell(res.file);
                        const bcDet = document.getElementById('wp-pf-briefcase');
                        if (bcDet) bcDet.open = true;
                        showGlobalStatus('Case note saved; To-Dos and Briefcase synced.');
                    } catch (err) {
                        showGlobalStatus(err.message, true);
                    }
                }
            });
        }

        // Admin Users Modal listeners
        const adminModal = document.getElementById('modal-admin-users');
        if (adminModal) {
            adminModal.addEventListener('click', async (e) => {
                if (e.target.closest('#btn-close-admin-users')) {
                    adminModal.classList.add('hidden');
                    return;
                }
                const delBtn = e.target.closest('[data-adm-delete-user]');
                if (delBtn) {
                    const uid = delBtn.getAttribute('data-adm-delete-user');
                    if (!confirm('Delete this staff user account?')) return;
                    try {
                        await wpAuthFetch(`/api/admin/staff-users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
                        const fresh = await wpAuthFetch('/api/admin/staff-users');
                        renderAdminUsersBody(fresh.users || [], fresh.valid_centers || VALID_CENTERS);
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });

            adminModal.addEventListener('change', (e) => {
                if (e.target && e.target.id === 'adm-new-type') {
                    const wrap = document.getElementById('adm-new-center-wrap');
                    if (wrap) wrap.classList.toggle('hidden', e.target.value === 'Admin');
                }
            });

            adminModal.addEventListener('submit', async (e) => {
                const form = e.target;
                if (!form) return;
                e.preventDefault();

                if (form.id === 'form-admin-create-user') {
                    const userType = document.getElementById('adm-new-type')?.value || 'User';
                    const payload = {
                        name: document.getElementById('adm-new-name')?.value?.trim(),
                        email: document.getElementById('adm-new-email')?.value?.trim(),
                        password: document.getElementById('adm-new-pass')?.value,
                        user_type: userType,
                        location: userType === 'Admin' ? 'All' : document.getElementById('adm-new-center')?.value
                    };
                    try {
                        await wpAuthFetch('/api/admin/staff-users', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const fresh = await wpAuthFetch('/api/admin/staff-users');
                        renderAdminUsersBody(fresh.users || [], fresh.valid_centers || VALID_CENTERS);
                    } catch (err) {
                        alert(err.message);
                    }
                    return;
                }

                if (form.classList.contains('wp-admin-user-row')) {
                    const uid = form.getAttribute('data-user-id');
                    const payload = {
                        name: form.querySelector('[name="name"]')?.value?.trim(),
                        email: form.querySelector('[name="email"]')?.value?.trim(),
                        user_type: form.querySelector('[name="user_type"]')?.value,
                        location: form.querySelector('[name="location"]')?.value,
                        password: form.querySelector('[name="password"]')?.value || '',
                        is_active: Boolean(form.querySelector('[name="is_active"]')?.checked)
                    };
                    try {
                        await wpAuthFetch(`/api/admin/staff-users/${encodeURIComponent(uid)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const fresh = await wpAuthFetch('/api/admin/staff-users');
                        renderAdminUsersBody(fresh.users || [], fresh.valid_centers || VALID_CENTERS);
                        showGlobalStatus('Staff account updated.');
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        }

        // Change Password Modal listeners
        const cpModal = document.getElementById('modal-change-password');
        if (cpModal) {
            cpModal.addEventListener('click', (e) => {
                if (e.target.closest('#btn-close-change-password') || e.target.closest('#btn-cancel-change-password')) {
                    cpModal.classList.add('hidden');
                }
            });
            const cpForm = document.getElementById('form-change-password');
            if (cpForm) {
                cpForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const currentPassword = document.getElementById('cp-current-password')?.value || '';
                    const newPassword = document.getElementById('cp-new-password')?.value || '';
                    const msg = document.getElementById('cp-status-msg');
                    try {
                        const res = await wpAuthFetch('/api/auth/change-password', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ currentPassword, newPassword })
                        });
                        if (msg) {
                            msg.className = 'wp-status-banner';
                            msg.textContent = res.message || 'Password updated!';
                        }
                        setTimeout(() => cpModal.classList.add('hidden'), 1200);
                    } catch (err) {
                        if (msg) {
                            msg.className = 'wp-error-banner';
                            msg.textContent = err.message;
                        }
                    }
                });
            }
        }
    });
})();
