const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

// 1. Populate track in openCorrectionModal
code = code.replace(
    "document.getElementById('pc-housing-status').value = p.housing_status || 'stable';",
    "document.getElementById('pc-housing-status').value = p.housing_status || 'stable';\n            document.getElementById('pc-track').value = p.track || 'first_shift';"
);

// 2. Add track to handleParticipantCorrectionSubmit
code = code.replace(
    "const housingStatus = document.getElementById('pc-housing-status').value;",
    "const housingStatus = document.getElementById('pc-housing-status').value;\n    const track = document.getElementById('pc-track').value;"
);
code = code.replace(
    "housingStatus\n            })",
    "housingStatus,\n                track\n            })"
);

// 3. Add deleteParticipant function
const deleteFunc = `
async function deleteParticipant() {
    const userId = document.getElementById('pc-user-id').value;
    if (!userId) return;
    if (!confirm('Are you absolutely sure you want to permanently delete this participant and all of their data? This action cannot be undone.')) return;

    const token = localStorage.getItem('fs_token');
    const saveBtn = document.getElementById('btn-save-correction');
    const statusEl = document.getElementById('pc-save-status');

    try {
        saveBtn.disabled = true;
        statusEl.innerHTML = '<span style="color: var(--danger);">Deleting participant...</span>';
        
        const res = await fetch(\`/api/admin/participant/\${userId}\`, {
            method: 'DELETE',
            headers: { 'Authorization': \`Bearer \${token}\` }
        });
        
        if (res.ok) {
            statusEl.innerHTML = '<span style="color: var(--success);">Participant deleted successfully.</span>';
            loadCaseload();
            setTimeout(() => {
                closeModal('modal-participant-correction');
            }, 1000);
        } else {
            const data = await res.json();
            statusEl.innerHTML = \`<span style="color: var(--danger);">❌ Error: \${data.error || 'Failed to delete'}</span>\`;
        }
    } catch(e) {
        statusEl.innerHTML = \`<span style="color: var(--danger);">❌ Network error: \${e.message}</span>\`;
    } finally {
        saveBtn.disabled = false;
    }
}
`;

code = code + '\n' + deleteFunc;

fs.writeFileSync('public/app.js', code);
console.log('Patched app.js with delete Participant function and track edit');
