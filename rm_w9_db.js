const fs = require('fs');
let dbJs = fs.readFileSync('db.js', 'utf8');

dbJs = dbJs.replace(/w9_status TEXT DEFAULT 'pending', -- 'pending', 'submitted', 'verified'\n/g, '');

fs.writeFileSync('db.js', dbJs);
console.log("✅ Removed W9 from db.js");
