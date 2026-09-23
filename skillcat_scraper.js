require('dotenv').config();
const puppeteer = require('puppeteer');
const db = require('better-sqlite3')('./data/app_database.sqlite');

(async () => {
    console.log("Starting SkillCat Scraper (Headless)...");

    const email = process.env.SKILLCAT_EMAIL;
    const password = process.env.SKILLCAT_PASSWORD;

    if (!email || !password) {
        console.error("❌ Missing SKILLCAT_EMAIL or SKILLCAT_PASSWORD in .env file.");
        process.exit(1);
    }

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        const loginUrl = 'https://skillcat.app/login/index.php';
        
        console.log(`Navigating to login page: ${loginUrl}...`);
        await page.goto(loginUrl, { waitUntil: 'networkidle2' });

        // Wait for login form
        console.log("Entering credentials...");
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
        await page.type('input[name="username"]', email);
        
        await page.waitForSelector('input[name="password"]', { timeout: 10000 });
        await page.type('input[name="password"]', password);
        
        // Find and click the login button
        await page.click('#loginbtn');

        // Wait for navigation after login
        console.log("Waiting for dashboard to load...");
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

        // Try to click "Go to Training Dashboard" if it exists
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

        // Click the View Employees button
        console.log("Looking for 'View Employees' button...");
        await page.waitForSelector('button.view-emp', { visible: true, timeout: 15000 });
        await page.click('button.view-emp');

        // Wait for trainees to load and scrape
        console.log("Waiting for employee list to load...");
        await page.waitForSelector('.trainee-name', { visible: true, timeout: 15000 }); console.log("Waiting 10s for engagement labels..."); await new Promise(r => setTimeout(r, 6000));

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
                    // Look for the exact class the user specified
                    engagementNode = parent.querySelector('.skillat_engagement_level');
                    if(engagementNode) break;
                    parent = parent.parentElement;
                }
                
                const engagement = engagementNode ? engagementNode.innerText.trim() : 'Not Engaged';
                
                students.push({
                    name: name,
                    engagement: engagement
                });
            });
            return students;
        });

        console.log("Successfully scraped data:", studentData);

        // Update local database based on scraped data
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
                    console.log(`✅ Updated DB for ${student.name} -> ${finalEngagement}`);
                    updateCount++;
                }
            }
        })();

        console.log(`Finished updating ${updateCount} records.`);

    } catch (error) {
        console.error("Scraping failed:", error.message);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
})();
