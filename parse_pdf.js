const fs = require('fs');
const pdfText = fs.readFileSync('Prepare for Import - Apricot.pdf', 'utf8');

// The pdf is binary but we can extract strings, or we can just use the questions I've manually listed.
// Actually, it's better I just write the JSON file manually using the list I've compiled.
