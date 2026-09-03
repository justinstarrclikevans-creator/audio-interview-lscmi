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

db.pragma('journal_mode = WAL');

// Comprehensive schema initialization
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant', -- 'participant', 'program_manager', 'director', 'admin'
    track TEXT NOT NULL DEFAULT 'first_shift', -- 'first_shift', 'reentry_nav'
    location TEXT DEFAULT 'Charleston',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS participant_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    current_gate INTEGER DEFAULT 1, -- 1 to 4 (Within the 8-week First Shift program)
    w9_status TEXT DEFAULT 'pending', -- 'pending', 'submitted', 'verified'
    dl_status TEXT DEFAULT 'unknown',
    dl_notes TEXT,
    child_support_status TEXT DEFAULT 'unknown',
    child_support_notes TEXT,
    housing_status TEXT DEFAULT 'stable',
    substance_status TEXT DEFAULT 'none',
    mental_health_status TEXT DEFAULT 'none',
    transportation_status TEXT DEFAULT 'bus',
    court_dates TEXT,
    overall_status TEXT DEFAULT 'active', -- 'active', 'reentry_nav_stabilizing', 'completed', 'terminated'
    stability_red_flags TEXT, -- JSON array of active stability triggers
    director_override INTEGER DEFAULT 0, -- 1 if PD/ED approved exception
    director_override_notes TEXT,
    director_override_by TEXT,
    termination_reason TEXT,
    termination_date DATE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Complete Briefcase Domain Items per Participant
CREATE TABLE IF NOT EXISTS briefcase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL, -- 'core_stability', 'employment_readiness', 'credentials', 'health_wellness', 'financial', 'career_planning'
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'green' (completed/verified), 'red' (barrier), 'pending'
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, item_key)
);

-- Weekly Case Planning Reviews (The 4 Pillars)
CREATE TABLE IF NOT EXISTS weekly_case_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL, -- Week 1 to 8
    reviewed_by TEXT NOT NULL,
    
    -- Pillar 1: Stability Check
    has_stability_issues INTEGER DEFAULT 0,
    stability_issues_details TEXT,
    can_meet_rapidly INTEGER DEFAULT 1,
    needs_more_resources INTEGER DEFAULT 0,
    resource_notes TEXT,

    -- Pillar 2: First Shift Progress
    attendance_satisfactory INTEGER DEFAULT 1,
    ability_learn_q2 INTEGER DEFAULT 1,
    removing_employment_barriers INTEGER DEFAULT 1,
    cbt_homework_completed INTEGER DEFAULT 1,
    cbt_discussion_active INTEGER DEFAULT 1,
    cbt_roleplay_effort INTEGER DEFAULT 1,
    cbt_notes TEXT,

    -- Pillar 3: Job Plan & Feasibility
    transportation_viable INTEGER DEFAULT 1,
    qualified_for_desired_jobs INTEGER DEFAULT 1,
    no_disqualifying_convictions INTEGER DEFAULT 1,
    schedule_supervision_aligned INTEGER DEFAULT 1,
    no_psf_overnight_issues INTEGER DEFAULT 1,
    job_match_notes TEXT,

    -- Pillar 4: Case Decision
    case_decision TEXT DEFAULT 'continue_first_shift', -- 'continue_first_shift', 'step_down_reentry_nav', 'director_override', 'ready_placement'
    decision_rationale TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gate_criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL, -- 1, 2, 3, 4
    criterion_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending', -- 'green', 'red', 'pending'
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
    attendance_status TEXT DEFAULT 'present', -- 'present', 'tardy', 'excused', 'unexcused', 'ncns' (No Call No Show)
    notes TEXT,
    imported_from_apricot INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    resume_data_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reentry_case_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    participant_name TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston',
    stability_status TEXT DEFAULT 'stable', -- 'stable', 'at_risk', 'immediate_triage_needed'
    stated_goals TEXT,
    identified_needs TEXT, -- JSON array
    living_situation TEXT,
    legal_status TEXT,
    detected_flags TEXT, -- JSON array
    top_criminogenic_domains TEXT, -- JSON array
    staff_case_plan_md TEXT,
    participant_guide_md TEXT,
    recommended_referrals TEXT, -- JSON array
    matched_employers TEXT, -- JSON array
    staff_plan_docx TEXT,
    staff_plan_pdf TEXT,
    participant_guide_docx TEXT,
    participant_guide_pdf TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Safe column migrations for existing databases
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN stability_red_flags TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override_by TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN reentry_status TEXT DEFAULT 'none';"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN has_reentry_plan INTEGER DEFAULT 0;"); } catch(e) {}


