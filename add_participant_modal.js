const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const modalHtml = `
    <!-- MODAL: Participant File (Consolidated) -->
    <div id="modal-participant-file" class="modal hidden">
        <div class="modal-content" style="max-width: 800px; padding: 0; overflow: hidden; background: #f8fafc;">
            <!-- Header -->
            <div style="background: white; padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    <h2 style="margin: 0; color: var(--primary); font-size: 22px; display: flex; align-items: center; gap: 10px;">
                        <span id="pf-name">Participant Name</span>
                        <span id="pf-badge-status" class="badge badge-green" style="font-size: 11px;">Active</span>
                    </h2>
                    <div style="color: var(--slate); font-size: 13px; margin-top: 6px; display: flex; gap: 16px;">
                        <span>📍 <span id="pf-location">Location</span></span>
                        <span>🧭 <span id="pf-track">Track</span></span>
                        <span>📅 Enrolled: <span id="pf-enrolled">Date</span></span>
                    </div>
                </div>
                <button onclick="closeModal('modal-participant-file')" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--slate);">&times;</button>
            </div>

            <!-- Tabs -->
            <div style="background: white; border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; gap: 24px;">
                <button class="pf-tab-btn active" onclick="switchPfTab('overview')" style="background: none; border: none; padding: 12px 0; font-weight: 600; color: var(--primary); border-bottom: 2px solid var(--primary); cursor: pointer; font-size: 14px;">Overview & Demographics</button>
                <button class="pf-tab-btn" onclick="switchPfTab('assessments')" style="background: none; border: none; padding: 12px 0; font-weight: 600; color: var(--slate); border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px;">Assessments & Planning</button>
                <button class="pf-tab-btn" onclick="switchPfTab('gamification')" style="background: none; border: none; padding: 12px 0; font-weight: 600; color: var(--slate); border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px;">Progress & Gamification</button>
            </div>

            <!-- Content Area -->
            <div style="padding: 24px; max-height: 60vh; overflow-y: auto;">
                
                <!-- OVERVIEW TAB -->
                <div id="pf-tab-overview" class="pf-tab-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div class="section-card">
                            <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Personal Information (PII)</h3>
                            <div id="pf-pii-content" style="font-size: 13px; line-height: 1.6;"></div>
                        </div>
                        <div class="section-card">
                            <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Legal & Compliance</h3>
                            <div id="pf-legal-content" style="font-size: 13px; line-height: 1.6;"></div>
                        </div>
                    </div>
                    <div class="section-card" style="margin-top: 16px;">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Quick Actions</h3>
                        <div id="pf-quick-actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>

                <!-- ASSESSMENTS TAB -->
                <div id="pf-tab-assessments" class="pf-tab-content hidden">
                    <div class="section-card mb-3">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Medical & Wellness</h3>
                        <div id="pf-health-actions" style="display: flex; gap: 8px; margin-top: 12px;"></div>
                    </div>
                    <div class="section-card">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Relapse Prevention Plans</h3>
                        <div id="pf-relapse-actions" style="display: flex; gap: 8px; margin-top: 12px;"></div>
                    </div>
                </div>

                <!-- GAMIFICATION TAB -->
                <div id="pf-tab-gamification" class="pf-tab-content hidden">
                    <div class="section-card mb-3">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Program Milestones</h3>
                        <div id="pf-gate-actions" style="margin-top: 12px;"></div>
                    </div>
                    <div class="section-card">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">SkillCat Engagement</h3>
                        <div id="pf-skillcat-actions" style="margin-top: 12px;"></div>
                    </div>
                </div>

            </div>
        </div>
    </div>
    <style>
        .pf-tab-btn:hover { color: var(--primary) !important; }
    </style>
`;

if (!html.includes("modal-participant-file")) {
    html = html.replace("<!-- MODAL: Participant File (Consolidated) -->", "");
    html = html.replace("<!-- MODAL: Relapse Prevention Plan -->", modalHtml + "\n    <!-- MODAL: Relapse Prevention Plan -->");
    fs.writeFileSync('public/index.html', html);
    console.log("✅ Added participant file modal");
}
