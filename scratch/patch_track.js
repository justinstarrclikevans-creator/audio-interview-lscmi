const fs = require('fs');
let code = fs.readFileSync('db.js', 'utf8');

const oldTop = `function initParticipantBriefcase(userId) {
    const insertBriefcase = db.prepare(\`
        INSERT OR IGNORE INTO briefcase_items (user_id, domain, item_key, title, status)`;

const newTop = `function initParticipantBriefcase(userId) {
    const check = db.prepare('SELECT id FROM participant_profiles WHERE user_id = ?').get(userId);
    if (!check) {
        db.prepare('INSERT OR IGNORE INTO participant_profiles (user_id) VALUES (?)').run(userId);
    }

    const user = db.prepare('SELECT track FROM users WHERE id = ?').get(userId);
    const track = user ? user.track : 'first_shift';

    const insertBriefcase = db.prepare(\`
        INSERT OR IGNORE INTO briefcase_items (user_id, domain, item_key, title, status)`;

code = code.replace(oldTop, newTop);

fs.writeFileSync('db.js', code);
console.log('Patched track definition');
