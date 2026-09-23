const fs = require('fs');
let js = fs.readFileSync('skillcat_scraper.js', 'utf8');

js = js.replace(
    /console\.log\('✅ Updated DB for \$\{student\.name\} -> \$\{finalEngagement\}'\);/g,
    'console.log(`✅ Updated DB for ${student.name} -> ${finalEngagement}`);'
);
js = js.replace(
    /console\.log\('Finished updating \$\{updateCount\} records\.'\);/g,
    'console.log(`Finished updating ${updateCount} records.`);'
);

fs.writeFileSync('skillcat_scraper.js', js);
