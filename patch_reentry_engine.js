const fs = require('fs');
let js = fs.readFileSync('reentry_engine.js', 'utf8');

const target = \`    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);\`;

const replacement = \`    let retries = 0;
    while (retries < 5) {
        try {
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            return JSON.parse(responseText);
        } catch (e) {
            if (e.message.includes('503') || e.message.includes('429')) {
                console.log(\`  [Retry] Gemini API high demand (503/429). Retrying in 15s (Attempt \${retries + 1}/5)...\`);
                await new Promise(r => setTimeout(r, 15000));
                retries++;
            } else {
                throw e;
            }
        }
    }
    throw new Error('Gemini API failed after 5 retries due to high demand.');\`;

if (js.includes('await model.generateContent')) {
    js = js.replace(target, replacement);
    fs.writeFileSync('reentry_engine.js', js);
    console.log("✅ Patched reentry_engine.js with retry loop");
}
