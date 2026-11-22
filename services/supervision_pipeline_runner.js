const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { marked } = require('marked');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
    getGeminiApiKey,
    getFastModelName,
    buildBudgetGenerationConfig,
    assertWithinDailyGeminiCap
} = require('../env_config');
const { processApricotWorkbook } = require('./apricot_eval_engine');
const { syncAllParticipantFolders } = require('./participant_folder_manager');

const BUNDLED_DIR = path.join(__dirname, '..', 'supervision_pipeline');
const EXTERNAL_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'pipelines', 'supervision-report');
const SUPERVISION_DIR = fs.existsSync(BUNDLED_DIR) ? BUNDLED_DIR : EXTERNAL_DIR;
const REPORTS_DIR = path.join(SUPERVISION_DIR, 'reports');
const EXPORTS_DIR = path.join(SUPERVISION_DIR, 'apricot_exports');
const SKILLCAT_HISTORY_PATH = path.join(SUPERVISION_DIR, 'skillcat_history.json');
const FEEDBACK_CACHE_PATH = path.join(SUPERVISION_DIR, 'case_feedback_cache.json');
const EMAIL_ROUTING_PATH = path.join(SUPERVISION_DIR, 'email_routing.json');

const CENTERS = ['Charleston', 'Columbia', 'Spartanburg'];
const CENTER_CM_MAP = {
    Charleston: 'TB',
    Columbia: 'Jenn',
    Spartanburg: 'DiYoung'
};
const GATE_DENOMINATORS = { 1: 8, 2: 10, 3: 7, 4: 8 };
const TOTAL_BRIEFCASE_ITEMS = 33;
const REPORT_SCOPES = ['Universal', 'Charleston', 'Columbia', 'Spartanburg', 'SkillCat'];

const DEFAULT_EMAIL_ROUTING = {
    Universal: ['daisy@turnninety.com', 'justin@turnninety.com'],
    Charleston: ['terrence.brown@turnninety.com'],
    Columbia: ['terrance@turnninety.com', 'jenn@turnninety.com'],
    Spartanburg: ['Matt@turnninety.com', 'diyoung@turnninety.com'],
    SkillCat: []
};

function ensureDirs() {
    [SUPERVISION_DIR, REPORTS_DIR, EXPORTS_DIR].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
    if (!fs.existsSync(EMAIL_ROUTING_PATH)) {
        fs.writeFileSync(EMAIL_ROUTING_PATH, JSON.stringify(DEFAULT_EMAIL_ROUTING, null, 2) + '\n', 'utf8');
    }
}

function getSupervisionPipelineDir() {
    return SUPERVISION_DIR;
}

function readEmailRouting() {
    ensureDirs();
    try {
        return JSON.parse(fs.readFileSync(EMAIL_ROUTING_PATH, 'utf8'));
    } catch (e) {
        return { ...DEFAULT_EMAIL_ROUTING };
    }
}

function getEasternDateString(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day}`;
}

function sanitizeDateParam(dateStr) {
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) {
        return String(dateStr).trim();
    }
    return null;
}

function sanitizeScopeParam(scope) {
    const clean = REPORT_SCOPES.find(s => s.toLowerCase() === String(scope || '').trim().toLowerCase());
    return clean || 'Universal';
}

function getSkillCatPdfPath(dateStr) {
    const dated = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${dateStr}.pdf`);
    if (fs.existsSync(dated)) return dated;
    const latest = path.join(SUPERVISION_DIR, 'SkillCat_Supervision_Report_Latest.pdf');
    return fs.existsSync(latest) ? latest : dated;
}

function listAvailableReportDates() {
    ensureDirs();
    const dates = new Set();
    if (fs.existsSync(REPORTS_DIR)) {
        fs.readdirSync(REPORTS_DIR).forEach(entry => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
                const full = path.join(REPORTS_DIR, entry);
                if (fs.statSync(full).isDirectory()) dates.add(entry);
            }
        });
    }
    if (fs.existsSync(SUPERVISION_DIR)) {
        fs.readdirSync(SUPERVISION_DIR).forEach(file => {
            const m = file.match(/^SkillCat_Supervision_Report_(\d{4}-\d{2}-\d{2})\.(pdf|md)$/);
            if (m) dates.add(m[1]);
        });
    }
    return Array.from(dates).sort().reverse();
}

function listReportsForDate(dateStr) {
    const cleanDate = sanitizeDateParam(dateStr) || listAvailableReportDates()[0] || getEasternDateString();
    const dayDir = path.join(REPORTS_DIR, cleanDate);
    return REPORT_SCOPES.map(scope => {
        if (scope === 'SkillCat') {
            const pdfPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${cleanDate}.pdf`);
            const mdPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${cleanDate}.md`);
            return {
                scope,
                date: cleanDate,
                has_md: fs.existsSync(mdPath),
                has_pdf: fs.existsSync(pdfPath),
                pdf_filename: path.basename(pdfPath)
            };
        }
        const mdPath = path.join(dayDir, `Turn90_Combined_Report_${scope}_${cleanDate}.md`);
        const pdfPath = path.join(dayDir, `Turn90_Combined_Report_${scope}_${cleanDate}.pdf`);
        return {
            scope,
            date: cleanDate,
            has_md: fs.existsSync(mdPath),
            has_pdf: fs.existsSync(pdfPath),
            pdf_filename: path.basename(pdfPath)
        };
    });
}

function getReportPdfPath(dateStr, scope = 'Universal') {
    const cleanScope = sanitizeScopeParam(scope);
    const cleanDate = sanitizeDateParam(dateStr) || listAvailableReportDates()[0] || getEasternDateString();
    if (cleanScope === 'SkillCat') {
        const scPdf = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${cleanDate}.pdf`);
        if (fs.existsSync(scPdf)) return scPdf;
        const latestSc = path.join(SUPERVISION_DIR, 'SkillCat_Supervision_Report_Latest.pdf');
        return fs.existsSync(latestSc) ? latestSc : null;
    }
    const p = path.join(REPORTS_DIR, cleanDate, `Turn90_Combined_Report_${cleanScope}_${cleanDate}.pdf`);
    if (fs.existsSync(p)) return p;
    if (cleanScope === 'Universal') {
        const latestUniv = path.join(SUPERVISION_DIR, 'Turn90_Combined_Report_Latest.pdf');
        if (fs.existsSync(latestUniv)) return latestUniv;
    }
    return null;
}

function readReportMarkdown(dateStr, scope = 'Universal') {
    const cleanScope = sanitizeScopeParam(scope);
    const cleanDate = sanitizeDateParam(dateStr) || listAvailableReportDates()[0] || getEasternDateString();
    if (cleanScope === 'SkillCat') {
        const mdPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${cleanDate}.md`);
        if (fs.existsSync(mdPath)) return fs.readFileSync(mdPath, 'utf8');
        // Fallback markdown rendered from skillcat_history.json if historical PDF-only date selected
        const scHist = readSkillCatHistorySafe();
        const snaps = scHist.snapshots || {};
        const snapKey = snaps[cleanDate] ? cleanDate : (Object.keys(snaps).sort().pop() || '');
        const rows = snapKey ? Object.values(snaps[snapKey]) : [];
        if (rows.length > 0) {
            return buildSkillCatMarkdown(rows, cleanDate);
        }
        return `# Turn90 SkillCat Supervision Report — ${cleanDate}\n\nClick **Download / View PDF** to inspect the archival SkillCat PDF for ${cleanDate}.`;
    }
    const mdPath = path.join(REPORTS_DIR, cleanDate, `Turn90_Combined_Report_${cleanScope}_${cleanDate}.md`);
    if (fs.existsSync(mdPath)) {
        return fs.readFileSync(mdPath, 'utf8');
    }
    return null;
}

function getArchiveOverview() {
    ensureDirs();
    const dates = listAvailableReportDates();
    const latestDate = dates[0] || getEasternDateString();
    const emailRouting = readEmailRouting();
    const scHist = readSkillCatHistorySafe();
    const scSnapshots = Object.keys(scHist.snapshots || {}).sort();
    const smtpConfigured = Boolean((process.env.SMTP_EMAIL || process.env.EMAIL_USER) && (process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD));
    return {
        latest_date: latestDate,
        available_dates: dates,
        scopes: listReportsForDate(latestDate),
        email_routing: emailRouting,
        smtp_configured: smtpConfigured,
        apricot_configured: Boolean(process.env.APRICOT_EMAIL && process.env.APRICOT_PASSWORD),
        skillcat_cookie_configured: Boolean(process.env.SKILLCAT_COOKIE_VALUE || process.env.SKILLCAT_STORAGE_STATE_JSON || (process.env.SKILLCAT_EMAIL && process.env.SKILLCAT_PASSWORD)),
        latest_skillcat_snapshot: scSnapshots[scSnapshots.length - 1] || null,
        cron_schedule: process.env.SUPERVISION_CRON_SCHEDULE || '0 21 * * 1-5',
        cron_enabled: process.env.SUPERVISION_DISABLE_CRON !== 'true'
    };
}

// =====================================================================
// SKILLCAT SCRAPER & MARKDOWN/PDF BUILDER (PURE NODE)
// =====================================================================
function readSkillCatHistorySafe() {
    try {
        if (fs.existsSync(SKILLCAT_HISTORY_PATH)) {
            return JSON.parse(fs.readFileSync(SKILLCAT_HISTORY_PATH, 'utf8'));
        }
    } catch (e) {}
    return { snapshots: {} };
}

