const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// Insert the function at the end of the file
const newFunc = `
async function updateSkillcat(userId, engagement) {
    if (!engagement) return;
    const token = localStorage.getItem('fs_token');
    try {
        const res = await fetch('/api/admin/update-skillcat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ userId, engagement })
        });
        const data = await res.json();
        if (res.ok) {
            loadCaseload();
        } else {
            alert('Failed to update SkillCat: ' + (data.error || 'Unknown error'));
        }
    } catch(e) {
        alert('Error updating SkillCat: ' + e.message);
    }
}
`;

fs.writeFileSync('public/app.js', js + '\n' + newFunc);
console.log('✅ Added updateSkillcat function');
