const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

const oldInsert = `            INSERT INTO health_wellness_screen (
                participant_id, assessor_name, vision_issues, hearing_issues, mobility_pain, stamina_fatigue,
                fine_motor_issues, physical_notes, reading_writing_issues, following_instructions_issues,
                memory_organization_issues, processing_time_issues, cognitive_notes,
                emotional_regulation_issues, anxiety_panic, social_interactions_issues,
                baseline_changes, avoidance, mental_health_notes, primary_care_referral,
                vocational_rehab_referral, mental_health_referral, job_search_adjustment, immediate_next_step
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`);
        
        stmt.run(
            participant_id, req.user.name, vision_issues||0, hearing_issues||0, mobility_pain||0, stamina_fatigue||0,
            fine_motor_issues||0, physical_notes, reading_writing_issues||0, following_instructions_issues||0,
            memory_organization_issues||0, processing_time_issues||0, cognitive_notes,
            emotional_regulation_issues||0, anxiety_panic||0, social_interactions_issues||0,
            baseline_changes||0, avoidance||0, mental_health_notes, primary_care_referral||0,
            vocational_rehab_referral||0, mental_health_referral||0, job_search_adjustment||0, immediate_next_step
        );`;

const newInsert = `            INSERT INTO health_wellness_screen (
                participant_id, vision_issues, hearing_issues, mobility_pain, stamina_fatigue,
                fine_motor_issues, physical_notes, reading_writing_issues, following_instructions_issues,
                memory_organization_issues, processing_time_issues, cognitive_notes,
                primary_care_referral, vocational_rehab_referral, mental_health_referral, job_search_adjustment, immediate_next_step
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`);
        
        stmt.run(
            participant_id, vision_issues||0, hearing_issues||0, mobility_pain||0, stamina_fatigue||0,
            fine_motor_issues||0, physical_notes, reading_writing_issues||0, following_instructions_issues||0,
            memory_organization_issues||0, processing_time_issues||0, cognitive_notes,
            primary_care_referral||0, vocational_rehab_referral||0, mental_health_referral||0, job_search_adjustment||0, immediate_next_step
        );`;

if (srv.includes('INSERT INTO health_wellness_screen')) {
    srv = srv.replace(oldInsert, newInsert);
    fs.writeFileSync('server.js', srv);
    console.log('✅ server.js patched for health insert');
} else {
    console.log('❌ Could not find INSERT statement');
}
