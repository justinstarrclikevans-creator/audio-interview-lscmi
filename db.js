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
    supabase_id TEXT,
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

CREATE TABLE IF NOT EXISTS health_wellness_screen (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER, vision_issues INTEGER, hearing_issues INTEGER, mobility_pain INTEGER, stamina_fatigue INTEGER, fine_motor_issues INTEGER, physical_notes TEXT, reading_writing_issues INTEGER, following_instructions_issues INTEGER, memory_organization_issues INTEGER, processing_time_issues INTEGER, cognitive_notes TEXT, primary_care_referral INTEGER, vocational_rehab_referral INTEGER, mental_health_referral INTEGER, job_search_adjustment INTEGER, immediate_next_step TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

    CREATE TABLE IF NOT EXISTS weekly_stability_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, participant_id INTEGER, new_sexual_convictions INTEGER, recent_major_drug_use INTEGER, housing_instability INTEGER, no_call_no_show INTEGER, transportation_breakdown INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);

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

-- Real-Time Two-Way Messaging Between Participants and Program Managers
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER,
    participant_id INTEGER NOT NULL,
    message_text TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(participant_id) REFERENCES users(id) ON DELETE CASCADE
);

-- First Shift Case Plan: Interactive Trigger Situations & Toolkit Tools per Domain
CREATE TABLE IF NOT EXISTS case_plan_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    pattern TEXT,
    trigger_situations TEXT, -- JSON array of string trigger situations
    toolkit_tools TEXT, -- JSON array of selected CBT tools
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, domain)
);

-- Job Hunting AI: Saved & Applied Jobs Pipeline per Participant
CREATE TABLE IF NOT EXISTS saved_job_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    job_title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston, SC',
    pay_rate TEXT,
    careers_url TEXT,
    status TEXT DEFAULT 'saved', -- 'saved', 'applied', 'interviewing', 'offered', 'hired'
    notes TEXT,
    applied_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Case Notes for Program Managers & Apricot Integration
CREATE TABLE IF NOT EXISTS case_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    author_id INTEGER,
    author_name TEXT NOT NULL,
    session_date DATE DEFAULT (DATE('now')),
    note_type TEXT DEFAULT 'Individual Session', -- 'Individual Session', 'Phone Contact', 'Court Update', 'Employer Contact', 'General Case Note'
    category TEXT DEFAULT 'Case Management', -- 'Case Management', 'Attendance/Points', 'Barriers & Stability', 'Job Readiness'
    content TEXT NOT NULL,
    apricot_exported INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Participant Time-Off Requests (48-Hour Notice Policy)
CREATE TABLE IF NOT EXISTS time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    requested_date DATE NOT NULL,
    reason TEXT NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'denied'
    pm_response_notes TEXT,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Participant CBT Module Worksheets & Interactive Submissions
CREATE TABLE IF NOT EXISTS cbt_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    module_number INTEGER NOT NULL,
    tool_key TEXT NOT NULL,
    responses_json TEXT NOT NULL,
    status TEXT DEFAULT 'completed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, module_number, tool_key)
);

-- Drug Screen Compliance & Laboratory Results per Participant
CREATE TABLE IF NOT EXISTS drug_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    test_date DATE NOT NULL,
    result TEXT DEFAULT 'negative', -- 'negative', 'positive', 'dilute', 'refused'
    substances_detected TEXT, -- JSON array or comma-separated detected substances
    notes TEXT,
    administered_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Case Management vs Briefcase Cross-Check Audit Reports
CREATE TABLE IF NOT EXISTS cm_briefcase_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    audit_date DATE DEFAULT (DATE('now')),
    discrepancies_json TEXT,
    verified_json TEXT,
    unaddressed_json TEXT,
    feedback_markdown TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Participant State Benefits Applications & Health Access (Welvista, Medicaid, SNAP, TANF)