function classifySkillCatPathway(courseName) {
    const lower = String(courseName || '').toLowerCase();
    if (/(hvac|epa 608|refrigerant|duct|condensate|furnace|heat pump|air conditioning|thermostat)/.test(lower)) return 'HVAC';
    if (/(electr|fuse|breaker|multimeter|wiring|voltage|circuit|conduit|ohm)/.test(lower)) return 'Electrical';
    if (/(plumb|pipe|piping|drain|faucet|toilet|water heater|valve)/.test(lower)) return 'Plumbing';
    if (/(appliance|maintenance|carpentry|drywall|paint|lock|facilities|measurement|tool)/.test(lower)) return 'Facilities_Maintenance';
    if (/(cdl|commercial driving|forklift|osha|safety|lockout)/.test(lower)) return 'Commercial_Safety';
    return 'Work_Readiness_General';
}

function getLastNWorkingDaysIso(refDateStr, n = 5) {
    const days = [];
    const cur = new Date(`${refDateStr}T12:00:00Z`);
    while (days.length < n) {
        const wd = cur.getUTCDay();
        if (wd >= 1 && wd <= 5) {
            days.push(cur.toISOString().slice(0, 10));
        }
        cur.setUTCDate(cur.getUTCDate() - 1);
    }
    days.reverse();
    return days;
}

function buildSkillCatMarkdown(learners, reportDateStr) {
    const flagged = learners.filter(l => l.flagged_2_working_days || (l.total_courses || 0) === 0);
    const lines = [
        `# Turn90 SkillCat Daily Supervision Report — ${reportDateStr}`,
        `**Total Learners:** ${learners.length} | **Flagged (0 Modules in Last 2 Working Days or 0 Total):** ${flagged.length}`,
        '',
        '| Learner | Pathway | Total Modules | Last 5 Workdays | Latest Completion | Status |',
        '|---|---|---:|---:|---|---|'
    ];
    for (const l of [...learners].sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''))) {
        const isFlagged = l.flagged_2_working_days || (l.total_courses || 0) === 0;
        const status = isFlagged ? 'FLAGGED (Stalled 2+ Workdays)' : 'On Track';
        lines.push(`| ${l.fullname || 'Unknown'} | ${l.pathway || 'Unassigned'} | ${l.total_courses || 0} | ${l.completed_last_5_working_days || 0} | ${l.latest_completion_date || 'None'} | ${status} |`);
    }
    return lines.join('\n');
}

function findChromeExecutable() {
    const os = require('os');
    const explicit = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (explicit && fs.existsSync(explicit)) return explicit;

    const fixedCandidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    for (const p of fixedCandidates) {
        if (fs.existsSync(p)) return p;
    }

    // Check Playwright Chromium caches on macOS / Linux if present
    const cacheDirs = [
        path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
        path.join(os.homedir(), '.cache', 'ms-playwright')
    ];
    for (const dir of cacheDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const entries = fs.readdirSync(dir).filter(d => d.startsWith('chromium')).sort().reverse();
            for (const entry of entries) {
                const subCandidates = [
                    path.join(dir, entry, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                    path.join(dir, entry, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                    path.join(dir, entry, 'chrome-linux', 'chrome')
                ];
                for (const sc of subCandidates) {
                    if (fs.existsSync(sc)) return sc;
                }
            }
        } catch (e) {}
    }
    return null;
}

async function launchHeadlessBrowser() {
    const puppeteer = require('puppeteer');
    const executablePath = findChromeExecutable();
    const opts = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };
    if (executablePath) opts.executablePath = executablePath;
    return puppeteer.launch(opts);
}

async function launchHeadlessBrowserSafe() {
    try {
        return await launchHeadlessBrowser();
    } catch (e) {
        console.warn('[Supervision] Headless Chromium unavailable, using pure-JS pdfkit fallback:', e.message);
        return null;
    }
}

async function fetchSkillCatRankedHtml() {
    const targetUrl = 'https://skillcat.app/local/skillcat/pages/ranked-list.php';
    const cookieHeaderParts = [];
    if (process.env.SKILLCAT_STORAGE_STATE_JSON) {
        try {
            let rawJson = process.env.SKILLCAT_STORAGE_STATE_JSON.trim();
            if (!rawJson.startsWith('{')) rawJson = Buffer.from(rawJson, 'base64').toString('utf8');
            const parsed = JSON.parse(rawJson);
            for (const c of (parsed.cookies || [])) {
                if ((c.domain || '').includes('skillcat.app')) {
                    cookieHeaderParts.push(`${c.name}=${c.value}`);
                }
            }
        } catch (e) {}
    } else if (process.env.SKILLCAT_COOKIE_VALUE) {
        const cName = process.env.SKILLCAT_COOKIE_NAME || 'MoodleSession';
        cookieHeaderParts.push(`${cName}=${process.env.SKILLCAT_COOKIE_VALUE}`);
    }

    if (cookieHeaderParts.length > 0) {
        const res = await fetch(targetUrl, {
            headers: {
                Cookie: cookieHeaderParts.join('; '),
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            redirect: 'manual'
        });
        const html = await res.text();
        if (res.status === 200 && html.includes('const training_data =')) {
            return { html, isLive: true, source: 'cookie' };
        }
    }

    // Try Puppeteer login if SKILLCAT_EMAIL + SKILLCAT_PASSWORD are set
    if (process.env.SKILLCAT_EMAIL && process.env.SKILLCAT_PASSWORD) {
        let browser;
        try {
            browser = await launchHeadlessBrowser();
            const page = await browser.newPage();
            await page.goto('https://skillcat.app/login/index.php', { waitUntil: 'networkidle2', timeout: 45000 });
            const hasUser = await page.$('input[name="username"]');
            if (hasUser) {
                await page.type('input[name="username"]', process.env.SKILLCAT_EMAIL);
                await page.type('input[name="password"]', process.env.SKILLCAT_PASSWORD);
                await Promise.all([
                    page.click('#loginbtn'),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
                ]);
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                const html = await page.content();
                if (html.includes('const training_data =')) {
                    return { html, isLive: true, source: 'puppeteer_login' };
                }
            }
        } catch (e) {
            console.warn('[Supervision] SkillCat Puppeteer login failed:', e.message);
        } finally {
            if (browser) await browser.close().catch(() => {});
        }
    }
    return { html: null, isLive: false, source: 'cached_snapshot' };
}

async function fetchEmployeePortfolioNode(emp) {
    const url = emp.portfolio_link || '';
    const completedCourses = [];
    if (url) {
        try {
            const resp = await fetch(url, { timeout: 20000 });
            if (resp.ok) {
                const html = await resp.text();
                const cardMatches = html.matchAll(/class="[^"]*course-card[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi);
                // Robust regex extraction across course-name and completion-date spans/divs
                const blockRegex = /class="[^"]*course-name[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]*?(?:class="[^"]*completion-date[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>)?/gi;
                let m;
                while ((m = blockRegex.exec(html)) !== null) {
                    const courseName = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    const rawDate = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/Completed:/i, '').replace(/\s+/g, ' ').trim();
                    let isoDate = rawDate;
                    if (rawDate) {
                        const parsed = new Date(rawDate);
                        if (!Number.isNaN(parsed.getTime())) {
                            isoDate = parsed.toISOString().slice(0, 10);
                        }
                    }
                    if (courseName) {
                        completedCourses.push({
                            course_name: courseName,
                            completed_date: isoDate,
                            completed_date_raw: rawDate
                        });
                    }
                }
                void cardMatches;
            }
        } catch (e) { /* keep empty on timeout */ }
    }
    return {
        ...emp,
        completed_courses: completedCourses,
        total_courses: completedCourses.length
    };
}

