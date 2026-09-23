const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const healthModalHtml = `
<!-- Health Screen Modal -->
<div id="modal-health-screen" class="modal">
    <div class="modal-content" style="max-width: 600px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 15px;">
            <div>
                <h3 style="margin: 0; color: #1e293b; font-size: 18px;">🩺 Health & Wellness Observation Screen</h3>
                <div style="font-size: 13px; color: var(--slate); margin-top: 4px;">Participant: <strong id="hs-participant-name">...</strong></div>
            </div>
            <span class="close-modal" onclick="closeModal('modal-health-screen')">&times;</span>
        </div>

        <p style="font-size: 13px; color: #64748b; margin-bottom: 20px; font-style: italic;">
            Staff Instructions: You are not a doctor. Use this tool to note observable behaviors or self-reported struggles.
        </p>

        <form id="health-form-inline" onsubmit="submitHealthForm(event)">
            <input type="hidden" id="hs-participant-id">
            
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 14px;">Section 1: Physical Health & Mobility</h4>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_vision"> Vision: Squints, holds paperwork close, headaches.</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_hearing"> Hearing: Asks to repeat, speaks loudly.</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_mobility"> Mobility/Pain: Winces, limps, shifts weight.</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_stamina"> Stamina/Fatigue: Excessively tired, sleeps in session.</label>
                <label style="display: block; margin-bottom: 10px; font-size: 13px;"><input type="checkbox" id="h_fine_motor"> Fine Motor: Shaking hands, struggles to write.</label>
                <textarea id="h_physical_notes" placeholder="Staff Notes..." rows="3" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; box-sizing: border-box;"></textarea>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 14px;">Section 2: Cognitive, Learning & Executive Functioning</h4>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_reading"> Reading/Writing: Avoids reading out loud, leaves blank.</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_following"> Following Instructions: Needs tasks broken down.</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_memory"> Memory & Organization: Forgets appointments, loses docs.</label>
                <label style="display: block; margin-bottom: 10px; font-size: 13px;"><input type="checkbox" id="h_processing"> Processing Time: Takes long to respond.</label>
                <textarea id="h_cognitive_notes" placeholder="Staff Notes..." rows="3" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; box-sizing: border-box;"></textarea>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 14px;">Section 5: Referral Action Plan</h4>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_ref_pc"> Primary Care / Welvista Referral</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_ref_vr"> Vocational Rehabilitation Referral</label>
                <label style="display: block; margin-bottom: 6px; font-size: 13px;"><input type="checkbox" id="h_ref_mh"> Mental Health / Counseling Referral</label>
                <label style="display: block; margin-bottom: 10px; font-size: 13px;"><input type="checkbox" id="h_job_adj"> Job Search Adjustment</label>
                <textarea id="h_next_step" placeholder="Immediate Next Step / Referral Made" rows="3" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 13px; box-sizing: border-box;"></textarea>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button type="button" class="btn btn-outline" onclick="closeModal('modal-health-screen')">Cancel</button>
                <button type="submit" class="btn btn-primary">Submit Health Assessment</button>
            </div>
        </form>
    </div>
</div>
`;

// Inject right before the closing </body> tag
html = html.replace('</body>', healthModalHtml + '\n</body>');
fs.writeFileSync('public/index.html', html);
console.log('✅ Added health screen modal to index.html');
