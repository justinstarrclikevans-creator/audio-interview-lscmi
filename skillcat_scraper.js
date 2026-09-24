require('dotenv').config();
const puppeteer = require('puppeteer');
const db = require('better-sqlite3')('./data/app_database.sqlite');

async function runSkillCatScraper() {
    console.log("Starting SkillCat Scraper (Headless)...");
    const email = process.env.SKILLCAT_EMAIL;
    const password = process.env.SKILLCAT_PASSWORD;

    if (!email || !password) {
        throw new Error("Missing SKILLCAT_EMAIL or SKILLCAT_PASSWORD in .env file.");
    }

    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const loginUrl = 'https://skillcat.app/login/index.php';
        
        console.log(`Navigating to login page: ${loginUrl}...`);
        await page.goto(loginUrl, { waitUntil: 'networkidle2' });

        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.type('input[name="username"]', email);
        await page.waitForSelector('input[name="password"]', { timeout: 10000 });
        await page.type('input[name="password"]', password);
        await page.click('#loginbtn');

        console.log("Waiting for dashboard to load...");
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

        try {
            console.log("Checking for 'Go to Training Dashboard'...");
            const dashboardBtn = await page.$('::-p-xpath(//*[contains(text(), "Go to Training Dashboard")])');
            if (dashboardBtn) {
                await dashboardBtn.click();
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
            }
        } catch (e) {
            console.log("No Training Dashboard button found, proceeding...");
        }

        console.log("Looking for 'View Employees' button...");
        await page.waitForSelector('button.view-emp', { visible: true, timeout: 15000 });
        await page.click('button.view-emp');

        console.log("Waiting for employee list to load...");
        await page.waitForSelector('.trainee-name', { visible: true, timeout: 15000 }); 
        await new Promise(r => setTimeout(r, 6000));

        console.log("Scraping student engagement levels..."); 
        const studentData = await page.evaluate(() => {
            const students = [];
            const nameNodes = document.querySelectorAll('.trainee-name');
            nameNodes.forEach(nameNode => {
                const name = nameNode.innerText.replace(/\s+/g, ' ').trim();
                let parent = nameNode.parentElement;
                let engagementNode = null;
                for(let i = 0; i < 5; i++) {
                    if(!parent) break;
                    engagementNode = parent.querySelector('.skillat_engagement_level');
                    if(engagementNode) break;
                    parent = parent.parentElement;
                }
                const engagement = engagementNode ? engagementNode.innerText.trim() : 'Not Engaged';
                students.push({ name: name, engagement: engagement });
            });
            return students;
        });

        console.log("Updating database with SkillCat engagement levels...");
        const updateBriefcase = db.prepare(`
            UPDATE briefcase_items 
            SET status = 'green', notes = ? 
            WHERE user_id = (SELECT id FROM users WHERE name LIKE '%' || ? || '%') 
            AND (item_key = 'skillcat_progress' OR title LIKE '%Skillcat%')
        `);

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
                if (result.changes > 0) {
                    updateCount++;
                }
            }
        })();
        return { success: true, count: updateCount, data: studentData };
    } catch (error) {
        console.error("Scraping failed:", error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    runSkillCatScraper().then(console.log).catch(console.error);
}

module.exports = { runSkillCatScraper };
