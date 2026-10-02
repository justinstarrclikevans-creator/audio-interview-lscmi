const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

const oldGamification = \`    // Gamification & Progress
    document.getElementById('pf-gate-actions').innerHTML = \\\`
        <button class="btn btn-primary" style="margin-bottom: 6px;" onclick="openGateChecklistModal(\\\${pId}, '\\\${pName}')">✅ Review Gate \\\${pGate} Checklist</button>
        <button class="btn btn-outline" style="margin-bottom: 6px;" onclick="openCaseReviewModal(\\\${pId}, '\\\${pName}')">📋 Weekly Case Review & Feedback</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #4338ca; border-color: #c7d2fe;" onclick="openPmCbtReviewModal(\\\${pId}, '\\\${pName}')">🧠 CBT Worksheets</button>
        <button class="btn btn-outline" style="margin-bottom: 6px; color: #0f766e; border-color: #99f6e4; background: #f0fdfa;" onclick="printParticipantScoringByName('\\\${pName}')">🖨️ Print LS/CMI Score</button>
    \\\`;\`;

const newGamification = \`    // Case Planning
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

if (appJs.includes('openCaseReviewModal')) {
    appJs = appJs.replace(oldGamification, newGamification);
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Fixed app.js case plan buttons");
}
