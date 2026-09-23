const fs = require('fs');

let s = fs.readFileSync('skillcat_scraper.js', 'utf8');

// Fix the template literals which were accidentally escaped in a previous rewrite
s = s.replace(/\\\$\{student\.name\}/g, '${student.name}');
s = s.replace(/\\\$\{finalEngagement\}/g, '${finalEngagement}');
s = s.replace(/\\\$\{updateCount\}/g, '${updateCount}');

// Remove the HTML dump I added
s = s.replace(/const html = await page\.content\(\); require\("fs"\)\.writeFileSync\("skillcat_debug\.html", html\);/, '');

// Make sure the 10 second timeout is kept, but maybe change it to 5 seconds to be a bit faster
s = s.replace(/await new Promise\(r => setTimeout\(r, 10000\)\);/, 'await new Promise(r => setTimeout(r, 6000));');

fs.writeFileSync('skillcat_scraper.js', s);
console.log('✅ skillcat_scraper.js fixed!');
