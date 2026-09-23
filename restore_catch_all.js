const fs = require('fs');

let srv = fs.readFileSync('server.js', 'utf8');

const catchAllCode = `

// Catch-all for undefined API routes - ALWAYS return JSON, NEVER HTML
app.use('/api', (req, res) => {
    res.status(404).json({ error: \`API endpoint \${req.method} \${req.originalUrl} not found.\` });
});

// Fallback to index.html for SPA / client routes
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/data/')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        next();
    }
});

`;

if (!srv.includes("Catch-all for undefined API routes")) {
    srv = srv.replace('app.listen(PORT, async () => {', catchAllCode + 'app.listen(PORT, async () => {');
    fs.writeFileSync('server.js', srv);
    console.log('✅ Catch-all routes successfully restored at the correct position.');
} else {
    console.log('❌ Catch-all already exists!');
}
