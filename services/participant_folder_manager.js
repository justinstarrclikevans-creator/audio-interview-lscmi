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

function sanitizeParticipantSlug(name) {
    return String(name || 'Unknown_Participant')
        .replace(/\b(Charleston|Columbia|Spartanburg|First Shift|Reentry|Turn90)\b/gi, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'Unknown_Participant';
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

// Build or refresh every participant's dedicated folder under data/participants/<Participant_Slug>/
function syncAllParticipantFolders() {
    const skillcatHistory = loadSkillCatHistory();
    const apricotCache = loadApricotFeedbackCache();
    const allDataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

    // Collect unified directory of participants across DB users, reentry_clients, and data/ assessment files
    const registry = new Map();

    const registerPerson = (rawName, info = {}) => {
        if (!rawName) return null;
        const cleanName = String(rawName)
            .replace(/^\d+_/, '')
            .replace(/_(Charleston|Columbia|Spartanburg)$/i, '')
            .replace(/_/g, ' ')
            .trim();
        if (!cleanName || cleanName.length < 2 || /^(Turn90|Supervisor|Charleston|Columbia|Spartanburg|Reentry|Jennifer Jeanquart|Jenn Jeanquart|Diyoung Dantzler|Terry Brooks|Justin Evans|Daisy Boynton|Terrence Brown|Terrance Brown|Keyzelle Thomas|Test |Sample )/i.test(cleanName)) {
            return null;
        }
        const slug = sanitizeParticipantSlug(cleanName);
        if (!registry.has(slug)) {
            registry.set(slug, {
                participant_key: slug,
                name: cleanName,
                location: info.location || 'Charleston',
                track: info.track || 'first_shift',
                status: info.status || 'active',
                user_id: info.user_id || null,
                client_id: info.client_id || null,
                apricot_id: info.apricot_id || null,
                phone: info.phone || '',
                email: info.email || '',
                files: []
            });
        } else {
            const existing = registry.get(slug);
            if (info.user_id && !existing.user_id) existing.user_id = info.user_id;
            if (info.client_id && !existing.client_id) existing.client_id = info.client_id;
            if (info.location && existing.location === 'Charleston') existing.location = info.location;
            if (info.track) existing.track = info.track;
            if (info.apricot_id && !existing.apricot_id) existing.apricot_id = info.apricot_id;
            if (info.phone && !existing.phone) existing.phone = info.phone;
            if (info.email && !existing.email) existing.email = info.email;
        }
        return registry.get(slug);
    };

    // 1. From users table (role = 'participant')
    const dbParticipants = db.prepare(`
        SELECT u.*, p.overall_status, p.record_id, p.dl_status, p.housing_status, p.child_support_status
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant'
    `).all();
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
    const reentryClients = db.prepare('SELECT * FROM reentry_clients').all();
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

    // 3. From data/ files (LS/CMI briefs, scoring forms, transcripts, action plans, reentry guides)
    const SUFFIX_PATTERNS = [
        '_draft_scoring_form', '_final_scoring_form', '_final_case_brief',
        '_interview_guide', '_transcript.txt', '_participant_case_plan',
        '_criminal_history', '_reentry_staff_case_plan', '_reentry_participant_action_guide',
        '_reentry_assessment_data'
    ];
    for (const fname of allDataFiles) {
        if (fname.startsWith('.') || fname.endsWith('.sqlite') || fname === 'participants' || fname === 'voice_profiles') continue;
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

    // 4. From SkillCat history snapshots
    const scSnapshots = skillcatHistory.snapshots || skillcatHistory || {};
    const latestSnapshotKey = Object.keys(scSnapshots).sort().pop();
    const latestSkillCatEmployees = latestSnapshotKey && scSnapshots[latestSnapshotKey]
        ? Object.values(scSnapshots[latestSnapshotKey]).filter(e => e && typeof e === 'object' && (e.fullname || e.name))
        : [];
    for (const scEmp of latestSkillCatEmployees) {
        registerPerson(scEmp.fullname || scEmp.name, {
            location: 'Charleston',
            track: 'first_shift'
        });
    }

    // Now build/sync each participant's dedicated directory
    const summaryList = [];
    for (const [slug, person] of registry.entries()) {
        const pDir = path.join(participantsRootDir, slug);
        const docsDir = path.join(pDir, 'documents');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }

        // Link/copy associated files into data/participants/<slug>/documents/ and extract key markdown documents
        let lscmiBriefMd = '';
        let lscmiScoringMd = '';
        let actionPlanMd = '';
        let transcriptText = '';

        for (const fname of person.files.sort()) {
            const srcPath = path.join(dataDir, fname);
            const dstPath = path.join(docsDir, fname);
            try {
                if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
                    fs.copyFileSync(srcPath, dstPath);
                }
                if (fname.endsWith('.md') || fname.endsWith('.txt')) {
                    const txt = fs.readFileSync(srcPath, 'utf8');
                    if (fname.includes('_final_case_brief')) lscmiBriefMd = txt;
                    else if (fname.includes('_final_scoring_form') || (fname.includes('_draft_scoring_form') && !lscmiScoringMd)) lscmiScoringMd = txt;
                    else if (fname.includes('_participant_case_plan') || fname.includes('_reentry_staff_case_plan') || fname.includes('_reentry_participant_action_guide')) actionPlanMd = txt;
                    else if (fname.includes('_transcript.txt')) transcriptText = txt;
                }
            } catch (e) {}
        }

        // Check reentry_case_plans table if actionPlanMd is still empty
        if (person.user_id && !actionPlanMd) {
            const rcp = db.prepare('SELECT * FROM reentry_case_plans WHERE user_id = ?').get(person.user_id);
            if (rcp) {
                actionPlanMd = rcp.staff_case_plan_md || rcp.participant_guide_md || '';
            }
        }

        // Write canonical markdown files inside participant folder
        if (lscmiBriefMd) fs.writeFileSync(path.join(pDir, 'lscmi_brief.md'), lscmiBriefMd);
        if (lscmiScoringMd) fs.writeFileSync(path.join(pDir, 'lscmi_scoring.md'), lscmiScoringMd);
        if (actionPlanMd) fs.writeFileSync(path.join(pDir, 'action_plan.md'), actionPlanMd);
        if (transcriptText) fs.writeFileSync(path.join(pDir, 'lscmi_transcript.txt'), transcriptText);

        // Gather Case Management notes & evaluations for this participant
        const cmNotes = person.user_id
            ? db.prepare('SELECT * FROM case_notes WHERE user_id = ? ORDER BY session_date DESC').all(person.user_id)
            : [];
        const cmEvals = db.prepare(`
            SELECT id, location, session_title, cm_name, apricot_id, session_type, summary_markdown, feedback, next_session_recommendations, created_at
            FROM case_management_evaluations
            WHERE session_title LIKE ? OR apricot_id = ?
            ORDER BY created_at DESC
        `).all(`%${person.name.split(' ')[0]}%`, person.apricot_id || '__NONE__');

        fs.writeFileSync(path.join(pDir, 'case_management_notes.json'), JSON.stringify({
            case_notes: cmNotes,
            cm_session_evaluations: cmEvals
        }, null, 2));

        // Match SkillCat progress (module-level scraping + pathways + flags)
        let skillcatRecord = {
            pathway: 'HVAC',
            total_hours: 0,
            completed_count: 0,
            completed_modules: [],
            recent_modules_last_5_days: [],
            pathway_breakdown: {},
            portfolio_link: '',
            stalled: false,
            flags: []
        };
        if (latestSkillCatEmployees.length > 0) {
            const match = latestSkillCatEmployees.find(e => {
                const eName = String(e.fullname || e.name || e.employee_name || '').toLowerCase();
                return eName && person.name.toLowerCase().split(' ').every(part => eName.includes(part));
            });
            if (match) {
                const mods = match.completed_courses || match.modules || [];
                const totalCourses = Number(match.total_courses ?? (Array.isArray(mods) ? mods.length : 0));
                skillcatRecord = {
                    userid: match.userid || '',
                    pathway: match.pathway || 'HVAC',
                    pathway_breakdown: match.pathway_breakdown || {},
                    learning_plans: match.learning_plans || [],
                    portfolio_link: match.portfolio_link || '',
                    last_login: match.last_login || '',
                    latest_completion_date: match.latest_completion_date || null,
                    total_hours: Number((totalCourses * 1.5).toFixed(1)),
                    completed_count: totalCourses,
                    completed_last_5_working_days: Number(match.completed_last_5_working_days || 0),
                    daily_delta: Number(match.daily_delta || 0),
                    completed_modules: Array.isArray(mods) ? mods : [],
                    recent_modules_last_5_days: match.recent_modules_last_5_days || [],
                    stalled: Boolean(match.flagged_2_working_days || totalCourses === 0),
                    flags: Array.isArray(match.pathway_flags) ? match.pathway_flags : []
                };
            }
        }
        fs.writeFileSync(path.join(pDir, 'skillcat_progress.json'), JSON.stringify(skillcatRecord, null, 2));

        // Load or initialize Unified Briefcase for this participant
        const existingRow = db.prepare('SELECT briefcase_json FROM unified_briefcases WHERE participant_key = ?').get(slug);
        let existingBriefcase = null;
        if (existingRow && existingRow.briefcase_json) {
            try { existingBriefcase = JSON.parse(existingRow.briefcase_json); } catch (e) {}
        }

        const unifiedBriefcase = synthesizeBriefcaseFromLoadedInfo({
            participantKey: slug,
            participantName: person.name,
            location: person.location,
            track: person.track,
            userId: person.user_id,
            clientId: person.client_id,
            existingBriefcase,
            textSources: [lscmiBriefMd, actionPlanMd, transcriptText, ...cmNotes.map(n => n.content)],
            skillcatRecord
        });
        fs.writeFileSync(path.join(pDir, 'briefcase.json'), JSON.stringify(unifiedBriefcase, null, 2));

        // Load Action Plan Feedback Loop history
        const feedbackLoops = db.prepare('SELECT * FROM action_plan_feedback_loops WHERE participant_key = ? ORDER BY created_at DESC').all(slug);
        const feedbackLoopData = {
            participant_key: slug,
            participant_name: person.name,
            current_agreement_status: feedbackLoops[0] ? feedbackLoops[0].agreement_status : (actionPlanMd ? 'agreed' : 'pending_review'),
            history: feedbackLoops
        };
        fs.writeFileSync(path.join(pDir, 'feedback_loop_log.json'), JSON.stringify(feedbackLoopData, null, 2));

        // Load Screening Consultation history
        const screenings = db.prepare('SELECT * FROM screening_consultations WHERE participant_key = ? ORDER BY created_at DESC').all(slug);
        fs.writeFileSync(path.join(pDir, 'screening_consultation.json'), JSON.stringify({
            participant_key: slug,
            latest_screening: screenings[0] || null,
            history: screenings
        }, null, 2));

        // Load Voice Profile
        const voiceProf = db.prepare('SELECT * FROM voice_profiles WHERE profile_id = ?').get(`participant_${slug}`);
        fs.writeFileSync(path.join(pDir, 'voice_profile.json'), JSON.stringify(voiceProf || {
            profile_id: `participant_${slug}`,
            person_type: 'participant',
            name: person.name,
            enrolled: Boolean(transcriptText),
            source_type: 'lscmi_interview',
            note: transcriptText ? 'Voice profile anchored from LS/CMI assessment recording' : 'Pending LS/CMI audio recording'
        }, null, 2));

        // Build Caseload Evaluation Summary (combining Brief, Action Plan, Feedback Loop, Unified Briefcase, CM Notes, SkillCat, and Data Flags)
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
        if (person.track === 'first_shift' && cmNotes.length === 0 && cmEvals.length === 0) {
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

        const caseloadEval = {
            participant_key: slug,
            participant_name: person.name,
            location: person.location,
            track: person.track,
            folder_path: `data/participants/${slug}`,
            has_lscmi_brief: Boolean(lscmiBriefMd),
            has_lscmi_scoring: Boolean(lscmiScoringMd),
            has_action_plan: Boolean(actionPlanMd),
            action_plan_agreement: feedbackLoopData.current_agreement_status,
            waitlist_ready: unifiedBriefcase.waitlist_ready,
            waitlist_score: `${unifiedBriefcase.waitlist_met_count}/9`,
            medical_appointments_applicable: unifiedBriefcase.medical_appointments_applicable,
            skillcat_pathway: unifiedBriefcase.items.skillcat_pathway.value,
            skillcat_modules_completed: skillcatRecord.completed_count,
            cm_notes_count: cmNotes.length + cmEvals.length,
            data_evaluation_flags: flags,
            updated_at: new Date().toISOString()
        };
        fs.writeFileSync(path.join(pDir, 'caseload_evaluation.json'), JSON.stringify(caseloadEval, null, 2));

        // Write Profile JSON
        const profileData = {
            ...person,
            folder_slug: slug,
            folder_path: `data/participants/${slug}`,
            has_lscmi_brief: Boolean(lscmiBriefMd),
            has_lscmi_scoring: Boolean(lscmiScoringMd),
            has_action_plan: Boolean(actionPlanMd),
            waitlist_ready: unifiedBriefcase.waitlist_ready,
            waitlist_met_count: unifiedBriefcase.waitlist_met_count,
            data_flags_count: flags.length,
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

    return summaryList;
}

function getParticipantFolderBundle(slugOrName) {
    const slug = sanitizeParticipantSlug(slugOrName);
    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) {
        syncAllParticipantFolders();
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
    const docsDir = path.join(pDir, 'documents');
    const docFiles = fs.existsSync(docsDir) ? fs.readdirSync(docsDir) : [];

    return {
        participant_key: slug,
        folder_path: `data/participants/${slug}`,
        profile: readJsonSafe('profile.json'),
        briefcase: readJsonSafe('briefcase.json'),
        caseload_evaluation: readJsonSafe('caseload_evaluation.json'),
        screening_consultation: readJsonSafe('screening_consultation.json'),
        feedback_loop_log: readJsonSafe('feedback_loop_log.json'),
        skillcat_progress: readJsonSafe('skillcat_progress.json'),
        case_management_notes: readJsonSafe('case_management_notes.json'),
        voice_profile: readJsonSafe('voice_profile.json'),
        lscmi_brief_md: readTextSafe('lscmi_brief.md'),
        lscmi_scoring_md: readTextSafe('lscmi_scoring.md'),
        action_plan_md: readTextSafe('action_plan.md'),
        lscmi_transcript_txt: readTextSafe('lscmi_transcript.txt'),
        document_files: docFiles
    };
}

function updateParticipantUnifiedBriefcase(slugOrName, updates = {}) {
    const slug = sanitizeParticipantSlug(slugOrName);
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

    if (updates.items && typeof updates.items === 'object') {
        for (const [k, v] of Object.entries(updates.items)) {
            const val = typeof v === 'object' ? v.value : v;
            const notes = typeof v === 'object' ? (v.notes || '') : ((state.items[k] && state.items[k].notes) || '');
            state.items[k] = {
                value: val,
                notes,
                source: 'manual_dropdown',
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

    return state;
}

module.exports = {
    UNIFIED_BRIEFCASE_SCHEMA,
    sanitizeParticipantSlug,
    syncAllParticipantFolders,
    getParticipantFolderBundle,
    updateParticipantUnifiedBriefcase,
    synthesizeBriefcaseFromLoadedInfo,
    evaluateWaitlistReadiness
};
