const fs = require('fs');
let appJs = fs.readFileSync('public/app.js', 'utf8');

appJs = appJs.replace(/>▶ View PII</g, '>▶ View Personal Information<');
appJs = appJs.replace(/>✏️ Fix</g, '>✏️ Update<');

fs.writeFileSync('public/app.js', appJs);
console.log("✅ Fixed UI text");
