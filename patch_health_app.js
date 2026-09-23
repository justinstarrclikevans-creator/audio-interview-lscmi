const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

// 1. Update the button
const oldBtn = `'<div style="color: #15803d; font-weight: bold; font-size: 11px; background: #dcfce7; padding: 4px; border-radius: 4px;">✅ Completed</div>'`;
const newBtn = `\`<button onclick="openHealthScreenModal(\${p.id}, '\${escName}')" class="btn btn-outline" style="color: #15803d; font-weight: bold; font-size: 11px; background: #dcfce7; border-color: #86efac; padding: 4px; border-radius: 4px; cursor: pointer; width: 100%;">✅ Completed</button>\``;
appJs = appJs.replace(oldBtn, newBtn);

// 2. Update the modal function
const oldFunc = `function openHealthScreenModal(participantId, participantName) {
    document.getElementById('health-form-inline').reset();
    document.getElementById('hs-participant-id').value = participantId;
    document.getElementById('hs-participant-name').innerText = participantName;
    openModal('modal-health-screen');
}`;

const newFunc = `async function openHealthScreenModal(participantId, participantName) {
    document.getElementById('health-form-inline').reset();
    document.getElementById('hs-participant-id').value = participantId;
    document.getElementById('hs-participant-name').innerText = participantName;
    
    try {
        const res = await fetch('/api/staff/health-assessment/' + participantId, {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('fs_token') }
        });
        if (res.ok) {
            const json = await res.json();
            if (json.data) {
                const d = json.data;
                document.getElementById('h_vision').checked = !!d.vision_issues;
                document.getElementById('h_hearing').checked = !!d.hearing_issues;
                document.getElementById('h_mobility').checked = !!d.mobility_pain;
                document.getElementById('h_stamina').checked = !!d.stamina_fatigue;
                document.getElementById('h_fine_motor').checked = !!d.fine_motor_issues;
                document.getElementById('h_physical_notes').value = d.physical_notes || '';
                
                document.getElementById('h_reading').checked = !!d.reading_writing_issues;
                document.getElementById('h_following').checked = !!d.following_instructions_issues;
                document.getElementById('h_memory').checked = !!d.memory_organization_issues;
                document.getElementById('h_processing').checked = !!d.processing_time_issues;
                document.getElementById('h_cognitive_notes').value = d.cognitive_notes || '';
                
                document.getElementById('h_ref_pc').checked = !!d.primary_care_referral;
                document.getElementById('h_ref_vr').checked = !!d.vocational_rehab_referral;
                document.getElementById('h_ref_mh').checked = !!d.mental_health_referral;
                document.getElementById('h_job_adj').checked = !!d.job_search_adjustment;
                document.getElementById('h_next_step').value = d.immediate_next_step || '';
            }
        }
    } catch(e) { console.error(e); }
    
    openModal('modal-health-screen');
}`;

if (appJs.includes("openHealthScreenModal(participantId, participantName)")) {
    appJs = appJs.replace(oldFunc, newFunc);
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Updated app.js");
} else {
    console.log("❌ Failed to find function");
}
