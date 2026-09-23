const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// Find the section containing rn-plan-notes-container and remove it
const sectionRegex = /<!-- Recent Case Management Notes -->\s*<div class="section-card" style="margin-bottom: 20px;">[\s\S]*?<div id="rn-plan-notes-container"[\s\S]*?<\/div>\s*<\/div>/;
html = html.replace(sectionRegex, '');

// Also search for the HTML if it doesn't have the exact comment
const fallbackRegex = /<div class="section-card"[^>]*>[\s\S]*?<h3[^>]*>📝 Recent Case Management Notes & Updates<\/h3>[\s\S]*?<div id="rn-plan-notes-container"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
html = html.replace(fallbackRegex, '');

// Cache buster
const timestamp = Date.now();
html = html.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', html);

let js = fs.readFileSync('public/app.js', 'utf8');

const jsRegex = /\/\/ 5\. Recent Case Notes[\s\S]*?const notesContainer = document\.getElementById\('rn-plan-notes-container'\);[\s\S]*?\}\s*\}\s*\}/;
js = js.replace(jsRegex, '}');

// Try a more robust regex if that failed
const jsFallback = /const notesContainer = document\.getElementById\('rn-plan-notes-container'\);[\s\S]*?\}\s*\}\s*\}/;
js = js.replace(jsFallback, '}');

// Just in case, let's specifically wipe the contents of the render block
js = js.replace(
    /const notesContainer = document\.getElementById\('rn-plan-notes-container'\);[\s\S]*?`\)\.join\(''\);\s*\}\s*\}/,
    ''
);

fs.writeFileSync('public/app.js', js);
console.log('Removed participant access to case notes');
