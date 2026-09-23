const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

// 1. Inject textarea into HTML
code = code.replace(
    '<div style="border-top: 1px solid #e2e8f0; padding-top: 12px;">',
    `<div style="border-top: 1px solid #e2e8f0; padding-top: 12px;">
                    <div style="margin-bottom: 12px;">
                        <textarea id="modal_notes_\${c.criterion_key}" class="form-control" placeholder="\${c.criterion_key === 'g1_main_goal' ? 'What is your main goal?' : (c.criterion_key === 'g1_skillcat_track' ? 'Which SkillCat track?' : 'Notes (Optional)')}" style="font-size: 13px; min-height: 50px;">\${c.participant_notes || ''}</textarea>
                    </div>`
);

// 2. Update saveModalGateItem to get notes
code = code.replace(
    'const status = document.getElementById(`modal_status_${criterionKey}`).value;',
    `const status = document.getElementById(\`modal_status_\${criterionKey}\`).value;
    const notes = document.getElementById(\`modal_notes_\${criterionKey}\`).value;`
);

// 3. Update payload
code = code.replace(
    'const payload = { criterion_key: criterionKey, status: status };',
    'const payload = { criterion_key: criterionKey, status: status, participant_notes: notes };'
);

// 4. Update memory in saveModalGateItem
code = code.replace(
    '// Update badge UI',
    `// Update memory
        if (currentGateModalWeeks) {
            for (const w in currentGateModalWeeks) {
                const item = currentGateModalWeeks[w].find(c => c.criterion_key === criterionKey);
                if (item) {
                    item.status = status;
                    item.participant_notes = notes;
                    break;
                }
            }
        }
        
        // Update badge UI`
);

fs.writeFileSync('public/app.js', code);
console.log('Patched gates to include notes textboxes and memory updates');
