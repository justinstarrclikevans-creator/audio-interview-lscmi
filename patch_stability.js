const fs = require('fs');
let srv = fs.readFileSync('server.js', 'utf8');

const regex = /INSERT INTO weekly_stability_checks \([\s\S]*?stmt\.run\([\s\S]*?\);/g;

const newInsert = `INSERT INTO weekly_stability_checks (
                participant_id, new_sexual_convictions, recent_major_drug_use, housing_instability, no_call_no_show, transportation_breakdown
            ) VALUES (?, ?, ?, ?, ?, ?)
        \`);
        stmt.run(
            data.participant_id || data.user_id,
            data.new_sexual_convictions || 0,
            data.recent_major_drug_use || 0,
            data.housing_instability || 0,
            data.no_call_no_show || 0,
            data.transportation_breakdown || 0
        );`;

if (regex.test(srv)) {
    srv = srv.replace(regex, newInsert);
    fs.writeFileSync('server.js', srv);
    console.log('✅ server.js patched for stability insert');
} else {
    console.log('❌ Could not find INSERT statement');
}
