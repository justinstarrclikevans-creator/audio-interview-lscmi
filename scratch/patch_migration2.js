const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    'console.log("Migration: Cleaned up old/deprecated gate criteria");',
    `console.log("Migration: Cleaned up old/deprecated gate criteria");
            db.prepare("DELETE FROM gate_criteria WHERE criterion_key LIKE '%skillcat%' AND user_id IN (SELECT id FROM users WHERE track = 'reentry_nav')").run();
            console.log("Migration: Removed SkillCat gates for Reentry Nav participants");`
);

fs.writeFileSync('server.js', code);
console.log('Patched runGateCleanup');
