const db = require('better-sqlite3')('data/app_database.sqlite');
const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE track = 'reentry_nav'").get();
console.log('Reentry Nav count:', count.c);
