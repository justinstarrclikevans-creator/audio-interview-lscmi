const fs = require('fs');

let dbJs = fs.readFileSync('db.js', 'utf8');

const newTables = `
CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    habit_key TEXT NOT NULL,
    date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, habit_key, date)
);

CREATE TABLE IF NOT EXISTS earned_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    badge_key TEXT NOT NULL,
    badge_name TEXT NOT NULL,
    icon TEXT,
    earned_date DATE DEFAULT (DATE('now')),
    UNIQUE(user_id, badge_key)
);
`;

if (!dbJs.includes("habit_logs")) {
    dbJs = dbJs.replace("CREATE TABLE IF NOT EXISTS messages", newTables + "\nCREATE TABLE IF NOT EXISTS messages");
    fs.writeFileSync('db.js', dbJs);
    console.log("✅ Added gamification tables to db.js");
}

let srvJs = fs.readFileSync('server.js', 'utf8');

const apiEndpoints = `
// GAMIFICATION ENDPOINTS
app.get('/api/participant/gamification', authenticateToken, (req, res) => {
    try {
        const userId = req.user.role === 'participant' ? req.user.id : (req.query.userId || req.user.id);
        
        // 1. Calculate XP from Gates
        const gateData = db.prepare('SELECT current_gate FROM participant_profiles WHERE user_id = ?').get(userId);
        const gatesCompleted = gateData && gateData.current_gate > 1 ? (gateData.current_gate - 1) : 0;
        const gateXp = gatesCompleted * 500;
        
        // 2. Calculate XP from Daily Points (Assuming 1 point = 10 XP)
        const pointsData = db.prepare('SELECT SUM(points_earned) as total_points FROM daily_points WHERE user_id = ?').get(userId);
        const dailyXp = Math.floor((pointsData?.total_points || 0) * 10);
        
        // 3. Calculate XP from Habits
        const habitsData = db.prepare('SELECT COUNT(*) as total_habits FROM habit_logs WHERE user_id = ?').get(userId);
        const habitXp = (habitsData?.total_habits || 0) * 20;
        
        const totalXp = gateXp + dailyXp + habitXp;
        
        // Calculate Level
        let level = 1;
        let title = "The Spark";
        let nextLevelXp = 500;
        
        if (totalXp >= 3000) { level = 5; title = "The Professional"; nextLevelXp = 5000; }
        else if (totalXp >= 1500) { level = 4; title = "The Craftsman"; nextLevelXp = 3000; }
        else if (totalXp >= 1000) { level = 3; title = "The Builder"; nextLevelXp = 1500; }
        else if (totalXp >= 500) { level = 2; title = "The Apprentice"; nextLevelXp = 1000; }
        
        const today = new Date().toISOString().split('T')[0];
        const habitsToday = db.prepare('SELECT habit_key FROM habit_logs WHERE user_id = ? AND date = ?').all(userId, today).map(h => h.habit_key);
        const badges = db.prepare('SELECT badge_key, badge_name, icon FROM earned_badges WHERE user_id = ?').all(userId);
        
        res.json({
            success: true,
            xp: totalXp,
            level: level,
            title: title,
            nextLevelXp: nextLevelXp,
            habitsToday: habitsToday,
            badges: badges
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/participant/habit', authenticateToken, (req, res) => {
    try {
        const { habit_key, completed } = req.body;
        const today = new Date().toISOString().split('T')[0];
        
        if (completed) {
            db.prepare('INSERT OR IGNORE INTO habit_logs (user_id, habit_key, date) VALUES (?, ?, ?)').run(req.user.id, habit_key, today);
        } else {
            db.prepare('DELETE FROM habit_logs WHERE user_id = ? AND habit_key = ? AND date = ?').run(req.user.id, habit_key, today);
        }
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
`;

if (!srvJs.includes("/api/participant/gamification")) {
    srvJs = srvJs.replace("app.listen(PORT", apiEndpoints + "\napp.listen(PORT");
    fs.writeFileSync('server.js', srvJs);
    console.log("✅ Added gamification endpoints to server.js");
}
