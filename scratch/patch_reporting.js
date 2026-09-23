const fs = require('fs');
let js = fs.readFileSync('reporting_engine.js', 'utf8');

// Replace all occurrences of the findUserStmt
const oldQuery = `SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(name) LIKE ? LIMIT 1`;
const newQuery = `SELECT u.id FROM users u LEFT JOIN participant_profiles p ON u.id = p.user_id WHERE LOWER(u.email) = ? OR LOWER(u.name) LIKE ? OR p.record_id = ? LIMIT 1`;

js = js.replace(/SELECT id FROM users WHERE LOWER\(email\) = \? OR LOWER\(name\) LIKE \? LIMIT 1/g, newQuery);

// And we need to pass the identifier three times instead of two
js = js.replace(/findUserStmt\.get\(identifier, `%\$\{identifier\}%`\)/g, 'findUserStmt.get(identifier, `%${identifier}%`, identifier)');

fs.writeFileSync('reporting_engine.js', js);
console.log('✅ Patched CSV import match logic');
