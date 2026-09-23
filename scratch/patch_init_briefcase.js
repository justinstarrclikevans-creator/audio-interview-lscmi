const fs = require('fs');
let code = fs.readFileSync('db.js', 'utf8');

const regex = /function initParticipantBriefcase\(userId\) \{[\s\S]*?const insertGate = db\.prepare\([\s\S]*?\}\);[\s\S]*?const tx = db\.transaction\(\(\) => \{/;

const newLogic = `
function initParticipantBriefcase(userId) {
    const check = db.prepare('SELECT id FROM participant_profiles WHERE user_id = ?').get(userId);
    if (check) return; // Already initialized

    db.prepare('INSERT INTO participant_profiles (user_id) VALUES (?)').run(userId);

    const user = db.prepare('SELECT track FROM users WHERE id = ?').get(userId);
    const track = user ? user.track : 'first_shift';

    const insertBriefcase = db.prepare(\`
        INSERT OR IGNORE INTO briefcase_items (user_id, domain, item_key, title, status)
        VALUES (?, ?, ?, ?, 'pending')
    \`);

    const insertGate = db.prepare(\`
        INSERT OR IGNORE INTO gate_criteria (user_id, week_number, criterion_key, title, description, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    \`);

    const insertBenefit = db.prepare(\`
        INSERT OR IGNORE INTO participant_benefits (user_id, benefit_type, status)
        VALUES (?, ?, 'not_started')
    \`);

    const tx = db.transaction(() => {
`;

code = code.replace(regex, newLogic.trim());

// Now replace the inner loop
const innerLoopRegex = /\/\/ Seed 4-week gate criteria\s+for \(let week = 1; week <= 4; week\+\+\) \{\s+for \(const c of DEFAULT_GATE_CRITERIA\[week\]\) \{\s+insertGate\.run\(userId, week, c\.key, c\.title, c\.description\);\s+\}\s+\}/;

const newInnerLoop = `// Seed 4-week gate criteria
        for (let week = 1; week <= 4; week++) {
            for (const c of DEFAULT_GATE_CRITERIA[week]) {
                if (track === 'reentry_nav' && c.key.includes('skillcat')) {
                    continue; // Reentry Nav does not do SkillCat
                }
                insertGate.run(userId, week, c.key, c.title, c.description);
            }
        }`;

code = code.replace(innerLoopRegex, newInnerLoop);

fs.writeFileSync('db.js', code);
console.log('Patched initParticipantBriefcase');
