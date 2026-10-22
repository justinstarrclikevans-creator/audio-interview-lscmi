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

    // Check recent dates (today and past 2 days) to catch evening recordings or weekend/Monday syncs
    const checkDates = [];
    const today = new Date();
    for (let i = 0; i <= 2; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        checkDates.push(d.toISOString().split('T')[0]);
    }

    const { db } = require('../db');
    
    const results = { processed: 0, skipped: 0, errors: [], totalFound: 0 };

    for (const center of CENTERS) {
        if (global.syncStatus) global.syncStatus.log = `Checking ${center.name}...`;
        console.log(`[Dropbox Evaluator] Checking folder for ${center.name} (${center.folderPath}) for dates: ${checkDates.join(', ')}`);
        
        const filesToProcess = await listFilesByDate(dbx, center.folderPath, checkDates);
        
        if (filesToProcess.length === 0) {
            console.log(`[Dropbox Evaluator] No recordings found for ${center.name}.`);
            continue;
        }

        console.log(`[Dropbox Evaluator] Found ${filesToProcess.length} recordings for ${center.name}. Processing each session individually...`);
        results.totalFound += filesToProcess.length;

        // Process EACH class session file individually so morning and afternoon facilitators are NEVER graded on each other!
        for (const file of filesToProcess) {
            const lowerName = file.name.toLowerCase();
            const isAm = lowerName.includes('_am') || lowerName.includes('am_') || lowerName.includes('morning');
            const isPm = lowerName.includes('_pm') || lowerName.includes('pm_') || lowerName.includes('afternoon');
            const shift = isAm ? 'Morning (AM)' : (isPm ? 'Afternoon (PM)' : 'Class Session');

            // Parse date from filename (e.g. 261012 -> 2026-10-12) or server_modified
            let fileDateStr = new Date(file.server_modified).toISOString().split('T')[0];
            const matchDate = file.name.match(/(\d{2})(\d{2})(\d{2})/);
            if (matchDate) {
                fileDateStr = `20${matchDate[1]}-${matchDate[2]}-${matchDate[3]}`;
            }

            const sessionTitle = `${center.name} ${shift} - ${fileDateStr}`;
            let defaultFacilitator;
            if (center.name === 'Spartanburg') {
                defaultFacilitator = `TB (Spartanburg ${shift})`;
            } else if (center.name === 'Columbia') {
                defaultFacilitator = isPm ? 'Jenn Jeanquart (Columbia PM)' : 'Diyoung Dantzler (Columbia AM)';
            } else {
                defaultFacilitator = `Staff Facilitator - Charleston (${shift})`;
            }

            // Check if already evaluated in database
            const existingEval = db.prepare('SELECT id FROM class_facilitation_evaluations WHERE session_title = ? AND location = ?').get(sessionTitle, center.name);
            if (existingEval) {
                console.log(`[Dropbox Evaluator] Skipping ${sessionTitle} (${center.name}) - already evaluated.`);
                results.skipped++;
                continue;
            }

            const localPath = path.join(TEMP_DIR, `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9-_\.]/g, '_')}`);
            if (global.syncStatus) global.syncStatus.log = `Downloading ${center.name} ${file.name}...`;
            console.log(`[Dropbox Evaluator] Downloading ${center.name} ${file.name}...`);

            try {
                await downloadLargeFile(dbx, file.path_lower, localPath);

                if (!validateM4A(localPath, file.name)) {
                    console.error(`[Dropbox Evaluator] Corrupted file detected (missing moov atom): ${file.name}. Skipping.`);
                    if (global.syncStatus) global.syncStatus.log = `Skipping corrupted file ${file.name}...`;
                    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                    results.errors.push(`${sessionTitle} (${file.name}): Corrupted media file detected.`);
                    continue;
                }

                if (global.syncStatus) global.syncStatus.log = `Uploading ${center.name} ${file.name} to Gemini...`;
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

                // Immediately clean up local disk
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                }

                if (global.syncStatus) global.syncStatus.log = `Grading ${center.name} ${sessionTitle}...`;
                console.log(`[Dropbox Evaluator] Evaluating ${center.name} - ${sessionTitle} individually...`);

                await evaluateClassMedia(center.name, sessionTitle, defaultFacilitator, [{ file: uploadData.file }]);
                console.log(`[Dropbox Evaluator] Successfully evaluated ${center.name} - ${sessionTitle}.`);
                results.processed++;

            } catch (err) {
                console.error(`[Dropbox Evaluator] Failed to process ${sessionTitle}:`, err);
                results.errors.push(`${sessionTitle}: ${err.message}`);
                if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
            }
        }
    }
    
    console.log("[Dropbox Evaluator] Daily evaluation job completed.", results);
    await sendDailyReportEmail(checkDates[0]);
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


async function sendDailyReportEmail(dateStr) {
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

        // Get recent evaluations ordered by location and date
        const evaluations = db.prepare(`
            SELECT location, facilitator_name, session_title, total_score, summary_markdown, coaching_feedback 
            FROM class_facilitation_evaluations 
            WHERE created_at >= date('now', '-2 days') OR session_title LIKE ?
            ORDER BY location ASC, created_at DESC
        `).all(`%${dateStr}%`);
        
        if (evaluations.length === 0) {
            console.log("No evaluations to email for " + dateStr);
            return;
        }
        
        let htmlContent = `<h2 style="color: #1e3a8a;">Turn90 Class Facilitation QA & Coaching Report</h2>`;
        htmlContent += `<p>Here are the latest automated evaluation results, organized independently by Turn90 Center:</p><hr/>`;
        
        // Group evaluations strictly by Center
        const byCenter = {};
        evaluations.forEach(e => {
            if (!byCenter[e.location]) byCenter[e.location] = [];
            byCenter[e.location].push(e);
        });

        for (const [centerName, centerEvals] of Object.entries(byCenter)) {
            htmlContent += `
                <div style="margin-top: 25px; margin-bottom: 12px; background: #f8fafc; border-left: 4px solid #0f766e; padding: 10px 16px; border-radius: 4px;">
                    <h3 style="margin: 0; color: #0f766e; text-transform: uppercase; font-size: 15px;">📍 ${centerName} Center (${centerEvals.length} Session${centerEvals.length > 1 ? 's' : ''})</h3>
                </div>
            `;

            centerEvals.forEach(e => {
                htmlContent += `
                    <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px;">
                            <strong style="color: #1e293b; font-size: 15px;">${e.session_title}</strong>
                            <span style="font-size: 16px; font-weight: 800; color: #15803d;">Score: ${e.total_score} / 100</span>
                        </div>
                        <p style="margin: 4px 0;"><strong>Facilitator:</strong> ${e.facilitator_name}</p>
                        <p style="margin: 6px 0;"><strong>Coaching Highlights:</strong><br/> ${e.coaching_feedback}</p>
                    </div>
                `;
            });
        }
        
        const mailOptions = {
            from: `"Turn90 Automated QA Evaluator" <${user}>`,
            to: user,
            subject: `Turn90 Daily Facilitation Scores - ${dateStr}`,
            html: htmlContent
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`Successfully emailed daily scores to ${user}`);
        
    } catch (e) {
        console.error("Failed to send daily report email:", e);
    }
}
