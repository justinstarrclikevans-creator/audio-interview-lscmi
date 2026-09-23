const fs = require('fs');
let dbJs = fs.readFileSync('db.js', 'utf8');

const newTable = `
CREATE TABLE IF NOT EXISTS relapse_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_type TEXT NOT NULL, -- 'substance' or 'behavior'
    triggers TEXT,
    warning_signs TEXT,
    coping_skills TEXT,
    support_system TEXT,
    emergency_plan TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, plan_type)
);
`;

if (!dbJs.includes("relapse_plans")) {
    dbJs = dbJs.replace("CREATE TABLE IF NOT EXISTS habit_logs", newTable + "\nCREATE TABLE IF NOT EXISTS habit_logs");
    fs.writeFileSync('db.js', dbJs);
    console.log("✅ Added relapse_plans table to db.js");
}
