const fs = require('fs');
let code = fs.readFileSync('reporting_engine.js', 'utf8');
code = code.replace(/const stats = \{ points: 0, drugTests: 0, caseNotes: 0 \};\\n\s*const unmatchedNames = \[\];/, "const stats = { points: 0, drugTests: 0, caseNotes: 0 };\n    const unmatchedNames = [];");
fs.writeFileSync('reporting_engine.js', code);