async function runSkillCatScrapeNode(reportDateStr = getEasternDateString(), sharedBrowser = null) {
    ensureDirs();
    const fetched = await fetchSkillCatRankedHtml();
    const history = readSkillCatHistorySafe();
    history.snapshots = history.snapshots || {};

    if (!fetched.isLive || !fetched.html) {
        const latestKey = Object.keys(history.snapshots).sort().pop();
        const existingLearners = latestKey ? Object.values(history.snapshots[latestKey]) : [];
        if (existingLearners.length > 0) {
            const mdText = buildSkillCatMarkdown(existingLearners, reportDateStr);
            const mdPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${reportDateStr}.md`);
            const pdfPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${reportDateStr}.pdf`);
            fs.writeFileSync(mdPath, mdText, 'utf8');
            await renderMarkdownToPdfFile(mdText, pdfPath, `Turn90 SkillCat Report (${reportDateStr})`, sharedBrowser);
            fs.copyFileSync(pdfPath, path.join(SUPERVISION_DIR, 'SkillCat_Supervision_Report_Latest.pdf'));
        }
        return {
            live: false,
            learner_count: existingLearners.length,
            snapshot_date: latestKey || reportDateStr,
            note: 'SkillCat session cookie/login unavailable; preserved latest snapshot.'
        };
    }

    const match = fetched.html.match(/const\s+training_data\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) throw new Error('Could not parse training_data from SkillCat ranked-list.');
    const rawList = JSON.parse(match[1]);
    const baseEmps = rawList.map(item => ({
        userid: String(item.userid || ''),
        fullname: String(item.fullname || '').replace(/\s+/g, ' ').trim(),
        email: item.email || '',
        last_login: String(item.last_login || '').trim(),
        last_access: Number(item.last_access || item.last_new_log || 0) || 0,
        portfolio_link: item.portfolio_link || '',
        learning_plans: (item.user_lps || []).map(lp => lp.name).filter(Boolean)
    }));

    // Concurrent portfolio fetch in batches of 8
    const enriched = [];
    for (let i = 0; i < baseEmps.length; i += 8) {
        const batch = baseEmps.slice(i, i + 8);
        const results = await Promise.all(batch.map(fetchEmployeePortfolioNode));
        enriched.push(...results);
    }

    const win2 = getLastNWorkingDaysIso(reportDateStr, 2);
    const win5 = getLastNWorkingDaysIso(reportDateStr, 5);
    const cutoff2 = win2[0];
    const cutoff5 = win5[0];
    const snapshotMap = {};

    for (const emp of enriched) {
        const courses = emp.completed_courses || [];
        const dates = courses.map(c => c.completed_date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
        const latestCompletion = dates[dates.length - 1] || '';
        const completedLast5 = courses.filter(c => c.completed_date >= cutoff5).length;
        const completedLast2 = courses.filter(c => c.completed_date >= cutoff2).length;
        const flagged2 = courses.length === 0 || completedLast2 === 0;

        const breakdown = {};
        const recentModules = [];
        for (const c of courses) {
            const p = classifySkillCatPathway(c.course_name);
            breakdown[p] = (breakdown[p] || 0) + 1;
            if (c.completed_date >= cutoff5) {
                recentModules.push(`${c.course_name} (${c.completed_date})`);
            }
        }
        const tradeEntries = Object.entries(breakdown).filter(([k]) => k !== 'Work_Readiness_General');
        const primaryPathway = tradeEntries.length
            ? tradeEntries.sort((a, b) => b[1] - a[1])[0][0]
            : (Object.keys(breakdown).length ? 'Work_Readiness_General' : 'Unassigned');

        snapshotMap[emp.userid] = {
            ...emp,
            latest_completion_date: latestCompletion,
            completed_last_5_working_days: completedLast5,
            flagged_2_working_days: flagged2,
            pathway: primaryPathway,
            pathway_breakdown: breakdown,
            recent_modules_last_5_days: recentModules
        };
    }

    history.snapshots[reportDateStr] = snapshotMap;
    fs.writeFileSync(SKILLCAT_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');

    const learnersList = Object.values(snapshotMap);
    const mdText = buildSkillCatMarkdown(learnersList, reportDateStr);
    const mdPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${reportDateStr}.md`);
    const pdfPath = path.join(SUPERVISION_DIR, `SkillCat_Supervision_Report_${reportDateStr}.pdf`);
    fs.writeFileSync(mdPath, mdText, 'utf8');
    await renderMarkdownToPdfFile(mdText, pdfPath, `Turn90 SkillCat Report (${reportDateStr})`, sharedBrowser);
    fs.copyFileSync(pdfPath, path.join(SUPERVISION_DIR, 'SkillCat_Supervision_Report_Latest.pdf'));

    return {
        live: true,
        source: fetched.source,
        learner_count: learnersList.length,
        snapshot_date: reportDateStr
    };
}

// =====================================================================
// APRICOT REPORT 486 SCRAPER VIA PUPPETEER
// =====================================================================
async function runApricot486ScrapeNode(reportDateStr = getEasternDateString()) {
    ensureDirs();
    const email = (process.env.APRICOT_EMAIL || '').trim();
    const password = (process.env.APRICOT_PASSWORD || '').trim();
    if (!email || !password) {
        return {
            live: false,
            note: 'APRICOT_EMAIL / APRICOT_PASSWORD not configured; using latest bundled Apricot XLSX.'
        };
    }

    const downloadDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'apricot_dl_'));
    let browser;
    try {
        browser = await launchHeadlessBrowser();
        const page = await browser.newPage();
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir
        });

        await page.goto('https://apricot.socialsolutions.com/report/run/report_id/486', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await new Promise(r => setTimeout(r, 2500));

        // Bonterra auth landing button if shown
        const bonterraBtn = await page.$('.bonterra-auth-button');
        if (bonterraBtn) {
            await bonterraBtn.click();
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 2500));
        }

        // Fill email & password if on login page
        const emailEl = await page.$('input[type="email"], input[name*="email" i], input[name*="user" i]');
        if (emailEl) {
            await emailEl.click({ clickCount: 3 });
            await emailEl.type(email);
            const pwNow = await page.$('input[type="password"]');
            if (!pwNow) {
                await emailEl.press('Enter');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        const pwEl = await page.$('input[type="password"]');
        if (pwEl) {
            await pwEl.click({ clickCount: 3 });
            await pwEl.type(password);
            await pwEl.press('Enter');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 3500));
        }

        // Handle concurrent session Continue prompt if present
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
            const cont = btns.find(b => /continue|log out other/i.test(b.innerText || b.value || ''));
            if (cont) cont.click();
        });
        await new Promise(r => setTimeout(r, 3500));

        // Wait for Export palette button
        await page.waitForSelector('#report-export-palette-button, #action-palette a, button[onclick*="export"]', { timeout: 60000 });
        await page.evaluate(() => {
            const direct = document.querySelector('#report-export-palette-button');
            if (direct) return direct.click();
            const candidates = Array.from(document.querySelectorAll('a, button'));
            const exp = candidates.find(el => (el.innerText || '').trim().toLowerCase() === 'export');
            if (exp) exp.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        // Confirm dialog Export button
        await page.evaluate(() => {
            const modalBtns = Array.from(document.querySelectorAll('#overlay_content button, .ui-dialog button, [role="dialog"] button, button'));
            const expBtn = modalBtns.find(b => /export/i.test(b.innerText || '') && b.offsetParent !== null);
            if (expBtn) expBtn.click();
        });

        // Poll download folder up to 120s for completed .xlsx
        let downloadedPath = null;
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const files = fs.readdirSync(downloadDir).filter(f => !f.endsWith('.crdownload') && /\.(xlsx|xls|zip)$/i.test(f));
            if (files.length > 0) {
                downloadedPath = path.join(downloadDir, files[0]);
                break;
            }
        }

        if (!downloadedPath) {
            throw new Error('Timed out waiting for Apricot Report 486 Excel download.');
        }

        const destDated = path.join(EXPORTS_DIR, `Justin_Main_Report_${reportDateStr}.xlsx`);
        const destLatest = path.join(EXPORTS_DIR, 'apricot_latest.xlsx');
        const masterAppPath = path.join(__dirname, '..', 'data', 'apricot_master_report.xlsx');
        fs.copyFileSync(downloadedPath, destDated);
        fs.copyFileSync(downloadedPath, destLatest);
        fs.copyFileSync(downloadedPath, masterAppPath);

        const ingestStats = processApricotWorkbook(destDated, { filename: path.basename(destDated) });
        return {
            live: true,
            xlsx_path: destDated,
            ingest_stats: ingestStats
        };
    } catch (e) {
        console.warn('[Supervision] Apricot Puppeteer export fallback:', e.message);
        return {
            live: false,
            note: `Apricot live export fell back to cached XLSX (${e.message})`
        };
    } finally {
        if (browser) await browser.close().catch(() => {});
        try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (e) {}
    }
}

// =====================================================================
// PURE-NODE COMBINED REPORT & PDF GENERATOR (8 SECTIONS)
// =====================================================================
function findLatestXlsxPath() {
    const candidates = [
        path.join(EXPORTS_DIR, 'apricot_latest.xlsx'),
        path.join(__dirname, '..', 'data', 'apricot_master_report.xlsx')
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    if (fs.existsSync(EXPORTS_DIR)) {
        const files = fs.readdirSync(EXPORTS_DIR).filter(f => f.endsWith('.xlsx')).sort().reverse();
        if (files.length > 0) return path.join(EXPORTS_DIR, files[0]);
    }
    return null;
}

function normStr(val) {
    return String(val == null ? '' : val).replace(/\s+/g, ' ').trim();
}

function normCenter(val) {
    const s = normStr(val).toLowerCase();
    if (s.includes('charleston')) return 'Charleston';
    if (s.includes('columbia')) return 'Columbia';
    if (s.includes('spartanburg')) return 'Spartanburg';
    return normStr(val) || 'Unknown';
}

function normProgram(val) {
    const s = normStr(val).toLowerCase();
    if (s.includes('first shift')) return 'First Shift';
    if (s.includes('reentry')) return 'Reentry Navigation';
    return normStr(val) || 'Other';
}

function parseExcelDateIso(val) {
    if (val == null || val === '') return null;
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
        return val.toISOString().slice(0, 10);
    }
    if (typeof val === 'number' && val > 20000 && val < 80000) {
        const utc = new Date(Math.round((val - 25569) * 86400 * 1000));
        return utc.toISOString().slice(0, 10);
    }
    const s = String(val).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (us) {
        const yyyy = us[3].length === 2 ? `20${us[3]}` : us[3];
        return `${yyyy}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
}

function readSheetRowsFromWorkbook(wb, candidateNames) {
    for (const target of candidateNames) {
        const matchedName = wb.SheetNames.find(n => n.toLowerCase().trim() === target.toLowerCase().trim())
            || wb.SheetNames.find(n => n.toLowerCase().includes(target.toLowerCase().replace(' - rows', '').trim()));
        if (!matchedName) continue;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[matchedName], { defval: '' });
        if (rows.length > 0) return rows;
    }
    return [];
}

