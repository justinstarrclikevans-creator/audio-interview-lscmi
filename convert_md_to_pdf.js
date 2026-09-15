// Puppeteer removed to save 300MB disk space on Render.
// We now rely on HTML print routes (/api/documents/print/:filename) instead.

async function convertSingleMdToPdf(mdPath, pdfPath) {
  console.log(`Skipping PDF generation for ${mdPath} to save disk space.`);
}

async function convertAllMdToPdf() {
  console.log(`Skipping bulk PDF generation.`);
}

module.exports = { convertSingleMdToPdf, convertAllMdToPdf };
