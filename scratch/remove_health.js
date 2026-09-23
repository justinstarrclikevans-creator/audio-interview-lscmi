const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

const regex = /const healthContainer = document\.getElementById\('fs-health-screen-container'\);\s+if \(healthContainer\) \{[\s\S]*?\} else \{\s+healthContainer\.innerHTML = '';\s+\}\s+\}/;
code = code.replace(regex, '');

fs.writeFileSync('public/app.js', code);

let html = fs.readFileSync('public/index.html', 'utf8');
html = html.replace('<div id="fs-health-screen-container"></div>', '');

const timestamp = Date.now();
html = html.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');
fs.writeFileSync('public/index.html', html);

console.log('Removed health screen from dashboard');
