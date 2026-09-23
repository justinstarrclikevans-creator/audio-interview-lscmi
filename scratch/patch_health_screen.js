const fs = require('fs');
let html = fs.readFileSync('public/staff_tools.html', 'utf8');

// 1. Change the Participant ID input to show Name (and hide the actual ID)
html = html.replace(
    /<div class="form-group">\s*<label>Participant ID:<\/label>\s*<input type="number" id="h_participant_id" required>\s*<\/div>/g,
    `<div class="form-group" style="background: #e0f2fe; padding: 10px; border-radius: 6px; display: inline-block; margin-bottom: 15px;">
                <label style="color: #0369a1; font-weight: bold; margin-bottom: 0;">Participant:</label>
                <span id="h_participant_name_display" style="font-weight: 800; font-size: 16px;">Loading...</span>
                <input type="hidden" id="h_participant_id" required>
            </div>`
);

// 2. Do the same for stability form if it exists
html = html.replace(
    /<div class="form-group">\s*<label>Participant ID:<\/label>\s*<input type="number" id="s_participant_id" required>\s*<\/div>/g,
    `<div class="form-group" style="background: #e0f2fe; padding: 10px; border-radius: 6px; display: inline-block; margin-bottom: 15px;">
                <label style="color: #0369a1; font-weight: bold; margin-bottom: 0;">Participant:</label>
                <span id="s_participant_name_display" style="font-weight: 800; font-size: 16px;">Loading...</span>
                <input type="hidden" id="s_participant_id" required>
            </div>`
);

// 3. Update window.onload to fetch and display the participant's name
html = html.replace(
    /window\.onload = function\(\) {/g,
    `window.onload = async function() {`
);

html = html.replace(
    /if \(uid\) \{\s*document\.getElementById\('h_participant_id'\)\.value = uid;\s*document\.getElementById\('s_participant_id'\)\.value = uid;\s*\}/g,
    `if (uid) {
                document.getElementById('h_participant_id').value = uid;
                document.getElementById('s_participant_id').value = uid;
                
                // Fetch name for display
                try {
                    const nameRes = await fetch('/api/admin/caseload?location=all', { headers: { 'Authorization': 'Bearer ' + token } });
                    const roster = await nameRes.json();
                    const p = roster.find(r => r.id == uid);
                    if (p) {
                        if (document.getElementById('h_participant_name_display')) document.getElementById('h_participant_name_display').innerText = p.name;
                        if (document.getElementById('s_participant_name_display')) document.getElementById('s_participant_name_display').innerText = p.name;
                    } else {
                        if (document.getElementById('h_participant_name_display')) document.getElementById('h_participant_name_display').innerText = 'ID: ' + uid;
                    }
                } catch(e) {}
            }`
);

fs.writeFileSync('public/staff_tools.html', html);
console.log('✅ Patched Health Screen participant auto-fill');
