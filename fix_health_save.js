const fs = require('fs');

let appJs = fs.readFileSync('public/app.js', 'utf8');

const oldCode = `            if (document.getElementById('view-caseload').classList.contains('active')) {
                loadCaseload();
            } else if (document.getElementById('view-participant-dashboard').classList.contains('active')) {
                loadParticipantDashboard();
            }`;

const newCode = `            if (document.getElementById('view-pm-portal') && !document.getElementById('view-pm-portal').classList.contains('hidden')) {
                loadCaseload();
            } else if (document.getElementById('view-fs-portal') && !document.getElementById('view-fs-portal').classList.contains('hidden')) {
                loadFsDashboard();
            }`;

if (appJs.includes(oldCode)) {
    appJs = appJs.replace(oldCode, newCode);
    fs.writeFileSync('public/app.js', appJs);
    console.log('✅ Fixed health save view refresh.');
} else {
    console.log('❌ Could not find old code block.');
}
