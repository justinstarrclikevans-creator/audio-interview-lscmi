const fs = require('fs');

const file = 'public/questions.json';
let data = JSON.parse(fs.readFileSync(file, 'utf8'));

let newData = [];

for (let i = 0; i < data.length; i++) {
    let q = data[i];
    let originalIndex = i + 1; // 1-based index

    // Rules
    if (originalIndex === 104) {
        continue; // Remove
    }
    if (originalIndex === 105) {
        q.text = "What is your social security number?";
    }
    if (originalIndex === 106) {
        continue; // Remove
    }
    if (originalIndex === 107) {
        continue; // Remove
    }
    if (originalIndex === 108) {
        // Keep
    }
    if (originalIndex === 109) {
        // Add block BEFORE 109
        newData.push({
            text: "For the following questions about supervision, just say 'Does not apply' if they don't apply.",
            subtext: ""
        });
    }
    if (originalIndex >= 124 && originalIndex <= 127) {
        continue; // Eliminate 124 through 127
    }
    if (originalIndex === 141) {
        q.subtext = "Say 'Does not apply' if it does not apply.";
    }
    if (originalIndex === 155) {
        q.subtext = "Say 'Does not apply' if it does not apply.";
    }
    if (originalIndex === 165) {
        continue; // Eliminate 165
    }

    newData.push(q);
}

fs.writeFileSync(file, JSON.stringify(newData, null, 4));
console.log(`Original count: ${data.length}, New count: ${newData.length}`);
