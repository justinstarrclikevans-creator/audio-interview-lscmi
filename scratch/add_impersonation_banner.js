const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

const bannerHtml = `
    <!-- Impersonation Banner -->
    <div id="impersonation-banner" class="hidden" style="background-color: #ef4444; color: white; text-align: center; padding: 10px; font-weight: bold; font-size: 14px; z-index: 9999; position: relative;">
        🕵️‍♀️ You are currently viewing as a Participant. 
        <button onclick="endImpersonation()" style="margin-left: 10px; padding: 4px 10px; background: white; color: #ef4444; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">Return to Staff Dashboard</button>
    </div>
`;

html = html.replace('<body>', '<body>' + bannerHtml);

const timestamp = Date.now();
html = html.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', html);
console.log('Added impersonation banner to index.html');
