const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto('https://www.skillcatapp.com/login', { waitUntil: 'networkidle2' });
        await page.screenshot({ path: 'scratch/skillcat_login.png' });
        
        const html = await page.evaluate(() => document.body.innerHTML);
        const fs = require('fs');
        fs.writeFileSync('scratch/skillcat_login.html', html);
        console.log('Saved screenshot and HTML');
    } catch(e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
