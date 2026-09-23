const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

const getEndpoint = `
app.get('/api/staff/health-assessment/:userId', authenticateToken, (req, res) => {
    if (req.user.role === 'participant') return res.status(403).json({ error: 'Unauthorized' });
    try {
        const data = db.prepare('SELECT * FROM health_wellness_screen WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.userId);
        res.json({ success: true, data: data || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`;

if (!srv.includes("app.get('/api/staff/health-assessment/:userId'")) {
    srv = srv.replace("app.post('/api/staff/health-assessment'", getEndpoint + "\napp.post('/api/staff/health-assessment'");
    fs.writeFileSync('server.js', srv);
    console.log("✅ Added GET endpoint");
}
