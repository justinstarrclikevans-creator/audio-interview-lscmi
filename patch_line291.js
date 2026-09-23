const fs = require('fs');
let lines = fs.readFileSync('public/app.js', 'utf8').split('\n');

// Find the line that has the old replacement and remove it to clean up the mess
lines = lines.filter(l => !l.includes('const safeName ='));
let idx = lines.findIndex(l => l.includes('Complete Health Screen (Required)</button>`'));
if (idx > -1) {
    lines[idx] = "                const safeName = (data.profile.name || '').replace(new RegExp(\"'\", 'g'), \"\\\\'\");\n                healthContainer.innerHTML = `<button class=\"btn btn-outline\" style=\"background: #fee2e2; border-color: #ef4444; color: #b91c1c; font-weight: bold; animation: pulse 2s infinite;\" onclick=\"openHealthScreenModal(${data.profile.user_id}, '${safeName}')\">⚠️ Complete Health Screen (Required)</button>`;";
}

fs.writeFileSync('public/app.js', lines.join('\n'));