function dedupeByKey(rows, keyFn) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const k = keyFn(r);
        if (!seen.has(k)) {
            seen.add(k);
            out.push(r);
        }
    }
    return out;
}

function getMondayAndFridayIso(refDateStr) {
    const d = new Date(`${refDateStr}T12:00:00Z`);
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMon = day === 0 ? -6 : (1 - day);
    const currMon = new Date(d);
    currMon.setUTCDate(d.getUTCDate() + diffToMon);
    const currFri = new Date(currMon);
    currFri.setUTCDate(currMon.getUTCDate() + 4);
    const prevMon = new Date(currMon);
    prevMon.setUTCDate(currMon.getUTCDate() - 7);
    const prevFri = new Date(prevMon);
    prevFri.setUTCDate(prevMon.getUTCDate() + 4);
    return {
        currMon: currMon.toISOString().slice(0, 10),
        currFri: currFri.toISOString().slice(0, 10),
        prevMon: prevMon.toISOString().slice(0, 10),
        prevFri: prevFri.toISOString().slice(0, 10),
        ytdStart: `${refDateStr.slice(0, 4)}-01-01`,
        weekdayIdx: day === 0 ? 6 : day - 1
    };
}

function daysBetweenIso(startIso, endIso) {
    if (!startIso || !endIso) return null;
    const a = new Date(`${startIso}T12:00:00Z`);
    const b = new Date(`${endIso}T12:00:00Z`);
    return Math.round((b - a) / 86400000);
}

async function generateCasePlanFeedback(participant, notes, feedbackCache, useAi, aiBudgetTracker) {
    const notesSigPayload = JSON.stringify(
        notes.slice(0, 10).map(n => [n.date_str, n.staff, n.context, n.interaction, n.notes.slice(0, 300)])
    );
    const gateTuple = `(${participant.gate_pcts[1]}, ${participant.gate_pcts[2]}, ${participant.gate_pcts[3]}, ${participant.gate_pcts[4]})`;
    const cpSig = `${participant.program}|${participant.case_plan_ok ? 'True' : 'False'}|${gateTuple}|${notesSigPayload}`;
    const hash = crypto.createHash('sha256').update(cpSig).digest('hex').slice(0, 16);
    const cacheKey = `${participant.record_id}:${hash}`;
    if (feedbackCache[cacheKey]) return feedbackCache[cacheKey];

    const g = participant.gate_pcts;
    const gateStr = `G1:${g[1]}% G2:${g[2]}% G3:${g[3]}% G4:${g[4]}%`;
    const latest = notes[0] || null;
    const parts = [
        participant.case_plan_ok ? 'Case Plan on file.' : 'Case Plan incomplete/missing in Apricot.',
        participant.briefcase_exists ? `Briefcase progress: ${gateStr}.` : 'Briefcase not initialized (0% across Gates 1-4).'
    ];
    if (latest) {
        parts.push(`Latest note (${latest.date_str}, ${latest.staff}): ${latest.context || latest.interaction}. ${latest.notes.slice(0, 180)}`);
    } else {
        parts.push('No case notes logged for this enrollment.');
    }
    const fallbackText = parts.join(' ');

    const apiKey = getGeminiApiKey();
    if (!useAi || !apiKey || notes.length === 0 || aiBudgetTracker.used >= aiBudgetTracker.maxPerRun) {
        feedbackCache[cacheKey] = fallbackText;
        return fallbackText;
    }

    try {
        assertWithinDailyGeminiCap('supervision_case_feedback');
        aiBudgetTracker.used += 1;
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: getFastModelName(),
            generationConfig: buildBudgetGenerationConfig({ role: 'fast', maxOutputTokens: 256, temperature: 0.2 })
        });
        const notesText = notes.slice(0, 5)
            .map(n => `- [${n.date_str}] (${n.staff} | ${n.context} | ${n.interaction}): ${n.notes.slice(0, 350)}`)
            .join('\n');
        const prompt =
            `You are a Turn90 program supervisor reviewing case notes for ${participant.fullname} ` +
            `(Program: ${participant.program}, Center: ${participant.center}, Case Manager: ${participant.case_manager}).\n` +
            `Case Plan Status: ${participant.case_plan_ok ? 'Complete' : 'Incomplete/Missing'} (${participant.case_plan_detail})\n` +
            `Briefcase Progress: ${gateStr}\nRecent Case Notes:\n${notesText}\n\n` +
            `Write 2-3 concise sentences of supervisory feedback grounded ONLY in these facts and state the immediate next step.`;
        const res = await model.generateContent(prompt);
        const txt = (res.response.text() || '').replace(/\s+/g, ' ').trim();
        if (txt) {
            feedbackCache[cacheKey] = txt;
            return txt;
        }
    } catch (e) { /* use deterministic fallback */ }

    feedbackCache[cacheKey] = fallbackText;
    return fallbackText;
}

