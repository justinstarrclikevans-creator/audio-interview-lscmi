require('dotenv').config();
const puppeteer = require('puppeteer');
const db = require('better-sqlite3')('./data/app_database.sqlite');

(async () => {
    console.log("Starting SkillCat Scraper (Headless)...");

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        const loginUrl = process.env.SKILLCAT_LOGIN_URL || 'https://www.skillcatapp.com/login';
        
        // 1. Inject the Session Cookie to bypass SSO
        const cookieName = process.env.SKILLCAT_COOKIE_NAME || 'MoodleSession';
        const cookieValue = process.env.SKILLCAT_COOKIE_VALUE;

        if (!cookieValue) {
            throw new Error("SKILLCAT_COOKIE_VALUE is missing in .env. Please add your moodlesession cookie value.");
        }

        console.log(`Injecting ${cookieName} cookie...`);
        await page.setCookie({
            name: cookieName,
            value: cookieValue,
            domain: process.env.SKILLCAT_DOMAIN || 'www.skillcatapp.com',
            path: '/',
            httpOnly: true,
            secure: true
        });

        // 2. Navigate to the main portal page
        console.log("Navigating to home/dashboard...");
        await page.goto('https://www.skillcatapp.com/my/', { waitUntil: 'networkidle2' });

        // 3. Click "Go to Training Dashboard"
        console.log("Looking for 'Go to Training Dashboard'...");
        try {
            const dashboardLinks = await page.$x("//*[contains(text(), 'Go to Training Dashboard')]");
            if (dashboardLinks.length > 0) {
                await dashboardLinks[0].click();
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
            } else {
                console.log("Text not found, attempting to continue...");
            }
        } catch (e) {
            console.log("Navigation step skipped or failed.", e.message);
        }

        // 4. Click the View Employees button
        console.log("Clicking 'View Employees' button...");
        await page.waitForSelector('button.view-emp', { visible: true, timeout: 15000 });
        await page.click('button.view-emp');

        // 5. Wait for trainees to load and scrape
        console.log("Waiting for employee list to load...");
        await page.waitForSelector('.trainee-name', { visible: true, timeout: 15000 });

        console.log("Scraping student progress...");
        const studentData = await page.evaluate(() => {
            const students = [];
            const nameNodes = document.querySelectorAll('.trainee-name');
            
            nameNodes.forEach(nameNode => {
                // Clean up the name spacing (e.g., "Justin   Evans" -> "Justin Evans")
                const name = nameNode.innerText.replace(/\s+/g, ' ').trim();
                
                let parent = nameNode.parentElement;
                let percentageNode = null;
                
                // Climb up the DOM tree up to 5 levels to find the shared row/card container
                for(let i=0; i<5; i++) {
                    if(!parent) break;
                    percentageNode = parent.querySelector('.percentage');
                    if(percentageNode) break;
                    parent = parent.parentElement;
                }
                
                const progress = percentageNode ? percentageNode.innerText.trim() : 'Unknown';
                
                students.push({
                    name: name,
                    progress: progress
                });
            });
            return students;
        });

        console.log("Successfully scraped data:", studentData);

        // Update local database based on scraped data
        console.log("Updating Turn90 database with SkillCat progress...");
        const updateBriefcase = db.prepare(`
            UPDATE briefcase_items 
            SET status = 'green', notes = ? 
            WHERE user_id = (SELECT id FROM users WHERE name LIKE '%' || ? || '%') 
            AND title LIKE '%Skillcat%'
        `);

        db.transaction(() => {
            for (const student of studentData) {
                const note = `SkillCat Progress: ${student.progress}`;
                updateBriefcase.run(note, student.name);
                console.log(`Updated DB for ${student.name}`);
            }
        })();

        console.log("Mock implementation executed. To run real scraping, configure the exact selectors in skillcat_scraper.js and ensure SKILLCAT_EMAIL and SKILLCAT_PASSWORD are in .env");

    } catch (error) {
        console.error("Scraping failed:", error);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
})();
