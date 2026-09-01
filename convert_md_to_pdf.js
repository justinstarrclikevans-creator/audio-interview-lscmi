const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer');

const DATA_DIR = path.join(__dirname, 'data');

async function convertMdToPdf() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.md'));
  
  if (files.length === 0) {
    console.log('No .md files found in data/');
    return;
  }

  console.log(`Found ${files.length} markdown files to convert...`);

  const browser = await puppeteer.launch({ headless: 'new' });

  for (const file of files) {
    const mdPath = path.join(DATA_DIR, file);
    const pdfPath = path.join(DATA_DIR, file.replace(/\.md$/, '.pdf'));
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    const htmlBody = marked(mdContent);

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 12px;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 30px; }
    h2 { font-size: 18px; border-bottom: 1px solid #999; padding-bottom: 6px; margin-top: 24px; }
    h3 { font-size: 15px; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; font-size: 11px; }
    th { background-color: #f0f0f0; font-weight: bold; }
    tr:nth-child(even) { background-color: #fafafa; }
    ul, ol { padding-left: 24px; }
    li { margin-bottom: 4px; }
    strong { color: #111; }
    blockquote { border-left: 3px solid #999; margin-left: 0; padding-left: 16px; color: #555; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-size: 11px; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' },
      printBackground: true,
    });
    await page.close();

    console.log(`  ✅ ${file} → ${path.basename(pdfPath)}`);
  }

  await browser.close();
  console.log(`\nDone! ${files.length} PDFs created in data/`);
}

convertMdToPdf().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