// The Official Briefcase Domains & Checklist Items
const BRIEFCASE_DOMAINS = {
    core_stability: [
        { key: 'state_id', title: 'State ID' },
        { key: 'ss_card', title: 'Social Security Card' },
        { key: 'birth_cert', title: 'Birth Certificate' },
        { key: 'drivers_license', title: 'Driver\'s License' },
        { key: 'reliable_phone', title: 'Reliable Phone Number' },
        { key: 'prof_email', title: 'Professional Email Address' },
        { key: 'library_card', title: 'Library Card' },
        { key: 'bank_account', title: 'Bank Account' },
        { key: 'child_support_status', title: 'Child Support Contact/Status Reviewed' },
        { key: 'transportation_plan', title: 'Transportation Plan' },
        { key: 'housing_plan', title: 'Housing Plan / Stable Address' }
    ],
    employment_readiness: [
        { key: 'ferguson_aptitude', title: 'Ferguson Career Aptitude Test' },
        { key: 'career_interest', title: 'Career Interest Discussion' },
        { key: 'prof_email_created', title: 'Professional Email Created' },
        { key: 'resume_completed', title: 'Resume Completed' },
        { key: 'workplace_references', title: 'Workplace References Identified' },
        { key: 'interview_practice', title: 'Interview Practice Completed' },
        { key: 'interview_clothing', title: 'Interview Clothing' },
        { key: 'work_tools_clothing', title: 'Work Tools / Clothing' },
        { key: 'job_apps_submitted', title: 'Job Applications Submitted' }
    ],
    credentials: [
        { key: 'osha_10', title: 'OSHA-10 Certification' },
        { key: 'forklift_cert', title: 'Forklift Certification' },
        { key: 'home_depot_pro', title: 'Home Depot Path to Pro' },
        { key: 'drywall_training', title: 'Drywall' },
        { key: 'electrical_training', title: 'Electrical' },
        { key: 'general_construction', title: 'General Construction' },
        { key: 'hvac_training', title: 'HVAC' },
        { key: 'paint_training', title: 'Paint' },
        { key: 'plumbing_training', title: 'Plumbing' },
        { key: 'welding_training', title: 'Welding' },
        { key: 'refrigeration_training', title: 'Refrigeration' }
    ],
    health_wellness: [
        { key: 'health_insurance', title: 'Health Insurance / Coverage Plan' },
        { key: 'welvista_referral', title: 'Welvista Referral Reviewed' },
        { key: 'primary_care_visit', title: 'Primary Care / Doctor Visit' },
        { key: 'vision_appointment', title: 'Vision Appointment' },
        { key: 'prescription_needs', title: 'Prescription Needs Reviewed' },
        { key: 'mental_health_referral', title: 'Mental Health Referral (if requested)' },
        { key: 'substance_recovery_plan', title: 'Substance Recovery Support Plan (if applicable)' }
    ],
    financial: [
        { key: 'bank_account_opened', title: 'Bank Account Opened' },
        { key: 'budget_worksheet', title: 'Budget Worksheet Completed' },
        { key: 'paycheck_taxes_understanding', title: 'Understanding of Paychecks & Taxes' },
        { key: 'savings_goal', title: 'Savings Goal Identified' },
        { key: 'credit_report', title: 'Credit Report Reviewed' },
        { key: 'child_support_questions', title: 'Child Support Questions Reviewed' },
        { key: 'probation_obligations', title: 'Probation Obligations Reviewed' }
    ],
    career_planning: [
        { key: 'career_goal', title: 'Career Goal Identified' },
        { key: 'target_industry', title: 'Target Industry Identified' },
        { key: 'entry_job_goal', title: 'Entry-Level Job Goal Identified' },
        { key: 'next_credential_goal', title: 'Next Credential Goal Identified' },
        { key: 'six_month_goal', title: '6-Month Goal Written' },
        { key: 'long_term_wage_goal', title: 'Long-Term Wage Goal Identified' }
    ]
};

