const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

const oldFunc = \`function startReentryAssessmentForUser(userId, name) {
    switchPmSubView('reentry');
    const select = document.getElementById('reentry-participant-select');
    if (select) {
        select.value = userId;
        handleReentryParticipantSelect();
    }
}\`;

const newFunc = \`function startReentryAssessmentForUser(userId, name) {
    closeModal('modal-participant-file');
    switchPmSubView('reentry');
    const select = document.getElementById('reentry-participant-select');
    if (select) {
        select.value = userId;
        handleReentryParticipantSelect();
    }
}\`;

if (appJs.includes(oldFunc)) {
    appJs = appJs.replace(oldFunc, newFunc);
    fs.writeFileSync('public/app.js', appJs);
    console.log("✅ Fixed startReentryAssessmentForUser");
}
