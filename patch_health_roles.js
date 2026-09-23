const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

srv = srv.replace(
    /if \(req\.user\.role !== 'program_manager' && req\.user\.role !== 'admin' && req\.user\.role !== 'director'\) \{/g,
    "if (req.user.role === 'participant') {"
);

fs.writeFileSync('server.js', srv);
console.log('✅ server.js patched for health roles');
