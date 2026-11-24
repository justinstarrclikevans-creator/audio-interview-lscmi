const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const dataDir = path.join(__dirname, '..', 'data');
const participantsRootDir = path.join(dataDir, 'participants');
const bundledSupervisionDir = path.join(__dirname, '..', 'supervision_pipeline');
const externalSupervisionDir = path.resolve(__dirname, '..', '..', '..', '..', 'pipelines', 'supervision-report');
const supervisionPipelineDir = fs.existsSync(bundledSupervisionDir) ? bundledSupervisionDir : externalSupervisionDir;

if (!fs.existsSync(participantsRootDir)) {
    fs.mkdirSync(participantsRootDir, { recursive: true });
}

// Ensure SQLite tables exist for Unified Gate-Free Briefcase, Screening Consultations, Action Plan Feedback Loop, and Voice Profiles
db.exec(`
CREATE TABLE IF NOT EXISTS unified_briefcases (
    participant_key TEXT PRIMARY KEY,
    user_id INTEGER,
    client_id INTEGER,
    participant_name TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston',
    track TEXT DEFAULT 'reentry_nav',
    has_chronic_health_condition TEXT DEFAULT 'no',
    dl_is_suspended TEXT DEFAULT 'no',
    child_support_applicable TEXT DEFAULT 'no',
    waitlist_ready INTEGER DEFAULT 0,
    waitlist_met_count INTEGER DEFAULT 0,
    briefcase_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS screening_consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_key TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston',
    age INTEGER,
    release_timeframe TEXT,
    eligibility_decision TEXT NOT NULL, -- 'first_shift_ready', 'first_shift_waitlist', 'reentry_navigation', 'resource_coordination'
    ineligibility_reason TEXT,
    consultation_data_json TEXT NOT NULL,
    summary_markdown TEXT,
    created_by TEXT DEFAULT 'Turn90 Staff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_plan_feedback_loops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_key TEXT NOT NULL,
    participant_name TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston',
    agreement_status TEXT NOT NULL DEFAULT 'agreed', -- 'agreed', 'disagreed_pending_loop', 'resolved_via_feedback_loop'
    disagreed_target TEXT,
    participant_objection_quote TEXT,
    staff_pivot_strategy TEXT, -- 'switched_target', 'offered_tool_options', 'values_alignment', 'splashmap_redesign'
    agreed_replacement_target TEXT,
    selected_toolkit_tool TEXT,
    revised_action_plan_md TEXT,
    logged_by TEXT DEFAULT 'Turn90 Staff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voice_profiles (
    profile_id TEXT PRIMARY KEY,
    person_type TEXT NOT NULL, -- 'staff' or 'participant'
    name TEXT NOT NULL,
    location TEXT DEFAULT 'Charleston',
    role TEXT,
    source_type TEXT DEFAULT '30s_script', -- '30s_script' or 'lscmi_interview'
    audio_file_path TEXT,
    duration_seconds REAL DEFAULT 30,
    acoustic_notes TEXT,
    enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// ============================================================================
// UNIFIED SINGLE-DOCUMENT BRIEFCASE SCHEMA (NO GATES, ALL DROPDOWNS & OPTIONS)
// ============================================================================
const UNIFIED_BRIEFCASE_SCHEMA = {
    waitlist_requirements: [
        {
            key: 'state_id_or_dl',
            number: 1,
            title: '1. State ID or Driver\'s License (DL)',
            required_for_waitlist: true,
            options: [
                { value: 'valid_dl', label: 'Valid Driver\'s License Verified', ready: true },
                { value: 'valid_state_id', label: 'Valid State ID Verified (No DL)', ready: true },
                { value: 'dl_suspended_has_state_id', label: 'DL Suspended (Has Valid State ID)', ready: true },
                { value: 'applied_receipt', label: 'Applied at DMV — Temporary Receipt in Hand', ready: false },
                { value: 'dl_suspended_no_id', label: 'DL Suspended & No State ID', ready: false },
                { value: 'missing', label: 'Missing — Needs State ID / DL', ready: false }
            ],
            default_value: 'missing'
        },
        {
            key: 'ss_card',
            number: 2,
            title: '2. Social Security Card',
            required_for_waitlist: true,
            options: [
                { value: 'verified_card', label: 'Physical Social Security Card Verified', ready: true },
                { value: 'verified_ssa_receipt', label: 'Official SSA Replacement Receipt Verified', ready: true },
                { value: 'applied_pending', label: 'Applied / SSA Appointment Scheduled', ready: false },
                { value: 'missing', label: 'Missing — Needs Social Security Card', ready: false }
            ],
            default_value: 'missing'
        },
        {
            key: 'birth_certificate',
            number: 3,
            title: '3. Birth Certificate',
            required_for_waitlist: true,
            options: [
                { value: 'verified_copy', label: 'Certified Birth Certificate Verified', ready: true },
                { value: 'ordered_in_transit', label: 'Ordered from Vital Records / In Transit', ready: false },
                { value: 'missing', label: 'Missing — Needs Birth Certificate', ready: false }
            ],
            default_value: 'missing'
        },
        {
            key: 'chronic_health_and_meds',
            number: 4,
            title: '4. Chronic Health Issues Treated &/or Access to Necessary Daily Medications',
            required_for_waitlist: true,
            conditional_controller: 'has_chronic_health_condition',
            conditional_note: 'CRITICAL RULE: Do NOT ask if participant needs medical appointments if they have no chronic health conditions requiring one.',
            options: [
                { value: 'no_chronic_conditions_na', label: 'No Chronic Health Conditions (Medical Appointments & Daily Meds Not Needed — N/A)', ready: true, sets_controller: 'no' },
                { value: 'treated_and_has_daily_meds', label: 'Has Chronic Condition — Treated & Has Steady Access to Daily Medications', ready: true, sets_controller: 'yes' },
                { value: 'needs_daily_med_access', label: 'Has Chronic Condition — Needs Daily Medication Refill / Welvista Enrollment', ready: false, sets_controller: 'yes' },
                { value: 'needs_medical_appointment', label: 'Has Chronic Condition — Untreated / Needs Medical Appointment', ready: false, sets_controller: 'yes' }
            ],
            default_value: 'no_chronic_conditions_na'
        },
        {
            key: 'stable_housing',
            number: 5,
            title: '5. Stable Address / Housing',
            required_for_waitlist: true,
            options: [
                { value: 'stable_verified', label: 'Stable Housing / Lease / Family Home Verified', ready: true },
                { value: 'transitional_verified', label: 'Approved Transitional / Recovery Housing Verified', ready: true },
                { value: 'temporary_unstable', label: 'Temporary / Couch Surfing (Stabilize in Reentry Navigation)', ready: false },
                { value: 'unhoused_shelter', label: 'Unhoused / Emergency Shelter / Motel (Stabilize in Reentry Navigation)', ready: false }
            ],
            default_value: 'stable_verified'
        },
        {
            key: 'reliable_phone',
            number: 6,
            title: '6. Reliable Phone Number',
            required_for_waitlist: true,
            options: [
                { value: 'active_verified', label: 'Active & Reliable Phone Number Verified (Voicemail Working)', ready: true },
                { value: 'wifi_only', label: 'Wi-Fi / App Number Only (Needs Reliable Cellular Service)', ready: false },
                { value: 'no_phone', label: 'No Phone / Disconnected', ready: false }
            ],
            default_value: 'active_verified'
        },
        {
            key: 'dmv_suspended_inquiry',
            number: 7,
            title: '7. Gone to DMV to Figure Out Why DL is Suspended',
            required_for_waitlist: true,
            conditional_controller: 'dl_is_suspended',
            options: [
                { value: 'not_applicable_valid', label: 'Not Applicable (DL Valid or Not Suspended)', ready: true },
                { value: 'completed_dmv_inquiry', label: 'Completed DMV Inquiry — Suspension Reason & Reinstatement Plan Obtained', ready: true },
                { value: 'dmv_visit_scheduled', label: 'DMV Visit Scheduled / Pending Inquiry', ready: false },
                { value: 'needs_dmv_visit', label: 'DL Suspended — Has Not Gone to DMV Yet', ready: false }
            ],
            default_value: 'not_applicable_valid'
        },
        {
            key: 'child_support_contact',
            number: 8,
            title: '8. Contact Made with Child Support (if applicable)',
            required_for_waitlist: true,
            conditional_controller: 'child_support_applicable',
            options: [
                { value: 'not_applicable', label: 'Not Applicable (No Child Support Case / Order)', ready: true },
                { value: 'contact_made_compliant', label: 'Contact Made with DSS Child Support & Compliance Plan Active', ready: true },
                { value: 'current_paid_up', label: 'Current / Paid Up (Verified)', ready: true },
                { value: 'needs_contact', label: 'Applicable — Needs Contact with Child Support / Unaddressed Arrears', ready: false }
            ],
            default_value: 'not_applicable'
        },
        {
            key: 'supervision_information',
            number: 9,
            title: '9. Supervision Information (Probation / Parole / Pending Charges)',
            required_for_waitlist: true,
            options: [
                { value: 'not_under_supervision', label: 'Not Under Supervision (Maxed Out / No Active Supervision or Pending Charges)', ready: true },
                { value: 'active_logged_no_conflict', label: 'Active Supervision — Officer Info, Schedule & Conditions Logged (No Work Conflict)', ready: true },
                { value: 'pending_charges_cleared', label: 'Pending Charges — Written PO/PD Reassurance Received (Court Will Not Block Work)', ready: true },
                { value: 'missing_or_conflict', label: 'Missing Supervision Info or Unresolved Court / Work Schedule Conflict', ready: false }
            ],
            default_value: 'active_logged_no_conflict'
        }
    ],
    employment_and_pathways: [
        {
            key: 'skillcat_pathway',
            title: 'SkillCat Trade Pathway',
            options: [
                { value: 'HVAC', label: 'HVAC Pathway (EPA 608 & HVAC Fundamentals)' },
                { value: 'Electrical', label: 'Electrical Pathway (Electrical Theory, Wiring & Diagnostics)' },
                { value: 'Plumbing', label: 'Plumbing Pathway (Piping, Fixtures & Maintenance)' },
                { value: 'Facilities_Maintenance', label: 'Facilities & Apartment Maintenance Pathway' },
                { value: 'Commercial_Safety', label: 'Commercial & Industrial Safety (OSHA) Pathway' },
                { value: 'Unassigned', label: 'Pathway Not Yet Selected' }
            ],
            default_value: 'HVAC'
        },
        {
            key: 'skillcat_progress_status',
            title: 'SkillCat Weekly Progress Status',
            options: [
                { value: 'on_track', label: 'On Track (Active Weekly Module Progress)' },
                { value: 'ahead', label: 'Ahead of Target Pace' },
                { value: 'stalled_flagged', label: 'Stalled — 0 Modules Completed This Week (Flagged)' },
                { value: 'not_started', label: 'Not Started' }
            ],
            default_value: 'not_started'
        },
        {
            key: 'resume_and_email',
            title: 'Resume & Professional Email',
            options: [
                { value: 'completed', label: 'Resume & Professional Email Completed' },
                { value: 'in_progress', label: 'Draft in Progress' },
                { value: 'not_started', label: 'Not Started' }
            ],
            default_value: 'not_started'
        },
        {
            key: 'w9_and_banking',
            title: 'W-9 & Direct Deposit / Bank Account',
            options: [
                { value: 'verified', label: 'W-9 & Bank / Payroll Account Verified' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'not_started', label: 'Not Started' }
            ],
            default_value: 'not_started'
        },
        {
            key: 'transportation_and_gear',
            title: 'Daily Commute Plan & Work Boots/Gear',
            options: [
                { value: 'verified', label: 'Reliable Commute & Work Boots/Gear Secured' },
                { value: 'commute_only_needs_gear', label: 'Commute Plan Verified — Needs Work Boots/Gear' },
                { value: 'needs_transportation', label: 'Needs Reliable Daily Transportation Plan' }
            ],
            default_value: 'commute_only_needs_gear'
        }
    ],
    benefits_and_financial: [
        {
            key: 'snap_food_stamps',
            title: 'SNAP (Food Stamps) Status',
            options: [
                { value: 'active', label: 'Active / Approved' },
                { value: 'submitted', label: 'Application Submitted / Pending' },
                { value: 'not_needed', label: 'Not Needed / Ineligible' },
                { value: 'needs_application', label: 'Needs Application' }
            ],
            default_value: 'not_needed'
        },
        {
            key: 'health_coverage_welvista',
            title: 'Medicaid / Welvista Prescription Coverage',
            conditional_controller: 'has_chronic_health_condition',
            options: [
                { value: 'na_no_chronic_conditions', label: 'Not Required (No Chronic Health Conditions Requiring Daily Meds)' },
                { value: 'active_coverage', label: 'Medicaid / Insurance or Welvista Active' },
                { value: 'application_pending', label: 'Application Submitted / Pending' },
                { value: 'needs_enrollment', label: 'Has Chronic Condition — Needs Welvista / Medicaid Enrollment' }
            ],
            default_value: 'na_no_chronic_conditions'
        },
        {
            key: 'budget_and_savings',
            title: 'Personal Budget & Savings Plan',
            options: [
                { value: 'completed', label: 'Budget & Savings Goal Completed' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'not_started', label: 'Not Started' }
            ],
            default_value: 'not_started'
        }
    ]
};

const PARTICIPANT_SLUG_ALIASES = {
    dillon: 'Dillon_Johnson',
    chris_barranco: 'Christopher_Barranco',
    charlie_graham: 'Charlie_Graham_Jr',
    she_lah_norman: 'Shelah_Norman',
    william_countee_iii: 'William_Countee',
    keyzelle_limamauel_curtis_thomas: 'Keyzelle_Thomas'
};

const CANONICAL_DISPLAY_NAMES = {
    Dillon_Johnson: 'Dillon Johnson',
    Christopher_Barranco: 'Christopher Barranco',
    Charlie_Graham_Jr: 'Charlie Graham Jr',
    Shelah_Norman: 'Shelah Norman',
    William_Countee: 'William Countee',
    Keyzelle_Thomas: 'Keyzelle Thomas'
};

const FOLDER_CACHE_TTL_MS = 60000;
let _cachedFolderSummary = null;
let _cachedFolderSummaryAt = 0;

function invalidateFolderIndexCache() {
    _cachedFolderSummary = null;
    _cachedFolderSummaryAt = 0;
}

function buildRawParticipantSlug(name) {
    return String(name || 'Unknown_Participant')
        .replace(/^\d+_/, '')
        .replace(/_?(Charleston|Columbia|Spartanburg|First Shift|Reentry Navigation|Reentry|Turn90)\b/gi, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'Unknown_Participant';
}

function resolveCanonicalSlug(slugOrName) {
    const rawSlug = buildRawParticipantSlug(slugOrName);
    const aliasHit = PARTICIPANT_SLUG_ALIASES[rawSlug.toLowerCase()];
    if (aliasHit) return aliasHit;

    // Also match existing directory case-insensitively to prevent duplicate case-variant folders
    try {
        if (fs.existsSync(participantsRootDir)) {
            const lower = rawSlug.toLowerCase();
            if (PARTICIPANT_SLUG_ALIASES[lower]) return PARTICIPANT_SLUG_ALIASES[lower];
            const existing = fs.readdirSync(participantsRootDir).find(d => d.toLowerCase() === lower);
            if (existing && !PARTICIPANT_SLUG_ALIASES[existing.toLowerCase()]) {
                return existing;
            }
        }
    } catch (e) {}
    return rawSlug;
}

function sanitizeParticipantSlug(name) {
    return resolveCanonicalSlug(name);
}

function inferDocTypeFromFilename(filename = '') {
    const f = String(filename || '').toLowerCase();
    if (f.includes('_final_case_brief')) return 'brief';
    if (f.includes('_case_brief_')) return 'legacy_brief';
    if (f.includes('_participant_case_plan')) return 'action_plan';
    if (f.includes('_final_scoring_form')) return 'final_scoring';
    if (f.includes('_draft_scoring_form')) return 'draft_scoring';
    if (f.includes('_interview_guide')) return 'interview_guide';
    if (f.includes('_transcript')) return 'transcript';
    if (f.includes('_criminal_history') || f.includes('_intelius_raw')) return 'criminal_history';
    if (f.includes('_reentry_')) return 'reentry_plan';
    return 'document';
}

function appendParticipantHistoryEvent(slugOrName, event = {}) {
    try {
        const slug = resolveCanonicalSlug(slugOrName);
        const pDir = path.join(participantsRootDir, slug);
        if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
        const logPath = path.join(pDir, 'history_log.json');

        let logData = { participant_key: slug, updated_at: new Date().toISOString(), events: [] };
        if (fs.existsSync(logPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                if (Array.isArray(parsed)) {
                    logData.events = parsed;
                } else if (parsed && Array.isArray(parsed.events)) {
                    logData.events = parsed.events;
                }
            } catch (e) {}
        }

        const entry = {
            id: event.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            event_key: event.event_key || null,
            timestamp: event.timestamp || new Date().toISOString(),
            category: event.category || 'general',
            action: event.action || 'Folder Event',
            summary: event.summary || '',
            filename: event.filename || '',
            snapshot_file: event.snapshot_file || '',
            actor: event.actor || 'Turn90 Staff'
        };

        if (entry.event_key) {
            const idx = logData.events.findIndex(e => e && e.event_key === entry.event_key);
            if (idx >= 0) {
                if (event.replace_existing) {
                    logData.events[idx] = { ...logData.events[idx], ...entry };
                } else {
                    return logData.events[idx];
                }
            } else {
                logData.events.push(entry);
            }
        } else {
            logData.events.push(entry);
        }

        logData.events.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        logData.updated_at = new Date().toISOString();
        fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
        return entry;
    } catch (e) {
        return null;
    }
}

function archiveParticipantDocumentVersion(slugOrName, { docType = 'document', filename = '', sourcePath = '', content = null, summary = '', actor = 'Turn90 Staff' } = {}) {
    try {
        const slug = resolveCanonicalSlug(slugOrName);
        const pDir = path.join(participantsRootDir, slug);
        const historyDir = path.join(pDir, 'history');
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

        let payload = null;
        if (sourcePath && fs.existsSync(sourcePath)) {
            payload = fs.readFileSync(sourcePath);
        } else if (content !== null && content !== undefined) {
            payload = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
        }
        if (!payload) return null;

        const base = path.basename(filename || sourcePath || `${docType}.md`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const safeType = String(docType || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const snapName = `${stamp}_${safeType}_${base}`;
        const snapPath = path.join(historyDir, snapName);
        fs.writeFileSync(snapPath, payload);

        appendParticipantHistoryEvent(slug, {
            category: 'document_version',
            action: `Archived ${safeType}`,
            summary: summary || `Saved prior snapshot of ${base}`,
            filename: base,
            snapshot_file: snapName,
            actor
        });

        return snapName;
    } catch (e) {
        return null;
    }
}

function loadSkillCatHistory() {
    try {
        const p = path.join(supervisionPipelineDir, 'skillcat_history.json');
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function loadApricotFeedbackCache() {
    try {
        const p = path.join(supervisionPipelineDir, 'case_feedback_cache.json');
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function evaluateWaitlistReadiness(briefcaseState) {
    const items = briefcaseState.items || {};
    const hasChronic = briefcaseState.has_chronic_health_condition === 'yes';

    // Enforce Conditional Medical Logic automatically
    if (!hasChronic) {
        if (!items.chronic_health_and_meds || items.chronic_health_and_meds.value !== 'no_chronic_conditions_na') {
            items.chronic_health_and_meds = {
                value: 'no_chronic_conditions_na',
                notes: 'No chronic health conditions reported — medical appointments and daily medication tracking not applicable.',
                updated_at: new Date().toISOString()
            };
        }
        if (!items.health_coverage_welvista || items.health_coverage_welvista.value === 'needs_enrollment') {
            items.health_coverage_welvista = {
                value: 'na_no_chronic_conditions',
                notes: 'Auto-set: No chronic conditions requiring daily medication.',
                updated_at: new Date().toISOString()
            };
        }
        briefcaseState.medical_appointments_applicable = false;
    } else {
        briefcaseState.medical_appointments_applicable = true;
        if (items.chronic_health_and_meds && items.chronic_health_and_meds.value === 'no_chronic_conditions_na') {
            items.chronic_health_and_meds.value = 'needs_medical_appointment';
        }
    }

    // Enforce Conditional DMV Suspended DL logic
    const dlVal = items.state_id_or_dl ? items.state_id_or_dl.value : 'missing';
    if (dlVal === 'valid_dl' || dlVal === 'valid_state_id') {
        if (briefcaseState.dl_is_suspended !== 'yes') {
            items.dmv_suspended_inquiry = {
                value: 'not_applicable_valid',
                notes: (items.dmv_suspended_inquiry && items.dmv_suspended_inquiry.notes) || 'DL not suspended / valid ID on file.',
                updated_at: new Date().toISOString()
            };
        }
    } else if (dlVal === 'dl_suspended_has_state_id' || dlVal === 'dl_suspended_no_id') {
        briefcaseState.dl_is_suspended = 'yes';
        if (items.dmv_suspended_inquiry && items.dmv_suspended_inquiry.value === 'not_applicable_valid') {
            items.dmv_suspended_inquiry.value = 'needs_dmv_visit';
        }
    }

    let metCount = 0;
    const checklist = [];
    for (const req of UNIFIED_BRIEFCASE_SCHEMA.waitlist_requirements) {
        const currentVal = (items[req.key] && items[req.key].value) || req.default_value;
        const opt = req.options.find(o => o.value === currentVal) || req.options[0];
        const isReady = Boolean(opt && opt.ready);
        if (isReady) metCount++;
        checklist.push({
            key: req.key,
            number: req.number,
            title: req.title,
            value: currentVal,
            label: opt ? opt.label : currentVal,
            ready: isReady,
            notes: (items[req.key] && items[req.key].notes) || ''
        });
    }

    briefcaseState.waitlist_met_count = metCount;
    briefcaseState.waitlist_total_required = 9;
    briefcaseState.waitlist_ready = metCount === 9;
    briefcaseState.waitlist_checklist = checklist;
    return briefcaseState;
}

// Synthesize Unified Briefcase from all loaded DB records, transcripts, briefs, SkillCat, and Apricot data
function synthesizeBriefcaseFromLoadedInfo({
    participantKey,
    participantName,
    location = 'Charleston',
    track = 'reentry_nav',
    userId = null,
    clientId = null,
    existingBriefcase = null,
    textSources = [],
    skillcatRecord = null
}) {
    const state = existingBriefcase ? JSON.parse(JSON.stringify(existingBriefcase)) : {
        participant_key: participantKey,
        participant_name: participantName,
        location,
        track,
        user_id: userId,
        client_id: clientId,
        has_chronic_health_condition: 'no',
        dl_is_suspended: 'no',
        child_support_applicable: 'no',
        supervision_officer_details: '',
        chronic_condition_details: '',
        medical_appointments_applicable: false,
        items: {}
    };

    // Initialize defaults for any missing keys
    const allFields = [
        ...UNIFIED_BRIEFCASE_SCHEMA.waitlist_requirements,
        ...UNIFIED_BRIEFCASE_SCHEMA.employment_and_pathways,
        ...UNIFIED_BRIEFCASE_SCHEMA.benefits_and_financial
    ];
    for (const field of allFields) {
        if (!state.items[field.key]) {
            state.items[field.key] = {
                value: field.default_value,
                notes: '',
                source: 'default',
                updated_at: new Date().toISOString()
            };
        }
    }

    // 1. Pull from DB participant_profiles, briefcase_items, gate_criteria, health_wellness_screen if userId exists
    if (userId) {
        const profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(userId);
        const oldItems = db.prepare('SELECT * FROM briefcase_items WHERE user_id = ?').all(userId);
        const oldGates = db.prepare('SELECT * FROM gate_criteria WHERE user_id = ?').all(userId);
        const health = db.prepare('SELECT * FROM health_wellness_screen WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);

        const isGreen = (keys) => {
            for (const k of keys) {
                const b = oldItems.find(i => i.item_key === k);
                if (b && b.status === 'green') return b;
                const g = oldGates.find(i => i.criterion_key === k);
                if (g && g.status === 'green') return g;
            }
            return null;
        };

        if (isGreen(['state_id', 'drivers_license', 'g1_photo_id'])) {
            if (state.items.state_id_or_dl.source === 'default') {
                state.items.state_id_or_dl = { value: 'valid_state_id', notes: 'Imported from existing verified ID record', source: 'db_import', updated_at: new Date().toISOString() };
            }
        }
        if (isGreen(['ss_card', 'g1_ssn'])) {
            if (state.items.ss_card.source === 'default') {
                state.items.ss_card = { value: 'verified_card', notes: 'Imported from existing verified SSN record', source: 'db_import', updated_at: new Date().toISOString() };
            }
        }
        if (isGreen(['birth_cert', 'g1_birth_cert'])) {
            if (state.items.birth_certificate.source === 'default') {
                state.items.birth_certificate = { value: 'verified_copy', notes: 'Imported from existing verified Birth Certificate record', source: 'db_import', updated_at: new Date().toISOString() };
            }
        }
        if (isGreen(['housing_plan', 'g2_housing']) || (profile && profile.housing_status === 'stable')) {
            if (state.items.stable_housing.source === 'default') {
                state.items.stable_housing = { value: 'stable_verified', notes: 'Stable housing verified in profile', source: 'db_import', updated_at: new Date().toISOString() };
            }
        }
        if (isGreen(['reliable_phone', 'g2_phone'])) {
            if (state.items.reliable_phone.source === 'default') {
                state.items.reliable_phone = { value: 'active_verified', notes: 'Reliable phone verified in profile', source: 'db_import', updated_at: new Date().toISOString() };
            }
        }
        if (isGreen(['g2_dmv'])) {
            state.items.dmv_suspended_inquiry = { value: 'completed_dmv_inquiry', notes: 'DMV license inquiry completed', source: 'db_import', updated_at: new Date().toISOString() };
        }
        if (isGreen(['child_support_status', 'g2_child_support'])) {
            state.items.child_support_contact = { value: 'contact_made_compliant', notes: 'Child support status verified', source: 'db_import', updated_at: new Date().toISOString() };
        }
        if (isGreen(['g2_probation_conflicts'])) {
            state.items.supervision_information = { value: 'active_logged_no_conflict', notes: 'Supervision schedule verified with no work conflict', source: 'db_import', updated_at: new Date().toISOString() };
        }
        if (isGreen(['resume_completed', 'g2_resume'])) {
            state.items.resume_and_email = { value: 'completed', notes: 'Resume completed', source: 'db_import', updated_at: new Date().toISOString() };
        }
        if (isGreen(['bank_account', 'g3_bank_account']) || (profile && profile.w9_status === 'completed')) {
            state.items.w9_and_banking = { value: 'verified', notes: 'Bank account / W-9 verified', source: 'db_import', updated_at: new Date().toISOString() };
        }

        // Conditional Medical Logic from health_wellness_screen
        if (health) {
            const hasPhysicalOrRx = Boolean(health.mobility_pain || health.primary_care_referral || (health.physical_notes && /chronic|diabetes|hypertension|blood pressure|seizure|asthma|medication|insulin/i.test(health.physical_notes)));
            if (hasPhysicalOrRx && state.items.chronic_health_and_meds.source === 'default') {
                state.has_chronic_health_condition = 'yes';
                state.chronic_condition_details = health.physical_notes || 'Chronic health condition noted on health screen';
                const hasRx = isGreen(['prescriptions', 'g3_prescription_access']);
                state.items.chronic_health_and_meds = {
                    value: hasRx ? 'treated_and_has_daily_meds' : 'needs_medical_appointment',
                    notes: state.chronic_condition_details,
                    source: 'health_screen',
                    updated_at: new Date().toISOString()
                };
            }
        }
    }

    // 2. Pull from Reentry Client Briefcase if clientId exists
    if (clientId) {
        const rItems = db.prepare('SELECT * FROM reentry_client_briefcase WHERE client_id = ?').all(clientId);
        const rGreen = (k) => rItems.find(i => i.item_key === k && i.status === 'green');
        if (rGreen('state_id') || rGreen('drivers_license')) state.items.state_id_or_dl.value = 'valid_state_id';
        if (rGreen('ss_card')) state.items.ss_card.value = 'verified_card';
        if (rGreen('birth_cert')) state.items.birth_certificate.value = 'verified_copy';
        if (rGreen('housing_plan')) state.items.stable_housing.value = 'stable_verified';
        if (rGreen('reliable_phone')) state.items.reliable_phone.value = 'active_verified';
    }

    // 3. Parse loaded text sources (Screening Consultation, LS/CMI Brief, Transcript, Case Notes)
    const combinedText = textSources.filter(Boolean).join('\n');
    if (combinedText.length > 30) {
        if (/suspended\s+(?:driver|license|dl)/i.test(combinedText) && state.items.dmv_suspended_inquiry.source === 'default') {
            state.dl_is_suspended = 'yes';
            state.items.dmv_suspended_inquiry = {
                value: /went to dmv|gone to dmv|dmv reinstatement/i.test(combinedText) ? 'completed_dmv_inquiry' : 'needs_dmv_visit',
                notes: 'Detected suspended license mention in loaded records',
                source: 'loaded_text',
                updated_at: new Date().toISOString()
            };
        }
        if (/child support/i.test(combinedText) && !/no child support|not applicable/i.test(combinedText) && state.items.child_support_contact.source === 'default') {
            state.child_support_applicable = 'yes';
            state.items.child_support_contact = {
                value: /contacted child support|paying child support|current on child support/i.test(combinedText) ? 'contact_made_compliant' : 'needs_contact',
                notes: 'Detected child support reference in loaded records',
                source: 'loaded_text',
                updated_at: new Date().toISOString()
            };
        }
        if (/(?:probation|parole|supervision officer|po\s+is)/i.test(combinedText) && state.items.supervision_information.source === 'default') {
            state.items.supervision_information = {
                value: 'active_logged_no_conflict',
                notes: 'Supervision information referenced in loaded assessment/case records',
                source: 'loaded_text',
                updated_at: new Date().toISOString()
            };
        }
    }

    // 4. Sync SkillCat pathway & module progress
    if (skillcatRecord) {
        const hours = Number(skillcatRecord.total_hours || skillcatRecord.hours || 0);
        const completedMods = skillcatRecord.completed_modules || skillcatRecord.courses || [];
        const modCount = Array.isArray(completedMods) ? completedMods.length : Number(skillcatRecord.completed_count || 0);
        if (skillcatRecord.pathway) {
            state.items.skillcat_pathway.value = skillcatRecord.pathway;
        }
        state.items.skillcat_progress_status = {
            value: (hours > 0 || modCount > 0) ? (skillcatRecord.stalled ? 'stalled_flagged' : 'on_track') : 'not_started',
            notes: `${modCount} modules completed (${hours.toFixed(1)} hrs)`,
            source: 'skillcat_scraper',
            updated_at: new Date().toISOString()
        };
    }

    evaluateWaitlistReadiness(state);

    // Persist to unified_briefcases table
    db.prepare(`
        INSERT OR REPLACE INTO unified_briefcases (
            participant_key, user_id, client_id, participant_name, location, track,
            has_chronic_health_condition, dl_is_suspended, child_support_applicable,
            waitlist_ready, waitlist_met_count, briefcase_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
        participantKey,
        userId,
        clientId,
        participantName,
        location,
        track,
        state.has_chronic_health_condition || 'no',
        state.dl_is_suspended || 'no',
        state.child_support_applicable || 'no',
        state.waitlist_ready ? 1 : 0,
        state.waitlist_met_count || 0,
        JSON.stringify(state)
    );

    return state;
}

