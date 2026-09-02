const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_CONVERTER = path.join(__dirname, '..', 'convert_md_to_docx.py');

function convertSingleMdToDocx(mdPath, docxPath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(mdPath)) return resolve(false);
        const targetDocx = docxPath || mdPath.replace(/\.md$/, '.docx');
        
        exec(`python3 "${PYTHON_CONVERTER}" "${mdPath}" "${targetDocx}"`, (err, stdout, stderr) => {
            if (err) {
                console.error(`DOCX Conversion Error for ${mdPath}:`, stderr || err.message);
                return resolve(false);
            }
            console.log(`Generated DOCX: ${path.basename(targetDocx)}`);
            resolve(true);
        });
    });
}

module.exports = { convertSingleMdToDocx };
