// Unified Frontend Application Script
// First Shift & Re-entry Navigation Platform

let currentUser = null;
let currentProfile = null;
let currentGateWeek = 1;
let currentQuestions = [];
let currentQuestionIndex = 0;
let mediaRecorder = null;
let audioChunks = [];
let recognition = null;
let fullTranscript = '';
let currentInterviewsData = {};

// -------------------------------------------------------------
// INITIALIZATION & SESSION RESTORE
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    loadInterviewQuestions();
    const token = localStorage.getItem('fs_token');
    if (token) {
        await restoreSession(token);
    } else {
        showView('view-auth');
    }
});

async function restoreSession(token) {
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            currentProfile = data.profile;
            updateNav();
            routeUserToPortal();
        } else {
            localStorage.removeItem('fs_token');
            showView('view-auth');
        }
    } catch (err) {
        console.error('Session restore failed:', err);
        showView('view-auth');
    }
}

function updateNav() {
    const navRight = document.getElementById('nav-user-section');
    if (!currentUser) {
        navRight.innerHTML = '';
        return;
    }

    const roleBadge = currentUser.role === 'program_manager' ? 'Program Manager' : 
                     (currentUser.track === 'first_shift' ? 'First Shift' : 'Re-entry Nav');

    navRight.innerHTML = `
        <span style="color: #94a3b8;">${currentUser.name} (<strong>${roleBadge}</strong>)</span>
        <button class="btn btn-outline" style="padding: 6px 12px; font-size: 12px;" onclick="handleLogout()">Sign Out</button>
    `;
}

function routeUserToPortal() {
    if (!currentUser) return showView('view-auth');

    if (currentUser.role === 'program_manager' || currentUser.role === 'admin') {
        showView('view-pm-portal');
        loadCaseload();
        loadPmDrafts();
    } else if (currentUser.track === 'first_shift') {
        showView('view-fs-portal');
        loadFsDashboard();
    } else {
        showView('view-rn-portal');
        loadRnDashboard();
    }
}

function showView(viewId) {
    document.querySelectorAll('.app-view').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}

// -------------------------------------------------------------
// AUTHENTICATION LOGIC
// -------------------------------------------------------------
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    if (tab === 'login') {
        document.querySelector('.auth-tabs .tab-btn:first-child').classList.add('active');
        document.getElementById('form-login').classList.remove('hidden');
        document.getElementById('form-register').classList.add('hidden');
    } else {
        document.querySelector('.auth-tabs .tab-btn:last-child').classList.add('active');
        document.getElementById('form-login').classList.add('hidden');
        document.getElementById('form-register').classList.remove('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        localStorage.setItem('fs_token', data.token);
        currentUser = data.user;
        updateNav();
        routeUserToPortal();
    } catch (err) {
        alert('Login Error: ' + err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const phone = document.getElementById('reg-phone').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const track = document.getElementById('reg-track').value;
    const location = document.getElementById('reg-location').value;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, email, password, track, location })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        localStorage.setItem('fs_token', data.token);
        currentUser = data.user;
        updateNav();
        routeUserToPortal();
    } catch (err) {
        alert('Registration Error: ' + err.message);
    }
}

function handleLogout() {
    localStorage.removeItem('fs_token');
    currentUser = null;
    currentProfile = null;
    updateNav();
    showView('view-auth');
}

