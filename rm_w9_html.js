const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// Use regex to remove modals. 
html = html.replace(/<!-- MODAL: Participant W-9 Form -->[\s\S]*?<!-- MODAL: W-9 View -->/g, '<!-- W9 Removed -->');
html = html.replace(/<!-- MODAL: W-9 View -->[\s\S]*?<!-- MODAL: Digital File Cabinet -->/g, '<!-- MODAL: Digital File Cabinet -->');
// Remove any w9-related badges or table elements if they exist
html = html.replace(/W-9 Status/gi, 'Status');

fs.writeFileSync('public/index.html', html);
console.log("✅ Removed W9 from index.html");
