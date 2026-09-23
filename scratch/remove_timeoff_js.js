const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

const regex = /\/\/ -------------------------------------------------------------\n\/\/ TIME-OFF REQUESTS & PM REVIEW QUEUE\n\/\/ -------------------------------------------------------------[\s\S]*?(?=\/\/ -------------------------------------------------------------\n\/\/ WEEKLY POINTS BREAKDOWN MODAL)/;

js = js.replace(regex, '');

fs.writeFileSync('public/app.js', js);
console.log('Removed time-off logic from app.js');
