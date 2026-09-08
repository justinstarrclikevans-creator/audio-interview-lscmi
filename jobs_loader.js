// Jobs Spreadsheet Loader & Parser
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
let XLSX = null;
try {
    XLSX = require('xlsx');
} catch (e) {
    // xlsx may not be present in some lean environments
}

const PARSER_SCRIPT = path.join(__dirname, 'parse_jobs.py');

function parseJobsWithNode() {
    if (!XLSX) return [];
    const searchDirs = [
        path.join(__dirname, '..', 'Facilitation Scoring'),
        path.join(__dirname, 'data'),
        path.join(__dirname, '..')
    ];

    const foundFiles = [];
    for (const d of searchDirs) {
        if (fs.existsSync(d)) {
            const files = fs.readdirSync(d);
            for (const f of files) {
                if ((f.toLowerCase().includes('job') || f.toLowerCase().includes('employer')) && f.endsWith('.xlsx')) {
                    foundFiles.push(path.join(d, f));
                }
            }
        }
    }

    const jobs = [];
    const seen = new Set();

    for (const filePath of foundFiles) {
        try {
            const workbook = XLSX.readFile(filePath);
            for (const sheetName of workbook.SheetNames) {
                if (sheetName.toLowerCase().includes('research') || sheetName.toLowerCase().includes('note')) {
                    continue;
                }
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.length === 0 || !row.some(cell => cell !== undefined && cell !== null && String(cell).trim() !== '')) {
                        continue;
                    }
                    const company = (row[0] && String(row[0]).trim()) || 'Local Employer';
                    const jobTitle = (row[1] && String(row[1]).trim()) || 'Specialist';
                    const location = (row[2] && String(row[2]).trim()) || 'Columbia, SC';
                    let payRate = (row[3] && String(row[3]).trim()) || 'Competitive';
                    const description = (row[4] && String(row[4]).trim()) || '';
                    const careersUrl = (row[6] && String(row[6]).trim()) || '';

                    if (['none', 'not disclosed', 'null'].includes(payRate.toLowerCase())) {
                        payRate = 'Competitive / Market Rate';
                    }

                    const key = `${company.toLowerCase()}|${jobTitle.toLowerCase()}|${location.toLowerCase()}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    jobs.push({
                        company,
                        jobTitle,
                        location,
                        payRate,
                        description,
                        careersUrl,
                        sourceFile: path.basename(filePath)
                    });
                }
            }
        } catch (e) {
            console.error(`Error reading ${filePath} via node xlsx:`, e.message);
        }
    }
    return jobs;
}

function loadJobsFromSpreadsheets() {
    try {
        const output = execSync(`python3 "${PARSER_SCRIPT}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const parsed = JSON.parse(output || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
        }
    } catch (err) {
        // Python execution failed, fallback to node xlsx
    }
    return parseJobsWithNode();
}

module.exports = { loadJobsFromSpreadsheets };

