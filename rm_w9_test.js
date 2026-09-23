const fs = require('fs');
let tst = fs.readFileSync('test_unified_system.js', 'utf8');

tst = tst.replace(/db\.prepare\(\`UPDATE gate_criteria SET status = 'green' WHERE user_id = \? AND criterion_key = 'w1_w9_id'\`\)\.run\(fsUserId\);\n/g, '');
tst = tst.replace(/\/\/ Test 4: W-9 Submission[\s\S]*?console\.log\('       - W-9 digitally recorded and status updated to verified'\);\n/g, '');

fs.writeFileSync('test_unified_system.js', tst);
console.log("✅ Removed W9 from test file");
