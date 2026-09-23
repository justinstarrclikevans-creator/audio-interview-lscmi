const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

const regex = /const data = await res\.json\(\);\s+currentGateModalWeeks = data\.weeks;/;
const replacement = `
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch gates');
        
        currentGateModalWeeks = data.weeks;
`;

code = code.replace(regex, replacement.trim() + '\n');
fs.writeFileSync('public/app.js', code);
console.log('Patched openGateChecklistModal to throw on API error');
