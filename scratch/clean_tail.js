const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

// I will look for the line where `saveModalGateItem` ends. 
// It ends around line 7387.
// Everything after line 7387 that looks like duplicate function declarations must go.

// Actually, I'll just find the exact text of the duplicate renderGateModalWeek and saveModalGateItem and remove it.
const badCode = `
function renderGateModalWeek(week) {
    for (let i=1; i<=4; i++) {
        const btn = document.getElementById(\`btn-gate-tab-\$\{i\}\`);
        if (btn) {
            if (i === week) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }
    
    const container = document.getElementById('gate-modal-criteria-container');
    const criteria = currentGateModalWeeks[week] || [];

    if (criteria.length === 0) {
        container.innerHTML = '<p class="text-slate">No criteria defined for this week.</p>';
        return;
    }

    let html = '<div class="gate-criteria-list" style="display: flex; flex-direction: column; gap: 16px;">';
    criteria.forEach(c => {
        let badgeClass = 'badge-pending';
        let badgeText = 'Pending';
        if (c.status === 'green') { badgeClass = 'badge-green'; badgeText = 'Completed'; }
        else if (c.status === 'red') { badgeClass = 'badge-red'; badgeText = 'Blocked'; }
        else if (c.status === 'not_applicable') { badgeClass = 'badge-slate'; badgeText = 'N/A'; }

        html += \`
            <div class="gate-criterion-item" style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                        <h4 style="margin: 0 0 4px 0; color: var(--primary); font-size: 15px;">\$\{c.title\}</h4>
                        <p style="margin: 0; font-size: 13px; color: var(--slate);">\$\{c.description || ''\}</p>
                        \$\{c.pm_notes ? \`<div class="criterion-notes mt-2" style="background: #fffbeb; padding: 8px; border-radius: 4px; border-left: 3px solid #f59e0b; font-size: 12px;"><strong>Staff Note:</strong> \$\{c.pm_notes\}</div>\` : ''\}
                    </div>
                    <div>
                        <span class="badge \$\{badgeClass\}" id="modal_badge_\$\{c.criterion_key\}">\$\{badgeText\}</span>
                    </div>
                </div>

                <div style="border-top: 1px solid #e2e8f0; padding-top: 12px;">
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <span style="font-size: 12px; font-weight: 600; color: var(--slate);">Status:</span>
                        <select id="modal_status_\$\{c.criterion_key\}" class="form-control" style="width: auto; font-size: 13px; padding: 4px 8px;">
                            <option value="pending" \$\{c.status === 'pending' ? 'selected' : ''\}>Pending</option>
                            <option value="green" \$\{c.status === 'green' ? 'selected' : ''\}>Completed</option>
                            <option value="red" \$\{c.status === 'red' ? 'selected' : ''\}>Blocked (Need Help)</option>
                            <option value="not_applicable" \$\{c.status === 'not_applicable' ? 'selected' : ''\}>Not Applicable</option>
                        </select>
                    </div>
                    <div style="margin-top: 12px; text-align: right;">
                        <button class="btn btn-primary" style="padding: 6px 14px; font-size: 13px;" onclick="saveModalGateItem('\$\{c.criterion_key\}')">Save Update</button>
                        <span id="modal_save_feedback_\$\{c.criterion_key\}" style="margin-left: 8px; font-size: 12px; color: var(--success);"></span>
                    </div>
                </div>
            </div>
        \`;
    });
    html += '</div>';
    container.innerHTML = html;
}

async function saveModalGateItem(criterionKey) {
    const status = document.getElementById(\`modal_status_\$\{criterionKey\}\`).value;
    const feedback = document.getElementById(\`modal_save_feedback_\$\{criterionKey\}\`);
    
    try {
        const token = localStorage.getItem('fs_token');
        const payload = { criterion_key: criterionKey, status: status };
        if (currentGateModalRole === 'program_manager' || currentGateModalRole === 'admin') {
            payload.userId = currentGateModalUserId;
        }

        const res = await fetch('/api/participant/gate-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \$\{token\}\` },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error(await res.text());
        
        feedback.innerText = 'Saved!';
        setTimeout(() => feedback.innerText = '', 2000);
        
        // Update badge UI
        const badge = document.getElementById(\`modal_badge_\$\{criterionKey\}\`);
        badge.className = 'badge';
        if (status === 'green') { badge.classList.add('badge-green'); badge.innerText = 'Completed'; }
        else if (status === 'red') { badge.classList.add('badge-red'); badge.innerText = 'Blocked'; }
        else if (status === 'not_applicable') { badge.classList.add('badge-slate'); badge.innerText = 'N/A'; }
        else { badge.classList.add('badge-pending'); badge.innerText = 'Pending'; }

        // Refresh caseload if staff
        if (currentGateModalRole === 'program_manager' || currentGateModalRole === 'admin') {
            if (typeof loadCaseload === 'function') loadCaseload();
        }
    } catch (e) {
        feedback.style.color = 'red';
        feedback.innerText = 'Error';
        setTimeout(() => {
            feedback.style.color = 'var(--success)';
            feedback.innerText = '';
        }, 2000);
    }
}
`;

// Remove ALL occurrences of this exact bad code block (should just be one at the end)
code = code.replace(badCode, '');

fs.writeFileSync('public/app.js', code);
console.log('Cleaned duplicate tail from app.js');