function safeQueryAll(sql, params = []) {
    try {
        return db.prepare(sql).all(...params);
    } catch (e) {
        return [];
    }
}

function safeQueryGet(sql, params = []) {
    try {
        return db.prepare(sql).get(...params) || null;
    } catch (e) {
        return null;
    }
}

function computeBestLscmiClientId(files = [], fallbackPrefix = 'Participant_Charleston') {
    const SUF_RE = /^(.+?)_(final_case_brief|participant_case_plan|final_scoring_form|draft_scoring_form|interview_guide|transcript|criminal_history)\.(md|txt)$/i;
    const scoreMap = new Map();
    const weights = {
        final_case_brief: 12,
        participant_case_plan: 10,
        final_scoring_form: 8,
        draft_scoring_form: 6,
        interview_guide: 4,
        transcript: 3,
        criminal_history: 2
    };
    for (const f of files) {
        const m = String(f).match(SUF_RE);
        if (!m) continue;
        const prefix = m[1];
        const kind = m[2].toLowerCase();
        scoreMap.set(prefix, (scoreMap.get(prefix) || 0) + (weights[kind] || 1));
    }
    if (scoreMap.size === 0) return fallbackPrefix;
    return Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

function categorizeParticipantDocuments(pDir, slug, lscmiClientId) {
    const docsDir = path.join(pDir, 'documents');
    const historyDir = path.join(pDir, 'history');
    const docFiles = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter(f => !f.startsWith('.')).sort() : [];
    const histFilesRaw = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => !f.startsWith('.')).sort().reverse() : [];

    const makeMeta = (dirPath, fname, scope) => {
        let size = 0;
        let updatedAt = null;
        try {
            const st = fs.statSync(path.join(dirPath, fname));
            size = st.size;
            updatedAt = new Date(st.mtimeMs).toISOString();
        } catch (e) {}
        const ext = path.extname(fname).toLowerCase();
        const baseUrl = `/api/participants/folder/${encodeURIComponent(slug)}/file/${encodeURIComponent(scope)}/${encodeURIComponent(fname)}`;
        return {
            filename: fname,
            ext,
            size,
            updated_at: updatedAt,
            scope,
            raw_url: baseUrl,
            download_url: `${baseUrl}?download=1`,
            print_url: `${baseUrl}?print=1`,
            preview_supported: /\.(md|txt|json|pdf)$/i.test(fname)
        };
    };

    const categories = {
        briefs: [],
        legacy_case_briefs: [],
        action_plans: [],
        scoring_forms: [],
        interview_guides: [],
        transcripts: [],
        criminal_history: [],
        reentry_plans: [],
        other_files: []
    };

    for (const fname of docFiles) {
        const meta = makeMeta(docsDir, fname, 'documents');
        const low = fname.toLowerCase();
        if (low.includes('_final_case_brief.')) categories.briefs.push(meta);
        else if (low.includes('_case_brief_')) categories.legacy_case_briefs.push(meta);
        else if (low.includes('_participant_case_plan.')) categories.action_plans.push(meta);
        else if (low.includes('_final_scoring_form.') || low.includes('_draft_scoring_form.')) categories.scoring_forms.push(meta);
        else if (low.includes('_interview_guide.')) categories.interview_guides.push(meta);
        else if (low.includes('_transcript.')) categories.transcripts.push(meta);
        else if (low.includes('_criminal_history.') || low.includes('_intelius_raw.')) categories.criminal_history.push(meta);
        else if (low.includes('_reentry_')) categories.reentry_plans.push(meta);
        else categories.other_files.push(meta);
    }

    // Sort legacy case briefs newest-first by mtime/filename
    categories.legacy_case_briefs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.filename.localeCompare(a.filename));

    // Collect lscmi_files list compatible with currentInterviewsData[lscmiClientId]
    const lscmiFilesSet = new Set(docFiles);
    try {
        if (lscmiClientId && fs.existsSync(dataDir)) {
            for (const f of fs.readdirSync(dataDir)) {
                if (f.startsWith(`${lscmiClientId}_`)) {
                    lscmiFilesSet.add(f);
                }
            }
        }
    } catch (e) {}

    const history_files = histFilesRaw.map(fname => makeMeta(historyDir, fname, 'history'));

    return {
        docFiles,
        lscmi_files: Array.from(lscmiFilesSet).sort(),
        lscmi_documents: categories,
        history_files
    };
}

