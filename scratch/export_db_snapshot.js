const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app_database.sqlite');
const db = new Database(dbPath);

const tables = [
    'users',
    'participant_profiles',
    'gate_criteria',
    'daily_points',
    'documents',
    'resumes',
    'briefcase_items',
    'reentry_case_plans',
    'case_notes',
    'class_facilitation_evaluations',
    'drug_tests',
    'cm_briefcase_audits',
    'participant_benefits',
    'case_management_evaluations',
    'reentry_clients',
    'reentry_client_sessions',
    'reentry_client_goals',
    'reentry_client_agenda',
    'reentry_client_briefcase'
];

const snapshot = {};

for (const t of tables) {
    try {
        const rows = db.prepare(`SELECT * FROM "${t}"`).all();
        snapshot[t] = rows;
        console.log(`Table ${t}: ${rows.length} rows`);
    } catch (e) {
        console.warn(`Could not read ${t}:`, e.message);
    }
}

const outPath = path.join(__dirname, '..', 'data', 'database_seed_snapshot.json');
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
console.log(`\nSuccessfully exported snapshot to ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
