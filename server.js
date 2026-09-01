const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { db, DEFAULT_GATE_CRITERIA, initUserGateCriteria } = require('./db');
const { runPhase1, runPhase2 } = require('./llm_pipeline');
const { cbtModules, T90_TRADE_TRACKS, REENTRY_EMPLOYERS } = require('./training_data');
const { generateMondayNeedsReport, generateFridayMilestoneReport, importApricotCsv } = require('./reporting_engine');

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
            initUserGateCriteria(userId);
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

app.post('/api/submit-feedback', async (req, res) => {
    const { clientId, feedback } = req.body;
    if (!clientId || !feedback) return res.status(400).json({error: "Missing fields"});

    res.status(200).json({message: "Feedback received, processing phase 2..."});

    try {
        const parts = clientId.split('_');
        const name = parts[1];
        
        const transcript = fs.readFileSync(path.join(dataDir, `${clientId}_transcript.txt`), 'utf8');
        const draftPath = path.join(dataDir, `${clientId}_draft_scoring_form.md`);
        let draft = "";
        if (fs.existsSync(draftPath)) {
            draft = fs.readFileSync(draftPath, 'utf8');
        }

        const results = await runPhase2(transcript, name, draft, feedback);
        
        fs.writeFileSync(path.join(dataDir, `${clientId}_final_scoring_form.md`), results.final_scoring_form);
        fs.writeFileSync(path.join(dataDir, `${clientId}_final_case_brief.md`), results.case_brief);
        
        const csvRow = results.csv_row + "\n";
        fs.appendFileSync(path.join(__dirname, '..', 'FirstShift20IntakeForm.csv'), csvRow);

        if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
        console.log(`Phase 2 complete for ${name}`);
    } catch (err) {
        console.error("Phase 2 failed:", err);
        fs.writeFileSync(path.join(dataDir, `${clientId}_error_phase2.txt`), `Failed Phase 2: ${err.message}`);
    }
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
