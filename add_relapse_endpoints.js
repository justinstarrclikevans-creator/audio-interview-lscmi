const fs = require('fs');
let srvJs = fs.readFileSync('server.js', 'utf8');

const endpoints = `
// RELAPSE PREVENTION PLANS
app.get('/api/staff/relapse-plan/:userId/:type', authenticateToken, (req, res) => {
    try {
        const data = db.prepare('SELECT * FROM relapse_plans WHERE user_id = ? AND plan_type = ?').get(req.params.userId, req.params.type);
        res.json({ success: true, data: data || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/staff/relapse-plan', authenticateToken, (req, res) => {
    try {
        const { user_id, plan_type, triggers, warning_signs, coping_skills, support_system, emergency_plan } = req.body;
        db.prepare(\`
            INSERT INTO relapse_plans (user_id, plan_type, triggers, warning_signs, coping_skills, support_system, emergency_plan)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, plan_type) DO UPDATE SET
                triggers = excluded.triggers,
                warning_signs = excluded.warning_signs,
                coping_skills = excluded.coping_skills,
                support_system = excluded.support_system,
                emergency_plan = excluded.emergency_plan,
                updated_at = CURRENT_TIMESTAMP
        \`).run(user_id, plan_type, triggers, warning_signs, coping_skills, support_system, emergency_plan);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`;

if (!srvJs.includes("/api/staff/relapse-plan")) {
    srvJs = srvJs.replace("app.post('/api/staff/health-assessment'", endpoints + "\napp.post('/api/staff/health-assessment'");
    fs.writeFileSync('server.js', srvJs);
    console.log("✅ Added relapse plan endpoints");
}
