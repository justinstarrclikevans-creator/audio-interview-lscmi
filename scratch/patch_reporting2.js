const fs = require('fs');
let js = fs.readFileSync('reporting_engine.js', 'utf8');

js = js.replace(
    'const findUserStmt = db.prepare(`SELECT id FROM users WHERE LOWER(name) LIKE ? OR LOWER(name) LIKE ? LIMIT 1`);',
    'const findUserStmt = db.prepare(`SELECT u.id FROM users u LEFT JOIN participant_profiles p ON u.id = p.user_id WHERE LOWER(u.name) LIKE ? OR LOWER(u.name) LIKE ? OR p.record_id = ? LIMIT 1`);'
);

js = js.replace(
    /const user = findUserStmt\.get\(`%\$\{first\} \$\{last\}%`, `%\$\{first\}%`\);/g,
    'const user = findUserStmt.get(`%${first} ${last}%`, `%${first}%`, last || first); // fallback to matching by record_id'
);

fs.writeFileSync('reporting_engine.js', js);
console.log('✅ Patched Unified Render Report logic');