// 4-Week Job Readiness Gate Criteria (Must-Haves to Qualify for Weeks 5–8 & Week 9 Placement)
const DEFAULT_GATE_CRITERIA = {
    1: [
        { key: 'w1_attendance', title: 'Satisfactory Week 1 Attendance', description: 'Zero unexcused absences and zero NCNS.' },
        { key: 'w1_interview', title: 'LS/CMI Assessment Interview Completed', description: '158-question audio interview recorded and draft scoring generated.' },
        { key: 'w1_w9_id', title: 'Form W-9 & Primary ID Submitted', description: 'Digital W-9 completed and State ID/Birth Certificate/SS card uploaded.' },
        { key: 'w1_goal_email', title: '90-Day Goal & Professional Email Created', description: 'Baseline 90-day motivation worksheet and professional email handle established.' },
        { key: 'w1_stability_screen', title: 'Initial Stability Screen Clear', description: 'No immediate disqualifying sex offenses, PROs, or acute homelessness.' }
    ],
    2: [
        { key: 'w2_cbt_homework', title: 'CBT Modules 1-2 & Homework Active', description: 'Active in class discussion, completing worksheets, and effort in role plays.' },
        { key: 'w2_dl_cs_plan', title: 'Driver\'s License & Child Support Steps Active', description: 'SCDMV fee plan identified or court review paperwork initiated.' },
        { key: 'w2_health_vision', title: 'Health, Vision & Prescription Screen', description: 'Welvista referral reviewed, vision appointment set, and maintenance meds confirmed.' },
        { key: 'w2_q2_learning', title: 'Satisfactory Q2 Concept Learning', description: 'Demonstrating ability to learn trades and workplace standards.' },
        { key: 'w2_attendance', title: 'Zero NCNS Attendance Compliance', description: 'Points meet 85%+ benchmark with zero unexcused no-call-no-shows.' }
    ],
    3: [
        { key: 'w3_resume_approved', title: 'Master Resume Completed in Builder', description: 'Approved resume with professional background explanation pitch formatted.' },
        { key: 'w3_references_interview', title: '2-3 References & Interview Practice Completed', description: 'Workplace references verified and common interview questions practiced out loud.' },
        { key: 'w3_cbt_conflict', title: 'Workplace Conflict & Communication CBT Passed', description: 'Demonstrated emotional regulation and problem-solving framework.' },
        { key: 'w3_points_threshold', title: 'Cumulative 85%+ Points Benchmark', description: 'Daily Apricot points threshold sustained.' },
        { key: 'w3_barrier_resolution', title: 'Active Barrier Removal Progress', description: 'Concrete steps documented on transportation, housing, and court obligations.' }
    ],
    4: [
        { key: 'w4_bank_direct_deposit', title: 'Bank Account & Direct Deposit Ready', description: 'Active bank account or payroll card verified for employment direct deposit.' },
        { key: 'w4_work_gear', title: 'Work Clothing & Boots Verified', description: 'Workplace attire and steel-toe boots/PPE ready for 1st shift job placement.' },
        { key: 'w4_transport_transit', title: 'Independent Transportation Verified', description: 'Reachable daily to manufacturing job corridors without program rideshare assistance.' },
        { key: 'w4_drug_compliance', title: 'Substance & Accountability Compliance', description: 'Clean drug/alcohol screen; active recovery engagement if applicable.' },
        { key: 'w4_gate_triage', title: 'Week 4 Gate Placement Approval', description: 'Final staff triage: Approved for Weeks 5–8 & Week 9 Placement vs. Step-Down.' }
    ]
};

