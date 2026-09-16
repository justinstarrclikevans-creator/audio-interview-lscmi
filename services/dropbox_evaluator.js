const cron = require('node-cron');
const { Dropbox } = require('dropbox');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { evaluateClassMedia } = require('../facilitation_evaluator');

const os = require('os');
const TEMP_DIR = path.join(os.tmpdir(), 'turn90_temp_dropbox');

// Define the centers and their corresponding Dropbox paths
const CENTERS = [
    { name: 'Spartanburg', folderPath: '/SPB QuickTime' },
    { name: 'Columbia', folderPath: '/COL QuickTime' },
    { name: 'Charleston', folderPath: '/CHS QuickTime' }
];

async function listFilesByDate(dbx, folderPath, dateStrs) {
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
                if (dateStrs.includes(fileDateStr)) {
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
    // Ensure URL is perfectly valid for Node 18+ fetch to avoid DOMException on spaces
    const safeUrl = new URL(downloadUrl).toString();
    const response = await fetch(safeUrl);
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
        return { error: "Missing Dropbox credentials in Render Environment Variables. Please add DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN." };
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

    // Get today and yesterday's dates
    const today = new Date().toISOString().split('T')[0];
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yesterday = yDate.toISOString().split('T')[0];

    const { db } = require('../db');
    
    const results = { processed: 0, skipped: 0, errors: [], totalFound: 0 };

    for (const center of CENTERS) {
        if (global.syncStatus) global.syncStatus.log = `Checking ${center.name}...`;
        console.log(`[Dropbox Evaluator] Checking folder for ${center.name} (${center.folderPath}) for dates: ${today}, ${yesterday}`);
        
        const filesToProcess = await listFilesByDate(dbx, center.folderPath, [today, yesterday]);
        
        if (filesToProcess.length === 0) {
            console.log(`[Dropbox Evaluator] No recordings found for ${center.name}.`);
            continue;
        }

        console.log(`[Dropbox Evaluator] Found ${filesToProcess.length} recordings for ${center.name}. Processing...`);
        results.totalFound += filesToProcess.length;

        const filesByDate = {};
        for (const file of filesToProcess) {
            const dateStr = new Date(file.server_modified).toISOString().split('T')[0];
            if (!filesByDate[dateStr]) filesByDate[dateStr] = [];
            filesByDate[dateStr].push(file);
        }

        for (const dateStr of Object.keys(filesByDate)) {
            const dateFiles = filesByDate[dateStr];
            const sessionTitle = `Class Sessions - ${dateStr}`;

            const existingEval = db.prepare('SELECT id FROM class_facilitation_evaluations WHERE session_title = ? AND location = ?').get(sessionTitle, center.name);
            if (existingEval) {
                console.log(`[Dropbox Evaluator] Skipping ${sessionTitle} - already evaluated.`);
                results.skipped += dateFiles.length;
                continue;
            }

            const localMediaFiles = [];
            try {
                const { GoogleAIFileManager } = require("@google/generative-ai/server");
                const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

                for (const file of dateFiles) {
                    const localPath = path.join(TEMP_DIR, `${Date.now()}_${file.name}`);
                    if (global.syncStatus) global.syncStatus.log = `Downloading ${file.name}...`;
                    console.log(`[Dropbox Evaluator] Downloading ${file.name}...`);
                    await downloadLargeFile(dbx, file.path_lower, localPath);
                    
                    if (global.syncStatus) global.syncStatus.log = `Uploading ${file.name} to Gemini...`;
                    console.log(`[Dropbox Evaluator] Uploading ${file.name} to Gemini to free space...`);
                    const uploadResult = await fileManager.uploadFile(localPath, { mimeType: getMimeType(file.name) });
                    localMediaFiles.push(uploadResult);
                    
                    // INSTANT CLEANUP to prevent ENOSPC on Render
                    if (fs.existsSync(localPath)) {
                        fs.unlinkSync(localPath);
                        console.log(`[Dropbox Evaluator] Deleted local temp file ${localPath} after upload.`);
                    }
                }

                if (global.syncStatus) global.syncStatus.log = `Grading ${sessionTitle}...`;
                console.log(`[Dropbox Evaluator] Sending ${sessionTitle} (${dateFiles.length} files) to Gemini...`);
                
                await evaluateClassMedia(center.name, sessionTitle, 'Staff Facilitator', localMediaFiles);
                console.log(`[Dropbox Evaluator] Successfully evaluated ${sessionTitle}.`);
                results.processed += dateFiles.length;

            } catch (err) {
                console.error(`[Dropbox Evaluator] Failed to process ${sessionTitle}:`, err);
                results.errors.push(`${sessionTitle}: ${err.message}`);
            }
        }
    }
    
    console.log("[Dropbox Evaluator] Daily evaluation job completed.", results);
    return results;
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
