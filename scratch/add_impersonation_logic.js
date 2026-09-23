const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

const logic = `
// =========================================================
// IMPERSONATION LOGIC
// =========================================================

function checkImpersonation() {
    const staffToken = localStorage.getItem('staff_token');
    const banner = document.getElementById('impersonation-banner');
    if (staffToken && banner) {
        banner.classList.remove('hidden');
    }
}

function endImpersonation() {
    const staffToken = localStorage.getItem('staff_token');
    if (staffToken) {
        localStorage.setItem('fs_token', staffToken);
        localStorage.removeItem('staff_token');
        window.location.reload();
    }
}
`;

code = code.replace(
    "document.addEventListener('DOMContentLoaded', async () => {",
    logic + "\n\ndocument.addEventListener('DOMContentLoaded', async () => {\n    checkImpersonation();"
);

fs.writeFileSync('public/app.js', code);
console.log('Added impersonation UI logic to app.js');
