const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        console.log("Going to https://skillcat.app/...");
        await page.goto('https://skillcat.app/', { waitUntil: 'networkidle2' });
        
        const html = await page.evaluate(() => document.body.innerHTML);
        const fs = require('fs');
        fs.writeFileSync('scratch/skillcat_app.html', html);
        console.log("Saved skillcat.app html");
    } catch(e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
