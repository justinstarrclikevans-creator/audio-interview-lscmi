const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

const regex = /\/\/ Fallback to index\.html for SPA \/ client routes\napp\.use\(\(req, res, next\) => \{\n    if \(req\.method === 'GET' && !req\.path\.startsWith\('\/api\/'\) && !req\.path\.startsWith\('\/data\/'\)\) \{\n        res\.sendFile\(path\.join\(__dirname, 'public', 'index\.html'\)\);\n    \} else \{\n        next\(\);\n    \}\n\}\);\n\n/;

// Replace only the FIRST occurrence
srv = srv.replace(regex, '');

fs.writeFileSync('server.js', srv);
console.log('✅ Removed duplicate fallback route.');
