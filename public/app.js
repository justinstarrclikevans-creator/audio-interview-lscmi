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
        loadParticipantMessages();

        // Check for linked Re-entry Fresh Start Guide for participant
        const reentryGuideCard = document.getElementById('fs-reentry-guide-card');
        if (reentryGuideCard && currentUser) {
            try {
                const reRes = await fetch(`/api/reentry/plan/${currentUser.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const reData = await reRes.json();
                if (reData.found && reData.plan) {
                    reentryGuideCard.classList.remove('hidden');
                    if (reData.plan.participant_guide_docx) document.getElementById('fs-reentry-docx-btn').href = reData.plan.participant_guide_docx;
                    if (reData.plan.participant_guide_pdf) document.getElementById('fs-reentry-pdf-btn').href = reData.plan.participant_guide_pdf;
                } else {
                    reentryGuideCard.classList.add('hidden');
                }
            } catch(e) {
                reentryGuideCard.classList.add('hidden');
            }
        }
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
        const nameEl = document.getElementById('w9-name');
        if (nameEl) nameEl.value = currentUser.name || '';
    }
    const dateEl = document.getElementById('w9-date');
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    
    toggleTinType('ssn');
    openModal('modal-w9');
}

function toggleTinType(type) {
    const ssnInput = document.getElementById('w9-ssn-val');
    const einInput = document.getElementById('w9-ein-val');
    if (!ssnInput || !einInput) return;

    if (type === 'ssn') {
        ssnInput.disabled = false;
        ssnInput.required = true;
        einInput.disabled = true;
        einInput.required = false;
        einInput.value = '';
    } else {
        einInput.disabled = false;
        einInput.required = true;
        ssnInput.disabled = true;
        ssnInput.required = false;
        ssnInput.value = '';
    }
}

async function handleW9Submit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const certCheck = document.getElementById('w9-cert-check');
    if (!certCheck.checked) {
        return alert('Please check the Part II Certification box under penalties of perjury.');
    }

    const tinType = document.querySelector('input[name="w9-tin-type"]:checked')?.value || 'ssn';
    const tinVal = tinType === 'ssn' ? document.getElementById('w9-ssn-val').value : document.getElementById('w9-ein-val').value;
    const taxClass = document.querySelector('input[name="w9-tax-class"]:checked')?.value || 'Individual/sole proprietor';

    const payload = {
        fullName: document.getElementById('w9-name').value,
        businessName: document.getElementById('w9-business').value,
        taxClassification: taxClass,
        exemptions: document.getElementById('w9-exemptions').value,
        address: document.getElementById('w9-address').value,
        cityStateZip: document.getElementById('w9-city-state-zip').value,
        tinType: tinType,
        ssnOrEin: tinVal,
        signatureName: document.getElementById('w9-sig').value,
        signatureDate: document.getElementById('w9-date').value || new Date().toISOString().split('T')[0]
    };

    try {
        const res = await fetch('/api/participant/w9', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Submission failed');

        alert('Official Form W-9 successfully completed, certified, and recorded on file.');
        closeModal('modal-w9');
        loadFsDashboard();
    } catch (err) {
        alert('W-9 Submission Error: ' + err.message);
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
                    ${p.has_reentry_plan ? `
                        <span class="badge ${p.reentry_status === 'immediate_triage_needed' ? 'badge-red' : (p.reentry_status === 'at_risk' ? 'badge-pending' : 'badge-green')}">
                            🧭 ${p.reentry_status ? p.reentry_status.toUpperCase().replace(/_/g, ' ') : 'LINKED'}
                        </span>
                        <div style="margin-top: 3px;">
                            <a href="javascript:void(0)" onclick="openParticipantLinkedReentryPlan(${p.id})" style="font-size: 11px; color: var(--primary); font-weight: 700; text-decoration: underline;">📄 View Case Plan</a>
                        </div>
                    ` : `
                        <span style="font-size: 11px; color: var(--slate);">Not Assessed</span>
                        <div style="margin-top: 3px;">
                            <a href="javascript:void(0)" onclick="startReentryAssessmentForUser(${p.id}, '${p.name.replace(/'/g, "\\'")}')" style="font-size: 11px; color: var(--accent); text-decoration: underline;">+ Assess</a>
                        </div>
                    `}
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

async function openCaseReviewModal(userId, name) {
    document.getElementById('cr-user-id').value = userId;
    document.getElementById('case-review-modal-title').innerText = `Weekly Case Planning: ${name}`;

    // Check for linked Re-entry Case Plan
    const token = localStorage.getItem('fs_token');
    const linkedBox = document.getElementById('cr-linked-reentry-box');
    try {
        const res = await fetch(`/api/reentry/plan/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.found && data.plan) {
            const plan = data.plan;
            linkedBox.classList.remove('hidden');
            const statusBadge = document.getElementById('cr-reentry-status-badge');
            statusBadge.innerText = (plan.stability_status || 'STABLE').toUpperCase();
            statusBadge.style.background = plan.stability_status === 'immediate_triage_needed' ? '#fee2e2' : '#dcfce7';
            statusBadge.style.color = plan.stability_status === 'immediate_triage_needed' ? '#991b1b' : '#166534';

            document.getElementById('cr-reentry-summary-text').innerHTML = `
                <strong>Goals:</strong> ${plan.stated_goals || 'Employment & stability'}<br>
                <strong>Flags Identified:</strong> ${plan.detected_flags.length} • <strong>Top Domains:</strong> ${(plan.top_criminogenic_domains || []).join(', ') || 'N/A'}
            `;

            if (plan.staff_plan_docx) document.getElementById('cr-reentry-staff-docx-link').href = plan.staff_plan_docx;
            if (plan.participant_guide_docx) document.getElementById('cr-reentry-part-docx-link').href = plan.participant_guide_docx;
            if (plan.participant_guide_pdf) document.getElementById('cr-reentry-part-pdf-link').href = plan.participant_guide_pdf;
        } else {
            linkedBox.classList.add('hidden');
        }
    } catch (e) {
        linkedBox.classList.add('hidden');
    }

    openModal('modal-case-review');
}

// -------------------------------------------------------------
// RE-ENTRY NAVIGATOR & PROFILE LINKING CONTROLLERS
// -------------------------------------------------------------

function switchPmSubView(subview) {
    document.querySelectorAll('.pm-subtabs button').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline');
    });

    const activeBtn = document.getElementById(`pm-tab-btn-${subview}`);
    if (activeBtn) {
        activeBtn.classList.remove('btn-outline');
        activeBtn.classList.add('btn-primary');
    }

    document.getElementById('pm-sec-caseload').classList.toggle('hidden', subview !== 'caseload');
    document.getElementById('pm-sec-reentry').classList.toggle('hidden', subview !== 'reentry');
    const msgSec = document.getElementById('pm-sec-messages');
    if (msgSec) msgSec.classList.toggle('hidden', subview !== 'messages');

    // Drafts and facilitation containers
    const draftsCard = document.getElementById('pm-drafts-list')?.closest('.section-card');
    if (draftsCard) draftsCard.classList.toggle('hidden', subview !== 'drafts' && subview !== 'caseload');

    const evalCard = document.getElementById('pm-facilitation-evals-list')?.closest('.section-card');
    if (evalCard) evalCard.classList.toggle('hidden', subview !== 'facilitation' && subview !== 'caseload');

    if (subview === 'reentry') {
        loadReentryParticipants();
    } else if (subview === 'messages') {
        loadPmConversations();
    }
}

let cachedReentryParticipants = [];

