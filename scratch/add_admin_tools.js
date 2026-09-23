const fs = require('fs');
let code = fs.readFileSync('public/index.html', 'utf8');

// Add Track select inside the grid
code = code.replace(
    '                    <div>\n                        <label style="display:block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">Housing Status</label>',
    `                    <div>
                        <label style="display:block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">Program Track</label>
                        <select id="pc-track" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12.5px;">
                            <option value="first_shift">First Shift</option>
                            <option value="reentry_nav">Re-entry Navigation</option>
                        </select>
                    </div>
                    <div>
                        <label style="display:block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px;">Housing Status</label>`
);

// Add Delete button in the footer
code = code.replace(
    '<button type="button" class="btn btn-outline" onclick="closeModal(\'modal-participant-correction\')">Cancel</button>',
    `<button type="button" class="btn btn-outline" style="border-color: #ef4444; color: #b91c1c; margin-right: auto;" onclick="deleteParticipant()">🗑️ Delete Participant</button>
                    <button type="button" class="btn btn-outline" onclick="closeModal('modal-participant-correction')">Cancel</button>`
);

const timestamp = Date.now();
code = code.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', code);
console.log('Added admin tools to index.html');
