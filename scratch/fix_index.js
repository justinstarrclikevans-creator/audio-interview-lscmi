const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Rename "💬 Message Staff & AI" to "🤖 AI Assistant"
html = html.replace('💬 Message Staff & AI</button>', '🤖 AI Assistant</button>');

// 2. Remove the RN Section: Message Staff header
html = html.replace('<!-- RN Section: Message Staff & AI Assistant -->', '<!-- RN Section: AI Assistant -->');

// 3. Remove "Message Staff" from fs-sub-tabs (Support & AI Tools is already fine)
// We'll leave fs-sub-tab-btn-support alone.

// 4. Safely remove JUST the Recent Case Management Notes block
const caseNotesBlock = `
                <!-- Recent Case Management Notes & Observations -->
                <div class="section-card" style="margin-bottom: 20px;">
                    <div class="section-header" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3 style="margin: 0; font-size: 16px; color: var(--primary);">📝 Recent Case Management Notes & Updates</h3>
                            <p style="margin: 2px 0 0 0; font-size: 12.5px; color: var(--slate);">Notes recorded by your Turn90 Program Manager and Reentry Navigator.</p>
                        </div>
                    </div>
                    <div id="rn-plan-notes-container" style="display: flex; flex-direction: column; gap: 10px;">
                        <p style="color: var(--slate); font-size: 13px;">Loading your case notes...</p>
                    </div>
                </div>
`;

// It might have slightly different spacing, so let's do a more precise replacement using split
const lines = html.split('\n');
let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<!-- Recent Case Management Notes & Observations -->')) {
        skip = true;
        continue;
    }
    
    // Resume when we hit the next section
    if (skip && lines[i].includes('<!-- Criminogenic Dynamic Domains & High-Risk Triggers -->')) {
        skip = false;
    }
    
    if (!skip) {
        newLines.push(lines[i]);
    }
}

html = newLines.join('\n');

const timestamp = Date.now();
html = html.replace(/<script src="app\.js(\?v=\d+)?"/g, '<script src="app.js?v=' + timestamp + '"');

fs.writeFileSync('public/index.html', html);
console.log('Restored index.html and safely made the edits');
