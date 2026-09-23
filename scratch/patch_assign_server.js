const fs = require('fs');
let js = fs.readFileSync('server.js', 'utf8');

const newEndpoint = `
// Assign Scoring to Participant
app.post('/api/admin/scoring/assign', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { clientId, participantName } = req.body;
    if (!clientId || !participantName) return res.status(400).json({ error: 'clientId and participantName required' });
    
    // Generate new prefix based on participant name (e.g., "John Doe" -> "John_Doe")
    const newPrefix = participantName.replace(/[^a-zA-Z0-9]/g, '_');
    
    try {
        const files = fs.readdirSync(dataDir);
        let renamedCount = 0;
        files.forEach(f => {
            if (f.startsWith(clientId + '_')) {
                const suffix = f.substring(clientId.length);
                const oldPath = path.join(dataDir, f);
                const newPath = path.join(dataDir, newPrefix + suffix);
                fs.renameSync(oldPath, newPath);
                renamedCount++;
            }
        });
        res.json({ message: \`Successfully renamed \${renamedCount} files to link with \${participantName}\` });
    } catch(err) {
        res.status(500).json({ error: 'Failed to rename scoring files: ' + err.message });
    }
});
`;

js = js.replace(
    /\/\/ Get Class Feedback Summary/g,
    newEndpoint + '\n// Get Class Feedback Summary'
);

fs.writeFileSync('server.js', js);
console.log('✅ Patched scoring endpoint');