// Automatic Step-Down Stability Triggers (Moving someone out of First Shift into Re-entry Nav for Stabilization)
const STABILITY_STEP_DOWN_TRIGGERS = [
    { key: 'undisclosed_sex_conviction', title: 'Undisclosed Sexual Conviction', description: 'Limits employer job placement opportunities.' },
    { key: 'permanent_restraining_order', title: 'Permanent Restraining Order (PRO)', description: 'Active PRO preventing placement site access.' },
    { key: 'recent_major_drug_use', title: 'Recent Major Drug Use / Failed Screen', description: 'Failed drug test or breathalyzer requiring active stabilization.' },
    { key: 'housing_crisis', title: 'Housing Instability (Motel / Homeless / Eviction)', description: 'Living in motel, shelter, or facing eviction with no ability to pay.' },
    { key: 'new_arrest', title: 'New Arrest / Legal Escalation', description: 'New charge or arrest while in program.' },
    { key: 'two_unplanned_absences', title: 'Two or More Unplanned Absences', description: 'Attendance benchmark broken.' },
    { key: 'any_ncns', title: 'ANY No Call No Show (NCNS)', description: 'Critical attendance violation.' },
    { key: 'moving_out_of_area', title: 'Moving Out of Area (< 6 Months)', description: 'Cannot fulfill long-term placement commitment.' },
    { key: 'court_mandate_conflict', title: 'Court Mandate Working Hours Conflict', description: 'Daily/multi-day probation/court mandates during 1st shift.' },
    { key: 'childcare_loss', title: 'Sudden Childcare Loss', description: 'No immediate backup provider available for multi-day schedule.' },
    { key: 'transportation_collapse', title: 'Total Transportation Collapse', description: 'Vehicle breakdown or unfeasible public transit with no rapid fix.' },
    { key: 'mental_health_crisis', title: 'Acute Mental Health Crisis / Hospitalization', description: 'Severe psychiatric escalation or impairment in group.' },
    { key: 'physical_health_emergency', title: 'Physical Health Emergency / Strict Rest', description: 'Severe injury or medical procedure limiting mobility.' }
];

// Initialize default briefcase items & gate criteria for a new participant
function initParticipantBriefcase(userId) {
    const insertBriefcase = db.prepare(`
        INSERT OR IGNORE INTO briefcase_items (user_id, domain, item_key, title, status)
        VALUES (?, ?, ?, ?, 'pending')
    `);

    const insertGate = db.prepare(`
        INSERT OR IGNORE INTO gate_criteria (user_id, week_number, criterion_key, title, description, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    const tx = db.transaction(() => {
        // Seed Briefcase domains
        for (const [domain, items] of Object.entries(BRIEFCASE_DOMAINS)) {
            for (const item of items) {
                insertBriefcase.run(userId, domain, item.key, item.title);
            }
        }
        // Seed 4-week gate criteria
        for (let week = 1; week <= 4; week++) {
            for (const c of DEFAULT_GATE_CRITERIA[week]) {
                insertGate.run(userId, week, c.key, c.title, c.description);
            }
        }
    });
    tx();
}

function seedDefaultAccounts() {
    const hash = bcrypt.hashSync('T90dashboard', 10);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('staff@turnninety.com');
    if (!existing) {
        db.prepare(`
            INSERT INTO users (name, email, phone, password_hash, role, track, location)
            VALUES ('Turn90 Staff', 'staff@turnninety.com', '843-555-0190', ?, 'program_manager', 'first_shift', 'Charleston')
        `).run(hash);
        console.log('Seeded staff account: staff@turnninety.com');
    } else {
        db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hash, 'staff@turnninety.com');
    }

    // Sync all participants with latest briefcase and gate criteria
    const participants = db.prepare("SELECT id FROM users WHERE role = 'participant'").all();
    participants.forEach(p => initParticipantBriefcase(p.id));
}
seedDefaultAccounts();

module.exports = {
    db,
    BRIEFCASE_DOMAINS,
    DEFAULT_GATE_CRITERIA,
    STABILITY_STEP_DOWN_TRIGGERS,
    initParticipantBriefcase
};
