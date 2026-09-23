const fs = require('fs');

let js = fs.readFileSync('public/app.js', 'utf8');

js = js.replace(
    "const statusFilter = document.getElementById('pm-filter-status');\n    const titleEl = document.getElementById('caseload-title');",
    "const trackFilter = document.getElementById('pm-filter-track');\n    const statusFilter = document.getElementById('pm-filter-status');\n    if (statusFilter) statusFilter.value = '';\n    const titleEl = document.getElementById('caseload-title');"
);

js = js.replace(
    "if (statusFilter) statusFilter.value = 'active';",
    "if (trackFilter) trackFilter.value = 'first_shift';"
);

js = js.replace(
    "if (statusFilter) statusFilter.value = 'reentry_nav_stabilizing';",
    "if (trackFilter) trackFilter.value = 'reentry_nav';"
);

fs.writeFileSync('public/app.js', js);
console.log('Patched app.js to correctly filter caseload by track');
