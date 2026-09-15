const cron = require('node-cron');
const { Dropbox } = require('dropbox');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { evaluateClassMedia } = require('../facilitation_evaluator');

const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp_dropbox');

// Define the centers and their corresponding Dropbox paths
const CENTERS = [
    { name: 'Spartanburg', folderPath: '/SPB QuickTime' },
    { name: 'Columbia', folderPath: '/COL QuickTime' },
    { name: 'Charleston', folderPath: '/CHS QuickTime' }
];

async function listFilesByDate(dbx, folderPath, dateStr) {
    const matchedFiles = [];
    try {
        let response = await dbx.filesListFolder({
            path: folderPath,
            recursive: false,
            include_media_info: false,
            include_deleted: false
        });

        let hasMore = response.result.has_more;
        let cursor = response.result.cursor;
        let entries = response.result.entries;

        while (true) {
            for (const entry of entries) {
                if (entry['.tag'] !== 'file') continue;
                
                // Exclude obvious non-media files (optional, but good safety)
                if (entry.name.startsWith('.')) continue;

                // Check date string (YYYY-MM-DD)
                const fileDateStr = new Date(entry.server_modified).toISOString().split('T')[0];
                if (fileDateStr === dateStr) {
                    matchedFiles.push(entry);
                }
            }

            if (!hasMore) break;

            response = await dbx.filesListFolderContinue({ cursor });
            hasMore = response.result.has_more;
            cursor = response.result.cursor;
            entries = response.result.entries;
        }
    } catch (err) {
        console.error(`[Dropbox] Error listing files in ${folderPath}:`, err.message);
    }
    
    return matchedFiles;
}

async function downloadLargeFile(dbx, dropboxFilePath, destinationLocalPath) {
    const tempLinkRes = await dbx.filesGetTemporaryLink({ path: dropboxFilePath });
    const downloadUrl = tempLinkRes.result.link;

    const response = await fetch(downloadUrl);
    if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
    }

    const fileWriteStream = fs.createWriteStream(destinationLocalPath);
    await pipeline(Readable.fromWeb(response.body), fileWriteStream);
    
    return destinationLocalPath;
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.mov': return 'video/quicktime';
        case '.mp4': return 'video/mp4';
        case '.m4a': return 'audio/mp4';
        case '.mp3': return 'audio/mpeg';
        case '.webm': return 'video/webm';
        case '.wav': return 'audio/wav';
        default: return 'video/mp4'; // fallback
    }
}

async function runDailyEvaluation() {
    if (!process.env.DROPBOX_APP_KEY || !process.env.DROPBOX_APP_SECRET || !process.env.DROPBOX_REFRESH_TOKEN) {
        console.warn("[Dropbox Evaluator] Missing Dropbox credentials in .env. Skipping daily evaluation.");
        return;
    }

    console.log("[Dropbox Evaluator] Starting daily class facilitation evaluation job...");
    
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const dbx = new Dropbox({
        clientId: process.env.DROPBOX_APP_KEY,
        clientSecret: process.env.DROPBOX_APP_SECRET,
        refreshToken: process.env.DROPBOX_REFRESH_TOKEN
    });

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    for (const center of CENTERS) {
        console.log(`[Dropbox Evaluator] Checking folder for ${center.name} (${center.folderPath}) for date: ${today}`);
        
        const filesToProcess = await listFilesByDate(dbx, center.folderPath, today);
        
        if (filesToProcess.length === 0) {
            console.log(`[Dropbox Evaluator] No recordings found today for ${center.name}.`);
            continue;
        }

        console.log(`[Dropbox Evaluator] Found ${filesToProcess.length} recordings for ${center.name}. Processing...`);

        for (const file of filesToProcess) {
            const localPath = path.join(TEMP_DIR, `${Date.now()}_${file.name}`);
            try {
                console.log(`[Dropbox Evaluator] Downloading ${file.name} to local temp storage...`);
                await downloadLargeFile(dbx, file.path_lower, localPath);

                console.log(`[Dropbox Evaluator] Sending ${file.name} to Gemini for evaluation...`);
                const mimeType = getMimeType(file.name);
                
                // Format the title nicely based on the filename
                const sessionTitle = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");

                // Evaluate
                await evaluateClassMedia(center.name, sessionTitle, 'Staff Facilitator', localPath, mimeType);
                console.log(`[Dropbox Evaluator] Successfully evaluated ${file.name} for ${center.name}.`);

            } catch (err) {
                console.error(`[Dropbox Evaluator] Failed to process ${file.name}:`, err);
            } finally {
                // Cleanup local temp file
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                    console.log(`[Dropbox Evaluator] Deleted local temp file ${localPath}.`);
                }
            }
        }
    }
    
    console.log("[Dropbox Evaluator] Daily evaluation job completed.");
}

function initCronJobs() {
    // Run at 11:00 PM (23:00) Eastern Time every weekday (Monday-Friday)
    // Format: 'minute hour dayOfMonth month dayOfWeek'
    cron.schedule('0 23 * * 1-5', async () => {
        await runDailyEvaluation();
    }, {
        scheduled: true,
        timezone: "America/New_York"
    });

    console.log("[Cron] Scheduled Dropbox daily class evaluation job for 11 PM Mon-Fri.");
}

module.exports = { initCronJobs, runDailyEvaluation };
