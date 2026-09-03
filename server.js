const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, BRIEFCASE_DOMAINS, DEFAULT_GATE_CRITERIA, STABILITY_STEP_DOWN_TRIGGERS, initParticipantBriefcase } = require('./db');
const { runPhase1, runPhase2 } = require('./llm_pipeline');
const { convertSingleMdToPdf } = require('./convert_md_to_pdf');
const { convertSingleMdToDocx } = require('./convert_md_to_docx');
const { evaluateClassTranscript } = require('./facilitation_evaluator');
const { cbtModules, T90_TRADE_TRACKS, REENTRY_EMPLOYERS } = require('./training_data');
const { generateMondayNeedsReport, generateFridayMilestoneReport, importApricotCsv } = require('./reporting_engine');
const { generateReentryNavAssessment } = require('./reentry_engine');
const { SC_COMMUNITY_RESOURCES, SC_FAIR_CHANCE_EMPLOYERS } = require('./sc_resource_directory');
const { loadJobsFromSpreadsheets } = require('./jobs_loader');
const pdfParse = require('pdf-parse');

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
    const token = authHeader && authHeader.split(' ')[1];
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
    const userId = req.user.id;
    const profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(userId);
    const criteria = db.prepare('SELECT * FROM gate_criteria WHERE user_id = ? ORDER BY week_number, id').all(userId);

    const weeks = { 1: [], 2: [], 3: [], 4: [] };
    criteria.forEach(c => {
        if (weeks[c.week_number]) weeks[c.week_number].push(c);
    });

    res.json({
        currentGate: profile ? profile.current_gate : 1,
        profile,
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

// W-9 Submission
app.post('/api/participant/w9', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { fullName, businessName, taxClassification, address, cityStateZip, ssnOrEin, signatureDate } = req.body;

    const w9Data = JSON.stringify({ fullName, businessName, taxClassification, address, cityStateZip, ssnOrEin: '***-**-' + (ssnOrEin ? ssnOrEin.slice(-4) : 'XXXX'), signatureDate });

    // Store in documents table
    db.prepare(`
        INSERT INTO documents (user_id, doc_type, title, filename, file_path, metadata_json)
        VALUES (?, 'w9', 'Form W-9 (Digital Submission)', 'W9_Submission.json', 'internal_json', ?)
    `).run(userId, w9Data);

    // Update profile & week 1 gate criteria
    db.prepare(`UPDATE participant_profiles SET w9_status = 'submitted' WHERE user_id = ?`).run(userId);
    db.prepare(`UPDATE gate_criteria SET status = 'green', pm_notes = 'Submitted digitally by participant' WHERE user_id = ? AND criterion_key = 'w1_w9_id'`).run(userId);

    res.json({ message: 'W-9 submitted and recorded.' });
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

// Get User's Daily Points
app.get('/api/participant/points', authenticateToken, (req, res) => {
    const points = db.prepare('SELECT * FROM daily_points WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
    const summary = db.prepare(`
        SELECT COUNT(*) as total_days,
               AVG(points_earned) as avg_points,
               SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) as present_days,
               SUM(CASE WHEN attendance_status = 'unexcused' THEN 1 ELSE 0 END) as unexcused_days
        FROM daily_points WHERE user_id = ?
    `).get(req.user.id);

    res.json({ points, summary });
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
// RE-ENTRY NAVIGATION & TRAINING ROUTES
// -------------------------------------------------------------
app.get('/api/training/cbt-modules', (req, res) => {
    res.json(cbtModules);
});

app.get('/api/training/trades-tracks', (req, res) => {
    res.json(T90_TRADE_TRACKS);
});

app.get('/api/jobs', (req, res) => {
    res.json(REENTRY_EMPLOYERS);
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
app.get('/api/admin/caseload', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    const { location, track, gate, status } = req.query;
    let query = `
        SELECT u.id, u.name, u.email, u.phone, u.location, u.track, u.created_at,
               p.current_gate, p.overall_status, p.w9_status, p.dl_status, p.child_support_status,
               (SELECT COUNT(*) FROM gate_criteria WHERE user_id = u.id AND status = 'green') as green_criteria,
               (SELECT COUNT(*) FROM gate_criteria WHERE user_id = u.id AND status = 'red') as red_criteria,
               (SELECT AVG(points_earned) FROM daily_points WHERE user_id = u.id) as avg_points
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant'
    `;
    const params = [];
    if (location) { query += ` AND u.location = ?`; params.push(location); }
    if (track) { query += ` AND u.track = ?`; params.push(track); }
    if (gate) { query += ` AND p.current_gate = ?`; params.push(parseInt(gate)); }
    if (status) { query += ` AND p.overall_status = ?`; params.push(status); }

    query += ` ORDER BY p.current_gate DESC, u.name ASC`;
    const roster = db.prepare(query).all(...params);
    res.json(roster);
});

// Update Participant Gate Criteria Status (Red/Green/Pending)
app.post('/api/admin/update-criterion', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
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
app.post('/api/admin/advance-gate', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    const { userId, nextGate } = req.body;
    if (!userId || !nextGate) return res.status(400).json({ error: 'Missing userId or nextGate' });

    db.prepare(`UPDATE participant_profiles SET current_gate = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(nextGate, userId);
    res.json({ message: `Participant advanced to Gate ${nextGate}.` });
});

// Generate Monday Participant Needs Report
app.get('/api/admin/reports/monday-needs', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    const location = req.query.location || null;
    const report = generateMondayNeedsReport(location);
    res.json(report);
});

// Generate Friday Milestone & Termination Report
app.get('/api/admin/reports/friday-milestones', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    const location = req.query.location || null;
    const report = generateFridayMilestoneReport(location);
    res.json(report);
});

// Import Apricot Points CSV
app.post('/api/admin/apricot/import-points', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ error: 'No CSV data provided.' });

    const result = importApricotCsv(csvData);
    res.json(result);
});

// Get All Official Stability Step-Down Triggers
app.get('/api/admin/stability-triggers', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
    res.json(STABILITY_STEP_DOWN_TRIGGERS);
});

// Step-Down to Re-entry Nav OR Apply Director Override
app.post('/api/admin/stability-action', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
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

        return res.json({ message: 'Director Override recorded. Participant remains in First Shift.' });
    }

    res.status(400).json({ error: 'Invalid action.' });
});

// Submit Weekly 4-Pillar Case Planning Review
app.post('/api/admin/weekly-case-review', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
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
app.get('/api/admin/feedback-summary', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
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
app.get('/api/interviews', (req, res) => {
    try {
        const files = fs.readdirSync(dataDir);
        const clients = {};
        files.forEach(f => {
            const parts = f.split('_');
            if (parts.length > 1) {
                const clientId = parts[0] + '_' + parts[1];
                if (!clients[clientId]) clients[clientId] = [];
                clients[clientId].push(f);
            }
        });
        res.json(clients);
    } catch(err) {
        res.status(500).json({error: "Failed to read data directory"});
    }
});

// Fetch file content securely for in-browser preview
app.get('/api/file-content', (req, res) => {
    const filename = req.query.file;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(dataDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, filename });
});

// Fetch Participant-Facing Printable Case Plan
app.get('/api/participant/case-plan', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const user = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const safeName = user.name.replace(/[^a-zA-Z0-9]/g, '');
    const files = fs.readdirSync(dataDir);
    const planFile = files.find(f => f.toLowerCase().includes(safeName.toLowerCase()) && f.endsWith('_participant_case_plan.md'));
    
    if (planFile) {
        const content = fs.readFileSync(path.join(dataDir, planFile), 'utf8');
        const pdfFile = planFile.replace(/\.md$/, '.pdf');
        return res.json({ 
            found: true, 
            markdown: content, 
            filename: planFile,
            pdfUrl: fs.existsSync(path.join(dataDir, pdfFile)) ? `/data/${pdfFile}` : null
        });
    }
    
    res.json({ found: false, message: 'Case plan is currently being generated after supervisor review.' });
});

// Fetch Stored W-9 Details
app.get('/api/participant/w9-details/:userId', authenticateToken, (req, res) => {
    const targetId = parseInt(req.params.userId);
    if (req.user.role === 'participant' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const doc = db.prepare('SELECT * FROM documents WHERE user_id = ? AND doc_type = "w9" ORDER BY uploaded_at DESC LIMIT 1').get(targetId);
    const profile = db.prepare('SELECT w9_status FROM participant_profiles WHERE user_id = ?').get(targetId);
    const user = db.prepare('SELECT name, email, phone, location FROM users WHERE id = ?').get(targetId);
    
    res.json({
        user,
        status: profile ? profile.w9_status : 'pending',
        w9Data: doc && doc.metadata_json ? JSON.parse(doc.metadata_json) : null
    });
});

// Class Facilitation Evaluations API
app.get('/api/admin/evaluations', authenticateToken, requireRole('program_manager', 'admin'), (req, res) => {
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

app.post('/api/admin/evaluate-classes', authenticateToken, requireRole('program_manager', 'admin'), memoryUpload.single('audioOrTranscript'), async (req, res) => {
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

    res.status(200).json({ message: "Feedback received. Generating final clinical case brief and participant plan..." });

    try {
        const parts = clientId.split('_');
        const name = parts[1];
        
        let crimText = criminalHistoryText || '';
        if (req.file && req.file.buffer) {
            try {
                const parsed = await pdfParse(req.file.buffer);
                crimText += '\n\n' + parsed.text;
            } catch (e) {
                console.warn('Could not parse PDF buffer, using raw text:', e.message);
            }
        }

        const transcript = fs.readFileSync(path.join(dataDir, `${clientId}_transcript.txt`), 'utf8');
        const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);
        let draft = "";
        if (fs.existsSync(draftPath)) {
            draft = fs.readFileSync(draftPath, 'utf8');
        }

        const results = await runPhase2(transcript, name, draft, feedback || 'Approved as drafted', crimText);
        
        const finalScoringPath = path.join(dataDir, `${clientId}_final_scoring_form.md`);
        const finalBriefPath = path.join(dataDir, `${clientId}_final_case_brief.md`);
        const participantPlanPath = path.join(dataDir, `${clientId}_participant_case_plan.md`);

        fs.writeFileSync(finalScoringPath, results.final_scoring_form);
        fs.writeFileSync(finalBriefPath, results.case_brief);
        if (results.participant_case_plan) {
            fs.writeFileSync(participantPlanPath, results.participant_case_plan);
        }
        
        if (results.csv_row) {
            const csvRow = results.csv_row + "\n";
            fs.appendFileSync(path.join(__dirname, '..', 'FirstShift20IntakeForm.csv'), csvRow);
        }

        // Convert generated markdowns to PDFs and editable DOCX files asynchronously
        convertSingleMdToPdf(finalScoringPath, finalScoringPath.replace(/\.md$/, '.pdf'));
        convertSingleMdToPdf(finalBriefPath, finalBriefPath.replace(/\.md$/, '.pdf'));
        convertSingleMdToDocx(finalScoringPath, finalScoringPath.replace(/\.md$/, '.docx'));
        convertSingleMdToDocx(finalBriefPath, finalBriefPath.replace(/\.md$/, '.docx'));
        if (results.participant_case_plan) {
            convertSingleMdToPdf(participantPlanPath, participantPlanPath.replace(/\.md$/, '.pdf'));
            convertSingleMdToDocx(participantPlanPath, participantPlanPath.replace(/\.md$/, '.docx'));
        }

        // Auto-update Briefcase & Stability Factors in database
        if (results.briefcase_autofill) {
            const autofill = results.briefcase_autofill;
            const user = db.prepare('SELECT id FROM users WHERE LOWER(name) LIKE ?').get(`%${name.toLowerCase()}%`);
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
                db.prepare(`UPDATE gate_criteria SET status = 'green', pm_notes = 'Interview completed and clinical case brief generated.' WHERE user_id = ? AND criterion_key = 'w1_interview'`).run(uId);
            }
        }

        if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
        console.log(`Phase 2 complete for ${name}`);
    } catch (err) {
        console.error("Phase 2 failed:", err);
        fs.writeFileSync(path.join(dataDir, `${clientId}_error_phase2.txt`), `Failed Phase 2: ${err.message}`);
    }
});

// ==========================================
// RE-ENTRY NAVIGATOR DASHBOARD API ENDPOINTS
// ==========================================

// 1. Get Participants for Re-entry Selector
app.get('/api/reentry/participants', authenticateToken, requireRole('program_manager', 'director', 'admin'), (req, res) => {
    try {
        const rows = db.prepare(`
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
            ORDER BY u.name ASC
        `).all();
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
                    const parsed = await pdfParse(req.file.buffer);
                    fullTranscript += '\n\n' + parsed.text;
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
        const staffPdfUrl = `/data/${filePrefix}_staff_case_plan.pdf`;
        const partDocxUrl = `/data/${filePrefix}_participant_action_guide.docx`;
        const partPdfUrl = `/data/${filePrefix}_participant_action_guide.pdf`;

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
    const locKey = region.toLowerCase().includes('columbia') ? 'columbia' : (region.toLowerCase().includes('greenville') ? 'greenville' : 'charleston');
    
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
        
        const timestamp = Date.now();
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
        const filePrefix = `${timestamp}_${safeName}`;

        fs.writeFileSync(path.join(dataDir, `${filePrefix}_audio.webm`), audioBuffer);
        fs.writeFileSync(path.join(dataDir, `${filePrefix}_transcript.txt`), transcriptText);

        const transcriptBuffer = Buffer.from(transcriptText, 'utf8');
        resend.emails.send({
            from: 'Interview App <onboarding@resend.dev>', 
            to: process.env.EMAIL_USER || 'test@example.com', 
            subject: `New Interview Recording: ${name} (${location})`,
            text: `Please find the attached WebM audio recording and text transcript from the interview app.\n\nParticipant: ${name}\nLocation: ${location}`,
            attachments: [
                { filename: originalName, content: audioBuffer },
                { filename: `${name}_${location}_Transcript.txt`, content: transcriptBuffer }
            ]
        }).catch(err => console.error("Resend error:", err));
        
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

// Fallback to index.html for SPA / client routes
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/data/')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

app.listen(PORT, () => {
    console.log(`🚀 Unified First Shift & Re-entry App running at http://localhost:${PORT}`);
});
