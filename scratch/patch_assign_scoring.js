const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// 1. In loadPmDrafts, add the Assignment UI
js = js.replace(
    /let html = `\s*<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;/g,
    `// Fetch active participants for the assignment dropdown
    let activeParticipants = [];
    try {
        const token = localStorage.getItem('fs_token');
        const res = await fetch('/api/admin/caseload?location=all', { headers: { 'Authorization': 'Bearer ' + token } });
        activeParticipants = await res.json();
    } catch(e) {}
    
    let html = \`
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;`
);

js = js.replace(
    /const cleanName = parts\.map\(w => w\.charAt\(0\)\.toUpperCase\(\) \+ w\.slice\(1\)\)\.join\(' '\);/g,
    `const cleanName = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const participantOptions = activeParticipants.map(p => 
        \`<option value="\${p.name}">\${p.name} (\${p.location || 'Unknown'})</option>\`
    ).join('');
    
    const assignDropdownHtml = \`<div style="display: flex; align-items: center; gap: 6px; margin-top: 8px;">
        <select id="assign-scoring-\${clientId}" style="font-size: 11px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px;">
            <option value="">Link to Participant...</option>
            \${participantOptions}
        </select>
        <button class="btn btn-outline" style="font-size: 10px; padding: 4px 8px;" onclick="assignScoring('\${clientId}')">🔗 Link</button>
    </div>\`;`
);

js = js.replace(
    /<div style="font-size: 11px; color: var\(--slate\); margin-top: 3px;">ID: \$\{clientId\} • Files: \$\{files\.length\} documents<\/div>\s*<\/div>/g,
    `<div style="font-size: 11px; color: var(--slate); margin-top: 3px;">ID: \${clientId} • Files: \${files.length} documents</div>
                            \${assignDropdownHtml}
                        </div>`
);

// 2. Add the assignScoring function
const newFuncs = `
async function assignScoring(clientId) {
    const participantName = document.getElementById('assign-scoring-' + clientId).value;
    if (!participantName) return alert('Select a participant to link to.');
    
    if (!confirm('Link scoring records for "' + clientId + '" to participant "' + participantName + '"? This will rename the files.')) return;
    
    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch('/api/admin/scoring/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ clientId, participantName })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Scoring successfully linked and files renamed.');
            loadPmDrafts();
        } else {
            alert('Failed to link scoring: ' + (data.error || 'Unknown error'));
        }
    } catch(e) {
        alert('Error linking scoring: ' + e.message);
    }
}
`;

fs.writeFileSync('public/app.js', js + '\n' + newFuncs);
console.log('✅ Patched UI for assigning scorings');
