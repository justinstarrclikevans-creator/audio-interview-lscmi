const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer');

const DATA_DIR = path.join(__dirname, 'data');

async function convertSingleMdToPdf(mdPath, pdfPath) {
  if (!fs.existsSync(mdPath)) return;
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
      color: #1e293b;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
    }
    h1 { font-size: 20px; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-top: 20px; color: #1e3a8a; }
    h2 { font-size: 16px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 18px; color: #0f172a; }
    h3 { font-size: 14px; margin-top: 14px; color: #0284c7; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; font-size: 11px; }
    th { background-color: #f1f5f9; font-weight: bold; color: #0f172a; }
    tr:nth-child(even) { background-color: #f8fafc; }
    ul, ol { padding-left: 20px; }
    li { margin-bottom: 4px; }
    strong { color: #0f172a; }
    blockquote { border-left: 4px solid #0284c7; margin-left: 0; padding-left: 14px; color: #475569; background: #f0f9ff; padding-top: 4px; padding-bottom: 4px; }
    code { background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-size: 11px; font-family: monospace; }
    pre { background: #f8fafc; padding: 10px; border-radius: 4px; border: 1px solid #e2e8f0; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #cbd5e1; margin: 16px 0; }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;

  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      margin: { top: '0.4in', bottom: '0.4in', left: '0.5in', right: '0.5in' },
      printBackground: true,
    });
    await page.close();
    console.log(`Generated PDF: ${path.basename(pdfPath)}`);
  } catch (err) {
    console.error(`Failed to convert ${mdPath} to PDF:`, err.message);
  } finally {
    if (browser) await browser.close();
  }
}

async function convertAllMdToPdf() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const mdPath = path.join(DATA_DIR, file);
    const pdfPath = path.join(DATA_DIR, file.replace(/\.md$/, '.pdf'));
    await convertSingleMdToPdf(mdPath, pdfPath);
  }
}

if (require.main === module) {
  convertAllMdToPdf().then(() => console.log('All conversions complete.'));
}

module.exports = { convertSingleMdToPdf, convertAllMdToPdf };