async function buildCombinedReportDataNode(xlsxPath, reportDateStr, useAi = true) {
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
    const win = getMondayAndFridayIso(reportDateStr);

    const rawEnrollments = readSheetRowsFromWorkbook(wb, ['Enrollments and Exits - Rows']);
    const rawResCoord = readSheetRowsFromWorkbook(wb, ['Funnel-Resource Coordin - Rows']);
    const rawConsults = readSheetRowsFromWorkbook(wb, ['Funnel-Reentry Consulta - Rows']);
    const rawWaitlist = readSheetRowsFromWorkbook(wb, ['Waitlist - Rows']);
    const rawOrientation = readSheetRowsFromWorkbook(wb, ['Orientation - Rows']);
    const rawPoints = readSheetRowsFromWorkbook(wb, ['Points - Rows', 'First Shift Points - Rows']);
    const rawFsCp = readSheetRowsFromWorkbook(wb, ['First Shift Case Plan - Rows']);
    const rawRnCp = readSheetRowsFromWorkbook(wb, ['Reentry Nav Case Plan - Rows']);
    const rawReferrals = readSheetRowsFromWorkbook(wb, ['Referrals - Rows']);
    const rawBriefcase = readSheetRowsFromWorkbook(wb, ['Briefcase - Rows']);
    const rawLscmi = readSheetRowsFromWorkbook(wb, ['LSCMI - Rows']);
    const rawBio = readSheetRowsFromWorkbook(wb, ['Bio Info - Rows']);
    const rawEmployment = readSheetRowsFromWorkbook(wb, ['Employment - Rows']);
    const rawEmpHist = readSheetRowsFromWorkbook(wb, ['Employment Historical - Rows']);
    const rawDrugTest = readSheetRowsFromWorkbook(wb, ['Drug Test - Rows']);
    const rawCaseNotes = readSheetRowsFromWorkbook(wb, ['Case Notes - Rows']);
    const rawCredentials = readSheetRowsFromWorkbook(wb, ['Credentials - Rows']);

    const inferredCenter = {};
    for (const rows of [rawEnrollments, rawPoints, rawFsCp, rawBio, rawBriefcase, rawCaseNotes]) {
        for (const r of rows) {
            const rid = normStr(r['Record ID']);
            const c = normCenter(r['At which Turn90 Center is the client...'] || r['Preferred enrollment location']);
            if (rid && CENTERS.includes(c) && !inferredCenter[rid]) inferredCenter[rid] = c;
        }
    }

    const enrollments = dedupeByKey(rawEnrollments, r =>
        `${normStr(r['Record ID'])}|${normProgram(r['Program Enrollment:'] || r['Which Program?'])}|${normStr(r['Enrollment Start Date:'])}|${normStr(r['Date enrollment ended:'])}`
    );

    const bioById = {};
    for (const r of rawBio) {
        const rid = normStr(r['Record ID']);
        if (!rid) continue;
        const dob = normStr(r['Date of Birth (DOB)']);
        const ssn = normStr(r['Social Security Number (SSN)']);
        const phone = normStr(r['Phone Number']);
        const email = normStr(r['Email']);
        const line1 = normStr(r['Line1']);
        const city = normStr(r['City']);
        const zip = normStr(r['Zip']);
        const missing = [['DOB', dob], ['SSN', ssn], ['Phone', phone], ['Email', email], ['Line1', line1], ['City', city], ['Zip', zip]]
            .filter(([, v]) => !v)
            .map(([k]) => k);
        bioById[rid] = {
            dob: dob || 'N/A',
            ssn: ssn || 'N/A',
            address: [line1, city, zip].filter(Boolean).join(', ') || 'N/A',
            complete: missing.length === 0 ? 'Yes' : `No (Missing: ${missing.join(', ')})`,
            is_complete: missing.length === 0
        };
    }

    const pointsRows = dedupeByKey(rawPoints, r => `${normStr(r['Record ID'])}|${normStr(r['Date'])}|${normStr(r['Points'])}`);
    const lastWkPts = {};
    const currWkPts = {};
    const ptsMeta = {};
    for (const r of pointsRows) {
        const rid = normStr(r['Record ID']);
        const dt = parseExcelDateIso(r['Date']);
        const pts = Number(r['Points']) || 0;
        const name = `${normStr(r['First'])} ${normStr(r['Last'])}`.trim();
        const ctr = normCenter(r['At which Turn90 Center is the client...'] || inferredCenter[rid]);
        if (rid) ptsMeta[rid] = [name, ctr];
        if (dt && dt >= win.prevMon && dt <= win.prevFri) lastWkPts[rid] = (lastWkPts[rid] || 0) + pts;
        if (dt && dt >= win.currMon && dt <= win.currFri) currWkPts[rid] = (currWkPts[rid] || 0) + pts;
    }

    const fsEnrollments = enrollments.filter(e => normProgram(e['Program Enrollment:'] || e['Which Program?']) === 'First Shift');
    const paymentRows = Object.entries(lastWkPts)
        .filter(([, pts]) => pts > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([rid, pts]) => ({
            record_id: rid,
            fullname: (ptsMeta[rid] && ptsMeta[rid][0]) || 'Unknown',
            center: (ptsMeta[rid] && ptsMeta[rid][1]) || 'Unknown',
            points: pts,
            payment: pts * 9
        }));

    const currWkFsEnrollments = [];
    const prevWkFsExits = [];
    for (const e of fsEnrollments) {
        const rid = normStr(e['Record ID']);
        const name = `${normStr(e['First'])} ${normStr(e['Last'])}`.trim();
        const ctr = normCenter(e['At which Turn90 Center is the client...'] || inferredCenter[rid]);
        const bio = bioById[rid] || { dob: 'N/A', ssn: 'N/A', address: 'N/A' };
        const sDt = parseExcelDateIso(e['Enrollment Start Date:']);
        const eDt = parseExcelDateIso(e['Date enrollment ended:']);
        if (sDt && sDt >= win.currMon && sDt <= win.currFri) {
            currWkFsEnrollments.push({ record_id: rid, fullname: name, center: ctr, start_date: sDt, ...bio });
        }
        if (eDt && eDt >= win.prevMon && eDt <= win.prevFri) {
            prevWkFsExits.push({
                record_id: rid,
                fullname: name,
                center: ctr,
                exit_date: eDt,
                exit_reason: normStr(e['How did the client exit Reentry Nav or...']) || 'Unspecified',
                ...bio
            });
        }
    }

    // Funnel counts
    const funnelPrograms = {};
    for (const e of enrollments) {
        const rid = normStr(e['Record ID']);
        const prog = normProgram(e['Program Enrollment:'] || e['Which Program?']);
        const ctr = normCenter(e['At which Turn90 Center is the client...'] || e['At which facility are the classes taking...'] || inferredCenter[rid] || 'Unassigned');
        const key = `${prog}|||${ctr}`;
        if (!funnelPrograms[key]) funnelPrograms[key] = { program: prog, center: ctr, enrollments: 0, exits: 0, active: 0 };
        funnelPrograms[key].enrollments += 1;
        if (parseExcelDateIso(e['Date enrollment ended:'])) funnelPrograms[key].exits += 1;
        else funnelPrograms[key].active += 1;
    }

    const resCoord = dedupeByKey(rawResCoord, r => `${normStr(r['Record ID'])}|${normStr(r['Date of resource coordination screening'])}`);
    const consults = dedupeByKey(rawConsults, r => `${normStr(r['Record ID'])}|${normStr(r['Date of Reentry Consultation'])}`);
    const orientations = dedupeByKey(rawOrientation, r => `${normStr(r['Record ID'])}|${normStr(r['Date of Orientation'])}`);
    const waitlist = dedupeByKey(rawWaitlist, r => `${normStr(r['Record ID'])}|${normStr(r['Date added to waitlist'])}`);

    const countTimeframes = (rows, dateKey, ctrFn) => {
        const out = {};
        const add = (k, field) => {
            if (!out[k]) out[k] = { ytd: 0, last_wk: 0, curr_wk: 0 };
            out[k][field] += 1;
        };
        for (const r of rows) {
            const dt = parseExcelDateIso(r[dateKey]);
            const ctr = ctrFn(r) || 'Unspecified';
            if (dt && dt >= win.ytdStart) { add(ctr, 'ytd'); add('Total', 'ytd'); }
            if (dt && dt >= win.prevMon && dt <= win.prevFri) { add(ctr, 'last_wk'); add('Total', 'last_wk'); }
            if (dt && dt >= win.currMon && dt <= win.currFri) { add(ctr, 'curr_wk'); add('Total', 'curr_wk'); }
        }
        return out;
    };

    const rcCounts = countTimeframes(resCoord, 'Date of resource coordination screening', r => inferredCenter[normStr(r['Record ID'])] || 'Unassigned');
    const consultCounts = countTimeframes(consults, 'Date of Reentry Consultation', r => normCenter(r['Preferred enrollment location'] || inferredCenter[normStr(r['Record ID'])] || 'Unspecified'));
    const waitlistCounts = {};
    for (const r of waitlist) {
        const ctr = normCenter(r['Which center?'] || 'Unspecified');
        waitlistCounts[ctr] = (waitlistCounts[ctr] || 0) + 1;
    }

    // Case notes newest first
    const caseNotes = dedupeByKey(rawCaseNotes, r =>
        `${normStr(r['Record ID'])}|${normStr(r['Date of activity:'])}|${normStr(r['Staff providing service'])}|${normStr(r['Notes']).slice(0, 200)}`
    );
    const notesById = {};
    for (const n of caseNotes) {
        const rid = normStr(n['Record ID']);
        const dt = parseExcelDateIso(n['Date of activity:']);
        if (!notesById[rid]) notesById[rid] = [];
        notesById[rid].push({
            date_str: dt || normStr(n['Date of activity:']),
            date: dt,
            staff: normStr(n['Staff providing service']) || 'Unknown',
            context: normStr(n['Service Context']),
            interaction: normStr(n['What happened during this interaction']),
            notes: normStr(n['Notes'])
        });
    }
    Object.values(notesById).forEach(arr => arr.sort((a, b) => (b.date || '').localeCompare(a.date || '')));

    const briefcaseById = {};
    for (const r of rawBriefcase) {
        const rid = normStr(r['Record ID']);
        if (!rid) continue;
        const gates = {};
        let tot = 0;
        for (const gNum of [1, 2, 3, 4]) {
            const items = normStr(r[`Gate ${gNum} Checklist`]).split('|').map(s => s.trim()).filter(Boolean);
            gates[gNum] = Math.min(100, Math.round((items.length * 100) / GATE_DENOMINATORS[gNum]));
            tot += items.length;
        }
        const overallPct = Math.min(100, Math.round((tot * 100) / TOTAL_BRIEFCASE_ITEMS));
        if (!briefcaseById[rid] || overallPct > briefcaseById[rid].overall_pct) {
            briefcaseById[rid] = { exists: true, gate_pcts: gates, overall_pct: overallPct };
        }
    }

    const fsCpById = {};
    for (const r of rawFsCp) {
        const rid = normStr(r['Record ID']);
        const fa1 = normStr(r['Focus Area 1']);
        const sit1 = normStr(r['Focus Area 1 Situation']);
        const fa2 = normStr(r['Focus Area 2']);
        const sit2 = normStr(r['Focus Area 2 Situations']);
        fsCpById[rid] = {
            exists: true,
            ok: Boolean(fa1 && sit1),
            detail: `FA1: ${fa1 || 'Missing'} (Sit: ${sit1 ? 'Yes' : 'No'}); FA2: ${fa2 || 'None'} (Sit: ${sit2 ? 'Yes' : 'No'})`
        };
    }

    const rnCpById = {};
    for (const r of rawRnCp) {
        const rid = normStr(r['Record ID']);
        const cm = normStr(r['Case Manager']) || 'Daisy Boynton';
        const txt = normStr(r['Case Plan']);
        rnCpById[rid] = { exists: Boolean(txt), case_manager: cm, detail: txt ? txt.slice(0, 120) : 'Missing' };
    }

    const lscmiById = {};
    for (const r of rawLscmi) {
        const rid = normStr(r['Record ID']);
        const score = normStr(r['Total LS/CMI Score (from Section 1)']);
        if (rid && score) lscmiById[rid] = score;
    }
    const drugTestIds = new Set(rawDrugTest.map(r => normStr(r['Record ID'])).filter(Boolean));

    let feedbackCache = {};
    if (fs.existsSync(FEEDBACK_CACHE_PATH)) {
        try { feedbackCache = JSON.parse(fs.readFileSync(FEEDBACK_CACHE_PATH, 'utf8')); } catch (e) {}
    }

    const activeFirstShift = [];
    const activeReentryNav = [];
    const seenActive = new Set();
    const aiBudgetTracker = { used: 0, maxPerRun: 20 };

    for (const e of enrollments) {
        if (parseExcelDateIso(e['Date enrollment ended:'])) continue;
        const rid = normStr(e['Record ID']);
        const prog = normProgram(e['Program Enrollment:'] || e['Which Program?']);
        if (prog !== 'First Shift' && prog !== 'Reentry Navigation') continue;
        const uniq = `${rid}|${prog}`;
        if (seenActive.has(uniq)) continue;
        seenActive.add(uniq);

        const fullname = `${normStr(e['First'])} ${normStr(e['Last'])}`.trim();
        const center = normCenter(e['At which Turn90 Center is the client...'] || inferredCenter[rid] || 'Charleston');
        const startDt = parseExcelDateIso(e['Enrollment Start Date:']);
        const bc = briefcaseById[rid] || { exists: false, gate_pcts: { 1: 0, 2: 0, 3: 0, 4: 0 }, overall_pct: 0 };
        const pNotes = notesById[rid] || [];
        const lastNote = pNotes[0] || null;

        if (prog === 'First Shift') {
            const cm = CENTER_CM_MAP[center] || 'TB';
            const cp = fsCpById[rid] || { exists: false, ok: false, detail: 'Missing' };
            const daysEnrolled = startDt ? Math.max(0, daysBetweenIso(startDt, reportDateStr) || 0) : 0;
            const weeksEnrolled = Math.max(1, Math.floor(daysEnrolled / 7) + 1);
            const hasCmWeek = pNotes.some(n =>
                n.date && n.date >= win.currMon && n.date <= win.currFri &&
                /case management|briefcase|case plan|1-on-1/i.test(`${n.context} ${n.notes}`)
            );
            const bio = bioById[rid] || { complete: 'No (Not on file)', is_complete: false };
            const rec = {
                record_id: rid,
                fullname,
                program: 'First Shift',
                center,
                case_manager: cm,
                weeks_enrolled: weeksEnrolled,
                points_this_week: currWkPts[rid] || 0,
                case_plan_ok: cp.ok,
                case_plan_detail: cp.detail,
                briefcase_exists: bc.exists,
                gate_pcts: bc.gate_pcts,
                overall_briefcase_pct: bc.overall_pct,
                drug_test_week: !drugTestIds.has(rid),
                cm_session_week: hasCmWeek,
                lscmi_score: lscmiById[rid] || 'N/A',
                bio_complete: bio.complete,
                last_contact: lastNote ? lastNote.date_str : 'None'
            };
            rec.feedback = await generateCasePlanFeedback(rec, pNotes, feedbackCache, useAi, aiBudgetTracker);
            activeFirstShift.push(rec);
        } else {
            const rnCp = rnCpById[rid] || { exists: false, case_manager: 'Daisy Boynton', detail: 'Missing' };
            const rec = {
                record_id: rid,
                fullname,
                program: 'Reentry Navigation',
                center,
                case_manager: rnCp.case_manager,
                case_plan_ok: rnCp.exists,
                case_plan_detail: rnCp.detail,
                briefcase_exists: bc.exists,
                gate_pcts: bc.gate_pcts,
                overall_briefcase_pct: bc.overall_pct,
                last_contact: lastNote ? lastNote.date_str : 'None',
                last_contact_date: lastNote ? lastNote.date : null
            };
            rec.feedback = await generateCasePlanFeedback(rec, pNotes, feedbackCache, useAi, aiBudgetTracker);
            activeReentryNav.push(rec);
        }
    }

    fs.writeFileSync(FEEDBACK_CACHE_PATH, JSON.stringify(feedbackCache, null, 2), 'utf8');

    // SkillCat Section 4
    const scHist = readSkillCatHistorySafe();
    const scSnaps = scHist.snapshots || {};
    const scSnapDates = Object.keys(scSnaps).sort();
    const latestScDate = scSnapDates[scSnapDates.length - 1];
    const skillcatRows = latestScDate
        ? Object.values(scSnaps[latestScDate])
            .sort((a, b) => (a.fullname || '').localeCompare(b.fullname || ''))
            .map(info => ({
                fullname: info.fullname || '',
                total_modules: Number(info.total_courses || 0),
                last_5_working_days: Number(info.completed_last_5_working_days || 0),
                latest_completion: info.latest_completion_date || 'None',
                flagged_2_working_days: Boolean(info.flagged_2_working_days)
            }))
        : [];

    // Retention Section 6
    const empHist = dedupeByKey(rawEmpHist, r =>
        `${normStr(r['Record ID'])}|${normStr(r['Company Name'])}|${normStr(r['Employment Start Date'])}`
    );
    const retention = {};
    for (const horizon of [30, 60, 90, 180]) {
        let qualified = 0;
        let retained = 0;
        for (const r of empHist) {
            const sDt = parseExcelDateIso(r['Employment Start Date']);
            if (!sDt || sDt > reportDateStr) continue;
            const eDt = parseExcelDateIso(r["When was the client's last known date of..."]);
            if (eDt) {
                const worked = daysBetweenIso(sDt, eDt);
                if (worked != null) {
                    qualified += 1;
                    if (worked >= horizon) retained += 1;
                }
            } else {
                const activeDays = daysBetweenIso(sDt, reportDateStr);
                if (activeDays != null && activeDays >= horizon) {
                    qualified += 1;
                    retained += 1;
                }
            }
        }
        retention[horizon] = {
            retained,
            qualified,
            rate: qualified ? Math.round((retained * 1000) / qualified) / 10 : 0.0
        };
    }

    // Referrals & Credentials Section 7
    const activeMap = {};
    [...activeFirstShift, ...activeReentryNav].forEach(p => { activeMap[p.record_id] = p; });
    const refByCenterCm = {};
    dedupeByKey(rawReferrals, r =>
        `${normStr(r['Record ID'])}|${normStr(r['Date referral was made:'])}|${normStr(r['Name of Organization:'])}`
    ).forEach(r => {
        const p = activeMap[normStr(r['Record ID'])];
        if (!p) return;
        const staff = normStr(r['Staff making the referral:']) || p.case_manager;
        const k = `${p.center}|||${staff}`;
        refByCenterCm[k] = (refByCenterCm[k] || 0) + 1;
    });

    const credByCenterCm = {};
    dedupeByKey(rawCredentials, r =>
        `${normStr(r['Record ID'])}|${normStr(r['Credential Earned'])}|${normStr(r['Date Completed'])}`
    ).forEach(r => {
        const p = activeMap[normStr(r['Record ID'])];
        if (!p) return;
        const cred = normStr(r['Credential Earned']) || 'Unknown';
        const k = `${p.center}|||${p.case_manager}|||${cred}`;
        credByCenterCm[k] = (credByCenterCm[k] || 0) + 1;
    });

    // Operational Flags Section 8
    const elapsedWeekdays = win.weekdayIdx < 5 ? Math.min(5, Math.max(1, win.weekdayIdx + 1)) : 5;
    const expectedPts = elapsedWeekdays * 10;
    const min25Pts = expectedPts * 0.25;
    const empCheckinFlag = [];
    dedupeByKey(rawEmployment, r =>
        `${normStr(r['Record ID'])}|${normStr(r['Company Name'])}|${normStr(r['Employment Start Date'])}`
    ).forEach(r => {
        if (parseExcelDateIso(r["When was the client's last known date of..."])) return;
        const checkin = parseExcelDateIso(r['Date employment check-in was completed by...']);
        const days = checkin ? daysBetweenIso(checkin, reportDateStr) : 999;
        if (days == null || days > 30) {
            const rid = normStr(r['Record ID']);
            empCheckinFlag.push({
                record_id: rid,
                fullname: `${normStr(r['First'])} ${normStr(r['Last'])}`.trim(),
                center: inferredCenter[rid] || 'Unknown',
                company: normStr(r['Company Name']),
                last_checkin: checkin || 'Never'
            });
        }
    });

    const flags = {
        missing_75pct_points: activeFirstShift.filter(r => r.points_this_week < min25Pts),
        missing_cm_session: activeFirstShift.filter(r => !r.cm_session_week),
        missing_drug_test: activeFirstShift.filter(r => !r.drug_test_week),
        missing_case_plan: [...activeFirstShift, ...activeReentryNav].filter(r => !r.case_plan_ok),
        missing_briefcase: [...activeFirstShift, ...activeReentryNav].filter(r => !r.briefcase_exists),
        behind_briefcase_25pct_wk: activeFirstShift.filter(r => r.overall_briefcase_pct < Math.min(100, r.weeks_enrolled * 25)),
        reentry_no_contact_7d: activeReentryNav.filter(r => !r.last_contact_date || (daysBetweenIso(r.last_contact_date, reportDateStr) || 0) > 7),
        employment_no_checkin_30d: empCheckinFlag
    };

    return {
        report_date: reportDateStr,
        source_xlsx: path.basename(xlsxPath),
        curr_week: `${win.currMon} to ${win.currFri}`,
        prev_week: `${win.prevMon} to ${win.prevFri}`,
        expected_pts: expectedPts,
        payment_rows: paymentRows,
        curr_wk_fs_enrollments: currWkFsEnrollments,
        prev_wk_fs_exits: prevWkFsExits,
        funnel_programs: Object.values(funnelPrograms),
        rc_counts: rcCounts,
        consult_counts: consultCounts,
        waitlist_counts: waitlistCounts,
        active_first_shift: activeFirstShift,
        active_reentry_nav: activeReentryNav,
        skillcat_rows: skillcatRows,
        retention,
        ref_by_center_cm: refByCenterCm,
        cred_by_center_cm: credByCenterCm,
        flags,
        orient_count: orientations.length
    };
}

