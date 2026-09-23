const fs = require('fs');
let code = fs.readFileSync('public/index.html', 'utf8');

const badHtml = `                <div class="form-group">
                    <label>Upcoming Court Dates / Supervision Appointments</label>
                    <input type="text" id="bar-court-dates" placeholder="e.g. Probation meeting Oct 12, 10:00 AM">
                </div>`;

code = code.replace(badHtml, '');

const timestamp = Date.now();
code = code.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', code);
console.log('Removed court dates from index.html');