// -------------------------------------------------------------
// FIRST SHIFT PARTICIPANT DASHBOARD
// -------------------------------------------------------------
async function loadFsDashboard() {
    const token = localStorage.getItem('fs_token');
    if (!token) return;

    try {
        const res = await fetch('/api/participant/gate-status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        currentProfile = data.profile;

        document.getElementById('fs-welcome-title').innerText = `Welcome, ${currentUser.name}`;
        document.getElementById('fs-gate-badge').innerText = `Current: Gate ${data.currentGate} (Week ${data.currentGate})`;

        // Card 1: Check if intake is completed
        const w1Criteria = (data.weeks && data.weeks[1]) || [];
        const interviewCrit = w1Criteria.find(c => c.criterion_key === 'w1_interview');
        const intakeDesc = document.getElementById('fs-intake-desc');
        const intakeBtn = document.getElementById('fs-intake-btn');
        
        if (interviewCrit && interviewCrit.status === 'green') {
            intakeDesc.innerHTML = `<span class="badge badge-green" style="margin-bottom: 6px; display: inline-block;">✅ Assessment Completed (Pending Supervisor Review)</span><p style="font-size: 13px; color: var(--slate); margin-top: 4px;">Your 158-question LS/CMI intake interview has been recorded and submitted for clinical brief generation.</p>`;
            intakeBtn.innerText = 'Intake Completed';
            intakeBtn.className = 'btn btn-outline';
            intakeBtn.onclick = () => alert('Your LS/CMI intake interview is already completed and recorded.');
        } else {
            intakeDesc.innerText = 'Complete the full 158-question LS/CMI intake interview. Your audio is recorded and scored directly for your clinical case brief and Apricot import.';
            intakeBtn.innerText = 'Start Voice Interview';
            intakeBtn.className = 'btn btn-accent';
            intakeBtn.onclick = openInterviewModal;
        }

        // Card 2: W-9 card status & view button
        const w9Card = document.getElementById('w9-card-status');
        const btnW9View = document.getElementById('btn-w9-view');
        const btnW9Action = document.getElementById('btn-w9-action');

        if (currentProfile && (currentProfile.w9_status === 'submitted' || currentProfile.w9_status === 'verified')) {
            w9Card.innerHTML = `<span style="color: green; font-weight: bold;">✅ Status: W-9 Recorded (${currentProfile.w9_status})</span>`;
            btnW9Action.innerText = 'Edit Form W-9';
            if (btnW9View) btnW9View.classList.remove('hidden');
        } else {
            w9Card.innerHTML = `Status: Incomplete. Submit your W-9 for onboarding.`;
            btnW9Action.innerText = 'Complete Form W-9';
            if (btnW9View) btnW9View.classList.add('hidden');
        }

        renderGateCriteria(data.weeks, currentGateWeek);
        loadFsPoints();
        loadBriefcaseChecklist();
    } catch (err) {
        console.error('Failed to load FS dashboard:', err);
    }
}

async function loadBriefcaseChecklist() {
    const token = localStorage.getItem('fs_token');
    const container = document.getElementById('briefcase-domains-container');
    if (!container) return;

    try {
        const res = await fetch('/api/participant/briefcase', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        const domainLabels = {
            core_stability: '🛡️ Core Stability & Documents',
            employment_readiness: '👔 Employment Readiness',
            credentials: '🏅 Industry Credentials & Training',
            health_wellness: '🏥 Health & Wellness',
            financial: '💵 Financial & Life Management',
            career_planning: '🚀 Career Planning & Goals'
        };

        let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">';

        for (const [domainKey, label] of Object.entries(domainLabels)) {
            const items = data.items[domainKey] || [];
            html += `
                <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
                    <h4 style="font-size: 15px; font-weight: 700; color: var(--primary); margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">${label}</h4>
                    <p style="font-size: 11px; color: var(--slate); margin-bottom: 8px;">Click any item to update status or add notes.</p>
                    <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
                        ${items.map(i => `
                            <li onclick="openBriefcaseItemEditModal('${i.item_key}', '${i.title.replace(/'/g, "\\'")}', '${i.status}', '${(i.notes || '').replace(/'/g, "\\'")}')" 
                                style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; background: white; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;"
                                onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">
                                <div>
                                    <strong>${i.title}</strong>
                                    ${i.notes ? `<div style="font-size: 11px; color: var(--slate); margin-top: 2px;">📝 ${i.notes}</div>` : ''}
                                </div>
                                <span class="badge ${i.status === 'green' ? 'badge-green' : (i.status === 'red' ? 'badge-red' : 'badge-pending')}" style="font-size: 10px; padding: 3px 8px; white-space: nowrap;">
                                    ${i.status === 'green' ? 'Complete' : (i.status === 'red' ? 'Barrier' : 'Pending')}
                                </span>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        console.error('Failed to load briefcase checklist:', e);
    }
}

function openBriefcaseItemEditModal(itemKey, title, status, notes) {
    document.getElementById('bfe-item-key').value = itemKey;
    document.getElementById('bfe-modal-title').innerText = `Edit: ${title}`;
    document.getElementById('bfe-status').value = status || 'pending';
    document.getElementById('bfe-notes').value = notes || '';
    openModal('modal-briefcase-item-edit');
}

async function handleBriefcaseItemSave(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const itemKey = document.getElementById('bfe-item-key').value;
    const status = document.getElementById('bfe-status').value;
    const notes = document.getElementById('bfe-notes').value;

    try {
        const res = await fetch('/api/participant/briefcase-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ itemKey, status, notes })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        closeModal('modal-briefcase-item-edit');
        loadBriefcaseChecklist();
    } catch (err) {
        alert('Failed to save item: ' + err.message);
    }
}

async function loadFsPoints() {
    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch('/api/participant/points', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.summary && data.summary.avg_points !== null) {
            document.getElementById('fs-avg-points').innerText = Number(data.summary.avg_points).toFixed(1);
            document.getElementById('fs-attendance-summary').innerText = `${data.summary.present_days || 0} days present • ${data.summary.unexcused_days || 0} unexcused absences`;
        }
    } catch (e) {}
}

function switchGateWeek(week) {
    currentGateWeek = week;
    document.querySelectorAll('.gate-tab-btn').forEach((b, idx) => {
        if (idx + 1 === week) b.classList.add('active');
        else b.classList.remove('active');
    });
    loadFsDashboard();
}

function renderGateCriteria(weeksData, selectedWeek) {
    const container = document.getElementById('gate-criteria-table-container');
    const criteria = weeksData[selectedWeek] || [];

    if (criteria.length === 0) {
        container.innerHTML = '<p class="text-slate">No criteria defined for this week.</p>';
        return;
    }

    let html = '<div class="gate-criteria-list">';
    criteria.forEach(c => {
        let badgeClass = 'badge-pending';
        let badgeText = 'Pending';
        if (c.status === 'green') {
            badgeClass = 'badge-green';
            badgeText = 'Green (Met)';
        } else if (c.status === 'red') {
            badgeClass = 'badge-red';
            badgeText = 'Red (Action Needed)';
        }

        html += `
            <div class="gate-criterion-item">
                <div class="criterion-info">
                    <h4>${c.title}</h4>
                    <p>${c.description || ''}</p>
                    ${c.pm_notes ? `<div class="criterion-notes"><strong>PM Notes:</strong> ${c.pm_notes}</div>` : ''}
                </div>
                <div class="criterion-badge">
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

// -------------------------------------------------------------
// W-9 & BARRIER ACTIONS
// -------------------------------------------------------------
function openW9Modal() {
    if (currentUser) {
        document.getElementById('w9-name').value = currentUser.name;
    }
    openModal('modal-w9');
}

async function handleW9Submit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const payload = {
        fullName: document.getElementById('w9-name').value,
        businessName: document.getElementById('w9-business').value,
        taxClassification: document.getElementById('w9-classification').value,
        address: document.getElementById('w9-address').value,
        cityStateZip: document.getElementById('w9-city-state-zip').value,
        ssnOrEin: document.getElementById('w9-ssn').value,
        signatureDate: new Date().toISOString().split('T')[0]
    };

    try {
        const res = await fetch('/api/participant/w9', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Form W-9 successfully submitted and recorded.');
        closeModal('modal-w9');
        loadFsDashboard();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function openBarriersModal() {
    if (currentProfile) {
        document.getElementById('bar-dl-status').value = currentProfile.dl_status || 'valid';
        document.getElementById('bar-dl-notes').value = currentProfile.dl_notes || '';
        document.getElementById('bar-cs-status').value = currentProfile.child_support_status || 'none';
        document.getElementById('bar-cs-notes').value = currentProfile.child_support_notes || '';
        document.getElementById('bar-housing-status').value = currentProfile.housing_status || 'stable';
        document.getElementById('bar-trans-status').value = currentProfile.transportation_status || 'bus';
        document.getElementById('bar-court-dates').value = currentProfile.court_dates || '';
    }
    openModal('modal-barriers');
}

async function handleBarriersSubmit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const payload = {
        dl_status: document.getElementById('bar-dl-status').value,
        dl_notes: document.getElementById('bar-dl-notes').value,
        child_support_status: document.getElementById('bar-cs-status').value,
        child_support_notes: document.getElementById('bar-cs-notes').value,
        housing_status: document.getElementById('bar-housing-status').value,
        transportation_status: document.getElementById('bar-trans-status').value,
        court_dates: document.getElementById('bar-court-dates').value
    };

    try {
        const res = await fetch('/api/participant/barriers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Barrier action plan updated.');
        closeModal('modal-barriers');
        loadFsDashboard();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function handleClassFeedback(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const payload = {
        sessionTitle: document.getElementById('fb-session').value,
        facilitator: document.getElementById('fb-facilitator').value,
        rating: parseInt(document.getElementById('fb-rating').value),
        keyTakeaway: document.getElementById('fb-text').value,
        feedbackText: document.getElementById('fb-text').value
    };

    try {
        const res = await fetch('/api/participant/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Feedback submitted. Thank you!');
        document.getElementById('form-class-feedback').reset();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// -------------------------------------------------------------
// RE-ENTRY NAVIGATION PORTAL
// -------------------------------------------------------------
function switchRnSection(section) {
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.rn-sub-view').forEach(view => view.classList.add('hidden'));

    if (section === 'jobs') {
        document.querySelector('.sub-tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('rn-section-jobs').classList.remove('hidden');
        loadJobs();
    } else if (section === 'resume') {
        document.querySelector('.sub-tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('rn-section-resume').classList.remove('hidden');
        loadSavedResume();
    } else if (section === 'cbt') {
        document.querySelector('.sub-tab-btn:nth-child(3)').classList.add('active');
        document.getElementById('rn-section-cbt').classList.remove('hidden');
        loadCbtModules();
    } else if (section === 'locker') {
        document.querySelector('.sub-tab-btn:nth-child(4)').classList.add('active');
        document.getElementById('rn-section-locker').classList.remove('hidden');
        loadLockerDocs();
    }
}

function loadRnDashboard() {
    switchRnSection('jobs');
}

async function loadJobs() {
    const grid = document.getElementById('job-listings-grid');
    try {
        const res = await fetch('/api/jobs');
        const jobs = await res.json();

        grid.innerHTML = jobs.map(j => `
            <div class="job-card">
                <h3>${j.role}</h3>
                <div class="job-company">${j.company}</div>
                <div class="job-meta">📍 ${j.location} • 💰 ${j.pay} • ⏰ ${j.shift}</div>
                <p class="job-desc">${j.description}</p>
                <button class="btn btn-outline" style="margin-top: 12px; font-size: 12px;" onclick="alert('Staff will assist you in connecting with ${j.company}!')">Request Employer Match</button>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = '<p>Unable to load job listings.</p>';
    }
}

async function loadSavedResume() {
    const token = localStorage.getItem('fs_token');
    if (!token) return;

    if (currentUser) {
        document.getElementById('res-name').value = currentUser.name;
        document.getElementById('res-phone').value = currentUser.phone || '';
        document.getElementById('res-location').value = `${currentUser.location || 'Charleston'}, SC`;
    }

    try {
        const res = await fetch('/api/resume', { headers: { 'Authorization': `Bearer ${token}` } });
        const resume = await res.json();
        if (resume) {
            document.getElementById('res-objective').value = resume.objective || '';
            document.getElementById('res-skills').value = resume.skills || '';
            document.getElementById('res-experience').value = resume.experience || '';
            document.getElementById('res-education').value = resume.education || '';
        }
    } catch (e) {}
}

async function handleSaveResume(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const resumeData = {
        name: document.getElementById('res-name').value,
        phone: document.getElementById('res-phone').value,
        location: document.getElementById('res-location').value,
        objective: document.getElementById('res-objective').value,
        skills: document.getElementById('res-skills').value,
        experience: document.getElementById('res-experience').value,
        education: document.getElementById('res-education').value
    };

    try {
        const res = await fetch('/api/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ resumeData })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Master Resume saved successfully!');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function loadCbtModules() {
    const container = document.getElementById('cbt-accordion-container');
    try {
        const [cbtRes, tradesRes] = await Promise.all([
            fetch('/api/training/cbt-modules'),
            fetch('/api/training/trades-tracks')
        ]);
        const cbtModules = await cbtRes.json();
        const tradeTracks = await tradesRes.json();

        let html = `
            <div style="margin-bottom: 28px;">
                <h3 style="font-size: 18px; font-weight: 800; color: var(--primary); margin-bottom: 12px;">🧠 Turn90 CBT Modules</h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${cbtModules.map(m => `
                        <div class="module-card">
                            <h3>${m.title}</h3>
                            <p style="color: var(--slate); font-size: 13px; margin-bottom: 8px;">${m.description}</p>
                            <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
                                <strong style="color: var(--primary);">Key Takeaway:</strong> ${m.keyTakeaway}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div>
                <h3 style="font-size: 18px; font-weight: 800; color: var(--primary); margin-bottom: 12px;">🦺 Turn90 SkillsCommons Trades Tracks</h3>
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    ${tradeTracks.map(t => `
                        <div class="module-card" style="border-left: 4px solid var(--accent);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <h3 style="margin-bottom: 0;">${t.icon} ${t.title}</h3>
                                <span class="badge badge-green">${t.badgeName}</span>
                            </div>
                            <p style="color: var(--slate); font-size: 13px; margin-bottom: 12px;">${t.description}</p>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                ${t.lessons.map((l, lIdx) => `
                                    <div style="background: white; padding: 14px; border-radius: 6px; border: 1px solid var(--border);">
                                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                                            <strong>Lesson ${lIdx + 1}: ${l.title}</strong>
                                            ${l.videoUrl ? `<a href="${l.videoUrl}" target="_blank" class="btn btn-outline" style="padding: 2px 8px; font-size: 11px;">▶ Watch Video</a>` : ''}
                                        </div>
                                        <p style="font-size: 12px; color: var(--slate); margin: 4px 0 8px 0;">${l.description}</p>
                                        ${l.safetyTip ? `<div style="font-size: 12px; color: #b45309; background: #fef3c7; padding: 6px 10px; border-radius: 4px; margin-bottom: 6px;"><strong>⚠️ Safety Tip:</strong> ${l.safetyTip}</div>` : ''}
                                        <ul style="font-size: 12px; color: #334155; padding-left: 18px;">
                                            ${l.keyTakeaways.map(k => `<li>${k}</li>`).join('')}
                                        </ul>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        container.innerHTML = html;
    } catch (e) {
        console.error('Failed to load modules:', e);
        container.innerHTML = '<p>Unable to load modules.</p>';
    }
}

async function loadLockerDocs() {
    const token = localStorage.getItem('fs_token');
    const container = document.getElementById('locker-docs-list');
    try {
        const res = await fetch('/api/participant/documents', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const docs = await res.json();

        if (docs.length === 0) {
            container.innerHTML = '<p class="text-slate">No documents uploaded yet.</p>';
            return;
        }

        container.innerHTML = `
            <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
                ${docs.map(d => `
                    <li style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: white; border: 1px solid var(--border); border-radius: 6px;">
                        <div>
                            <strong>${d.title}</strong>
                            <div style="font-size: 12px; color: var(--slate);">${d.doc_type.toUpperCase()} • Uploaded ${d.uploaded_at}</div>
                        </div>
                        ${d.file_path !== 'internal_json' ? `<a href="${d.file_path}" target="_blank" class="btn btn-outline" style="padding: 4px 10px; font-size: 12px;">View Document</a>` : '<span class="badge badge-green">Digital Form Verified</span>'}
                    </li>
                `).join('')}
            </ul>
        `;
    } catch (e) {}
}

async function handleDocUpload(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const fileInput = document.getElementById('locker-file');
    const docType = document.getElementById('locker-type').value;

    if (!fileInput.files[0]) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('docType', docType);
    formData.append('title', fileInput.files[0].name);

    try {
        const res = await fetch('/api/participant/upload-doc', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Document uploaded to locker.');
        fileInput.value = '';
        loadLockerDocs();
    } catch (err) {
        alert('Upload Error: ' + err.message);
    }
}

// -------------------------------------------------------------
// PROGRAM MANAGER COMMAND CENTER
// -------------------------------------------------------------
async function loadCaseload() {
    const token = localStorage.getItem('fs_token');
    const loc = document.getElementById('pm-filter-location').value;
    const track = document.getElementById('pm-filter-track').value;
    const gate = document.getElementById('pm-filter-gate').value;

    let url = `/api/admin/caseload?location=${encodeURIComponent(loc)}&track=${encodeURIComponent(track)}&gate=${encodeURIComponent(gate)}`;

    try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const roster = await res.json();
        const tbody = document.getElementById('caseload-tbody');

        if (roster.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px;">No participants match this filter.</td></tr>';
            return;
        }

        tbody.innerHTML = roster.map(p => `
            <tr>
                <td>
                    <strong>${p.name}</strong>
                    <div style="font-size: 11px; color: var(--slate);">${p.email} • ${p.phone || 'No phone'}</div>
                </td>
                <td>
                    <span class="badge ${p.track === 'first_shift' ? 'badge-green' : 'badge-pending'}">
                        ${p.track === 'first_shift' ? 'First Shift' : 'Re-entry Nav'}
                    </span>
                    <div style="font-size: 11px; color: var(--slate); margin-top: 2px;">${p.location}</div>
                </td>
                <td>
                    <strong>Gate ${p.current_gate || 1}</strong>
                </td>
                <td>
                    <span class="badge ${p.w9_status === 'verified' ? 'badge-green' : (p.w9_status === 'submitted' ? 'badge-pending' : 'badge-red')}">
                        ${p.w9_status || 'Missing'}
                    </span>
                    ${p.w9_status === 'submitted' || p.w9_status === 'verified' ? `<div style="margin-top: 4px;"><a href="javascript:void(0)" onclick="openW9ViewModal(${p.id})" style="font-size: 11px; color: var(--accent); font-weight: 600; text-decoration: underline;">📄 View W-9</a></div>` : ''}
                </td>
                <td>
                    <div style="font-size: 11px;">
                        <strong>DL:</strong> ${p.dl_status || 'unknown'}<br>
                        <strong>CS:</strong> ${p.child_support_status || 'unknown'}
                    </div>
                </td>
                <td>
                    <strong>${p.avg_points ? Number(p.avg_points).toFixed(1) : '--'}</strong> / 10
                </td>
                <td>
                    <span style="color: var(--success); font-weight: bold;">${p.green_criteria || 0} Met</span> / 
                    <span style="color: var(--danger); font-weight: bold;">${p.red_criteria || 0} Red</span>
                </td>
                <td>
                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 11px;" onclick="openCaseReviewModal(${p.id}, '${p.name.replace(/'/g, "\\'")}')">
                            📋 Case Plan
                        </button>
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 11px; color: var(--danger); border-color: #fca5a5;" onclick="openStabilityActionModal(${p.id}, '${p.name.replace(/'/g, "\\'")}')">
                            🚦 Stability
                        </button>
                        <button class="btn btn-outline" style="padding: 3px 6px; font-size: 11px;" onclick="advanceParticipantGate(${p.id}, ${(p.current_gate || 1) + 1})">
                            Gate &rarr;
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Failed to load caseload:', e);
    }
}

function openCaseReviewModal(userId, name) {
    document.getElementById('cr-user-id').value = userId;
    document.getElementById('case-review-modal-title').innerText = `Weekly Case Planning: ${name}`;
    openModal('modal-case-review');
}

function toggleStabilityFields(val) {
    const box = document.getElementById('cr-stability-details-box');
    if (box) {
        if (val === "1") box.style.display = 'block';
        else box.style.display = 'none';
    }
}

async function handleCaseReviewSubmit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const payload = {
        userId: parseInt(document.getElementById('cr-user-id').value),
        weekNumber: 1,
        hasStabilityIssues: document.getElementById('cr-has-stability').value === '1',
        stabilityIssuesDetails: document.getElementById('cr-stability-details').value,
        canMeetRapidly: document.getElementById('cr-meet-rapidly').value === '1',
        needsMoreResources: document.getElementById('cr-more-resources').value === '1',
        attendanceSatisfactory: document.getElementById('cr-attendance').value === '1',
        abilityLearnQ2: document.getElementById('cr-q2-learning').value === '1',
        cbtHomeworkCompleted: document.getElementById('cr-cbt-hw').checked,
        cbtDiscussionActive: document.getElementById('cr-cbt-disc').checked,
        cbtRoleplayEffort: document.getElementById('cr-cbt-role').checked,
        transportationViable: document.getElementById('cr-trans-viable').value === '1',
        noDisqualifyingConvictions: document.getElementById('cr-no-convictions').value === '1',
        scheduleSupervisionAligned: document.getElementById('cr-supervision-aligned').value === '1',
        caseDecision: document.getElementById('cr-decision').value,
        decisionRationale: document.getElementById('cr-rationale').value
    };

    try {
        const res = await fetch('/api/admin/weekly-case-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert('Weekly Case Plan Review recorded.');
        closeModal('modal-case-review');
        loadCaseload();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function openStabilityActionModal(userId, name) {
    const token = localStorage.getItem('fs_token');
    document.getElementById('stab-user-id').value = userId;
    document.getElementById('stab-user-name').innerText = `Participant: ${name}`;

    try {
        const res = await fetch('/api/admin/stability-triggers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const triggers = await res.json();
        const container = document.getElementById('stability-triggers-checkboxes');

        container.innerHTML = triggers.map(t => `
            <label style="display: flex; align-items: baseline; gap: 6px; cursor: pointer;">
                <input type="checkbox" name="stability-trigger-cb" value="${t.key}">
                <span><strong>${t.title}</strong> — <span style="color: var(--slate); font-size: 11px;">${t.description}</span></span>
            </label>
        `).join('');

        openModal('modal-stability-action');
    } catch (e) {
        alert('Failed to load stability triggers: ' + e.message);
    }
}

function toggleOverrideFields(val) {
    const box = document.getElementById('override-fields-box');
    if (box) {
        if (val === 'director_override') box.classList.remove('hidden');
        else box.classList.add('hidden');
    }
}

async function handleStabilityActionSubmit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const selectedTriggers = Array.from(document.querySelectorAll('input[name="stability-trigger-cb"]:checked')).map(cb => cb.value);

    const payload = {
        userId: parseInt(document.getElementById('stab-user-id').value),
        action: document.getElementById('stab-action-select').value,
        triggers: selectedTriggers,
        overrideBy: document.getElementById('stab-override-by').value,
        overrideNotes: document.getElementById('stab-override-notes').value
    };

    try {
        const res = await fetch('/api/admin/stability-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(data.message);
        closeModal('modal-stability-action');
        loadCaseload();
    } catch (err) {
        alert('Action failed: ' + err.message);
    }
}

async function advanceParticipantGate(userId, nextGate) {
    if (nextGate > 4) {
        return alert('Participant is already at Gate 4 (Ready for Job Placement).');
    }
    if (!confirm(`Advance this participant to Gate ${nextGate}?`)) return;

    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch('/api/admin/advance-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ userId, nextGate })
        });
        const data = await res.json();
        alert(data.message);
        loadCaseload();
    } catch (e) {
        alert('Failed to advance gate: ' + e.message);
    }
}

// -------------------------------------------------------------
// W-9 VIEWER & PARTICIPANT CASE PLAN VIEWER
// -------------------------------------------------------------
async function openW9ViewModal(userId) {
    const token = localStorage.getItem('fs_token');
    const body = document.getElementById('w9-view-body');
    body.innerHTML = '<p>Loading Form W-9 record...</p>';
    openModal('modal-w9-view');

    try {
        const res = await fetch(`/api/participant/w9-details/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.w9Data) {
            body.innerHTML = `<p class="text-slate">No digital W-9 form on file for ${data.user ? data.user.name : 'this participant'}.</p>`;
            return;
        }

        const w9 = data.w9Data;
        body.innerHTML = `
            <div style="background: #ffffff; border: 2px solid #0f172a; border-radius: 8px; padding: 24px; font-family: monospace;">
                <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px;">
                    <div>
                        <h2 style="font-size: 20px; font-weight: 800; margin: 0;">Form W-9</h2>
                        <div style="font-size: 11px; color: #475569;">Request for Taxpayer Identification Number and Certification</div>
                    </div>
                    <div style="text-align: right;">
                        <span class="badge badge-green">STATUS: ${data.status.toUpperCase()}</span>
                        <div style="font-size: 11px; color: #475569; margin-top: 4px;">Signed: ${w9.signatureDate || 'On file'}</div>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr; gap: 12px; font-size: 13px;">
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong>1. Name (as shown on tax return):</strong> <span style="font-weight: bold; color: var(--primary);">${w9.fullName}</span>
                    </div>
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong>2. Business Name / Disregarded Entity:</strong> ${w9.businessName || 'N/A (Individual)'}
                    </div>
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong>3. Federal Tax Classification:</strong> ${w9.taxClassification}
                    </div>
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong>4. Address (number, street, apt):</strong> ${w9.address}
                    </div>
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                        <strong>5. City, State, and ZIP:</strong> ${w9.cityStateZip}
                    </div>
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; background: #fef3c7; padding: 8px; border-radius: 4px;">
                        <strong>Part I - Taxpayer Identification Number (SSN/EIN):</strong> 
                        <span style="letter-spacing: 2px; font-weight: bold; color: #b45309;">${w9.ssnOrEin}</span>
                    </div>
                </div>

                <div style="margin-top: 16px; font-size: 11px; color: #64748b; font-style: italic;">
                    Certification: Under penalties of perjury, the participant certifies that the number shown on this form is correct and they are not subject to backup withholding.
                </div>
            </div>
        `;
    } catch (e) {
        body.innerHTML = '<p>Failed to load W-9 details: ' + e.message + '</p>';
    }
}

async function openParticipantCasePlanModal() {
    const token = localStorage.getItem('fs_token');
    const body = document.getElementById('participant-case-plan-body');
    body.innerHTML = '<p>Loading your First Shift Action Plan...</p>';
    openModal('modal-participant-case-plan');

    try {
        const res = await fetch('/api/participant/case-plan', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (!data.found) {
            body.innerHTML = `
                <div style="text-align: center; padding: 32px;">
                    <div style="font-size: 40px; margin-bottom: 12px;">⏳</div>
                    <h3>Your First Shift Action Plan is in Progress</h3>
                    <p style="color: var(--slate); font-size: 14px; max-width: 480px; margin: 0 auto;">
                        Your case manager is currently reviewing your intake interview and scoring form. Once approved, your personalized top focus areas and weekly milestones will appear here.
                    </p>
                </div>
            `;
            return;
        }

        // Render formatted markdown
        body.innerHTML = `
            <div class="markdown-preview" style="line-height: 1.7; font-size: 13.5px; color: #1e293b;">
                ${typeof marked !== 'undefined' ? marked.parse(data.markdown) : data.markdown.replace(/\n/g, '<br>')}
            </div>
        `;
    } catch (e) {
        body.innerHTML = '<p>Failed to load case plan: ' + e.message + '</p>';
    }
}

// -------------------------------------------------------------
// DRAFT SCORING PREVIEWS & SUPERVISOR REVIEW (PHASE 2)
// -------------------------------------------------------------
async function loadPmDrafts() {
    const list = document.getElementById('pm-drafts-list');
    try {
        const res = await fetch('/api/interviews');
        const clients = await res.json();
        currentInterviewsData = clients;

        const clientIds = Object.keys(clients);
        if (clientIds.length === 0) {
            list.innerHTML = '<p class="text-slate">No interview records found in data directory.</p>';
            return;
        }

        let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

        clientIds.forEach(clientId => {
            const files = clients[clientId];
            const hasDraft = files.some(f => f.includes('draft_scoring_form.md'));
            const hasFinalBrief = files.some(f => f.includes('final_case_brief.md'));
            const draftFile = files.find(f => f.includes('draft_scoring_form.md'));
            const finalBriefFile = files.find(f => f.includes('final_case_brief.md'));
            const finalPlanFile = files.find(f => f.includes('participant_case_plan.md'));
            const parts = clientId.split('_');
            const cleanName = parts.length > 1 ? parts[1].replace(/([A-Z])/g, ' $1').trim() : clientId;

            html += `
                <div style="background: #ffffff; border: 1px solid var(--border); border-radius: 8px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <strong style="font-size: 16px; color: var(--primary);">${cleanName}</strong>
                                <span class="badge ${hasFinalBrief ? 'badge-green' : (hasDraft ? 'badge-pending' : 'badge-slate')}">
                                    ${hasFinalBrief ? 'Finalized & Case Brief Built' : (hasDraft ? 'Phase 1 Draft Ready for Review' : 'Interview Recorded')}
                                </span>
                            </div>
                            <div style="font-size: 11px; color: var(--slate); margin-top: 3px;">ID: ${clientId} • Files: ${files.length} documents</div>
                        </div>

                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            ${draftFile ? `
                                <button class="btn btn-outline" style="font-size: 12px; padding: 6px 12px;" onclick="previewDocument('${draftFile}')">
                                    👁️ View Draft Scoring Form
                                </button>
                            ` : ''}

                            ${hasDraft ? `
                                <button class="btn btn-primary" style="font-size: 12px; padding: 6px 14px;" onclick="openSupervisorReviewModal('${clientId}', '${cleanName}')">
                                    ✍️ Review & Approve (Phase 2)
                                </button>
                            ` : ''}

                            ${finalBriefFile ? `
                                <button class="btn btn-outline" style="font-size: 12px; padding: 6px 12px;" onclick="previewDocument('${finalBriefFile}')">
                                    📄 View PM Brief
                                </button>
                            ` : ''}

                            ${finalPlanFile ? `
                                <button class="btn btn-outline" style="font-size: 12px; padding: 6px 12px; color: var(--success); border-color: #86efac;" onclick="previewDocument('${finalPlanFile}')">
                                    🎯 Participant Action Plan
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        list.innerHTML = html;
        loadFacilitationEvaluations();
    } catch (e) {
        list.innerHTML = '<p>Unable to load drafts: ' + e.message + '</p>';
    }
}

async function previewDocument(filename) {
    const title = document.getElementById('draft-viewer-title');
    const body = document.getElementById('draft-viewer-body');
    title.innerText = `Document Preview: ${filename}`;
    body.innerHTML = '<p>Loading document content...</p>';
    openModal('modal-draft-viewer');

    try {
        const res = await fetch(`/api/file-content?file=${encodeURIComponent(filename)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Render Markdown formatted
        body.innerHTML = `
            <div class="markdown-preview" style="line-height: 1.6; font-size: 13px; color: #1e293b;">
                ${typeof marked !== 'undefined' ? marked.parse(data.content) : data.content.replace(/\n/g, '<br>')}
            </div>
        `;
    } catch (err) {
        body.innerHTML = '<p class="text-danger">Failed to load document: ' + err.message + '</p>';
    }
}

function openSupervisorReviewModal(clientId, cleanName) {
    document.getElementById('sup-client-id').value = clientId;
    document.getElementById('sup-review-title').innerText = `Supervisor Review & Phase 2 Approval: ${cleanName}`;
    document.getElementById('sup-crim-file').value = '';
    document.getElementById('sup-crim-text').value = '';
    document.getElementById('sup-feedback-text').value = 'No changes needed. The draft scoring form is accurate.';
    openModal('modal-supervisor-review');
}

async function handleSupervisorFeedbackSubmit(e) {
    e.preventDefault();
    const clientId = document.getElementById('sup-client-id').value;
    const feedback = document.getElementById('sup-feedback-text').value;
    const crimText = document.getElementById('sup-crim-text').value;
    const fileInput = document.getElementById('sup-crim-file');
    const btn = document.getElementById('btn-submit-phase2');

    btn.disabled = true;
    btn.innerText = 'Processing Phase 2 Clinical Documents...';

    const formData = new FormData();
    formData.append('clientId', clientId);
    formData.append('feedback', feedback);
    formData.append('criminalHistoryText', crimText);
    if (fileInput.files[0]) {
        formData.append('criminalHistoryFile', fileInput.files[0]);
    }

    try {
        const res = await fetch('/api/submit-feedback', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        alert(data.message || 'Phase 2 in progress. Final clinical brief, participant plan, and Briefcase items are being generated.');
        closeModal('modal-supervisor-review');
        setTimeout(loadPmDrafts, 3500);
    } catch (err) {
        alert('Phase 2 submission error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Approve & Generate Clinical Documents';
    }
}

// -------------------------------------------------------------
// CLASS FACILITATION EVALUATION LOGIC
// -------------------------------------------------------------
async function loadFacilitationEvaluations() {
    const token = localStorage.getItem('fs_token');
    const container = document.getElementById('pm-facilitation-evals-list');
    if (!container) return;

    try {
        const res = await fetch('/api/admin/evaluations', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const evals = await res.json();

        if (evals.length === 0) {
            container.innerHTML = '<p class="text-slate">No class facilitation evaluations recorded yet. Click "+ Evaluate Class Session" to assess today\'s classroom recordings.</p>';
            return;
        }

        container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                ${evals.map(e => `
                    <div style="background: #ffffff; border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: 8px; padding: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div>
                                <strong style="font-size: 15px; color: var(--primary);">${e.session_title}</strong>
                                <div style="font-size: 12px; color: var(--slate);">📍 Location: <strong>${e.location}</strong> • Facilitator: <strong>${e.facilitator_name}</strong> • Date: ${e.class_date}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 22px; font-weight: 800; color: ${e.total_score >= 85 ? 'var(--success)' : 'var(--warning)'};">${Number(e.total_score).toFixed(1)} / 100</div>
                                <div style="font-size: 11px; color: var(--slate);">Rubric Score</div>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; background: #f8fafc; padding: 10px; border-radius: 6px; font-size: 12px; margin-bottom: 10px;">
                            <div><strong>Neutrality:</strong> ${e.modeling_neutrality_score || 5}/5</div>
                            <div><strong>Lesson Plan:</strong> ${e.lesson_plan_adherence_score || 5}/5</div>
                            <div><strong>Reflective Listening:</strong> ${e.reflective_listening_score || 5}/5</div>
                            <div><strong>Confrontation Avoidance:</strong> ${e.avoiding_confrontation_score || 5}/5</div>
                        </div>
                        <div style="font-size: 13px; color: #334155;">
                            <strong>Coaching Feedback:</strong> ${e.coaching_feedback || 'Excellent adherence to lesson structure and neutrality.'}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        container.innerHTML = '<p>Unable to load evaluations.</p>';
    }
}

function openFacilitationModal() {
    document.getElementById('eval-session-title').value = '';
    document.getElementById('eval-text').value = '';
    document.getElementById('eval-file').value = '';
    openModal('modal-facilitation');
}

async function handleClassEvaluationSubmit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const location = document.getElementById('eval-location').value;
    const facilitatorName = document.getElementById('eval-facilitator').value;
    const sessionTitle = document.getElementById('eval-session-title').value;
    const text = document.getElementById('eval-text').value;
    const fileInput = document.getElementById('eval-file');
    const btn = document.getElementById('btn-run-eval');

    btn.disabled = true;
    btn.innerText = 'Evaluating Classroom Audio Against 20-Item Rubric...';

    const formData = new FormData();
    formData.append('location', location);
    formData.append('facilitatorName', facilitatorName);
    formData.append('sessionTitle', sessionTitle);
    formData.append('transcriptText', text);
    if (fileInput.files[0]) {
        formData.append('audioOrTranscript', fileInput.files[0]);
    }

    try {
        const res = await fetch('/api/admin/evaluate-classes', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(`Classroom evaluation complete! Score: ${data.result.total_score} / 100 for ${location}`);
        closeModal('modal-facilitation');
        loadFacilitationEvaluations();
    } catch (err) {
        alert('Evaluation failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Evaluate Against 20-Item Scoring Rubric';
    }
}

async function generateReport(type) {
    const token = localStorage.getItem('fs_token');
    const loc = document.getElementById('pm-filter-location').value;
    const modal = document.getElementById('modal-report');
    const title = document.getElementById('report-modal-title');
    const body = document.getElementById('report-modal-body');

    if (type === 'monday') {
        title.innerText = `Monday Participant Needs Report (${loc || 'All Locations'})`;
        body.innerHTML = 'Loading report...';
        openModal('modal-report');

        const res = await fetch(`/api/admin/reports/monday-needs?location=${encodeURIComponent(loc)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        body.innerHTML = `
            <div class="report-summary-box">
                <h4>Caseload Needs Summary</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px;">
                    <div><strong>${data.needsBreakdown.driversLicenseIssues}</strong> Driver's License Actions</div>
                    <div><strong>${data.needsBreakdown.childSupportIssues}</strong> Child Support Issues</div>
                    <div><strong>${data.needsBreakdown.housingAtRisk}</strong> Housing At-Risk</div>
                    <div><strong>${data.needsBreakdown.w9Pending}</strong> W-9 Submissions Missing</div>
                </div>
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Participant</th>
                        <th>Location</th>
                        <th>Gate</th>
                        <th>Active Barriers & Action Items</th>
                        <th>Court / Supervision Dates</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.participants.map(p => `
                        <tr style="${p.urgentAttentionNeeded ? 'background: #fff1f2;' : ''}">
                            <td><strong>${p.name}</strong><br><span style="font-size: 11px; color: var(--slate);">${p.phone || 'No phone'}</span></td>
                            <td>${p.location}</td>
                            <td>Gate ${p.currentGate}</td>
                            <td>${p.activeIssues.length > 0 ? p.activeIssues.map(i => `• ${i}`).join('<br>') : '<span style="color: green;">All Clear</span>'}</td>
                            <td>${p.courtDates}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        title.innerText = `Friday Milestone & Termination Report (${loc || 'All Locations'})`;
        body.innerHTML = 'Loading report...';
        openModal('modal-report');

        const res = await fetch(`/api/admin/reports/friday-milestones?location=${encodeURIComponent(loc)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        body.innerHTML = `
            <div class="report-summary-box">
                <h4>Weekly Cohort Milestone Summary</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 10px;">
                    <div><strong style="color: var(--success);">${data.graduatingCount}</strong> Ready for Job Placement</div>
                    <div><strong style="color: var(--primary);">${data.activeCount}</strong> Active On-Track</div>
                    <div><strong style="color: var(--warning);">${data.atRiskCount}</strong> At-Risk (Red Criteria)</div>
                    <div><strong style="color: var(--danger);">${data.terminatedCount}</strong> Terminated / Dropped</div>
                </div>
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Participant</th>
                        <th>Location</th>
                        <th>Gate</th>
                        <th>Green Met</th>
                        <th>Red Flags</th>
                        <th>Avg Points</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.roster.map(r => `
                        <tr>
                            <td><strong>${r.name}</strong></td>
                            <td>${r.location}</td>
                            <td>Gate ${r.currentGate}</td>
                            <td style="color: var(--success); font-weight: bold;">${r.greenCriteria}</td>
                            <td style="color: var(--danger); font-weight: bold;">${r.redCriteria}</td>
                            <td>${r.avgPoints}</td>
                            <td><strong>${r.statusTag}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}

function openApricotModal() {
    openModal('modal-apricot');
}

async function handleApricotImport() {
    const token = localStorage.getItem('fs_token');
    const csvData = document.getElementById('apricot-csv-text').value;
    if (!csvData.trim()) return alert('Please paste CSV content.');

    try {
        const res = await fetch('/api/admin/apricot/import-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ csvData })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Apricot sync complete! ${data.importedCount} records imported/updated.`);
            closeModal('modal-apricot');
            loadCaseload();
        } else {
            alert('Import error: ' + (data.error || 'Unknown failure'));
        }
    } catch (e) {
        alert('Import failed: ' + e.message);
    }
}

// -------------------------------------------------------------
// AUDIO INTERVIEW ENGINE (LS/CMI 43 QUESTIONS)
// -------------------------------------------------------------
async function loadInterviewQuestions() {
    try {
        const res = await fetch('questions.json');
        currentQuestions = await res.json();
    } catch (e) {
        console.error('Failed to load questions.json', e);
    }
}

function openInterviewModal() {
    currentQuestionIndex = 0;
    fullTranscript = '';
    displayCurrentQuestion();
    openModal('modal-interview');
}

function displayCurrentQuestion() {
    if (!currentQuestions.length) return;
    const q = currentQuestions[currentQuestionIndex];
    document.getElementById('int-q-number').innerText = `Question ${currentQuestionIndex + 1} of ${currentQuestions.length}`;
    document.getElementById('int-q-text').innerText = q.text || q.question || 'Interview Question';

    const pct = Math.round(((currentQuestionIndex + 1) / currentQuestions.length) * 100);
    document.getElementById('int-progress-fill').style.width = `${pct}%`;

    if (currentQuestionIndex === currentQuestions.length - 1) {
        document.getElementById('btn-next-question').classList.add('hidden');
        document.getElementById('btn-submit-interview').classList.remove('hidden');
    } else {
        document.getElementById('btn-next-question').classList.remove('hidden');
        document.getElementById('btn-submit-interview').classList.add('hidden');
    }
}

function nextQuestion() {
    if (currentQuestionIndex < currentQuestions.length - 1) {
        currentQuestionIndex++;
        displayCurrentQuestion();
    }
}

function prevQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        displayCurrentQuestion();
    }
}

async function toggleRecording() {
    const btn = document.getElementById('btn-record');
    const indicator = document.getElementById('recording-indicator');

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        if (recognition) recognition.stop();
        btn.innerText = '🔴 Resume Recording';
        btn.classList.remove('btn-danger');
        indicator.classList.add('hidden');
    } else {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.start(1000);
            startSpeechRecognition();

            btn.innerText = '⏸️ Pause Recording';
            indicator.classList.remove('hidden');
        } catch (err) {
            alert('Microphone access required: ' + err.message);
        }
    }
}

function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
                fullTranscript += e.results[i][0].transcript + ' ';
            } else {
                interim += e.results[i][0].transcript;
            }
        }
        document.getElementById('int-transcript-box').innerText = fullTranscript + (interim ? ` (${interim})` : '');
    };

    recognition.onerror = () => {};
    recognition.start();
}

async function finishInterview() {
    if (!mediaRecorder || audioChunks.length === 0) {
        return alert('Please record your audio before submitting.');
    }

    if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        if (recognition) recognition.stop();
    }

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', audioBlob, `${currentUser.name}_interview.webm`);
    formData.append('participantName', currentUser.name);
    formData.append('participantLocation', currentUser.location || 'Charleston');
    formData.append('transcript', fullTranscript || 'Audio assessment recorded.');

    try {
        const btn = document.getElementById('btn-submit-interview');
        btn.disabled = true;
        btn.innerText = 'Uploading & Generating Assessment...';

        const res = await fetch('/api/upload-audio', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        alert('Interview submitted successfully! AI Scoring draft is generating.');
        closeModal('modal-interview');
        loadFsDashboard();
    } catch (err) {
        alert('Submission failed: ' + err.message);
    }
}

// -------------------------------------------------------------
// MODAL HELPERS
// -------------------------------------------------------------
function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('hidden');
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('hidden');
}
