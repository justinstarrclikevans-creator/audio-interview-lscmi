const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const migrationText = `
// Migration: Cleanup deprecated or misaligned gates
try {
    db.prepare("DELETE FROM gate_criteria WHERE criterion_key IN ('g1_id_app', 'g1_dmv_check', 'g2_resume_started', 'g2_phone_check', 'g3_mock_interview', 'g4_fs_grad', 'g4_interview_ready')").run();
    console.log('Migration: Cleaned up old/deprecated gate criteria');

    // Remove SkillCat gates for reentry_nav participants
    db.prepare(\`
        DELETE FROM gate_criteria 
        WHERE criterion_key LIKE '%skillcat%' 
        AND user_id IN (SELECT id FROM users WHERE track = 'reentry_nav')
    \`).run();
    console.log('Migration: Cleaned up SkillCat gates for Reentry Nav participants');
} catch (err) {
    console.log('Migration note:', err.message);
}
`;

const oldMigration = `try {
    db.prepare("DELETE FROM gate_criteria WHERE criterion_key IN ('g1_id_app', 'g1_dmv_check', 'g2_resume_started', 'g2_phone_check', 'g3_mock_interview', 'g4_fs_grad', 'g4_interview_ready')").run();
    console.log('Migration: Cleaned up old/deprecated gate criteria');
} catch(e) {}`;

code = code.replace(oldMigration, migrationText.trim());

fs.writeFileSync('server.js', code);
console.log('Patched migration in server.js');
