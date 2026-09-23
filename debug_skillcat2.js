const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        console.log("Going to homepage...");
        await page.goto('https://www.skillcatapp.com', { waitUntil: 'networkidle2' });
        
        const html = await page.evaluate(() => document.body.innerHTML);
        const fs = require('fs');
        fs.writeFileSync('scratch/skillcat_home.html', html);
        
        console.log("Looking for login link...");
        const loginUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const loginLink = links.find(l => l.innerText.toLowerCase().includes('log in') || l.innerText.toLowerCase().includes('login'));
            return loginLink ? loginLink.href : null;
        });
        
        console.log("Login URL found:", loginUrl);
    } catch(e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
