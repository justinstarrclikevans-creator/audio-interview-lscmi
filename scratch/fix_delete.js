const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    'db.prepare(\'DELETE FROM users WHERE id = ? AND role = "participant"\').run(userId);',
    'db.prepare(\"DELETE FROM users WHERE id = ? AND role = \'participant\'\").run(userId);'
);

fs.writeFileSync('server.js', code);
console.log('Fixed SQL syntax in delete endpoint');
