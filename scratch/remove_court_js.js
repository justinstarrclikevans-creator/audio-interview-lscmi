const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

code = code.replace("document.getElementById('bar-court-dates').value = currentProfile.court_dates || '';", "");
code = code.replace("court_dates: document.getElementById('bar-court-dates').value", "");
// Note: removing line 717 leaves a trailing comma on line 716, let me fix it
code = code.replace(
    "transportation_status: document.getElementById('bar-trans-status').value,\n        ",
    "transportation_status: document.getElementById('bar-trans-status').value\n        "
);

fs.writeFileSync('public/app.js', code);
console.log('Removed court_dates from app.js');