CREATE TABLE IF NOT EXISTS participant_benefits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    benefit_type TEXT NOT NULL, -- 'welvista', 'medicaid', 'snap', 'tanf'
    status TEXT NOT NULL DEFAULT 'not_started', -- 'not_started', 'in_progress', 'submitted', 'approved', 'not_eligible'
    application_number TEXT,
    monthly_amount TEXT,
    renewal_date DATE,
    caseworker_contact TEXT,
    notes TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, benefit_type)
);
`);

// Safe column migrations for existing databases
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN stability_red_flags TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN director_override_by TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN reentry_status TEXT DEFAULT 'none';"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN has_reentry_plan INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN enrollment_date DATE;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN correction_notes TEXT;"); } catch(e) {}
try { db.exec("ALTER TABLE participant_profiles ADD COLUMN supabase_id TEXT;"); } catch(e) {}


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
        { key: 'snap_food_stamps', title: 'Food Stamps (SNAP) Enrolled / Verified' },
        { key: 'tanf_assistance', title: 'TANF Family Assistance (if eligible)' },
        { key: 'child_support_status', title: 'Child Support Contact/Status Reviewed' },
        { key: 'transportation_plan', title: 'Transportation Plan' },
        { key: 'housing_plan', title: 'Housing Plan / Stable Address' }
    ],
    employment_readiness: [
        { key: 'ferguson_aptitude', title: 'Ferguson Career Aptitude Test' },
        { key: 'career_interest', title: 'Career Interest Discussion' },
        { key: 'prof_email_created', title: 'Professional Email Created' },
        { key: 'resume_completed', title: 'Resume Completed' },
        { key: 'interview_prep', title: 'Mock Interview Prep Completed' },
        { key: 'work_clothing', title: 'Work Clothing / Steel Toe Boots Secured' }
    ],
    skillcat: [
        { key: 'skillcat_progress', title: 'SkillCat Progress' }
    ],
    health_wellness: [
        { key: 'medical_home', title: 'Primary Care Doctor Identified' },
        { key: 'vision_screen', title: 'Vision Screener Completed' },
        { key: 'dental_check', title: 'Dental Referral Made' },
        { key: 'mental_health_support', title: 'Mental Health / Counseling Established' },
        { key: 'substance_recovery', title: 'Recovery / MAT Support Active' },
        { key: 'prescriptions', title: 'Medication/Prescriptions Secured (Welvista)' }
    ],
    financial: [
        { key: 'budget_created', title: 'Personal Budget Created' },
        { key: 'credit_pulled', title: 'Credit Report Pulled & Reviewed' },
        { key: 'debt_plan', title: 'Debt Reduction Plan Initiated' },
        { key: 'savings_goal', title: 'Savings Goal Established' }
    ],
    career_planning: [
        { key: 'career_goal', title: 'Career Goal Identified' },
        { key: 'target_industry', title: 'Target Industry Identified' },
        { key: 'entry_job_goal', title: 'Entry-Level Job Goal Identified' },
        { key: 'next_credential_goal', title: 'Next Credential Goal Identified' },
        { key: 'education_plan', title: 'Education/Degree Plan (Optional)' }
    ]
};

// 4-Week Job Readiness Gate Criteria (Must-Haves to Qualify for Weeks 5–8 & Week 9 Placement)
const DEFAULT_GATE_CRITERIA = {
    1: [
        { key: 'g1_ssn', title: 'Social Security Card', description: 'Physical card, receipt from SSA, or appointment booked.' },
        { key: 'g1_birth_cert', title: 'Birth Certificate', description: 'Physical copy or appointment booked.' },
        { key: 'g1_main_goal', title: 'Main Goal Set', description: '90-day vision, improvement goals, and stability goals outlined.' },
        { key: 'g1_skillcat_intro', title: 'Completed SkillCat Intro', description: 'SkillCat intro module completed.' },
        { key: 'g1_skillcat_track', title: 'Chose SkillCat Track', description: 'Appropriate job placement track selected based on history and availability.' }
    ],
    2: [
        { key: 'g2_child_support', title: 'Child Support Plan Made', description: 'Cases reviewed and contact made with enforcement if applicable.' },
        { key: 'g2_housing', title: 'Stable Address / Housing', description: 'Living situation stable enough not to disrupt daily work routine in next 30-60 days.' },
        { key: 'g2_phone', title: 'Reliable Phone Number', description: 'Active phone with voicemail set up for employer contact.' },
        { key: 'g2_probation_conflicts', title: 'Probation / Legal Obligations', description: 'No probation meetings, court dates, or hours conflicting with standard work schedule.' },
        { key: 'g2_dmv', title: 'DMV License Check', description: 'Gone to DMV to find out why license is suspended (if applicable).' },
        { key: 'g2_email', title: 'Professional Email', description: 'Professional email address established.' },
        { key: 'g2_resume', title: 'Resume', description: 'Resume completed.' },
        { key: 'g2_skillcat_progress', title: 'Making Progress on SkillCat Track', description: 'Progress verified in SkillCat.' }
    ],
    3: [
        { key: 'g3_bank_account', title: 'Bank Account', description: 'Active account for direct deposit or temporary payroll card set up.' },
        { key: 'g3_skillcat_progress', title: 'Making Progress on SkillCat Track', description: 'Progress verified in SkillCat.' }
    ],
    4: [
        { key: 'g4_work_gear', title: 'Work Tools & Clothing', description: 'Required items (steel-toe boots, non-slip shoes, pants, tools) obtained for desired job.' },
        { key: 'g4_transportation', title: 'Transportation Plan', description: 'Reliable, verified way to get to work daily (car, bus pass, carpool, budget).' },
        { key: 'g4_budget', title: 'Budget Completed', description: 'Personal budget outlined.' },
        { key: 'g4_savings', title: 'Savings Goals', description: 'Savings goals established.' },
        { key: 'g4_6mo_plan', title: '6-Month Job Plan Created', description: 'Short-term employment roadmap.' },
        { key: 'g4_career_goal', title: 'Long-Term Career Goal Identified', description: 'Long-term career goals mapped out.' },
        { key: 'g4_skillcat_progress', title: 'Making Progress on SkillCat Track', description: 'Progress verified in SkillCat.' }
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

// Complete Benefit Program Definitions & Official SC Portals
const BENEFIT_PROGRAMS = {
    welvista: {
        key: 'welvista',
        name: 'Welvista Medication Assistance Program',
        badgeTitle: 'Free Prescription Meds',
        category: 'Prescription Assistance',
        shortDesc: '100% free prescription maintenance medications delivered to your door for uninsured SC residents.',
        phone: '1-800-983-3339',
        localPhone: '(803) 933-9183',
        address: '270 Stoneridge Dr, Suite 200, Columbia, SC 29210 (Statewide mail delivery)',
        websiteUrl: 'https://welvista.org',
        applyUrl: 'https://welvista.org/patient-services/',
        pdfUrl: 'https://welvista.org/wp-content/uploads/2023/10/Welvista-Patient-Application-English-Rev-10.2023.pdf',
        eligibility: 'Uninsured SC resident, no Medicaid/Medicare Part D prescription coverage, household income ≤ 300% Federal Poverty Level.',
        requiredDocs: [
            'Completed & signed Welvista Patient Application Form',
            'Valid South Carolina Driver\'s License or State ID',
            'Proof of Income (2 consecutive paystubs, or Turn90 Zero-Income Affidavit / Verification Letter)',
            'Valid doctor\'s prescription (written paper script or e-script sent by doctor directly to Welvista Pharmacy)'
        ],
        steps: [
            'Complete the 1-page Welvista application form.',
            'Attach your SC State ID and Turn90 income or zero-income verification letter.',
            'Have your doctor or clinic (e.g. Fetter Health Care, Free Medical Clinic) send your prescriptions to Welvista Pharmacy.',
            'Submit by mail, fax (803-933-9184), or online portal. Medications are mailed in 90-day supplies with zero copay!'
        ],
        briefcaseSyncKey: 'welvista_referral'
    },
    medicaid: {
        key: 'medicaid',
        name: 'South Carolina Healthy Connections Medicaid',
        badgeTitle: 'SC Medicaid Health Insurance',
        category: 'Comprehensive Health Insurance',
        shortDesc: 'Full health coverage for doctor visits, hospital care, mental health, dental, and prescription drugs through SCDHHS.',
        phone: '1-888-549-0820',
        localPhone: '1-888-549-0820 (TTY: 1-888-842-3620)',
        address: 'SC Department of Health and Human Services (SCDHHS) / Local County Offices',
        websiteUrl: 'https://scdhhs.gov',
        applyUrl: 'https://apply.scdhhs.gov',
        pdfUrl: 'https://www.scdhhs.gov/getting-started',
        eligibility: 'South Carolina residents with low household income, parents/caregivers of minors, pregnant women, disabled individuals, or individuals in transitional employment.',
        requiredDocs: [
            'Government-issued Photo ID (SC Driver\'s License or State ID)',
            'Social Security Number',
            'Proof of SC Residency (lease, utility bill, mail, or shelter letter)',
            'Proof of Income for the last 4 weeks (paystubs or Turn90 stipend statement)'
        ],
        steps: [
            'Create an account at apply.scdhhs.gov (fastest, available 24/7) or call 1-888-549-0820.',
            'Enter personal information, household members, and income details.',
            'Upload or mail copies of your SC ID and proof of income.',
            'Track your application. Once approved, select a managed care health plan (e.g., First Choice, Absolute Total Care, Molina, Healthy Blue).'
        ],
        briefcaseSyncKey: 'health_insurance'
    },
    snap: {
        key: 'snap',
        name: 'South Carolina SNAP (Food Stamps)',
        badgeTitle: 'SNAP Food Stamps (EBT)',
        category: 'Nutrition & Grocery Assistance',
        shortDesc: 'Monthly funds loaded onto an EBT card to purchase healthy food and groceries across South Carolina.',
        phone: '1-800-616-1309',
        localPhone: '1-888-544-7727 (DSS Connect)',
        address: 'SC Department of Social Services (SCDSS) / Local County Offices',
        websiteUrl: 'https://dss.sc.gov/assistance-programs/snap/',
        applyUrl: 'https://benefitsportal.dss.sc.gov/',
        pdfUrl: 'https://dss.sc.gov/media/2513/dss-form-3800.pdf',
        eligibility: 'SC residents meeting gross and net income limits. Individuals with prior criminal records or drug convictions ARE ELIGIBLE in South Carolina as long as they comply with supervision and treatment if ordered.',
        requiredDocs: [
            'Photo Identification (SC ID, DL, or Mugshot/DOC ID)',
            'Social Security Numbers for all household applicants',
            'Proof of Address / Shelter Residence',
            'Proof of Income (or Turn90 zero-income / stipend verification letter)'
        ],
        steps: [
            'Apply online at benefitsportal.dss.sc.gov or submit Form 3800 at your county DSS office.',
            'If monthly income is under $150 and cash on hand is under $100, request EXPEDITED SNAP (benefits issued within 7 days!).',
            'Complete your phone interview with a DSS caseworker when scheduled.',
            'Receive your SC EBT card in the mail and activate your PIN to purchase groceries.'
        ],
        briefcaseSyncKey: 'snap_food_stamps'
    },
    tanf: {
        key: 'tanf',
        name: 'South Carolina TANF (Cash Assistance)',
        badgeTitle: 'TANF Family Cash Assistance',
        category: 'Cash Assistance & Family Support',
        shortDesc: 'Temporary monthly cash assistance and supportive training funds for low-income families with dependent children.',
        phone: '1-800-616-1309',
        localPhone: '1-800-616-1309 (SC DSS Client Special Services)',
        address: 'SC Department of Social Services (SCDSS)',
        websiteUrl: 'https://dss.sc.gov/assistance-programs/tanf/',
        applyUrl: 'https://benefitsportal.dss.sc.gov/',
        pdfUrl: 'https://dss.sc.gov/media/2513/dss-form-3800.pdf',
        eligibility: 'Families with dependent children under age 18 (or under 19 if attending secondary school full-time) or pregnant women. Turn90 training hours count toward TANF work participation requirements!',
        requiredDocs: [
            'Photo ID for the adult applicant',
            'Birth Certificates and SSNs for all children in the household',
            'Proof of Income, child support, or zero income',
            'Proof of school enrollment for school-age children'
        ],
        steps: [
            'Submit an application online at benefitsportal.dss.sc.gov (can apply for SNAP and TANF together).',
            'Complete a family intake interview with your county DSS case worker.',
            'Provide documentation for dependent children and Turn90 training enrollment.',
            'Monthly cash benefits are deposited to your EBT card or bank account.'
        ],
        briefcaseSyncKey: 'tanf_assistance'
    }
};

// Initialize default briefcase items, gate criteria, and benefits for a participant
function initParticipantBriefcase(userId) {
    const insertBriefcase = db.prepare(`
        INSERT OR IGNORE INTO briefcase_items (user_id, domain, item_key, title, status)
        VALUES (?, ?, ?, ?, 'pending')
    `);

    const insertGate = db.prepare(`
        INSERT OR IGNORE INTO gate_criteria (user_id, week_number, criterion_key, title, description, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    const insertBenefit = db.prepare(`
        INSERT OR IGNORE INTO participant_benefits (user_id, benefit_type, status)
        VALUES (?, ?, 'not_started')
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
        // Seed 4 benefit programs
        for (const bKey of ['welvista', 'medicaid', 'snap', 'tanf']) {
            insertBenefit.run(userId, bKey);
        }
    });
    tx();
}

function syncBenefitToBriefcase(userId, benefitType, status, notes = '') {
    try {
        if (status === 'approved') {
            if (benefitType === 'welvista') {
                db.prepare(`
                    UPDATE briefcase_items 
                    SET status = 'green', notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND item_key = 'welvista_referral'
                `).run(notes || 'Verified Active Welvista Prescription Assistance', userId);
            } else if (benefitType === 'medicaid') {
                db.prepare(`
                    UPDATE briefcase_items 
                    SET status = 'green', notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND item_key = 'health_insurance'
                `).run(notes || 'Verified Active SC Healthy Connections Medicaid', userId);
            } else if (benefitType === 'snap') {
                db.prepare(`
                    UPDATE briefcase_items 
                    SET status = 'green', notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND item_key = 'snap_food_stamps'
                `).run(notes || 'Verified Active SNAP Food Stamps / EBT', userId);
            } else if (benefitType === 'tanf') {
                db.prepare(`
                    UPDATE briefcase_items 
                    SET status = 'green', notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND item_key = 'tanf_assistance'
                `).run(notes || 'Verified Active TANF Family Cash Assistance', userId);
            }
        }
    } catch (e) {
        console.error('Error syncing benefit to briefcase:', e);
    }
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

    // Sync all participants with latest briefcase, gate criteria, and benefits
    const participants = db.prepare("SELECT id FROM users WHERE role = 'participant'").all();
    participants.forEach(p => initParticipantBriefcase(p.id));
}
seedDefaultAccounts();

module.exports = {
    db,
    BRIEFCASE_DOMAINS,
    DEFAULT_GATE_CRITERIA,
    STABILITY_STEP_DOWN_TRIGGERS,
    BENEFIT_PROGRAMS,
    initParticipantBriefcase,
    syncBenefitToBriefcase
};