// Build or refresh every participant's dedicated folder under data/participants/<Participant_Slug>/
function syncAllParticipantFolders({ force = false } = {}) {
    if (!force && _cachedFolderSummary && (Date.now() - _cachedFolderSummaryAt < FOLDER_CACHE_TTL_MS)) {
        return _cachedFolderSummary;
    }

    const readDiskJson = (filePath, fallback = null) => {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {}
        return fallback;
    };

    const skillcatHistory = loadSkillCatHistory();
    const allDataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

    // Collect unified directory of participants across ALL sources (users, reentry, data files, Apricot, SkillCat history, consultations)
    const registry = new Map();

    const registerPerson = (rawName, info = {}) => {
        if (!rawName) return null;
        const cleanName = String(rawName)
            .replace(/^\d+_/, '')
            .replace(/_(Charleston|Columbia|Spartanburg|Reentry_Navigation|Prison_Program|Reentry Navigation|Prison Program)$/i, '')
            .replace(/_/g, ' ')
            .trim();
        if (!cleanName || cleanName.length < 2 || /^(Turn90|Supervisor|Charleston|Columbia|Spartanburg|Reentry|Jennifer Jeanquart|Jenn Jeanquart|Diyoung Dantzler|Terry Brooks|Justin Evans|Daisy Boynton|Terrence Brown|Terrance Brown|Test |Sample )/i.test(cleanName)) {
            return null;
        }
        const slug = resolveCanonicalSlug(cleanName);
        const preferredName = CANONICAL_DISPLAY_NAMES[slug] || cleanName;
        if (!registry.has(slug)) {
            registry.set(slug, {
                participant_key: slug,
                name: preferredName,
                location: info.location || 'Charleston',
                track: info.track || 'first_shift',
                status: info.status || 'active',
                user_id: info.user_id || null,
                user_ids: info.user_id ? [info.user_id] : [],
                client_id: info.client_id || null,
                client_ids: info.client_id ? [info.client_id] : [],
                apricot_id: info.apricot_id || null,
                apricot_ids: info.apricot_id ? [String(info.apricot_id)] : [],
                phone: info.phone || '',
                email: info.email || '',
                aliases_seen: [cleanName],
                files: []
            });
        } else {
            const existing = registry.get(slug);
            if (!CANONICAL_DISPLAY_NAMES[slug] && cleanName.length > existing.name.length && /[A-Z]/.test(cleanName)) {
                existing.name = cleanName;
            }
            if (cleanName && !existing.aliases_seen.includes(cleanName)) existing.aliases_seen.push(cleanName);
            if (info.user_id) {
                if (!existing.user_id) existing.user_id = info.user_id;
                if (!existing.user_ids.includes(info.user_id)) existing.user_ids.push(info.user_id);
            }
            if (info.client_id) {
                if (!existing.client_id) existing.client_id = info.client_id;
                if (!existing.client_ids.includes(info.client_id)) existing.client_ids.push(info.client_id);
            }
            if (info.location && existing.location === 'Charleston') existing.location = info.location;
            if (info.track) existing.track = info.track;
            if (info.apricot_id) {
                if (!existing.apricot_id) existing.apricot_id = info.apricot_id;
                if (!existing.apricot_ids.includes(String(info.apricot_id))) existing.apricot_ids.push(String(info.apricot_id));
            }
            if (info.phone && !existing.phone) existing.phone = info.phone;
            if (info.email && !existing.email) existing.email = info.email;
        }
        return registry.get(slug);
    };

    // 1. From users table (role = 'participant')
    const dbParticipants = safeQueryAll(`
        SELECT u.*, p.overall_status, p.record_id, p.dl_status, p.housing_status, p.child_support_status
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant'
    `);
    for (const u of dbParticipants) {
        registerPerson(u.name, {
            user_id: u.id,
            location: u.location || 'Charleston',
            track: u.track || 'first_shift',
            status: u.overall_status || 'active',
            apricot_id: u.record_id || null,
            phone: u.phone || '',
            email: u.email || ''
        });
    }

    // 2. From reentry_clients table
    const reentryClients = safeQueryAll('SELECT * FROM reentry_clients');
    for (const rc of reentryClients) {
        registerPerson(`${rc.first_name} ${rc.last_name}`, {
            client_id: rc.id,
            location: rc.location || 'Charleston',
            track: 'reentry_nav',
            status: rc.status || 'active',
            apricot_id: rc.apricot_id || null,
            phone: rc.phone || '',
            email: rc.email || ''
        });
    }

    // 3. From data/ files (LS/CMI briefs, legacy Case_Brief files, scoring forms, transcripts, action plans, reentry guides)
    const SUFFIX_PATTERNS = [
        '_draft_scoring_form', '_final_scoring_form', '_final_case_brief', '_Case_Brief_',
        '_interview_guide', '_transcript.txt', '_participant_case_plan',
        '_criminal_history', '_intelius_raw', '_reentry_staff_case_plan', '_reentry_participant_action_guide',
        '_reentry_assessment_data'
    ];
    for (const fname of allDataFiles) {
        if (fname.startsWith('.') || fname.endsWith('.sqlite') || fname === 'participants' || fname === 'voice_profiles' || fname === 'temp_dropbox') continue;
        for (const suf of SUFFIX_PATTERNS) {
            if (fname.includes(suf)) {
                const prefix = fname.substring(0, fname.indexOf(suf));
                let loc = 'Charleston';
                if (/Columbia/i.test(prefix)) loc = 'Columbia';
                else if (/Spartanburg/i.test(prefix)) loc = 'Spartanburg';
                const entry = registerPerson(prefix, {
                    location: loc,
                    track: fname.includes('_reentry_') ? 'reentry_nav' : 'first_shift'
                });
                if (entry && !entry.files.includes(fname)) {
                    entry.files.push(fname);
                }
                break;
            }
        }
    }

    // Also inspect DB documents table for any file links
    const dbDocsAll = safeQueryAll('SELECT d.*, u.name as user_name, u.location as user_location FROM documents d LEFT JOIN users u ON d.user_id = u.id');
    for (const docRow of dbDocsAll) {
        if (docRow.user_name) {
            const entry = registerPerson(docRow.user_name, {
                user_id: docRow.user_id,
                location: docRow.user_location || 'Charleston'
            });
            if (entry && docRow.filename && fs.existsSync(path.join(dataDir, docRow.filename)) && !entry.files.includes(docRow.filename)) {
                entry.files.push(docRow.filename);
            }
        }
    }

    // 4. From Apricot evaluations & processed notes (preserves historical/exited Apricot records)
    const apricotEvals = safeQueryAll('SELECT * FROM apricot_participant_evaluations');
    for (const ae of apricotEvals) {
        if (!ae.full_name) continue;
        registerPerson(ae.full_name, {
            apricot_id: ae.record_id || null,
            location: ae.center || 'Charleston',
            track: /reentry/i.test(ae.program || '') ? 'reentry_nav' : 'first_shift'
        });
    }
    const apricotNotePeople = safeQueryAll('SELECT DISTINCT record_id, first_name, last_name, center_location, program_enrollment FROM apricot_processed_notes');
    for (const np of apricotNotePeople) {
        const full = `${np.first_name || ''} ${np.last_name || ''}`.trim();
        if (!full) continue;
        registerPerson(full, {
            apricot_id: np.record_id || null,
            location: np.center_location || 'Charleston',
            track: /reentry/i.test(np.program_enrollment || '') ? 'reentry_nav' : 'first_shift'
        });
    }

    // 5. From ALL historical SkillCat snapshots (not just the latest)
    const scSnapshots = skillcatHistory.snapshots || skillcatHistory || {};
    const sortedSnapshotKeys = Object.keys(scSnapshots).sort();
    const latestSnapshotKey = sortedSnapshotKeys[sortedSnapshotKeys.length - 1];
    const latestSkillCatEmployees = latestSnapshotKey && scSnapshots[latestSnapshotKey]
        ? Object.values(scSnapshots[latestSnapshotKey]).filter(e => e && typeof e === 'object' && (e.fullname || e.name))
        : [];
    for (const snapKey of sortedSnapshotKeys) {
        const snapObj = scSnapshots[snapKey];
        if (!snapObj || typeof snapObj !== 'object') continue;
        for (const scEmp of Object.values(snapObj)) {
            if (!scEmp || typeof scEmp !== 'object' || !(scEmp.fullname || scEmp.name)) continue;
            registerPerson(scEmp.fullname || scEmp.name, {
                location: 'Charleston',
                track: 'first_shift'
            });
        }
    }

    // 6. From screening_consultations, unified_briefcases, and reentry_case_plans
    for (const sc of safeQueryAll('SELECT participant_name, location FROM screening_consultations')) {
        registerPerson(sc.participant_name, { location: sc.location || 'Charleston' });
    }
    for (const ub of safeQueryAll('SELECT participant_name, location, track, user_id, client_id FROM unified_briefcases')) {
        registerPerson(ub.participant_name, {
            location: ub.location || 'Charleston',
            track: ub.track || 'reentry_nav',
            user_id: ub.user_id || null,
            client_id: ub.client_id || null
        });
    }
    for (const rcp of safeQueryAll('SELECT participant_name, location, user_id FROM reentry_case_plans')) {
        registerPerson(rcp.participant_name, {
            user_id: rcp.user_id || null,
            location: rcp.location || 'Charleston',
            track: 'reentry_nav'
        });
    }

    // 7. From existing committed data/participants/<slug>/ folders on disk (preserves full roster on Render regardless of SQLite/pipeline state)
    try {
        if (fs.existsSync(participantsRootDir)) {
            for (const entry of fs.readdirSync(participantsRootDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const dName = entry.name;
                if (dName.startsWith('.')) continue;
                if (PARTICIPANT_SLUG_ALIASES[dName.toLowerCase()]) continue;
                const prof = readDiskJson(path.join(participantsRootDir, dName, 'profile.json'), null);
                registerPerson((prof && prof.name) || dName.replace(/_/g, ' '), {
                    location: (prof && prof.location) || 'Charleston',
                    track: (prof && prof.track) || 'first_shift',
                    status: (prof && prof.status) || 'active',
                    apricot_id: (prof && prof.apricot_id) || null,
                    phone: (prof && prof.phone) || '',
                    email: (prof && prof.email) || ''
                });
            }
        }
    } catch (e) {}

    // 8. From Prison Program (Pre-Release / MacDougal Prison in Apricot sheet cache) and manually edited participant_basic_info
    try {
        for (const sheetKey of ['caseloads', 'enrollments']) {
            const sheetRow = safeQueryGet('SELECT rows_json FROM apricot_sheet_cache WHERE sheet_key = ?', [sheetKey]);
            if (sheetRow && sheetRow.rows_json) {
                const rows = JSON.parse(sheetRow.rows_json);
                if (Array.isArray(rows)) {
                    for (const r of rows) {
                        const prog = String(r['Program Enrollment:'] || r['Which Program?'] || '');
                        const fac = String(r['At which facility are the classes taking...'] || '');
                        if (/pre-release|prison|macdougal/i.test(prog) || /prison|macdougal/i.test(fac)) {
                            const full = `${r.First || ''} ${r.Last || ''}`.trim();
                            if (!full) continue;
                            registerPerson(full, {
                                apricot_id: r['Record ID'] || null,
                                location: 'Prison Program',
                                track: 'prison_program',
                                status: r['Date enrollment ended:'] ? 'exited' : 'active'
                            });
                        }
                    }
                }
            }
        }
    } catch (e) {}

    for (const bi of safeQueryAll('SELECT participant_key, full_name, primary_center, track, status, phone, email FROM participant_basic_info')) {
        if (bi.full_name || bi.participant_key) {
            registerPerson(bi.full_name || bi.participant_key.replace(/_/g, ' '), {
                location: bi.primary_center || 'Charleston',
                track: bi.track || 'first_shift',
                status: bi.status || 'active',
                phone: bi.phone || '',
                email: bi.email || ''
            });
        }
    }

    // Build list of alias dirs on disk per canonical slug so legacy alias folders merge seamlessly forward
    const aliasDirsByCanonical = new Map();
    for (const [aliasLower, canonical] of Object.entries(PARTICIPANT_SLUG_ALIASES)) {
        if (!aliasDirsByCanonical.has(canonical)) aliasDirsByCanonical.set(canonical, []);
        aliasDirsByCanonical.get(canonical).push(aliasLower);
    }

    // Now build/sync each participant's dedicated directory
    const summaryList = [];
    for (const [slug, person] of registry.entries()) {
        const pDir = path.join(participantsRootDir, slug);
        const docsDir = path.join(pDir, 'documents');
        const historyDir = path.join(pDir, 'history');
        if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

        // Merge any documents stored under an old alias participant directory
        try {
            const aliasLowers = aliasDirsByCanonical.get(slug) || [];
            if (aliasLowers.length > 0 && fs.existsSync(participantsRootDir)) {
                for (const dName of fs.readdirSync(participantsRootDir)) {
                    if (dName !== slug && aliasLowers.includes(dName.toLowerCase())) {
                        const oldDocsDir = path.join(participantsRootDir, dName, 'documents');
                        if (fs.existsSync(oldDocsDir)) {
                            for (const oldFile of fs.readdirSync(oldDocsDir)) {
                                if (oldFile.startsWith('.')) continue;
                                const oldPath = path.join(oldDocsDir, oldFile);
                                const targetPath = path.join(docsDir, oldFile);
                                if (!fs.existsSync(targetPath) && fs.statSync(oldPath).isFile()) {
                                    fs.copyFileSync(oldPath, targetPath);
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        // Copy associated files from data/ into documents/ and snapshot changed versions to history/
        const docSortByMtime = [];
        for (const fname of person.files.sort()) {
            const srcPath = path.join(dataDir, fname);
            const dstPath = path.join(docsDir, fname);
            try {
                if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) continue;
                const srcStat = fs.statSync(srcPath);
                docSortByMtime.push({ fname, srcPath, mtimeMs: srcStat.mtimeMs });

                if (!fs.existsSync(dstPath)) {
                    fs.copyFileSync(srcPath, dstPath);
                } else {
                    const dstStat = fs.statSync(dstPath);
                    let changed = srcStat.size !== dstStat.size;
                    if (!changed && /\.(md|txt|json)$/i.test(fname) && srcStat.size < 2 * 1024 * 1024) {
                        changed = !fs.readFileSync(srcPath).equals(fs.readFileSync(dstPath));
                    }
                    if (changed) {
                        archiveParticipantDocumentVersion(slug, {
                            docType: inferDocTypeFromFilename(fname),
                            filename: fname,
                            sourcePath: dstPath,
                            summary: `Auto-archived prior version before syncing updated ${fname}`,
                            actor: 'System Sync'
                        });
                        fs.copyFileSync(srcPath, dstPath);
                    }
                }
            } catch (e) {}
        }

        // Also check files already inside docsDir (e.g., merged from alias dir or uploaded directly) for extraction
        let allFolderDocFiles = [];
        try {
            allFolderDocFiles = fs.readdirSync(docsDir).filter(f => !f.startsWith('.'));
            for (const df of allFolderDocFiles) {
                if (!docSortByMtime.some(d => d.fname === df)) {
                    const dfPath = path.join(docsDir, df);
                    const st = fs.statSync(dfPath);
                    if (st.isFile()) docSortByMtime.push({ fname: df, srcPath: dfPath, mtimeMs: st.mtimeMs });
                }
            }
        } catch (e) {}

        // Sort newest-first so we pick the latest revision of each canonical document type
        docSortByMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

        let lscmiBriefMd = '';
        let lscmiScoringMd = '';
        let actionPlanMd = '';
        let transcriptText = '';

        const pickTextByPattern = (predicate) => {
            const hit = docSortByMtime.find(d => predicate(d.fname));
            if (!hit) return '';
            try { return fs.readFileSync(hit.srcPath, 'utf8'); } catch (e) { return ''; }
        };

        const readDiskText = (fname) => {
            const p = path.join(pDir, fname);
            try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch (e) { return ''; }
        };

        lscmiBriefMd = pickTextByPattern(f => f.includes('_final_case_brief.md'))
            || pickTextByPattern(f => f.includes('_Case_Brief_') && f.endsWith('.txt'))
            || readDiskText('lscmi_brief.md');
        lscmiScoringMd = pickTextByPattern(f => f.includes('_final_scoring_form.md'))
            || pickTextByPattern(f => f.includes('_draft_scoring_form.md'))
            || readDiskText('lscmi_scoring.md');
        actionPlanMd = pickTextByPattern(f => f.includes('_participant_case_plan.md'))
            || pickTextByPattern(f => f.includes('_reentry_participant_action_guide.md'))
            || pickTextByPattern(f => f.includes('_reentry_staff_case_plan.md'));
        transcriptText = pickTextByPattern(f => f.endsWith('_transcript.txt'))
            || readDiskText('lscmi_transcript.txt');

        // Gather ALL historical reentry records for this participant
        const lowerNames = Array.from(new Set([person.name, ...person.aliases_seen].map(n => String(n || '').toLowerCase()).filter(Boolean)));
        const rClientRows = [];
        for (const rc of reentryClients) {
            const rcFull = `${rc.first_name || ''} ${rc.last_name || ''}`.trim().toLowerCase();
            if (person.client_ids.includes(rc.id) || lowerNames.includes(rcFull)) {
                rClientRows.push(rc);
                if (!person.client_ids.includes(rc.id)) person.client_ids.push(rc.id);
                if (!person.client_id) person.client_id = rc.id;
            }
        }
        const reentrySessions = person.client_ids.length
            ? safeQueryAll(`SELECT * FROM reentry_client_sessions WHERE client_id IN (${person.client_ids.map(() => '?').join(',')}) ORDER BY session_date DESC, id DESC`, person.client_ids)
            : [];
        const reentryGoals = person.client_ids.length
            ? safeQueryAll(`SELECT * FROM reentry_client_goals WHERE client_id IN (${person.client_ids.map(() => '?').join(',')}) ORDER BY updated_at DESC, id DESC`, person.client_ids)
            : [];

        const reentryCasePlans = safeQueryAll('SELECT * FROM reentry_case_plans ORDER BY updated_at DESC, id DESC').filter(rcp => {
            if (rcp.user_id && person.user_ids.includes(rcp.user_id)) return true;
            const rName = String(rcp.participant_name || '').trim().toLowerCase();
            return lowerNames.includes(rName) || resolveCanonicalSlug(rcp.participant_name || '') === slug;
        });

        const diskReentry = readDiskJson(path.join(pDir, 'reentry_history.json'), {}) || {};
        const finalReentryClients = rClientRows.length > 0 ? rClientRows : (Array.isArray(diskReentry.client_records) ? diskReentry.client_records : []);
        const finalReentrySessions = reentrySessions.length > 0 ? reentrySessions : (Array.isArray(diskReentry.sessions) ? diskReentry.sessions : []);
        const finalReentryGoals = reentryGoals.length > 0 ? reentryGoals : (Array.isArray(diskReentry.goals) ? diskReentry.goals : []);
        const finalReentryCasePlans = reentryCasePlans.length > 0 ? reentryCasePlans : (Array.isArray(diskReentry.case_plans) ? diskReentry.case_plans : []);

        if (!actionPlanMd && finalReentryCasePlans.length > 0) {
            actionPlanMd = finalReentryCasePlans[0].participant_guide_md || finalReentryCasePlans[0].staff_case_plan_md || '';
        }
        if (!actionPlanMd) {
            actionPlanMd = readDiskText('action_plan.md');
        }

        // Write canonical markdown files inside participant folder
        if (lscmiBriefMd) fs.writeFileSync(path.join(pDir, 'lscmi_brief.md'), lscmiBriefMd);
        if (lscmiScoringMd) fs.writeFileSync(path.join(pDir, 'lscmi_scoring.md'), lscmiScoringMd);
        if (actionPlanMd) fs.writeFileSync(path.join(pDir, 'action_plan.md'), actionPlanMd);
        if (transcriptText) fs.writeFileSync(path.join(pDir, 'lscmi_transcript.txt'), transcriptText);

        // Compute canonical lscmi_client_id matching data/ prefix
        const lscmiClientId = computeBestLscmiClientId(allFolderDocFiles.length ? allFolderDocFiles : person.files, `${slug}_${person.location || 'Charleston'}`);

        // Preserve any locally-entered manual notes/evaluations from existing case_management_notes.json if stored outside SQLite
        const diskCm = readDiskJson(path.join(pDir, 'case_management_notes.json'), {}) || {};
        const existingManualNotes = Array.isArray(diskCm.manual_folder_notes) ? diskCm.manual_folder_notes : [];

        // Gather Case Management notes & evaluations (match FULL name or exact apricot_id — zero first-name leaks)
        const cmNotes = person.user_ids.length
            ? safeQueryAll(`SELECT * FROM case_notes WHERE user_id IN (${person.user_ids.map(() => '?').join(',')}) ORDER BY session_date DESC, id DESC`, person.user_ids)
            : [];

        const nameMatchers = Array.from(new Set([person.name, ...person.aliases_seen].filter(n => n && n.length >= 3)));
        const nameClauses = nameMatchers.map(() => 'LOWER(session_title) LIKE ?');
        const nameParams = nameMatchers.map(n => `%${n.toLowerCase()}%`);
        const apricotIdParams = person.apricot_ids.length ? person.apricot_ids : [];
        const apricotClause = apricotIdParams.length ? `apricot_id IN (${apricotIdParams.map(() => '?').join(',')})` : '0 = 1';
        const whereCmEval = nameClauses.length ? `(${nameClauses.join(' OR ')} OR ${apricotClause})` : apricotClause;

        const cmEvals = safeQueryAll(`
            SELECT id, location, session_title, cm_name, apricot_id, session_type, summary_markdown, feedback, next_session_recommendations, created_at
            FROM case_management_evaluations
            WHERE ${whereCmEval}
            ORDER BY created_at DESC
        `, [...nameParams, ...apricotIdParams]);

        const finalCmNotes = cmNotes.length > 0 ? cmNotes : (Array.isArray(diskCm.case_notes) ? diskCm.case_notes : []);
        const finalCmEvals = cmEvals.length > 0 ? cmEvals : (Array.isArray(diskCm.cm_session_evaluations) ? diskCm.cm_session_evaluations : []);

        fs.writeFileSync(path.join(pDir, 'case_management_notes.json'), JSON.stringify({
            case_notes: finalCmNotes,
            cm_session_evaluations: finalCmEvals,
            manual_folder_notes: existingManualNotes
        }, null, 2));

        // Gather historical Apricot records (evaluations + all chronological processed notes)
        const matchingApricotEvals = apricotEvals.filter(ae => {
            if (ae.record_id && person.apricot_ids.includes(String(ae.record_id))) return true;
            const full = String(ae.full_name || '').trim().toLowerCase();
            return lowerNames.includes(full) || resolveCanonicalSlug(ae.full_name || '') === slug;
        });
        const evalRecordIds = matchingApricotEvals.map(a => String(a.record_id)).filter(Boolean);
        const allApricotIds = Array.from(new Set([...person.apricot_ids, ...evalRecordIds]));
        if (!person.apricot_id && allApricotIds.length > 0) person.apricot_id = allApricotIds[0];

        const noteClauses = ['LOWER(TRIM(COALESCE(first_name,\'\') || \' \' || COALESCE(last_name,\'\'))) IN (' + lowerNames.map(() => '?').join(',') + ')'];
        const noteParams = [...lowerNames];
        if (allApricotIds.length > 0) {
            noteClauses.push(`CAST(record_id AS TEXT) IN (${allApricotIds.map(() => '?').join(',')})`);
            noteParams.push(...allApricotIds);
        }
        const apricotNotes = safeQueryAll(`
            SELECT id, record_id, first_name, last_name, activity_date, staff_name, service_context, interaction_type, note_text, center_location, program_enrollment, source, processed_at
            FROM apricot_processed_notes
            WHERE ${noteClauses.join(' OR ')}
            ORDER BY activity_date DESC, id DESC
        `, noteParams);

        const diskApricot = readDiskJson(path.join(pDir, 'apricot_history.json'), {}) || {};
        const finalApricotEvals = matchingApricotEvals.length > 0 ? matchingApricotEvals : (Array.isArray(diskApricot.evaluations) ? diskApricot.evaluations : []);
        const finalApricotNotes = apricotNotes.length > 0 ? apricotNotes : (Array.isArray(diskApricot.processed_notes) ? diskApricot.processed_notes : []);
        const finalApricotIds = allApricotIds.length > 0 ? allApricotIds : (Array.isArray(diskApricot.apricot_ids) ? diskApricot.apricot_ids : []);
        if (!person.apricot_id && finalApricotIds.length > 0) person.apricot_id = finalApricotIds[0];

        fs.writeFileSync(path.join(pDir, 'apricot_history.json'), JSON.stringify({
            participant_key: slug,
            participant_name: person.name,
            apricot_ids: finalApricotIds,
            evaluations: finalApricotEvals,
            notes_count: finalApricotNotes.length,
            processed_notes: finalApricotNotes,
            updated_at: new Date().toISOString()
        }, null, 2));

        fs.writeFileSync(path.join(pDir, 'reentry_history.json'), JSON.stringify({
            participant_key: slug,
            participant_name: person.name,
            client_records: finalReentryClients,
            sessions: finalReentrySessions,
            goals: finalReentryGoals,
            case_plans: finalReentryCasePlans,
            updated_at: new Date().toISOString()
        }, null, 2));

        // Archive Program Records (profiles, triggers, points, drug tests, benefits, resumes, DB documents)
        const userIdClause = person.user_ids.length ? `user_id IN (${person.user_ids.map(() => '?').join(',')})` : null;
        const profileRecords = userIdClause ? safeQueryAll(`SELECT * FROM participant_profiles WHERE ${userIdClause}`, person.user_ids) : [];
        const casePlanTriggers = userIdClause ? safeQueryAll(`SELECT * FROM case_plan_triggers WHERE ${userIdClause}`, person.user_ids) : [];
        const dailyPoints = userIdClause ? safeQueryAll(`SELECT * FROM daily_points WHERE ${userIdClause} ORDER BY date DESC`, person.user_ids) : [];
        const drugTests = userIdClause ? safeQueryAll(`SELECT * FROM drug_tests WHERE ${userIdClause} ORDER BY test_date DESC, id DESC`, person.user_ids) : [];
        const benefits = userIdClause ? safeQueryAll(`SELECT * FROM participant_benefits WHERE ${userIdClause} ORDER BY updated_at DESC`, person.user_ids) : [];
        const resumes = userIdClause ? safeQueryAll(`SELECT * FROM resumes WHERE ${userIdClause} ORDER BY updated_at DESC`, person.user_ids) : [];
        const dbDocuments = userIdClause ? safeQueryAll(`SELECT * FROM documents WHERE ${userIdClause} ORDER BY uploaded_at DESC`, person.user_ids) : [];
        const legacyBriefcaseCount = userIdClause ? (safeQueryGet(`SELECT COUNT(*) as n FROM briefcase_items WHERE ${userIdClause}`, person.user_ids)?.n || 0) : 0;
        const legacyGateCount = userIdClause ? (safeQueryGet(`SELECT COUNT(*) as n FROM gate_criteria WHERE ${userIdClause}`, person.user_ids)?.n || 0) : 0;

        const diskProg = readDiskJson(path.join(pDir, 'program_records.json'), {}) || {};
        const finalProfileRecords = profileRecords.length > 0 ? profileRecords : (Array.isArray(diskProg.profile_records) ? diskProg.profile_records : []);
        const finalCasePlanTriggers = casePlanTriggers.length > 0 ? casePlanTriggers : (Array.isArray(diskProg.case_plan_triggers) ? diskProg.case_plan_triggers : []);
        const finalDailyPoints = dailyPoints.length > 0 ? dailyPoints : (Array.isArray(diskProg.daily_points) ? diskProg.daily_points : []);
        const finalDrugTests = drugTests.length > 0 ? drugTests : (Array.isArray(diskProg.drug_tests) ? diskProg.drug_tests : []);
        const finalBenefits = benefits.length > 0 ? benefits : (Array.isArray(diskProg.benefits) ? diskProg.benefits : []);
        const finalResumes = resumes.length > 0 ? resumes : (Array.isArray(diskProg.resumes) ? diskProg.resumes : []);
        const finalDbDocuments = dbDocuments.length > 0 ? dbDocuments : (Array.isArray(diskProg.db_documents) ? diskProg.db_documents : []);
        const finalLegacyBriefcaseCount = legacyBriefcaseCount > 0 ? legacyBriefcaseCount : (Number(diskProg.legacy_briefcase_items_count) || 0);
        const finalLegacyGateCount = legacyGateCount > 0 ? legacyGateCount : (Number(diskProg.legacy_gate_criteria_count) || 0);

        fs.writeFileSync(path.join(pDir, 'program_records.json'), JSON.stringify({
            participant_key: slug,
            participant_name: person.name,
            profile_records: finalProfileRecords,
            case_plan_triggers: finalCasePlanTriggers,
            daily_points: finalDailyPoints,
            drug_tests: finalDrugTests,
            benefits: finalBenefits,
            resumes: finalResumes,
            db_documents: finalDbDocuments,
            legacy_briefcase_items_count: finalLegacyBriefcaseCount,
            legacy_gate_criteria_count: finalLegacyGateCount,
            updated_at: new Date().toISOString()
        }, null, 2));

        // Match SkillCat progress across ALL historical snapshots + latest snapshot
        const nameParts = person.name.toLowerCase().split(/\s+/).filter(Boolean);
        const matchesSkillCatEmployee = (emp) => {
            const eName = String(emp.fullname || emp.name || emp.employee_name || '').toLowerCase().trim();
            if (!eName || nameParts.length === 0) return false;
            if (nameParts.length === 1) return eName.split(/\s+/)[0] === nameParts[0];
            return nameParts.every(part => eName.includes(part));
        };

        const historicalSnapshots = [];
        let latestMatchedSkillCatEmp = null;
        for (const snapKey of sortedSnapshotKeys) {
            const snapObj = scSnapshots[snapKey];
            if (!snapObj || typeof snapObj !== 'object') continue;
            const match = Object.values(snapObj).find(e => e && typeof e === 'object' && matchesSkillCatEmployee(e));
            if (match) {
                const mods = match.completed_courses || match.modules || [];
                const totalCourses = Number(match.total_courses ?? (Array.isArray(mods) ? mods.length : 0));
                historicalSnapshots.push({
                    date: snapKey,
                    pathway: match.pathway || 'HVAC',
                    total_courses: totalCourses,
                    total_hours: Number((totalCourses * 1.5).toFixed(1)),
                    completed_last_5_working_days: Number(match.completed_last_5_working_days || 0),
                    daily_delta: Number(match.daily_delta || 0),
                    stalled: Boolean(match.flagged_2_working_days || totalCourses === 0)
                });
                latestMatchedSkillCatEmp = match;
            }
        }

        let skillcatRecord = {
            pathway: 'HVAC',
            total_hours: 0,
            completed_count: 0,
            completed_modules: [],
            recent_modules_last_5_days: [],
            pathway_breakdown: {},
            portfolio_link: '',
            stalled: false,
            flags: [],
            historical_snapshots: historicalSnapshots.slice().reverse()
        };
        const latestMatch = (latestSkillCatEmployees.find(matchesSkillCatEmployee)) || latestMatchedSkillCatEmp;
        if (latestMatch) {
            const mods = latestMatch.completed_courses || latestMatch.modules || [];
            const totalCourses = Number(latestMatch.total_courses ?? (Array.isArray(mods) ? mods.length : 0));
            skillcatRecord = {
                userid: latestMatch.userid || '',
                pathway: latestMatch.pathway || 'HVAC',
                pathway_breakdown: latestMatch.pathway_breakdown || {},
                learning_plans: latestMatch.learning_plans || [],
                portfolio_link: latestMatch.portfolio_link || '',
                last_login: latestMatch.last_login || '',
                latest_completion_date: latestMatch.latest_completion_date || null,
                total_hours: Number((totalCourses * 1.5).toFixed(1)),
                completed_count: totalCourses,
                completed_last_5_working_days: Number(latestMatch.completed_last_5_working_days || 0),
                daily_delta: Number(latestMatch.daily_delta || 0),
                completed_modules: Array.isArray(mods) ? mods : [],
                recent_modules_last_5_days: latestMatch.recent_modules_last_5_days || [],
                stalled: Boolean(latestMatch.flagged_2_working_days || totalCourses === 0),
                flags: Array.isArray(latestMatch.pathway_flags) ? latestMatch.pathway_flags : [],
                historical_snapshots: historicalSnapshots.slice().reverse()
            };
        } else {
            const diskSc = readDiskJson(path.join(pDir, 'skillcat_progress.json'), null);
            if (diskSc && (Number(diskSc.completed_count) > 0 || (Array.isArray(diskSc.historical_snapshots) && diskSc.historical_snapshots.length > 0) || diskSc.userid)) {
                skillcatRecord = diskSc;
            }
        }
        fs.writeFileSync(path.join(pDir, 'skillcat_progress.json'), JSON.stringify(skillcatRecord, null, 2));

        // Load or initialize Unified Briefcase
        const existingRow = safeQueryGet('SELECT briefcase_json FROM unified_briefcases WHERE participant_key = ?', [slug]);
        let existingBriefcase = null;
        if (existingRow && existingRow.briefcase_json) {
            try { existingBriefcase = JSON.parse(existingRow.briefcase_json); } catch (e) {}
        }
        if (!existingBriefcase) {
            existingBriefcase = readDiskJson(path.join(pDir, 'briefcase.json'), null);
        }

        const unifiedBriefcase = synthesizeBriefcaseFromLoadedInfo({
            participantKey: slug,
            participantName: person.name,
            location: person.location,
            track: person.track,
            userId: person.user_id,
            clientId: person.client_id,
            existingBriefcase,
            textSources: [lscmiBriefMd, actionPlanMd, transcriptText, ...finalCmNotes.map(n => n.content)],
            skillcatRecord
        });
        fs.writeFileSync(path.join(pDir, 'briefcase.json'), JSON.stringify(unifiedBriefcase, null, 2));

        // Load Action Plan Feedback Loop history
        const feedbackLoops = safeQueryAll('SELECT * FROM action_plan_feedback_loops WHERE participant_key = ? ORDER BY created_at DESC', [slug]);
        const diskFeedback = readDiskJson(path.join(pDir, 'feedback_loop_log.json'), {}) || {};
        const finalFeedbackLoops = feedbackLoops.length > 0 ? feedbackLoops : (Array.isArray(diskFeedback.history) ? diskFeedback.history : []);
        const feedbackLoopData = {
            participant_key: slug,
            participant_name: person.name,
            current_agreement_status: finalFeedbackLoops[0] ? finalFeedbackLoops[0].agreement_status : (diskFeedback.current_agreement_status || (actionPlanMd ? 'agreed' : 'pending_review')),
            history: finalFeedbackLoops
        };
        fs.writeFileSync(path.join(pDir, 'feedback_loop_log.json'), JSON.stringify(feedbackLoopData, null, 2));

        // Load Screening Consultation history
        const screenings = safeQueryAll('SELECT * FROM screening_consultations WHERE participant_key = ? ORDER BY created_at DESC', [slug]);
        const diskScreening = readDiskJson(path.join(pDir, 'screening_consultation.json'), {}) || {};
        const finalScreenings = screenings.length > 0 ? screenings : (Array.isArray(diskScreening.history) ? diskScreening.history : []);
        fs.writeFileSync(path.join(pDir, 'screening_consultation.json'), JSON.stringify({
            participant_key: slug,
            latest_screening: finalScreenings[0] || diskScreening.latest_screening || null,
            history: finalScreenings
        }, null, 2));

        // Load Voice Profile
        const voiceProf = safeQueryGet('SELECT * FROM voice_profiles WHERE profile_id = ?', [`participant_${slug}`]);
        fs.writeFileSync(path.join(pDir, 'voice_profile.json'), JSON.stringify(voiceProf || {
            profile_id: `participant_${slug}`,
            person_type: 'participant',
            name: person.name,
            enrolled: Boolean(transcriptText),
            source_type: 'lscmi_interview',
            note: transcriptText ? 'Voice profile anchored from LS/CMI assessment recording' : 'Pending LS/CMI audio recording'
        }, null, 2));

        // Build/merge historical timeline (idempotent event_key milestones + preserved manual events)
        const historyLogPath = path.join(pDir, 'history_log.json');
        let preservedEvents = [];
        if (fs.existsSync(historyLogPath)) {
            try {
                const parsedHist = JSON.parse(fs.readFileSync(historyLogPath, 'utf8'));
                preservedEvents = Array.isArray(parsedHist) ? parsedHist : (Array.isArray(parsedHist.events) ? parsedHist.events : []);
            } catch (e) {}
        }
        const eventByKey = new Map();
        const unkeyedEvents = [];
        for (const ev of preservedEvents) {
            if (!ev) continue;
            if (ev.event_key) eventByKey.set(ev.event_key, ev);
            else unkeyedEvents.push(ev);
        }

        const addMilestone = (eventKey, evObj) => {
            if (!eventByKey.has(eventKey)) {
                eventByKey.set(eventKey, {
                    id: `ms_${eventKey}`,
                    event_key: eventKey,
                    ...evObj
                });
            }
        };

        for (const docMeta of docSortByMtime) {
            addMilestone(`doc:${docMeta.fname}`, {
                timestamp: new Date(docMeta.mtimeMs).toISOString(),
                category: 'document',
                action: `Archived ${inferDocTypeFromFilename(docMeta.fname).replace(/_/g, ' ')}`,
                summary: `Document stored in folder: ${docMeta.fname}`,
                filename: docMeta.fname,
                snapshot_file: '',
                actor: 'Archive Sync'
            });
        }
        if (finalApricotNotes.length > 0) {
            const newestDate = finalApricotNotes[0]?.activity_date || finalApricotEvals[0]?.updated_at || new Date().toISOString();
            addMilestone('apricot:summary', {
                timestamp: new Date(newestDate).toISOString(),
                category: 'apricot',
                action: 'Apricot Historical Record Synced',
                summary: `${finalApricotNotes.length} chronological Apricot note(s) archived (${finalApricotEvals[0]?.case_plan_status || 'Historical Record'}).`,
                filename: 'apricot_history.json',
                snapshot_file: '',
                actor: 'Apricot Sync'
            });
        }
        for (const cn of finalCmNotes) {
            addMilestone(`casenote:${cn.id}`, {
                timestamp: new Date(cn.session_date || cn.created_at || Date.now()).toISOString(),
                category: 'case_note',
                action: `Case Note (${cn.note_type || 'Session'})`,
                summary: String(cn.content || '').slice(0, 220),
                filename: 'case_management_notes.json',
                snapshot_file: '',
                actor: cn.author_name || 'Turn90 Staff'
            });
        }
        for (const ev of finalCmEvals) {
            addMilestone(`cmeval:${ev.id}`, {
                timestamp: new Date(ev.created_at || Date.now()).toISOString(),
                category: 'cm_eval',
                action: `CM Evaluation: ${ev.session_title || '1-on-1 Session'}`,
                summary: String(ev.feedback || ev.summary_markdown || '').slice(0, 220),
                filename: 'case_management_notes.json',
                snapshot_file: '',
                actor: ev.cm_name || 'Turn90 CM'
            });
        }
        for (const rs of finalReentrySessions) {
            addMilestone(`reentry_session:${rs.id}`, {
                timestamp: new Date(rs.session_date || rs.created_at || Date.now()).toISOString(),
                category: 'reentry_session',
                action: `Reentry Session: ${rs.session_title || 'Check-in'}`,
                summary: String(rs.notes_text || rs.next_conversation_topics || '').slice(0, 220),
                filename: 'reentry_history.json',
                snapshot_file: '',
                actor: 'Reentry Navigator'
            });
        }
        for (const dt of finalDrugTests) {
            addMilestone(`drugtest:${dt.id}`, {
                timestamp: new Date(dt.test_date || dt.created_at || Date.now()).toISOString(),
                category: 'drug_test',
                action: `Drug Screen: ${dt.result || 'Recorded'}`,
                summary: dt.notes || dt.substances_detected || '',
                filename: 'program_records.json',
                snapshot_file: '',
                actor: dt.administered_by || 'Turn90 Staff'
            });
        }
        for (const scItem of finalScreenings) {
            addMilestone(`screening:${scItem.id}`, {
                timestamp: new Date(scItem.created_at || Date.now()).toISOString(),
                category: 'screening',
                action: `Screening Consultation (${scItem.eligibility_decision || 'Reviewed'})`,
                summary: scItem.ineligibility_reason || '',
                filename: 'screening_consultation.json',
                snapshot_file: '',
                actor: scItem.created_by || 'Turn90 Staff'
            });
        }
        for (const fb of finalFeedbackLoops) {
            addMilestone(`feedback_loop:${fb.id}`, {
                timestamp: new Date(fb.created_at || Date.now()).toISOString(),
                category: 'feedback_loop',
                action: `Action Plan Feedback Loop (${fb.agreement_status})`,
                summary: fb.agreed_replacement_target ? `Adjusted to: ${fb.agreed_replacement_target} (${fb.selected_toolkit_tool || ''})` : (fb.participant_objection_quote || ''),
                filename: 'feedback_loop_log.json',
                snapshot_file: '',
                actor: fb.logged_by || 'Turn90 Staff'
            });
        }

        const mergedEvents = [...unkeyedEvents, ...Array.from(eventByKey.values())]
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        fs.writeFileSync(historyLogPath, JSON.stringify({
            participant_key: slug,
            updated_at: new Date().toISOString(),
            events: mergedEvents
        }, null, 2));

        // Build Caseload Evaluation Summary
        const flags = [];
        if (!unifiedBriefcase.waitlist_ready) {
            const missingWaitlist = unifiedBriefcase.waitlist_checklist.filter(i => !i.ready).map(i => i.title);
            flags.push({
                code: 'FLAG-WAITLIST-GAP',
                severity: 'warning',
                message: `${unifiedBriefcase.waitlist_met_count}/9 First Shift Waitlist Briefcase items ready. Missing: ${missingWaitlist.slice(0, 3).join(', ')}`
            });
        }
        if (feedbackLoopData.current_agreement_status === 'disagreed_pending_loop') {
            flags.push({
                code: 'FLAG-FEEDBACK-LOOP',
                severity: 'high',
                message: 'Participant disagreed with Action Plan target — requires collaborative 4-step Feedback Loop in next Case Management session.'
            });
        }
        if (person.track === 'first_shift' && finalCmNotes.length === 0 && finalCmEvals.length === 0 && existingManualNotes.length === 0) {
            flags.push({
                code: 'FLAG-CM-CADENCE',
                severity: 'warning',
                message: 'No 1-on-1 Case Management session note logged in participant folder.'
            });
        }
        if (skillcatRecord.stalled) {
            flags.push({
                code: 'FLAG-SKILLCAT-STALL',
                severity: 'warning',
                message: `SkillCat stalled on ${skillcatRecord.pathway} pathway (0 modules completed).`
            });
        }

        const hasLegacyCaseBriefs = allFolderDocFiles.some(f => f.toLowerCase().includes('_case_brief_'));
        const caseloadEval = {
            participant_key: slug,
            participant_name: person.name,
            location: person.location,
            track: person.track,
            lscmi_client_id: lscmiClientId,
            folder_path: `data/participants/${slug}`,
            has_lscmi_brief: Boolean(lscmiBriefMd),
            has_lscmi_scoring: Boolean(lscmiScoringMd),
            has_action_plan: Boolean(actionPlanMd),
            has_legacy_case_briefs: hasLegacyCaseBriefs,
            action_plan_agreement: feedbackLoopData.current_agreement_status,
            waitlist_ready: unifiedBriefcase.waitlist_ready,
            waitlist_score: `${unifiedBriefcase.waitlist_met_count}/9`,
            medical_appointments_applicable: unifiedBriefcase.medical_appointments_applicable,
            skillcat_pathway: unifiedBriefcase.items.skillcat_pathway.value,
            skillcat_modules_completed: skillcatRecord.completed_count,
            cm_notes_count: finalCmNotes.length + finalCmEvals.length + existingManualNotes.length,
            apricot_notes_count: finalApricotNotes.length,
            reentry_sessions_count: finalReentrySessions.length,
            history_events_count: mergedEvents.length,
            documents_count: allFolderDocFiles.length,
            data_evaluation_flags: flags,
            updated_at: new Date().toISOString()
        };
        fs.writeFileSync(path.join(pDir, 'caseload_evaluation.json'), JSON.stringify(caseloadEval, null, 2));

        // Write Profile JSON
        const profileData = {
            participant_key: slug,
            name: person.name,
            location: person.location,
            track: person.track,
            status: person.status,
            user_id: person.user_id,
            client_id: person.client_id,
            apricot_id: person.apricot_id,
            phone: person.phone,
            email: person.email,
            lscmi_client_id: lscmiClientId,
            folder_slug: slug,
            folder_path: `data/participants/${slug}`,
            has_lscmi_brief: Boolean(lscmiBriefMd),
            has_lscmi_scoring: Boolean(lscmiScoringMd),
            has_action_plan: Boolean(actionPlanMd),
            has_legacy_case_briefs: hasLegacyCaseBriefs,
            waitlist_ready: unifiedBriefcase.waitlist_ready,
            waitlist_met_count: unifiedBriefcase.waitlist_met_count,
            data_flags_count: flags.length,
            cm_notes_count: caseloadEval.cm_notes_count,
            apricot_notes_count: finalApricotNotes.length,
            reentry_sessions_count: finalReentrySessions.length,
            history_events_count: mergedEvents.length,
            documents_count: allFolderDocFiles.length,
            updated_at: new Date().toISOString()
        };
        fs.writeFileSync(path.join(pDir, 'profile.json'), JSON.stringify(profileData, null, 2));

        summaryList.push({
            ...profileData,
            caseload_eval: caseloadEval,
            briefcase_summary: {
                waitlist_ready: unifiedBriefcase.waitlist_ready,
                waitlist_met_count: unifiedBriefcase.waitlist_met_count,
                has_chronic_health_condition: unifiedBriefcase.has_chronic_health_condition,
                medical_appointments_applicable: unifiedBriefcase.medical_appointments_applicable
            }
        });
    }

    summaryList.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    _cachedFolderSummary = summaryList;
    _cachedFolderSummaryAt = Date.now();
    return summaryList;
}

function getParticipantFolderBundle(slugOrName) {
    const slug = resolveCanonicalSlug(slugOrName);
    const pDir = path.join(participantsRootDir, slug);
    const needsSync = !fs.existsSync(pDir)
        || (!fs.existsSync(path.join(pDir, 'history_log.json')) && !fs.existsSync(path.join(pDir, 'apricot_history.json')));
    if (needsSync) {
        syncAllParticipantFolders({ force: true });
    }
    if (!fs.existsSync(pDir)) {
        return null;
    }
    const readJsonSafe = (f, fallback = {}) => {
        const p = path.join(pDir, f);
        if (!fs.existsSync(p)) return fallback;
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
    };
    const readTextSafe = (f) => {
        const p = path.join(pDir, f);
        if (!fs.existsSync(p)) return '';
        try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
    };

    const profile = readJsonSafe('profile.json');
    const docsDir = path.join(pDir, 'documents');
    const rawDocFiles = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter(f => !f.startsWith('.')) : [];
    const lscmiClientId = profile.lscmi_client_id || computeBestLscmiClientId(rawDocFiles, `${slug}_${profile.location || 'Charleston'}`);
    const categorized = categorizeParticipantDocuments(pDir, slug, lscmiClientId);

    return {
        participant_key: slug,
        lscmi_client_id: lscmiClientId,
        lscmi_files: categorized.lscmi_files,
        lscmi_documents: categorized.lscmi_documents,
        folder_path: `data/participants/${slug}`,
        profile,
        briefcase: readJsonSafe('briefcase.json'),
        caseload_evaluation: readJsonSafe('caseload_evaluation.json'),
        screening_consultation: readJsonSafe('screening_consultation.json'),
        feedback_loop_log: readJsonSafe('feedback_loop_log.json'),
        skillcat_progress: readJsonSafe('skillcat_progress.json'),
        case_management_notes: readJsonSafe('case_management_notes.json'),
        apricot_history: readJsonSafe('apricot_history.json', { evaluations: [], processed_notes: [] }),
        reentry_history: readJsonSafe('reentry_history.json', { client_records: [], sessions: [], goals: [], case_plans: [] }),
        program_records: readJsonSafe('program_records.json', {}),
        history_log: readJsonSafe('history_log.json', { participant_key: slug, events: [] }),
        history_files: categorized.history_files,
        lscmi_discrepancies: readJsonSafe('lscmi_discrepancies.json', null),
        lscmi_158_answers: readJsonSafe('lscmi_158_answers.json', null),
        voice_profile: readJsonSafe('voice_profile.json'),
        lscmi_brief_md: readTextSafe('lscmi_brief.md'),
        lscmi_scoring_md: readTextSafe('lscmi_scoring.md'),
        action_plan_md: readTextSafe('action_plan.md'),
        lscmi_transcript_txt: readTextSafe('lscmi_transcript.txt'),
        document_files: categorized.docFiles
    };
}

function saveParticipantEditableDocument(slugOrName, { docType, content, reason = '', actor = 'Turn90 Staff' } = {}) {
    const SPECS = {
        brief: { suffix: '_final_case_brief.md', canonical: 'lscmi_brief.md', label: 'LS/CMI Case Brief', flagKey: 'has_lscmi_brief' },
        action_plan: { suffix: '_participant_case_plan.md', canonical: 'action_plan.md', label: 'First Shift Action Plan', flagKey: 'has_action_plan' },
        scoring: { suffix: '_final_scoring_form.md', canonical: 'lscmi_scoring.md', label: 'LS/CMI Scoring Form', flagKey: 'has_lscmi_scoring' }
    };
    const spec = SPECS[docType];
    if (!spec) {
        throw new Error(`Unsupported docType "${docType}". Expected "brief", "action_plan", or "scoring".`);
    }
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Document content cannot be empty.');
    }

    const slug = resolveCanonicalSlug(slugOrName);
    const pDir = path.join(participantsRootDir, slug);
    const docsDir = path.join(pDir, 'documents');
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

    let profile = {};
    const profilePath = path.join(pDir, 'profile.json');
    if (fs.existsSync(profilePath)) {
        try { profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')); } catch (e) {}
    }

    const existingDocs = fs.readdirSync(docsDir).filter(f => !f.startsWith('.'));
    const lscmiClientId = profile.lscmi_client_id || computeBestLscmiClientId(existingDocs, `${slug}_${profile.location || 'Charleston'}`);
    const dataFilename = `${lscmiClientId}${spec.suffix}`;
    const dataFilePath = path.join(dataDir, dataFilename);
    const canonicalPath = path.join(pDir, spec.canonical);
    const folderDocPath = path.join(docsDir, dataFilename);

    // Snapshot previous version before overwriting
    const priorSource = fs.existsSync(dataFilePath) ? dataFilePath : (fs.existsSync(canonicalPath) ? canonicalPath : null);
    let snapshotFile = null;
    if (priorSource) {
        snapshotFile = archiveParticipantDocumentVersion(slug, {
            docType,
            filename: dataFilename,
            sourcePath: priorSource,
            summary: `Archived previous ${spec.label} before direct edit${reason ? `: ${reason}` : ''}`,
            actor
        });
    }

    fs.writeFileSync(dataFilePath, content, 'utf8');
    fs.writeFileSync(canonicalPath, content, 'utf8');
    fs.writeFileSync(folderDocPath, content, 'utf8');

    if (fs.existsSync(profilePath)) {
        try {
            profile[spec.flagKey] = true;
            profile.lscmi_client_id = lscmiClientId;
            profile.updated_at = new Date().toISOString();
            fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
        } catch (e) {}
    }

    appendParticipantHistoryEvent(slug, {
        category: 'document_edit',
        action: `Updated ${spec.label}`,
        summary: reason ? reason : `Direct edit saved to ${dataFilename}`,
        filename: dataFilename,
        snapshot_file: snapshotFile || '',
        actor
    });

    invalidateFolderIndexCache();

    return {
        slug,
        lscmi_client_id: lscmiClientId,
        docType,
        dataFilename,
        dataFilePath,
        folderDocPath,
        canonicalPath,
        snapshotFile
    };
}

function updateParticipantUnifiedBriefcase(slugOrName, updates = {}) {
    const slug = resolveCanonicalSlug(slugOrName);
    const bundle = getParticipantFolderBundle(slug);
    const existing = (bundle && bundle.briefcase && bundle.briefcase.items) ? bundle.briefcase : null;
    const profile = (bundle && bundle.profile) || { name: slugOrName, location: 'Charleston', track: 'reentry_nav' };

    const state = existing || synthesizeBriefcaseFromLoadedInfo({
        participantKey: slug,
        participantName: profile.name || slugOrName,
        location: profile.location || 'Charleston',
        track: profile.track || 'reentry_nav',
        userId: profile.user_id || null,
        clientId: profile.client_id || null
    });

    if (updates.has_chronic_health_condition !== undefined) {
        state.has_chronic_health_condition = updates.has_chronic_health_condition;
    }
    if (updates.dl_is_suspended !== undefined) {
        state.dl_is_suspended = updates.dl_is_suspended;
    }
    if (updates.child_support_applicable !== undefined) {
        state.child_support_applicable = updates.child_support_applicable;
    }
    if (updates.supervision_officer_details !== undefined) {
        state.supervision_officer_details = updates.supervision_officer_details;
    }
    if (updates.chronic_condition_details !== undefined) {
        state.chronic_condition_details = updates.chronic_condition_details;
    }
    if (updates.manual_notes !== undefined) {
        state.manual_notes = updates.manual_notes;
    }

    if (updates.items && typeof updates.items === 'object') {
        for (const [k, v] of Object.entries(updates.items)) {
            const val = typeof v === 'object' ? v.value : v;
            const prevItem = state.items[k] || {};
            const notes = typeof v === 'object'
                ? (v.notes !== undefined ? v.notes : (prevItem.notes || ''))
                : (prevItem.notes || '');
            const src = (typeof v === 'object' && v.source) ? v.source : (updates.default_source || 'manual_dropdown');
            state.items[k] = {
                value: val,
                notes,
                source: src,
                updated_at: new Date().toISOString()
            };
            // Check if chronic_health_and_meds option sets has_chronic_health_condition
            if (k === 'chronic_health_and_meds') {
                if (val === 'no_chronic_conditions_na') {
                    state.has_chronic_health_condition = 'no';
                } else {
                    state.has_chronic_health_condition = 'yes';
                }
            }
        }
    }

    evaluateWaitlistReadiness(state);

    db.prepare(`
        INSERT OR REPLACE INTO unified_briefcases (
            participant_key, user_id, client_id, participant_name, location, track,
            has_chronic_health_condition, dl_is_suspended, child_support_applicable,
            waitlist_ready, waitlist_met_count, briefcase_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
        slug,
        state.user_id || null,
        state.client_id || null,
        state.participant_name || slugOrName,
        state.location || 'Charleston',
        state.track || 'reentry_nav',
        state.has_chronic_health_condition || 'no',
        state.dl_is_suspended || 'no',
        state.child_support_applicable || 'no',
        state.waitlist_ready ? 1 : 0,
        state.waitlist_met_count || 0,
        JSON.stringify(state)
    );

    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, 'briefcase.json'), JSON.stringify(state, null, 2));

    const updatedKeys = updates.items ? Object.keys(updates.items).join(', ') : 'settings';
    appendParticipantHistoryEvent(slug, {
        category: 'briefcase',
        action: updates.history_action || 'Updated Unified Briefcase',
        summary: `Updated ${updatedKeys} (Waitlist readiness: ${state.waitlist_met_count}/9).`,
        filename: 'briefcase.json',
        actor: updates.actor || 'Turn90 Staff'
    });
    invalidateFolderIndexCache();

    return state;
}

module.exports = {
    PARTICIPANT_SLUG_ALIASES,
    UNIFIED_BRIEFCASE_SCHEMA,
    sanitizeParticipantSlug,
    resolveCanonicalSlug,
    invalidateFolderIndexCache,
    appendParticipantHistoryEvent,
    archiveParticipantDocumentVersion,
    saveParticipantEditableDocument,
    syncAllParticipantFolders,
    getParticipantFolderBundle,
    updateParticipantUnifiedBriefcase,
    synthesizeBriefcaseFromLoadedInfo,
    evaluateWaitlistReadiness
};
