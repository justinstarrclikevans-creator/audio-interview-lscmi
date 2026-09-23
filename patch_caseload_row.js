const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

const targetStr = \`                    \${gateDropdownHtml}
                    <button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 6px; width: 100%;" onclick="openCaseReviewModal(\${p.id}, '\${escName}')">View Feedback</button>
<button class="btn btn-primary" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%;" onclick="openGateChecklistModal(\${p.id}, '\${escName}')">✅ Gate Checklist</button>
<button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%; border-color: #fca5a5; color: #b91c1c; background: #fee2e2;" onclick="openRelapsePlanModal(\${p.id}, '\${escName}', 'substance')">📝 Sub. Relapse Plan</button>
<button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%; border-color: #fcd34d; color: #b45309; background: #fef3c7;" onclick="openRelapsePlanModal(\${p.id}, '\${escName}', 'behavior')">📝 Beh. Relapse Plan</button>
                </div>\`;\`;

// Replace the massive feedbackHtml block with just one Open File button
const newFeedbackHtml = \`                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 11px; margin-top: 4px; display: block; width: 100%; font-weight: bold;" onclick="openParticipantFile(\${p.id}, '\${escName}', \${p.current_gate || 1}, '\${p.location}', '\${p.track}', '\${p.enrollment_date}', \${p.has_health_screen})">📂 Open Participant File</button>
                </div>\`;\`;

if (appJs.includes('✅ Gate Checklist')) {
    appJs = appJs.replace(targetStr, newFeedbackHtml);
}

const pfFunctions = \`
// PARTICIPANT FILE TABBED MODAL
function switchPfTab(tabId) {
    document.querySelectorAll('.pf-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.pf-tab-btn').forEach(el => {
        el.classList.remove('active');
        el.style.color = 'var(--slate)';
        el.style.borderBottomColor = 'transparent';
    });
    
    document.getElementById('pf-tab-' + tabId).classList.remove('hidden');
    const activeBtn = Array.from(document.querySelectorAll('.pf-tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if(activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = 'var(--primary)';
        activeBtn.style.borderBottomColor = 'var(--primary)';
    }
}

function openParticipantFile(pId, pName, pGate, pLocation, pTrack, pEnrolled, hasHealth) {
    document.getElementById('pf-name').innerText = pName;
    document.getElementById('pf-location').innerText = pLocation || 'Unknown';
    document.getElementById('pf-track').innerText = pTrack || 'First Shift';
    document.getElementById('pf-enrolled').innerText = pEnrolled || 'Pending';
    
    // Quick Actions
    document.getElementById('pf-quick-actions').innerHTML = \`
        <button class="btn btn-outline" onclick="openCorrectionModal(\${pId}, '\${pName}')">✏️ Edit Profile</button>
        <button class="btn btn-outline" onclick="impersonateParticipant(\${pId})">👀 View Portal as \${pName.split(' ')[0]}</button>
    \`;

    // Health Actions
    document.getElementById('pf-health-actions').innerHTML = hasHealth > 0 
        ? \`<button onclick="openHealthScreenModal(\${pId}, '\${pName}')" class="btn btn-outline" style="color: #15803d; font-weight: bold; font-size: 11px; background: #dcfce7; border-color: #86efac;">✅ Health Assessment Completed</button>\` 
        : \`<button onclick="openHealthScreenModal(\${pId}, '\${pName}')" class="btn btn-outline" style="font-size: 11px; color: #b91c1c; border-color: #fca5a5; background: #fee2e2;">⚠️ Complete Health Screen</button>\`;

    // Relapse Actions
    document.getElementById('pf-relapse-actions').innerHTML = \`
        <button class="btn btn-outline" style="font-size: 11px; border-color: #fca5a5; color: #b91c1c; background: #fee2e2;" onclick="openRelapsePlanModal(\${pId}, '\${pName}', 'substance')">📝 Substance Relapse Plan</button>
        <button class="btn btn-outline" style="font-size: 11px; border-color: #fcd34d; color: #b45309; background: #fef3c7;" onclick="openRelapsePlanModal(\${pId}, '\${pName}', 'behavior')">📝 Behavioral Relapse Plan</button>
    \`;

    // Gamification & Progress
    document.getElementById('pf-gate-actions').innerHTML = \`
        <button class="btn btn-primary" onclick="openGateChecklistModal(\${pId}, '\${pName}')">✅ Review Gate \${pGate} Checklist</button>
        <button class="btn btn-outline" onclick="openCaseReviewModal(\${pId}, '\${pName}')">View Facilitation Feedback</button>
    \`;

    switchPfTab('overview');
    openModal('modal-participant-file');
}
\`;

if (!appJs.includes("openParticipantFile(")) {
    appJs += "\\n" + pfFunctions;
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Patched Caseload UI and added modal logic");
}
