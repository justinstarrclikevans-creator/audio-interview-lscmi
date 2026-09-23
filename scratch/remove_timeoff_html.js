const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Remove PM Time-Off Button
html = html.replace(
    /<button class="btn btn-outline" style="border-radius: 0; border: none; border-left: 1px solid var\(--border\); font-size: 12px; padding: 7px 11px;" onclick="openPmTimeOffModal\(\)" title="Review Participant Time-Off Requests">\s*📅 Time-Off\s*<\/button>/g,
    ''
);

// 2. Remove modal-time-off-request
html = html.replace(/<!-- Modal: Participant Time-Off Request \(48-Hour Notice Enforced\) -->[\s\S]*?<\/div>\s*<\/div>/, '');

// 3. Remove modal-pm-time-off
html = html.replace(/<!-- Modal: Program Manager Time-Off Review Queue -->[\s\S]*?<\/div>\s*<\/div>/, '');

// Cache buster
const timestamp = Date.now();
html = html.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', html);
console.log('Removed time-off HTML');
