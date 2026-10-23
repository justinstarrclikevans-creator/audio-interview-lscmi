const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app_database.sqlite');
const db = new Database(dbPath);

console.log('[Purge] Starting removal of sample clients and test accounts...');

const demoClientIds = [2, 3, 4];
const demoUserIds = [57, 65];

db.transaction(() => {
    // 1. Delete Reentry Client associations
    for (const cid of demoClientIds) {
        db.prepare('DELETE FROM reentry_client_goals WHERE client_id = ?').run(cid);
        db.prepare('DELETE FROM reentry_client_briefcase WHERE client_id = ?').run(cid);
        db.prepare('DELETE FROM reentry_client_agenda WHERE client_id = ?').run(cid);
        db.prepare('DELETE FROM reentry_client_sessions WHERE client_id = ?').run(cid);
        db.prepare('DELETE FROM reentry_clients WHERE id = ?').run(cid);
        console.log(`[Purge] Removed demo reentry_client ID ${cid}`);
    }

    // 2. Delete test users and all child table references
    const userTables = [
        ['participant_profiles', 'user_id'],
        ['gate_criteria', 'user_id'],
        ['daily_points', 'user_id'],
        ['documents', 'user_id'],
        ['resumes', 'user_id'],
        ['briefcase_items', 'user_id'],
        ['reentry_case_plans', 'user_id'],
        ['case_notes', 'user_id'],
        ['drug_tests', 'user_id'],
        ['cm_briefcase_audits', 'user_id'],
        ['participant_benefits', 'user_id'],
        ['health_wellness_screen', 'user_id'],
        ['weekly_stability_checks', 'user_id'],
        ['cbt_submissions', 'user_id'],
        ['time_off_requests', 'user_id'],
        ['saved_job_applications', 'user_id'],
        ['case_plan_triggers', 'user_id'],
        ['training_progress', 'user_id'],
        ['weekly_case_reviews', 'user_id']
    ];

    for (const uid of demoUserIds) {
        for (const [table, col] of userTables) {
            try {
                db.prepare(`DELETE FROM "${table}" WHERE "${col}" = ?`).run(uid);
            } catch (err) {
                // Table might not exist or be empty
            }
        }
        try {
            db.prepare('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?').run(uid, uid);
        } catch (e) {}

        db.prepare('DELETE FROM users WHERE id = ?').run(uid);
        console.log(`[Purge] Removed demo user ID ${uid}`);
    }
})();

console.log('[Purge] Cleanup completed successfully!');

const remainingReentry = db.prepare('SELECT id, first_name, last_name, apricot_id FROM reentry_clients').all();
console.log(`Remaining reentry clients (${remainingReentry.length}):`);
console.table(remainingReentry);

const remainingUsers = db.prepare("SELECT id, name, role FROM users WHERE role = 'participant'").all();
console.log(`Remaining participants in users table (${remainingUsers.length}):`);
