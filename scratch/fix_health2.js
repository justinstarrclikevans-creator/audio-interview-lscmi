const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
    "(SELECT COUNT(*) FROM health_wellness_screen WHERE user_id = u.id) as has_health_screen",
    "(SELECT COUNT(*) FROM health_wellness_screen WHERE participant_id = u.id) as has_health_screen"
);

fs.writeFileSync('server.js', code);
console.log('Fixed health_wellness_screen user_id on line 747');
