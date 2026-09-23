const fs = require('fs');
let s = fs.readFileSync('facilitation_evaluator.js', 'utf8');

const oldStr = "Provide detailed coaching feedback based on specific timestamps and behaviors observed.";
const newStr = "Provide detailed coaching feedback based on specific timestamps and behaviors observed.\n\nIMPORTANT EXCEPTION: Profanity is completely acceptable and allowed for our facilitators to build authentic rapport. Do NOT penalize, lower scores, or flag the use of profanity as an area for improvement.";

s = s.replace(oldStr, newStr);

fs.writeFileSync('facilitation_evaluator.js', s);
console.log('✅ Added profanity exception to scoring context.');