function filterReportDataByLocation(data, location) {
    if (!location) return data;
    const filterObjKeys = (obj) => {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (k.startsWith(`${location}|||`)) out[k] = v;
        }
        return out;
    };
    const filteredFlags = {};
    for (const [k, arr] of Object.entries(data.flags)) {
        filteredFlags[k] = arr.filter(item => item.center === location);
    }
    return {
        ...data,
        payment_rows: data.payment_rows.filter(r => r.center === location),
        curr_wk_fs_enrollments: data.curr_wk_fs_enrollments.filter(r => r.center === location),
        prev_wk_fs_exits: data.prev_wk_fs_exits.filter(r => r.center === location),
        active_first_shift: data.active_first_shift.filter(r => r.center === location),
        active_reentry_nav: data.active_reentry_nav.filter(r => r.center === location),
        ref_by_center_cm: filterObjKeys(data.ref_by_center_cm),
        cred_by_center_cm: filterObjKeys(data.cred_by_center_cm),
        flags: filteredFlags
    };
}

function renderCombinedReportMarkdown(data, location = null) {
    const scope = location || 'Universal (All Centers)';
    const lines = [
        `# Turn90 Combined Supervision & Operational Report — ${scope}`,
        `**Report Date:** ${data.report_date} | **Source:** \`${data.source_xlsx}\``,
        `**Last Week (Payroll):** ${data.prev_week} | **Current Week:** ${data.curr_week}`,
        '',
        '---',
        '## 1. First Shift Payment Report (Last Week Mon–Fri @ $9/pt)',
        '| Record ID | Full Name | Center | Points | Payment ($9/pt) |',
        '|---|---|---|---:|---:|'
    ];
    let totalPay = 0;
    for (const r of data.payment_rows) {
        totalPay += r.payment;
        lines.push(`| ${r.record_id} | ${r.fullname} | ${r.center} | ${r.points} | $${r.payment.toLocaleString()} |`);
    }
    lines.push(`| **Total** | **${data.payment_rows.length} Participants** | | | **$${totalPay.toLocaleString()}** |`);

    lines.push('', `### Current Week New Enrollments (${data.curr_wk_fs_enrollments.length})`);
    if (data.curr_wk_fs_enrollments.length) {
        lines.push('| Record ID | Name | Center | Start Date |', '|---|---|---|---|');
        data.curr_wk_fs_enrollments.forEach(e => lines.push(`| ${e.record_id} | ${e.fullname} | ${e.center} | ${e.start_date} |`));
    } else {
        lines.push('- None');
    }

    lines.push('', `### Last Week Exits (${data.prev_wk_fs_exits.length})`);
    if (data.prev_wk_fs_exits.length) {
        lines.push('| Record ID | Name | Center | Exit Date | Reason |', '|---|---|---|---|---|');
        data.prev_wk_fs_exits.forEach(x => lines.push(`| ${x.record_id} | ${x.fullname} | ${x.center} | ${x.exit_date} | ${x.exit_reason} |`));
    } else {
        lines.push('- None');
    }

    lines.push('', '---', '## 2. Funnel Report', '| Program | Center | Enrollments | Exits | Active |', '|---|---|---:|---:|---:|');
    for (const b of data.funnel_programs.sort((a, b) => `${a.program}${a.center}`.localeCompare(`${b.program}${b.center}`))) {
        if (!location || b.center === location || b.center === 'Unassigned') {
            lines.push(`| ${b.program} | ${b.center} | ${b.enrollments} | ${b.exits} | ${b.active} |`);
        }
    }

    lines.push('', '---', '## 3. Active Program Dashboards', '### First Shift Active Dashboard');
    lines.push('| ID | Name | Center | Wks | Pts | Case Plan | Gates 1–4 | Drug Test | CM Sess | LS/CMI | Bio Info |');
    lines.push('|---|---|---|---:|---:|---|---|---|---|---|---|');
    for (const r of data.active_first_shift) {
        const g = r.gate_pcts;
        lines.push(`| ${r.record_id} | ${r.fullname} | ${r.center} | ${r.weeks_enrolled} | ${r.points_this_week} | ${r.case_plan_ok ? 'Complete' : 'Incomplete'} | ${g[1]}/${g[2]}/${g[3]}/${g[4]}% | ${r.drug_test_week ? 'Yes' : 'MISSING'} | ${r.cm_session_week ? 'Yes' : 'MISSING'} | ${r.lscmi_score} | ${r.bio_complete} |`);
    }

    lines.push('', '### Reentry Navigation Active Dashboard', '| ID | Name | Case Manager | Case Plan | Gates 1–4 | Last Contact |', '|---|---|---|---|---|---|');
    for (const r of data.active_reentry_nav) {
        const g = r.gate_pcts;
        lines.push(`| ${r.record_id} | ${r.fullname} | ${r.case_manager} | ${r.case_plan_ok ? 'Yes' : 'Missing'} | ${g[1]}/${g[2]}/${g[3]}/${g[4]}% | ${r.last_contact} |`);
    }

    lines.push('', '---', '## 4. SkillCat Modules Progress', '| Participant | Total Modules | Completed (Last 5 Working Days) | Latest Completion | Status |', '|---|---:|---:|---|---|');
    for (const s of data.skillcat_rows) {
        lines.push(`| ${s.fullname} | ${s.total_modules} | ${s.last_5_working_days} | ${s.latest_completion} | ${s.flagged_2_working_days ? 'FLAGGED' : 'On Track'} |`);
    }

    lines.push('', '---', '## 5. Case Plan & Briefcase Feedback (Batched by Case Manager)');
    const grouped = {};
    [...data.active_first_shift, ...data.active_reentry_nav].forEach(p => {
        if (!grouped[p.case_manager]) grouped[p.case_manager] = [];
        grouped[p.case_manager].push(p);
    });
    for (const [cm, members] of Object.entries(grouped).sort()) {
        lines.push('', `### Case Manager: ${cm}`);
        for (const m of members) {
            lines.push(`- **${m.fullname}** (${m.program} — ${m.center}): ${m.feedback}`);
        }
    }

    lines.push('', '---', '## 6. Employment Retention (30 / 60 / 90 / 180 Days)', '| Horizon | Retained | Qualified | Retention Rate |', '|---|---:|---:|---:|');
    for (const h of [30, 60, 90, 180]) {
        const row = data.retention[h];
        lines.push(`| ${h} Days | ${row.retained} | ${row.qualified} | ${row.rate}% |`);
    }

    lines.push('', '---', '## 7. Referrals & Credentials (Active Cohort)');
    Object.entries(data.ref_by_center_cm).forEach(([k, cnt]) => {
        const [c, staff] = k.split('|||');
        lines.push(`- **Referral** (${c} / ${staff}): ${cnt}`);
    });
    Object.entries(data.cred_by_center_cm).forEach(([k, cnt]) => {
        const [c, cm, cred] = k.split('|||');
        lines.push(`- **Credential** (${c} / ${cm}): ${cred} × ${cnt}`);
    });

    lines.push('', '---', '## 8. Operational Flags');
    const flagDefs = [
        ['missing_75pct_points', `First Shift Missing >75% Points This Week (Expected: ${data.expected_pts})`],
        ['missing_cm_session', 'Active First Shift Missing CM Session This Week'],
        ['missing_drug_test', 'Active First Shift Missing Drug Test This Week'],
        ['missing_case_plan', 'Missing Case Plan (First Shift & Reentry Nav)'],
        ['missing_briefcase', 'Missing Briefcase (First Shift & Reentry Nav)'],
        ['behind_briefcase_25pct_wk', 'First Shift Behind 25% Briefcase/Week'],
        ['reentry_no_contact_7d', 'Active Reentry Nav No Contact in Last 7 Days'],
        ['employment_no_checkin_30d', 'Employed Without Job Check-In in Last 30 Days']
    ];
    for (const [k, label] of flagDefs) {
        const items = data.flags[k] || [];
        const names = items.map(it => `${it.fullname} (${it.center || '?'})`).join(', ') || 'None';
        lines.push(`- **${label} (${items.length}):** ${names}`);
    }

    return lines.join('\n');
}

