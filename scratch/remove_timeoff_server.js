const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const regex = /\/\/ Participant Time-Off Request \(Enforcing 48-Hour Advance Notice\)[\s\S]*?(?=\/\/ Detailed Weekly Points Breakdown for a Participant)/;

server = server.replace(regex, '');

fs.writeFileSync('server.js', server);
console.log('Removed time-off endpoints from server.js');
