const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    "SELECT COUNT(*) as c FROM health_wellness_screen WHERE user_id = ?",
    "SELECT COUNT(*) as c FROM health_wellness_screen WHERE participant_id = ?"
);

fs.writeFileSync('server.js', code);
console.log('Fixed health_wellness_screen user_id to participant_id');