function renderMarkdownToPdfKit(markdownText, pdfPath, titleText) {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ layout: 'landscape', size: 'LETTER', margin: 36 });
        const stream = fs.createWriteStream(pdfPath);
        stream.on('finish', () => resolve(pdfPath));
        stream.on('error', reject);
        doc.pipe(stream);

        doc.fontSize(15).fillColor('#0f172a').text(titleText || 'Turn90 Supervision Report', { underline: false });
        doc.moveDown(0.4);

        const rawLines = String(markdownText || '').split('\n');
        for (const rawLine of rawLines) {
            const line = rawLine.trim();
            if (!line) {
                doc.moveDown(0.25);
            } else if (line.startsWith('# ')) {
                doc.fontSize(13).fillColor('#1e3a8a').text(line.slice(2).replace(/\*\*/g, ''));
                doc.moveDown(0.2);
            } else if (line.startsWith('## ')) {
                doc.moveDown(0.3);
                doc.fontSize(11).fillColor('#1e40af').text(line.slice(3).replace(/\*\*/g, ''));
                doc.moveDown(0.15);
            } else if (line.startsWith('### ')) {
                doc.moveDown(0.2);
                doc.fontSize(10).fillColor('#334155').text(line.slice(4).replace(/\*\*/g, ''));
            } else if (line.startsWith('---')) {
                doc.moveDown(0.2);
            } else if (/^\|[-:\s|]+\|$/.test(line)) {
                continue;
            } else if (line.startsWith('|')) {
                const cells = line.split('|').slice(1, -1).map(c => c.trim().replace(/\*\*/g, ''));
                doc.fontSize(8).fillColor('#1e293b').text(cells.join('  |  '));
            } else {
                doc.fontSize(9).fillColor('#1e293b').text(line.replace(/\*\*/g, '').replace(/`/g, ''));
            }
        }
        doc.end();
    });
}

async function renderMarkdownToPdfFile(markdownText, pdfPath, titleText, existingBrowser = null) {
    let browser = existingBrowser;
    let ownBrowser = false;
    if (!browser) {
        browser = await launchHeadlessBrowserSafe();
        ownBrowser = Boolean(browser);
    }
    if (!browser) {
        return renderMarkdownToPdfKit(markdownText, pdfPath, titleText);
    }
    try {
        const page = await browser.newPage();
        const bodyHtml = marked.parse(markdownText || '');
        const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${titleText || 'Turn90 Supervision Report'}</title>
<style>
  @page { size: letter landscape; margin: 0.45in; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 9.5pt; color: #1e293b; line-height: 1.4; }
  h1 { font-size: 16pt; color: #0f172a; margin: 0 0 6px 0; border-bottom: 2px solid #2563eb; padding-bottom: 4px; }
  h2 { font-size: 12pt; color: #1e3a8a; margin: 14px 0 6px 0; }
  h3 { font-size: 10.5pt; color: #334155; margin: 10px 0 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px 0; font-size: 8.5pt; }
  th { background: #1e3a8a; color: white; padding: 5px 6px; text-align: left; }
  td { border-bottom: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  ul { margin: 4px 0; padding-left: 18px; }
  li { margin-bottom: 3px; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
        await page.pdf({
            path: pdfPath,
            format: 'Letter',
            landscape: true,
            printBackground: true,
            margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' }
        });
        await page.close();
        return pdfPath;
    } catch (pdfErr) {
        return renderMarkdownToPdfKit(markdownText, pdfPath, titleText);
    } finally {
        if (ownBrowser && browser) await browser.close().catch(() => {});
    }
}

async function generateCombinedReportsNode(reportDateStr = getEasternDateString(), { useAi = true, sharedBrowser = null } = {}) {
    ensureDirs();
    const xlsxPath = findLatestXlsxPath();
    if (!xlsxPath) {
        throw new Error('No Apricot XLSX workbook found in supervision_pipeline/apricot_exports/ or data/apricot_master_report.xlsx.');
    }

    try {
        processApricotWorkbook(xlsxPath, { filename: path.basename(xlsxPath) });
    } catch (e) {
        console.warn('[Supervision] Non-fatal Apricot DB ingest notice:', e.message);
    }

    const fullData = await buildCombinedReportDataNode(xlsxPath, reportDateStr, useAi);
    const outDir = path.join(REPORTS_DIR, reportDateStr);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    let browser = sharedBrowser;
    let ownBrowser = false;
    if (!browser) {
        browser = await launchHeadlessBrowserSafe();
        ownBrowser = Boolean(browser);
    }

    const createdFiles = [];
    try {
        for (const loc of [null, ...CENTERS]) {
            const scoped = filterReportDataByLocation(fullData, loc);
            const tag = loc || 'Universal';
            const mdText = renderCombinedReportMarkdown(scoped, loc);
            const mdPath = path.join(outDir, `Turn90_Combined_Report_${tag}_${reportDateStr}.md`);
            const pdfPath = path.join(outDir, `Turn90_Combined_Report_${tag}_${reportDateStr}.pdf`);
            fs.writeFileSync(mdPath, mdText, 'utf8');
            await renderMarkdownToPdfFile(mdText, pdfPath, `Turn90 ${tag} Report (${reportDateStr})`, browser);
            createdFiles.push(mdPath, pdfPath);
            if (!loc) {
                const latestPdf = path.join(SUPERVISION_DIR, 'Turn90_Combined_Report_Latest.pdf');
                fs.copyFileSync(pdfPath, latestPdf);
                createdFiles.push(latestPdf);
            }
        }
    } finally {
        if (ownBrowser && browser) await browser.close().catch(() => {});
    }

    return {
        report_date: reportDateStr,
        source_xlsx: path.basename(xlsxPath),
        files: createdFiles
    };
}

// =====================================================================
// DAILY EMAIL DISPATCHER (NODEMAILER GMAIL SMTP)
// =====================================================================
async function dispatchSupervisionEmailsNode(reportDateStr = null, { dryRun = false, scopes = null } = {}) {
    ensureDirs();
    const targetDate = sanitizeDateParam(reportDateStr) || listAvailableReportDates()[0] || getEasternDateString();
    const routing = readEmailRouting();
    const sender = (process.env.SMTP_EMAIL || process.env.EMAIL_USER || '').trim();
    const password = (process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD || '').trim();
    const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10) || 465;

    if ((!sender || !password) && !dryRun) {
        return {
            sent_count: 0,
            date: targetDate,
            skipped_reason: 'SMTP_EMAIL / SMTP_PASSWORD (or EMAIL_USER / EMAIL_APP_PASSWORD) not set in environment.'
        };
    }

    const transporter = dryRun
        ? null
        : nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: sender, pass: password }
        });

    const dispatched = [];
    const errors = [];
    for (const [scope, recips] of Object.entries(routing)) {
        if (Array.isArray(scopes) && scopes.length > 0 && !scopes.includes(scope)) continue;
        const cleanRecipients = (recips || []).map(r => String(r).trim()).filter(Boolean);
        if (cleanRecipients.length === 0) continue;

        const pdfPath = getReportPdfPath(targetDate, scope);
        if (!pdfPath || !fs.existsSync(pdfPath)) {
            errors.push(`${scope}: PDF not found for ${targetDate}`);
            continue;
        }

        const subject = `Turn90 ${scope} Supervision Report — ${targetDate}`;
        const text = `Hello,\n\nAttached is the Turn90 ${scope} Supervision Report for ${targetDate}.\n\nAutomated Turn90 Reporting Pipeline`;

        if (dryRun) {
            dispatched.push({ scope, recipients: cleanRecipients, file: path.basename(pdfPath), dry_run: true });
            continue;
        }

        try {
            await transporter.sendMail({
                from: sender,
                to: cleanRecipients.join(', '),
                subject,
                text,
                attachments: [{ filename: path.basename(pdfPath), path: pdfPath }]
            });
            dispatched.push({ scope, recipients: cleanRecipients, file: path.basename(pdfPath) });
        } catch (err) {
            errors.push(`${scope}: ${err.message}`);
        }
    }

    return {
        date: targetDate,
        sent_count: dispatched.length,
        dispatched,
        errors
    };
}

// =====================================================================
// FULL ORCHESTRATOR & DAILY CRON JOB
// =====================================================================
let activeRunPromise = null;

async function runFullDailySupervisionPipeline({
    reportDate = getEasternDateString(),
    scrapeApricot = true,
    scrapeSkillcat = true,
    sendEmails = true,
    useAi = true
} = {}) {
    if (activeRunPromise) return activeRunPromise;
    activeRunPromise = (async () => {
        ensureDirs();
        const result = {
            report_date: reportDate,
            apricot: null,
            skillcat: null,
            reports: null,
            emails: null,
            synced_folders: 0
        };

        if (scrapeApricot) {
            result.apricot = await runApricot486ScrapeNode(reportDate);
        }

        let sharedBrowser = null;
        try {
            sharedBrowser = await launchHeadlessBrowserSafe();
            if (scrapeSkillcat) {
                result.skillcat = await runSkillCatScrapeNode(reportDate, sharedBrowser);
            }
            result.reports = await generateCombinedReportsNode(reportDate, { useAi, sharedBrowser });
        } finally {
            if (sharedBrowser) await sharedBrowser.close().catch(() => {});
        }

        try {
            const folders = syncAllParticipantFolders();
            result.synced_folders = folders.length;
        } catch (e) { /* non-fatal */ }

        if (sendEmails) {
            result.emails = await dispatchSupervisionEmailsNode(reportDate, { dryRun: false });
        }
        return result;
    })().finally(() => {
        activeRunPromise = null;
    });
    return activeRunPromise;
}

let supervisionCronStarted = false;
function initSupervisionCron() {
    if (supervisionCronStarted || process.env.SUPERVISION_DISABLE_CRON === 'true') return;
    supervisionCronStarted = true;
    const schedule = process.env.SUPERVISION_CRON_SCHEDULE || '0 21 * * 1-5';
    console.log(`[Supervision Cron] Daily Apricot + SkillCat + Email schedule active: "${schedule}" (America/New_York)`);
    cron.schedule(schedule, async () => {
        const todayEt = getEasternDateString();
        console.log(`[Supervision Cron] Starting automated daily pipeline for ${todayEt}...`);
        try {
            const out = await runFullDailySupervisionPipeline({
                reportDate: todayEt,
                scrapeApricot: true,
                scrapeSkillcat: true,
                sendEmails: true,
                useAi: true
            });
            console.log(`[Supervision Cron] Completed ${todayEt}: emails sent=${out.emails?.sent_count || 0}, folders synced=${out.synced_folders}`);
        } catch (err) {
            console.error('[Supervision Cron] Pipeline failed:', err.message);
        }
    }, {
        scheduled: true,
        timezone: 'America/New_York'
    });
}

module.exports = {
    REPORT_SCOPES,
    getSupervisionPipelineDir,
    getEasternDateString,
    listAvailableReportDates,
    listReportsForDate,
    getReportPdfPath,
    readReportMarkdown,
    getArchiveOverview,
    runSkillCatScrapeNode,
    runApricot486ScrapeNode,
    generateCombinedReportsNode,
    dispatchSupervisionEmailsNode,
    runFullDailySupervisionPipeline,
    initSupervisionCron
};
