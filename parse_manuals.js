const fs = require('fs');
const pdf = require('pdf-parse');
const path = require('path');

const pdfDir = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'manuals');

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
}

const filesToParse = [
    'Case Brief Template.pdf',
    'Interview Guide.pdf',
    'Scoring Form.pdf',
    'Scoring Manual.pdf'
];

async function parseAll() {
    for (const file of filesToParse) {
        const filePath = path.join(pdfDir, file);
        if (fs.existsSync(filePath)) {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdf(dataBuffer);
            const textPath = path.join(outDir, file.replace('.pdf', '.txt'));
            fs.writeFileSync(textPath, data.text);
            console.log(`Parsed ${file} -> ${data.text.length} characters`);
        } else {
            console.error(`Missing file: ${filePath}`);
        }
    }
}

parseAll().catch(console.error);
