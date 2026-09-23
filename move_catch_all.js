const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

// Find the catch-all block
const catchAllRegex = /\/\/ Catch-all for undefined API routes - ALWAYS return JSON, NEVER HTML[\s\S]*?\n\n/g;

let catchAllBlock = '';
srv = srv.replace(catchAllRegex, (match) => {
    catchAllBlock = match;
    return ''; // Remove it from its current position
});

// Now we need to insert it right before the runCaseloadMigration IIFE or module.exports
// Let's look for "const runCaseloadMigration = async () => {"
if (catchAllBlock) {
    srv = srv.replace('const runCaseloadMigration = async () => {', catchAllBlock + '\nconst runCaseloadMigration = async () => {');
    fs.writeFileSync('server.js', srv);
    console.log('✅ Moved catch-all route to the bottom of the routes.');
} else {
    console.log('❌ Could not find catch-all block!');
}

