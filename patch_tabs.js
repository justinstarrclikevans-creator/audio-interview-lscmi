const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// Add Case Plan section to Assessments tab in HTML
const targetHtml = \`<div class="section-card mb-3">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Medical & Wellness</h3>\`;

const newHtml = \`<div class="section-card mb-3">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Case Planning</h3>
                        <div id="pf-caseplan-actions" style="display: flex; gap: 8px; margin-top: 12px;"></div>
                    </div>
                    <div class="section-card mb-3">
                        <h3 style="margin-top: 0; font-size: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">Medical & Wellness</h3>\`;

if (html.includes('Medical & Wellness') && !html.includes('Case Planning')) {
    html = html.replace(targetHtml, newHtml);
    fs.writeFileSync('public/index.html', html);
    console.log("✅ Updated index.html");
}

let appJs = fs.readFileSync('public/app.js', 'utf8');
const targetGamification = \`// Gamification & Progress
    document.getElementById('pf-gate-actions').innerHTML = \\\`
        <button class="btn btn-primary" style="margin-bottom: 6px;" onclick="openGateChecklistModal(\\\${pId}, '\\\${pName}')">✅ Review Gate \\\${pGate} Checklist</button>
        <button class="btn btn-outline" style="margin-bottom: 6px;" onclick="openCaseReviewModal(\\\${pId}, '\\\${pName}')">📋 Weekly Case Review & Feedback</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #4338ca; border-color: #c7d2fe;" onclick="openPmCbtReviewModal(\\\${pId}, '\\\${pName}')">🧠 CBT Worksheets</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #0f766e; border-color: #99f6e4; background: #f0fdfa;" onclick="printParticipantScoringByName('\\\${pName}')">🖨️ Print LS/CMI Score</button>
    \\\`;\`;

const newGamification = \`// Case Planning
    document.getElementById('pf-caseplan-actions').innerHTML = \\\`
        <button class="btn btn-primary" onclick="openCaseReviewModal(\\\${pId}, '\\\${pName}')">📋 View Weekly Case Plan & Feedback</button>
        <button class="btn btn-outline" onclick="startReentryAssessmentForUser(\\\${pId}, '\\\${pName}')">🧭 Reentry Nav Plan</button>
    \\\`;

    // Gamification & Progress
    document.getElementById('pf-gate-actions').innerHTML = \\\`
        <button class="btn btn-primary" style="margin-bottom: 6px;" onclick="openGateChecklistModal(\\\${pId}, '\\\${pName}')">✅ Review Gate \\\${pGate} Checklist</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #4338ca; border-color: #c7d2fe;" onclick="openPmCbtReviewModal(\\\${pId}, '\\\${pName}')">🧠 CBT Worksheets</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #0f766e; border-color: #99f6e4; background: #f0fdfa;" onclick="printParticipantScoringByName('\\\${pName}')">🖨️ Print LS/CMI Score</button>
    \\\`;\`;

if (appJs.includes('openCaseReviewModal') && appJs.includes('pf-gate-actions')) {
    appJs = appJs.replace(targetGamification, newGamification);
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Updated app.js");
}
