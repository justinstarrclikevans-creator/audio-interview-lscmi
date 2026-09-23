const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

// 1. Update the caseload actions HTML
const oldHtml = `                let feedbackHtml = \`<div style="font-size: 10px;">
                    \${gateDropdownHtml}
                    <button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 6px; width: 100%;" onclick="openCaseReviewModal(\${p.id}, '\${escName}')">View Feedback</button>
<button class="btn btn-primary" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%;" onclick="openGateChecklistModal(\${p.id}, '\${escName}')">✅ Gate Checklist</button>
                </div>\`;`;

const newHtml = `                let feedbackHtml = \`<div style="font-size: 10px;">
                    \${gateDropdownHtml}
                    <button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 6px; width: 100%;" onclick="openCaseReviewModal(\${p.id}, '\${escName}')">View Feedback</button>
<button class="btn btn-primary" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%;" onclick="openGateChecklistModal(\${p.id}, '\${escName}')">✅ Gate Checklist</button>
<button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%; border-color: #fca5a5; color: #b91c1c; background: #fee2e2;" onclick="openRelapsePlanModal(\${p.id}, '\${escName}', 'substance')">📝 Sub. Relapse Plan</button>
<button class="btn btn-outline" style="padding: 2px 4px; font-size: 9px; margin-top: 4px; display: block; width: 100%; border-color: #fcd34d; color: #b45309; background: #fef3c7;" onclick="openRelapsePlanModal(\${p.id}, '\${escName}', 'behavior')">📝 Beh. Relapse Plan</button>
                </div>\`;`;

if (appJs.includes('✅ Gate Checklist')) {
    appJs = appJs.replace(oldHtml, newHtml);
}

// 2. Add the modal functions
const newFunctions = `
// RELAPSE PREVENTION PLAN
// ==========================================
async function openRelapsePlanModal(participantId, participantName, type) {
    document.getElementById('relapse-form-inline').reset();
    document.getElementById('rp-participant-id').value = participantId;
    document.getElementById('rp-plan-type').value = type;
    document.getElementById('rp-participant-name').innerText = participantName;
    
    document.getElementById('rp-modal-title').innerText = type === 'substance' 
        ? 'Substance Use Relapse Prevention Plan' 
        : 'Behavioral Relapse Prevention Plan';
    
    try {
        const res = await fetch(\`/api/staff/relapse-plan/\${participantId}/\${type}\`, {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('fs_token') }
        });
        if (res.ok) {
            const json = await res.json();
            if (json.data) {
                const d = json.data;
                document.getElementById('rp-triggers').value = d.triggers || '';
                document.getElementById('rp-warning-signs').value = d.warning_signs || '';
                document.getElementById('rp-coping-skills').value = d.coping_skills || '';
                document.getElementById('rp-support-system').value = d.support_system || '';
                document.getElementById('rp-emergency-plan').value = d.emergency_plan || '';
            }
        }
    } catch(e) { console.error(e); }
    
    openModal('modal-relapse-plan');
}

async function submitRelapseForm(e) {
    e.preventDefault();
    const token = localStorage.getItem('fs_token');
    const payload = {
        user_id: document.getElementById('rp-participant-id').value,
        plan_type: document.getElementById('rp-plan-type').value,
        triggers: document.getElementById('rp-triggers').value,
        warning_signs: document.getElementById('rp-warning-signs').value,
        coping_skills: document.getElementById('rp-coping-skills').value,
        support_system: document.getElementById('rp-support-system').value,
        emergency_plan: document.getElementById('rp-emergency-plan').value
    };
    
    try {
        const res = await fetch('/api/staff/relapse-plan', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(res.ok) { 
            closeModal('modal-relapse-plan');
            alert('Relapse Plan saved successfully.');
        } else {
            const data = await res.json();
            alert('Error: ' + data.error);
        }
    } catch(err) {
        alert('Failed to submit: ' + err.message);
    }
}
`;

if (!appJs.includes("openRelapsePlanModal")) {
    appJs += "\n" + newFunctions;
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Added relapse plan JS functions");
}
