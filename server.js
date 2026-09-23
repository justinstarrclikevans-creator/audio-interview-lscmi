const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, BRIEFCASE_DOMAINS, DEFAULT_GATE_CRITERIA, STABILITY_STEP_DOWN_TRIGGERS, initParticipantBriefcase, BENEFIT_PROGRAMS, syncBenefitToBriefcase } = require('./db');
const { runPhase1, runPhase1WithAudio, runPhase2, safeJsonParse } = require('./llm_pipeline');
const { convertSingleMdToPdf } = require('./convert_md_to_pdf');
const { convertSingleMdToDocx } = require('./convert_md_to_docx');
const { evaluateClassTranscript } = require('./facilitation_evaluator');
const { 
    generateMondayNeedsReport, 
    generateFridayMilestoneReport, 
    importApricotCsv, 
    importApricotData, 
    getWeeklyPointsSummary, 
    generateApricotCaseNotesExport,
    importDrugTestData,
    importCaseManagementNotesData,
    getWeeklyComplianceSummary,
    generateCaseManagementBriefcaseAudit
} = require('./reporting_engine');
const { SC_COMMUNITY_RESOURCES, SC_FAIR_CHANCE_EMPLOYERS } = require('./sc_resource_directory');
const { loadJobsFromSpreadsheets, getAllReentryJobs, buildGoogleJobsUrl, buildGoogleSearchUrl } = require('./jobs_loader');
const { getParticipantAiResponse } = require('./ai_assistant');
const { matchJobsWithAi, generateTailoredResumePoints, generateTurnaroundNarrative } = require('./job_hunting_ai');
const { runCaseloadMigration, syncParticipantStateToSupabase } = require('./migrate_and_assign_t90_logins');
const { cbtModules, T90_TRADE_TRACKS } = require('./training_data');
const pdfParse = require('pdf-parse');

async function extractPdfText(buffer) {
    if (!buffer) return '';
    try {
        if (typeof pdfParse === 'function') {
            const parsed = await pdfParse(buffer);
            return parsed.text || '';
        } else if (pdfParse && pdfParse.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: buffer });
            const parsed = await parser.getText();
            return parsed.text || '';
        }
    } catch (e) {
        console.warn('extractPdfText error:', e.message);
    }
    return '';
}

require('dotenv').config({ path: path.join(__dirname, '..', 'email-settings.txt') });
if (!process.env.GEMINI_API_KEY && fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config();
}

const JWT_SECRET = process.env.JWT_SECRET || 'first-shift-secret-key-2026';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
app.use('/data', express.static(dataDir));

// Storage configurations
const memoryUpload = multer({ storage: multer.memoryStorage() });

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, dataDir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${unique}_${safeName}`);
    }
});
const fileUpload = multer({ storage: diskStorage });

const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy');

// -------------------------------------------------------------
// AUTHENTICATION MIDDLEWARE & HELPERS
// -------------------------------------------------------------
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired session' });
        req.user = user;
        next();
    });
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access restricted to authorized personnel.' });
        }
        next();
    };
}

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, phone, password, track, location, role } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, Email, and Password are required.' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (existing) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const userRole = role === 'program_manager' || role === 'admin' ? role : 'participant';
        const userTrack = track === 'reentry_nav' ? 'reentry_nav' : 'first_shift';
        const userLocation = location || 'Charleston';

        const stmt = db.prepare(`
            INSERT INTO users (name, email, phone, password_hash, role, track, location)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(name.trim(), email.toLowerCase().trim(), phone || '', passwordHash, userRole, userTrack, userLocation);
        const userId = result.lastInsertRowid;

        // Create initial participant profile & 4-week gate criteria
        if (userRole === 'participant') {
            db.prepare(`
                INSERT INTO participant_profiles (user_id, current_gate, overall_status)
                VALUES (?, 1, 'active')
            `).run(userId);
            initParticipantBriefcase(userId);
        }

        const token = jwt.sign({ id: userId, email: email.toLowerCase().trim(), name: name.trim(), role: userRole, track: userTrack }, JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            message: 'Account created successfully.',
            token,
            user: { id: userId, name: name.trim(), email: email.toLowerCase().trim(), phone, role: userRole, track: userTrack, location: userLocation }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Failed to create account.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

        const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, track: user.track }, JWT_SECRET, { expiresIn: '30d' });
        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, track: user.track, location: user.location }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

