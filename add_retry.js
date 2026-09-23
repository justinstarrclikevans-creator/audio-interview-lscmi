const fs = require('fs');

let s = fs.readFileSync('facilitation_evaluator.js', 'utf8');

const oldCode = `        const result = await model.generateContent(contentParts);
        const responseText = result.response.text();`;

const newCode = `        let result;
        let retries = 5;
        while (retries > 0) {
            try {
                result = await model.generateContent(contentParts);
                break;
            } catch (err) {
                if (err.message && err.message.includes('503 Service Unavailable') && retries > 1) {
                    console.warn(\`[Class Evaluation] Gemini API 503 Overloaded. Retrying in 15 seconds... (\${retries - 1} attempts left)\`);
                    await new Promise(r => setTimeout(r, 15000));
                    retries--;
                } else {
                    throw err;
                }
            }
        }
        const responseText = result.response.text();`;

if (s.includes(oldCode)) {
    s = s.replace(oldCode, newCode);
    fs.writeFileSync('facilitation_evaluator.js', s);
    console.log('✅ Added exponential backoff / retry loop for Gemini 503 errors.');
} else {
    console.log('❌ Could not find old code block.');
}
