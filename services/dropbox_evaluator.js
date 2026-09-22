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


function validateM4A(filePath, filename) {
    const ext = require('path').extname(filename).toLowerCase();
    if (ext === '.m4a' || ext === '.mp4' || ext === '.mov') {
        try {
            const cp = require('child_process');
            const ffprobe = require('ffprobe-static');
            // Check if moov atom exists / format is valid by getting duration
            cp.execSync(`"${ffprobe.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
            return true;
        } catch(e) {
            console.error('[Dropbox Evaluator] ffprobe validation failed:', e.stderr ? e.stderr.toString() : e.message);
            return false;
        }
    }
    return true;
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

    // Get yesterday's date
    const yDate = new Date();
    yDate.setDate(yDate.getDate() - 1);
    const yesterday = yDate.toISOString().split('T')[0];

    const { db } = require('../db');
    
    const results = { processed: 0, skipped: 0, errors: [], totalFound: 0 };

    for (const center of CENTERS) {
        if (global.syncStatus) global.syncStatus.log = `Checking ${center.name}...`;
        console.log(`[Dropbox Evaluator] Checking folder for ${center.name} (${center.folderPath}) for date: ${yesterday}`);
        
        const filesToProcess = await listFilesByDate(dbx, center.folderPath, [yesterday]);
        
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
                    const localPath = path.join(TEMP_DIR, `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9-_\.]/g, '_')}`);
                    if (global.syncStatus) global.syncStatus.log = `Downloading ${file.name}...`;
                    console.log(`[Dropbox Evaluator] Downloading ${file.name}...`);
                    
                    await downloadLargeFile(dbx, file.path_lower, localPath);
                    
                    if (!validateM4A(localPath, file.name)) {
                        console.error(`[Dropbox Evaluator] Corrupted file detected (missing moov atom): ${file.name}. Skipping.`);
                        if (global.syncStatus) global.syncStatus.log = `Skipping corrupted file ${file.name}...`;
                        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                        results.errors.push(`${sessionTitle} (${file.name}): Corrupted media file detected.`);
                        continue;
                    }

                    
                    if (global.syncStatus) global.syncStatus.log = `Uploading ${file.name} to Gemini...`;
                    console.log(`[Dropbox Evaluator] Uploading ${file.name} to Gemini in a RAM-safe stream...`);
                    
                    const mimeType = getMimeType(file.name);
                    const https = require('https');
                    const uploadData = await new Promise((resolve, reject) => {
                        const stats = fs.statSync(localPath);
                        const options = {
                            hostname: 'generativelanguage.googleapis.com',
                            port: 443,
                            path: `/upload/v1beta/files?key=${process.env.GEMINI_API_KEY}`,
                            method: 'POST',
                            headers: {
                                'X-Goog-Upload-Protocol': 'raw',
                                'X-Goog-Upload-Command': 'start, upload, finalize',
                                'X-Goog-Upload-Header-Content-Length': stats.size,
                                'X-Goog-Upload-File-Name': path.basename(localPath),
                                'Content-Type': mimeType,
                                'Content-Length': stats.size
                            }
                        };
                        const req = https.request(options, (res) => {
                            let data = '';
                            res.on('data', chunk => data += chunk);
                            res.on('end', () => {
                                if (res.statusCode >= 200 && res.statusCode < 300) {
                                    resolve(JSON.parse(data));
                                } else {
                                    reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
                                }
                            });
                        });
                        req.on('error', reject);
                        fs.createReadStream(localPath).pipe(req);
                    });
                    
                    localMediaFiles.push({ file: uploadData.file });
                    
                    if (fs.existsSync(localPath)) {
                        fs.unlinkSync(localPath);
                    }
                    console.log(`[Dropbox Evaluator] Streamed ${file.name} successfully.`);
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
    await sendDailyReportEmail(yesterday);
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


async function sendDailyReportEmail(yesterdayStr) {
    try {
        const nodemailer = require('nodemailer');
        const { db } = require('../db');
        const path = require('path');
        
        // Ensure .env is loaded for email credentials
        require('dotenv').config({ path: path.join(__dirname, '..', '..', 'email-settings.txt') });
        
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_APP_PASSWORD;
        
        if (!user || !pass) {
            console.log("No email credentials found. Skipping email report.");
            return;
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user, pass }
        });

        // Get evaluations that were processed today (or for the given session title)
        const sessionTitle = `Class Sessions - ${yesterdayStr}`;
        const evaluations = db.prepare('SELECT location, facilitator_name, total_score, summary_markdown, coaching_feedback FROM class_facilitation_evaluations WHERE session_title = ?').all(sessionTitle);
        
        if (evaluations.length === 0) {
            console.log("No evaluations to email for " + yesterdayStr);
            return;
        }
        
        let htmlContent = `<h2 style="color: #1e3a8a;">Daily Class Facilitation Scores</h2><p>Here are the automated evaluation results for <strong>${sessionTitle}</strong>:</p><hr/>`;
        
        evaluations.forEach(e => {
            htmlContent += `
                <div style="margin-bottom: 25px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h3 style="margin-top: 0; color: #0f766e;">${e.location} - ${e.facilitator_name}</h3>
                    <p style="font-size: 18px; font-weight: bold; color: #15803d;">Total Score: ${e.total_score}</p>
                    <p><strong>Summary:</strong><br/> ${e.summary_markdown}</p>
                    <p><strong>Coaching Feedback:</strong><br/> ${e.coaching_feedback}</p>
                </div>
            `;
        });
        
        const mailOptions = {
            from: `"Turn90 Automated Evaluator" <${user}>`,
            to: user, // Emailing to themselves as requested
            subject: `Daily Facilitation Scores - ${yesterdayStr}`,
            html: htmlContent
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`Successfully emailed daily scores to ${user}`);
        
    } catch (e) {
        console.error("Failed to send daily report email:", e);
    }
}
