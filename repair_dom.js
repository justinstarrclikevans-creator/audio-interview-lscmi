const fs = require('fs');

// 1. Repair index.html
let html = fs.readFileSync('public/index.html', 'utf8');

// Extract the two modals that were accidentally placed outside or near the end
const gateModalMatch = html.match(/<!-- Gate Checklist Modal -->[\s\S]*?(?=<!-- Health Screen Modal -->)/);
const healthModalMatch = html.match(/<!-- Health Screen Modal -->[\s\S]*?(?=<\/body>)/);

let gateModal = gateModalMatch ? gateModalMatch[0] : '';
let healthModal = healthModalMatch ? healthModalMatch[0] : '';

// Ensure health modal has 'hidden' class
healthModal = healthModal.replace('class="modal"', 'class="modal hidden"');

// Strip out everything from the first Gate Checklist Modal to the end of the file
html = html.replace(/<!-- Gate Checklist Modal -->[\s\S]*$/, '');

// Find the script tag and inject the modals right before it
html = html.replace('<script src="app.js?v=1790163980825"></script>', `${gateModal}\n${healthModal}\n\n    <script src="app.js?v=1790163980825"></script>\n</body>\n</html>`);

fs.writeFileSync('public/index.html', html);
console.log('✅ Repaired index.html');

// 2. Repair app.js
let js = fs.readFileSync('public/app.js', 'utf8');
js = js.replace("document.getElementById('modal-health-screen').style.display = 'block';", "openModal('modal-health-screen');");
fs.writeFileSync('public/app.js', js);
console.log('✅ Repaired app.js');
