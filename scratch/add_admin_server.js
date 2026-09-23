const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// 1. Add track update to /api/pm/participant-correction
const trackUpdate = `
    if (req.body.track) {
        db.prepare('UPDATE users SET track = ? WHERE id = ?').run(req.body.track, userId);
    }

    // Update participant_profiles
`;
code = code.replace('    // Update participant_profiles\n', trackUpdate);

// 2. Add DELETE endpoint
const deleteEndpoint = `
// Delete a participant permanently
app.delete('/api/admin/participant/:userId', authenticateToken, requireRole('admin', 'program_manager', 'director'), (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    try {
        db.prepare('DELETE FROM users WHERE id = ? AND role = "participant"').run(userId);
        res.json({ message: 'Participant deleted successfully.' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete participant: ' + e.message });
    }
});
`;

// Insert it above the participant correction endpoint
code = code.replace('// Participant Information & Correction Notes Update', deleteEndpoint + '\n// Participant Information & Correction Notes Update');

fs.writeFileSync('server.js', code);
console.log('Patched server.js with delete and track logic');
