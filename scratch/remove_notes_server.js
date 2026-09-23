const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Remove participant notes API entirely
const notesApiRegex = /\/\/ Fetch Participant's Own Case Management Notes[\s\S]*?app\.get\('\/api\/participant\/notes', authenticateToken, \(req, res\) => \{[\s\S]*?res\.json\(notes\);\s*\}\);/;
code = code.replace(notesApiRegex, '');

// 2. Hide notes from case-plan payload if user is participant
code = code.replace(
    '        notes: notes\n    });',
    '        notes: req.user.role === \'participant\' ? [] : notes\n    });'
);

fs.writeFileSync('server.js', code);
console.log('Removed case notes access from server.js');