// Password Reset Route (Self-Service with Email or PM Override)
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, newPassword, userId } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters.' });
        }

        let user = null;
        if (userId) {
            user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId);
        } else if (email) {
            user = db.prepare('SELECT id, email, name FROM users WHERE LOWER(email) = ?').get(email.toLowerCase().trim());
        }

        if (!user) {
            return res.status(404).json({ error: 'Participant/User account not found.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

        res.json({ message: `Password for ${user.name} has been reset successfully.` });
    } catch(err) {
        console.error('Password reset error:', err);
        res.status(500).json({ error: 'Password reset failed: ' + err.message });
    }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    const user = db.prepare('SELECT id, name, email, phone, role, track, location, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let profile = null;
    if (user.role === 'participant') {
        profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(user.id);
    }

    res.json({ user, profile });
});

// -------------------------------------------------------------
// PARTICIPANT & FIRST SHIFT WORKFLOW ROUTES
// -------------------------------------------------------------

// Get Participant 4-Week Gate Criteria & Status
app.get('/api/participant/gate-status', authenticateToken, (req, res) => {
    let userId = req.user.id;
    if ((req.user.role === 'program_manager' || req.user.role === 'admin') && req.query.userId) {
        userId = parseInt(req.query.userId, 10);
    }
    initParticipantBriefcase(userId);
    const profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(userId);
    const criteria = db.prepare('SELECT * FROM gate_criteria WHERE user_id = ? ORDER BY week_number, id').all(userId);

    const weeks = { 1: [], 2: [], 3: [], 4: [] };
    criteria.forEach(c => {
        if (weeks[c.week_number]) weeks[c.week_number].push(c);
    });


    const casePlan = db.prepare('SELECT * FROM reentry_case_plans WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);

    let weeksEnrolled = 1;
    if (profile) {
        const enrollDateStr = profile.enrollment_date || (profile.created_at ? profile.created_at.split(' ')[0] : '2026-08-01');
        const enrollDate = new Date(enrollDateStr + 'T12:00:00Z');
        const now = new Date();
        now.setUTCHours(12, 0, 0, 0);
        function getMonday(d) {
            const date = new Date(d);
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
            date.setUTCDate(diff);
            date.setUTCHours(0, 0, 0, 0);
            return date;
        }
        const diffMs = getMonday(now).getTime() - getMonday(enrollDate).getTime();
        weeksEnrolled = Math.max(1, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1);
        profile.weeks_enrolled = weeksEnrolled;
        
        const healthCheck = db.prepare('SELECT COUNT(*) as c FROM health_wellness_screen WHERE participant_id = ?').get(userId);
        profile.has_health_screen = healthCheck ? healthCheck.c : 0;
    }
    res.json({
        currentGate: profile ? profile.current_gate : 1,
        profile,
        casePlan,
        weeks
    });
});

// Update Participant Barrier Profile (Driver's License, Child Support, Housing)
app.post('/api/participant/barriers', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { dl_status, dl_notes, child_support_status, child_support_notes, housing_status, transportation_status, court_dates } = req.body;

    db.prepare(`
        UPDATE participant_profiles SET
            dl_status = COALESCE(?, dl_status),
            dl_notes = COALESCE(?, dl_notes),
            child_support_status = COALESCE(?, child_support_status),
            child_support_notes = COALESCE(?, child_support_notes),
            housing_status = COALESCE(?, housing_status),
            transportation_status = COALESCE(?, transportation_status),
            court_dates = COALESCE(?, court_dates),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(dl_status, dl_notes, child_support_status, child_support_notes, housing_status, transportation_status, court_dates, userId);

    res.json({ message: 'Barrier profile updated successfully.' });
});

// Official Form W-9 Submission
app.post('/api/participant/w9', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { fullName, businessName, taxClassification, exemptions, address, cityStateZip, tinType, ssnOrEin, signatureName, signatureDate } = req.body;

    const w9Data = JSON.stringify({ 
        fullName: fullName || req.user.name,
        businessName: businessName || '',
        taxClassification: taxClassification || 'Individual/sole proprietor',
        exemptions: exemptions || '',
        address: address || '',
        cityStateZip: cityStateZip || '',
        tinType: tinType || 'ssn',
        ssnOrEin: ssnOrEin || '',
        signatureName: signatureName || fullName || req.user.name,
        signatureDate: signatureDate || new Date().toISOString().split('T')[0],
        requester: 'Turn90, Inc., 3765 Leeds Ave, North Charleston, SC 29405',
        certified: true
    });

    // Store in documents table
    db.prepare(`
        INSERT INTO documents (user_id, doc_type, title, filename, file_path, metadata_json)
        VALUES (?, 'w9', 'Official Form W-9 (Signed & Certified)', 'Official_Form_W9.json', 'internal_json', ?)
    `).run(userId, w9Data);

    // Update profile & week 1 gate criteria
    db.prepare(`UPDATE participant_profiles SET w9_status = 'verified' WHERE user_id = ?`).run(userId);
    db.prepare(`UPDATE gate_criteria SET status = 'green', pm_notes = 'Official Form W-9 certified and recorded on file' WHERE user_id = ? AND criterion_key = 'w1_w9_id'`).run(userId);

    res.json({ message: 'Official Form W-9 certified, recorded, and verified.', status: 'verified' });
});

// Document Uploads (ID, Certifications, etc.)
app.post('/api/participant/upload-doc', authenticateToken, fileUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const userId = req.user.id;
    const docType = req.body.docType || 'other';
    const title = req.body.title || req.file.originalname;

    db.prepare(`
        INSERT INTO documents (user_id, doc_type, title, filename, file_path, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, docType, title, req.file.filename, `/data/${req.file.filename}`, req.file.size);

    res.json({ message: 'Document saved to personal locker.', filePath: `/data/${req.file.filename}` });
});

// Get User's Documents
app.get('/api/participant/documents', authenticateToken, (req, res) => {
    const docs = db.prepare('SELECT * FROM documents WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.user.id);
    res.json(docs);
});

// Get User's Daily & Weekly Points Summary
app.get('/api/participant/points', authenticateToken, (req, res) => {
    const points = db.prepare('SELECT * FROM daily_points WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
    const summary = db.prepare(`
        SELECT COUNT(*) as total_days,
               AVG(points_earned) as avg_points,
               SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) as present_days,
               SUM(CASE WHEN attendance_status = 'unexcused' THEN 1 ELSE 0 END) as unexcused_days
        FROM daily_points WHERE user_id = ?
    `).get(req.user.id);

    const weeklySummary = getWeeklyPointsSummary(req.user.id);

    res.json({ points, summary, weeklySummary });
});

// Submit Class / Session Feedback
app.post('/api/participant/feedback', authenticateToken, (req, res) => {
    const { sessionTitle, facilitator, rating, keyTakeaway, feedbackText } = req.body;
    if (!sessionTitle || !rating) return res.status(400).json({ error: 'Session title and rating required.' });

    db.prepare(`
        INSERT INTO class_feedback (user_id, participant_name, location, session_title, facilitator, rating, key_takeaway, feedback_text)
        VALUES (?, ?, (SELECT location FROM users WHERE id = ?), ?, ?, ?, ?, ?)
    `).run(req.user.id, req.user.name, req.user.id, sessionTitle, facilitator || 'Staff Facilitator', rating, keyTakeaway || '', feedbackText || '');

    res.json({ message: 'Thank you! Class feedback submitted.' });
});


// Update Participant Gate Item (Status & Notes)
app.post('/api/participant/gate-item', authenticateToken, (req, res) => {
    let userId = req.user.id;
    if ((req.user.role === 'program_manager' || req.user.role === 'admin') && req.body.userId) {
        userId = parseInt(req.body.userId, 10);
    }
    const { criterion_key, status, participant_notes } = req.body;

    if (!['green', 'red', 'pending', 'not_applicable'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        db.prepare(`
            UPDATE gate_criteria
            SET status = ?, participant_notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND criterion_key = ?
        `).run(status, participant_notes || '', userId, criterion_key);

        res.json({ message: 'Gate updated successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get Gate Report for Staff Dashboard (Blocked / Pending items)
app.get('/api/staff/gate-report', authenticateToken, (req, res) => {
    if (req.user.role !== 'program_manager' && req.user.role !== 'director' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        // Fetch all active participants
        const users = db.prepare(`
            SELECT u.id, u.name, u.track, p.current_gate 
            FROM users u
            JOIN participant_profiles p ON u.id = p.user_id
            WHERE u.role = 'participant' AND p.overall_status IN ('active', 'reentry_nav_stabilizing')
        `).all();

        // Fetch all non-completed gate criteria for these users
        const criteria = db.prepare(`
            SELECT g.* 
            FROM gate_criteria g
            JOIN participant_profiles p ON g.user_id = p.user_id
            WHERE p.overall_status IN ('active', 'reentry_nav_stabilizing') 
              AND g.status IN ('red', 'pending')
        `).all();

        // Group by user
        const report = users.map(u => {
            return {
                ...u,
                gates: criteria.filter(c => c.user_id === u.id)
            };
        });

        res.json({ report });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Get Participant Briefcase Checklist Items
app.get('/api/participant/briefcase', authenticateToken, (req, res) => {
    const userId = req.user.id;
    // Ensure initialized
    initParticipantBriefcase(userId);

    const items = db.prepare('SELECT * FROM briefcase_items WHERE user_id = ? ORDER BY id').all(userId);
    const grouped = {};
    for (const d of Object.keys(BRIEFCASE_DOMAINS)) {
        grouped[d] = items.filter(i => i.domain === d);
    }
    res.json({ domains: BRIEFCASE_DOMAINS, items: grouped });
});

// Update Participant Briefcase Item Status
app.post('/api/participant/briefcase-item', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { itemKey, status, notes } = req.body;
    if (!itemKey || !status) return res.status(400).json({ error: 'itemKey and status required.' });

    db.prepare(`
        UPDATE briefcase_items SET
            status = ?,
            notes = COALESCE(?, notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND item_key = ?
    `).run(status, notes, userId, itemKey);

    res.json({ message: 'Briefcase item updated.' });
});

// -------------------------------------------------------------
// STATE BENEFITS & HEALTHCARE ACCESS (WELVISTA, MEDICAID, SNAP, TANF)
// -------------------------------------------------------------
app.get('/api/participant/benefits', authenticateToken, (req, res) => {
    let targetUserId = req.user.id;
    if (req.query.userId && (req.user.role === 'program_manager' || req.user.role === 'admin' || req.user.role === 'director')) {
        targetUserId = parseInt(req.query.userId);
    }

    // Ensure initialized
    initParticipantBriefcase(targetUserId);

    const rows = db.prepare('SELECT * FROM participant_benefits WHERE user_id = ?').all(targetUserId);
    const rowMap = {};
    rows.forEach(r => { rowMap[r.benefit_type] = r; });

    const merged = {};
    for (const [key, prog] of Object.entries(BENEFIT_PROGRAMS)) {
        const row = rowMap[key] || { status: 'not_started' };
        merged[key] = {
            ...prog,
            id: row.id,
            status: row.status || 'not_started',
            application_number: row.application_number || '',
            monthly_amount: row.monthly_amount || '',
            renewal_date: row.renewal_date || '',
            caseworker_contact: row.caseworker_contact || '',
            notes: row.notes || '',
            updated_at: row.updated_at || null
        };
    }

    res.json({
        userId: targetUserId,
        programs: BENEFIT_PROGRAMS,
        benefits: merged
    });
});

app.post('/api/participant/benefits', authenticateToken, (req, res) => {
    let targetUserId = req.user.id;
    if (req.body.targetUserId && (req.user.role === 'program_manager' || req.user.role === 'admin' || req.user.role === 'director')) {
        targetUserId = parseInt(req.body.targetUserId);
    }

    const {
        benefit_type,
        status,
        application_number,
        monthly_amount,
        renewal_date,
        caseworker_contact,
        notes
    } = req.body;

    if (!benefit_type || !BENEFIT_PROGRAMS[benefit_type]) {
        return res.status(400).json({ error: 'Valid benefit_type is required (welvista, medicaid, snap, tanf).' });
    }

    const safeStatus = status || 'not_started';
    const safeAppNum = application_number ? String(application_number).trim() : null;
    const safeMonthly = monthly_amount ? String(monthly_amount).trim() : null;
    const safeRenewal = renewal_date ? String(renewal_date).trim() : null;
    const safeWorker = caseworker_contact ? String(caseworker_contact).trim() : null;
    const safeNotes = notes ? String(notes).trim() : null;

    db.prepare(`
        INSERT INTO participant_benefits (
            user_id, benefit_type, status, application_number, monthly_amount, renewal_date, caseworker_contact, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, benefit_type) DO UPDATE SET
            status = excluded.status,
            application_number = COALESCE(excluded.application_number, participant_benefits.application_number),
            monthly_amount = COALESCE(excluded.monthly_amount, participant_benefits.monthly_amount),
            renewal_date = COALESCE(excluded.renewal_date, participant_benefits.renewal_date),
            caseworker_contact = COALESCE(excluded.caseworker_contact, participant_benefits.caseworker_contact),
            notes = COALESCE(excluded.notes, participant_benefits.notes),
            updated_at = CURRENT_TIMESTAMP
    `).run(targetUserId, benefit_type, safeStatus, safeAppNum, safeMonthly, safeRenewal, safeWorker, safeNotes);

    // Sync to Briefcase if marked approved
    syncBenefitToBriefcase(targetUserId, benefit_type, safeStatus, safeNotes || (safeAppNum ? `Case/App #: ${safeAppNum}` : ''));

    // Optional: Log an automatic case note update
    try {
        const progName = BENEFIT_PROGRAMS[benefit_type].name;
        const noteDetail = `[State Benefits Update] ${progName} status updated to: '${safeStatus.toUpperCase()}'. ${safeAppNum ? 'Case/App #: ' + safeAppNum + '.' : ''} ${safeMonthly ? 'Monthly Benefit: ' + safeMonthly + '.' : ''} ${safeRenewal ? 'Renewal Date: ' + safeRenewal + '.' : ''} ${safeNotes ? 'Notes: ' + safeNotes : ''}`;
        
        db.prepare(`
            INSERT INTO case_notes (user_id, author_name, note_type, category, content)
            VALUES (?, ?, 'Individual Session', 'Barriers & Stability', ?)
        `).run(targetUserId, req.user.name || 'Participant Self-Service', noteDetail.trim());
    } catch(e) {
        console.error('Failed to log benefit case note:', e);
    }

    res.json({
        success: true,
        message: `${BENEFIT_PROGRAMS[benefit_type].name} status updated successfully.`,
        benefit_type,
        status: safeStatus
    });
});


// -------------------------------------------------------------
// RE-ENTRY NAVIGATION & TRAINING ROUTES
// -------------------------------------------------------------
app.get('/api/training/cbt-modules', (req, res) => {
    try {
        if (Array.isArray(cbtModules) && cbtModules.length > 0) {
            return res.json(cbtModules);
        }
        const fallback = require('./cbt_curriculum_exact.json');
        return res.json(fallback);
    } catch (e) {
        console.error('Error serving /api/training/cbt-modules:', e);
        res.status(500).json({ error: 'Failed to load CBT modules: ' + e.message });
    }
});

// Get Participant CBT Worksheets & Submissions (Self or PM Review)
app.get('/api/training/cbt-submissions', authenticateToken, (req, res) => {
    let targetUserId = req.user.id;
    if (req.query.userId && (req.user.role === 'program_manager' || req.user.role === 'admin')) {
        targetUserId = parseInt(req.query.userId);
    }

    const rows = db.prepare('SELECT * FROM cbt_submissions WHERE user_id = ?').all(targetUserId);
    const submissions = {};
    rows.forEach(r => {
        try {
            submissions[`module_${r.module_number}_${r.tool_key}`] = {
                id: r.id,
                moduleNumber: r.module_number,
                toolKey: r.tool_key,
                responses: JSON.parse(r.responses_json),
                status: r.status,
                updatedAt: r.updated_at
            };
        } catch(e) {}
    });
    res.json(submissions);
});

// Save or Update a CBT Worksheet Submission
app.post('/api/training/cbt-submit', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { moduleNumber, toolKey, responses } = req.body;
    if (!moduleNumber || !toolKey || !responses) {
        return res.status(400).json({ error: 'moduleNumber, toolKey, and responses required.' });
    }

    db.prepare(`
        INSERT INTO cbt_submissions (user_id, module_number, tool_key, responses_json, status, updated_at)
        VALUES (?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, module_number, tool_key) DO UPDATE SET
            responses_json = excluded.responses_json,
            status = 'completed',
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, moduleNumber, toolKey, JSON.stringify(responses));

    // Auto-advance Gate 2 criterion for CBT completion if first shift
    db.prepare(`
        UPDATE gate_criteria SET status = 'green', pm_notes = 'Completed CBT Worksheet in Portal'
        WHERE user_id = ? AND criterion_key = 'w2_cbt_mastery'
    `).run(userId);

    res.json({ message: 'CBT worksheet saved successfully!', moduleNumber, toolKey });
});

app.get('/api/jobs', (req, res) => {
    try {
        const { location, q, limit } = req.query;
        const jobs = getAllReentryJobs({
            location: location || 'all',
            query: q || '',
            limit: limit ? parseInt(limit, 10) : undefined
        });
        res.json(jobs);
    } catch (err) {
        console.error('Error serving /api/jobs:', err);
        try {
            const fallback = loadJobsFromSpreadsheets().map((j, i) => ({
                id: `fallback_${i}`,
                role: j.jobTitle || 'Specialist',
                jobTitle: j.jobTitle || 'Specialist',
                company: j.company || 'Local Employer',
                location: j.location || 'South Carolina',
                pay: j.payRate || 'Competitive',
                payRate: j.payRate || 'Competitive',
                shift: '1st Shift / Full-Time',
                description: j.description || '',
                careersUrl: j.careersUrl || 'https://www.google.com'
            }));
            res.json(fallback);
        } catch (fbErr) {
            res.status(500).json({ error: 'Failed to load jobs: ' + err.message });
        }
    }
});

// Dedicated Live Google Search & Query Generator Endpoint for Fair-Chance Hiring
app.get('/api/jobs/google-search', (req, res) => {
    const { q, location } = req.query;
    const targetLoc = location && location !== 'all' ? `${location.charAt(0).toUpperCase() + location.slice(1)}, SC` : 'South Carolina';
    const keyword = q || '';

    const googleJobsUrl = buildGoogleJobsUrl(keyword, targetLoc);
    const googleWebUrl = `https://www.google.com/search?q=${encodeURIComponent('fair chance second chance employers hiring ' + keyword + ' ' + targetLoc)}`;

    const matchedJobs = getAllReentryJobs({
        location: location || 'all',
        query: keyword
    }).slice(0, 10);

    res.json({
        query: keyword,
        location: targetLoc,
        googleJobsUrl,
        googleWebUrl,
        matchedCount: matchedJobs.length,
        results: matchedJobs
    });
});


// Save Resume Data
app.post('/api/resume', authenticateToken, (req, res) => {
    const { resumeData } = req.body;
    if (!resumeData) return res.status(400).json({ error: 'Resume data required.' });

    db.prepare(`
        INSERT INTO resumes (user_id, resume_data_json)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            resume_data_json = excluded.resume_data_json,
            updated_at = CURRENT_TIMESTAMP
    `).run(req.user.id, JSON.stringify(resumeData));

    // Update Gate 3 criterion if first shift participant
    db.prepare(`
        UPDATE gate_criteria SET status = 'green', pm_notes = 'Resume created in Resume Builder'
        WHERE user_id = ? AND criterion_key = 'w3_resume_approved'
    `).run(req.user.id);

    res.json({ message: 'Resume saved successfully.' });
});

app.get('/api/resume', authenticateToken, (req, res) => {
    const row = db.prepare('SELECT resume_data_json FROM resumes WHERE user_id = ?').get(req.user.id);
    res.json(row ? JSON.parse(row.resume_data_json) : null);
});

// -------------------------------------------------------------
// PROGRAM MANAGER & ADMIN COMMAND CENTER ROUTES
// -------------------------------------------------------------

// Get Full Caseload Roster with Filters
app.get('/api/admin/caseload', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { location, track, gate, status, weekDate } = req.query;
    let query = `
        SELECT u.id, u.name, u.email, u.phone, u.location, u.track, u.created_at,
               p.current_gate, p.overall_status, p.w9_status, p.dl_status, p.dl_notes, 
               p.child_support_status, p.child_support_notes, p.housing_status, p.transportation_status,
               p.has_reentry_plan, p.reentry_status, p.enrollment_date, p.correction_notes,
               (SELECT COUNT(*) FROM gate_criteria WHERE user_id = u.id AND status = 'green') as green_criteria,
               (SELECT COUNT(*) FROM gate_criteria WHERE user_id = u.id AND status = 'red') as red_criteria,
               (SELECT AVG(points_earned) FROM daily_points WHERE user_id = u.id) as avg_points,
               (SELECT notes FROM briefcase_items WHERE user_id = u.id AND (item_key = 'skillcat_progress' OR title LIKE '%SkillCat%') LIMIT 1) as skillcat_notes,
               (SELECT COUNT(*) FROM health_wellness_screen WHERE participant_id = u.id) as has_health_screen
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant'
    `;
    const params = [];
    if (location) { query += ` AND u.location = ?`; params.push(location); }
    if (track) { query += ` AND u.track = ?`; params.push(track); }
    if (gate) { query += ` AND p.current_gate = ?`; params.push(parseInt(gate)); }
    if (status) {
        if (status === 'all') {
            // no filter on status
        } else {
            query += ` AND p.overall_status = ?`;
            params.push(status);
        }
    } else {
        // Default to active participants
        query += ` AND (p.overall_status IS NULL OR p.overall_status = 'active')`;
    }

    query += ` ORDER BY p.current_gate DESC, u.name ASC`;
    const roster = db.prepare(query).all(...params);

    // Attach weekly points, enrollment calculation, and compliance indicators (Drug Test & Case Management)
    const enhancedRoster = roster.map(p => {
        const pointsSummary = getWeeklyPointsSummary(p.id);
        const complianceSummary = getWeeklyComplianceSummary(p.id, weekDate || null);

        let weeksEnrolled = 'N/A';
        let enrollDateStr = p.enrollment_date || null;
        if (enrollDateStr) {
            const enrollDate = new Date(enrollDateStr + 'T12:00:00Z');
            const now = new Date();
            now.setUTCHours(12, 0, 0, 0);

            function getMonday(d) {
                const date = new Date(d);
                const day = date.getUTCDay();
                const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
                date.setUTCDate(diff);
                date.setUTCHours(0, 0, 0, 0);
                return date;
            }

            const enrollMonday = getMonday(enrollDate);
            const currentMonday = getMonday(now);
            const diffMs = currentMonday.getTime() - enrollMonday.getTime();
            weeksEnrolled = Math.max(1, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1);
        }

        return {
            ...p,
            enrollment_date: enrollDateStr,
            weeks_enrolled: weeksEnrolled,
            weeklyPointsAvg: pointsSummary.overallWeeklyAverage,
            currentWeekPoints: pointsSummary.currentWeekPoints,
            totalWeeksLogged: pointsSummary.totalWeeksCounted,
            has_drug_test_this_week: complianceSummary.hasDrugTest,
            drug_test_details: complianceSummary.drugTest,
            has_case_management_this_week: complianceSummary.hasCaseManagement,
            case_management_details: complianceSummary.caseNote,
            total_notes_this_week: complianceSummary.totalNotesThisWeek,
            week_start: complianceSummary.weekStart,
            week_end: complianceSummary.weekEnd,
            correction_notes: p.correction_notes || ''
        };
    });

    res.json(enhancedRoster);
});

// Switch Participant Track (First Shift <-> Re-entry Nav)
app.post('/api/pm/switch-track', authenticateToken, requireRole('program_manager', 'admin', 'director'), async (req, res) => {
    const userId = req.body.userId;
    const newTrack = req.body.newTrack || req.body.targetTrack;
    if (!userId || !newTrack) return res.status(400).json({ error: 'userId and newTrack required.' });

    if (!['first_shift', 'reentry_nav'].includes(newTrack)) {
        return res.status(400).json({ error: 'Track must be first_shift or reentry_nav.' });
    }

    db.prepare('UPDATE users SET track = ? WHERE id = ?').run(newTrack, userId);

    // Sync to Supabase in background so changes persist across container reboots/migrations
    try {
        await syncParticipantStateToSupabase(userId, { t90_track: newTrack });
    } catch (syncErr) {
        console.warn(`[SupabaseSync] Background track sync warning for userId ${userId}:`, syncErr.message);
    }

    res.json({ message: `Participant track successfully updated to ${newTrack === 'first_shift' ? 'First Shift' : 'Re-entry Navigation'}.`, track: newTrack });
});

// Remove / Archive Participant (No Longer Receiving Services)
app.post('/api/pm/archive-participant', authenticateToken, requireRole('program_manager', 'admin', 'director'), async (req, res) => {
    const { userId, reason, action } = req.body; // action: 'archive' or 'restore'
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    let newStatus = 'active';
    if (action === 'archive') newStatus = 'archived';
    if (action === 'job_placed') newStatus = 'job_placed';
    
    const reasonText = reason || (action === 'restore' ? 'Restored to active caseload' : (action === 'job_placed' ? 'Employment Secured' : 'No longer receiving services'));
    const termDate = action === 'restore' ? null : new Date().toISOString().split('T')[0];

    db.prepare(`
        UPDATE participant_profiles SET
            overall_status = ?,
            termination_reason = ?,
            termination_date = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(newStatus, reasonText, termDate, userId);

    // Sync to Supabase in background so changes persist across container reboots/migrations
    try {
        await syncParticipantStateToSupabase(userId, { 
            t90_overall_status: newStatus,
            termination_reason: reasonText,
            termination_date: termDate
        });
    } catch (syncErr) {
        console.warn(`[SupabaseSync] Background archive sync warning for userId ${userId}:`, syncErr.message);
    }

    res.json({ message: `Participant has been ${action === 'restore' ? 'restored' : 'archived'} successfully.`, status: newStatus });
});

// Participant Notes Management (Add & Retrieve)
app.get('/api/pm/notes/:userId', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const userId = req.params.userId;
    const notes = db.prepare(`
        SELECT * FROM case_notes WHERE user_id = ? ORDER BY session_date DESC, id DESC
    `).all(userId);
    res.json(notes);
});

app.post('/api/pm/notes', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, noteType, category, content, sessionDate } = req.body;
    if (!userId || !content) return res.status(400).json({ error: 'userId and content are required.' });

    const authorName = req.user.name || 'Program Manager';
    const date = sessionDate || new Date().toISOString().split('T')[0];

    db.prepare(`
        INSERT INTO case_notes (user_id, author_id, author_name, session_date, note_type, category, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, req.user.id, authorName, date, noteType || 'Individual Session', category || 'Case Management', content);

    res.json({ message: 'Case note successfully saved.' });
});

// Export Case Notes Formatted for Apricot (.xlsx or .csv)
app.get('/api/pm/notes-export', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const format = req.query.format || 'xlsx';
    const location = req.query.location || null;

    if (format === 'csv') {
        const csvData = generateApricotCaseNotesExport(false, location);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="Apricot_Case_Notes_Export.csv"');
        return res.send(csvData);
    } else {
        const buffer = generateApricotCaseNotesExport(true, location);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Apricot_Case_Notes_Export.xlsx"');
        return res.send(buffer);
    }
});

// Participant Time-Off Request (Enforcing 48-Hour Advance Notice)
app.post('/api/participant/time-off', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { requestedDate, reason, notes } = req.body;
    if (!requestedDate || !reason) return res.status(400).json({ error: 'Requested date and reason are required.' });

    // Validate 48-hour notice
    const targetDate = new Date(requestedDate + 'T00:00:00');
    const now = new Date();
    const hoursDifference = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursDifference < 47) { // 48-hour window allow small leeway for start-of-day
        return res.status(400).json({
            error: 'Time-off requests require at least 48 hours advance notice as per First Shift policy.'
        });
    }

    db.prepare(`
        INSERT INTO time_off_requests (user_id, requested_date, reason, notes, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(userId, requestedDate, reason, notes || '');

    res.json({ message: 'Time-off request submitted for Program Manager review.' });
});

// List Participant's Own Time-Off Requests
app.get('/api/participant/time-off', authenticateToken, (req, res) => {
    const requests = db.prepare(`
        SELECT * FROM time_off_requests WHERE user_id = ? ORDER BY requested_date DESC
    `).all(req.user.id);
    res.json(requests);
});

// Program Manager Time-Off Review & Action (Approve / Deny)
app.get('/api/pm/time-off-requests', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const requests = db.prepare(`
        SELECT tor.*, u.name as participant_name, u.name as user_name, u.email as participant_email, u.email as user_email, u.location, u.location as user_location, u.track
        FROM time_off_requests tor
        JOIN users u ON tor.user_id = u.id
        ORDER BY tor.requested_date ASC, tor.id DESC
    `).all();
    res.json(requests);
});

app.post('/api/pm/time-off-action', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { requestId, status, pmNotes, responseNotes } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: 'requestId and status required.' });

    const notes = pmNotes || responseNotes || '';
    db.prepare(`
        UPDATE time_off_requests SET
            status = ?,
            pm_response_notes = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, notes, req.user.name, requestId);

    // If approved, automatically record in daily_points as excused absence
    if (status === 'approved') {
        const reqRow = db.prepare('SELECT user_id, requested_date, reason FROM time_off_requests WHERE id = ?').get(requestId);
        if (reqRow) {
            db.prepare(`
                INSERT INTO daily_points (user_id, date, points_earned, max_points, attendance_status, notes)
                VALUES (?, ?, 10, 10, 'excused', ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    attendance_status = 'excused',
                    notes = excluded.notes
            `).run(reqRow.user_id, reqRow.requested_date, `Approved Time Off (48-hr Notice): ${reqRow.reason}`);
        }
    }

    res.json({ message: `Time-off request has been marked as ${status}.` });
});

// Detailed Weekly Points Breakdown for a Participant
app.get('/api/pm/points-summary/:userId', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const summary = getWeeklyPointsSummary(req.params.userId);
    res.json(summary);
});

// Update Participant Gate Criteria Status (Red/Green/Pending)
app.post('/api/admin/update-criterion', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, criterionKey, status, notes } = req.body;
    if (!userId || !criterionKey || !status) return res.status(400).json({ error: 'Missing required parameters.' });

    db.prepare(`
        UPDATE gate_criteria SET
            status = ?,
            pm_notes = COALESCE(?, pm_notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND criterion_key = ?
    `).run(status, notes, userId, criterionKey);

    res.json({ message: 'Gate criterion updated.' });
});

// Advance Participant Gate (Week 1 -> 2 -> 3 -> 4)
app.post('/api/admin/advance-gate', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, nextGate } = req.body;
    if (!userId || !nextGate) return res.status(400).json({ error: 'Missing userId or nextGate' });

    db.prepare(`UPDATE participant_profiles SET current_gate = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(nextGate, userId);
    res.json({ message: `Participant advanced to Gate ${nextGate}.` });
});

// Generate Monday Participant Needs Report
app.get('/api/admin/reports/monday-needs', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const location = req.query.location || null;
    const report = generateMondayNeedsReport(location);
    res.json(report);
});

// Generate Friday Milestone & Termination Report
app.get('/api/admin/reports/friday-milestones', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const location = req.query.location || null;
    const report = generateFridayMilestoneReport(location);
    res.json(report);
});

// Import Apricot Points Excel Spreadsheet (.xlsx, .xls) or CSV
app.post('/api/admin/apricot/import-points', authenticateToken, requireRole('program_manager', 'admin', 'director'), memoryUpload.single('file'), (req, res) => {
    try {
        let result;
        if (req.file && req.file.buffer) {
            const isExcel = req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls');
            if (isExcel) {
                // Check if it's the unified Render Report
                const XLSX = require('xlsx');
                const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
                if (wb.SheetNames.some(n => n.includes('Points - Rows') || n.includes('Drug Test - Rows') || n.includes('1st Shift'))) {
                    const { importUnifiedRenderReport } = require('./reporting_engine');
                    result = importUnifiedRenderReport(req.file.buffer);
                } else {
                    result = importApricotData(req.file.buffer, true);
                }
            } else {
                result = importApricotData(req.file.buffer, false);
            }
        } else if (req.body && req.body.csvData) {
            result = importApricotData(req.body.csvData, false);
        } else {
            return res.status(400).json({ error: 'No Excel spreadsheet or CSV data provided.' });
        }
        res.json(result);
    } catch(err) {
        res.status(500).json({ error: 'Import failed: ' + err.message });
    }
});

// Record Single Daily Point Entry manually
app.post('/api/pm/daily-point', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, date, points, attendanceStatus, notes } = req.body;
    if (!userId || !date) return res.status(400).json({ error: 'userId and date required.' });

    const pts = parseFloat(points) || 0;
    const att = attendanceStatus || 'present';

    db.prepare(`
        INSERT INTO daily_points (user_id, date, points_earned, max_points, attendance_status, notes)
        VALUES (?, ?, ?, 10, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
            points_earned = excluded.points_earned,
            attendance_status = excluded.attendance_status,
            notes = excluded.notes
    `).run(userId, date, pts, att, notes || '');

    res.json({ message: 'Daily points logged successfully.' });
});

// Record Single Drug Test Entry
app.post('/api/pm/drug-test', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, testDate, result, substancesDetected, notes } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    const dDate = testDate || new Date().toISOString().split('T')[0];
    const resVal = (result || 'negative').toLowerCase();

    db.prepare(`
        INSERT INTO drug_tests (user_id, test_date, result, substances_detected, notes, administered_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, dDate, resVal, substancesDetected || '', notes || '', req.user.name || 'Staff');

    res.json({ message: 'Drug screen record logged successfully.' });
});

// Import Drug Tests Spreadsheet (.xlsx) or CSV
app.post('/api/pm/import-drug-tests', authenticateToken, requireRole('program_manager', 'admin', 'director'), memoryUpload.single('file'), (req, res) => {
    try {
        let result;
        if (req.file && req.file.buffer) {
            const isExcel = req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls');
            result = importDrugTestData(req.file.buffer, isExcel);
        } else if (req.body && req.body.csvData) {
            result = importDrugTestData(req.body.csvData, false);
        } else {
            return res.status(400).json({ error: 'No Excel spreadsheet or CSV data provided.' });
        }
        res.json(result);
    } catch(err) {
        res.status(500).json({ error: 'Drug test import failed: ' + err.message });
    }
});

// Fetch Drug Tests for a Participant
app.get('/api/pm/drug-tests/:userId', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const tests = db.prepare(`
        SELECT * FROM drug_tests WHERE user_id = ? ORDER BY test_date DESC, id DESC
    `).all(req.params.userId);
    res.json(tests);
});

// Import Case Management Notes Spreadsheet (.xlsx) or CSV
app.post('/api/pm/import-case-notes', authenticateToken, requireRole('program_manager', 'admin', 'director'), memoryUpload.single('file'), (req, res) => {
    try {
        let result;
        if (req.file && req.file.buffer) {
            const isExcel = req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls');
            result = importCaseManagementNotesData(req.file.buffer, isExcel);
        } else if (req.body && req.body.csvData) {
            result = importCaseManagementNotesData(req.body.csvData, false);
        } else {
            return res.status(400).json({ error: 'No Excel spreadsheet or CSV data provided.' });
        }
        res.json(result);
    } catch(err) {
        res.status(500).json({ error: 'Case notes import failed: ' + err.message });
    }
});


// Delete a participant permanently
app.delete('/api/admin/participant/:userId', authenticateToken, requireRole('admin', 'program_manager', 'director'), (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    try {
        db.prepare('DELETE FROM users WHERE id = ? AND role = "participant"').run(userId);
        res.json({ message: 'Participant deleted successfully.' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete participant: ' + e.message });
    }
});

// Participant Information & Correction Notes Update (Fix erroneous information directly)
app.post('/api/pm/participant-correction', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { 
        userId, 
        correctionNotes, 
        enrollmentDate, 
        dlStatus, 
        dlNotes, 
        childSupportStatus, 
        childSupportNotes, 
        housingStatus, 
        transportationStatus,
        w9Status 
    } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'userId is required.' });


    if (req.body.track) {
        db.prepare('UPDATE users SET track = ? WHERE id = ?').run(req.body.track, userId);
    }

    // Update participant_profiles
    db.prepare(`
        UPDATE participant_profiles SET
            correction_notes = COALESCE(?, correction_notes),
            enrollment_date = COALESCE(?, enrollment_date),
            dl_status = COALESCE(?, dl_status),
            dl_notes = COALESCE(?, dl_notes),
            child_support_status = COALESCE(?, child_support_status),
            child_support_notes = COALESCE(?, child_support_notes),
            housing_status = COALESCE(?, housing_status),
            transportation_status = COALESCE(?, transportation_status),
            w9_status = COALESCE(?, w9_status),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(
        correctionNotes !== undefined ? correctionNotes : null,
        enrollmentDate !== undefined && enrollmentDate !== '' ? enrollmentDate : null,
        dlStatus !== undefined && dlStatus !== '' ? dlStatus : null,
        dlNotes !== undefined && dlNotes !== '' ? dlNotes : null,
        childSupportStatus !== undefined && childSupportStatus !== '' ? childSupportStatus : null,
        childSupportNotes !== undefined && childSupportNotes !== '' ? childSupportNotes : null,
        housingStatus !== undefined && housingStatus !== '' ? housingStatus : null,
        transportationStatus !== undefined && transportationStatus !== '' ? transportationStatus : null,
        w9Status !== undefined && w9Status !== '' ? w9Status : null,
        userId
    );

    // If staff typed in an explicit correction note, also record as a permanent case note
    if (correctionNotes && correctionNotes.trim()) {
        db.prepare(`
            INSERT INTO case_notes (user_id, author_id, author_name, session_date, note_type, category, content)
            VALUES (?, ?, ?, DATE('now'), 'Record Correction', 'Information Correction', ?)
        `).run(userId, req.user.id, req.user.name || 'Program Manager', `[Staff Record Correction]: ${correctionNotes}`);
    }

    res.json({ message: 'Participant record and correction notes updated successfully.' });
});

// Generate Case Management vs Briefcase Cross-Check Audit & Feedback Report
app.get('/api/pm/reports/cm-briefcase-audit/:userId', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    try {
        const audit = generateCaseManagementBriefcaseAudit(parseInt(req.params.userId));
        if (!audit) return res.status(404).json({ error: 'Participant not found.' });
        res.json(audit);
    } catch(err) {
        res.status(500).json({ error: 'Audit generation failed: ' + err.message });
    }
});

// Get All Official Stability Step-Down Triggers
app.get('/api/admin/stability-triggers', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    res.json(STABILITY_STEP_DOWN_TRIGGERS);
});

// Step-Down to Re-entry Nav OR Apply Director Override
app.post('/api/admin/stability-action', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const { userId, action, triggers, overrideBy, overrideNotes } = req.body;
    if (!userId || !action) return res.status(400).json({ error: 'userId and action required.' });

    if (action === 'step_down') {
        db.prepare(`
            UPDATE participant_profiles SET
                overall_status = 'reentry_nav_stabilizing',
                stability_red_flags = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(JSON.stringify(triggers || []), userId);

        db.prepare(`UPDATE users SET track = 'reentry_nav' WHERE id = ?`).run(userId);

        syncParticipantStateToSupabase(userId, { 
            t90_track: 'reentry_nav', 
            t90_overall_status: 'reentry_nav_stabilizing' 
        }).catch(e => console.warn('[SupabaseSync] resolve-triggers step_down error:', e.message));

        return res.json({ message: 'Participant stepped down to Re-entry Navigation for stabilization.' });
    } else if (action === 'director_override') {
        if (!overrideBy || !overrideNotes) return res.status(400).json({ error: 'Director Name and Override Reason required.' });

        db.prepare(`
            UPDATE participant_profiles SET
                director_override = 1,
                director_override_by = ?,
                director_override_notes = ?,
                stability_red_flags = ?,
                overall_status = 'active',
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(overrideBy, overrideNotes, JSON.stringify(triggers || []), userId);

        syncParticipantStateToSupabase(userId, { 
            t90_track: 'first_shift', 
            t90_overall_status: 'active' 
        }).catch(e => console.warn('[SupabaseSync] resolve-triggers override error:', e.message));

        return res.json({ message: 'Director Override recorded. Participant remains in First Shift.' });
    }

    res.status(400).json({ error: 'Invalid action.' });
});

// Submit Weekly 4-Pillar Case Planning Review
app.post('/api/admin/weekly-case-review', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const {
        userId, weekNumber, reviewedBy,
        hasStabilityIssues, stabilityIssuesDetails, canMeetRapidly, needsMoreResources, resourceNotes,
        attendanceSatisfactory, abilityLearnQ2, removingEmploymentBarriers,
        cbtHomeworkCompleted, cbtDiscussionActive, cbtRoleplayEffort, cbtNotes,
        transportationViable, qualifiedForDesiredJobs, noDisqualifyingConvictions,
        scheduleSupervisionAligned, noPsfOvernightIssues, jobMatchNotes,
        caseDecision, decisionRationale
    } = req.body;

    if (!userId || !weekNumber) return res.status(400).json({ error: 'userId and weekNumber required.' });

    db.prepare(`
        INSERT INTO weekly_case_reviews (
            user_id, week_number, reviewed_by,
            has_stability_issues, stability_issues_details, can_meet_rapidly, needs_more_resources, resource_notes,
            attendance_satisfactory, ability_learn_q2, removing_employment_barriers,
            cbt_homework_completed, cbt_discussion_active, cbt_roleplay_effort, cbt_notes,
            transportation_viable, qualified_for_desired_jobs, no_disqualifying_convictions,
            schedule_supervision_aligned, no_psf_overnight_issues, job_match_notes,
            case_decision, decision_rationale
        ) VALUES (
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?
        )
    `).run(
        userId, weekNumber, reviewedBy || req.user.name,
        hasStabilityIssues ? 1 : 0, stabilityIssuesDetails || '', canMeetRapidly ? 1 : 0, needsMoreResources ? 1 : 0, resourceNotes || '',
        attendanceSatisfactory ? 1 : 0, abilityLearnQ2 ? 1 : 0, removingEmploymentBarriers ? 1 : 0,
        cbtHomeworkCompleted ? 1 : 0, cbtDiscussionActive ? 1 : 0, cbtRoleplayEffort ? 1 : 0, cbtNotes || '',
        transportationViable ? 1 : 0, qualifiedForDesiredJobs ? 1 : 0, noDisqualifyingConvictions ? 1 : 0,
        scheduleSupervisionAligned ? 1 : 0, noPsfOvernightIssues ? 1 : 0, jobMatchNotes || '',
        caseDecision || 'continue_first_shift', decisionRationale || ''
    );

    res.json({ message: 'Weekly case plan review saved successfully.' });
});

// Get Class Feedback Summary
app.get('/api/admin/feedback-summary', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const feedback = db.prepare(`SELECT * FROM class_feedback ORDER BY submitted_at DESC LIMIT 50`).all();
    const stats = db.prepare(`
        SELECT session_title, COUNT(*) as responses, AVG(rating) as avg_rating
        FROM class_feedback GROUP BY session_title
    `).all();
    res.json({ feedback, stats });
});

// -------------------------------------------------------------
// EXISTING AUDIO INTERVIEW & LLM PIPELINE (PRESERVED IN FULL)
// -------------------------------------------------------------

app.delete('/api/interviews/:clientId', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    try {
        const clientId = req.params.clientId;
        if (!clientId || clientId.includes('..') || clientId.includes('/')) return res.status(400).json({error: "Invalid client ID"});
        
        const files = fs.readdirSync(dataDir);
        let deletedCount = 0;
        files.forEach(f => {
            if (f.startsWith(clientId + '_') && !f.endsWith('.sqlite')) {
                fs.unlinkSync(path.join(dataDir, f));
                deletedCount++;
            }
        });
        res.json({ success: true, deleted: deletedCount });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Failed to delete records.' });
    }
});

app.get('/api/interviews', (req, res) => {
    try {
        const files = fs.readdirSync(dataDir);
        const SUFFIXES = ['_draft_scoring_form', '_final_scoring_form', '_final_case_brief', '_interview_guide', '_transcript.txt', '_participant_case_plan', '_criminal_history'];
        const clients = {};
        files.forEach(f => {
            if (f.endsWith('.sqlite') || f.includes('.sqlite') || f.startsWith('.') || f.includes('reentry')) return;
            for (const suf of SUFFIXES) {
                if (f.includes(suf)) {
                    const idx = f.indexOf(suf);
                    const clientId = f.substring(0, idx);
                    if (!clients[clientId]) clients[clientId] = [];
                    clients[clientId].push(f);
                    break;
                }
            }
        });
        res.json(clients);
    } catch(err) {
        res.status(500).json({error: "Failed to read data directory"});
    }
});

// Fetch file content securely for in-browser preview
app.get('/api/file-content', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const filename = req.query.file;
    if (!filename || filename === 'undefined' || filename === 'null' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename requested.' });
    }

    let filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'manuals', filename);
    }
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, '..', filename);
    }
    if (!fs.existsSync(filePath)) {
        // Case-insensitive lookup fallback for Linux/Render environments
        const findInsensitive = (dir, target) => {
            if (!fs.existsSync(dir)) return null;
            const dirFiles = fs.readdirSync(dir);
            const match = dirFiles.find(f => f.toLowerCase() === target.toLowerCase());
            return match ? path.join(dir, match) : null;
        };
        filePath = findInsensitive(dataDir, filename) || 
                   findInsensitive(path.join(__dirname, 'manuals'), filename) ||
                   findInsensitive(path.join(__dirname, '..'), filename);
    }

    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File "${filename}" not found.` });
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return res.json({ content, filename });
    } catch(err) {
        return res.status(500).json({ error: `Failed to read file "${filename}": ${err.message}` });
    }
});

// Serve raw document files (PDFs, DOCX, XLSX, MD) with correct MIME types
app.get('/api/documents/raw/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    let filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'manuals', filename);
    }
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, '..', filename);
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    let contentType = 'application/octet-stream';
    if (filename.endsWith('.pdf')) contentType = 'application/pdf';
    else if (filename.endsWith('.docx')) contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (filename.endsWith('.xlsx')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (filename.endsWith('.md') || filename.endsWith('.txt')) contentType = 'text/plain; charset=utf-8';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
});

// Helper to build executive print-ready HTML for scoring forms, transcripts, and guides
function buildPrintableDocumentHtml(filename, content, isBatch = false) {
    const { marked } = require('marked');
    if (typeof marked !== 'undefined' && marked.setOptions) {
        marked.setOptions({ breaks: true, gfm: true });
    }

    const isScoring = filename.includes('scoring_form');
    const isTranscript = filename.includes('transcript') || filename.endsWith('.txt');
    const isGuide = filename.includes('interview_guide');
    const isCriminal = filename.includes('criminal_history');
    const isFinal = filename.includes('final');

    // Extract participant and location from filename or header
    let clientName = 'Participant';
    let location = 'Turn90 Center';
    const cleanFilename = filename.replace(/\.(md|txt)$/i, '');

    if (cleanFilename.toLowerCase().includes('dillon')) {
        clientName = 'Dillon Johnson';
        location = 'Charleston';
    } else if (cleanFilename.toLowerCase().includes('jovon')) {
        clientName = 'Jovon Bonneau';
        location = 'Charleston';
    } else if (cleanFilename.toLowerCase().includes('keyzelle')) {
        clientName = 'Keyzelle Thomas';
        location = 'Columbia';
    } else if (cleanFilename.toLowerCase().includes('countee')) {
        clientName = 'William Theophilus Countee';
        location = 'Charleston';
    } else if (cleanFilename.toLowerCase().includes('pinckney') || cleanFilename.toLowerCase().includes('lawrence')) {
        clientName = 'Lawrence Pinckney';
        location = 'Columbia';
    } else if (cleanFilename.toLowerCase().includes('oree') || cleanFilename.toLowerCase().includes('isiah')) {
        clientName = 'Isiah Jonathan Cade Oree';
        location = 'Charleston';
    } else if (cleanFilename.toLowerCase().includes('alston') || cleanFilename.toLowerCase().includes('hakeem')) {
        clientName = 'Hakeem Markus Alston';
        location = 'Charleston';
    } else if (cleanFilename.toLowerCase().includes('clyde') || cleanFilename.toLowerCase().includes('williams')) {
        clientName = 'Clyde Williams';
        location = 'Columbia';
    } else {
        const nameParts = cleanFilename.split('_');
        if (nameParts.length >= 2) {
            if (nameParts.includes('Charleston')) {
                location = 'Charleston';
                clientName = nameParts.slice(0, nameParts.indexOf('Charleston')).join(' ');
            } else if (nameParts.includes('Columbia')) {
                location = 'Columbia';
                clientName = nameParts.slice(0, nameParts.indexOf('Columbia')).join(' ');
            } else if (nameParts.includes('Spartanburg')) {
                location = 'Spartanburg';
                clientName = nameParts.slice(0, nameParts.indexOf('Spartanburg')).join(' ');
            } else {
                clientName = nameParts.slice(0, 2).join(' ');
            }
        }
    }
    clientName = clientName.replace(/keyzelle limamauel curtis thomas/gi, 'Keyzelle Thomas');

    let bodyHtml = '';

    if (isScoring) {
        // Robust regex helpers for domain scores and total scores
        function extractDomainScore(text, domainCode) {
            const re = new RegExp(`(?:\\*\\*|\\*|__|_)?${domainCode}\\s*Score:?(?:\\*\\*|\\*|__|_)?\\s*(?:\\*\\*|\\*|__|_)?(\\d+)`, 'i');
            const m = text.match(re);
            if (m) return parseInt(m[1], 10);
            const re2 = new RegExp(`(?:^|[\\s*|])${domainCode}\\s*:\\s*(?:\\*\\*|\\*|__|_)?(\\d+)`, 'im');
            const m2 = text.match(re2);
            if (m2) return parseInt(m2[1], 10);
            return 0;
        }

        function extractTotalScore(text) {
            const re = /(?:Total\s*(?:Section\s*1\s*|LS\/CMI\s*)?Score:?)\s*(?:\*\*|\*|__|_)?\s*(\d+)/i;
            const m = text.match(re);
            return m ? parseInt(m[1], 10) : null;
        }

        const ch = extractDomainScore(content, 'CH');
        const ee = extractDomainScore(content, 'EE');
        const fm = extractDomainScore(content, 'FM');
        const lr = extractDomainScore(content, 'LR');
        const co = extractDomainScore(content, 'CO');
        const adp = extractDomainScore(content, 'ADP');
        const pa = extractDomainScore(content, 'PA');
        const ap = extractDomainScore(content, 'AP');

        let totalScore = extractTotalScore(content);
        if (totalScore === null || isNaN(totalScore)) {
            totalScore = ch + ee + fm + lr + co + adp + pa + ap;
        }

        const riskLevel = totalScore >= 30 ? 'VERY HIGH' : (totalScore >= 20 ? 'HIGH' : (totalScore >= 11 ? 'MEDIUM' : (totalScore >= 5 ? 'LOW' : 'VERY LOW')));
        const riskColor = totalScore >= 20 ? '#dc2626' : (totalScore >= 11 ? '#d97706' : '#16a34a');
        const riskBg = totalScore >= 20 ? '#fee2e2' : (totalScore >= 11 ? '#fef3c7' : '#dcfce7');

        // Clean markdown content: strip leading title and Section 1 header to avoid duplication with executive top box
        let cleanedContent = content;
        cleanedContent = cleanedContent.replace(/^#\s*LS\/?CMI\s*Scoring\s*Form\s*\n+/i, '');
        cleanedContent = cleanedContent.replace(/^(?:##|\*\*)\s*Section\s*1:\s*General\s*Risk\/Need\s*Factors\s*(?:\*\*)?\s*\n+/im, '');
        // Standardize subsection headers
        cleanedContent = cleanedContent.replace(/^[*_]{2}(\d+\.\d+\s+[^*\n]+)[*_]{2}\s*$/gm, '### $1');
        cleanedContent = cleanedContent.replace(/^[*_]{2}(Section\s+\d+:[^*\n]+)[*_]{2}\s*$/gm, '## $1');
        // Strip redundant Total Scores block before Section 2
        cleanedContent = cleanedContent.replace(/(?:###|\*\*)\s*Total\s*Scores.*?(?=(?:\n---|\n##\s*Section\s*2|\n\*\*Section\s*2))/is, '');
        cleanedContent = cleanedContent.replace(/\n---\s*(?=\n##\s*Section\s*2)/i, '');
        cleanedContent = cleanedContent.trim();

        // Render Markdown content
        const renderedMarkdown = typeof marked !== 'undefined' ? marked.parse(cleanedContent) : cleanedContent.replace(/\n/g, '<br>');

        bodyHtml = `
            <div class="scoring-report-container" style="page-break-after: always; margin-bottom: 30px;">
                <!-- Official Turn90 Scoring Header -->
                <div style="border-bottom: 3px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <div style="font-size: 11px; font-weight: 800; color: #0f766e; letter-spacing: 1px; text-transform: uppercase;">
                                TURN90 • FIRST SHIFT REENTRY INITIATIVE
                            </div>
                            <h1 style="margin: 4px 0 2px 0; font-size: 20pt; color: #0f172a; border-bottom: none; padding: 0;">
                                Level of Service / Case Management Inventory (LS/CMI)
                            </h1>
                            <div style="font-size: 11pt; color: #475569; font-weight: 500;">
                                Standardized Assessment Scoring Record & Criminogenic Profile
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <span style="display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 11pt; font-weight: 800; background: ${isFinal ? '#dcfce7' : '#e0f2fe'}; color: ${isFinal ? '#15803d' : '#0369a1'}; border: 1.5px solid ${isFinal ? '#86efac' : '#93c5fd'};">
                                ${isFinal ? '✅ FINAL APPROVED SCORING' : '⏳ PHASE 1 DRAFT SCORING'}
                            </span>
                            <div style="font-size: 9.5pt; color: #64748b; margin-top: 4px;">Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                    </div>
                </div>

                <!-- Participant Metadata Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; margin-bottom: 18px; font-size: 10pt;">
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Participant Name</span><strong style="font-size: 11.5pt; color: #0f172a;">${clientName}</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Program Center</span><strong>Turn90 ${location}</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Assessment Tool</span><strong>LS/CMI Section 1-8</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Assessor / Reviewer</span><strong>Case Management Team</strong></div>
                </div>

                <!-- Executive Scorecard Summary Table -->
                <div style="margin-bottom: 22px; border: 1.5px solid #cbd5e1; border-radius: 6px; overflow: hidden; page-break-inside: avoid;">
                    <div style="background: #0f766e; color: white; padding: 8px 14px; font-weight: 700; font-size: 11pt; display: flex; justify-content: space-between; align-items: center;">
                        <span>📊 Executive Section 1 Summary of Risk/Need Factors</span>
                        <span style="background: ${riskBg}; color: ${riskColor}; padding: 2px 10px; border-radius: 12px; font-size: 10pt; font-weight: 800;">
                            OVERALL: ${riskLevel} RISK (${totalScore} / 43)
                        </span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; margin: 0; font-size: 10pt;">
                        <thead>
                            <tr style="background: #f1f5f9; border-bottom: 1.5px solid #cbd5e1;">
                                <th style="padding: 6px 10px; text-align: left;">Subcomponent Domain</th>
                                <th style="padding: 6px 10px; text-align: center; width: 60px;">Code</th>
                                <th style="padding: 6px 10px; text-align: center; width: 90px;">Total Items</th>
                                <th style="padding: 6px 10px; text-align: center; width: 90px;">Raw Score</th>
                                <th style="padding: 6px 10px; text-align: center; width: 120px;">Domain Rating</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 6px 10px;"><strong>1. Criminal History</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">CH</td>
                                <td style="padding: 6px 10px; text-align: center;">8</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${ch}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${ch >= 5 ? '#dc2626' : (ch >= 2 ? '#d97706' : '#16a34a')}">${ch >= 5 ? 'High' : (ch >= 2 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0; background: #fafafa;">
                                <td style="padding: 6px 10px;"><strong>2. Education / Employment</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">EE</td>
                                <td style="padding: 6px 10px; text-align: center;">9</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${ee}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${ee >= 7 ? '#dc2626' : (ee >= 4 ? '#d97706' : '#16a34a')}">${ee >= 7 ? 'High' : (ee >= 4 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 6px 10px;"><strong>3. Family / Marital</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">FM</td>
                                <td style="padding: 6px 10px; text-align: center;">4</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${fm}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${fm >= 4 ? '#dc2626' : (fm >= 2 ? '#d97706' : '#16a34a')}">${fm >= 4 ? 'High' : (fm >= 2 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0; background: #fafafa;">
                                <td style="padding: 6px 10px;"><strong>4. Leisure / Recreation</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">LR</td>
                                <td style="padding: 6px 10px; text-align: center;">2</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${lr}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${lr >= 2 ? '#dc2626' : (lr >= 1 ? '#d97706' : '#16a34a')}">${lr >= 2 ? 'High' : (lr >= 1 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 6px 10px;"><strong>5. Companions</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">CO</td>
                                <td style="padding: 6px 10px; text-align: center;">4</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${co}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${co >= 4 ? '#dc2626' : (co >= 2 ? '#d97706' : '#16a34a')}">${co >= 4 ? 'High' : (co >= 2 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0; background: #fafafa;">
                                <td style="padding: 6px 10px;"><strong>6. Alcohol / Substance Problem</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">ADP</td>
                                <td style="padding: 6px 10px; text-align: center;">8</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${adp}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${adp >= 6 ? '#dc2626' : (adp >= 3 ? '#d97706' : '#16a34a')}">${adp >= 6 ? 'High' : (adp >= 3 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 6px 10px;"><strong>7. Procriminal Attitude / Orientation</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">PA</td>
                                <td style="padding: 6px 10px; text-align: center;">4</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${pa}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${pa >= 4 ? '#dc2626' : (pa >= 2 ? '#d97706' : '#16a34a')}">${pa >= 4 ? 'High' : (pa >= 2 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="border-bottom: 1.5px solid #cbd5e1; background: #fafafa;">
                                <td style="padding: 6px 10px;"><strong>8. Antisocial Pattern</strong></td>
                                <td style="padding: 6px 10px; text-align: center;">AP</td>
                                <td style="padding: 6px 10px; text-align: center;">4</td>
                                <td style="padding: 6px 10px; text-align: center; font-weight: 700;">${ap}</td>
                                <td style="padding: 6px 10px; text-align: center;"><span style="font-weight: 700; color: ${ap >= 4 ? '#dc2626' : (ap >= 2 ? '#d97706' : '#16a34a')}">${ap >= 4 ? 'High' : (ap >= 2 ? 'Medium' : 'Low')}</span></td>
                            </tr>
                            <tr style="background: #f8fafc; font-weight: 800; font-size: 10.5pt;">
                                <td colspan="3" style="padding: 8px 10px; text-align: right; text-transform: uppercase;">Total General Risk/Need Score:</td>
                                <td style="padding: 8px 10px; text-align: center; font-size: 12pt; color: #0f172a;">${totalScore} / 43</td>
                                <td style="padding: 8px 10px; text-align: center; color: ${riskColor}; font-size: 11pt;">${riskLevel} RISK</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Full Detailed Breakdown from Markdown -->
                <div class="detailed-scoring-body" style="font-size: 10pt; line-height: 1.5;">
                    ${renderedMarkdown}
                </div>

                <!-- Official Assessor & Supervisor Certification Block -->
                <div style="margin-top: 36px; padding-top: 20px; border-top: 2px solid #cbd5e1; page-break-inside: avoid;">
                    <div style="font-size: 10.5pt; font-weight: 700; color: #0f172a; margin-bottom: 16px;">
                        OFFICIAL ASSESSMENT CERTIFICATION & SIGN-OFF
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                        <div>
                            <div style="border-bottom: 1.5px solid #0f172a; height: 35px; margin-bottom: 6px;"></div>
                            <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">Assessing Case Manager Signature</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Printed Name & Title: _____________________________________</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Date: ________________________</div>
                        </div>
                        <div>
                            <div style="border-bottom: 1.5px solid #0f172a; height: 35px; margin-bottom: 6px;"></div>
                            <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">Program Director / Program Supervisor Signature</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Printed Name & Title: _____________________________________</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Date: ________________________</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else if (isTranscript) {
        const lines = content.split('\n');
        let dialogueHtml = '';
        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            if (trimmed.startsWith('Interviewer:')) {
                dialogueHtml += `
                    <div style="margin-bottom: 10px; padding: 6px 12px; background: #f8fafc; border-left: 3px solid #0284c7; border-radius: 0 4px 4px 0; page-break-inside: avoid;">
                        <strong style="color: #0369a1; font-size: 9.5pt; text-transform: uppercase;">🎙️ Interviewer</strong>
                        <div style="font-size: 10pt; color: #0f172a; margin-top: 2px;">${trimmed.replace(/^Interviewer:\s*/i, '')}</div>
                    </div>
                `;
            } else if (/^[A-Za-z\s]+:/.test(trimmed)) {
                const colonIdx = trimmed.indexOf(':');
                const speaker = trimmed.substring(0, colonIdx);
                const speech = trimmed.substring(colonIdx + 1).trim();
                dialogueHtml += `
                    <div style="margin-bottom: 12px; padding: 8px 14px; background: #ffffff; border-left: 3px solid #0f766e; border-radius: 0 4px 4px 0; border: 1px solid #e2e8f0; border-left-width: 3px; page-break-inside: avoid;">
                        <strong style="color: #0f766e; font-size: 9.5pt; text-transform: uppercase;">👤 ${speaker}</strong>
                        <div style="font-size: 10pt; color: #1e293b; margin-top: 2px;">${speech}</div>
                    </div>
                `;
            } else {
                dialogueHtml += `<div style="font-size: 9.5pt; color: #475569; font-style: italic; margin-bottom: 6px;">${trimmed}</div>`;
            }
        });

        bodyHtml = `
            <div style="border-bottom: 3px solid #0284c7; padding-bottom: 10px; margin-bottom: 16px;">
                <div style="font-size: 10pt; font-weight: 800; color: #0284c7; text-transform: uppercase; letter-spacing: 1px;">TURN90 • FIRST SHIFT REENTRY INITIATIVE</div>
                <h1 style="margin: 4px 0 2px 0; font-size: 18pt; color: #0f172a;">Official Intake Assessment Interview Transcript</h1>
                <div style="font-size: 10pt; color: #64748b;">Participant: <strong>${clientName}</strong> • Center: <strong>Turn90 ${location}</strong> • Total Dialogue Turns: <strong>${lines.length} lines</strong></div>
            </div>
            <div>${dialogueHtml}</div>
        `;
    } else if (isCriminal) {
        // Executive formatting for Criminal History Reports
        let cleanedContent = content;
        cleanedContent = cleanedContent.replace(/^#\s*Official\s*Criminal\s*History.*?\n+/i, '');
        cleanedContent = cleanedContent.replace(/^\*\*Turn90 Reentry Initiative.*?\n+/im, '');
        cleanedContent = cleanedContent.replace(/^\*\*Participant:\*\*.*?\n+/im, '');
        cleanedContent = cleanedContent.replace(/^\*\*Prepared For:\*\*.*?\n+/im, '');
        cleanedContent = cleanedContent.replace(/^\*\*Data Sources:\*\*.*?\n+/im, '');
        cleanedContent = cleanedContent.replace(/^---\s*\n+/m, '');

        const renderedMarkdown = typeof marked !== 'undefined' ? marked.parse(cleanedContent.trim()) : cleanedContent.replace(/\n/g, '<br>');

        bodyHtml = `
            <div class="criminal-history-report-container" style="page-break-after: always; margin-bottom: 30px;">
                <!-- Official Turn90 Criminal History Header -->
                <div style="border-bottom: 3px solid #1e293b; padding-bottom: 12px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <div style="font-size: 11px; font-weight: 800; color: #0f766e; letter-spacing: 1px; text-transform: uppercase;">
                                TURN90 • FIRST SHIFT REENTRY INITIATIVE
                            </div>
                            <h1 style="margin: 4px 0 2px 0; font-size: 20pt; color: #0f172a; border-bottom: none; padding: 0;">
                                Official Criminal History & Chronological Disposition Record
                            </h1>
                            <div style="font-size: 11pt; color: #475569; font-weight: 500;">
                                Verified Arrest Chronology, Charge Dispositions & Supervision Risk Profile
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <span style="display: inline-block; padding: 6px 12px; border-radius: 4px; font-size: 11pt; font-weight: 800; background: #f1f5f9; color: #0f172a; border: 1.5px solid #cbd5e1;">
                                ⚖️ OFFICIAL RECORD
                            </span>
                            <div style="font-size: 9.5pt; color: #64748b; margin-top: 4px;">Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                    </div>
                </div>

                <!-- Participant Metadata Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; margin-bottom: 18px; font-size: 10pt;">
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Participant Name</span><strong style="font-size: 11.5pt; color: #0f172a;">${clientName}</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Program Center</span><strong>Turn90 ${location}</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Record Classification</span><strong>Judicial & Agency Record</strong></div>
                    <div><span style="color: #64748b; font-size: 9pt; display: block; text-transform: uppercase; font-weight: 700;">Case Management Team</span><strong>Reentry Navigation</strong></div>
                </div>

                <!-- Main Content Body -->
                <div class="detailed-scoring-body" style="font-size: 10pt; line-height: 1.55;">
                    ${renderedMarkdown}
                </div>

                <!-- Legal Verification & Certification Block -->
                <div style="margin-top: 36px; padding-top: 20px; border-top: 2px solid #cbd5e1; page-break-inside: avoid;">
                    <div style="font-size: 10.5pt; font-weight: 700; color: #0f172a; margin-bottom: 16px;">
                        CASE MANAGEMENT RECORD REVIEW & VERIFICATION
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                        <div>
                            <div style="border-bottom: 1.5px solid #0f172a; height: 35px; margin-bottom: 6px;"></div>
                            <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">Reentry Navigator / Case Manager Signature</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Printed Name & Title: _____________________________________</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Date: ________________________</div>
                        </div>
                        <div>
                            <div style="border-bottom: 1.5px solid #0f172a; height: 35px; margin-bottom: 6px;"></div>
                            <div style="font-size: 10pt; font-weight: 700; color: #0f172a;">Program Director / Legal Services Review</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Printed Name & Title: _____________________________________</div>
                            <div style="font-size: 9pt; color: #64748b; margin-top: 2px;">Date: ________________________</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        const rendered = typeof marked !== 'undefined' ? marked.parse(content) : content.replace(/\n/g, '<br>');
        bodyHtml = `
            <div style="border-bottom: 2px solid #0f766e; padding-bottom: 8px; margin-bottom: 16px;">
                <div style="font-size: 10pt; font-weight: 800; color: #0f766e; text-transform: uppercase; letter-spacing: 1px;">TURN90 • FIRST SHIFT REENTRY INITIATIVE</div>
                <h1 style="margin: 4px 0 2px 0; font-size: 18pt; color: #0f172a;">${cleanFilename.replace(/_/g, ' ')}</h1>
                <div style="font-size: 10pt; color: #64748b;">Participant: <strong>${clientName}</strong> • Location: <strong>${location}</strong></div>
            </div>
            <div style="font-size: 10pt; line-height: 1.6;">${rendered}</div>
        `;
    }

    return bodyHtml;
}

function buildPrintablePageHtml(title, docHtml, autoprint = false) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Print: ${title}</title>
    <style>
        @page {
            size: letter;
            margin: 0.5in 0.6in 0.5in 0.6in;
        }
        * {
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 10.5pt;
            line-height: 1.5;
            color: #0f172a;
            background: #ffffff;
            margin: 0;
            padding: 24px;
        }
        .print-toolbar {
            position: sticky;
            top: 0;
            background: #1e293b;
            color: white;
            padding: 10px 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 6px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 1000;
        }
        .print-btn {
            background: #0f766e;
            color: white;
            border: none;
            padding: 8px 18px;
            font-size: 13px;
            font-weight: 700;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .print-btn:hover {
            background: #0d9488;
        }
        .close-btn {
            background: transparent;
            color: #94a3b8;
            border: 1px solid #475569;
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        .close-btn:hover {
            color: white;
            border-color: #cbd5e1;
        }
        .doc-container {
            max-width: 850px;
            margin: 0 auto;
        }
        h1 {
            font-size: 16pt;
            color: #0f172a;
            margin-top: 14px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        h2 {
            font-size: 13pt;
            color: #0f766e;
            border-bottom: 1.5px solid #cbd5e1;
            padding-bottom: 4px;
            margin-top: 16px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        h3 {
            font-size: 11pt;
            color: #0284c7;
            margin-top: 12px;
            margin-bottom: 6px;
            page-break-after: avoid;
        }
        h4, h5, h6 {
            font-size: 10pt;
            color: #334155;
            margin-top: 10px;
            margin-bottom: 4px;
            page-break-after: avoid;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 9.5pt;
            page-break-inside: auto;
        }
        tr {
            page-break-inside: avoid;
            page-break-after: auto;
        }
        th, td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
            text-align: left;
            vertical-align: top;
        }
        th {
            background-color: #f1f5f9 !important;
            font-weight: 700;
            color: #0f172a;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        blockquote {
            border-left: 3px solid #0f766e;
            margin: 10px 0;
            padding: 6px 12px;
            background: #f8fafc !important;
            color: #334155;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        ul, ol {
            padding-left: 22px;
            margin: 6px 0;
        }
        li {
            margin-bottom: 3px;
        }
        hr {
            border: none;
            border-top: 1px solid #cbd5e1;
            margin: 16px 0;
        }
        /* Detailed Scoring Body Styling to match top scorecard */
        .detailed-scoring-body {
            font-size: 10pt;
            line-height: 1.55;
            color: #1e293b;
        }
        .detailed-scoring-body h2 {
            font-size: 13pt;
            color: #0f766e;
            border-bottom: 2px solid #0f766e;
            padding-bottom: 5px;
            margin-top: 24px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }
        .detailed-scoring-body h3 {
            font-size: 11pt;
            font-weight: 700;
            color: #0369a1;
            background: #f0f9ff;
            border-left: 4px solid #0284c7;
            padding: 5px 10px;
            border-radius: 0 4px 4px 0;
            margin-top: 16px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }
        .detailed-scoring-body ol, .detailed-scoring-body ul {
            padding-left: 20px;
            margin: 6px 0 12px 0;
        }
        .detailed-scoring-body li {
            margin-bottom: 4px;
            color: #334155;
        }
        .detailed-scoring-body strong {
            color: #0f172a;
        }
        @media print {
            .print-toolbar {
                display: none !important;
            }
            body {
                padding: 0 !important;
                background: white !important;
            }
            .doc-container {
                max-width: 100% !important;
                width: 100% !important;
                margin: 0 !important;
            }
            th {
                background-color: #f1f5f9 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            blockquote {
                background-color: #f8fafc !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    <div class="print-toolbar">
        <div>
            <strong>Document:</strong> ${title}
        </div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <button class="print-btn" onclick="window.print()">🖨️ Print Document</button>
            <button class="close-btn" onclick="window.close()">✕ Close</button>
        </div>
    </div>
    <div class="doc-container">
        ${docHtml}
    </div>
    <script>
        if (${autoprint} || window.location.search.includes('autoprint=true')) {
            window.addEventListener('load', () => { setTimeout(() => window.print(), 500); });
        }
    </script>
</body>
</html>`;
}

// Dedicated standalone printable HTML view for any document in Human-in-the-Loop
app.get('/api/documents/print/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).send('Invalid filename');
    }
    let filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'manuals', filename);
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Document file not found');
    }

    if (filename.endsWith('.pdf')) {
        return res.redirect(`/api/documents/raw/${encodeURIComponent(filename)}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const docHtml = buildPrintableDocumentHtml(filename, content);
    const title = filename.replace(/\.(md|txt)$/i, '').replace(/_/g, ' ');
    const html = buildPrintablePageHtml(title, docHtml, req.query.autoprint === 'true');
    res.send(html);
});

// Batch print all completed scoring forms across participants
app.get('/api/documents/print-all-scorings', (req, res) => {
    try {
        const files = fs.readdirSync(dataDir);
        const scoringFiles = files.filter(f => f.includes('final_scoring_form.md') || f.includes('draft_scoring_form.md'));

        // Group by client and pick final over draft
        const clientScorings = {};
        scoringFiles.forEach(f => {
            const clientId = f.replace(/_(final|draft)_scoring_form\.md$/, '');
            if (f.includes('final') || !clientScorings[clientId]) {
                clientScorings[clientId] = f;
            }
        });

        const selectedFiles = Object.values(clientScorings);
        if (selectedFiles.length === 0) {
            return res.status(404).send('No completed scoring forms found in data directory.');
        }

        let combinedHtml = '';
        selectedFiles.forEach(file => {
            const filePath = path.join(dataDir, file);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                combinedHtml += buildPrintableDocumentHtml(file, content, true);
            }
        });

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Batch Print: Completed Participant Scorings (${selectedFiles.length})</title>
    <style>
        @page { size: letter; margin: 0.5in 0.6in 0.5in 0.6in; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #0f172a; margin: 0; padding: 24px; }
        .print-toolbar { position: sticky; top: 0; background: #1e293b; color: white; padding: 10px 18px; display: flex; justify-content: space-between; align-items: center; border-radius: 6px; margin-bottom: 20px; z-index: 1000; }
        .print-btn { background: #0f766e; color: white; border: none; padding: 8px 18px; font-size: 13px; font-weight: 700; border-radius: 4px; cursor: pointer; }
        .close-btn { background: transparent; color: #94a3b8; border: 1px solid #475569; padding: 6px 12px; font-size: 12px; border-radius: 4px; cursor: pointer; }
        .doc-container { max-width: 850px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background-color: #f1f5f9 !important; font-weight: 700; -webkit-print-color-adjust: exact; }
        .detailed-scoring-body { font-size: 10pt; line-height: 1.55; color: #1e293b; }
        .detailed-scoring-body h2 { font-size: 13pt; color: #0f766e; border-bottom: 2px solid #0f766e; padding-bottom: 5px; margin-top: 24px; margin-bottom: 12px; page-break-after: avoid; }
        .detailed-scoring-body h3 { font-size: 11pt; font-weight: 700; color: #0369a1; background: #f0f9ff; border-left: 4px solid #0284c7; padding: 5px 10px; border-radius: 0 4px 4px 0; margin-top: 16px; margin-bottom: 8px; page-break-after: avoid; }
        .detailed-scoring-body ol, .detailed-scoring-body ul { padding-left: 20px; margin: 6px 0 12px 0; }
        .detailed-scoring-body li { margin-bottom: 4px; color: #334155; }
        .detailed-scoring-body strong { color: #0f172a; }
        @media print {
            .print-toolbar { display: none !important; }
            body { padding: 0 !important; }
            .doc-container { max-width: 100% !important; width: 100% !important; margin: 0 !important; }
        }
    </style>
</head>
<body>
    <div class="print-toolbar">
        <div><strong>Batch Scoring Records:</strong> ${selectedFiles.length} Completed Participant Scorings</div>
        <div style="display: flex; gap: 10px; align-items: center;">
            <button class="print-btn" onclick="window.print()">🖨️ Print All Records</button>
            <button class="close-btn" onclick="window.close()">✕ Close</button>
        </div>
    </div>
    <div class="doc-container">
        ${combinedHtml}
    </div>
    <script>
        if (window.location.search.includes('autoprint=true')) {
            window.addEventListener('load', () => { setTimeout(() => window.print(), 500); });
        }
    </script>
</body>
</html>`;
        res.send(html);
    } catch(e) {
        res.status(500).send('Batch print error: ' + e.message);
    }
});

// List reference scoring guides
app.get('/api/documents/guides', (req, res) => {
    res.json({
        lscmiGuideMd: 'LS_CMI_Scoring_Guide.md',
        lscmiGuidePdf: 'LS_CMI_Scoring_Guide.pdf',
        lscmiManualPdf: 'LS_CMI_Scoring_Manual_Guide.pdf',
        facilitatorGuideMd: 'Facilitator_Scoring_Guide.md',
        facilitatorGuidePdf: 'Facilitator_Scoring_Guide.pdf',
        facilitatorGuideXlsx: 'Facilitator_Scoring_Guide_2024.xlsx'
    });
});


// Helper: Generate structured Individualized Case Plan Markdown on demand
function generateParticipantCasePlanMarkdown(user, profile, items, notes) {
    const completedItems = items.filter(i => i.status === 'green');
    const barrierItems = items.filter(i => i.status === 'red');
    const pendingItems = items.filter(i => i.status === 'pending');

    const trackLabel = user.track === 'reentry_nav' ? 'Re-entry Navigation' : 'First Shift';
    const gateLabel = 'Gate ' + (profile.current_gate || 1);
    const stabilityLabel = (profile.reentry_status && profile.reentry_status !== 'none') ? profile.reentry_status.toUpperCase().replace(/_/g, ' ') : 'STABLE';

    let md = `# TURN90 INDIVIDUALIZED CASE PLAN & ACTION GUIDE\n\n`;
    md += `### Participant Profile\n`;
    md += `| Attribute | Details |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Participant Name** | ${user.name} |\n`;
    md += `| **Program Track** | ${trackLabel} |\n`;
    md += `| **Current Benchmark** | ${gateLabel} |\n`;
    md += `| **Location** | ${user.location || 'Charleston'}, SC |\n`;
    md += `| **Contact Information** | ${user.email || 'N/A'}${user.phone ? ' • ' + user.phone : ''} |\n`;
    md += `| **Stability Status** | ${stabilityLabel} |\n\n`;

    md += `### 1. Stability & Priority Barriers\n`;
    md += `- **Driver's License:** ${(profile.dl_status || 'Under Review').toUpperCase()}${profile.dl_notes ? ' (' + profile.dl_notes + ')' : ''}\n`;
    md += `- **Child Support Status:** ${(profile.child_support_status || 'Under Review').toUpperCase()}${profile.child_support_notes ? ' (' + profile.child_support_notes + ')' : ''}\n`;
    md += `- **Housing / Living Situation:** ${(profile.housing_status || 'Transitional / Temporary Housing').toUpperCase()}\n`;
    md += `- **Transportation:** ${(profile.transportation_status || 'Public Transit / Bus').toUpperCase()}\n`;
    md += `- **W-9 & Identity Verification:** ${(profile.w9_status || 'Pending').toUpperCase()}\n\n`;

    md += `### 2. Stated Goals & Career Focus\n`;
    md += `- **Primary Goal:** Turn90 Program Graduation, Long-term Freedom, and Sustainable Career Placement.\n`;
    md += `- **Immediate Milestone:** Advance through ${gateLabel} by maintaining required attendance and points benchmark, active CBT engagement, and zero unexcused absences.\n\n`;

    md += `### 3. Six-Domain Briefcase Progress\n`;
    md += `**Overall Briefcase Summary:** **${completedItems.length}** Verified Complete | **${barrierItems.length}** High-Priority Barriers | **${pendingItems.length}** In-Progress\n\n`;

    for (const [domKey, domItems] of Object.entries(BRIEFCASE_DOMAINS)) {
        const domTitle = domKey.replace(/_/g, ' ').toUpperCase();
        const userDomItems = items.filter(i => i.domain === domKey);
        const comp = userDomItems.filter(i => i.status === 'green').length;
        md += `#### ${domTitle} (${comp}/${userDomItems.length} Completed)\n`;
        for (const it of userDomItems.slice(0, 4)) {
            const icon = it.status === 'green' ? '✅' : (it.status === 'red' ? '⚠️' : '⏳');
            md += `- ${icon} **${it.title}**: ${it.notes || (it.status === 'green' ? 'Verified Complete' : (it.status === 'red' ? 'Priority Barrier' : 'Pending Action'))}\n`;
        }
        if (userDomItems.length > 4) {
            const remaining = userDomItems.slice(4);
            const rComp = remaining.filter(i => i.status === 'green').length;
            md += `- *Plus ${userDomItems.length - 4} additional domain items (${rComp} completed).*\n`;
        }
        md += `\n`;
    }

    if (notes && notes.length > 0) {
        md += `### 4. Recent Case Management Notes\n`;
        for (const n of notes.slice(0, 5)) {
            md += `- **${n.session_date || 'Recent'} (${n.category || 'General'})** — *${n.author_name || 'Staff'}*: ${n.content}\n`;
        }
        md += `\n`;
    } else {
        md += `### 4. Recent Case Management Notes\n*No formal case notes logged yet. Use the Caseload Notes button to document sessions and barrier resolutions.*\n\n`;
    }

    md += `### 5. Recommended Action Steps & Milestones\n`;
    md += `1. **Attendance & Points:** Maintain points benchmark across daily work and classroom sessions.\n`;
    md += `2. **Briefcase Progression:** Complete pending checklist items in partnership with Program Manager / Re-entry Navigator.\n`;
    md += `3. **CBT Integration:** Apply Turn90 cognitive tools (Stop & Think, Thinking Reports, Decisional Balance) in response to high-risk triggers.\n`;

    return md;
}

// Case plan retrieval handler (used by both participant and staff endpoints)
function handleGetCasePlan(req, res) {
    let targetUserId = req.user.id;
    if ((req.user.role === 'program_manager' || req.user.role === 'admin' || req.user.role === 'director') && (req.query.userId || req.params.userId)) {
        targetUserId = parseInt(req.query.userId || req.params.userId);
    }

    const user = db.prepare('SELECT id, name, email, phone, location, track FROM users WHERE id = ?').get(targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Ensure briefcase items initialized for participant
    initParticipantBriefcase(targetUserId);

    // 1. Check database reentry_case_plans
    const reentryPlan = db.prepare('SELECT * FROM reentry_case_plans WHERE user_id = ?').get(targetUserId);
    
    // 2. Fetch participant barrier profile
    const profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(targetUserId) || {};

    // 3. Fetch briefcase items
    const items = db.prepare('SELECT * FROM briefcase_items WHERE user_id = ? ORDER BY id').all(targetUserId);

    // 4. Fetch case management session notes
    const notes = db.prepare(`
        SELECT id, author_name, session_date, note_type, category, content, created_at 
        FROM case_notes 
        WHERE user_id = ? 
        ORDER BY session_date DESC, id DESC LIMIT 20
    `).all(targetUserId);

    // 5. Check disk files fallback
    const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '');
    const files = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
    const planFile = files.find(f => f.toLowerCase().includes(safeName.toLowerCase()) && f.endsWith('_participant_case_plan.md'));
    const diskContent = planFile ? fs.readFileSync(path.join(dataDir, planFile), 'utf8') : null;
    const diskPdf = planFile ? planFile.replace(/\.md$/, '.pdf') : null;

    let identifiedNeeds = [];
    let topDomains = [];
    let recommendedReferrals = [];
    let matchedEmployers = [];
    let detectedFlags = [];

    if (reentryPlan) {
        try { identifiedNeeds = typeof reentryPlan.identified_needs === 'string' ? JSON.parse(reentryPlan.identified_needs) : (reentryPlan.identified_needs || []); } catch(e){}
        try { topDomains = typeof reentryPlan.top_criminogenic_domains === 'string' ? JSON.parse(reentryPlan.top_criminogenic_domains) : (reentryPlan.top_criminogenic_domains || []); } catch(e){}
        try { recommendedReferrals = typeof reentryPlan.recommended_referrals === 'string' ? JSON.parse(reentryPlan.recommended_referrals) : (reentryPlan.recommended_referrals || []); } catch(e){}
        try { matchedEmployers = typeof reentryPlan.matched_employers === 'string' ? JSON.parse(reentryPlan.matched_employers) : (reentryPlan.matched_employers || []); } catch(e){}
        try { detectedFlags = typeof reentryPlan.detected_flags === 'string' ? JSON.parse(reentryPlan.detected_flags) : (reentryPlan.detected_flags || []); } catch(e){}
    }

    const hasStoredDoc = !!(reentryPlan || diskContent);
    const dynamicMd = generateParticipantCasePlanMarkdown(user, profile, items, notes);
    const mdText = reentryPlan ? (reentryPlan.participant_guide_md || reentryPlan.staff_case_plan_md || dynamicMd) : (diskContent || dynamicMd);
    const staffMdText = reentryPlan ? (reentryPlan.staff_case_plan_md || dynamicMd) : dynamicMd;
    const participantMdText = reentryPlan ? (reentryPlan.participant_guide_md || dynamicMd) : (diskContent || dynamicMd);

    const pdfPath = reentryPlan ? reentryPlan.participant_guide_pdf : (diskPdf && fs.existsSync(path.join(dataDir, diskPdf)) ? `/data/${diskPdf}` : null);
    const docxPath = reentryPlan ? reentryPlan.participant_guide_docx : null;
    const staffPdfPath = reentryPlan ? reentryPlan.staff_plan_pdf : null;
    const staffDocxPath = reentryPlan ? reentryPlan.staff_plan_docx : null;

    res.json({ 
        found: true, 
        userId: user.id,
        participantName: user.name,
        track: user.track,
        location: user.location,
        gate: profile.current_gate || 1,
        stabilityStatus: (reentryPlan && reentryPlan.stability_status) || (profile && profile.reentry_status) || 'stable',
        hasFormalReentryPlan: !!reentryPlan,
        hasStoredDoc: hasStoredDoc,
        markdown: req.user.role === 'participant' ? participantMdText : (staffMdText || mdText),
        staffMarkdown: staffMdText,
        participantMarkdown: participantMdText,
        filename: planFile || (reentryPlan ? `${user.name}_case_plan.md` : `${user.name.replace(/\s+/g, '_')}_case_plan.md`),
        pdfUrl: pdfPath,
        docxUrl: docxPath,
        staffPdfUrl: staffPdfPath,
        staffDocxUrl: staffDocxPath,
        planDetails: {
            stability_status: (reentryPlan && reentryPlan.stability_status) || (profile && profile.reentry_status) || 'stable',
            stated_goals: (reentryPlan && reentryPlan.stated_goals) || 'Turn90 graduation, career placement, and personal stability',
            identified_needs: identifiedNeeds,
            living_situation: (reentryPlan && reentryPlan.living_situation) || (profile ? profile.housing_status : 'Transitional Housing'),
            legal_status: (reentryPlan && reentryPlan.legal_status) || 'Active Supervision',
            top_criminogenic_domains: topDomains,
            recommended_referrals: recommendedReferrals,
            matched_employers: matchedEmployers,
            detected_flags: detectedFlags,
            profile_barriers: profile || {}
        },
        briefcaseItems: items,
        notes: notes
    });
}

// Fetch Participant-Facing Printable Case Plan (Supports ?userId=X for Program Managers)
app.get('/api/participant/case-plan', authenticateToken, handleGetCasePlan);

// Staff Endpoint: Fetch Participant Case Plan directly by userId
app.get('/api/pm/case-plan/:userId', authenticateToken, handleGetCasePlan);

// Fetch Participant's Own Case Management Notes
app.get('/api/participant/notes', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const notes = db.prepare(`
        SELECT id, author_name, session_date, note_type, category, content, created_at 
        FROM case_notes 
        WHERE user_id = ? 
        ORDER BY session_date DESC, id DESC
    `).all(userId);
    res.json(notes);
});

// Fetch Stored W-9 Details (Hardened & Resilient)
app.get('/api/participant/w9-details/:userId', authenticateToken, (req, res) => {
    let targetId = parseInt(req.params.userId);
    if (!targetId || isNaN(targetId)) {
        targetId = req.user ? req.user.id : null;
    }
    if (!targetId) {
        return res.status(400).json({ error: 'Valid participant ID is required.' });
    }
    if (req.user && req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized to view this W-9.' });
    }

    try {
        const doc = db.prepare("SELECT * FROM documents WHERE user_id = ? AND doc_type = 'w9' ORDER BY uploaded_at DESC LIMIT 1").get(targetId);
        const profile = db.prepare('SELECT w9_status FROM participant_profiles WHERE user_id = ?').get(targetId);
        const user = db.prepare('SELECT name, email, phone, location FROM users WHERE id = ?').get(targetId);
        
        let parsedW9 = null;
        if (doc && doc.metadata_json) {
            try {
                parsedW9 = typeof doc.metadata_json === 'string' ? JSON.parse(doc.metadata_json) : doc.metadata_json;
            } catch (e) {
                console.warn('Error parsing W-9 JSON:', e.message);
            }
        }

        // Graceful fallback: If record exists in system, render official template populated with user data
        if (!parsedW9 && user) {
            parsedW9 = {
                fullName: user.name,
                businessName: '',
                taxClassification: 'Individual/sole proprietor or single-member LLC',
                exemptions: 'N/A',
                address: 'On file with Turn90',
                cityStateZip: (user.location || 'Charleston') + ', SC',
                tinType: 'ssn',
                ssnOrEin: '***-**-****',
                signatureName: user.name,
                signatureDate: new Date().toISOString().split('T')[0]
            };
        }

        res.json({
            user: user || { name: 'Participant #' + targetId, location: 'Charleston' },
            status: profile ? profile.w9_status : 'submitted',
            w9Data: parsedW9
        });
    } catch(err) {
        console.error('Error fetching W-9 details:', err);
        res.status(500).json({ error: 'Failed to retrieve W-9 details: ' + err.message });
    }
});

// Manual / External Interview Entry (for Lawrence, Isiah, or new participants)
app.post('/api/interviews/manual-entry', memoryUpload.single('audio'), async (req, res) => {
    try {
        const name = req.body.participantName;
        const location = req.body.participantLocation || 'Charleston';
        let transcriptText = req.body.transcript || '';

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Participant name is required.' });
        }

        const cleanName = name.trim();
        const safeName = cleanName.replace(/[^a-zA-Z0-9]/g, '_');
        const clientId = `${safeName}_${location}`;

        // We no longer save the raw audio buffer to disk to prevent ENOSPC disk exhaustion on Render.
        // It is streamed directly to Gemini in runPhase1WithAudio instead.

        let results = null;

        // If audio recording was uploaded, transcribe and score directly via Gemini Audio LLM
        if (req.file && req.file.buffer && process.env.GEMINI_API_KEY) {
            console.log(`Processing uploaded audio interview for ${cleanName} with Gemini...`);
            try {
                results = await runPhase1WithAudio(
                    req.file.buffer, 
                    req.file.mimetype || 'audio/webm', 
                    cleanName, 
                    location, 
                    transcriptText
                );

                if (results.transcript && results.transcript.trim()) {
                    transcriptText = results.transcript;
                }
                const transcriptPath = path.join(dataDir, `${clientId}_transcript.txt`);
                fs.writeFileSync(transcriptPath, transcriptText || `Interview audio recorded for ${cleanName}.`);

                const guidePath = path.join(dataDir, `${clientId}_interview_guide.md`);
                const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);
                
                fs.writeFileSync(guidePath, results.interview_guide);
                fs.writeFileSync(draftPath, results.draft_scoring_form);

                convertSingleMdToPdf(guidePath, guidePath.replace(/\.md$/, '.pdf'));
                convertSingleMdToPdf(draftPath, draftPath.replace(/\.md$/, '.pdf'));
                convertSingleMdToDocx(guidePath, guidePath.replace(/\.md$/, '.docx'));
                convertSingleMdToDocx(draftPath, draftPath.replace(/\.md$/, '.docx'));
            } catch (audioLlmErr) {
                console.error('Gemini audio interview processing error:', audioLlmErr);
                fs.writeFileSync(path.join(dataDir, `${clientId}_error.txt`), `Failed: ${audioLlmErr.message}`);
                throw new Error(`Audio processing error: ${audioLlmErr.message}`);
            }
        } else if (process.env.GEMINI_API_KEY) {
            // Text-only transcript submitted
            if (!transcriptText || !transcriptText.trim()) {
                transcriptText = `Assessment interview conducted with ${cleanName} at Turn90 ${location} center. Participant discussed employment history, education, family/support networks, legal background, and personal goals for stability.`;
            }

            const transcriptPath = path.join(dataDir, `${clientId}_transcript.txt`);
            fs.writeFileSync(transcriptPath, transcriptText);

            try {
                results = await runPhase1(transcriptText, cleanName, location);
                const guidePath = path.join(dataDir, `${clientId}_interview_guide.md`);
                const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);
                
                fs.writeFileSync(guidePath, results.interview_guide);
                fs.writeFileSync(draftPath, results.draft_scoring_form);

                convertSingleMdToPdf(guidePath, guidePath.replace(/\.md$/, '.pdf'));
                convertSingleMdToPdf(draftPath, draftPath.replace(/\.md$/, '.pdf'));
                convertSingleMdToDocx(guidePath, guidePath.replace(/\.md$/, '.docx'));
                convertSingleMdToDocx(draftPath, draftPath.replace(/\.md$/, '.docx'));
            } catch(llmErr) {
                console.error('LLM Phase 1 generation failed:', llmErr);
                fs.writeFileSync(path.join(dataDir, `${clientId}_error.txt`), `Failed: ${llmErr.message}`);
                throw new Error(`AI Scoring draft generation failed: ${llmErr.message}`);
            }
        } else {
            if (!transcriptText || !transcriptText.trim()) {
                transcriptText = `Assessment interview conducted with ${cleanName} at Turn90 ${location} center.`;
            }
            fs.writeFileSync(path.join(dataDir, `${clientId}_transcript.txt`), transcriptText);
        }

        res.json({
            success: true,
            clientId,
            cleanName,
            hasDraft: !!results,
            message: results 
                ? `Interview and Phase 1 Draft Scoring Form created for ${cleanName}.` 
                : `Interview saved for ${cleanName}. Ready for AI scoring.`
        });
    } catch(err) {
        console.error('Manual interview entry error:', err);
        res.status(500).json({ error: 'Failed to process interview entry: ' + err.message });
    }
});

// Trigger / Retry AI Draft Scoring on Existing Interview (e.g. Isiah)
app.post('/api/interviews/generate-draft', async (req, res) => {
    try {
        const { clientId, clientName } = req.body;
        if (!clientId) return res.status(400).json({ error: 'clientId is required.' });

        const transcriptFile = path.join(dataDir, `${clientId}_transcript.txt`);
        if (!fs.existsSync(transcriptFile)) {
            return res.status(404).json({ error: `Transcript file not found for ${clientId}.` });
        }

        const transcriptText = fs.readFileSync(transcriptFile, 'utf8');
        const name = clientName || clientId.split('_')[0];

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
        }

        const results = await runPhase1(transcriptText, name);
        const guidePath = path.join(dataDir, `${clientId}_interview_guide.md`);
        const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);

        fs.writeFileSync(guidePath, results.interview_guide);
        fs.writeFileSync(draftPath, results.draft_scoring_form);

        convertSingleMdToPdf(guidePath, guidePath.replace(/\.md$/, '.pdf'));
        convertSingleMdToPdf(draftPath, draftPath.replace(/\.md$/, '.pdf'));
        convertSingleMdToDocx(guidePath, guidePath.replace(/\.md$/, '.docx'));
        convertSingleMdToDocx(draftPath, draftPath.replace(/\.md$/, '.docx'));

        // Clean up any old error file
        const errFile = path.join(dataDir, `${clientId}_error.txt`);
        if (fs.existsSync(errFile)) fs.unlinkSync(errFile);

        res.json({
            success: true,
            message: `Phase 1 Draft Scoring Form generated successfully for ${name}. Ready for supervisor review.`
        });
    } catch(err) {
        console.error('Error generating AI draft scoring:', err);
        res.status(500).json({ error: 'Failed to generate AI scoring: ' + err.message });
    }
});

// Class Facilitation Evaluations API
app.get('/api/admin/evaluations', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const location = req.query.location;
    let query = 'SELECT * FROM class_facilitation_evaluations';
    const params = [];
    if (location) {
        query += ' WHERE location = ?';
        params.push(location);
    }
    query += ' ORDER BY created_at DESC LIMIT 50';
    const evals = db.prepare(query).all(...params);
    res.json(evals);
});

app.delete('/api/admin/evaluations/:id', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    try {
        const id = req.params.id;
        db.prepare('DELETE FROM class_facilitation_evaluations WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-Week Average Stats
app.get('/api/admin/evaluations/stats', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    const stats = db.prepare(`
        SELECT location, AVG(total_score) as avg_score, COUNT(*) as eval_count
        FROM class_facilitation_evaluations
        WHERE created_at >= date('now', '-14 days')
        GROUP BY location
    `).all();
    res.json(stats);
});

global.syncStatus = { running: false, log: "Not started", results: null };

app.post('/api/admin/evaluations/force-sync', authenticateToken, requireRole('program_manager', 'admin', 'director'), async (req, res) => {
    try {
        if (global.syncStatus.running) {
            return res.json({ success: true, message: 'Sync already running.' });
        }
        
        const { runDailyEvaluation } = require('./services/dropbox_evaluator');
        global.syncStatus = { running: true, log: "Starting sync...", results: null };
        
        // Fire and forget
        runDailyEvaluation().then(result => {
            global.syncStatus.running = false;
            global.syncStatus.results = result;
            global.syncStatus.log = "Complete";
        }).catch(err => {
            global.syncStatus.running = false;
            global.syncStatus.log = "Error: " + err.message;
        });
        
        res.json({ success: true, message: 'Sync started.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/evaluations/sync-status', authenticateToken, requireRole('program_manager', 'admin', 'director'), (req, res) => {
    res.json(global.syncStatus);
});

app.post('/api/admin/evaluate-classes', authenticateToken, requireRole('program_manager', 'admin', 'director'), memoryUpload.single('audioOrTranscript'), async (req, res) => {
    try {
        const { location, sessionTitle, facilitatorName, transcriptText } = req.body;
        let textToEvaluate = transcriptText || '';
        if (req.file) {
            textToEvaluate = req.file.buffer.toString('utf8');
        }
        if (!textToEvaluate) return res.status(400).json({ error: 'Transcript or text content required for evaluation.' });

        const result = await evaluateClassTranscript(location || 'Charleston', sessionTitle || 'Turn90 Workshop', facilitatorName || 'Staff Facilitator', textToEvaluate);
        res.json({ success: true, result });
    } catch (err) {
        console.error('Class evaluation error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/submit-feedback', memoryUpload.single('criminalHistoryFile'), async (req, res) => {
    const { clientId, feedback, criminalHistoryText } = req.body;
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });

    try {
        // Robust participant name extraction from any clientId format
        const parts = clientId.split('_');
        if (/^\d{10,}$/.test(parts[0])) {
            parts.shift(); // remove leading timestamp if present
        }
        const lastPart = parts[parts.length - 1].toLowerCase();
        if (['charleston', 'columbia', 'spartanburg'].includes(lastPart)) {
            parts.pop();
        }
        const participantName = parts.join(' ').trim() || clientId;

        let crimText = criminalHistoryText || '';
        if (req.file && req.file.buffer) {
            try {
                const text = await extractPdfText(req.file.buffer);
                crimText += '\n\n' + text;
            } catch (e) {
                console.warn('Could not parse PDF buffer, using raw text:', e.message);
            }
        }

        // Locate transcript
        let transcript = '';
        const transcriptPath = path.join(dataDir, `${clientId}_transcript.txt`);
        if (fs.existsSync(transcriptPath)) {
            transcript = fs.readFileSync(transcriptPath, 'utf8');
        } else {
            const files = fs.readdirSync(dataDir);
            const tFile = files.find(f => f.includes(clientId) && f.includes('transcript'));
            if (tFile) transcript = fs.readFileSync(path.join(dataDir, tFile), 'utf8');
        }
        if (!transcript || !transcript.trim()) {
            const guidePath = path.join(dataDir, `${clientId}_interview_guide.md`);
            if (fs.existsSync(guidePath)) {
                transcript = fs.readFileSync(guidePath, 'utf8');
            } else {
                transcript = `Assessment interview conducted with ${participantName} at Turn90.`;
            }
        }

        // Locate draft scoring form
        const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);
        let draft = "";
        if (fs.existsSync(draftPath)) {
            draft = fs.readFileSync(draftPath, 'utf8');
        } else {
            const files = fs.readdirSync(dataDir);
            const dFile = files.find(f => f.includes(clientId) && f.includes('draft_scoring_form'));
            if (dFile) draft = fs.readFileSync(path.join(dataDir, dFile), 'utf8');
        }

        console.log(`Starting Phase 2 generation for ${participantName} (${clientId})...`);
        const results = await runPhase2(transcript, participantName, draft, feedback || 'Approved as drafted', crimText);
        
        const finalScoringPath = path.join(dataDir, `${clientId}_final_scoring_form.md`);
        const finalBriefPath = path.join(dataDir, `${clientId}_final_case_brief.md`);
        const participantPlanPath = path.join(dataDir, `${clientId}_participant_case_plan.md`);

        if (results.final_scoring_form) {
            fs.writeFileSync(finalScoringPath, results.final_scoring_form);
            convertSingleMdToPdf(finalScoringPath, finalScoringPath.replace(/\.md$/, '.pdf'));
            convertSingleMdToDocx(finalScoringPath, finalScoringPath.replace(/\.md$/, '.docx'));
        }
        if (results.case_brief) {
            fs.writeFileSync(finalBriefPath, results.case_brief);
            convertSingleMdToPdf(finalBriefPath, finalBriefPath.replace(/\.md$/, '.pdf'));
            convertSingleMdToDocx(finalBriefPath, finalBriefPath.replace(/\.md$/, '.docx'));
        }
        if (results.participant_case_plan) {
            fs.writeFileSync(participantPlanPath, results.participant_case_plan);
            convertSingleMdToPdf(participantPlanPath, participantPlanPath.replace(/\.md$/, '.pdf'));
            convertSingleMdToDocx(participantPlanPath, participantPlanPath.replace(/\.md$/, '.docx'));
        }
        
        if (results.csv_row) {
            const csvRow = results.csv_row + "\n";
            const localCsv = path.join(dataDir, 'FirstShift20IntakeForm.csv');
            const parentCsv = path.join(__dirname, '..', 'FirstShift20IntakeForm.csv');
            const targetCsv = fs.existsSync(localCsv) ? localCsv : (fs.existsSync(parentCsv) ? parentCsv : localCsv);
            try {
                fs.appendFileSync(targetCsv, csvRow);
            } catch (csvErr) {
                console.warn("Could not append to CSV file:", csvErr.message);
            }
        }

        // Auto-update Briefcase & Stability Factors in database
        if (results.briefcase_autofill) {
            const autofill = results.briefcase_autofill;
            const firstName = parts[0] || participantName;
            const user = db.prepare('SELECT id FROM users WHERE LOWER(name) LIKE ? OR LOWER(name) LIKE ?').get(
                `%${participantName.toLowerCase()}%`,
                `%${firstName.toLowerCase()}%`
            );
            if (user) {
                const uId = user.id;
                db.prepare(`
                    UPDATE participant_profiles SET
                        dl_status = COALESCE(?, dl_status),
                        dl_notes = COALESCE(?, dl_notes),
                        child_support_status = COALESCE(?, child_support_status),
                        child_support_notes = COALESCE(?, child_support_notes),
                        housing_status = COALESCE(?, housing_status),
                        transportation_status = COALESCE(?, transportation_status),
                        stability_red_flags = COALESCE(?, stability_red_flags),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ?
                `).run(
                    autofill.dl_status || null,
                    autofill.dl_notes || null,
                    autofill.child_support_status || null,
                    autofill.child_support_notes || null,
                    autofill.housing_status || null,
                    autofill.transportation_status || null,
                    autofill.detected_stability_flags ? JSON.stringify(autofill.detected_stability_flags) : null,
                    uId
                );

                // Auto-check Briefcase items
                if (autofill.dl_status === 'valid') {
                    db.prepare(`UPDATE briefcase_items SET status = 'green', notes = 'Verified in LS/CMI interview' WHERE user_id = ? AND item_key = 'drivers_license'`).run(uId);
                } else if (autofill.dl_status) {
                    db.prepare(`UPDATE briefcase_items SET status = 'red', notes = ? WHERE user_id = ? AND item_key = 'drivers_license'`).run(autofill.dl_notes || 'Reinstatement needed', uId);
                }

                if (autofill.child_support_status === 'none' || autofill.child_support_status === 'current') {
                    db.prepare(`UPDATE briefcase_items SET status = 'green', notes = 'No active arrears / current' WHERE user_id = ? AND item_key = 'child_support_status'`).run(uId);
                } else if (autofill.child_support_status) {
                    db.prepare(`UPDATE briefcase_items SET status = 'red', notes = ? WHERE user_id = ? AND item_key = 'child_support_status'`).run(autofill.child_support_notes || 'Modification needed', uId);
                }

                if (autofill.housing_status === 'stable') {
                    db.prepare(`UPDATE briefcase_items SET status = 'green', notes = 'Stable address confirmed' WHERE user_id = ? AND item_key = 'housing_plan'`).run(uId);
                } else if (autofill.housing_status) {
                    db.prepare(`UPDATE briefcase_items SET status = 'red', notes = ? WHERE user_id = ? AND item_key = 'housing_plan'`).run(autofill.housing_status, uId);
                }

                if (autofill.transportation_status) {
                    db.prepare(`UPDATE briefcase_items SET status = 'green', notes = 'Transit route mapped' WHERE user_id = ? AND item_key = 'transportation_plan'`).run(uId);
                }

                // Auto mark Week 1 Interview gate criteria as green
                db.prepare(`UPDATE gate_criteria SET status = 'green', pm_notes = 'Interview completed and case brief generated.' WHERE user_id = ? AND criterion_key = 'w1_interview'`).run(uId);
            }
        }

        console.log(`Phase 2 complete for ${participantName} (${clientId})`);
        res.status(200).json({
            success: true,
            message: `Phase 2 complete! Final scoring form, case brief, and participant action plan generated for ${participantName}.`
        });
    } catch (err) {
        console.error("Phase 2 failed:", err);
        fs.writeFileSync(path.join(dataDir, `${clientId}_error_phase2.txt`), `Failed Phase 2: ${err.message}`);
        res.status(500).json({ error: "Phase 2 generation failed: " + err.message });
    }
});

// ==========================================
// RE-ENTRY NAVIGATOR DASHBOARD API ENDPOINTS
// ==========================================

// 1. Get Participants for Re-entry Selector
app.get('/api/reentry/participants', authenticateToken, requireRole('program_manager', 'director', 'admin'), (req, res) => {
    try {
        const includeArchived = req.query.includeArchived === 'true';
        let query = `
            SELECT 
                u.id, u.name, u.email, u.phone, u.location, u.track,
                p.current_gate, p.w9_status, p.dl_status, p.child_support_status,
                p.housing_status, p.overall_status, p.reentry_status, p.has_reentry_plan,
                r.stability_status AS plan_stability_status,
                r.staff_plan_docx, r.participant_guide_docx, r.updated_at AS plan_updated_at
            FROM users u
            LEFT JOIN participant_profiles p ON u.id = p.user_id
            LEFT JOIN reentry_case_plans r ON u.id = r.user_id
            WHERE u.role = 'participant'
        `;
        if (!includeArchived) {
            query += ` AND (p.overall_status IS NULL OR p.overall_status != 'archived')`;
        }
        query += ` ORDER BY u.name ASC`;
        const rows = db.prepare(query).all();
        res.json(rows);
    } catch (err) {
        console.error('Error fetching reentry participants:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Re-entry Navigation Assessment & Profile Linking
app.post('/api/reentry/assess', authenticateToken, requireRole('program_manager', 'director', 'admin'), memoryUpload.single('file'), async (req, res) => {
    try {
        const {
            userId,
            participantName,
            location,
            statedGoals,
            identifiedNeeds,
            livingSituation,
            legalStatus,
            transcriptText
        } = req.body;

        let fullTranscript = transcriptText || '';

        if (req.file && req.file.buffer) {
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.pdf') {
                try {
                    const text = await extractPdfText(req.file.buffer);
                    fullTranscript += '\n\n' + text;
                } catch (e) {
                    console.warn('PDF parse failed:', e.message);
                }
            } else if (ext === '.txt') {
                fullTranscript += '\n\n' + req.file.buffer.toString('utf8');
            }
        }

        const assessmentData = {
            participantName: participantName || 'Re-entry Participant',
            location: location || 'Charleston',
            interviewTranscript: fullTranscript,
            statedGoals: statedGoals || 'Long-term employment and financial stability',
            identifiedNeeds: typeof identifiedNeeds === 'string' ? JSON.parse(identifiedNeeds || '[]') : (identifiedNeeds || []),
            livingSituation: livingSituation || 'Transitional Housing',
            legalStatus: legalStatus || 'Active Supervision'
        };

        const result = await generateReentryNavAssessment(assessmentData);

        const timestamp = Date.now();
        const safeName = (participantName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
        const filePrefix = `${timestamp}_${safeName}_reentry`;

        const staffPlanPath = path.join(dataDir, `${filePrefix}_staff_case_plan.md`);
        const participantGuidePath = path.join(dataDir, `${filePrefix}_participant_action_guide.md`);
        const jsonResultPath = path.join(dataDir, `${filePrefix}_assessment_data.json`);

        fs.writeFileSync(staffPlanPath, result.navigator_case_plan_md);
        fs.writeFileSync(participantGuidePath, result.participant_guide_md);
        fs.writeFileSync(jsonResultPath, JSON.stringify({ ...result, assessmentData }, null, 2));

        // Generate PDFs and editable Word (.docx) documents
        const staffPdfPath = staffPlanPath.replace(/\.md$/, '.pdf');
        const partPdfPath = participantGuidePath.replace(/\.md$/, '.pdf');
        const staffDocxPath = staffPlanPath.replace(/\.md$/, '.docx');
        const partDocxPath = participantGuidePath.replace(/\.md$/, '.docx');

        convertSingleMdToPdf(staffPlanPath, staffPdfPath);
        convertSingleMdToPdf(participantGuidePath, partPdfPath);
        await convertSingleMdToDocx(staffPlanPath, staffDocxPath);
        await convertSingleMdToDocx(participantGuidePath, partDocxPath);

        const staffDocxUrl = `/data/${filePrefix}_staff_case_plan.docx`;
        const staffPdfUrl = `/api/documents/print/${filePrefix}_staff_case_plan.md`;
        const partDocxUrl = `/data/${filePrefix}_participant_action_guide.docx`;
        const partPdfUrl = `/api/documents/print/${filePrefix}_participant_action_guide.md`;

        // Link to existing or resolved User ID
        let targetUserId = userId ? parseInt(userId) : null;
        if (!targetUserId && participantName) {
            const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(name) LIKE ?').get(`%${participantName.toLowerCase().trim()}%`);
            if (existingUser) targetUserId = existingUser.id;
        }

        if (targetUserId) {
            // Upsert into reentry_case_plans
            const existingPlan = db.prepare('SELECT id FROM reentry_case_plans WHERE user_id = ?').get(targetUserId);
            if (existingPlan) {
                db.prepare(`
                    UPDATE reentry_case_plans SET
                        participant_name = ?,
                        location = ?,
                        stability_status = ?,
                        stated_goals = ?,
                        identified_needs = ?,
                        living_situation = ?,
                        legal_status = ?,
                        detected_flags = ?,
                        top_criminogenic_domains = ?,
                        staff_case_plan_md = ?,
                        participant_guide_md = ?,
                        recommended_referrals = ?,
                        matched_employers = ?,
                        staff_plan_docx = ?,
                        staff_plan_pdf = ?,
                        participant_guide_docx = ?,
                        participant_guide_pdf = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ?
                `).run(
                    participantName, location, result.stability_status || 'stable',
                    statedGoals, JSON.stringify(assessmentData.identifiedNeeds), livingSituation, legalStatus,
                    JSON.stringify(result.detected_flags || []), JSON.stringify(result.top_criminogenic_domains || []),
                    result.navigator_case_plan_md, result.participant_guide_md,
                    JSON.stringify(result.recommended_referrals || []), JSON.stringify(result.matched_employers || []),
                    staffDocxUrl, staffPdfUrl, partDocxUrl, partPdfUrl,
                    targetUserId
                );
            } else {
                db.prepare(`
                    INSERT INTO reentry_case_plans (
                        user_id, participant_name, location, stability_status,
                        stated_goals, identified_needs, living_situation, legal_status,
                        detected_flags, top_criminogenic_domains, staff_case_plan_md, participant_guide_md,
                        recommended_referrals, matched_employers, staff_plan_docx, staff_plan_pdf,
                        participant_guide_docx, participant_guide_pdf
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    targetUserId, participantName, location, result.stability_status || 'stable',
                    statedGoals, JSON.stringify(assessmentData.identifiedNeeds), livingSituation, legalStatus,
                    JSON.stringify(result.detected_flags || []), JSON.stringify(result.top_criminogenic_domains || []),
                    result.navigator_case_plan_md, result.participant_guide_md,
                    JSON.stringify(result.recommended_referrals || []), JSON.stringify(result.matched_employers || []),
                    staffDocxUrl, staffPdfUrl, partDocxUrl, partPdfUrl
                );
            }

            // Update participant profile
            db.prepare(`
                UPDATE participant_profiles SET
                    reentry_status = ?,
                    has_reentry_plan = 1,
                    stability_red_flags = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            `).run(result.stability_status || 'stable', JSON.stringify(result.detected_flags || []), targetUserId);

            // Record documents
            db.prepare('INSERT INTO documents (user_id, doc_type, title, filename) VALUES (?, "reentry_plan", "Re-entry Staff Case Plan (Word .docx)", ?)')
                .run(targetUserId, `${filePrefix}_staff_case_plan.docx`);
            db.prepare('INSERT INTO documents (user_id, doc_type, title, filename) VALUES (?, "reentry_guide", "Participant Action & Referral Guide (Word .docx)", ?)')
                .run(targetUserId, `${filePrefix}_participant_action_guide.docx`);
        }

        res.json({
            success: true,
            linkedUserId: targetUserId,
            filePrefix,
            result,
            staffPlanUrl: `/data/${filePrefix}_staff_case_plan.md`,
            staffPlanPdf: staffPdfUrl,
            staffPlanDocx: staffDocxUrl,
            participantGuideUrl: `/data/${filePrefix}_participant_action_guide.md`,
            participantGuidePdf: partPdfUrl,
            participantGuideDocx: partDocxUrl
        });
    } catch (err) {
        console.error('Re-entry Assessment Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Get Linked Re-entry Case Plan for a Participant Profile
app.get('/api/reentry/plan/:userId', authenticateToken, (req, res) => {
    try {
        const targetId = parseInt(req.params.userId);
        if (req.user.role === 'participant' && req.user.id !== targetId) {
            return res.status(403).json({ error: 'Unauthorized to view other participants plans' });
        }

        const plan = db.prepare('SELECT * FROM reentry_case_plans WHERE user_id = ?').get(targetId);
        if (!plan) {
            return res.json({ found: false, message: 'No Re-entry Case Plan linked yet.' });
        }

        res.json({
            found: true,
            plan: {
                ...plan,
                identified_needs: plan.identified_needs ? JSON.parse(plan.identified_needs) : [],
                detected_flags: plan.detected_flags ? JSON.parse(plan.detected_flags) : [],
                top_criminogenic_domains: plan.top_criminogenic_domains ? JSON.parse(plan.top_criminogenic_domains) : [],
                recommended_referrals: plan.recommended_referrals ? JSON.parse(plan.recommended_referrals) : [],
                matched_employers: plan.matched_employers ? JSON.parse(plan.matched_employers) : []
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Directory & Spreadsheet Jobs Query
app.get('/api/reentry/resources', authenticateToken, (req, res) => {
    const region = req.query.region || 'charleston';
    const locKey = region.toLowerCase().includes('columbia') ? 'columbia' : (region.toLowerCase().includes('spartanburg') || region.toLowerCase().includes('greenville') || region.toLowerCase().includes('upstate') ? 'greenville' : 'charleston');
    
    const spreadsheetJobs = loadJobsFromSpreadsheets();
    const directoryEmployers = SC_FAIR_CHANCE_EMPLOYERS.filter(e => e.region === locKey || e.region === 'all');

    res.json({
        resources: SC_COMMUNITY_RESOURCES[locKey] || SC_COMMUNITY_RESOURCES.charleston,
        employers: directoryEmployers,
        spreadsheetJobs: spreadsheetJobs
    });
});

// 5. Upload New Jobs Spreadsheet
app.post('/api/reentry/upload-jobs-spreadsheet', authenticateToken, requireRole('program_manager', 'director', 'admin'), memoryUpload.single('spreadsheet'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No spreadsheet file uploaded.' });
    
    const filename = req.file.originalname || `Jobs_Upload_${Date.now()}.xlsx`;
    const targetPath = path.join(dataDir, filename);
    fs.writeFileSync(targetPath, req.file.buffer);

    const jobs = loadJobsFromSpreadsheets();
    res.json({
        success: true,
        message: `Spreadsheet '${filename}' uploaded and parsed successfully into program database.`,
        totalJobsCount: jobs.length
    });
});

app.post('/api/upload-audio', memoryUpload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No audio file uploaded.' });

        const audioBuffer = req.file.buffer;
        const originalName = req.file.originalname || 'interview_recording.webm';
        const name = req.body.participantName || 'Unknown';
        const location = req.body.participantLocation || 'Unknown';
        const transcriptText = req.body.transcript || 'No transcript available.';
        const isTranscriptOnly = req.body.transcriptOnly === 'true';
        
        const audioSizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(2);
        console.log(`Upload received: ${name} (${location}) | Audio: ${audioSizeMB} MB | Transcript-only: ${isTranscriptOnly}`);

        const timestamp = Date.now();
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
        const filePrefix = `${timestamp}_${safeName}`;

        // We no longer save audio locally to prevent ENOSPC.
        if (!isTranscriptOnly && audioBuffer.length > 200) {
            console.log(`Received audio buffer of length ${audioBuffer.length}, skipping disk write.`);
        }
        fs.writeFileSync(path.join(dataDir, `${filePrefix}_transcript.txt`), transcriptText);
        
        res.status(200).json({ message: 'Audio uploaded successfully. Processing in background...', filePrefix });

        if (process.env.GEMINI_API_KEY) {
            console.log(`Starting LLM Phase 1 for ${name}...`);
            try {
                const results = await runPhase1(transcriptText, name);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_interview_guide.md`), results.interview_guide);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_draft_scoring_form.md`), results.draft_scoring_form);
                console.log(`LLM Phase 1 finished for ${name}. Pending review.`);
            } catch (llmErr) {
                console.error("LLM Phase 1 failed:", llmErr);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_error.txt`), `Failed to generate assessment: ${llmErr.message}`);
            }
        } else {
            console.warn("GEMINI_API_KEY not found. Skipping LLM pipeline.");
            fs.writeFileSync(path.join(dataDir, `${filePrefix}_error.txt`), `Failed: GEMINI_API_KEY is missing from environment variables.`);
        }

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Failed to process upload.' });
    }
});

// =============================================================
// PARTICIPANT AI ASSISTANT API
// =============================================================
app.post('/api/participant/ai-assistant', authenticateToken, async (req, res) => {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        const reply = await getParticipantAiResponse(message, history || []);
        res.json({ reply });
    } catch(err) {
        console.error('Participant AI Assistant error:', err);
        res.status(500).json({ error: 'Failed to generate assistant response.' });
    }
});

// =============================================================
// TWO-WAY MESSAGING API (PARTICIPANT <-> PROGRAM MANAGER)
// =============================================================
app.post('/api/messages/send', authenticateToken, (req, res) => {
    const senderId = req.user.id;
    const { participantId, receiverId, messageText } = req.body;

    if (!messageText || !messageText.trim()) {
        return res.status(400).json({ error: 'Message text cannot be blank.' });
    }

    let pId = participantId;
    let rId = receiverId;

    if (req.user.role === 'participant') {
        pId = senderId;
        if (!rId) {
            const pm = db.prepare(`SELECT id FROM users WHERE role IN ('program_manager', 'director', 'admin') AND (location = ? OR location IS NULL) ORDER BY id ASC LIMIT 1`).get(req.user.location);
            rId = pm ? pm.id : null;
        }
    } else {
        if (!pId) return res.status(400).json({ error: 'Participant ID is required.' });
        rId = pId;
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO messages (sender_id, receiver_id, participant_id, message_text)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(senderId, rId, pId, messageText.trim());
        res.json({ success: true, messageId: result.lastInsertRowid });
    } catch(err) {
        res.status(500).json({ error: 'Failed to send message: ' + err.message });
    }
});

app.get('/api/messages/thread/:participantId', authenticateToken, (req, res) => {
    const targetId = parseInt(req.params.participantId);
    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized to view this thread.' });
    }

    try {
        // Mark messages as read for receiver
        db.prepare(`
            UPDATE messages SET is_read = 1
            WHERE participant_id = ? AND sender_id != ? AND is_read = 0
        `).run(targetId, req.user.id);

        const messages = db.prepare(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.participant_id = ?
            ORDER BY m.created_at ASC
        `).all(targetId);

        const participant = db.prepare('SELECT id, name, email, location FROM users WHERE id = ?').get(targetId);

        res.json({ participant, messages });
    } catch(err) {
        res.status(500).json({ error: 'Failed to retrieve message thread: ' + err.message });
    }
});

app.get('/api/pm/messages/recent', authenticateToken, requireRole('program_manager', 'director', 'admin'), (req, res) => {
    try {
        const threads = db.prepare(`
            SELECT m.*, u.name as participant_name, u.email as participant_email, u.location as participant_location,
                   sender.name as sender_name, sender.role as sender_role,
                   (SELECT COUNT(*) FROM messages WHERE participant_id = m.participant_id AND is_read = 0 AND sender_id = m.participant_id) as unread_count
            FROM messages m
            JOIN users u ON u.id = m.participant_id
            JOIN users sender ON sender.id = m.sender_id
            WHERE m.id IN (
                SELECT MAX(id) FROM messages GROUP BY participant_id
            )
            ORDER BY m.created_at DESC
        `).all();

        res.json(threads);
    } catch(err) {
        res.status(500).json({ error: 'Failed to fetch recent messages: ' + err.message });
    }
});

app.get('/api/participant/messages', authenticateToken, (req, res) => {
    const participantId = req.user.id;
    try {
        db.prepare(`
            UPDATE messages SET is_read = 1
            WHERE participant_id = ? AND sender_id != ? AND is_read = 0
        `).run(participantId, req.user.id);

        const messages = db.prepare(`
            SELECT m.*, u.name as sender_name, u.role as sender_role
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.participant_id = ?
            ORDER BY m.created_at ASC
        `).all(participantId);

        res.json({ messages });
    } catch(err) {
        res.status(500).json({ error: 'Failed to fetch messages: ' + err.message });
    }
});

// =============================================================
// FIRST SHIFT CASE PLAN: TRIGGER SITUATIONS & TOOLKIT API
// =============================================================
app.get('/api/case-plan-triggers/:userId', authenticateToken, (req, res) => {
    const targetId = parseInt(req.params.userId);
    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const items = db.prepare('SELECT * FROM case_plan_triggers WHERE user_id = ? ORDER BY id ASC').all(targetId);
        res.json(items);
    } catch(err) {
        res.status(500).json({ error: 'Failed to fetch triggers: ' + err.message });
    }
});

app.post('/api/case-plan-triggers', authenticateToken, (req, res) => {
    const { userId, domain, pattern, triggerSituations, toolkitTools } = req.body;
    const targetId = parseInt(userId) || req.user.id;

    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const stmt = db.prepare(`
            INSERT INTO case_plan_triggers (user_id, domain, pattern, trigger_situations, toolkit_tools, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, domain) DO UPDATE SET
                pattern = excluded.pattern,
                trigger_situations = excluded.trigger_situations,
                toolkit_tools = excluded.toolkit_tools,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(
            targetId,
            domain,
            pattern || '',
            typeof triggerSituations === 'string' ? triggerSituations : JSON.stringify(triggerSituations || []),
            typeof toolkitTools === 'string' ? toolkitTools : JSON.stringify(toolkitTools || [])
        );

        res.json({ success: true, message: 'Trigger situations and toolkit saved.' });
    } catch(err) {
        res.status(500).json({ error: 'Failed to save triggers: ' + err.message });
    }
});

// =============================================================
// JOB HUNTING AI API ENDPOINTS
// =============================================================

// 1. Intelligent AI Job Matcher
app.post('/api/jobs/ai-match', authenticateToken, async (req, res) => {
    try {
        const { query, location, skills, minPay, transit, curfew, participantId } = req.body;
        const targetUserId = participantId || (req.user.role === 'participant' ? req.user.id : null);
        
        let profile = {};
        if (targetUserId) {
            const pRow = db.prepare('SELECT p.*, u.name, u.location FROM participant_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(targetUserId);
            if (pRow) profile = pRow;
        }

        const userLoc = profile.location ? `${profile.location}, SC` : 'Charleston, SC';
        const defaultLocation = location || userLoc;
        let defaultTransit = transit || profile.transportation_status;
        if (!defaultTransit) {
            if (defaultLocation.toLowerCase().includes('columbia')) {
                defaultTransit = 'The COMET Bus Line Accessible';
            } else if (defaultLocation.toLowerCase().includes('spartanburg')) {
                defaultTransit = 'SPARTA Bus Line Accessible';
            } else {
                defaultTransit = 'CARTA Bus Line Accessible';
            }
        }

        const criteria = {
            query: query || '',
            location: defaultLocation,
            skills: skills || '',
            minPay: minPay || '$18.00 / hr',
            transit: defaultTransit,
            curfew: curfew || ''
        };

        const result = await matchJobsWithAi(criteria, profile);
        res.json(result);
    } catch(err) {
        console.error('Job AI matching error:', err);
        res.status(500).json({ error: 'Failed to match jobs: ' + err.message });
    }
});

// 2. AI Resume Bullet Points Tailorer
app.post('/api/jobs/ai-tailor-resume', authenticateToken, async (req, res) => {
    try {
        const { jobTitle, company, userSkills, tradeTrack } = req.body;
        if (!jobTitle || !company) {
            return res.status(400).json({ error: 'jobTitle and company are required.' });
        }
        const bulletPoints = await generateTailoredResumePoints(jobTitle, company, userSkills, tradeTrack);
        res.json({ bulletPoints });
    } catch(err) {
        res.status(500).json({ error: 'Failed to tailor resume: ' + err.message });
    }
});

// 3. AI Turnaround Narrative & Background Explanation Coach
app.post('/api/jobs/ai-interview-prep', authenticateToken, async (req, res) => {
    try {
        const { jobTitle, company, backgroundContext } = req.body;
        if (!jobTitle || !company) {
            return res.status(400).json({ error: 'jobTitle and company are required.' });
        }
        const turnaroundNarrative = await generateTurnaroundNarrative(jobTitle, company, backgroundContext);
        res.json({ turnaroundNarrative });
    } catch(err) {
        res.status(500).json({ error: 'Failed to generate interview prep: ' + err.message });
    }
});

// 4. Saved Jobs Pipeline
app.get('/api/jobs/saved/:userId', authenticateToken, (req, res) => {
    const targetId = parseInt(req.params.userId);
    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const jobs = db.prepare('SELECT * FROM saved_job_applications WHERE user_id = ? ORDER BY updated_at DESC').all(targetId);
        res.json(jobs);
    } catch(err) {
        res.status(500).json({ error: 'Failed to fetch saved jobs: ' + err.message });
    }
});

app.post('/api/jobs/save-job', authenticateToken, (req, res) => {
    const { userId, jobTitle, company, location, payRate, careersUrl, status, notes } = req.body;
    const targetId = parseInt(userId) || req.user.id;

    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    try {
        const existing = db.prepare('SELECT id FROM saved_job_applications WHERE user_id = ? AND LOWER(company) = LOWER(?) AND LOWER(job_title) = LOWER(?)').get(targetId, company, jobTitle);

        if (existing) {
            db.prepare(`
                UPDATE saved_job_applications SET
                    status = COALESCE(?, status),
                    notes = COALESCE(?, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(status || null, notes || null, existing.id);
            res.json({ success: true, message: 'Job pipeline status updated.', id: existing.id });
        } else {
            const result = db.prepare(`
                INSERT INTO saved_job_applications (user_id, job_title, company, location, pay_rate, careers_url, status, notes, applied_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                targetId,
                jobTitle,
                company,
                location || 'Charleston, SC',
                payRate || 'Competitive',
                careersUrl || '',
                status || 'saved',
                notes || '',
                status === 'applied' ? new Date().toISOString().split('T')[0] : null
            );
            res.json({ success: true, message: 'Job saved to your pipeline.', id: result.lastInsertRowid });
        }
    } catch(err) {
        res.status(500).json({ error: 'Failed to save job: ' + err.message });
    }
});

app.post('/api/jobs/update-job-status', authenticateToken, (req, res) => {
    const { id, status, notes } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'id and status required.' });

    try {
        const app = db.prepare('SELECT user_id FROM saved_job_applications WHERE id = ?').get(id);
        if (!app) return res.status(404).json({ error: 'Saved job not found' });
        if (req.user.role === 'participant' && req.user.id !== app.user_id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        db.prepare(`
            UPDATE saved_job_applications SET
                status = ?,
                notes = COALESCE(?, notes),
                applied_date = CASE WHEN ? = 'applied' AND applied_date IS NULL THEN CURRENT_DATE ELSE applied_date END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(status, notes || null, status, id);

        res.json({ success: true, message: 'Pipeline status updated.' });
    } catch(err) {
        res.status(500).json({ error: 'Failed to update status: ' + err.message });
    }
});

app.delete('/api/jobs/saved/:id', authenticateToken, (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const app = db.prepare('SELECT user_id FROM saved_job_applications WHERE id = ?').get(id);
        if (!app) return res.status(404).json({ error: 'Job not found' });
        if (req.user.role === 'participant' && req.user.id !== app.user_id) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        db.prepare('DELETE FROM saved_job_applications WHERE id = ?').run(id);
        res.json({ success: true, message: 'Job removed from pipeline.' });
    } catch(err) {
        res.status(500).json({ error: 'Failed to delete saved job: ' + err.message });
    }
});

// Impersonate Participant (Staff Only)
app.post('/api/admin/impersonate/:userId', authenticateToken, (req, res) => {
    if (req.user.role !== 'program_manager' && req.user.role !== 'admin' && req.user.role !== 'director') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const targetUserId = parseInt(req.params.userId, 10);

    const user = db.prepare('SELECT id, email, name, role, track, location FROM users WHERE id = ?').get(targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, track: user.track }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user });
});

// Catch-all for undefined API routes - ALWAYS return JSON, NEVER HTML
app.use('/api', (req, res) => {
    res.status(404).json({ error: `API endpoint ${req.method} ${req.originalUrl} not found.` });
});

// Fallback to index.html for SPA / client routes
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/data/')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

// Global Express Error Handler - Always return JSON for API requests
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    if (req.path.startsWith('/api/')) {
        return res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
    res.status(500).send('Internal Server Error');
});



// ==========================================
// STAFF ASSESSMENTS (HEALTH & STABILITY)
// ==========================================

app.post('/api/staff/health-assessment', authenticateToken, (req, res) => {
    if (req.user.role !== 'program_manager' && req.user.role !== 'admin' && req.user.role !== 'director') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const {
        participant_id, vision_issues, hearing_issues, mobility_pain, stamina_fatigue,
        fine_motor_issues, physical_notes, reading_writing_issues, following_instructions_issues,
        memory_organization_issues, processing_time_issues, cognitive_notes,
        emotional_regulation_issues, anxiety_panic, social_interactions_issues,
        baseline_changes, avoidance, mental_health_notes, primary_care_referral,
        vocational_rehab_referral, mental_health_referral, job_search_adjustment, immediate_next_step
    } = req.body;

    try {
        const stmt = db.prepare(`
            INSERT INTO health_wellness_screen (
                user_id, assessor_name, vision_issues, hearing_issues, mobility_pain, stamina_fatigue,
                fine_motor_issues, physical_notes, reading_writing_issues, following_instructions_issues,
                memory_organization_issues, processing_time_issues, cognitive_notes,
                emotional_regulation_issues, anxiety_panic, social_interactions_issues,
                baseline_changes, avoidance, mental_health_notes, primary_care_referral,
                vocational_rehab_referral, mental_health_referral, job_search_adjustment, immediate_next_step
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            participant_id, req.user.name, vision_issues||0, hearing_issues||0, mobility_pain||0, stamina_fatigue||0,
            fine_motor_issues||0, physical_notes, reading_writing_issues||0, following_instructions_issues||0,
            memory_organization_issues||0, processing_time_issues||0, cognitive_notes,
            emotional_regulation_issues||0, anxiety_panic||0, social_interactions_issues||0,
            baseline_changes||0, avoidance||0, mental_health_notes, primary_care_referral||0,
            vocational_rehab_referral||0, mental_health_referral||0, job_search_adjustment||0, immediate_next_step
        );
        
        res.json({ success: true, message: 'Health assessment saved.' });
    } catch (error) {
        console.error('Health assessment error:', error);
        res.status(500).json({ error: 'Failed to save health assessment.' });
    }
});

app.post('/api/staff/stability-check', authenticateToken, (req, res) => {
    if (req.user.role !== 'program_manager' && req.user.role !== 'admin' && req.user.role !== 'director') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Using a simplified body extraction for brevity
    const data = req.body;
    try {
        const stmt = db.prepare(`
            INSERT INTO weekly_stability_checks (
                user_id, week_number, assessor_name, new_sexual_convictions, permanent_restraining_order,
                recent_major_drug_use, housing_instability, homeless_or_motel, facing_eviction,
                failed_drug_test, new_arrest, two_unplanned_absences, no_call_no_show,
                moving_out_of_area, court_mandate_conflict, childcare_loss, transportation_breakdown,
                mental_health_crisis, physical_health_emergency, barriers_identified, can_meet_rapidly,
                needs_more_resources, attendance_satisfactory, ability_learn_q2, removing_barriers,
                cbt_homework_completed, cbt_discussion_active, cbt_roleplay_effort, transportation_viable,
                qualified_for_desired_jobs, no_disqualifying_convictions, has_certifications,
                has_education, can_work_schedule, supervision_allows_schedule, no_psf_overnight,
                transitional_house_allows_overnight
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            data.participant_id, data.week_number||1, req.user.name,
            data.new_sexual_convictions||0, data.permanent_restraining_order||0, data.recent_major_drug_use||0,
            data.housing_instability||0, data.homeless_or_motel||0, data.facing_eviction||0,
            data.failed_drug_test||0, data.new_arrest||0, data.two_unplanned_absences||0,
            data.no_call_no_show||0, data.moving_out_of_area||0, data.court_mandate_conflict||0,
            data.childcare_loss||0, data.transportation_breakdown||0, data.mental_health_crisis||0,
            data.physical_health_emergency||0, data.barriers_identified, data.can_meet_rapidly||1,
            data.needs_more_resources||0, data.attendance_satisfactory||1, data.ability_learn_q2||1,
            data.removing_barriers||1, data.cbt_homework_completed||1, data.cbt_discussion_active||1,
            data.cbt_roleplay_effort||1, data.transportation_viable||1, data.qualified_for_desired_jobs||1,
            data.no_disqualifying_convictions||1, data.has_certifications||1, data.has_education||1,
            data.can_work_schedule||1, data.supervision_allows_schedule||1, data.no_psf_overnight||1,
            data.transitional_house_allows_overnight||1
        );
        res.json({ success: true, message: 'Stability check saved.' });
    } catch (error) {
        console.error('Stability check error:', error);
        res.status(500).json({ error: 'Failed to save stability check.' });
    }
});

// ==========================================
// APRICOT IMPORT / EXPORT 
// ==========================================

// Using existing multer instance
const apricotUpload = multer({ dest: 'uploads/' });
const fsOptions = require('fs');

app.post('/api/apricot/import', authenticateToken, apricotUpload.single('file'), (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'director') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const fileData = fsOptions.readFileSync(req.file.path, 'utf8');
        const lines = fileData.split('\n');
        
        let processed = 0;
        let flags = 0;
        
        // Very basic CSV processing for points and case notes
        db.transaction(() => {
            // Assume format: ParticipantName, Date, PointsEarned, CaseNotes
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const parts = line.split(',');
                if (parts.length >= 3) {
                    const name = parts[0];
                    const points = parseFloat(parts[2]);
                    
                    const user = db.prepare("SELECT id FROM users WHERE name LIKE ?").get('%' + name + '%');
                    if (user) {
                        processed++;
                        // Flag if points < 10
                        if (points < 10) {
                            flags++;
                            db.prepare("INSERT INTO daily_points (user_id, points_earned, notes, imported_from_apricot) VALUES (?, ?, ?, 1)")
                              .run(user.id, points, 'Flagged: Missing points (stability issue)');
                        } else {
                            db.prepare("INSERT INTO daily_points (user_id, points_earned, imported_from_apricot) VALUES (?, ?, 1)")
                              .run(user.id, points);
                        }
                    }
                }
            }
            
            db.prepare("INSERT INTO apricot_sync_logs (filename, records_processed, flags_generated) VALUES (?, ?, ?)")
              .run(req.file.originalname, processed, flags);
        })();
        
        res.json({ success: true, processed, flags });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to import Apricot data.' });
    }
});

app.get('/api/apricot/export', authenticateToken, (req, res) => {
    // Generate CSV export of case notes and briefcase status to load back into Apricot
    try {
        const notes = db.prepare(`
            SELECT u.name, c.session_date, c.category, c.content 
            FROM case_notes c 
            JOIN users u ON c.user_id = u.id 
            WHERE c.apricot_exported = 0
        `).all();
        
        let csv = 'ParticipantName,SessionDate,Category,Content\n';
        notes.forEach(n => {
            const cleanContent = n.content.replace(/"/g, '""');
            csv += `"${n.name}","${n.session_date}","${n.category}","${cleanContent}"\n`;
        });
        
        // Mark as exported
        db.prepare("UPDATE case_notes SET apricot_exported = 1 WHERE apricot_exported = 0").run();
        
        res.header('Content-Type', 'text/csv');
        res.attachment('Apricot_Export.csv');
        res.send(csv);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to export to Apricot.' });
    }
});



// Temporary Migration: Cleanup old gate criteria that are no longer in DEFAULT_GATE_CRITERIA
(function runGateCleanup() {
    try {
        const { DEFAULT_GATE_CRITERIA } = require('./db');
        let validKeys = [];
        for (const week of [1, 2, 3, 4]) {
            if (DEFAULT_GATE_CRITERIA[week]) {
                DEFAULT_GATE_CRITERIA[week].forEach(g => validKeys.push(g.key));
            }
        }
        if (validKeys.length > 0) {
            const placeholders = validKeys.map(() => '?').join(',');
            const db = require('./db').db;
            db.prepare(`DELETE FROM gate_criteria WHERE criterion_key NOT IN (${placeholders})`).run(...validKeys);
            console.log("Migration: Cleaned up old/deprecated gate criteria");
            db.prepare("DELETE FROM gate_criteria WHERE criterion_key LIKE '%skillcat%' AND user_id IN (SELECT id FROM users WHERE track = 'reentry_nav')").run();
            console.log("Migration: Removed SkillCat gates for Reentry Nav participants");
        }
    } catch (e) {
        console.error("Migration failed:", e.message);
    }
})();


// ONE-TIME MIGRATION: Map old briefcase data to new interactive gates

// --- AI Caseload Dashboard Endpoint ---
app.get('/api/staff/ai-caseload-report', authenticateToken, requireRole('program_manager', 'director', 'admin'), async (req, res) => {
    try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
        }
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 1. Gather active participants
        const participants = db.prepare(`
            SELECT u.id, u.name, p.current_gate 
            FROM users u
            JOIN participant_profiles p ON u.id = p.user_id
            WHERE u.role = 'participant' AND p.overall_status IN ('active', 'reentry_nav_stabilizing')
        `).all();
        
        if (participants.length === 0) {
            return res.json({ staff_audit: "No active participants to analyze.", participant_insights: [] });
        }
        
        let bundleData = {
            context: "Current active participant caseload for Turn90 First Shift / Reentry Navigation.",
            participants: []
        };
        
        // 2. Gather recent data for each participant
        for (const p of participants) {
            // Gates
            const gates = db.prepare(`
                SELECT criterion_key, status, participant_notes, pm_notes 
                FROM gate_criteria 
                WHERE user_id = ? AND status IN ('pending', 'red')
            `).all(p.id);
            
            // Case Notes (last 30 days)
            const caseNotes = db.prepare(`
                SELECT session_date, note_type, content, author_name 
                FROM case_notes 
                WHERE user_id = ? AND session_date >= date('now', '-30 days')
                ORDER BY session_date DESC LIMIT 5
            `).all(p.id);
            
                        // Points for the most recently logged week (Mon-Fri)
            const pointsSummary = getWeeklyPointsSummary(p.id);
            const points = { total_points: pointsSummary.currentWeekPoints };
            
            // Weekly Stability Checks (Drug screens / Housing)
            const checks = db.prepare(`
                SELECT recent_major_drug_use, housing_instability, no_call_no_show
                FROM weekly_stability_checks
                WHERE participant_id = ? 
                ORDER BY created_at DESC LIMIT 1
            `).get(p.id);
            
            bundleData.participants.push({
                participant_id: p.id,
                name: p.name,
                current_gate: p.current_gate,
                recent_points: points ? points.total_points : 0,
                pending_or_blocked_gates: gates,
                recent_case_notes: caseNotes,
                latest_stability_check: checks
            });
        }
        
        // 3. Prompt Gemini
        const prompt = `
You are an expert Clinical Program Director analyzing your case management staff's recent work.
I am providing you with the recent case notes, blocked/pending gates, daily points, and stability checks for active participants.

Perform two tasks:
1. Analyze the case notes globally across all participants to evaluate the quality of interventions and work the program staff is applying. Are they using Cognitive Behavioral Interventions (CBI)? Are they addressing the actual blocked gates and drug test failures proactively? Provide a constructive 3-4 sentence paragraph.
2. For each participant, provide 2-3 highly specific, actionable "Suggested Next Steps" for the case manager based on the participant's specific blocked gates, recent case notes, drug test flags, or low points.

Return a JSON object EXACTLY matching this schema:
{
  "staff_audit": "A summary paragraph analyzing staff intervention quality...",
  "participant_insights": [
    {
      "participant_id": 123,
      "name": "John Doe",
      "points_this_week": 45,
      "drug_test_flag": true,
      "suggested_next_steps": [
        "Schedule a 1-on-1 to discuss the recent positive drug screen.",
        "Help participant secure their Birth Certificate (Gate 1 blocker)."
      ]
    }
  ]
}

Input Data:
${JSON.stringify(bundleData, null, 2)}
        `;
        
        const result = await model.generateContent(prompt);
        let responseText = result.response.text();
        // Remove markdown formatting if present
        responseText = responseText.replace(/\s*```json\s*/g, '').replace(/\s*```\s*$/g, '');
        
        res.json(JSON.parse(responseText));
        
    } catch (error) {
        console.error("AI Caseload Report Error:", error);
        res.status(500).json({ error: "Failed to generate AI report" });
    }
});


(function runLegacyBriefcaseMigration() {
    const fs = require('fs');
    const path = require('path');
    const flagFile = path.join(__dirname, 'data', '.legacy_briefcase_migrated');
    if (fs.existsSync(flagFile)) return;
    try {
        const { db } = require('./db');
        const legacyData = [
  {
    "First Name": "semaj",
    "Last Name": "hart",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-06T17:10:19.223+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Terrence",
    "Last Name": "Brown",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-20T15:07:30.672155+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Andresd",
    "Last Name": "Bonham",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-07T14:49:49.784225+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Andres",
    "Last Name": "Bonham",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-05T17:07:58.514+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "true",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "true",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Isiah",
    "Last Name": "Oree",
    "Location": "Charleston",
    "90-Day Goal": "Buy a car ",
    "Last Login": "2026-09-14T14:47:33.19+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "ioree9191@gmail.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I plan on buying  a car within 2months of working",
    "CS: Housing Plan": "I'm living at an Oxford house and plan on getting my own spot within a year and 6months",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "true",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Manufacturing",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "true",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "private chef",
    "CP: Target Industry": "food n bev",
    "CP: Entry Level Job": "sous chef",
    "CP: Next Credential": "head chef",
    "CP: 6-Month Goal": "working at a prestigious restaurant ",
    "CP: Long-Term Wage Goal": "80k year",
    "Completed Trades Workorders": "5; 6; 7; 10; 11; 12; 19; 20; 27; 28; 35; 36; 43; 44; 51; 52; 60; 64; 72; 80"
  },
  {
    "First Name": "Jennifer",
    "Last Name": "Jeanquart",
    "Location": "Columbia",
    "90-Day Goal": "",
    "Last Login": "2026-09-09T11:56:27.305+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Jovon",
    "Last Name": "Bonneau",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-09-08T14:41:43.801+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "bonneau1004@yahoo.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "true",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "118 Rockingham Way Moncks Corner SC 29461",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Manufacturing",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "clyde",
    "Last Name": "williams",
    "Location": "Columbia",
    "90-Day Goal": "get my license, get a job, and stay focused, keep building on my relationships for the better",
    "Last Login": "2026-08-17T14:48:05.101951+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "clydewilliams073089@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "going to get license soon but have a very reliable ride",
    "CS: Housing Plan": "I have a stable address",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Forklift Operator",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "to get my HVAC ",
    "CP: Target Industry": "Forklift operator and hvac",
    "CP: Entry Level Job": "get certified ",
    "CP: Next Credential": "forklift certification and hvac",
    "CP: 6-Month Goal": "forklift operator and making at least 20 dallors an hour",
    "CP: Long-Term Wage Goal": "120k a year",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Keyzelle",
    "Last Name": "Thomas",
    "Location": "Columbia",
    "90-Day Goal": "my 90 day goal is to get my CDL so I can start taking care of my other obligations I have such as my children",
    "Last Login": "2026-08-24T15:26:27.866269+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "",
    "CS: Email Address": "keyzellethomas@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I have a vehicle",
    "CS: Housing Plan": "looking for housing",
    "LR: Child Support": "true",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "CDL / Trucking",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "truck driver",
    "CP: Target Industry": "transportation",
    "CP: Entry Level Job": "na",
    "CP: Next Credential": "cdl",
    "CP: 6-Month Goal": "driving locally",
    "CP: Long-Term Wage Goal": "own a dump truck and be my own boss",
    "Completed Trades Workorders": "1; 8; 13; 15; 21; 23; 29; 31; 37; 39; 45; 47; 53; 55; 65; 67; 73; 75"
  },
  {
    "First Name": "Justin",
    "Last Name": "Evans",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-09-01T21:37:32.466+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "true",
    "LR: Sex Offender": "true",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "4"
  },
  {
    "First Name": "Hakeem",
    "Last Name": "Alston",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-05T17:07:35.371694+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "Hakeemworks26@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "family support",
    "CS: Housing Plan": "rent a room",
    "LR: Child Support": "true",
    "LR: Probation": "",
    "LR: Pending Charges": "true",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Eddie",
    "Last Name": "Ballenger",
    "Location": "Spartanburg",
    "90-Day Goal": "",
    "Last Login": "2026-09-08T15:00:29.328721+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "doranballenger13@gmail.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I got support to get me to work to i save up  my money to  get  me a car",
    "CS: Housing Plan": "I have a home with my wife",
    "LR: Child Support": "",
    "LR: Probation": "true",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "to get my DL",
    "CP: Target Industry": "packing and loading truck",
    "CP: Entry Level Job": "a job",
    "CP: Next Credential": "Forklift",
    "CP: 6-Month Goal": "to have my Forklift",
    "CP: Long-Term Wage Goal": "making 25 per hour",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "wesley",
    "Last Name": "morton",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-20T14:47:51.746+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "I have transportation",
    "CS: Housing Plan": "yes I have a stable address",
    "LR: Child Support": "",
    "LR: Probation": "true",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Forklift Operator",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "good job that pays well",
    "CP: Target Industry": "healthcare or forklift ",
    "CP: Entry Level Job": "studying go to school get certificats ",
    "CP: Next Credential": "plan to get forklift certified ",
    "CP: 6-Month Goal": "working have a car ",
    "CP: Long-Term Wage Goal": "25 hour or more ",
    "Completed Trades Workorders": "4; 9; 17; 25; 33; 41; 49; 57; 58; 61; 69; 77"
  },
  {
    "First Name": "Lawrence",
    "Last Name": "Pinckney",
    "Location": "Columbia",
    "90-Day Goal": "getting a job, going for my g.e d ,",
    "Last Login": "2026-09-15T14:44:44.921+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "pinckneylawrence28@gmail.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "city bus",
    "CS: Housing Plan": "3421 N.Main Street Columbia 29203",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Khalif",
    "Last Name": "Countee",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-09-10T14:43:48.276+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "girldad013117@icloud.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "walking to work until I can afford a vehicle.",
    "CS: Housing Plan": "staying at calm quarters until I decide to go out on my own. 2229 James Bell Drive APT C North Charleston, SC 29406",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "owning my own transportation business, and having my youth initiative ",
    "CP: Target Industry": "driving people around",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "1; 2; 3; 4; 5; 6; 7; 8; 9; 10; 11; 12; 13; 14; 15; 16; 17; 18; 19; 20; 21; 22; 23; 24; 25; 26; 27; 29; 30; 31; 32; 33; 34; 35; 37; 38; 39; 40; 42; 45; 46; 47; 48; 50; 53; 54; 58; 62; 65; 66; 81; 82; 83; 84; 85; 86; 87"
  },
  {
    "First Name": "john",
    "Last Name": "cabrera",
    "Location": "Charleston",
    "90-Day Goal": "My goal is to secure a car and employment and to stay drug free!!!!",
    "Last Login": "2026-08-17T15:11:52.109+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "true",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "I plan on getting me a car in a couple of months.",
    "CS: Housing Plan": "I plan on having my own apartment by the beginning  of next year!",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "CDL / Trucking",
    "ER: Resume Completed": "",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "true",
    "HW: Prescription": "true",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "My goal is to work for Toyota and get my CDL .",
    "CP: Target Industry": "Technician/Transportation",
    "CP: Entry Level Job": "get my licence and then get my CDL permit!",
    "CP: Next Credential": "CDL permit test",
    "CP: 6-Month Goal": "I want to be in my own place and have a peaceful life!",
    "CP: Long-Term Wage Goal": "I want to own my own house and make about 70,000 to 80,000 a year!",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "brandon",
    "Last Name": "swearinger",
    "Location": "Columbia",
    "90-Day Goal": "employed full time ",
    "Last Login": "2026-08-17T14:45:49.33755+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "ride with friend",
    "CS: Housing Plan": "live at halfway house",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Manufacturing",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "lokheim",
    "Last Name": "campbell",
    "Location": "Columbia",
    "90-Day Goal": "I would like to have my driver licence and find suitable housing",
    "Last Login": "2026-08-31T14:52:07.889+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "I need to get my license reinstated. I owe the Treasury department in Bennettsville SC for tags that were not turned in upon my incaraction. Right now I am catching a ride with a fellow turn90.",
    "CS: Housing Plan": "I will need to find housing upon my release from the federal half way house. I have committed to relocation to this area Columbia",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Forklift Operator",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "true",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "true",
    "HW: Substance Recovery": "true",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "4; 7; 12; 20; 36"
  },
  {
    "First Name": "Michael",
    "Last Name": "Blunt",
    "Location": "Spartanburg",
    "90-Day Goal": "",
    "Last Login": "2026-08-18T14:46:40.507314+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "mblunt747474@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "Moped",
    "CS: Housing Plan": "Oxford House",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "true",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "chance",
    "Last Name": "simmons",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-24T15:57:51.237+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "Dillydilly1607@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "true",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I operate the city bus line I have free",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "true",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "4; 9"
  },
  {
    "First Name": "Stephen",
    "Last Name": "Odom",
    "Location": "Spartanburg",
    "90-Day Goal": "i would like to get my license.. start studying for my ged test.. get my fork lift certificate.. get better transportation... i would like to build a better relationship with my kids ",
    "Last Login": "2026-09-17T17:17:16.711+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "stephenodom1986@gmail.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "save up money to get a mopad or e bike",
    "CS: Housing Plan": "i have a stable house",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Warehousing",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "true",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "true",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "a high paying career...",
    "CP: Target Industry": "wearhouse",
    "CP: Entry Level Job": "start putting in apps ",
    "CP: Next Credential": "fork lift certificate",
    "CP: 6-Month Goal": "have my own transportation get off probation ",
    "CP: Long-Term Wage Goal": "25.00 an hour",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Shelah",
    "Last Name": "Norman",
    "Location": "Spartanburg",
    "90-Day Goal": "",
    "Last Login": "2026-08-27T15:11:17.008+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "my car",
    "CS: Housing Plan": "mother",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "to be an pro boxer/ entrupenuer",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Arnold",
    "Last Name": "Michel",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-10T17:09:19.096412+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "true",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "I have a car",
    "CS: Housing Plan": "886 Ashley Ave\n(stable house)",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Government Work",
    "ER: Resume Completed": "",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "true",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "true",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "find a job I can retire from",
    "CP: Target Industry": "government",
    "CP: Entry Level Job": "apply",
    "CP: Next Credential": "CDL, Forklift , Electrician Certificate",
    "CP: 6-Month Goal": "on good paying job",
    "CP: Long-Term Wage Goal": "$30 an hour",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "William",
    "Last Name": "Taylor",
    "Location": "Columbia",
    "90-Day Goal": "My 90 day goal is to have a stable job ,have my driver's license and for me and my family to be done move to a different area and to have some money saved",
    "Last Login": "2026-09-14T15:26:31.741981+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "some days my mom or girlfriend can't take me work so I'm going to have to catch the city bus",
    "CS: Housing Plan": "plans are to move from where I currently live",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "David",
    "Last Name": "Ferguson",
    "Location": "Columbia",
    "90-Day Goal": "To have a job I can consider as my career.",
    "Last Login": "2026-09-17T14:49:18.725+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "dkferguson84@icloud.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "true",
    "CS: Transportation Plan": "Right now I drive a moped, but I plan on using my Turn90 funds to purchase a vehicle.",
    "CS: Housing Plan": "My stable address is located at an Oxford House right now.",
    "LR: Child Support": "",
    "LR: Probation": "true",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "true",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "semaj",
    "Last Name": "hart",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-04T17:11:57.05008+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "about to get car insurance asap",
    "CS: Housing Plan": "2105 brookstone way",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "true",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "any career where I have stability",
    "CP: Target Industry": "construction , electrician",
    "CP: Entry Level Job": "appretenceship",
    "CP: Next Credential": "electrician journyman",
    "CP: 6-Month Goal": "stable ",
    "CP: Long-Term Wage Goal": "80k a year",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Brandon",
    "Last Name": "Still",
    "Location": "Columbia",
    "90-Day Goal": "to figure out what's going on with my health and to have a job ",
    "Last Login": "2026-08-31T17:33:37.586+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "bstill768@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "Have a car",
    "CS: Housing Plan": "At the halfway house for 6 more months then stay with my nanny till I can get my house back together ",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "CDL / Trucking",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "7; 12; 20; 81"
  },
  {
    "First Name": "gary",
    "Last Name": "robinson",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-17T17:11:50.81+00:00",
    "CS: State ID": "",
    "CS: Drivers License": "",
    "CS: SSN Card": "",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "",
    "CS: Professional Email": "",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Daquarius",
    "Last Name": "Holmes",
    "Location": "Charleston",
    "90-Day Goal": "New Bank, License, Job, Car, Dental",
    "Last Login": "2026-08-17T15:05:36.8+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "Im riding the bus right now until I get my license & buy a car",
    "CS: Housing Plan": "Im living with my sister.",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "true",
    "HW: Prescription": "true",
    "HW: Meds Current": "",
    "HW: Mental Health": "true",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "6"
  },
  {
    "First Name": "Chris",
    "Last Name": "Barranco",
    "Location": "Columbia",
    "90-Day Goal": "Found and began working at a job I enjoy; a job that pays my bills, gets me out of debt, and still pays me enough to save money and pay for extra things for my family.",
    "Last Login": "2026-08-24T15:38:08.741011+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "chrisbarranco41@gmail.com",
    "CS: Prof Voicemail": "true",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I have a vehicle",
    "CS: Housing Plan": "Oxford House\n200 Marabou Circle\nWest Columbia, SC 29169",
    "LR: Child Support": "true",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "1; 4; 9; 17; 21; 29; 37; 45; 53; 65; 73; 81; 82; 83; 84; 85; 86; 87; 88; 89; 90"
  },
  {
    "First Name": "Dillon",
    "Last Name": "Johnson",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-09-14T17:09:12.033+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "DillyDilly1607@gmail.com",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "I'm on the city bus line Until I get my permit and my license",
    "CS: Housing Plan": "",
    "LR: Child Support": "",
    "LR: Probation": "",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": "4; 5; 6; 7; 9; 10; 11; 12; 17; 18; 19; 20; 25; 26; 27; 28; 33; 34; 35; 36; 41; 42; 43; 44; 49; 50; 51; 52; 57; 58; 59; 60; 61; 62; 63; 64; 69; 70; 71; 77; 78; 79"
  },
  {
    "First Name": "Hakeem",
    "Last Name": "Alston",
    "Location": "Charleston",
    "90-Day Goal": "",
    "Last Login": "2026-08-04T17:13:15.928661+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "family support",
    "CS: Housing Plan": "rented a room",
    "LR: Child Support": "true",
    "LR: Probation": "",
    "LR: Pending Charges": "true",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Forklift Operator",
    "ER: Resume Completed": "true",
    "ER: Workplace References": "",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "",
    "ER: Work Tools": "true",
    "HW: Health Insurance": "",
    "HW: Welvista": "",
    "HW: Primary Care": "",
    "HW: Vision": "true",
    "HW: Prescription": "",
    "HW: Meds Current": "",
    "HW: Mental Health": "",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "",
    "FIN: Credit Report": "",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "",
    "CP: Career Goal": "",
    "CP: Target Industry": "",
    "CP: Entry Level Job": "",
    "CP: Next Credential": "",
    "CP: 6-Month Goal": "",
    "CP: Long-Term Wage Goal": "",
    "Completed Trades Workorders": ""
  },
  {
    "First Name": "Jarvier",
    "Last Name": "Frazier-Butler",
    "Location": "Charleston",
    "90-Day Goal": "Find a decent paying job",
    "Last Login": "2026-09-11T14:52:21.795+00:00",
    "CS: State ID": "true",
    "CS: Drivers License": "true",
    "CS: SSN Card": "true",
    "CS: Birth Certificate": "true",
    "CS: Reliable Phone": "true",
    "CS: Professional Email": "true",
    "CS: Email Address": "",
    "CS: Prof Voicemail": "",
    "CS: Library Card": "",
    "CS: Bank Account": "true",
    "CS: Child Support Contact": "",
    "CS: Transportation Plan": "Walking/Bus",
    "CS: Housing Plan": "Reentry Education Program",
    "LR: Child Support": "",
    "LR: Probation": "true",
    "LR: Pending Charges": "",
    "LR: Sex Offender": "",
    "LR: ADSAP": "",
    "ER: Career Interest": "Construction",
    "ER: Resume Completed": "",
    "ER: Workplace References": "true",
    "ER: Interview Practice": "true",
    "ER: Interview Clothing": "true",
    "ER: Work Tools": "",
    "HW: Health Insurance": "true",
    "HW: Welvista": "",
    "HW: Primary Care": "true",
    "HW: Vision": "",
    "HW: Prescription": "",
    "HW: Meds Current": "true",
    "HW: Mental Health": "true",
    "HW: Substance Recovery": "",
    "FIN: Bank Account": "true",
    "FIN: Budget Completed": "true",
    "FIN: Budget Income": "",
    "FIN: Budget Expenses": "",
    "FIN: Paychecks": "true",
    "FIN: Savings Goal": "true",
    "FIN: Credit Report": "true",
    "FIN: Child Support Reviewed": "",
    "FIN: Probation Obs": "true",
    "CP: Career Goal": "Becoming a real estate marketing specialist",
    "CP: Target Industry": "Construction",
    "CP: Entry Level Job": "Foreman",
    "CP: Next Credential": "Carpentry",
    "CP: 6-Month Goal": "In college for real estate",
    "CP: Long-Term Wage Goal": "1 million a year",
    "Completed Trades Workorders": "1; 2; 3; 4; 7; 8; 9; 12; 13; 14; 15; 16; 17; 21; 22; 23; 24; 25; 29; 30; 31; 32; 33; 36; 37; 38; 39; 40; 41; 45; 46; 47; 48; 49; 53; 54; 55; 56; 57; 58; 61; 65; 66; 67; 68; 69; 73; 75; 76; 77; 81; 82; 83; 84; 85; 86; 87; 88; 89; 90"
  }
];
        
        let updatedCount = 0;
        
        for (const row of legacyData) {
            const firstName = (row['First Name'] || '').trim();
            const lastName = (row['Last Name'] || '').trim();
            const fullName = (firstName + ' ' + lastName).toLowerCase();
            const email = (row['CS: Email Address'] || '').trim().toLowerCase();
            
            let users = db.prepare('SELECT id FROM users WHERE LOWER(name) = ?').all(fullName);
            if (users.length === 0 && email.length > 0) {
                users = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').all(email);
            }
            
            if (users.length === 0) continue;
            
            const userId = users[0].id;
            
            const applyGate = (gateKey, status, notes = '') => {
                db.prepare(`
                    UPDATE gate_criteria 
                    SET status = CASE WHEN status = 'pending' THEN ? ELSE status END, 
                        participant_notes = CASE WHEN (participant_notes IS NULL OR participant_notes = '') THEN ? ELSE participant_notes END
                    WHERE user_id = ? AND criterion_key = ?
                `).run(status, notes, userId, gateKey);
            };

            // Gate 1
            if (row['CS: State ID'] === 'true' || row['CS: Drivers License'] === 'true') applyGate('g1_photo_id', 'green');
            if (row['CS: SSN Card'] === 'true') applyGate('g1_ssn', 'green');
            if (row['CS: Birth Certificate'] === 'true') applyGate('g1_birth_cert', 'green');
            if (row['90-Day Goal'] && row['90-Day Goal'].trim().length > 0) applyGate('g1_main_goal', 'green', row['90-Day Goal'].trim());

            // Gate 2
            if (row['CS: Child Support Contact'] && row['CS: Child Support Contact'].trim().length > 0) {
                applyGate('g2_child_support', 'green', row['CS: Child Support Contact'].trim());
            } else if (row['LR: Child Support'] === 'true') {
                applyGate('g2_child_support', 'green');
            }

            if (row['CS: Housing Plan'] && row['CS: Housing Plan'].trim().length > 0) applyGate('g2_housing', 'green', row['CS: Housing Plan'].trim());
            if (row['CS: Reliable Phone'] === 'true') applyGate('g2_phone', 'green');
            if (row['CS: Professional Email'] === 'true') applyGate('g2_email', 'green');
            if (row['ER: Resume Completed'] === 'true') applyGate('g2_resume', 'green');

            // Gate 3
            if (row['HW: Primary Care'] === 'true') applyGate('g3_primary_care', 'green');
            if (row['HW: Vision'] === 'true') applyGate('g3_vision', 'green');
            if (row['HW: Prescription'] === 'true') applyGate('g3_prescription_access', 'green');
            if (row['HW: Mental Health'] === 'true' || row['HW: Substance Recovery'] === 'true') applyGate('g3_mental_health', 'green');
            if (row['CS: Bank Account'] === 'true' || row['FIN: Bank Account'] === 'true') applyGate('g3_bank_account', 'green');

            // Gate 4
            if (row['ER: Work Tools'] === 'true') applyGate('g4_work_gear', 'green');
            if (row['CS: Transportation Plan'] && row['CS: Transportation Plan'].trim().length > 0) {
                const text = row['CS: Transportation Plan'].trim();
                const transportJson = JSON.stringify({ q1: text, q2: '', q3: '' });
                applyGate('g4_transportation', 'green', transportJson);
            }
            if (row['FIN: Budget Completed'] === 'true') applyGate('g4_budget', 'green');
            
            updatedCount++;
        }
        
        console.log("Migration complete: Mapped legacy briefcase data to gates for " + updatedCount + " active users.");
        fs.writeFileSync(flagFile, 'done');
    } catch (e) {
        console.error("Migration failed:", e.message);
    }
})();




app.listen(PORT, async () => {
    console.log(`🚀 Unified First Shift & Re-entry App running at http://localhost:${PORT}`);
    try {
        console.log('🔄 Checking and auto-syncing Briefcase caseload on startup...');
        await runCaseloadMigration();
        console.log('✅ Caseload auto-sync complete.');
        
        // Initialize Dropbox class evaluation cron jobs
        const { initCronJobs } = require('./services/dropbox_evaluator');
        initCronJobs();
    } catch (e) {
        console.warn('Startup sync notice:', e.message);
    }
});

module.exports = {
    app,
    buildPrintableDocumentHtml,
    buildPrintablePageHtml
};
