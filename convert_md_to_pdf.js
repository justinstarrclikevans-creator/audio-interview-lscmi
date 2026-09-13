const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer');

const DATA_DIR = path.join(__dirname, 'data');

const { buildPrintableDocumentHtml, buildPrintablePageHtml } = require('./server');

async function convertSingleMdToPdf(mdPath, pdfPath) {
  if (!fs.existsSync(mdPath)) return;
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const filename = path.basename(mdPath);
  const docHtml = buildPrintableDocumentHtml(filename, mdContent);
  const title = filename.replace(/\.(md|txt)$/i, '').replace(/_/g, ' ');
  const fullHtml = buildPrintablePageHtml(title, docHtml, false);

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
