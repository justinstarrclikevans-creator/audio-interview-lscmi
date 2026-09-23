const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// 1. Update openCorrectionModal
js = js.replace(
    /document\.getElementById\('pc-notes'\)\.value = p\.correction_notes \|\| '';/g,
    `document.getElementById('pc-notes').value = p.correction_notes || '';
    document.getElementById('pc-record-id').value = p.record_id || '';
    document.getElementById('pc-ssn').value = p.ssn || '';
    document.getElementById('pc-birthdate').value = p.birthdate || '';
    document.getElementById('pc-address').value = p.address || '';`
);

// 2. Update submitParticipantCorrection payload
js = js.replace(
    /w9Status: document\.getElementById\('pc-w9-status'\)\.value/g,
    `w9Status: document.getElementById('pc-w9-status').value,
        recordId: document.getElementById('pc-record-id').value,
        ssn: document.getElementById('pc-ssn').value,
        birthdate: document.getElementById('pc-birthdate').value,
        address: document.getElementById('pc-address').value`
);

fs.writeFileSync('public/app.js', js);
console.log('✅ Patched correction modal functions');
