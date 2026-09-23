const fs = require('fs');

// 1. Fix server.js
let srv = fs.readFileSync('server.js', 'utf8');

// Fix /api/participant/gate-item
srv = srv.replace(
    /if \(\(req\.user\.role === 'program_manager' \|\| req\.user\.role === 'admin'\) && req\.body\.userId\) \{/g,
    "if (req.user.role !== 'participant' && req.body.userId) {"
);

// Fix /api/participant/briefcase-item
srv = srv.replace(
    /app\.post\('\/api\/participant\/briefcase-item', authenticateToken, \(req, res\) => \{\n    const userId = req\.user\.id;/g,
    "app.post('/api/participant/briefcase-item', authenticateToken, (req, res) => {\n    let userId = req.user.id;\n    if (req.user.role !== 'participant' && req.body.userId) {\n        userId = parseInt(req.body.userId, 10);\n    }"
);

// Fix roles on advance-gate and update-skillcat
srv = srv.replace(
    /requireRole\('program_manager', 'admin', 'director'\)/g,
    "requireRole('program_manager', 'admin', 'director', 'staff', 'facilitator')"
);

fs.writeFileSync('server.js', srv);
console.log('✅ server.js patched');

// 2. Fix app.js
let js = fs.readFileSync('public/app.js', 'utf8');

// Fix saveModalGateItem
js = js.replace(
    /if \(currentGateModalRole === 'program_manager' \|\| currentGateModalRole === 'admin'\) \{/g,
    "if (currentGateModalRole !== 'participant') {"
);

// Fix advanceParticipantGate confirm reset
js = js.replace(
    /if \(!confirm\(`Advance this participant to Gate \$\{nextGate\}\?`\)\) return;/g,
    "if (!confirm(`Advance this participant to Gate ${nextGate}?`)) { loadCaseload(); return; }"
);

fs.writeFileSync('public/app.js', js);
console.log('✅ app.js patched');

