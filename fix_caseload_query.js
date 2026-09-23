const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

const oldLoc = 'if (location) { query += ` AND u.location = ?`; params.push(location); }';
const newLoc = "if (location && location !== 'all') { query += ` AND u.location = ?`; params.push(location); }";

if (srv.includes(oldLoc)) {
    srv = srv.replace(oldLoc, newLoc);
    fs.writeFileSync('server.js', srv);
    console.log("✅ Fixed location filter");
}
