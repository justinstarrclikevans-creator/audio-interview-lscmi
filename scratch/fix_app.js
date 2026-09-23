const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// The exact string we want to replace for section 5. Recent Case Notes
const sectionToReplace = `
            // 5. Recent Case Notes
            const notesContainer = document.getElementById('rn-plan-notes-container');
            if (notesContainer) {
                const notes = data.notes || [];
                if (notes.length === 0) {
                    notesContainer.innerHTML = '<p style="color: var(--slate); font-size: 13px; margin: 0;">No individual case management notes recorded yet.</p>';
                } else {
                    notesContainer.innerHTML = notes.map(n => \`
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px;">
                            <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--slate); margin-bottom: 4px;">
                                <span><strong style="color: var(--primary);">\${n.author_name}</strong> • \${n.note_type} (\${n.category || 'Case Management'})</span>
                                <span>📅 \${n.session_date}</span>
                            </div>
                            <div style="font-size: 13px; color: #1e293b; line-height: 1.5; white-space: pre-line;">\${n.content}</div>
                        </div>
                    \`).join('');
                }
            }
`;
js = js.replace(sectionToReplace, '');

// And the fallback notes rendering
const fallbackNotes = `
            const notesContainer = document.getElementById('rn-plan-notes-container');
            if (notesContainer && data.notes && data.notes.length > 0) {
                notesContainer.innerHTML = data.notes.map(n => \`
                    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px;">
                        <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--slate); margin-bottom: 4px;">
                            <span><strong style="color: var(--primary);">\${n.author_name}</strong> • \${n.note_type}</span>
                            <span>📅 \${n.session_date}</span>
                        </div>
                        <div style="font-size: 13px; color: #1e293b; line-height: 1.5;">\${n.content}</div>
                    </div>
                \`).join('');
            }`;
js = js.replace(fallbackNotes, '');

fs.writeFileSync('public/app.js', js);
console.log('Restored app.js and carefully removed notes rendering');
