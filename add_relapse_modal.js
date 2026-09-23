const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const modalHtml = `
    <!-- MODAL: Relapse Prevention Plan -->
    <div id="modal-relapse-plan" class="modal hidden">
        <div class="modal-content" style="max-width: 600px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0;" id="rp-modal-title">Relapse Prevention Plan</h3>
                <button onclick="closeModal('modal-relapse-plan')" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--slate);">&times;</button>
            </div>
            
            <p style="font-size: 13px; color: var(--slate); margin-top: -10px; margin-bottom: 20px;">
                Participant: <strong id="rp-participant-name"></strong>
            </p>

            <form id="relapse-form-inline" onsubmit="submitRelapseForm(event)">
                <input type="hidden" id="rp-participant-id">
                <input type="hidden" id="rp-plan-type">
                
                <div style="display: grid; grid-template-columns: 1fr; gap: 16px;">
                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--slate-dark);">1. Triggers / High-Risk Situations</label>
                        <div style="font-size: 11px; color: var(--slate); margin-bottom: 4px;">What people, places, things, or situations make you want to act out or use?</div>
                        <textarea id="rp-triggers" style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 10px; min-height: 70px; font-family: inherit; font-size: 13px;" required></textarea>
                    </div>

                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--slate-dark);">2. Early Warning Signs</label>
                        <div style="font-size: 11px; color: var(--slate); margin-bottom: 4px;">What thoughts, feelings, or behaviors happen right before a relapse?</div>
                        <textarea id="rp-warning-signs" style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 10px; min-height: 70px; font-family: inherit; font-size: 13px;" required></textarea>
                    </div>

                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--slate-dark);">3. Coping Skills & Alternatives</label>
                        <div style="font-size: 11px; color: var(--slate); margin-bottom: 4px;">What healthy actions will you take instead?</div>
                        <textarea id="rp-coping-skills" style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 10px; min-height: 70px; font-family: inherit; font-size: 13px;" required></textarea>
                    </div>

                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--slate-dark);">4. Support System</label>
                        <div style="font-size: 11px; color: var(--slate); margin-bottom: 4px;">Who can you call for help when you are struggling?</div>
                        <textarea id="rp-support-system" style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 10px; min-height: 70px; font-family: inherit; font-size: 13px;" required></textarea>
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--slate-dark);">5. Emergency Plan</label>
                        <div style="font-size: 11px; color: var(--slate); margin-bottom: 4px;">What is the plan if a relapse actually happens?</div>
                        <textarea id="rp-emergency-plan" style="width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 10px; min-height: 70px; font-family: inherit; font-size: 13px;" required></textarea>
                    </div>
                </div>

                <div style="margin-top: 24px; text-align: right; border-top: 1px solid var(--border); padding-top: 16px;">
                    <button type="button" class="btn btn-outline" style="margin-right: 8px;" onclick="closeModal('modal-relapse-plan')">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Plan</button>
                </div>
            </form>
        </div>
    </div>
`;

if (!html.includes("modal-relapse-plan")) {
    html = html.replace("<!-- MODAL: Health Screen -->", modalHtml + "\n    <!-- MODAL: Health Screen -->");
    fs.writeFileSync('public/index.html', html);
    console.log("✅ Added relapse modal");
}
