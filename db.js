const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app_database.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant', -- 'participant', 'program_manager', 'admin'
    track TEXT NOT NULL DEFAULT 'first_shift', -- 'first_shift', 'reentry_nav'
    location TEXT DEFAULT 'Charleston',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    current_gate INTEGER DEFAULT 1, -- 1 to 4
    w9_status TEXT DEFAULT 'pending', -- 'pending', 'submitted', 'verified'
    dl_status TEXT DEFAULT 'unknown', -- 'valid', 'suspended', 'reinstatement_plan', 'not_applicable'
    dl_notes TEXT,
    child_support_status TEXT DEFAULT 'unknown', -- 'none', 'active_plan', 'modification_needed', 'behind'
    child_support_notes TEXT,
    housing_status TEXT DEFAULT 'stable', -- 'stable', 'at_risk', 'shelter', 'transitional'
    substance_status TEXT DEFAULT 'none',
    mental_health_status TEXT DEFAULT 'none',
    transportation_status TEXT DEFAULT 'bus',
    court_dates TEXT,
    overall_status TEXT DEFAULT 'active', -- 'active', 'completed', 'at_risk', 'terminated'
    termination_reason TEXT,
    termination_date DATE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL, -- 1, 2, 3, 4
    criterion_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending', -- 'green' (met), 'red' (at-risk/failed), 'pending'
    pm_notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, week_number, criterion_key)
);

CREATE TABLE IF NOT EXISTS daily_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date DATE NOT NULL,
    points_earned REAL DEFAULT 0,
    max_points REAL DEFAULT 10,
    attendance_status TEXT DEFAULT 'present', -- 'present', 'tardy', 'excused', 'unexcused'
    notes TEXT,
    imported_from_apricot INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL, -- 'w9', 'id', 'ssn', 'resume', 'cert', 'apricot_report', 'other'
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    status TEXT DEFAULT 'active',
    metadata_json TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS class_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    participant_name TEXT,
    location TEXT,
    session_title TEXT NOT NULL,
    facilitator TEXT,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    key_takeaway TEXT,
    feedback_text TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weekly_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL, -- 'monday_needs', 'friday_milestones'
    location TEXT,
    week_start_date DATE,
    data_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    module_type TEXT NOT NULL, -- 'cbt', 'trades', 'digital_lit', 'soft_skills'
    module_key TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    score REAL,
    response_data TEXT,
    completed_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, module_type, module_key)
);

CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    resume_data_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Standard 4-Week Job Readiness Gate Criteria definition
const DEFAULT_GATE_CRITERIA = {
    1: [
        { key: 'w1_attendance', title: '100% Attendance & Punctuality', description: 'Zero unexcused absences and on-time arrival every day of Week 1.' },
        { key: 'w1_interview', title: 'LS/CMI Assessment Interview Completed', description: 'Audio interview recorded, transcribed, and draft scoring generated.' },
        { key: 'w1_w9_id', title: 'W-9 & Valid ID Verified', description: 'Digital W-9 submitted and government-issued ID/Birth Certificate uploaded.' },
        { key: 'w1_barrier_audit', title: 'Baseline Barrier Audit Completed', description: 'Action plan established for Driver’s License, Child Support, and Transportation.' }
    ],
    2: [
        { key: 'w2_core_stability', title: 'Core Stability & Soft Skills Passed', description: 'Successfully completed CBT and workplace etiquette modules.' },
        { key: 'w2_dl_cs_action', title: 'Driver’s License / Child Support Steps Initiated', description: 'Proof of DMV fee schedule, payment plan, or court document filed.' },
        { key: 'w2_attendance', title: 'Attendance Standard Maintained', description: 'No more than 1 excused absence; all daily points requirements met.' },
        { key: 'w2_accountability', title: 'Classroom & Peer Accountability', description: 'Positive peer engagement and facilitator compliance.' }
    ],
    3: [
        { key: 'w3_resume_approved', title: 'Master Resume Built & Approved', description: 'Completed resume via Resume Builder meeting First Shift employer standards.' },
        { key: 'w3_financial_wellness', title: 'Financial & Budgeting Plan', description: 'Completed financial literacy module and personal spending plan.' },
        { key: 'w3_points_threshold', title: 'Minimum 85% Cumulative Points', description: 'Cumulative daily Apricot points at or above 85% benchmark.' },
        { key: 'w3_barrier_update', title: 'Active Barrier Resolution Check', description: 'Progress verified on housing, transport, or pending legal requirements.' }
    ],
    4: [
        { key: 'w4_mock_interview', title: 'Employer Mock Interview Passed', description: 'Demonstrated interview competency and job pitch presentation.' },
        { key: 'w4_job_applications', title: 'Active Applications Submitted (Min 3)', description: 'Submitted minimum 3 tailored job applications through Re-entry employer board.' },
        { key: 'w4_final_gate_signoff', title: 'Program Manager Final Gate Sign-off', description: 'All weekly criteria green; approved for job placement matching.' },
        { key: 'w4_drug_screen', title: 'Accountability / Drug Screen Clean', description: 'Required testing/compliance verified for job placement.' }
    ]
};

// Seed default criteria for a new user
function initUserGateCriteria(userId) {
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO gate_criteria (user_id, week_number, criterion_key, title, description, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    const tx = db.transaction(() => {
        for (let week = 1; week <= 4; week++) {
            for (const c of DEFAULT_GATE_CRITERIA[week]) {
                insertStmt.run(userId, week, c.key, c.title, c.description);
            }
        }
    });
    tx();
}

// Ensure default Admin / Program Manager exists
function seedDefaultAccounts() {
    const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('pm@firstshift.org');
    if (!existingAdmin) {
        const hash = bcrypt.hashSync('FirstShift2026!', 10);
        const result = db.prepare(`
            INSERT INTO users (name, email, phone, password_hash, role, track, location)
            VALUES (?, ?, ?, ?, 'program_manager', 'first_shift', 'Columbia')
        `).run('Program Manager', 'pm@firstshift.org', '803-555-0100', hash);
        console.log('Seeded default Program Manager: pm@firstshift.org / FirstShift2026!');
    }
}
seedDefaultAccounts();

module.exports = {
    db,
    DEFAULT_GATE_CRITERIA,
    initUserGateCriteria
};
