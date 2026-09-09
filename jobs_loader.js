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

function categorizeMetro(loc) {
    const l = (loc || '').toLowerCase();
    if (l.includes('columbia') || l.includes('cayce') || l.includes('lexington') || l.includes('irmo') || l.includes('midlands') || l.includes('richland')) return 'columbia';
    if (l.includes('spartanburg') || l.includes('duncan') || l.includes('greer') || l.includes('roebuck') || l.includes('lyman') || l.includes('greenville') || l.includes('upstate')) return 'spartanburg';
    if (l.includes('charleston') || l.includes('ladson') || l.includes('summerville') || l.includes('hanahan') || l.includes('johns island') || l.includes('berkeley') || l.includes('dorchester') || l.includes('goose creek')) return 'charleston';
    return 'statewide';
}

function buildGoogleJobsUrl(query = '', location = 'South Carolina') {
    const qParts = [];
    if (query && query.trim()) qParts.push(query.trim());
    qParts.push('fair chance second chance jobs in');
    qParts.push(location);
    return `https://www.google.com/search?ibp=htl;jobs&q=${encodeURIComponent(qParts.join(' '))}`;
}

function buildGoogleSearchUrl(company = '', role = '', location = 'South Carolina') {
    const query = `${company} ${role} jobs ${location} fair chance hiring`.trim();
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

let cachedJobsPool = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getAllReentryJobs(options = {}) {
    const now = Date.now();
    if (!cachedJobsPool || (now - lastCacheTime > CACHE_TTL_MS) || options.forceRefresh) {
        let scDirectoryEmployers = [];
        try {
            const { SC_FAIR_CHANCE_EMPLOYERS } = require('./sc_resource_directory');
            if (Array.isArray(SC_FAIR_CHANCE_EMPLOYERS)) {
                scDirectoryEmployers = SC_FAIR_CHANCE_EMPLOYERS;
            }
        } catch (e) {
            console.warn('Unable to load sc_resource_directory for jobs:', e.message);
        }

        const sheetJobs = loadJobsFromSpreadsheets();
        const all = [];
        const seen = new Set();

        // 1. Ingest spreadsheet jobs
        sheetJobs.forEach((j, i) => {
            const comp = (j.company || '').trim();
            if (!comp || comp.toLowerCase().includes('turn90') || comp.toLowerCase().includes('turn ninety')) return;
            const role = j.jobTitle || j.role || 'Specialist';
            const loc = j.location || 'Charleston, SC';
            const key = `${comp.toLowerCase()}_${role.toLowerCase()}_${loc.toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);

            const metro = categorizeMetro(loc);
            all.push({
                id: `sheet_${i + 1}`,
                role: role,
                jobTitle: role,
                company: comp,
                location: loc,
                metro: metro,
                pay: j.payRate || 'Competitive / Market Rate',
                payRate: j.payRate || 'Competitive / Market Rate',
                shift: j.shift || '1st Shift / Full-Time',
                description: j.description || 'Verified employer offering competitive fair-chance placement in South Carolina.',
                careersUrl: j.careersUrl || buildGoogleJobsUrl(role, loc),
                googleSearchUrl: buildGoogleSearchUrl(comp, role, loc),
                googleJobsUrl: buildGoogleJobsUrl(`${comp} ${role}`, loc),
                source: j.sourceFile ? `Spreadsheet (${j.sourceFile})` : 'Verified Employer Spreadsheet',
                sourceType: 'spreadsheet',
                phone: j.phone || '',
                address: j.address || ''
            });
        });

        // 2. Ingest Fair-Chance Directory & Search findings
        scDirectoryEmployers.forEach((e, idx) => {
            const comp = (e.company || '').trim();
            if (!comp || comp.toLowerCase().includes('turn90') || comp.toLowerCase().includes('turn ninety')) return;
            const roles = Array.isArray(e.roles) ? e.roles : (e.typicalRoles ? [e.typicalRoles] : ['Specialist']);
            const loc = e.location || 'South Carolina';
            const metro = e.region ? e.region.toLowerCase() : categorizeMetro(loc);

            roles.forEach((role, rIdx) => {
                const key = `${comp.toLowerCase()}_${role.toLowerCase()}_${loc.toLowerCase()}`;
                if (seen.has(key)) return;
                seen.add(key);

                const descParts = [];
                if (e.felonyPolicy) descParts.push(e.felonyPolicy);
                if (e.industries && e.industries.length) descParts.push(`Industries: ${e.industries.join(', ')}.`);
                if (e.benefits) descParts.push(`Benefits: ${e.benefits}.`);

                all.push({
                    id: `fc_${idx + 1}_${rIdx + 1}`,
                    role: role,
                    jobTitle: role,
                    company: comp,
                    location: loc,
                    metro: metro,
                    pay: e.payRate || 'Competitive / Market Rate',
                    payRate: e.payRate || 'Competitive / Market Rate',
                    shift: e.shift || '1st Shift (Day)',
                    description: descParts.join(' ') || 'Second-chance supportive partner with fair-chance hiring pathways.',
                    careersUrl: e.careersUrl || buildGoogleJobsUrl(role, loc),
                    googleSearchUrl: buildGoogleSearchUrl(comp, role, loc),
                    googleJobsUrl: buildGoogleJobsUrl(`${comp} ${role}`, loc),
                    source: 'Verified Fair-Chance Partner',
                    sourceType: 'fair_chance_directory',
                    contact: e.immediateContact || '',
                    phone: e.immediateContact && e.immediateContact.includes('(') ? e.immediateContact : ''
                });
            });
        });

        cachedJobsPool = all;
        lastCacheTime = now;
    }

    let results = cachedJobsPool || [];

    // Filter by location/metro if requested
    if (options.location && options.location !== 'all') {
        const loc = options.location.toLowerCase().trim();
        results = results.filter(j => {
            if (j.metro === loc) return true;
            const jl = (j.location || '').toLowerCase();
            if (loc === 'charleston') {
                return jl.includes('charleston') || jl.includes('ladson') || jl.includes('summerville') || jl.includes('hanahan') || jl.includes('johns island') || jl.includes('berkeley') || jl.includes('dorchester') || jl.includes('goose creek');
            }
            if (loc === 'columbia') {
                return jl.includes('columbia') || jl.includes('cayce') || jl.includes('lexington') || jl.includes('irmo') || jl.includes('forest acres') || jl.includes('midlands') || jl.includes('richland');
            }
            if (loc === 'spartanburg') {
                return jl.includes('spartanburg') || jl.includes('duncan') || jl.includes('greer') || jl.includes('roebuck') || jl.includes('lyman') || jl.includes('greenville') || jl.includes('upstate');
            }
            return jl.includes(loc);
        });
    }

    // Filter by text search query if provided
    if (options.query && options.query.trim()) {
        const qWords = options.query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
        if (qWords.length > 0) {
            results = results.filter(j => {
                const haystack = `${j.company} ${j.role} ${j.jobTitle} ${j.description} ${j.location}`.toLowerCase();
                return qWords.some(w => haystack.includes(w));
            });
        }
    }

    if (options.limit && Number.isInteger(options.limit) && options.limit > 0) {
        return results.slice(0, options.limit);
    }

    return results;
}

module.exports = {
    loadJobsFromSpreadsheets,
    getAllReentryJobs,
    categorizeMetro,
    buildGoogleJobsUrl,
    buildGoogleSearchUrl
};