async function loadReentryParticipants() {
    const token = localStorage.getItem('fs_token');
    const select = document.getElementById('reentry-participant-select');
    if (!select) return;

    try {
        const res = await fetch('/api/reentry/participants', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const participants = await res.json();
        cachedReentryParticipants = participants;

        select.innerHTML = '<option value="">-- Select Active Participant to Link --</option>' +
            participants.map(p => `
                <option value="${p.id}" ${p.has_reentry_plan ? 'data-has-plan="true"' : ''}>
                    ${p.name} (${p.location} • ${p.has_reentry_plan ? '✅ Plan Linked' : 'No Plan Yet'})
                </option>
            `).join('');
    } catch (e) {
        console.error('Error loading reentry participants:', e);
    }
}

function handleReentryParticipantSelect() {
    const select = document.getElementById('reentry-participant-select');
    const userId = parseInt(select.value);
    if (!userId) return;

    const p = cachedReentryParticipants.find(x => x.id === userId);
    if (!p) return;

    document.getElementById('reentry-name').value = p.name || '';
    document.getElementById('reentry-location').value = p.location || 'Charleston';

    // Auto-select checkboxes based on known barrier data
    document.querySelectorAll('input[name="reentry-need"]').forEach(cb => {
        cb.checked = false;
        if (cb.value.includes('License') && p.dl_status && p.dl_status !== 'valid' && p.dl_status !== 'unknown') cb.checked = true;
        if (cb.value.includes('Child Support') && p.child_support_status && p.child_support_status !== 'current' && p.child_support_status !== 'none' && p.child_support_status !== 'unknown') cb.checked = true;
        if (cb.value.includes('Housing') && p.housing_status && p.housing_status !== 'stable') cb.checked = true;
    });

    if (p.has_reentry_plan) {
        openParticipantLinkedReentryPlan(p.id);
    }
}

function startReentryAssessmentForUser(userId, name) {
    switchPmSubView('reentry');
    const select = document.getElementById('reentry-participant-select');
    if (select) {
        select.value = userId;
        handleReentryParticipantSelect();
    }
}

async function handleReentryAssessSubmit(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const btn = document.getElementById('btn-reentry-submit');
    btn.disabled = true;
    btn.innerText = 'Analyzing Interview, Checking Flags & Linking to Profile...';

    const selectedNeeds = Array.from(document.querySelectorAll('input[name="reentry-need"]:checked')).map(cb => cb.value);
    const fileInput = document.getElementById('reentry-file');

    const formData = new FormData();
    formData.append('userId', document.getElementById('reentry-participant-select').value);
    formData.append('participantName', document.getElementById('reentry-name').value);
    formData.append('location', document.getElementById('reentry-location').value);
    formData.append('statedGoals', document.getElementById('reentry-goals').value);
    formData.append('livingSituation', document.getElementById('reentry-housing').value);
    formData.append('legalStatus', document.getElementById('reentry-legal').value);
    formData.append('identifiedNeeds', JSON.stringify(selectedNeeds));
    formData.append('transcriptText', document.getElementById('reentry-transcript').value);

    if (fileInput && fileInput.files[0]) {
        formData.append('file', fileInput.files[0]);
    }

    try {
        const res = await fetch('/api/reentry/assess', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Assessment failed');

        renderReentryAssessmentResults(data);
        loadCaseload();
    } catch (err) {
        alert('Re-entry Assessment Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '⚡ Analyze Flags, Generate Dual Case Plan & Link to Profile';
    }
}

function renderReentryAssessmentResults(data) {
    const container = document.getElementById('reentry-results-container');
    container.classList.remove('hidden');

    const name = document.getElementById('reentry-name').value || 'Participant';
    const result = data.result;

    // Link confirmation badge
    const linkBadge = document.getElementById('reentry-link-badge');
    linkBadge.innerHTML = `✅ <strong>Re-entry Case Plan Successfully Linked to ${name}'s Profile</strong> • Stability Status: <strong>${(result.stability_status || 'stable').toUpperCase()}</strong>`;

    // Flags banner
    const flags = result.detected_flags || [];
    const flagsBanner = document.getElementById('reentry-flags-banner');
    flagsBanner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div>
                <strong style="font-size: 15px; color: ${result.stability_status === 'immediate_triage_needed' ? 'var(--danger)' : 'var(--accent)'};">
                    🛡️ Facilitation & Clinical Flags: ${flags.length} Identified
                </strong>
                <div style="font-size: 12px; color: var(--slate); margin-top: 2px;">
                    Targeted Dynamic Domains: <strong>${(result.top_criminogenic_domains || []).join(', ') || 'Employment & Thinking'}</strong>
                </div>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px;">
            ${flags.map(f => `
                <div style="background: white; border: 1px solid var(--border); padding: 8px; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="font-weight: 700; font-size: 12px;">${f.flag}</span>
                        <span style="font-size: 10px; font-weight: 800; color: ${f.severity === 'high' ? 'red' : 'orange'};">${(f.severity || 'med').toUpperCase()}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--slate); margin-top: 3px;"><em>"${f.evidence || ''}"</em></div>
                    <div style="font-size: 11px; color: var(--primary); margin-top: 4px;"><strong>Tip:</strong> ${f.navigator_recommendation || ''}</div>
                </div>
            `).join('')}
        </div>
    `;

    // Render Matched Jobs with Direct Apply Links
    const jobsList = document.getElementById('reentry-matched-jobs-list');
    const matchedJobs = result.matched_employers || [];
    if (jobsList) {
        if (matchedJobs.length === 0) {
            jobsList.innerHTML = '<div style="font-size: 12px; color: var(--slate); padding: 8px;">No specific employer matches found.</div>';
        } else {
            jobsList.innerHTML = matchedJobs.map(job => `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <div>
                            <strong style="font-size: 13px; color: #0f172a;">${job.company}</strong>
                            <div style="font-size: 12px; color: var(--primary); font-weight: 600;">
                                ${job.role} ${job.pay ? `• <span style="color: #166534; font-weight: 700;">${job.pay}</span>` : ''}
                            </div>
                            ${job.shift ? `<div style="font-size: 11px; color: var(--slate);">${job.shift}</div>` : ''}
                        </div>
                        ${job.careersUrl ? `
                            <a href="${job.careersUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="padding: 4px 10px; font-size: 11.5px; text-decoration: none; white-space: nowrap; font-weight: 700;">
                                🔗 Apply / View
                            </a>
                        ` : ''}
                    </div>
                    ${job.matchReason ? `<div style="font-size: 11px; color: #475569; margin-top: 5px; background: #f8fafc; padding: 4px 8px; border-radius: 4px;">${job.matchReason}</div>` : ''}
                </div>
            `).join('');
        }
    }

    // Render Community Referrals with Direct Web & Map Links
    const referralsList = document.getElementById('reentry-suggested-referrals-list');
    const referrals = result.recommended_referrals || [];
    if (referralsList) {
        if (referrals.length === 0) {
            referralsList.innerHTML = '<div style="font-size: 12px; color: var(--slate); padding: 8px;">No specific referrals generated.</div>';
        } else {
            referralsList.innerHTML = referrals.map(ref => `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <div>
                            <span style="font-size: 10px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px;">${ref.category || 'COMMUNITY RESOURCE'}</span>
                            <strong style="display: block; font-size: 13px; color: #0f172a;">${ref.resourceName}</strong>
                            ${ref.contact ? `<div style="font-size: 11.5px; color: var(--slate); margin-top: 2px;">${ref.contact}</div>` : ''}
                        </div>
                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                            ${ref.websiteUrl ? `
                                <a href="${ref.websiteUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; text-decoration: none; font-weight: 600;">
                                    🌐 Website
                                </a>
                            ` : ''}
                            ${ref.contact && (ref.contact.includes('St') || ref.contact.includes('Ave') || ref.contact.includes('Rd') || ref.contact.includes('Dr')) ? `
                                <a href="https://maps.google.com/?q=${encodeURIComponent(ref.contact)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="padding: 3px 8px; font-size: 11px; text-decoration: none;">
                                    📍 Map
                                </a>
                            ` : ''}
                        </div>
                    </div>
                    ${ref.actionStep ? `<div style="font-size: 11px; color: #166534; font-weight: 600; margin-top: 4px; background: #f0fdf4; padding: 4px 8px; border-radius: 4px;">🎯 <strong>Next Step:</strong> ${ref.actionStep}</div>` : ''}
                </div>
            `).join('');
        }
    }

    // Render markdowns (marked parses all markdown links as clickable <a> tags)
    document.getElementById('reentry-part-guide-content').innerHTML = marked.parse(result.participant_guide_md || '');
    document.getElementById('reentry-staff-plan-content').innerHTML = marked.parse(result.navigator_case_plan_md || '');

    // Set download links
    if (data.participantGuideDocx) document.getElementById('link-reentry-part-docx').href = data.participantGuideDocx;
    if (data.participantGuidePdf) document.getElementById('link-reentry-part-pdf').href = data.participantGuidePdf;
    if (data.staffPlanDocx) document.getElementById('link-reentry-staff-docx').href = data.staffPlanDocx;
    if (data.staffPlanPdf) document.getElementById('link-reentry-staff-pdf').href = data.staffPlanPdf;

    container.scrollIntoView({ behavior: 'smooth' });
}

function switchReentryDocTab(tab) {
    document.getElementById('reentry-doc-part-view').classList.toggle('hidden', tab !== 'part');
    document.getElementById('reentry-doc-staff-view').classList.toggle('hidden', tab !== 'staff');

    document.getElementById('btn-subtab-part-guide').className = tab === 'part' ? 'btn btn-primary' : 'btn btn-outline';
    document.getElementById('btn-subtab-staff-plan').className = tab === 'staff' ? 'btn btn-primary' : 'btn btn-outline';
}

async function openParticipantLinkedReentryPlan(userId) {
    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch(`/api/reentry/plan/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.found && data.plan) {
            switchPmSubView('reentry');
            const select = document.getElementById('reentry-participant-select');
            if (select) select.value = userId;

            renderReentryAssessmentResults({
                result: {
                    stability_status: data.plan.stability_status,
                    detected_flags: data.plan.detected_flags,
                    top_criminogenic_domains: data.plan.top_criminogenic_domains,
                    participant_guide_md: data.plan.participant_guide_md,
                    navigator_case_plan_md: data.plan.staff_case_plan_md,
                    recommended_referrals: data.plan.recommended_referrals || [],
                    matched_employers: data.plan.matched_employers || []
                },
                participantGuideDocx: data.plan.participant_guide_docx,
                participantGuidePdf: data.plan.participant_guide_pdf,
                staffPlanDocx: data.plan.staff_plan_docx,
                staffPlanPdf: data.plan.staff_plan_pdf
            });
        }
    } catch (e) {
        console.error('Error fetching linked plan:', e);
    }
}

function loadReentryResourcesTab() {
    openModal('modal-reentry-resources');
    loadModalDirectoryResources();
}

let cachedModalResources = null;

async function loadModalDirectoryResources() {
    const token = localStorage.getItem('fs_token');
    const region = document.getElementById('modal-dir-region').value || 'charleston';
    const container = document.getElementById('modal-dir-list');
    container.innerHTML = '<p class="text-slate">Loading verified SC resources...</p>';

    try {
        const res = await fetch(`/api/reentry/resources?region=${region}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        cachedModalResources = data;

        const resources = data.resources || {};
        let html = '';
        Object.keys(resources).forEach(catKey => {
            const items = resources[catKey];
            if (Array.isArray(items)) {
                items.forEach(item => {
                    html += `
                        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 6px; padding: 10px;">
                            <h4 style="margin: 0 0 4px 0; color: var(--primary); font-size: 13.5px;">${item.name}</h4>
                            <div style="font-size: 11.5px; color: var(--accent); font-weight: bold;">${item.category}</div>
                            <div style="font-size: 12px; margin-top: 4px;"><strong>📞 Phone:</strong> ${item.phone}</div>
                            <div style="font-size: 12px;"><strong>📍 Address:</strong> ${item.address}</div>
                            <div style="font-size: 11.5px; color: var(--slate); margin-top: 4px;">${item.services}</div>
                        </div>
                    `;
                });
            }
        });

        container.innerHTML = html;
        renderModalJobs(data.spreadsheetJobs || []);
    } catch (e) {
        container.innerHTML = '<p>Error loading resources: ' + e.message + '</p>';
    }
}

function switchResourceTab(tab) {
    document.getElementById('res-view-dir').classList.toggle('hidden', tab !== 'dir');
    document.getElementById('res-view-jobs').classList.toggle('hidden', tab !== 'jobs');
    document.getElementById('res-tab-btn-dir').className = tab === 'dir' ? 'btn btn-primary' : 'btn btn-outline';
    document.getElementById('res-tab-btn-jobs').className = tab === 'jobs' ? 'btn btn-primary' : 'btn btn-outline';
}

function renderModalJobs(jobs) {
    const container = document.getElementById('modal-jobs-list');
    if (!jobs || jobs.length === 0) {
        container.innerHTML = '<p class="text-slate">No spreadsheet jobs loaded.</p>';
        return;
    }

    container.innerHTML = jobs.map(j => `
        <div style="background: white; border: 1px solid var(--border); border-top: 3px solid var(--accent); border-radius: 6px; padding: 10px;">
            <h4 style="margin: 0; font-size: 13.5px;">${j.jobTitle}</h4>
            <div style="font-size: 12.5px; font-weight: bold; color: var(--primary);">${j.company}</div>
            <div style="font-size: 12px; color: var(--success); font-weight: bold;">💵 ${j.payRate}</div>
            <div style="font-size: 11.5px; color: var(--slate);">📍 ${j.location}</div>
            ${j.description ? `<div style="font-size: 11px; color: #475569; background: #f8fafc; padding: 6px; border-radius: 4px; margin-top: 4px; max-height: 60px; overflow-y: auto;">${j.description}</div>` : ''}
            ${j.careersUrl ? `<div style="margin-top: 6px;"><a href="${j.careersUrl}" target="_blank" style="font-size: 11.5px; color: var(--accent); font-weight: bold; text-decoration: underline;">🔗 View Careers / Apply</a></div>` : ''}
        </div>
    `).join('');
}

function filterModalJobs() {
    const q = (document.getElementById('modal-job-search').value || '').toLowerCase();
    const jobs = (cachedModalResources && cachedModalResources.spreadsheetJobs) || [];
    const filtered = jobs.filter(j => 
        (j.company || '').toLowerCase().includes(q) ||
        (j.jobTitle || '').toLowerCase().includes(q) ||
        (j.location || '').toLowerCase().includes(q) ||
        (j.description || '').toLowerCase().includes(q)
    );
    renderModalJobs(filtered);
}

async function handleModalSpreadsheetUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const token = localStorage.getItem('fs_token');
    const formData = new FormData();
    formData.append('spreadsheet', file);

    try {
        const res = await fetch('/api/reentry/upload-jobs-spreadsheet', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        alert(data.message);
        loadModalDirectoryResources();
    } catch (err) {
        alert('Upload Error: ' + err.message);
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
        const ssnFormatted = w9.ssnOrEin ? (w9.tinType === 'ein' ? w9.ssnOrEin : (w9.ssnOrEin.length === 9 ? w9.ssnOrEin.slice(0,3) + '-' + w9.ssnOrEin.slice(3,5) + '-' + w9.ssnOrEin.slice(5) : w9.ssnOrEin)) : 'Not Provided';

        body.innerHTML = `
            <div class="official-w9-document" style="background: white; border: 2px solid #000; padding: 24px; font-family: Arial, Helvetica, sans-serif; color: #000;">
                <!-- IRS Official Header -->
                <div style="display: grid; grid-template-columns: 140px 1fr 180px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; align-items: center;">
                    <div>
                        <div style="font-weight: 900; font-size: 26px; line-height: 1;">Form <span style="font-size: 32px;">W-9</span></div>
                        <div style="font-size: 10px; font-weight: bold;">(Rev. March 2024)</div>
                        <div style="font-size: 9px; color: #475569;">Department of the Treasury<br>Internal Revenue Service</div>
                    </div>
                    <div style="text-align: center;">
                        <h2 style="font-size: 18px; font-weight: 900; margin: 0;">Request for Taxpayer<br>Identification Number and Certification</h2>
                        <div style="font-size: 10px; font-style: italic; margin-top: 4px;">Go to www.irs.gov/FormW9 for instructions and the latest information.</div>
                    </div>
                    <div style="text-align: right; font-size: 11px;">
                        <strong style="display: block; line-height: 1.2;">Give Form to the requester. Do not send to the IRS.</strong>
                        <div style="margin-top: 6px;"><span class="badge badge-green" style="font-weight: bold; font-size: 11px;">VERIFIED & RECORDED</span></div>
                    </div>
                </div>

                <!-- Lines 1 to 7 Table -->
                <div style="border: 1px solid #000; font-size: 12px; line-height: 1.4;">
                    <!-- Line 1 -->
                    <div style="border-bottom: 1px solid #000; padding: 6px 10px;">
                        <div style="font-size: 10px; font-weight: bold; color: #334155;">1 Name of entity/individual (as shown on your income tax return). Name is required on this line; do not leave this line blank.</div>
                        <div style="font-size: 14px; font-weight: bold; color: #0f172a; padding: 2px 0;">${w9.fullName || (data.user ? data.user.name : '')}</div>
                    </div>

                    <!-- Line 2 -->
                    <div style="border-bottom: 1px solid #000; padding: 6px 10px;">
                        <div style="font-size: 10px; font-weight: bold; color: #334155;">2 Business name/disregarded entity name, if different from above:</div>
                        <div style="font-size: 13px; font-style: ${w9.businessName ? 'normal' : 'italic'}; color: ${w9.businessName ? '#0f172a' : '#64748b'}; padding: 2px 0;">
                            ${w9.businessName || 'None (Individual)'}
                        </div>
                    </div>

                    <!-- Line 3a & 4 -->
                    <div style="display: grid; grid-template-columns: 2fr 1fr; border-bottom: 1px solid #000;">
                        <div style="padding: 6px 10px; border-right: 1px solid #000;">
                            <div style="font-size: 10px; font-weight: bold; color: #334155;">3a Check appropriate box for federal tax classification:</div>
                            <div style="font-size: 13px; font-weight: bold; color: #1e3a8a; margin-top: 4px;">
                                ☑️ ${w9.taxClassification || 'Individual/sole proprietor or single-member LLC'}
                            </div>
                        </div>
                        <div style="padding: 6px 10px;">
                            <div style="font-size: 10px; font-weight: bold; color: #334155;">4 Exemptions (codes):</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${w9.exemptions || 'None / N/A'}</div>
                        </div>
                    </div>

                    <!-- Line 5 & Requester -->
                    <div style="display: grid; grid-template-columns: 2fr 1fr; border-bottom: 1px solid #000;">
                        <div style="padding: 6px 10px; border-right: 1px solid #000;">
                            <div style="font-size: 10px; font-weight: bold; color: #334155;">5 Address (number, street, and apt. or suite no.):</div>
                            <div style="font-size: 13px; font-weight: bold; padding: 2px 0;">${w9.address || 'On file'}</div>
                            
                            <div style="font-size: 10px; font-weight: bold; color: #334155; margin-top: 6px;">6 City, state, and ZIP code:</div>
                            <div style="font-size: 13px; font-weight: bold; padding: 2px 0;">${w9.cityStateZip || 'On file'}</div>
                        </div>
                        <div style="padding: 6px 10px; background: #f8fafc; font-size: 11px;">
                            <strong style="display: block; margin-bottom: 4px; color: #0f172a;">Requester's name and address:</strong>
                            Turn90, Inc.<br>
                            3765 Leeds Ave<br>
                            North Charleston, SC 29405
                        </div>
                    </div>
                </div>

                <!-- Part I: Taxpayer Identification Number -->
                <div style="border: 2px solid #000; margin-top: 14px; overflow: hidden;">
                    <div style="background: #000; color: white; padding: 4px 10px; font-weight: bold; font-size: 12px; display: flex; justify-content: space-between;">
                        <span>Part I: Taxpayer Identification Number (TIN)</span>
                        <span style="font-size: 11px;">Official Certified TIN</span>
                    </div>
                    <div style="padding: 12px; background: #f8fafc;">
                        <p style="font-size: 11px; margin: 0 0 8px 0; color: #334155;">
                            Enter your TIN in the appropriate box. The TIN provided must match the name given on line 1 to avoid backup withholding.
                        </p>
                        <div style="display: flex; gap: 24px; align-items: center;">
                            <div style="border: 2px solid #0f172a; background: white; padding: 8px 16px; border-radius: 4px;">
                                <span style="font-size: 11px; font-weight: bold; color: #475569; display: block;">${w9.tinType === 'ein' ? 'Employer Identification Number (EIN)' : 'Social Security Number (SSN)'}:</span>
                                <span style="font-family: monospace; font-size: 18px; font-weight: 900; letter-spacing: 3px; color: #0f172a;">${ssnFormatted}</span>
                            </div>
                            <div style="font-size: 11px; color: #166534; font-weight: bold;">
                                ✅ Certified on file with Turn90 Payroll & Stipends
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Part II: Certification -->
                <div style="border: 2px solid #000; margin-top: 14px; overflow: hidden;">
                    <div style="background: #000; color: white; padding: 4px 10px; font-weight: bold; font-size: 12px;">
                        Part II: Certification
                    </div>
                    <div style="padding: 10px 12px; font-size: 10.5px; line-height: 1.4; color: #334155;">
                        <p style="margin: 0 0 4px 0; font-weight: bold;">Under penalties of perjury, I certify that:</p>
                        <ol style="margin: 0 0 8px 16px; padding: 0;">
                            <li>The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and</li>
                            <li>I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the IRS that I am subject to backup withholding, or (c) the IRS has notified me that I am no longer subject to backup withholding; and</li>
                            <li>I am a U.S. citizen or other U.S. person; and</li>
                            <li>The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.</li>
                        </ol>

                        <div style="border-top: 1px solid #000; padding-top: 10px; margin-top: 8px; display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: flex-end;">
                            <div>
                                <span style="font-size: 10px; font-weight: bold; color: #475569; display: block;">Signature of U.S. Person:</span>
                                <div style="font-family: 'Brush Script MT', cursive, sans-serif; font-size: 24px; color: #1e3a8a; border-bottom: 1px solid #000; padding: 2px 8px;">
                                    ${w9.signatureName || w9.fullName || 'Digital Signature Certified'}
                                </div>
                            </div>
                            <div>
                                <span style="font-size: 10px; font-weight: bold; color: #475569; display: block;">Date:</span>
                                <div style="font-size: 14px; font-weight: bold; border-bottom: 1px solid #000; padding: 6px 8px;">
                                    ${w9.signatureDate || new Date().toISOString().split('T')[0]}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        body.innerHTML = '<p class="text-danger">Failed to load W-9 details: ' + e.message + '</p>';
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

        // Load saved personal trigger situations and selected tools
        if (currentUser) {
            try {
                const trRes = await fetch(`/api/case-plan-triggers/${currentUser.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const trData = await trRes.json();
                if (trData && trData.length > 0) {
                    const latest = trData[trData.length - 1];
                    const inputEl = document.getElementById('cp-triggers-input');
                    if (inputEl) inputEl.value = latest.trigger_situations || '';
                    const selectedTools = latest.toolkit_tools ? JSON.parse(latest.toolkit_tools) : [];
                    document.querySelectorAll('input[name="cp-tool"]').forEach(cb => {
                        cb.checked = selectedTools.includes(cb.value);
                    });
                }
            } catch (trErr) {
                console.warn('Could not load case plan triggers:', trErr);
            }
        }
    } catch (e) {
        body.innerHTML = '<p>Failed to load case plan: ' + e.message + '</p>';
    }
}

async function savePersonalTriggerSituations() {
    const token = localStorage.getItem('fs_token');
    const triggers = document.getElementById('cp-triggers-input').value;
    const selectedTools = Array.from(document.querySelectorAll('input[name="cp-tool"]:checked')).map(cb => cb.value);
    const statusEl = document.getElementById('triggers-save-status');

    try {
        const res = await fetch('/api/case-plan-triggers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                userId: currentUser ? currentUser.id : null,
                domain: 'Dynamic Focus Areas',
                triggerSituations: triggers,
                toolkitTools: selectedTools
            })
        });
        const data = await res.json();
        if (data.success) {
            statusEl.innerText = '✅ Saved successfully to your personal plan!';
            setTimeout(() => { statusEl.innerText = ''; }, 4000);
        } else {
            alert('Failed to save triggers: ' + data.error);
        }
    } catch(e) {
        alert('Save error: ' + e.message);
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
            const cleanName = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

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

function switchSupReviewView(mode) {
    const container = document.getElementById('sup-dual-container');
    const boxScoring = document.getElementById('sup-box-scoring');
    const boxGuide = document.getElementById('sup-box-guide');

    const btnDual = document.getElementById('sup-view-mode-dual');
    const btnScoring = document.getElementById('sup-view-mode-scoring');
    const btnGuide = document.getElementById('sup-view-mode-guide');

    btnDual.className = mode === 'dual' ? 'btn btn-primary' : 'btn btn-outline';
    btnScoring.className = mode === 'scoring' ? 'btn btn-primary' : 'btn btn-outline';
    btnGuide.className = mode === 'guide' ? 'btn btn-primary' : 'btn btn-outline';

    if (mode === 'dual') {
        container.style.gridTemplateColumns = '1fr 1fr';
        boxScoring.style.display = 'block';
        boxGuide.style.display = 'block';
    } else if (mode === 'scoring') {
        container.style.gridTemplateColumns = '1fr';
        boxScoring.style.display = 'block';
        boxGuide.style.display = 'none';
    } else if (mode === 'guide') {
        container.style.gridTemplateColumns = '1fr';
        boxScoring.style.display = 'none';
        boxGuide.style.display = 'block';
    }
}

async function openSupervisorReviewModal(clientId, cleanName) {
    document.getElementById('sup-client-id').value = clientId;
    document.getElementById('sup-review-title').innerText = `Supervisor Review & Phase 2 Approval: ${cleanName}`;
    document.getElementById('sup-crim-file').value = '';
    document.getElementById('sup-crim-text').value = '';
    document.getElementById('sup-feedback-text').value = 'No changes needed. The draft scoring form is accurate.';

    const scoringContent = document.getElementById('sup-draft-scoring-content');
    const guideContent = document.getElementById('sup-interview-guide-content');
    scoringContent.innerHTML = '<p class="text-slate">Loading Draft Scoring Form...</p>';
    guideContent.innerHTML = '<p class="text-slate">Loading Interview Guide responses...</p>';

    switchSupReviewView('dual');
    openModal('modal-supervisor-review');

    // Fetch Draft Scoring Form
    try {
        const resScoring = await fetch(`/api/file-content?file=${encodeURIComponent(clientId + '_draft_scoring_form.md')}`);
        if (resScoring.ok) {
            const data = await resScoring.json();
            scoringContent.innerHTML = marked.parse(data.content);
        } else {
            scoringContent.innerHTML = '<p class="text-danger">Draft scoring form file not found.</p>';
        }
    } catch(e) {
        scoringContent.innerHTML = '<p class="text-danger">Error loading scoring form: ' + e.message + '</p>';
    }

    // Fetch Interview Guide
    try {
        const resGuide = await fetch(`/api/file-content?file=${encodeURIComponent(clientId + '_interview_guide.md')}`);
        if (resGuide.ok) {
            const data = await resGuide.json();
            guideContent.innerHTML = marked.parse(data.content);
        } else {
            guideContent.innerHTML = '<p class="text-slate">Interview guide markdown not found. Inferred from transcript.</p>';
        }
    } catch(e) {
        guideContent.innerHTML = '<p class="text-danger">Error loading interview guide: ' + e.message + '</p>';
    }
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
    const fileInput = document.getElementById('apricot-file-input');
    const csvData = document.getElementById('apricot-csv-text').value;
    const btn = document.getElementById('btn-apricot-sync');

    if ((!fileInput || !fileInput.files || !fileInput.files[0]) && !csvData.trim()) {
        return alert('Please select an Excel (.xlsx, .xls) or CSV file, or paste CSV text.');
    }

    btn.disabled = true;
    btn.innerText = 'Importing Spreadsheet Data...';

    try {
        let res;
        if (fileInput && fileInput.files && fileInput.files[0]) {
            const formData = new FormData();
            formData.append('file', fileInput.files[0]);
            res = await fetch('/api/admin/apricot/import-points', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
        } else {
            res = await fetch('/api/admin/apricot/import-points', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ csvData })
            });
        }

        const data = await res.json();
        if (data.success) {
            alert(`Apricot sync successful! ${data.importedCount} participant point records updated.`);
            closeModal('modal-apricot');
            if (fileInput) fileInput.value = '';
            document.getElementById('apricot-csv-text').value = '';
            loadCaseload();
        } else {
            alert('Import warning/error: ' + (data.error || 'Check spreadsheet columns.'));
        }
    } catch (e) {
        alert('Import failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '📥 Import Spreadsheet / CSV & Update Points';
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

// =============================================================
// PARTICIPANT AI ASSISTANT FUNCTIONS
// =============================================================
let participantAiHistory = [];

function askAiPrompt(promptText) {
    const input = document.getElementById('fs-ai-input');
    if (input) {
        input.value = promptText;
        sendParticipantAiMessage();
    }
}

async function sendParticipantAiMessage() {
    const token = localStorage.getItem('fs_token');
    const input = document.getElementById('fs-ai-input');
    const chatBox = document.getElementById('fs-ai-chat-history');
    const btn = document.getElementById('btn-fs-ai-send');

    const question = (input.value || '').trim();
    if (!question) return;

    // Append user message
    chatBox.innerHTML += `
        <div style="align-self: flex-end; background: #e0e7ff; color: #1e1b4b; border-radius: 6px; padding: 8px 12px; max-width: 85%;">
            <strong>You:</strong> ${question}
        </div>
    `;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    btn.disabled = true;
    btn.innerText = 'Thinking...';

    // Temporary typing indicator
    const typingId = 'ai-typing-' + Date.now();
    chatBox.innerHTML += `<div id="${typingId}" style="align-self: flex-start; background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; color: var(--slate); font-style: italic;">Turn90 Assistant is looking up instructions & resources...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const res = await fetch('/api/participant/ai-assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ message: question, history: participantAiHistory })
        });
        const data = await res.json();

        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();

        if (data.reply) {
            participantAiHistory.push({ role: 'user', text: question });
            participantAiHistory.push({ role: 'assistant', text: data.reply });

            const formattedReply = typeof marked !== 'undefined' ? marked.parse(data.reply) : data.reply.replace(/\n/g, '<br>');
            chatBox.innerHTML += `
                <div style="align-self: flex-start; background: white; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; max-width: 90%; line-height: 1.5;">
                    <strong style="color: var(--primary);">Turn90 Assistant:</strong>
                    <div style="margin-top: 6px;">${formattedReply}</div>
                </div>
            `;
        } else {
            chatBox.innerHTML += `<div style="color: red;">Failed to get AI response: ${data.error || 'Unknown error'}</div>`;
        }
    } catch(err) {
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        chatBox.innerHTML += `<div style="color: red;">Assistant Error: ${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerText = 'Ask AI';
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// =============================================================
// TWO-WAY MESSAGING FUNCTIONS (PARTICIPANT & PM)
// =============================================================
async function loadParticipantMessages() {
    const token = localStorage.getItem('fs_token');
    const container = document.getElementById('fs-participant-messages-list');
    if (!container) return;

    try {
        const res = await fetch('/api/participant/messages', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const messages = data.messages || [];

        if (messages.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--slate); padding: 20px;">
                    No messages yet. Send a message below to connect directly with your Turn90 Case Manager!
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(m => {
            const isMe = currentUser && m.sender_id === currentUser.id;
            const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
            return `
                <div style="align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 85%; background: ${isMe ? '#dbeafe' : 'white'}; border: 1px solid ${isMe ? '#93c5fd' : '#e2e8f0'}; border-radius: 6px; padding: 10px 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; gap: 10px;">
                        <strong style="color: ${isMe ? 'var(--primary)' : 'var(--accent)'};">${isMe ? 'You' : (m.sender_name + ' (Case Manager)')}</strong>
                        <span style="color: var(--slate);">${timeStr}</span>
                    </div>
                    <div style="font-size: 13px; color: #1e293b;">${m.message_text}</div>
                </div>
            `;
        }).join('');
        container.scrollTop = container.scrollHeight;
    } catch(err) {
        container.innerHTML = '<p class="text-danger">Failed to load messages: ' + err.message + '</p>';
    }
}

async function sendParticipantMessage() {
    const token = localStorage.getItem('fs_token');
    const input = document.getElementById('fs-msg-input');
    const btn = document.getElementById('btn-fs-msg-send');
    const text = (input.value || '').trim();
    if (!text) return;

    btn.disabled = true;
    btn.innerText = 'Sending...';

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ messageText: text })
        });
        const data = await res.json();
        if (data.success) {
            input.value = '';
            loadParticipantMessages();
        } else {
            alert('Failed to send message: ' + data.error);
        }
    } catch(err) {
        alert('Message error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Send';
    }
}

// PROGRAM MANAGER MESSAGING (CASELOAD COMMUNICATIONS)
let cachedPmThreads = [];
let activePmParticipantId = null;

async function loadPmConversations() {
    const token = localStorage.getItem('fs_token');
    const list = document.getElementById('pm-conversations-list');
    const badge = document.getElementById('pm-unread-badge');
    if (!list) return;

    try {
        const res = await fetch('/api/pm/messages/recent', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const threads = await res.json();
        cachedPmThreads = threads;

        let totalUnread = 0;
        threads.forEach(t => totalUnread += (t.unread_count || 0));
        if (badge) {
            badge.innerText = totalUnread;
            badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
        }

        if (threads.length === 0) {
            list.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--slate); font-size: 13px;">No participant messages on file yet.</p>';
            return;
        }

        list.innerHTML = threads.map(t => {
            const isSelected = activePmParticipantId === t.participant_id;
            const timeStr = new Date(t.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
            return `
                <div onclick="selectPmConversation(${t.participant_id}, '${t.participant_name.replace(/'/g, "\\'")}')" 
                     style="padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; background: ${isSelected ? '#e2e8f0' : (t.unread_count > 0 ? '#fef3c7' : 'white')}; transition: background 0.15s ease;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 13.5px; color: var(--primary);">${t.participant_name}</strong>
                        <span style="font-size: 10.5px; color: var(--slate);">${timeStr}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                        <div style="font-size: 11.5px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">
                            ${t.sender_id === t.participant_id ? '' : 'You: '}${t.message_text}
                        </div>
                        ${t.unread_count > 0 ? `<span class="badge badge-danger" style="font-size: 10px; padding: 2px 6px;">${t.unread_count} new</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Auto-select first if none selected
        if (!activePmParticipantId && threads.length > 0) {
            selectPmConversation(threads[0].participant_id, threads[0].participant_name);
        }
    } catch(err) {
        list.innerHTML = '<p style="padding: 20px; color: red;">Error: ' + err.message + '</p>';
    }
}

function filterPmMessages() {
    const query = (document.getElementById('pm-msg-search')?.value || '').toLowerCase();
    const list = document.getElementById('pm-conversations-list');
    if (!list) return;

    const filtered = cachedPmThreads.filter(t => 
        t.participant_name.toLowerCase().includes(query) ||
        (t.participant_location && t.participant_location.toLowerCase().includes(query)) ||
        t.message_text.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
        list.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--slate); font-size: 12.5px;">No matching conversations.</p>';
        return;
    }

    list.innerHTML = filtered.map(t => {
        const isSelected = activePmParticipantId === t.participant_id;
        const timeStr = new Date(t.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `
            <div onclick="selectPmConversation(${t.participant_id}, '${t.participant_name.replace(/'/g, "\\'")}')" 
                 style="padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; background: ${isSelected ? '#e2e8f0' : (t.unread_count > 0 ? '#fef3c7' : 'white')};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="font-size: 13.5px; color: var(--primary);">${t.participant_name}</strong>
                    <span style="font-size: 10.5px; color: var(--slate);">${timeStr}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <div style="font-size: 11.5px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">
                        ${t.sender_id === t.participant_id ? '' : 'You: '}${t.message_text}
                    </div>
                    ${t.unread_count > 0 ? `<span class="badge badge-danger" style="font-size: 10px; padding: 2px 6px;">${t.unread_count} new</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function selectPmConversation(participantId, participantName) {
    activePmParticipantId = participantId;
    document.getElementById('pm-active-participant-id').value = participantId;
    document.getElementById('pm-thread-participant-name').innerText = `Conversation with ${participantName}`;
    
    const messagesBox = document.getElementById('pm-thread-messages');
    messagesBox.innerHTML = '<p style="text-align: center; color: var(--slate); margin-top: 40px;">Loading thread...</p>';

    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch(`/api/messages/thread/${participantId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const messages = data.messages || [];

        if (data.participant) {
            document.getElementById('pm-thread-participant-meta').innerText = `${data.participant.email} • ${data.participant.location || 'South Carolina'}`;
        }

        if (messages.length === 0) {
            messagesBox.innerHTML = '<p style="text-align: center; color: var(--slate); margin-top: 40px;">No messages yet. Send a message below to start communicating with this participant.</p>';
        } else {
            messagesBox.innerHTML = messages.map(m => {
                const isMe = currentUser && m.sender_id === currentUser.id;
                const timeStr = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
                return `
                    <div style="align-self: ${isMe ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${isMe ? '#0f172a' : 'white'}; color: ${isMe ? 'white' : '#0f172a'}; border: 1px solid ${isMe ? '#0f172a' : '#cbd5e1'}; border-radius: 6px; padding: 10px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; gap: 12px; color: ${isMe ? '#94a3b8' : '#64748b'};">
                            <strong>${isMe ? 'You (Staff)' : m.sender_name}</strong>
                            <span>${timeStr}</span>
                        </div>
                        <div style="font-size: 13px; line-height: 1.4;">${m.message_text}</div>
                    </div>
                `;
            }).join('');
            messagesBox.scrollTop = messagesBox.scrollHeight;
        }

        // Re-render conversation list to clear unread badge
        loadPmConversations();
    } catch(err) {
        messagesBox.innerHTML = '<p style="color: red; text-align: center;">Error loading thread: ' + err.message + '</p>';
    }
}

async function sendPmReply() {
    const token = localStorage.getItem('fs_token');
    const participantId = document.getElementById('pm-active-participant-id').value;
    const input = document.getElementById('pm-reply-input');
    const btn = document.getElementById('btn-pm-send-reply');
    const text = (input.value || '').trim();

    if (!participantId) return alert('Please select a participant first.');
    if (!text) return;

    btn.disabled = true;
    btn.innerText = 'Sending...';

    try {
        const res = await fetch('/api/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                participantId: parseInt(participantId),
                messageText: text
            })
        });
        const data = await res.json();
        if (data.success) {
            input.value = '';
            const name = document.getElementById('pm-thread-participant-name').innerText.replace('Conversation with ', '');
            selectPmConversation(parseInt(participantId), name);
        } else {
            alert('Failed to send reply: ' + data.error);
        }
    } catch(err) {
        alert('Reply error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Send Reply';
    }
}

// =============================================================
// TURN90 JOB HUNTING AI: CLIENT LOGIC
// =============================================================
let cachedMatchedJobs = [];

function openJobHuntingAiModal() {
    openModal('modal-job-hunting-ai');
    switchJobAiTab('match');

    // Pre-populate location & transit from profile
    if (currentUser && currentUser.location) {
        const locSelect = document.getElementById('job-ai-search-location');
        if (locSelect) {
            for (let opt of locSelect.options) {
                if (opt.value.toLowerCase().includes(currentUser.location.toLowerCase())) {
                    opt.selected = true;
                    break;
                }
            }
        }
    }

    if (currentProfile && currentProfile.transportation_status) {
        const trSelect = document.getElementById('job-ai-search-transit');
        if (trSelect && currentProfile.transportation_status.toLowerCase().includes('car')) {
            trSelect.value = 'Any / Has Own Car';
        }
    }

    // Auto-run if first time
    if (cachedMatchedJobs.length === 0) {
        runAiJobMatch();
    }
    loadSavedJobsPipeline();
}

function switchJobAiTab(tabName) {
    ['match', 'resume', 'interview', 'pipeline'].forEach(t => {
        const btn = document.getElementById(`job-ai-tab-btn-${t}`);
        const sec = document.getElementById(`job-ai-sec-${t}`);
        if (btn) {
            btn.classList.toggle('btn-primary', t === tabName);
            btn.classList.toggle('btn-outline', t !== tabName);
        }
        if (sec) {
            sec.classList.toggle('hidden', t !== tabName);
        }
    });

    if (tabName === 'pipeline') {
        loadSavedJobsPipeline();
    }
}

function applyJobSearchChip(chipText) {
    const input = document.getElementById('job-ai-search-query');
    if (input) input.value = chipText;
    runAiJobMatch();
}

async function runAiJobMatch() {
    const token = localStorage.getItem('fs_token');
    const query = document.getElementById('job-ai-search-query')?.value || '';
    const location = document.getElementById('job-ai-search-location')?.value || 'Charleston, SC';
    const transit = document.getElementById('job-ai-search-transit')?.value || 'CARTA Bus Line Accessible';

    const btn = document.getElementById('btn-run-job-match');
    const list = document.getElementById('job-ai-matches-list');
    const summaryBox = document.getElementById('job-ai-summary-box');

    if (btn) {
        btn.disabled = true;
        btn.innerText = '⚡ Matching Openings...';
    }

    list.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--slate);">
            <div style="font-size: 32px; margin-bottom: 8px;">🤖</div>
            <strong style="color: var(--primary);">AI is evaluating live job spreadsheet openings & verified fair-chance employers...</strong>
            <p style="font-size: 12px; margin-top: 4px;">Checking trade skills, transit bus accessibility, and curfew constraints...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/jobs/ai-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                query,
                location,
                transit,
                participantId: currentUser ? currentUser.id : null
            })
        });

        const data = await res.json();
        cachedMatchedJobs = data.matchedJobs || [];

        // Summary box
        if (data.aiSearchSummary && summaryBox) {
            summaryBox.classList.remove('hidden');
            document.getElementById('job-ai-summary-text').innerText = data.aiSearchSummary;
            document.getElementById('job-ai-coaching-text').innerText = data.coachingAdvice || '';
        }

        if (cachedMatchedJobs.length === 0) {
            list.innerHTML = '<p style="text-align: center; padding: 30px; color: var(--slate);">No direct matches found. Try searching for "warehouse", "forklift", "carpentry", or "assembly".</p>';
            return;
        }

        list.innerHTML = cachedMatchedJobs.map((job, idx) => {
            const reasonsHtml = (job.matchReasons || []).map(r => `<li>${r}</li>`).join('');
            const escapedComp = (job.company || '').replace(/'/g, "\\'");
            const escapedTitle = (job.jobTitle || '').replace(/'/g, "\\'");

            return `
                <div style="background: white; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 8px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <h3 style="margin: 0; color: var(--primary); font-size: 16px;">${job.jobTitle}</h3>
                                <span class="badge badge-accent" style="font-size: 11px;">${job.fitScore || 90}% Match</span>
                                ${job.transitFriendly ? '<span class="badge badge-green" style="font-size: 11px;">🚌 Transit Friendly</span>' : ''}
                            </div>
                            <div style="font-size: 13.5px; font-weight: 600; color: #334155; margin-top: 3px;">
                                🏢 ${job.company} &nbsp;•&nbsp; 📍 ${job.location} &nbsp;•&nbsp; 💵 <span style="color: #166534;">${job.payRate}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <a href="${job.careersUrl}" target="_blank" class="btn btn-primary" style="font-size: 12px; padding: 6px 14px; text-decoration: none;">
                                🔗 Apply Online
                            </a>
                            <button class="btn btn-outline" style="font-size: 12px; padding: 6px 12px;" onclick="saveJobToPipeline('${escapedComp}', '${escapedTitle}', '${job.location}', '${job.payRate}', '${job.careersUrl}')">
                                💾 Save Lead
                            </button>
                        </div>
                    </div>

                    ${reasonsHtml ? `
                    <div style="margin-top: 10px; background: #f8fafc; border-radius: 6px; padding: 10px 14px;">
                        <strong style="font-size: 11.5px; color: #475569;">Why You are a Match:</strong>
                        <ul style="margin: 4px 0 0 18px; padding: 0; font-size: 12px; color: #334155; line-height: 1.5;">
                            ${reasonsHtml}
                        </ul>
                    </div>` : ''}

                    ${job.turnaroundTip ? `
                    <div style="margin-top: 8px; font-size: 12px; color: #4338ca; display: flex; align-items: center; gap: 6px;">
                        <span>💡</span>
                        <span><strong>Turnaround Tip:</strong> ${job.turnaroundTip}</span>
                    </div>` : ''}

                    <div style="display: flex; gap: 10px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;">
                        <button type="button" class="btn btn-outline" style="font-size: 11.5px; padding: 4px 10px;" onclick="prepareTailorResume('${escapedComp}', '${escapedTitle}')">
                            📝 Tailor Resume For This Position
                        </button>
                        <button type="button" class="btn btn-outline" style="font-size: 11.5px; padding: 4px 10px;" onclick="prepareInterviewCoach('${escapedComp}', '${escapedTitle}')">
                            🎤 Prepare 60-Sec Interview Script
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    } catch(err) {
        list.innerHTML = `<p style="color: red; padding: 20px;">Failed to match jobs: ${err.message}</p>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '⚡ Find Matching Openings';
        }
    }
}

async function saveJobToPipeline(company, jobTitle, location, payRate, careersUrl) {
    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch('/api/jobs/save-job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                userId: currentUser ? currentUser.id : null,
                company,
                jobTitle,
                location,
                payRate,
                careersUrl,
                status: 'saved'
            })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✅ "${jobTitle}" at ${company} saved to your job pipeline!`);
            loadSavedJobsPipeline();
        } else {
            alert('Could not save job: ' + data.error);
        }
    } catch(e) {
        alert('Save error: ' + e.message);
    }
}

function prepareTailorResume(company, jobTitle) {
    switchJobAiTab('resume');
    document.getElementById('resume-tailor-company').value = company;
    document.getElementById('resume-tailor-title').value = jobTitle;
    generateResumeBullets();
}

async function generateResumeBullets() {
    const token = localStorage.getItem('fs_token');
    const company = document.getElementById('resume-tailor-company')?.value || '';
    const jobTitle = document.getElementById('resume-tailor-title')?.value || '';
    const skills = document.getElementById('resume-tailor-skills')?.value || '';
    const btn = document.getElementById('btn-generate-resume-bullets');
    const outputBox = document.getElementById('resume-tailor-output-box');
    const content = document.getElementById('resume-tailor-content');

    if (!company || !jobTitle) {
        return alert('Please enter both Company Name and Job Title.');
    }

    btn.disabled = true;
    btn.innerText = '⚡ Generating Bullets...';

    try {
        const res = await fetch('/api/jobs/ai-tailor-resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ company, jobTitle, userSkills: skills })
        });
        const data = await res.json();
        if (data.bulletPoints) {
            outputBox.classList.remove('hidden');
            content.innerHTML = typeof marked !== 'undefined' ? marked.parse(data.bulletPoints) : data.bulletPoints.replace(/\n/g, '<br>');
        }
    } catch(e) {
        alert('Resume generation error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '⚡ Generate Tailored Resume Bullets';
    }
}

function copyResumeBullets() {
    const text = document.getElementById('resume-tailor-content')?.innerText || '';
    navigator.clipboard.writeText(text).then(() => {
        alert('📋 Resume bullets copied to clipboard!');
    }).catch(() => {
        alert('Copied text: \n\n' + text);
    });
}

function prepareInterviewCoach(company, jobTitle) {
    switchJobAiTab('interview');
    document.getElementById('interview-coach-company').value = company;
    document.getElementById('interview-coach-title').value = jobTitle;
    generateInterviewCoachScript();
}

async function generateInterviewCoachScript() {
    const token = localStorage.getItem('fs_token');
    const company = document.getElementById('interview-coach-company')?.value || '';
    const jobTitle = document.getElementById('interview-coach-title')?.value || '';
    const btn = document.getElementById('btn-generate-interview-script');
    const outputBox = document.getElementById('interview-coach-output-box');
    const content = document.getElementById('interview-coach-content');

    if (!company || !jobTitle) {
        return alert('Please enter both Target Employer and Position.');
    }

    btn.disabled = true;
    btn.innerText = '⚡ Generating 60-Sec Script...';

    try {
        const res = await fetch('/api/jobs/ai-interview-prep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ company, jobTitle })
        });
        const data = await res.json();
        if (data.turnaroundNarrative) {
            outputBox.classList.remove('hidden');
            content.innerHTML = typeof marked !== 'undefined' ? marked.parse(data.turnaroundNarrative) : data.turnaroundNarrative.replace(/\n/g, '<br>');
        }
    } catch(e) {
        alert('Script generation error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '⚡ Generate My 60-Second Turnaround Script';
    }
}

async function loadSavedJobsPipeline() {
    const token = localStorage.getItem('fs_token');
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/jobs/saved/${currentUser.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const jobs = await res.json();

        const countEl = document.getElementById('job-pipeline-count');
        if (countEl) countEl.innerText = jobs.length;

        const groups = { saved: [], applied: [], interviewing: [], offered: [] };
        jobs.forEach(j => {
            const st = (j.status || 'saved').toLowerCase();
            if (groups[st]) groups[st].push(j);
            else groups.saved.push(j);
        });

        ['saved', 'applied', 'interviewing', 'offered'].forEach(col => {
            const countBadge = document.getElementById(`pipeline-count-${col}`);
            const colEl = document.getElementById(`pipeline-col-${col}`);
            if (countBadge) countBadge.innerText = groups[col].length;
            if (!colEl) return;

            if (groups[col].length === 0) {
                colEl.innerHTML = `<p style="font-size: 11.5px; color: var(--slate); text-align: center; margin: auto; padding: 20px 0;">No jobs in this stage.</p>`;
            } else {
                colEl.innerHTML = groups[col].map(j => `
                    <div style="background: white; border: 1px solid var(--border); border-radius: 6px; padding: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                        <strong style="font-size: 12.5px; color: var(--primary); display: block;">${j.job_title}</strong>
                        <div style="font-size: 11.5px; color: #475569; margin: 2px 0;">🏢 ${j.company}</div>
                        <div style="font-size: 11px; color: #166534; font-weight: 600;">💵 ${j.pay_rate || 'Competitive'}</div>
                        
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 6px;">
                            <select onchange="updateJobStatus(${j.id}, this.value)" style="font-size: 10.5px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; background: #f8fafc;">
                                <option value="saved" ${col==='saved'?'selected':''}>⭐ Saved</option>
                                <option value="applied" ${col==='applied'?'selected':''}>📤 Applied</option>
                                <option value="interviewing" ${col==='interviewing'?'selected':''}>🎤 Interview</option>
                                <option value="offered" ${col==='offered'?'selected':''}>🎉 Offer/Hired</option>
                            </select>
                            <div style="display: flex; gap: 4px;">
                                ${j.careers_url ? `<a href="${j.careers_url}" target="_blank" style="font-size: 11px; text-decoration: none; padding: 2px 6px; background: #e0e7ff; color: #1e1b4b; border-radius: 4px;">🔗 Link</a>` : ''}
                                <button onclick="deleteSavedJob(${j.id})" style="background: none; border: none; cursor: pointer; font-size: 12px; color: #ef4444;" title="Remove">✕</button>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        });
    } catch(e) {
        console.warn('Pipeline load error:', e);
    }
}

async function updateJobStatus(jobId, newStatus) {
    const token = localStorage.getItem('fs_token');
    try {
        await fetch('/api/jobs/update-job-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ id: jobId, status: newStatus })
        });
        loadSavedJobsPipeline();
    } catch(e) {
        alert('Update status error: ' + e.message);
    }
}

async function deleteSavedJob(jobId) {
    if (!confirm('Remove this job from your pipeline?')) return;
    const token = localStorage.getItem('fs_token');
    try {
        await fetch(`/api/jobs/saved/${jobId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        loadSavedJobsPipeline();
    } catch(e) {
        alert('Delete error: ' + e.message);
    }
}
