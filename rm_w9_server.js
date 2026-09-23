const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

// Remove the endpoints using string replacement
srv = srv.replace(/\/\/ Official Form W-9 Submission[\s\S]*?res\.json\(\{ message: 'Official Form W-9 certified, recorded, and verified.', status: 'verified' \}\);\s*\n\}/, '');

srv = srv.replace(/\/\/ Fetch Stored W-9 Details \(Hardened & Resilient\)[\s\S]*?res\.status\(500\)\.json\(\{ error: 'Failed to retrieve W-9 details: ' \+ err\.message \}\);\s*\n\}\);/, '');

// Clean up w9_status in queries
srv = srv.replace(/, p\.w9_status/g, '');
srv = srv.replace(/p\.w9_status,/g, '');
srv = srv.replace(/w9Status,/g, '');
srv = srv.replace(/w9_status = COALESCE\(\?, w9_status\),/g, '');
srv = srv.replace(/w9Status !== undefined && w9Status !== '' \? w9Status : null,/g, '');
srv = srv.replace(/md \+\= `- \*\*W-9 & Identity Verification:\*\* \${.*?}\\n\\n`;/g, '');

fs.writeFileSync('server.js', srv);
console.log("✅ Removed W9 from server.js");
