const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

// Remove submitW9
app = app.replace(/async function submitW9\(e\) \{[\s\S]*?alert\('W-9 Submission Error: ' \+ err\.message\);\n    \}\n\}/, '');

// Remove openW9ViewModal
app = app.replace(/\/\/ W-9 VIEWER & PARTICIPANT CASE PLAN VIEWER[\s\S]*?body\.innerHTML = '<p class="text-danger">Failed to load W-9 details: ' \+ e\.message \+ '<\/p>';\n    \}\n\}/, '');

// Remove w9 counts
app = app.replace(/<div><strong>\$\{data\.needsBreakdown\.w9Pending\}<\/strong> W-9 Submissions Missing<\/div>/g, '');

// Clean up W-9 Assistant strings
app = app.replace(/like <strong>Form I-9<\/strong> or <strong>W-9<\/strong>, /g, '');

fs.writeFileSync('public/app.js', app);
console.log("✅ Removed W9 from app.js");
