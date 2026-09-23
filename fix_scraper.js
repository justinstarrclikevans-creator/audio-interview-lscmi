const fs = require('fs');
let s = fs.readFileSync('skillcat_scraper.js', 'utf8');

const oldLogic = `        const updateBriefcase = db.prepare(\`
            UPDATE briefcase_items 
            SET status = 'green', notes = ? 
            WHERE user_id = (SELECT id FROM users WHERE name LIKE '%' || ? || '%') 
            AND (item_key = 'skillcat_progress' OR title LIKE '%Skillcat%')
        \`);

        let updateCount = 0;
        db.transaction(() => {
            for (const student of studentData) {
                const validOptions = ['Highly Engaged', 'Moderately Engaged', 'Lightly Engaged', 'Not Engaged'];
                let finalEngagement = 'Not Engaged';
                
                for (const opt of validOptions) {
                    if (student.engagement.toLowerCase().includes(opt.toLowerCase())) {
                        finalEngagement = opt;
                        break;
                    }
                }
                
                const result = updateBriefcase.run(finalEngagement, student.name);
                if (result.changes > 0) updateCount++;
            }
        })();`;

const newLogic = `        const selectUser = db.prepare(\`SELECT id FROM users WHERE name LIKE '%' || ? || '%'\`);
        const selectBriefcase = db.prepare(\`SELECT id FROM briefcase_items WHERE user_id = ? AND (item_key = 'skillcat_progress' OR title LIKE '%Skillcat%') LIMIT 1\`);
        const updateBriefcase = db.prepare(\`UPDATE briefcase_items SET status = ?, notes = ? WHERE id = ?\`);
        const insertBriefcase = db.prepare(\`INSERT INTO briefcase_items (user_id, domain, item_key, title, status, notes) VALUES (?, 'skillcat', 'skillcat_progress', 'SkillCat Progress', ?, ?)\`);

        let updateCount = 0;
        db.transaction(() => {
            for (const student of studentData) {
                const validOptions = ['Highly Engaged', 'Moderately Engaged', 'Lightly Engaged', 'Not Engaged'];
                let finalEngagement = 'Not Engaged';
                
                for (const opt of validOptions) {
                    if (student.engagement.toLowerCase().includes(opt.toLowerCase())) {
                        finalEngagement = opt;
                        break;
                    }
                }
                
                let color = 'green';
                if (finalEngagement === 'Not Engaged') color = 'red';
                else if (finalEngagement === 'Lightly Engaged' || finalEngagement === 'Moderately Engaged') color = 'yellow';

                const user = selectUser.get(student.name);
                if (user) {
                    const existing = selectBriefcase.get(user.id);
                    if (existing) {
                        updateBriefcase.run(color, finalEngagement, existing.id);
                        updateCount++;
                    } else {
                        insertBriefcase.run(user.id, color, finalEngagement);
                        updateCount++;
                    }
                }
            }
        })();`;

if (s.includes("UPDATE briefcase_items")) {
    s = s.replace(oldLogic, newLogic);
    fs.writeFileSync('skillcat_scraper.js', s);
    console.log("✅ Fixed skillcat_scraper.js");
}
