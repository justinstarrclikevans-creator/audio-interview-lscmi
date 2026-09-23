const fs = require('fs');
let code = fs.readFileSync('public/index.html', 'utf8');

// replace <script src="app.js"></script> with <script src="app.js?v=2"></script> (or current timestamp)
const timestamp = Date.now();
code = code.replace(/<script src="app\.js(\?v=\d+)?"/g, `<script src="app.js?v=${timestamp}"`);

fs.writeFileSync('public/index.html', code);
console.log('Cache busted app.js in index.html');
