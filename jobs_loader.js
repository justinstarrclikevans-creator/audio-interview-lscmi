// Jobs Spreadsheet Loader & Parser
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PARSER_SCRIPT = path.join(__dirname, 'parse_jobs.py');

function loadJobsFromSpreadsheets() {
    try {
        const output = execSync(`python3 "${PARSER_SCRIPT}"`, { encoding: 'utf8' });
        return JSON.parse(output || '[]');
    } catch (err) {
        console.error('Failed to parse jobs spreadsheet:', err.message);
        return [];
    }
}

module.exports = { loadJobsFromSpreadsheets };
