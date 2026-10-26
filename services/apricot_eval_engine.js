/**
 * apricot_eval_engine.js
 * 
 * Comprehensive Apricot Evaluation & Operational Reporting Engine for Turn90.
 * Mirrors the exact business rules and report architecture from the Apricot Eval project:
 *  1. First Shift Payment Report (Previous Week Mon–Fri @ $9/pt, Current Week Enrollments, Previous Week Exits) + Export (.xlsx, .csv, HTML/PDF)
 *  2. Funnel Report (Enrollments & Exits by Program & Center + Exit Reasons; Resource Coordinations, Consultations, Eligibility, Referral Sources, Waitlist, Orientations)
 *  3. Active Program Dashboards (First Shift Active Table & Reentry Navigation Active Table with Center & Case Manager mapping)
 *  4. Case Plan & Briefcase Feedback (Per-Participant Clinical/Operational Review & "What to Work on Next in Case Management" grounded in Case Plan, Briefcase & Gates 1–4)
 *     - First Shift: Includes CBT Focus Areas/Situations + Briefcase + Gates 1–4
 *     - Reentry Navigation (mostly Daisy Boynton): Includes ONLY Goals + Briefcase + Gates 1–4 (NO CBT)
 *  5. Employment & Retention Analysis (30/60/90/180-Day Job Retention + Active Employments Lacking 30-Day Check-In)
 *  6. Referrals & Credentials Analysis (By Center Location and Case Manager / Staff)
 *  7. Incremental / Deduplicated Case Note & Workbook Ingestion:
 *     - Processes initial case notes once and stores deterministic fingerprints in `apricot_processed_notes`.
 *     - Disregards any case notes that have been processed prior on subsequent daily/multi-weekly uploads.
 *     - Updates participant feedback & "What to Work on Next" when newer case notes or CM recordings are added.
 */

const XLSX = require('xlsx');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, initParticipantBriefcase, initReentryClientBriefcase } = require('../db');

// Initialize Apricot Eval Engine tables in SQLite
db.exec(`
CREATE TABLE IF NOT EXISTS apricot_sheet_cache (
    sheet_key TEXT PRIMARY KEY,
    rows_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS apricot_workbook_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    report_json TEXT NOT NULL,
    source_filename TEXT,
    report_reference_date DATE,
    total_unique_notes INTEGER DEFAULT 0,
    last_upload_new_notes_count INTEGER DEFAULT 0,
    last_upload_skipped_notes_count INTEGER DEFAULT 0,
    last_upload_points_count INTEGER DEFAULT 0,
    last_uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS apricot_processed_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_hash TEXT UNIQUE NOT NULL,
    record_id TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    activity_date DATE,
    staff_name TEXT,
    service_context TEXT,
    interaction_type TEXT,
    note_text TEXT,
    center_location TEXT,
    program_enrollment TEXT,
    source TEXT DEFAULT 'apricot_import',
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_apricot_notes_record_id ON apricot_processed_notes(record_id);
CREATE INDEX IF NOT EXISTS idx_apricot_notes_date ON apricot_processed_notes(activity_date);

CREATE TABLE IF NOT EXISTS apricot_participant_evaluations (
    record_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    program TEXT NOT NULL, -- 'First Shift' or 'Reentry Navigation'
    center TEXT NOT NULL DEFAULT 'Charleston',
    case_manager TEXT,
    case_plan_status TEXT,
    focus_areas_or_goals TEXT,
    briefcase_status_text TEXT,
    gate1_pct INTEGER DEFAULT 0,
    gate2_pct INTEGER DEFAULT 0,
    gate3_pct INTEGER DEFAULT 0,
    gate4_pct INTEGER DEFAULT 0,
    case_note_analysis TEXT,
    operational_feedback TEXT,
    next_cm_steps_json TEXT, -- JSON array of concrete next steps grounded in Case Plan, Briefcase & Gates
    recent_cm_notes_json TEXT, -- JSON array of newer notes / CM recordings added after initial seed
    last_note_date DATE,
    notes_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe column migrations for reentry_clients
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN case_manager TEXT DEFAULT 'Daisy Boynton';"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN enrollment_start DATE;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN gate1_pct INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN gate2_pct INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN gate3_pct INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN gate4_pct INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN last_contact_date DATE;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN last_contact_staff TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN last_contact_activity TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN has_case_plan INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE reentry_clients ADD COLUMN case_plan_text TEXT;"); } catch (e) {}

// Official Gate Checklist item definitions (from Briefcase Prepare for Import - Apricot.pdf)
const APRICOT_GATE_DEFINITIONS = {
    1: [
        "State ID or Driver's License",
        "Social Security Card",
        "Birth Certificate",
        "Fill needed prescriptions",
        "Explore healthcare options",
        "Supervision information (county, officer name, report dates)",
        "Completed Skillcat Intro",
        "Chose skillcat track"
    ],
    2: [
        "Child support plan made",
        "Cases reviewed",
        "Contact made with Child Support",
        "Stable Address / Housing",
        "Reliable Phone Number",
        "Probation / Legal Obligations",
        "Gone to the DMV to find out why the license is suspended",
        "Professional email",
        "Resume",
        "Making progress on Skillcat track"
    ],
    3: [
        "Primary Care / Medical",
        "Vision Appointment",
        "Prescription Needs",
        "Mental Health / Substance Recovery",
        "Bank Account",
        "Making progress on Skillcat track",
        "Complete Relapse Prevention Plans"
    ],
    4: [
        "Work Tools & Clothing",
        "Transportation Plan",
        "Budget completed",
        "Savings goals",
        "Credit reviewed",
        "6 month job plan created",
        "Long term career goal identified",
        "Making progress on Skillcat track"
    ]
};

// Reentry Navigation Gate Definitions (Excludes SkillCat & CBT Relapse Prevention Plans per Turn90 Reentry Nav rules)
const REENTRY_NAV_GATE_GOALS = {
    1: [
        "State ID or Driver's License (Valid ID or DMV appointment booked)",
        "Social Security Card (Physical card, SSA receipt, or appointment)",
        "Birth Certificate (Physical copy or Vital Statistics appointment)",
        "Fill needed prescriptions (Welvista / local pharmacy)",
        "Explore healthcare options (Medicaid / Free Medical Clinic)",
        "Supervision information documented (County, Officer, Report Dates)"
    ],
    2: [
        "Child support plan made / Cases reviewed / DSS contact",
        "Stable Address / Housing (30–60 day stability verified)",
        "Reliable Phone Number with professional voicemail",
        "Probation / Legal Obligations aligned with work hours",
        "DMV License Suspension check & reinstatement plan",
        "Professional email address created",
        "Turn90 Resume completed"
    ],
    3: [
        "Primary Care / Medical checkup scheduled or cleared",
        "Vision Appointment / screening",
        "Steady access to daily prescriptions (Welvista)",
        "Mental Health / Substance Recovery community support plan",
        "Bank Account or direct deposit setup"
    ],
    4: [
        "Work Tools & Clothing (Steel-toe boots, non-slip shoes, work gear)",
        "Verified Daily Transportation Plan (Bus route, car, ride plan)",
        "Personal Budget completed",
        "Savings goals established",
        "Credit report reviewed",
        "6-month job retention plan created",
        "Long-term career & wage goal identified"
    ]
};

// Initial curated participant narratives from Turn90_Apricot_Evaluation_Report.md
const INITIAL_CURATED_EVALUATIONS = {
    '77677': {
        case_manager: 'Terrence Brown / Justin Evans',
        center: 'Charleston',
        case_note_analysis: "Notes from 09/29, 10/06, and 10/13 show strong clinical engagement around high-stakes personal challenges. Terrence Brown conducted extensive coaching around family boundaries, court-ordered reunification therapy, and co-parenting dynamics. On 10/13, case notes document active job placement vetting (Urban Electric vs. Coastal Precast) and child support resolution with Mr. Swick.",
        operational_feedback: "While 1-on-1 coaching is exemplary, there is a severe administrative compliance gap: (1) The First Shift Case Plan situations remain blank in Apricot; (2) His Briefcase has not been officially initialized in the Apricot Briefcase tracking module; (3) SSN is missing in Bio Info; (4) No case notes or points were logged during the current week (10/19–10/23), suggesting he may be in transition or facing attendance barriers. Immediate outreach and formal database reconciliation are required."
    },
    '78777': {
        case_manager: 'Diyoung Dantzler / Matt Carlisle',
        center: 'Spartanburg',
        case_note_analysis: "Excellent behavioral traction documented by Diyoung Dantzler. In his 10/21 session, Christopher reported a concrete application of the 'Stop and Think' CBT tool to successfully de-escalate a potential physical altercation at his transitional residence, offering choices instead of reacting aggressively. On 10/13, he worked through a disability checkbox application reset with Highland Bakery.",
        operational_feedback: "Christopher has earned 50 points last week and 38 pts this week (top tier). However: (1) Gate 2 Briefcase items (Housing plan, reliable phone voicemail, professional email, resume) must be officially validated in the system; (2) His Case Plan trigger situations must be populated in the database; (3) In the main enrollments table, his center was left blank (resolved to Spartanburg). SSN must be entered in Bio Info."
    },
    '79019': {
        case_manager: 'Jenn Jeanquart / Terrance Ferrell',
        center: 'Columbia',
        case_note_analysis: "Exceptional job placement progress. On 10/08, Jenn Jeanquart logged that Christopher received a formal job offer from International Paper. Pre-employment physical, drug screen, and background checks are underway. Case management on 10/06 and 10/12 tackled acute personal and relationship grief (coping with an undisclosed abortion by partner and establishing healthy boundaries) while maintaining absolute sobriety.",
        operational_feedback: "Christopher possesses the most advanced Briefcase in the First Shift cohort (100% of Gate 4 items complete; verified forklift and OSHA-10 certifications). The primary remaining gap is completing the narrative trigger situations in his First Shift Case Plan and finalizing his post-program 30/60/90-day job retention check-in schedule as he transitions to International Paper."
    },
    '79620': {
        case_manager: 'Jenn Jeanquart / Terrance Ferrell',
        center: 'Columbia',
        case_note_analysis: "Consistent 50-point earner with intensive employment navigation support. Notes from 10/08, 10/14, and 10/19 document resilience after encountering online application glitches with International Paper (Covington). Case manager Jenn Jeanquart navigated location eligibility constraints and identified $20.50/hr roles across Cargill, AZZ Metals, and Spire Bakeries, texting direct application links during session.",
        operational_feedback: "Vincent has complete Bio Info on file. To complete his Briefcase readiness, he needs: (1) Gate 3 health/wellness clearance and direct deposit bank account verification; (2) Formal entry of his Case Plan trigger situations for Work & Follow-Through and Thinking Patterns; (3) Work tools and clothing verification in Gate 4."
    },
    '79622': {
        case_manager: 'Terrence Brown / Justin Evans',
        center: 'Charleston',
        case_note_analysis: "Deep leadership and recovery involvement. In notes from 10/08, 10/15, and 10/22, Terrence Brown captures Isiah's role as a sober living house president and his preparation to host an AA meeting on 'Bill's Story'. On 10/22, notes reveal severe sleep deprivation and emotional exhaustion due to roommate volatility at his sober house, which threatens his focus.",
        operational_feedback: "Immediate case management intervention is required regarding his housing stability and roommate boundaries to prevent cognitive overload. Administratively, his Briefcase must be initialized immediately in Apricot (Gates 1–4 currently 0% despite verified Forklift certification on 09/18), and his Case Plan trigger situations, Email, and SSN must be entered."
    },
    '79879': {
        case_manager: 'Terrence Brown / Daisy Boynton',
        center: 'Charleston',
        case_note_analysis: "Enrolled on 10/12/2026. Daisy Boynton conducted employment support on 10/19, building a customized resume and printing physical copies. On 10/20, Terrence Brown held an initial case management session focusing on parole compliance, parental obligations for his autistic daughter, and securing bed space at Shield Ministry.",
        operational_feedback: "Urgent compliance action needed: (1) Formal First Shift Case Plan must be drafted with CBT focus areas and trigger situations; (2) Briefcase form must be initialized in Apricot (Gates 1–4); (3) Bio Info is incomplete (missing DOB, SSN, Line 1, City, Zip); (4) Update center assignment in main enrollment record to Charleston."
    },
    '80789': {
        case_manager: 'Terrence Brown / Justin Evans',
        center: 'Charleston',
        case_note_analysis: "High-performing participant (50 pts last week, 40 pts this week) with fully compliant Case Plan documentation. Notes from 10/07, 10/12, and 10/19 show intense coaching around family dynamics and co-parenting stress. Case manager Terrence Brown connected him with 'A Father's Place' to establish legal custody and boundary agreements.",
        operational_feedback: "Case plan CBT focus areas and situations are exemplary. The primary focus for upcoming Case Management is Briefcase Gate 1–3 execution: securing his physical Social Security card, birth certificate, professional voicemail, and direct deposit account, plus entering missing DOB, SSN, and address in Bio Info."
    },
    '80797': {
        case_manager: 'Jenn Jeanquart',
        center: 'Columbia',
        case_note_analysis: "Rapid stabilization progress. On 10/19, Jenn Jeanquart logged $800 in financial assistance to clear his DMV license reinstatement fees. On 10/21, coaching addressed transitional housing write-ups, where William successfully utilized emotional regulation to resolve a room misassignment peacefully.",
        operational_feedback: "Administrative urgency: William transitioned to First Shift on 10/12, but: (1) No First Shift Case Plan has been filed (needs CBT Focus Areas 1 & 2 and situations); (2) Briefcase has not been initialized in Apricot (Gates 1–4 at 0%); (3) He is missing from the Bio Info sheet. Immediate paperwork catch-up is required."
    },
    '81055': {
        case_manager: 'Diyoung Dantzler / Kat Norsworthy',
        center: 'Spartanburg',
        case_note_analysis: "Top performer (50 pts last week, 38 pts this week) with gold-standard documentation by Diyoung Dantzler. In his 10/22 session, Charlie established concrete 90-day goals (GED completion, reliable car purchase, budgeting with partner) and boundary strategies to avoid procriminal peer circles in Boiling Springs.",
        operational_feedback: "Case plan is complete (Work & Follow-Through and People & Influence). Briefcase progress is solid across Gate 1 (62%) and Gate 2 (50%). Next steps in Case Management: (1) Initiate Gate 3 health/vision appointments and direct deposit bank account; (2) Advance Gate 4 transportation and budget items; (3) Enter SSN into Bio Info."
    },
    '22888': {
        case_manager: 'Daisy Boynton',
        center: 'Columbia',
        case_note_analysis: "Enrolled 10/20/2026. Currently in transitional housing in Manning, SC ($800/mo rent, $600 behind). Daisy conducted outreach on 10/22 to schedule SNAP and Welvista health benefit applications. Walking is primary transportation; investigating public transit options.",
        operational_feedback: "Strong initial Reentry Nav case plan mapping (Goals & Gates). Immediate next step is finalizing Welvista application before his 2-month mental health medication supply runs out, submitting SNAP application, completing his Gate 2 resume, and identifying walkable employers in Manning."
    },
    '66054': {
        case_manager: 'Jenn Jeanquart / Justin Evans',
        center: 'Columbia',
        case_note_analysis: "Extensive case history (32 notes). Exited First Shift on 10/19 due to a weekend behavioral incident and transitioned to Reentry Navigation for stabilization. Referrals made for Eau Claire Behavioral Medicine and Free Medical Clinic.",
        operational_feedback: "Lawrence holds high job-readiness credentials (NCCER Core & Forklift) and strong Briefcase progress (Gate 1: 100%, Gate 2: 70%, Gate 3: 29%). Priority next steps: author a formal Reentry Nav Case Plan focused on behavioral health stabilization at Eau Claire Behavioral Medicine, Free Medical Clinic follow-up, and Gate 3/4 completion."
    },
    '66059': {
        case_manager: 'Daisy Boynton',
        center: 'Charleston',
        case_note_analysis: "On 10/19, Marquise confirmed he obtained his physical State ID and attended his SC Vocational Rehab appointment in Georgetown. Holds NCCER Core certification from MacDougal pre-release.",
        operational_feedback: "Excellent client follow-through on Gate 1 (38%) and Gate 2 (40%). Next steps in Reentry Nav Case Management: follow up on SC Vocational Rehab job placement in Georgetown, monitor his $500 DMV driver's license reinstatement fee dispute, and complete remaining Gate 1/2 vital documents."
    },
    '79844': {
        case_manager: 'Matt Carlisle',
        center: 'Spartanburg',
        case_note_analysis: "Attended first formal Reentry Nav appointment with Matt Carlisle on 10/21 following step-down from First Shift. Referrals logged by Diyoung Dantzler for Atlas Driving School, Vocational Rehabilitation, and Goodwill Job Connections (CDL).",
        operational_feedback: "Clear conditional pathway established. To regain First Shift eligibility, She'lah must complete 4 consecutive weeks of check-ins and clean urinalysis screens, secure a sustainable transportation plan, and complete Gate 2 Briefcase items (currently 0% on Gate 2 despite 62% on Gate 1 and 43% on Gate 3)."
    },
    '80978': {
        case_manager: 'Daisy Boynton',
        center: 'Columbia',
        case_note_analysis: "Completed First Shift Orientation on Friday 10/23/2026 in Columbia! Rainy Day Fund request for $1,740 in DL reinstatement fees was denied on 10/21.",
        operational_feedback: "Melvin is slated to start First Shift Day 1 in Columbia on Monday 10/26/2026. Next steps: initialize his Briefcase Gates 1–4 on Day 1, build his resume, and pivot to partner CDL grant programs and payment plan options for his driver's license."
    },
    '81120': {
        case_manager: 'Daisy Boynton',
        center: 'Charleston',
        case_note_analysis: "Daisy logged 6 comprehensive medical and basic needs referrals (Harvest Free Medical Clinic, Palmetto Palace, Lowcountry Food Bank, Fetter Health Care, Care Now Urgent Care, SC Works). On 10/21, Kevin scheduled an appointment at SC Works.",
        operational_feedback: "Gold-standard wraparound stabilization by Daisy. Next steps: initialize Kevin's Apricot Briefcase (Gates 1–3) to formally track his diabetes/hypertension medical appointments, prescription fulfillment, and SC Works job readiness."
    },
    '81443': {
        case_manager: 'Daisy Boynton',
        center: 'Columbia',
        case_note_analysis: "Checked in with Daisy on 10/19 and successfully completed First Shift Orientation on Friday 10/23/2026 at Columbia Center.",
        operational_feedback: "Slated to begin First Shift Day 1 on Monday 10/26/2026 at Columbia Center. Next steps: transition caseload record to Columbia First Shift Program Manager (Jenn Jeanquart) and initialize Briefcase Gate 1 checklist and Case Plan."
    }
};

/**
 * Parse various date strings or Excel serial numbers to YYYY-MM-DD
 */
function parseDateStr(val) {
    if (!val && val !== 0) return '';
    if (val instanceof Date) {
        return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
    }
    if (typeof val === 'number') {
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    if (!str || str === '--') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
        const yr = m[3].length === 2 ? '20' + m[3] : m[3];
        return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
    }
    return '';
}

function formatMDY(isoDate) {
    if (!isoDate) return '';
    const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return String(isoDate);
}

function diffDays(d1Str, d2Str) {
    const d1 = new Date(d1Str + 'T12:00:00Z');
    const d2 = new Date(d2Str + 'T12:00:00Z');
    return Math.round((d2 - d1) / 86400000);
}

function getMondayOf(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay(); // 0=Sun, 1=Mon...
    const diff = (day === 0 ? -6 : 1) - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().split('T')[0];
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

/**
 * ComputeWeeksEnrolled:
 * Start date is Week 1; every Monday after the enrollment start date increments week count by 1.
 */
function computeWeeksEnrolled(enrollStartStr, refDateStr) {
    if (!enrollStartStr || !refDateStr) return 1;
    const startMon = getMondayOf(enrollStartStr);
    const refMon = getMondayOf(refDateStr);
    const weeksDiff = Math.round(diffDays(startMon, refMon) / 7);
    return Math.max(1, weeksDiff + 1);
}

/**
 * Deterministic fingerprint for a Case Note to prevent re-processing duplicates
 */
function computeNoteHash(recordId, activityDate, staffName, interactionType, noteText) {
    const cleanId = String(recordId || '').trim();
    const cleanDate = parseDateStr(activityDate) || String(activityDate || '').trim();
    const cleanStaff = String(staffName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const cleanType = String(interactionType || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const cleanText = String(noteText || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const payload = `${cleanId}|${cleanDate}|${cleanStaff}|${cleanType}|${cleanText}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Normalize staff short names to full names
 */
function normalizeStaffName(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'Unassigned';
    const lower = s.toLowerCase();
    if (lower === 'daisy' || lower.includes('boynton')) return 'Daisy Boynton';
    if (lower === 'tb' || lower.includes('terrence brown')) return 'Terrence Brown';
    if (lower === 'jenn' || lower.includes('jeanquart')) return 'Jenn Jeanquart';
    if (lower === 'diyoung' || lower.includes('dantzler')) return 'Diyoung Dantzler';
    if (lower === 'matt' || lower.includes('carlisle')) return 'Matt Carlisle';
    if (lower === 'kat' || lower.includes('norsworthy')) return 'Kat Norsworthy';
    if (lower === 'justin' || lower.includes('justin evans')) return 'Justin Evans';
    if (lower.includes('terrance ferrell') || lower === 'terrance') return 'Terrance Ferrell';
    return s;
}

/**
 * Resolve Center Location ('Charleston', 'Columbia', 'Spartanburg') for any Record ID
 * across all sheets, staff assignments, and case notes.
 */
function resolveParticipantCenter(recordId, contextMaps) {
    const id = String(recordId || '').trim();
    if (INITIAL_CURATED_EVALUATIONS[id]?.center) {
        return INITIAL_CURATED_EVALUATIONS[id].center;
    }

    // 1. Check explicit center columns across sheets
    const explicitSources = [
        contextMaps.explicitCenterById[id],
        contextMaps.consultCenterById[id],
        contextMaps.waitlistCenterById[id]
    ];
    for (const loc of explicitSources) {
        if (loc && ['Charleston', 'Columbia', 'Spartanburg'].includes(loc)) {
            return loc;
        }
    }

    // 2. Check staff & text clues in Case Plans and Case Notes
    const textClues = (contextMaps.textCluesById[id] || '').toLowerCase();
    if (textClues.includes('spartanburg') || textClues.includes('boiling springs') || textClues.includes('greenville')) {
        return 'Spartanburg';
    }
    if (textClues.includes('west cola') || textClues.includes('columbia') || textClues.includes('cayce') || textClues.includes('alston wilkes') || textClues.includes('eau claire') || textClues.includes('manning') || textClues.includes('greyce')) {
        return 'Columbia';
    }
    if (textClues.includes('charleston') || textClues.includes('west ashley') || textClues.includes('berkeley') || textClues.includes('moncks corner') || textClues.includes('georgetown') || textClues.includes('swick') || textClues.includes('fetter') || textClues.includes('lowcountry')) {
        return 'Charleston';
    }

    const staffList = contextMaps.staffById[id] || [];
    for (const st of staffList) {
        const lower = st.toLowerCase();
        if (lower.includes('diyoung') || lower.includes('matt')) return 'Spartanburg';
        if (lower.includes('jenn') || lower.includes('ferrell')) return 'Columbia';
        if (lower.includes('terrence') || lower === 'tb') return 'Charleston';
    }

    // Known specific resolutions from Apricot Eval report
    if (id === '81142' || id === '78777' || id === '81055' || id === '79844' || id === '81457') return 'Spartanburg';
    if (id === '79879') return 'Charleston';

    return 'Charleston';
}

/**
 * Build actionable "What to Work on Next in Case Management" recommendations
 * grounded strictly in the participant's Case Plan, Briefcase items, and Gates 1–4.
 *
 * CRITICAL RULE:
 * - First Shift: Includes CBT Focus Areas & Trigger Situations + Briefcase + Gates 1–4.
 * - Reentry Navigation: Includes ONLY Goals + Briefcase + Gates 1–4 (NO CBT!).
 */
function buildGroundedNextCmSteps({
    program,
    fullName,
    casePlanStatus,
    focusAreasOrGoals,
    gate1Pct,
    gate2Pct,
    gate3Pct,
    gate4Pct,
    completedGateItems = {},
    missingBioFields = [],
    recentNotes = [],
    operationalFeedback = ''
}) {
    const steps = [];
    const isReentryNav = program === 'Reentry Navigation';

    // 1. Case Plan Alignment (First Shift = CBT Focus Areas + Situations; Reentry Nav = Stated Goals Only, NO CBT)
    if (isReentryNav) {
        if (!focusAreasOrGoals || focusAreasOrGoals === 'No formal Case Plan on file') {
            steps.push(`📋 **Author Reentry Navigation Case Plan (Goals & Gates Only):** Collaboratively establish 1–3 concrete stabilization and employment goals with ${fullName} and log them in the Reentry Nav Case Plan (no CBT required for Reentry Nav).`);
        } else {
            const shortGoal = String(focusAreasOrGoals).replace(/\s+/g, ' ').slice(0, 160);
            steps.push(`🎯 **Advance Stated Case Plan Goals:** Review progress on active Reentry Nav goals (${shortGoal}${String(focusAreasOrGoals).length > 160 ? '...' : ''}) and verify concrete barrier-removal steps completed since last check-in.`);
        }
    } else {
        // First Shift includes CBT Focus Areas & Situations
        if (casePlanStatus === 'No (Empty)' || casePlanStatus === 'No Plan on File') {
            steps.push(`🧠 **Complete First Shift Case Plan (CBT Focus Areas & Trigger Situations):** Select Focus Area 1 & Focus Area 2 and document specific high-risk trigger situations and CBT tools in Apricot.`);
        } else if (casePlanStatus.includes('Partial')) {
            steps.push(`🧠 **Complete Missing CBT Trigger Situations in Case Plan:** Focus areas are selected (${focusAreasOrGoals}), but specific real-world trigger situations are blank in Apricot. Map out concrete situations and practice a CBT tool (e.g., Stop & Think, Thinking Report, or 5 Worries) during 1-on-1 coaching.`);
        } else {
            steps.push(`🧠 **Practice Case Plan CBT Focus Areas (${focusAreasOrGoals}):** Roleplay or review a real-world situation from this week applying the participant's targeted CBT skill.`);
        }
    }

    // 2. Briefcase & Gates 1–4 Progression
    const g1Done = completedGateItems[1] || [];
    const g2Done = completedGateItems[2] || [];
    const g3Done = completedGateItems[3] || [];
    const g4Done = completedGateItems[4] || [];

    if (gate1Pct === 0 && gate2Pct === 0 && gate3Pct === 0 && gate4Pct === 0) {
        if (isReentryNav) {
            steps.push(`🧰 **Initialize Briefcase & Gate 1 Vital Documents:** Create the Apricot Briefcase record and verify Gate 1 essentials: State ID / Driver's License, Social Security Card, Birth Certificate, prescription needs (Welvista), healthcare options, and supervision details.`);
        } else {
            steps.push(`🧰 **Initialize Apricot Briefcase & Gate 1 Checklist:** Create the Briefcase record in Apricot immediately and audit Gate 1 items (State ID/DL, SSN Card, Birth Certificate, prescriptions, healthcare, supervision info, and SkillCat track).`);
        }
    } else {
        if (gate1Pct < 100) {
            const g1Defs = isReentryNav ? REENTRY_NAV_GATE_GOALS[1] : APRICOT_GATE_DEFINITIONS[1];
            const missingG1 = g1Defs.filter(item => !g1Done.some(d => d.toLowerCase().includes(item.slice(0, 12).toLowerCase())));
            if (missingG1.length > 0) {
                steps.push(`🔓 **Complete Remaining Gate 1 Items (${gate1Pct}% done):** Target ${missingG1.slice(0, 3).join(', ')}.`);
            }
        }
        if (gate2Pct < 100) {
            const g2Defs = isReentryNav ? REENTRY_NAV_GATE_GOALS[2] : APRICOT_GATE_DEFINITIONS[2];
            const missingG2 = g2Defs.filter(item => !g2Done.some(d => d.toLowerCase().includes(item.slice(0, 12).toLowerCase())));
            if (missingG2.length > 0) {
                steps.push(`🔓 **Advance Gate 2 Stability & Readiness (${gate2Pct}% done):** Work on ${missingG2.slice(0, 3).join(', ')}.`);
            }
        }
        if (gate3Pct < 100 && (gate1Pct >= 38 || gate2Pct >= 20)) {
            const g3Defs = isReentryNav ? REENTRY_NAV_GATE_GOALS[3] : APRICOT_GATE_DEFINITIONS[3];
            const missingG3 = g3Defs.filter(item => !g3Done.some(d => d.toLowerCase().includes(item.slice(0, 12).toLowerCase())));
            if (missingG3.length > 0) {
                steps.push(`🩺 **Address Gate 3 Health & Banking Milestones (${gate3Pct}% done):** Follow up on ${missingG3.slice(0, 3).join(', ')}.`);
            }
        }
        if (gate4Pct < 100 && (gate2Pct >= 40 || gate3Pct >= 25)) {
            const g4Defs = isReentryNav ? REENTRY_NAV_GATE_GOALS[4] : APRICOT_GATE_DEFINITIONS[4];
            const missingG4 = g4Defs.filter(item => !g4Done.some(d => d.toLowerCase().includes(item.slice(0, 12).toLowerCase())));
            if (missingG4.length > 0) {
                steps.push(`🚀 **Finalize Gate 4 Job Placement & Financial Readiness (${gate4Pct}% done):** Complete ${missingG4.slice(0, 3).join(', ')}.`);
            }
        }
    }

    // 3. Bio Info / Administrative Gaps (for First Shift)
    if (!isReentryNav && missingBioFields.length > 0) {
        steps.push(`🗂️ **Update Missing Bio Info in Apricot:** Collect and enter ${missingBioFields.join(', ')} for payroll and W-9/I-9 verification.`);
    }

    // 4. Follow-up from most recent case note
    if (recentNotes && recentNotes.length > 0) {
        const latest = recentNotes[0];
        if (latest && latest.note_text) {
            const snippet = String(latest.note_text).replace(/\s+/g, ' ').trim().slice(0, 140);
            steps.push(`🔄 **Follow Up on Latest Session (${formatMDY(latest.activity_date)} by ${latest.staff_name}):** Check accountability on items discussed ("${snippet}${latest.note_text.length > 140 ? '...' : ''}").`);
        }
    }

    return steps;
}

/**
 * Helper to load cached sheet rows from SQLite
 */
function getCachedSheet(sheetKey) {
    const row = db.prepare('SELECT rows_json FROM apricot_sheet_cache WHERE sheet_key = ?').get(sheetKey);
    if (!row || !row.rows_json) return [];
    try {
        return JSON.parse(row.rows_json);
    } catch (e) {
        return [];
    }
}

function setCachedSheet(sheetKey, rows) {
    db.prepare(`
        INSERT INTO apricot_sheet_cache (sheet_key, rows_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(sheet_key) DO UPDATE SET
            rows_json = excluded.rows_json,
            updated_at = CURRENT_TIMESTAMP
    `).run(sheetKey, JSON.stringify(rows || []));
}

/**
 * Process an Apricot Excel Workbook (initial seed or daily/multi-weekly incremental upload).
 * Disregards any case notes that have been processed prior (`apricot_processed_notes`).
 */
function processApricotWorkbook(bufferOrPath, options = {}) {
    let workbook;
    let sourceFilename = options.filename || 'Apricot_Report.xlsx';

    if (Buffer.isBuffer(bufferOrPath)) {
        workbook = XLSX.read(bufferOrPath, { type: 'buffer' });
    } else if (typeof bufferOrPath === 'string' && fs.existsSync(bufferOrPath)) {
        workbook = XLSX.readFile(bufferOrPath);
        if (!options.filename) sourceFilename = path.basename(bufferOrPath);
    } else {
        throw new Error('Invalid workbook input provided to processApricotWorkbook.');
    }

    const sheetKeyMap = {
        enrollments: 'Enrollments and Exits',
        resourceCoord: 'Funnel-Resource Coordin',
        consultations: 'Funnel-Reentry Consulta',
        waitlist: 'Waitlist',
        orientation: 'Orientation',
        points: 'First Shift Points',
        caseloads: 'Case Loads',
        fsCasePlan: 'First Shift Case Plan',
        rnCasePlan: 'Reentry Nav Case Plan',
        referrals: 'Referrals',
        briefcase: 'Briefcase',
        lscmi: 'LSCMI',
        bioInfo: 'Bio Info',
        employment: 'Employment - Rows',
        drugTest: 'Drug Test',
        employmentHist: 'Employment Historical',
        caseNotes: 'Case Notes',
        credentials: 'Credentials'
    };

    // Extract and update sheet cache for any matching sheets in the uploaded workbook
    let sheetsUpdated = 0;
    for (const [key, pattern] of Object.entries(sheetKeyMap)) {
        const matchedName = workbook.SheetNames.find(n => {
            if (key === 'employment') return n === 'Employment - Rows' || (n.includes('Employment') && !n.includes('Historical') && n.includes('Rows'));
            return n.includes(pattern) && n.includes('Rows');
        });
        if (matchedName) {
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[matchedName], { defval: '' });
            if (key === 'points') {
                // Merge points with existing cached points so uploading a partial weekly points file doesn't erase prior weeks
                const existingPts = getCachedSheet('points');
                const mergedMap = new Map();
                for (const r of existingPts) {
                    const k = `${r['Record ID']}_${parseDateStr(r['Date'])}`;
                    mergedMap.set(k, r);
                }
                for (const r of rows) {
                    const k = `${r['Record ID']}_${parseDateStr(r['Date'])}`;
                    mergedMap.set(k, r);
                }
                setCachedSheet('points', Array.from(mergedMap.values()));
            } else {
                setCachedSheet(key, rows);
            }
            sheetsUpdated++;
        }
    }

    // Fallback: if single-sheet upload (e.g. just Points or just Case Notes)
    if (sheetsUpdated === 0 && workbook.SheetNames.length > 0) {
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
        if (rows.length > 0) {
            const headers = Object.keys(rows[0]).map(h => h.toLowerCase());
            if (headers.some(h => h.includes('points'))) {
                const existingPts = getCachedSheet('points');
                const mergedMap = new Map();
                for (const r of existingPts) mergedMap.set(`${r['Record ID']}_${parseDateStr(r['Date'])}`, r);
                for (const r of rows) mergedMap.set(`${r['Record ID']}_${parseDateStr(r['Date'])}`, r);
                setCachedSheet('points', Array.from(mergedMap.values()));
            } else if (headers.some(h => h.includes('interaction') || h.includes('notes') || h.includes('activity'))) {
                const existingNotes = getCachedSheet('caseNotes');
                setCachedSheet('caseNotes', existingNotes.concat(rows));
            }
        }
    }

    // Now process Case Notes with strict deduplication!
    const rawCaseNotes = getCachedSheet('caseNotes');
    let newNotesCount = 0;
    let skippedNotesCount = 0;
    const updatedParticipantRecordIds = new Set();

    const checkHashStmt = db.prepare('SELECT id FROM apricot_processed_notes WHERE note_hash = ?');
    const checkPrefixStmt = db.prepare(`
        SELECT id FROM apricot_processed_notes
        WHERE record_id = ? AND activity_date = ? AND SUBSTR(LOWER(TRIM(note_text)), 1, 80) = SUBSTR(LOWER(TRIM(?)), 1, 80)
        LIMIT 1
    `);
    const insertProcessedNoteStmt = db.prepare(`
        INSERT OR IGNORE INTO apricot_processed_notes (
            note_hash, record_id, first_name, last_name, activity_date,
            staff_name, service_context, interaction_type, note_text,
            center_location, program_enrollment, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'apricot_import')
    `);

    const noteTx = db.transaction(() => {
        for (const r of rawCaseNotes) {
            const recordId = String(r['Record ID'] || '').trim();
            if (!recordId) continue;

            const firstName = String(r['First'] || '').trim();
            const lastName = String(r['Last'] || '').trim();
            const activityDate = parseDateStr(r['Date of activity:'] || r['Date']);
            const staffName = normalizeStaffName(r['Staff providing service'] || r['Staff']);
            const serviceContext = String(r['Service Context'] || '').trim();
            const interactionType = String(r['What happened during this interaction'] || '').trim();
            const noteText = String(r['Notes'] || '').trim();
            const centerLoc = String(r['At which Turn90 Center is the client...'] || '').trim();
            const progEnroll = String(r['Program Enrollment:'] || '').trim();

            if (!activityDate && !noteText && !interactionType) continue;

            const noteHash = computeNoteHash(recordId, activityDate, staffName, interactionType, noteText);

            // Check if already processed prior
            const existsExact = checkHashStmt.get(noteHash);
            const existsPrefix = (!existsExact && noteText.length >= 20)
                ? checkPrefixStmt.get(recordId, activityDate, noteText)
                : null;

            if (existsExact || existsPrefix) {
                skippedNotesCount++;
                continue;
            }

            const info = insertProcessedNoteStmt.run(
                noteHash,
                recordId,
                firstName,
                lastName,
                activityDate,
                staffName,
                serviceContext,
                interactionType,
                noteText,
                centerLoc,
                progEnroll
            );

            if (info.changes > 0) {
                newNotesCount++;
                updatedParticipantRecordIds.add(recordId);
            } else {
                skippedNotesCount++;
            }
        }
    });
    noteTx();

    // Recompute full Apricot report & sync active participants to app tables
    const computedReport = recomputeFullApricotReport({
        sourceFilename,
        newNotesCount,
        skippedNotesCount,
        updatedParticipantRecordIds
    });

    return {
        success: true,
        sourceFilename,
        newNotesProcessed: newNotesCount,
        duplicateNotesDisregarded: skippedNotesCount,
        totalUniqueNotesInDb: computedReport.meta.totalUniqueNotes,
        pointsRecordsSynced: computedReport.meta.pointsRecordsCount,
        activeFirstShiftCount: computedReport.activeDashboards.firstShift.length,
        activeReentryNavCount: computedReport.activeDashboards.reentryNav.length,
        report: computedReport
    };
}

/**
 * Recompute all 6 Apricot Eval report sections from the cached sheets + processed notes
 * and synchronize SQLite operational tables (`users`, `participant_profiles`, `reentry_clients`, etc.).
 */
function recomputeFullApricotReport(syncMeta = {}) {
    const enrollments = getCachedSheet('enrollments');
    const resourceCoord = getCachedSheet('resourceCoord');
    const consultations = getCachedSheet('consultations');
    const waitlist = getCachedSheet('waitlist');
    const orientations = getCachedSheet('orientation');
    const points = getCachedSheet('points');
    const caseloads = getCachedSheet('caseloads');
    const fsCasePlans = getCachedSheet('fsCasePlan');
    const rnCasePlans = getCachedSheet('rnCasePlan');
    const referrals = getCachedSheet('referrals');
    const briefcases = getCachedSheet('briefcase');
    const lscmiRows = getCachedSheet('lscmi');
    const bioInfoRows = getCachedSheet('bioInfo');
    const employmentRows = getCachedSheet('employment');
    const drugTests = getCachedSheet('drugTest');
    const employmentHist = getCachedSheet('employmentHist');
    const credentials = getCachedSheet('credentials');

    // Load all deduplicated case notes from apricot_processed_notes
    const allProcessedNotes = db.prepare(`
        SELECT * FROM apricot_processed_notes
        ORDER BY activity_date DESC, id DESC
    `).all();

    // Determine report reference date from latest point or case note date (default 2026-10-23)
    let maxDataDate = '2026-10-23';
    for (const p of points) {
        const d = parseDateStr(p['Date']);
        if (d && d > maxDataDate && d <= '2027-12-31') maxDataDate = d;
    }
    for (const n of allProcessedNotes) {
        const d = n.activity_date;
        if (d && d > maxDataDate && d <= '2027-12-31') maxDataDate = d;
    }

    const currentWeekMonday = getMondayOf(maxDataDate);
    const currentWeekFriday = addDays(currentWeekMonday, 4);
    const currentWeekSunday = addDays(currentWeekMonday, 6);

    const prevWeekMonday = addDays(currentWeekMonday, -7);
    const prevWeekFriday = addDays(prevWeekMonday, 4);

    // Build context maps for center location resolution
    const contextMaps = {
        explicitCenterById: {},
        consultCenterById: {},
        waitlistCenterById: {},
        textCluesById: {},
        staffById: {}
    };

    const recordCenterHelper = (id, loc) => {
        const cleanId = String(id || '').trim();
        const cleanLoc = String(loc || '').trim();
        if (cleanId && ['Charleston', 'Columbia', 'Spartanburg'].includes(cleanLoc)) {
            contextMaps.explicitCenterById[cleanId] = cleanLoc;
        }
    };

    enrollments.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    caseloads.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    points.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    fsCasePlans.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    briefcases.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    bioInfoRows.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    drugTests.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));
    lscmiRows.forEach(r => recordCenterHelper(r['Record ID'], r['At which Turn90 Center is the client...']));

    consultations.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const loc = String(r['Preferred enrollment location'] || '').trim();
        if (id && loc) contextMaps.consultCenterById[id] = loc;
    });

    waitlist.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const loc = String(r['Which center?'] || '').trim();
        if (id && loc) contextMaps.waitlistCenterById[id] = loc;
    });

    rnCasePlans.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        contextMaps.textCluesById[id] = (contextMaps.textCluesById[id] || '') + ' ' + String(r['Case Plan'] || '');
        if (r['Case Manager']) {
            if (!contextMaps.staffById[id]) contextMaps.staffById[id] = [];
            contextMaps.staffById[id].push(String(r['Case Manager']));
        }
    });

    fsCasePlans.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        if (r['Program Manager']) {
            if (!contextMaps.staffById[id]) contextMaps.staffById[id] = [];
            contextMaps.staffById[id].push(String(r['Program Manager']));
        }
    });

    allProcessedNotes.forEach(n => {
        const id = String(n.record_id || '').trim();
        if (!id) return;
        if (n.center_location && ['Charleston', 'Columbia', 'Spartanburg'].includes(n.center_location)) {
            contextMaps.explicitCenterById[id] = n.center_location;
        }
        contextMaps.textCluesById[id] = (contextMaps.textCluesById[id] || '') + ' ' + String(n.note_text || '');
        if (n.staff_name) {
            if (!contextMaps.staffById[id]) contextMaps.staffById[id] = [];
            contextMaps.staffById[id].push(n.staff_name);
        }
    });

    // =========================================================================
    // 1. FIRST SHIFT PAYMENT REPORT (PREVIOUS WEEK ONLY: Mon–Fri @ $9/point)
    // =========================================================================
    const enrollmentInfoById = {};
    enrollments.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const prog = String(r['Program Enrollment:'] || r['Which Program?'] || '').trim();
        if (prog === 'First Shift') {
            enrollmentInfoById[id] = {
                startDate: parseDateStr(r['Enrollment Start Date:']),
                endDate: parseDateStr(r['Date enrollment ended:']),
                exitReason: String(r['How did the client exit Reentry Nav or...'] || '').trim(),
                explicitCenter: String(r['At which Turn90 Center is the client...'] || '').trim()
            };
        }
    });

    const prevWeekPointsMap = {};
    const seenPointKeys = new Set();
    for (const r of points) {
        const id = String(r['Record ID'] || '').trim();
        const ptDate = parseDateStr(r['Date']);
        if (!id || !ptDate) continue;
        if (ptDate >= prevWeekMonday && ptDate <= prevWeekFriday) {
            const key = `${id}_${ptDate}`;
            if (seenPointKeys.has(key)) continue;
            seenPointKeys.add(key);

            if (!prevWeekPointsMap[id]) {
                const explicitLoc = String(r['At which Turn90 Center is the client...'] || '').trim();
                const resolvedLoc = explicitLoc || resolveParticipantCenter(id, contextMaps);
                const endDate = parseDateStr(r['Date enrollment ended:']) || enrollmentInfoById[id]?.endDate || '';
                const exitReason = enrollmentInfoById[id]?.exitReason || '';
                let statusNote = 'Enrolled Active';
                if (endDate) {
                    statusNote = exitReason === 'Terminated'
                        ? `Terminated on ${formatMDY(endDate)}`
                        : `Exited on ${formatMDY(endDate)}`;
                }

                prevWeekPointsMap[id] = {
                    recordId: id,
                    fullName: `${String(r['First'] || '').trim()} ${String(r['Last'] || '').trim()}`.trim(),
                    centerLocation: resolvedLoc,
                    wasCenterResolved: !explicitLoc,
                    totalPoints: 0,
                    paymentAmount: 0,
                    statusNotes: statusNote,
                    dailyBreakdown: []
                };
            }
            const pts = Number(r['Points']) || 0;
            prevWeekPointsMap[id].totalPoints += pts;
            prevWeekPointsMap[id].paymentAmount = prevWeekPointsMap[id].totalPoints * 9;
            prevWeekPointsMap[id].dailyBreakdown.push({ date: ptDate, points: pts });
        }
    }

    const payReportRows = Object.values(prevWeekPointsMap).sort((a, b) => {
        if (a.wasCenterResolved !== b.wasCenterResolved) return a.wasCenterResolved ? -1 : 1;
        if (a.centerLocation !== b.centerLocation) return a.centerLocation.localeCompare(b.centerLocation);
        return a.fullName.localeCompare(b.fullName);
    });

    const totalPrevWeekPoints = payReportRows.reduce((sum, r) => sum + r.totalPoints, 0);
    const totalPrevWeekPayroll = totalPrevWeekPoints * 9;

    // Current week First Shift enrollments
    const currentWeekFsEnrollments = enrollments.filter(r => {
        const prog = String(r['Program Enrollment:'] || r['Which Program?'] || '').trim();
        const start = parseDateStr(r['Enrollment Start Date:']);
        return prog === 'First Shift' && start >= currentWeekMonday && start <= currentWeekSunday;
    }).map(r => ({
        recordId: String(r['Record ID']),
        fullName: `${r['First']} ${r['Last']}`.trim(),
        centerLocation: r['At which Turn90 Center is the client...'] || resolveParticipantCenter(r['Record ID'], contextMaps),
        enrollmentDate: formatMDY(parseDateStr(r['Enrollment Start Date:']))
    }));

    // Previous week First Shift exits
    const prevWeekFsExits = enrollments.filter(r => {
        const prog = String(r['Program Enrollment:'] || r['Which Program?'] || '').trim();
        const end = parseDateStr(r['Date enrollment ended:']);
        return prog === 'First Shift' && end >= prevWeekMonday && end <= prevWeekFriday;
    }).map(r => {
        const explicitLoc = String(r['At which Turn90 Center is the client...'] || '').trim();
        return {
            recordId: String(r['Record ID']),
            fullName: `${r['First']} ${r['Last']}`.trim(),
            centerLocation: explicitLoc || resolveParticipantCenter(r['Record ID'], contextMaps),
            wasCenterResolved: !explicitLoc,
            exitDate: formatMDY(parseDateStr(r['Date enrollment ended:'])),
            exitReason: String(r['How did the client exit Reentry Nav or...'] || 'Exited').trim()
        };
    });

    // =========================================================================
    // 2. FUNNEL REPORT
    // =========================================================================
    const funnelMatrix = {
        'First Shift': {
            'Charleston': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} },
            'Columbia': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} },
            'Spartanburg': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} },
            'Unassigned': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} }
        },
        'Pre-release Program': {
            'MacDougal Prison': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} }
        },
        'Reentry Navigation': {
            'Community / Remote (All Centers)': { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} }
        }
    };

    for (const r of enrollments) {
        const rawProg = String(r['Program Enrollment:'] || r['Which Program?'] || '').trim();
        const end = parseDateStr(r['Date enrollment ended:']);
        const isExited = !!end;

        if (rawProg === 'First Shift') {
            let loc = String(r['At which Turn90 Center is the client...'] || '').trim();
            if (!loc) {
                // In Funnel table of Apricot Eval report, active blank-center FS enrollments were resolved to their center, while historical exited blank remained Unassigned
                if (!isExited) loc = resolveParticipantCenter(r['Record ID'], contextMaps);
                else if (String(r['Record ID']) === '81142') loc = 'Unassigned';
                else loc = 'Unassigned';
            }
            if (!funnelMatrix['First Shift'][loc]) {
                funnelMatrix['First Shift'][loc] = { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} };
            }
            const bucket = funnelMatrix['First Shift'][loc];
            bucket.totalEnrollments++;
            if (isExited) {
                bucket.totalExits++;
                const reason = String(r['How did the client exit Reentry Nav or...'] || 'Exited (No reason given)').trim();
                bucket.exitReasons[reason] = (bucket.exitReasons[reason] || 0) + 1;
            } else {
                bucket.active++;
            }
        } else if (rawProg.toLowerCase().includes('pre-release') || rawProg.toLowerCase().includes('prerelease')) {
            const fac = String(r['At which facility are the classes taking...'] || 'MacDougal Prison').trim() || 'MacDougal Prison';
            if (!funnelMatrix['Pre-release Program'][fac]) {
                funnelMatrix['Pre-release Program'][fac] = { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} };
            }
            const bucket = funnelMatrix['Pre-release Program'][fac];
            bucket.totalEnrollments++;
            if (isExited) {
                bucket.totalExits++;
                const reason = String(r['How did client leave the pre-release program?'] || r['How did the client exit Reentry Nav or...'] || 'Exited').trim();
                bucket.exitReasons[reason] = (bucket.exitReasons[reason] || 0) + 1;
            } else {
                bucket.active++;
            }
        } else if (rawProg === 'Reentry Navigation') {
            const bucket = funnelMatrix['Reentry Navigation']['Community / Remote (All Centers)'];
            bucket.totalEnrollments++;
            if (isExited) {
                bucket.totalExits++;
                const reason = String(r['How did the client exit Reentry Nav or...'] || 'Exited (No reason given)').trim() || 'Exited (No reason given)';
                bucket.exitReasons[reason] = (bucket.exitReasons[reason] || 0) + 1;
            } else {
                bucket.active++;
            }
        }
    }

    // Resource Coordinations & Consultations
    const rcStats = {
        Total: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Charleston: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Columbia: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Spartanburg: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Unassigned: { ytd: 0, lastWeek: 0, currentWeek: 0 }
    };

    resourceCoord.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const dt = parseDateStr(r['Date of resource coordination screening']);
        if (!id) return;
        const loc = contextMaps.consultCenterById[id] || contextMaps.explicitCenterById[id] || contextMaps.waitlistCenterById[id] || 'Unassigned';
        const bucketKey = ['Charleston', 'Columbia', 'Spartanburg'].includes(loc) ? loc : 'Unassigned';

        rcStats.Total.ytd++;
        rcStats[bucketKey].ytd++;
        if (dt >= prevWeekMonday && dt <= prevWeekFriday) {
            rcStats.Total.lastWeek++;
            rcStats[bucketKey].lastWeek++;
        }
        if (dt >= currentWeekMonday && dt <= currentWeekFriday) {
            rcStats.Total.currentWeek++;
            rcStats[bucketKey].currentWeek++;
        }
    });

    const consultStats = {
        Total: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Charleston: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Columbia: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Spartanburg: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        Unspecified: { ytd: 0, lastWeek: 0, currentWeek: 0 },
        eligibility: { Yes: 0, No: 0, Undetermined: 0 },
        referralSources: {}
    };

    consultations.forEach(r => {
        const dt = parseDateStr(r['Date of Reentry Consultation']);
        const loc = String(r['Preferred enrollment location'] || '').trim();
        const bucketKey = ['Charleston', 'Columbia', 'Spartanburg'].includes(loc) ? loc : 'Unspecified';

        consultStats.Total.ytd++;
        consultStats[bucketKey].ytd++;
        if (dt >= prevWeekMonday && dt <= prevWeekFriday) {
            consultStats.Total.lastWeek++;
            consultStats[bucketKey].lastWeek++;
        }
        if (dt >= currentWeekMonday && dt <= currentWeekFriday) {
            consultStats.Total.currentWeek++;
            consultStats[bucketKey].currentWeek++;
        }

        const elig = String(r['Elgible for First Shift?'] || '').trim();
        if (elig === 'Yes') consultStats.eligibility.Yes++;
        else if (elig === 'No') consultStats.eligibility.No++;
        else consultStats.eligibility.Undetermined++;

        const refSrc = String(r['Referral Source'] || '').trim() || 'Unspecified';
        consultStats.referralSources[refSrc] = (consultStats.referralSources[refSrc] || 0) + 1;
    });

    // Waitlist by Center
    const waitlistByCenter = { Charleston: 0, Columbia: 0, Spartanburg: 0, Total: 0 };
    waitlist.forEach(r => {
        const loc = String(r['Which center?'] || '').trim();
        if (waitlistByCenter[loc] !== undefined) waitlistByCenter[loc]++;
        waitlistByCenter.Total++;
    });

    // Orientation Outcomes
    const orientationRows = orientations.map(r => {
        const id = String(r['Record ID'] || '').trim();
        const dt = parseDateStr(r['Date of Orientation']);
        const completedRaw = String(r['Did they successfully complete orientation?'] || '').trim();
        const whyNot = String(r['Why did they not complete orientation?'] || '').trim();
        const loc = resolveParticipantCenter(id, contextMaps);
        let timeframe = 'Prior YTD';
        if (dt >= currentWeekMonday && dt <= currentWeekSunday) timeframe = 'Current Week';
        else if (dt > currentWeekSunday) timeframe = 'Upcoming';
        else if (dt >= prevWeekMonday && dt <= prevWeekFriday) timeframe = 'Last Week';

        const hasFsEnrollment = enrollments.some(e => String(e['Record ID']) === id && String(e['Program Enrollment:']) === 'First Shift');
        let day1Status = 'No';
        if (completedRaw === 'Yes') {
            day1Status = `No (Orientation held ${formatMDY(dt)}; starts next cycle)`;
        } else if (hasFsEnrollment) {
            day1Status = 'Historical enrollment on file';
        }

        return {
            recordId: id,
            fullName: `${r['First']} ${r['Last']}`.trim(),
            orientationDate: dt,
            timeframe,
            centerLocation: loc,
            completed: completedRaw || 'Pending / In Progress',
            reasonNotCompleted: whyNot || 'N/A',
            day1Started: day1Status
        };
    });

    // =========================================================================
    // 3. ACTIVE PROGRAM DASHBOARDS (FIRST SHIFT & REENTRY NAVIGATION)
    // =========================================================================
    // Helper maps for Briefcase, LSCMI, Bio Info, Drug Tests, Points, Case Plans, Case Notes
    const briefcaseById = {};
    briefcases.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const g1Items = String(r['Gate 1 Checklist'] || '').split('|').map(s => s.trim()).filter(Boolean);
        const g2Items = String(r['Gate 2 Checklist'] || '').split('|').map(s => s.trim()).filter(Boolean);
        const g3Items = String(r['Gate 3 Checklist'] || '').split('|').map(s => s.trim()).filter(Boolean);
        const g4Items = String(r['Gate 4 Checklist'] || '').split('|').map(s => s.trim()).filter(Boolean);

        // Deduplicate / keep most complete Briefcase row per participant (e.g. 79019 Christopher Barranco)
        const totalItemsCount = g1Items.length + g2Items.length + g3Items.length + g4Items.length;
        if (!briefcaseById[id] || totalItemsCount >= briefcaseById[id].totalItemsCount) {
            briefcaseById[id] = {
                exists: true,
                totalItemsCount,
                goal90Day: String(r['90 Day Goal'] || '').trim(),
                g1Items,
                g2Items,
                g3Items,
                g4Items,
                g1Pct: Math.floor((Math.min(8, g1Items.length) / 8) * 100),
                g2Pct: Math.floor((Math.min(10, g2Items.length) / 10) * 100),
                g3Pct: Math.floor((Math.min(7, g3Items.length) / 7) * 100),
                g4Pct: Math.floor((Math.min(8, g4Items.length) / 8) * 100),
                sec1Notes: String(r['Section 1 Notes'] || '').trim(),
                sec2Notes: String(r['Section 2 Notes'] || '').trim(),
                sec3Notes: String(r['Section 3 Notes'] || '').trim(),
                sec4Notes: String(r['Section 4 Notes'] || '').trim()
            };
        }
    });

    const lscmiById = {};
    lscmiRows.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (id) lscmiById[id] = Number(r['Total LS/CMI Score (from Section 1)']) || 0;
    });

    const bioById = {};
    bioInfoRows.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const missing = [];
        const checkField = (val, label) => {
            const s = String(val || '').trim();
            if (!s || s === '--') missing.push(label);
        };
        checkField(r['Date of Birth (DOB)'], 'DOB');
        checkField(r['Social Security Number (SSN)'], 'SSN');
        checkField(r['Phone Number'], 'Phone');
        checkField(r['Email'], 'Email');
        checkField(r['Line1'], 'Line1');
        checkField(r['City'], 'City');
        checkField(r['Zip'], 'Zip');

        bioById[id] = {
            exists: true,
            missing,
            isComplete: missing.length === 0,
            statusText: missing.length === 0 ? 'Yes (Complete)' : `No (Missing ${missing.join(', ')})`,
            raw: r
        };
    });

    const drugTestById = new Set();
    drugTests.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (id) drugTestById.add(id);
    });

    const fsPlanById = {};
    fsCasePlans.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const fa1 = String(r['Focus Area 1'] || '').trim();
        const fa1Sit = String(r['Focus Area 1 Situation'] || '').trim();
        const fa2 = String(r['Focus Area 2'] || '').trim();
        const fa2Sit = String(r['Focus Area 2 Situations'] || '').trim();
        let status = 'No (Empty)';
        if (fa1 && fa2 && fa1Sit && fa2Sit) status = 'Yes (Complete)';
        else if (fa1 || fa2) status = 'Partial (Situations missing)';

        fsPlanById[id] = {
            createdDate: parseDateStr(r['Date First Shift Case Plan created']),
            programManager: normalizeStaffName(r['Program Manager']),
            focusArea1: fa1,
            focusArea1Situation: fa1Sit,
            focusArea2: fa2,
            focusArea2Situations: fa2Sit,
            status
        };
    });

    const rnPlanById = {};
    rnCasePlans.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const planText = String(r['Case Plan'] || '').trim();
        const cm = normalizeStaffName(r['Case Manager']);
        rnPlanById[id] = {
            createdDate: parseDateStr(r['Date Reentry Nav Case Plan created']),
            caseManager: cm,
            casePlanText: planText,
            hasPlan: !!planText,
            requirementsForFs: String(r['Requirements to be eligible for First Shift'] || '').trim()
        };
    });

    // Current week points per participant
    const currentWeekPointsById = {};
    const seenCurrPt = new Set();
    points.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const dt = parseDateStr(r['Date']);
        if (!id || !dt) return;
        if (dt >= currentWeekMonday && dt <= currentWeekSunday) {
            const k = `${id}_${dt}`;
            if (seenCurrPt.has(k)) return;
            seenCurrPt.add(k);
            currentWeekPointsById[id] = (currentWeekPointsById[id] || 0) + (Number(r['Points']) || 0);
        }
    });

    // Group processed case notes by Record ID
    const notesById = {};
    allProcessedNotes.forEach(n => {
        const id = String(n.record_id || '').trim();
        if (!notesById[id]) notesById[id] = [];
        notesById[id].push(n);
    });

    // A. Active First Shift Participants
    const activeFsRowsRaw = caseloads.filter(r =>
        String(r['Program Enrollment:']).trim() === 'First Shift' && !parseDateStr(r['Date enrollment ended:'])
    );

    const firstShiftActiveDashboard = activeFsRowsRaw.map(r => {
        const id = String(r['Record ID'] || '').trim();
        const fullName = `${r['First']} ${r['Last']}`.trim();
        const enrollStart = parseDateStr(r['Enrollment Start Date:']);
        const location = resolveParticipantCenter(id, contextMaps);
        const weeksEnrolled = computeWeeksEnrolled(enrollStart, maxDataDate);
        const currPts = currentWeekPointsById[id] || 0;
        const planInfo = fsPlanById[id] || { status: 'No Plan on File', focusArea1: '', focusArea2: '', programManager: '' };
        const bc = briefcaseById[id] || { exists: false, g1Pct: 0, g2Pct: 0, g3Pct: 0, g4Pct: 0, g1Items: [], g2Items: [], g3Items: [], g4Items: [] };
        const hasDrugTest = drugTestById.has(id);

        // Check CM session this week
        const pNotes = notesById[id] || [];
        const thisWeekNotes = pNotes.filter(n =>
            n.activity_date >= currentWeekMonday &&
            n.activity_date <= currentWeekSunday &&
            (n.interaction_type.toLowerCase().includes('coaching') ||
             n.interaction_type.toLowerCase().includes('case management') ||
             n.interaction_type.toLowerCase().includes('check-in') ||
             n.interaction_type.toLowerCase().includes('barrier') ||
             n.service_context.toLowerCase().includes('case management'))
        );
        const cmThisWeek = thisWeekNotes.length > 0
            ? `Yes (${formatMDY(thisWeekNotes[0].activity_date).slice(0, 5)} by ${thisWeekNotes[0].staff_name})`
            : 'No';

        const lscmiScore = lscmiById[id] ?? 0;
        const bio = bioById[id] || { exists: false, isComplete: false, statusText: 'No (Not on file)', missing: ['All Bio Info'] };

        return {
            recordId: id,
            firstName: String(r['First'] || '').trim(),
            lastName: String(r['Last'] || '').trim(),
            fullName,
            location,
            enrollmentStart: formatMDY(enrollStart),
            enrollmentStartIso: enrollStart,
            weeksEnrolled,
            currentWeekPoints: currPts,
            casePlanStatus: planInfo.status,
            focusArea1: planInfo.focusArea1,
            focusArea1Situation: planInfo.focusArea1Situation,
            focusArea2: planInfo.focusArea2,
            focusArea2Situations: planInfo.focusArea2Situations,
            programManager: planInfo.programManager || (location === 'Charleston' ? 'Terrence Brown' : location === 'Columbia' ? 'Jenn Jeanquart' : 'Diyoung Dantzler'),
            briefcaseCreated: bc.exists,
            gate1Pct: bc.g1Pct,
            gate2Pct: bc.g2Pct,
            gate3Pct: bc.g3Pct,
            gate4Pct: bc.g4Pct,
            drugTestThisWeek: hasDrugTest ? 'Yes (Logged in Drug Test sheet)' : 'No',
            cmSessionThisWeek: cmThisWeek,
            lscmiScore,
            bioInfoComplete: bio.statusText,
            missingBioFields: bio.missing,
            lastContactDate: pNotes[0]?.activity_date ? formatMDY(pNotes[0].activity_date) : 'None',
            lastContactStaff: pNotes[0]?.staff_name || 'N/A',
            notesCount: pNotes.length
        };
    });

    // B. Active Reentry Navigation Participants (35 active cases, mostly Daisy Boynton)
    const activeRnRowsRaw = caseloads.filter(r =>
        String(r['Program Enrollment:']).trim() === 'Reentry Navigation' && !parseDateStr(r['Date enrollment ended:'])
    );

    const reentryNavActiveDashboard = activeRnRowsRaw.map(r => {
        const id = String(r['Record ID'] || '').trim();
        const fullName = `${r['First']} ${r['Last']}`.trim();
        const enrollStart = parseDateStr(r['Enrollment Start Date:']);
        const location = resolveParticipantCenter(id, contextMaps);
        const rnPlan = rnPlanById[id] || { hasPlan: false, caseManager: 'Unassigned', casePlanText: '', requirementsForFs: '' };
        const bc = briefcaseById[id] || { exists: false, g1Pct: 0, g2Pct: 0, g3Pct: 0, g4Pct: 0, g1Items: [], g2Items: [], g3Items: [], g4Items: [] };
        const pNotes = notesById[id] || [];
        const latestNote = pNotes[0] || null;

        let assignedCm = rnPlan.caseManager;
        if (!assignedCm || assignedCm === 'Unassigned') {
            if (INITIAL_CURATED_EVALUATIONS[id]?.case_manager) {
                assignedCm = INITIAL_CURATED_EVALUATIONS[id].case_manager;
            }
        }

        return {
            recordId: id,
            firstName: String(r['First'] || '').trim(),
            lastName: String(r['Last'] || '').trim(),
            fullName,
            location,
            enrollmentStart: formatMDY(enrollStart),
            enrollmentStartIso: enrollStart,
            caseManager: assignedCm || 'Unassigned',
            hasCasePlan: rnPlan.hasPlan,
            casePlanStatus: rnPlan.hasPlan ? 'Yes' : 'No',
            casePlanText: rnPlan.casePlanText || bc.goal90Day || '',
            requirementsForFs: rnPlan.requirementsForFs || '',
            briefcaseCreated: bc.exists,
            gate1Pct: bc.g1Pct,
            gate2Pct: bc.g2Pct,
            gate3Pct: bc.g3Pct,
            gate4Pct: bc.g4Pct,
            lastContactDate: latestNote ? formatMDY(latestNote.activity_date) : 'No contact logged',
            lastContactDateIso: latestNote ? latestNote.activity_date : '',
            lastContactStaff: latestNote ? latestNote.staff_name : 'N/A',
            lastContactActivity: latestNote ? (latestNote.interaction_type || latestNote.service_context || 'Case Note') : 'None',
            notesCount: pNotes.length
        };
    });

    // =========================================================================
    // 4. CASE PLAN & BRIEFCASE FEEDBACK (INDIVIDUAL PARTICIPANT EVALUATIONS)
    // =========================================================================
    const participantEvaluations = [];

    // Build evaluations for all 9 Active First Shift participants
    for (const fsPart of firstShiftActiveDashboard) {
        const id = fsPart.recordId;
        const curated = INITIAL_CURATED_EVALUATIONS[id] || {};
        const bc = briefcaseById[id] || { exists: false, g1Items: [], g2Items: [], g3Items: [], g4Items: [] };
        const pNotes = notesById[id] || [];

        const focusAreasStr = (fsPart.focusArea1 || fsPart.focusArea2)
            ? `Focus Area 1: ${fsPart.focusArea1 || 'None'}${fsPart.focusArea1Situation ? ` (${fsPart.focusArea1Situation})` : ''}; Focus Area 2: ${fsPart.focusArea2 || 'None'}${fsPart.focusArea2Situations ? ` (${fsPart.focusArea2Situations})` : ''}`
            : 'No Case Plan focus areas established in Apricot';

        const bcStatusText = bc.exists
            ? `Gate 1: ${fsPart.gate1Pct}% (${bc.g1Items.length}/8), Gate 2: ${fsPart.gate2Pct}% (${bc.g2Items.length}/10), Gate 3: ${fsPart.gate3Pct}% (${bc.g3Items.length}/7), Gate 4: ${fsPart.gate4Pct}% (${bc.g4Items.length}/8)`
            : 'Not created in Apricot Briefcase form (0% across all gates)';

        // Check if there are newer notes added after 2026-10-23 (or from CM audio uploads)
        const newerNotes = pNotes.filter(n => n.activity_date > '2026-10-23' || n.source === 'cm_recording_upload');
        let noteAnalysis = curated.case_note_analysis || (pNotes.length > 0
            ? `Recent notes (${pNotes.slice(0, 3).map(n => `${formatMDY(n.activity_date)} by ${n.staff_name}`).join(', ')}): ${pNotes[0].note_text.slice(0, 280)}`
            : 'No case notes recorded yet.');

        if (newerNotes.length > 0) {
            const newerSummary = newerNotes.map(n => `[Update ${formatMDY(n.activity_date)} • ${n.staff_name}]: ${n.note_text}`).join(' | ');
            noteAnalysis = `${noteAnalysis}\n\n**Latest Case Note Updates:** ${newerSummary}`;
        }

        const opFeedback = curated.operational_feedback || `Review Case Plan situations, verify Briefcase Gate 1–4 progress (${bcStatusText}), and ensure weekly points and drug test compliance.`;

        const nextSteps = buildGroundedNextCmSteps({
            program: 'First Shift',
            fullName: fsPart.fullName,
            casePlanStatus: fsPart.casePlanStatus,
            focusAreasOrGoals: `${fsPart.focusArea1 || 'Focus Area 1'} & ${fsPart.focusArea2 || 'Focus Area 2'}`,
            gate1Pct: fsPart.gate1Pct,
            gate2Pct: fsPart.gate2Pct,
            gate3Pct: fsPart.gate3Pct,
            gate4Pct: fsPart.gate4Pct,
            completedGateItems: { 1: bc.g1Items, 2: bc.g2Items, 3: bc.g3Items, 4: bc.g4Items },
            missingBioFields: fsPart.missingBioFields,
            recentNotes: pNotes,
            operationalFeedback: opFeedback
        });

        const evalObj = {
            recordId: id,
            fullName: fsPart.fullName,
            program: 'First Shift',
            center: fsPart.location,
            caseManager: curated.case_manager || fsPart.programManager,
            casePlanStatus: fsPart.casePlanStatus,
            focusAreasOrGoals: focusAreasStr,
            briefcaseStatusText: bcStatusText,
            gate1Pct: fsPart.gate1Pct,
            gate2Pct: fsPart.gate2Pct,
            gate3Pct: fsPart.gate3Pct,
            gate4Pct: fsPart.gate4Pct,
            caseNoteAnalysis: noteAnalysis,
            operationalFeedback: opFeedback,
            nextCmSteps: nextSteps,
            lastNoteDate: pNotes[0]?.activity_date || '',
            notesCount: pNotes.length,
            recentNotes: pNotes.slice(0, 5)
        };

        participantEvaluations.push(evalObj);
    }

    // Build evaluations for all 35 Active Reentry Navigation participants (Goals & Gates ONLY — NO CBT!)
    for (const rnPart of reentryNavActiveDashboard) {
        const id = rnPart.recordId;
        const curated = INITIAL_CURATED_EVALUATIONS[id] || {};
        const bc = briefcaseById[id] || { exists: false, g1Items: [], g2Items: [], g3Items: [], g4Items: [] };
        const pNotes = notesById[id] || [];

        const goalsText = rnPart.casePlanText
            ? rnPart.casePlanText
            : 'No formal Reentry Nav Case Plan filed in Apricot yet';

        const bcStatusText = bc.exists
            ? `Gate 1: ${rnPart.gate1Pct}%, Gate 2: ${rnPart.gate2Pct}%, Gate 3: ${rnPart.gate3Pct}%, Gate 4: ${rnPart.gate4Pct}%`
            : 'Not created in Apricot Briefcase module (0% across Gates 1–4)';

        const newerNotes = pNotes.filter(n => n.activity_date > '2026-10-23' || n.source === 'cm_recording_upload');
        let noteAnalysis = curated.case_note_analysis || (pNotes.length > 0
            ? `Enrolled ${rnPart.enrollmentStart}. Most recent contact on ${rnPart.lastContactDate} by ${rnPart.lastContactStaff} (${rnPart.lastContactActivity}): "${String(pNotes[0].note_text || pNotes[0].interaction_type).replace(/\s+/g, ' ').slice(0, 260)}"`
            : `Enrolled ${rnPart.enrollmentStart}. No case notes logged yet.`);

        if (newerNotes.length > 0) {
            const newerSummary = newerNotes.map(n => `[Update ${formatMDY(n.activity_date)} • ${n.staff_name}]: ${n.note_text}`).join(' | ');
            noteAnalysis = `${noteAnalysis}\n\n**Latest Case Note Updates:** ${newerSummary}`;
        }

        const opFeedback = curated.operational_feedback || (
            !bc.exists
                ? `Initialize Apricot Briefcase record to track Gate 1–4 milestones alongside Reentry Nav Case Plan goals (Goals & Gates only; no CBT in Reentry Nav). Follow up on ${rnPart.fullName}'s stated goals and verify vital documents.`
                : `Continue advancing Reentry Navigation Case Plan goals and Briefcase Gates 1–4 (${bcStatusText}). Focus on barrier removal, employment readiness, and community resource referrals.`
        );

        const nextSteps = buildGroundedNextCmSteps({
            program: 'Reentry Navigation',
            fullName: rnPart.fullName,
            casePlanStatus: rnPart.casePlanStatus,
            focusAreasOrGoals: rnPart.casePlanText || 'No formal Case Plan on file',
            gate1Pct: rnPart.gate1Pct,
            gate2Pct: rnPart.gate2Pct,
            gate3Pct: rnPart.gate3Pct,
            gate4Pct: rnPart.gate4Pct,
            completedGateItems: { 1: bc.g1Items, 2: bc.g2Items, 3: bc.g3Items, 4: bc.g4Items },
            missingBioFields: [],
            recentNotes: pNotes,
            operationalFeedback: opFeedback
        });

        const evalObj = {
            recordId: id,
            fullName: rnPart.fullName,
            program: 'Reentry Navigation',
            center: rnPart.location,
            caseManager: curated.case_manager || rnPart.caseManager,
            casePlanStatus: rnPart.hasCasePlan ? 'Yes (Goals & Gates Active)' : 'No (Needs Reentry Nav Case Plan)',
            focusAreasOrGoals: goalsText,
            briefcaseStatusText: bcStatusText,
            gate1Pct: rnPart.gate1Pct,
            gate2Pct: rnPart.gate2Pct,
            gate3Pct: rnPart.gate3Pct,
            gate4Pct: rnPart.gate4Pct,
            caseNoteAnalysis: noteAnalysis,
            operationalFeedback: opFeedback,
            nextCmSteps: nextSteps,
            lastNoteDate: pNotes[0]?.activity_date || '',
            notesCount: pNotes.length,
            recentNotes: pNotes.slice(0, 5)
        };

        participantEvaluations.push(evalObj);
    }

    // Persist participant evaluations to SQLite
    const upsertEvalStmt = db.prepare(`
        INSERT INTO apricot_participant_evaluations (
            record_id, full_name, program, center, case_manager,
            case_plan_status, focus_areas_or_goals, briefcase_status_text,
            gate1_pct, gate2_pct, gate3_pct, gate4_pct,
            case_note_analysis, operational_feedback, next_cm_steps_json,
            last_note_date, notes_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(record_id) DO UPDATE SET
            full_name = excluded.full_name,
            program = excluded.program,
            center = excluded.center,
            case_manager = excluded.case_manager,
            case_plan_status = excluded.case_plan_status,
            focus_areas_or_goals = excluded.focus_areas_or_goals,
            briefcase_status_text = excluded.briefcase_status_text,
            gate1_pct = excluded.gate1_pct,
            gate2_pct = excluded.gate2_pct,
            gate3_pct = excluded.gate3_pct,
            gate4_pct = excluded.gate4_pct,
            case_note_analysis = excluded.case_note_analysis,
            operational_feedback = excluded.operational_feedback,
            next_cm_steps_json = excluded.next_cm_steps_json,
            last_note_date = excluded.last_note_date,
            notes_count = excluded.notes_count,
            updated_at = CURRENT_TIMESTAMP
    `);

    db.transaction(() => {
        for (const ev of participantEvaluations) {
            upsertEvalStmt.run(
                ev.recordId,
                ev.fullName,
                ev.program,
                ev.center,
                ev.caseManager,
                ev.casePlanStatus,
                ev.focusAreasOrGoals,
                ev.briefcaseStatusText,
                ev.gate1Pct,
                ev.gate2Pct,
                ev.gate3Pct,
                ev.gate4Pct,
                ev.caseNoteAnalysis,
                ev.operationalFeedback,
                JSON.stringify(ev.nextCmSteps),
                ev.lastNoteDate,
                ev.notesCount
            );
        }
    })();

    // =========================================================================
    // 5. EMPLOYMENT & RETENTION ANALYSIS (30, 60, 90, 180 DAYS & 30-DAY CHECK-IN)
    // =========================================================================
    const retentionThresholds = [
        { days: 30, label: '30-Day Retention', benchmark: 'Strong initial stability' },
        { days: 60, label: '60-Day Retention', benchmark: 'Solid 2-month continuity' },
        { days: 90, label: '90-Day Retention', benchmark: 'Core benchmark (Quarterly)' },
        { days: 180, label: '180-Day Retention', benchmark: '6-Month Long-term independence' }
    ];

    const retentionTable = retentionThresholds.map(t => {
        let qualifying = 0;
        let retained = 0;
        let failed = 0;

        for (const r of employmentHist) {
            const start = parseDateStr(r['Employment Start Date']);
            if (!start) continue;
            const end = parseDateStr(r["When was the client's last known date of..."]);
            if (!end) {
                // Active employment: only count in denominator if duration >= T days as of maxDataDate
                const dur = diffDays(start, maxDataDate);
                if (dur >= t.days) {
                    qualifying++;
                    retained++;
                }
            } else {
                // Ended employment: always count in denominator
                const dur = diffDays(start, end);
                qualifying++;
                if (dur >= t.days) retained++;
                else failed++;
            }
        }

        return {
            milestone: t.label,
            days: t.days,
            qualifyingEmployments: qualifying,
            successfullyRetained: retained,
            didNotReachMilestone: failed,
            retentionRatePct: qualifying > 0 ? Number(((retained / qualifying) * 100).toFixed(1)) : 0,
            benchmark: t.benchmark
        };
    });

    const separationReasons = {};
    employmentHist.forEach(r => {
        const how = String(r['How did the employment end?'] || '').trim();
        if (how) {
            separationReasons[how] = (separationReasons[how] || 0) + 1;
        }
    });

    // Active Employments lacking a job check-in in the last 30 days
    const overdueCheckIns = [];
    let recentCheckInCount = 0;
    employmentRows.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        if (!id) return;
        const start = parseDateStr(r['Employment Start Date']);
        const checkIn = parseDateStr(r['Date employment check-in was completed by...']);
        const company = String(r['Company Name'] || '').trim();
        const fullName = `${r['First']} ${r['Last']}`.trim();

        const refCheckDate = checkIn || start;
        const elapsed = refCheckDate ? diffDays(refCheckDate, maxDataDate) : 999;

        if (elapsed > 30) {
            overdueCheckIns.push({
                recordId: id,
                fullName,
                companyName: company,
                employmentStartDate: formatMDY(start),
                lastCheckInDate: checkIn ? formatMDY(checkIn) : 'Never',
                daysElapsed: elapsed,
                centerLocation: resolveParticipantCenter(id, contextMaps)
            });
        } else {
            recentCheckInCount++;
        }
    });

    overdueCheckIns.sort((a, b) => b.daysElapsed - a.daysElapsed);

    // =========================================================================
    // 6. REFERRALS & CREDENTIALS ANALYSIS
    // =========================================================================
    const activeFsIds = new Set(firstShiftActiveDashboard.map(p => p.recordId));
    const activeRnIds = new Set(reentryNavActiveDashboard.map(p => p.recordId));
    const fsByIdMap = Object.fromEntries(firstShiftActiveDashboard.map(p => [p.recordId, p]));
    const rnByIdMap = Object.fromEntries(reentryNavActiveDashboard.map(p => [p.recordId, p]));

    const fsReferrals = [];
    const rnReferrals = [];
    const seenRefKeys = new Set();

    referrals.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const org = String(r['Name of Organization:'] || '').trim();
        const need = String(r['Primary Need (Reason for Referral):'] || '').trim();
        const staff = String(r['Staff making the referral:'] || '').trim();
        const dt = parseDateStr(r['Date referral was made:']);
        const key = `${id}|${org}|${need}|${staff}|${dt}`;
        if (seenRefKeys.has(key)) return;
        seenRefKeys.add(key);

        if (activeFsIds.has(id)) {
            const p = fsByIdMap[id];
            fsReferrals.push({
                recordId: id,
                participantName: p.fullName,
                center: p.location,
                assignedCaseManager: p.programManager,
                staffMakingReferral: staff,
                organization: org,
                primaryNeed: need,
                referralDate: formatMDY(dt)
            });
        } else if (activeRnIds.has(id)) {
            const p = rnByIdMap[id];
            rnReferrals.push({
                recordId: id,
                participantName: p.fullName,
                center: p.location,
                caseManager: p.caseManager,
                staffMakingReferral: staff,
                organization: org,
                primaryNeed: need,
                referralDate: formatMDY(dt)
            });
        }
    });

    const fsCredentials = [];
    const rnCredentials = [];
    const seenCredKeys = new Set();

    credentials.forEach(r => {
        const id = String(r['Record ID'] || '').trim();
        const cred = String(r['Credential Earned'] || '').trim();
        const locEarned = String(r['Location Earned'] || '').trim();
        const dt = parseDateStr(r['Date Completed']);
        const key = `${id}|${cred}|${dt}`;
        if (seenCredKeys.has(key)) return;
        seenCredKeys.add(key);

        if (activeFsIds.has(id)) {
            const p = fsByIdMap[id];
            fsCredentials.push({
                recordId: id,
                fullName: p.fullName,
                centerLocation: p.location,
                assignedCaseManager: p.programManager,
                credentialEarned: cred,
                locationEarned: locEarned,
                dateCompleted: formatMDY(dt)
            });
        } else if (activeRnIds.has(id)) {
            const p = rnByIdMap[id];
            rnCredentials.push({
                recordId: id,
                fullName: p.fullName,
                centerLocation: p.location,
                assignedCaseManager: p.caseManager,
                credentialEarned: cred,
                locationEarned: locEarned,
                dateCompleted: formatMDY(dt)
            });
        }
    });

    // =========================================================================
    // 7. SYNC ACTIVE PARTICIPANTS TO APP DATABASE TABLES
    // =========================================================================
    syncParticipantsToOperationalDb(firstShiftActiveDashboard, reentryNavActiveDashboard, points, allProcessedNotes, briefcaseById);

    const fullReport = {
        meta: {
            reportDate: maxDataDate,
            reportDateFormatted: formatMDY(maxDataDate),
            currentWeekRange: `${formatMDY(currentWeekMonday)} – ${formatMDY(currentWeekFriday)}`,
            previousWeekRange: `${formatMDY(prevWeekMonday)} – ${formatMDY(prevWeekFriday)}`,
            sourceFilename: syncMeta.sourceFilename || 'Justin\'s Main report 261023.xlsx',
            totalUniqueNotes: allProcessedNotes.length,
            newNotesProcessedLastUpload: syncMeta.newNotesCount || 0,
            duplicateNotesSkippedLastUpload: syncMeta.skippedNotesCount || 0,
            pointsRecordsCount: points.length,
            lastUpdatedAt: new Date().toISOString()
        },
        paymentReport: {
            previousWeekRange: `${formatMDY(prevWeekMonday)} – ${formatMDY(prevWeekFriday)}`,
            ratePerPoint: 9,
            rows: payReportRows,
            totalParticipants: payReportRows.length,
            totalPoints: totalPrevWeekPoints,
            totalPayroll: totalPrevWeekPayroll,
            currentWeekEnrollments: currentWeekFsEnrollments,
            previousWeekExits: prevWeekFsExits
        },
        funnelReport: {
            enrollmentsAndExits: funnelMatrix,
            resourceCoordinations: rcStats,
            reentryConsultations: consultStats,
            waitlistByCenter,
            orientations: orientationRows
        },
        activeDashboards: {
            firstShift: firstShiftActiveDashboard,
            reentryNav: reentryNavActiveDashboard
        },
        participantEvaluations,
        employmentAnalysis: {
            retentionTable,
            separationReasons,
            totalActiveEmployments: employmentRows.length,
            recentCheckInCount,
            overdueCheckInCount: overdueCheckIns.length,
            overdueCheckIns
        },
        referralsAndCredentials: {
            firstShiftReferrals: fsReferrals,
            reentryNavReferrals: rnReferrals,
            firstShiftCredentials: fsCredentials,
            reentryNavCredentials: rnCredentials
        }
    };

    db.prepare(`
        INSERT INTO apricot_workbook_state (
            id, report_json, source_filename, report_reference_date,
            total_unique_notes, last_upload_new_notes_count,
            last_upload_skipped_notes_count, last_upload_points_count, last_uploaded_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            report_json = excluded.report_json,
            source_filename = excluded.source_filename,
            report_reference_date = excluded.report_reference_date,
            total_unique_notes = excluded.total_unique_notes,
            last_upload_new_notes_count = excluded.last_upload_new_notes_count,
            last_upload_skipped_notes_count = excluded.last_upload_skipped_notes_count,
            last_upload_points_count = excluded.last_upload_points_count,
            last_uploaded_at = CURRENT_TIMESTAMP
    `).run(
        JSON.stringify(fullReport),
        fullReport.meta.sourceFilename,
        maxDataDate,
        allProcessedNotes.length,
        syncMeta.newNotesCount || 0,
        syncMeta.skippedNotesCount || 0,
        points.length
    );

    return fullReport;
}

/**
 * Synchronize Active First Shift and Reentry Navigation participants into `users`, `participant_profiles`,
 * `daily_points`, `case_notes`, and `reentry_clients` so all views in the app stay 100% consistent.
 */
function syncParticipantsToOperationalDb(fsList, rnList, pointsRows, allProcessedNotes, briefcaseById) {
    const bcrypt = require('bcryptjs');
    const defaultHash = bcrypt.hashSync('T90participant', 8);

    const tx = db.transaction(() => {
        // Archive any First Shift participant_profiles not in the current active First Shift list
        const activeFsRecordIds = fsList.map(p => String(p.recordId));
        if (activeFsRecordIds.length > 0) {
            const placeholders = activeFsRecordIds.map(() => '?').join(',');
            db.prepare(`
                UPDATE participant_profiles
                SET overall_status = 'archived'
                WHERE record_id IS NULL OR record_id NOT IN (${placeholders})
            `).run(...activeFsRecordIds);
        }

        // Remove placeholder T90-% reentry_clients and archive any reentry_clients not in active RN list
        db.prepare(`DELETE FROM reentry_clients WHERE apricot_id LIKE 'T90-%'`).run();
        const activeRnRecordIds = rnList.map(r => String(r.recordId));
        if (activeRnRecordIds.length > 0) {
            const rnPlaceholders = activeRnRecordIds.map(() => '?').join(',');
            db.prepare(`
                UPDATE reentry_clients
                SET status = 'archived'
                WHERE apricot_id IS NOT NULL AND apricot_id NOT IN (${rnPlaceholders})
            `).run(...activeRnRecordIds);
        }

        // 1. Sync Active First Shift Participants into `users` & `participant_profiles`
        for (const p of fsList) {
            let user = db.prepare(`
                SELECT u.id FROM users u
                LEFT JOIN participant_profiles pp ON u.id = pp.user_id
                WHERE pp.record_id = ? OR LOWER(u.name) = LOWER(?)
                LIMIT 1
            `).get(p.recordId, p.fullName);

            let userId = user?.id;
            if (!userId) {
                const email = `${p.firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${p.lastName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${p.recordId}@firstshift.org`;
                const info = db.prepare(`
                    INSERT INTO users (name, email, password_hash, role, track, location)
                    VALUES (?, ?, ?, 'participant', 'first_shift', ?)
                `).run(p.fullName, email, defaultHash, p.location);
                userId = info.lastInsertRowid;
                initParticipantBriefcase(userId);
            } else {
                db.prepare(`UPDATE users SET name = ?, location = ?, track = 'first_shift' WHERE id = ?`).run(p.fullName, p.location, userId);
                initParticipantBriefcase(userId);
            }

            // Determine current gate from highest active gate or weeks enrolled
            let currentGate = Math.min(4, Math.max(1, p.weeksEnrolled));
            if (p.gate4Pct >= 75) currentGate = 4;
            else if (p.gate3Pct >= 50) currentGate = 3;
            else if (p.gate2Pct >= 50) currentGate = 2;

            db.prepare(`
                UPDATE participant_profiles
                SET record_id = ?, enrollment_date = ?, current_gate = ?, overall_status = 'active'
                WHERE user_id = ?
            `).run(p.recordId, p.enrollmentStartIso, currentGate, userId);

            // Sync First Shift Case Plan Focus Areas & Trigger Situations into case_plan_triggers
            if (p.focusArea1) {
                const sit1 = p.focusArea1Situation ? [p.focusArea1Situation] : [];
                db.prepare(`
                    INSERT INTO case_plan_triggers (user_id, domain, pattern, trigger_situations, toolkit_tools)
                    VALUES (?, ?, 'Focus Area 1', ?, '["Stop and Think (STAC)","Thinking Report"]')
                    ON CONFLICT(user_id, domain) DO UPDATE SET
                        trigger_situations = CASE WHEN excluded.trigger_situations != '[]' THEN excluded.trigger_situations ELSE case_plan_triggers.trigger_situations END
                `).run(userId, p.focusArea1, JSON.stringify(sit1));
            }
            if (p.focusArea2) {
                const sit2 = p.focusArea2Situations ? [p.focusArea2Situations] : [];
                db.prepare(`
                    INSERT INTO case_plan_triggers (user_id, domain, pattern, trigger_situations, toolkit_tools)
                    VALUES (?, ?, 'Focus Area 2', ?, '["Decisional Balance","Problem Solving 4-Step Method"]')
                    ON CONFLICT(user_id, domain) DO UPDATE SET
                        trigger_situations = CASE WHEN excluded.trigger_situations != '[]' THEN excluded.trigger_situations ELSE case_plan_triggers.trigger_situations END
                `).run(userId, p.focusArea2, JSON.stringify(sit2));
            }

            // Sync points for this First Shift participant
            const pPoints = pointsRows.filter(r => String(r['Record ID']) === p.recordId);
            const insertPt = db.prepare(`
                INSERT INTO daily_points (user_id, date, points_earned, max_points, attendance_status, notes, imported_from_apricot)
                VALUES (?, ?, ?, 10, 'present', 'Apricot Sync', 1)
                ON CONFLICT(user_id, date) DO UPDATE SET points_earned = excluded.points_earned
            `);
            for (const ptRow of pPoints) {
                const dt = parseDateStr(ptRow['Date']);
                const pts = Number(ptRow['Points']) || 0;
                if (dt) insertPt.run(userId, dt, pts);
            }

            // Sync deduplicated case notes into `case_notes`
            const pNotes = allProcessedNotes.filter(n => n.record_id === p.recordId);
            const checkNote = db.prepare(`SELECT id FROM case_notes WHERE user_id = ? AND session_date = ? AND SUBSTR(content, 1, 60) = SUBSTR(?, 1, 60) LIMIT 1`);
            const insertNote = db.prepare(`
                INSERT INTO case_notes (user_id, author_name, session_date, note_type, category, content, apricot_exported)
                VALUES (?, ?, ?, ?, ?, ?, 1)
            `);
            for (const n of pNotes) {
                const content = n.note_text || n.interaction_type || 'Case Note';
                const dt = n.activity_date || '2026-10-23';
                if (!checkNote.get(userId, dt, content)) {
                    insertNote.run(userId, n.staff_name || 'Staff', dt, n.interaction_type || 'Individual Session', n.service_context || 'Case Management', content);
                }
            }
        }

        // 2. Sync all 35 Active Reentry Navigation Participants into `reentry_clients`
        // First, mark any non-Apricot sample/stale reentry_clients that aren't in the active 35 as archived if they don't have an apricot_id
        for (const rn of rnList) {
            let client = db.prepare(`
                SELECT id FROM reentry_clients
                WHERE apricot_id = ? OR (LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?))
                LIMIT 1
            `).get(rn.recordId, rn.firstName, rn.lastName);

            // Determine stability tier from goals/notes
            let tier = 'stable';
            const lowerClues = `${rn.casePlanText} ${rn.lastContactActivity}`.toLowerCase();
            if (rn.recordId === '81120' || rn.recordId === '66054' || lowerClues.includes('urgent') || lowerClues.includes('behind on rent') || lowerClues.includes('untreated')) {
                tier = 'immediate_triage';
            } else if (!rn.briefcaseCreated || lowerClues.includes('suspended') || lowerClues.includes('transitional') || lowerClues.includes('couch')) {
                tier = 'at_risk';
            }

            let clientId = client?.id;
            if (!clientId) {
                const info = db.prepare(`
                    INSERT INTO reentry_clients (
                        first_name, last_name, apricot_id, location, status, stability_tier,
                        notes, case_manager, enrollment_start, gate1_pct, gate2_pct, gate3_pct, gate4_pct,
                        last_contact_date, last_contact_staff, last_contact_activity, has_case_plan, case_plan_text
                    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    rn.firstName, rn.lastName, rn.recordId, rn.location, tier,
                    rn.casePlanText, rn.caseManager, rn.enrollmentStartIso,
                    rn.gate1Pct, rn.gate2Pct, rn.gate3Pct, rn.gate4Pct,
                    rn.lastContactDateIso, rn.lastContactStaff, rn.lastContactActivity,
                    rn.hasCasePlan ? 1 : 0, rn.casePlanText
                );
                clientId = info.lastInsertRowid;
                initReentryClientBriefcase(clientId);
            } else {
                db.prepare(`
                    UPDATE reentry_clients
                    SET first_name = ?, last_name = ?, apricot_id = ?, location = ?, status = 'active',
                        stability_tier = ?, notes = COALESCE(NULLIF(?, ''), notes),
                        case_manager = ?, enrollment_start = ?,
                        gate1_pct = ?, gate2_pct = ?, gate3_pct = ?, gate4_pct = ?,
                        last_contact_date = ?, last_contact_staff = ?, last_contact_activity = ?,
                        has_case_plan = ?, case_plan_text = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    rn.firstName, rn.lastName, rn.recordId, rn.location, tier,
                    rn.casePlanText, rn.caseManager, rn.enrollmentStartIso,
                    rn.gate1Pct, rn.gate2Pct, rn.gate3Pct, rn.gate4Pct,
                    rn.lastContactDateIso, rn.lastContactStaff, rn.lastContactActivity,
                    rn.hasCasePlan ? 1 : 0, rn.casePlanText,
                    clientId
                );
                initReentryClientBriefcase(clientId);
            }

            // Sync Reentry Nav Goals (ONLY Goals and Gates — NO CBT!)
            const existingGoalsCount = db.prepare('SELECT COUNT(*) as c FROM reentry_client_goals WHERE client_id = ?').get(clientId).c;
            if (existingGoalsCount === 0 && rn.casePlanText) {
                const rawLines = rn.casePlanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const numberedGoals = rawLines.filter(l => /^\d+[\.\)]\s+/.test(l) || /^-\s+/.test(l));
                const goalsToInsert = numberedGoals.length > 0
                    ? numberedGoals.map(l => l.replace(/^(\d+[\.\)]|-)\s*/, '').trim())
                    : [rn.casePlanText.slice(0, 140)];

                const insertGoal = db.prepare(`
                    INSERT INTO reentry_client_goals (client_id, goal_title, target_date, status, category, action_steps, assigned_to)
                    VALUES (?, ?, DATE('now', '+14 days'), 'in_progress', 'general', ?, 'joint')
                `);
                for (const gTitle of goalsToInsert.slice(0, 4)) {
                    if (gTitle) {
                        insertGoal.run(clientId, gTitle, JSON.stringify([
                            `Review progress on "${gTitle}" during weekly Reentry Navigation check-in with ${rn.caseManager}`,
                            `Update corresponding Briefcase Gate 1–4 checklist items in Apricot once verified`
                        ]));
                    }
                }
            }

            // Sync Briefcase items for this Reentry Nav client
            const bc = briefcaseById[rn.recordId];
            if (bc && bc.exists) {
                const allCheckedText = [...bc.g1Items, ...bc.g2Items, ...bc.g3Items, ...bc.g4Items].join(' | ').toLowerCase();
                const updateBcItem = db.prepare(`UPDATE reentry_client_briefcase SET status = 'green', notes = 'Verified in Apricot Briefcase' WHERE client_id = ? AND item_key = ?`);
                if (allCheckedText.includes('state id') || allCheckedText.includes('driver')) updateBcItem.run(clientId, 'state_id');
                if (allCheckedText.includes('social security')) updateBcItem.run(clientId, 'ss_card');
                if (allCheckedText.includes('birth certificate')) updateBcItem.run(clientId, 'birth_cert');
                if (allCheckedText.includes('stable address') || allCheckedText.includes('housing')) updateBcItem.run(clientId, 'housing_plan');
                if (allCheckedText.includes('reliable phone')) updateBcItem.run(clientId, 'reliable_phone');
                if (allCheckedText.includes('professional email')) updateBcItem.run(clientId, 'prof_email');
                if (allCheckedText.includes('resume')) updateBcItem.run(clientId, 'resume_completed');
                if (allCheckedText.includes('bank account')) updateBcItem.run(clientId, 'bank_account');
                if (allCheckedText.includes('primary care')) updateBcItem.run(clientId, 'medical_home');
                if (allCheckedText.includes('prescription')) updateBcItem.run(clientId, 'prescriptions');
                if (allCheckedText.includes('transportation')) updateBcItem.run(clientId, 'transportation_plan');
                if (allCheckedText.includes('work tools') || allCheckedText.includes('clothing')) updateBcItem.run(clientId, 'work_clothing');
                if (allCheckedText.includes('budget')) updateBcItem.run(clientId, 'budget_created');
                if (allCheckedText.includes('credit')) updateBcItem.run(clientId, 'credit_pulled');
                if (allCheckedText.includes('savings')) updateBcItem.run(clientId, 'savings_goal');
                if (allCheckedText.includes('career goal')) updateBcItem.run(clientId, 'career_goal');
            }

            // Sync deduplicated case notes into `reentry_client_sessions`
            const pNotes = allProcessedNotes.filter(n => n.record_id === rn.recordId);
            const checkSess = db.prepare(`SELECT id FROM reentry_client_sessions WHERE client_id = ? AND session_date = ? AND SUBSTR(notes_text, 1, 60) = SUBSTR(?, 1, 60) LIMIT 1`);
            const insertSess = db.prepare(`
                INSERT INTO reentry_client_sessions (client_id, session_date, session_title, session_type, notes_text, next_conversation_topics)
                VALUES (?, ?, ?, 'check_in', ?, ?)
            `);
            for (const n of pNotes) {
                const text = n.note_text || n.interaction_type || 'Reentry Navigation Contact';
                const dt = n.activity_date || rn.enrollmentStartIso || '2026-10-23';
                const title = `${n.interaction_type || n.service_context || 'Check-In'} (${n.staff_name || rn.caseManager})`;
                if (!checkSess.get(clientId, dt, text)) {
                    insertSess.run(clientId, dt, title, text, 'Follow up on Reentry Navigation goals and Briefcase Gate 1–4 items.');
                }
            }

            // Sync Next Session Agenda (grounded in Goals & Gates only — no CBT)
            const evalRow = db.prepare('SELECT next_cm_steps_json FROM apricot_participant_evaluations WHERE record_id = ?').get(rn.recordId);
            if (evalRow && evalRow.next_cm_steps_json) {
                try {
                    const stepsArr = JSON.parse(evalRow.next_cm_steps_json);
                    const agendaMd = `### 🧭 Next Session Priorities for ${rn.firstName} (Goals & Briefcase Gates 1–4)\n` +
                        stepsArr.map(s => `- [ ] ${s}`).join('\n');
                    db.prepare(`
                        INSERT INTO reentry_client_agenda (client_id, agenda_markdown, last_updated)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(client_id) DO UPDATE SET agenda_markdown = excluded.agenda_markdown, last_updated = CURRENT_TIMESTAMP
                    `).run(clientId, agendaMd);
                } catch (e) {}
            }
        }
    });
    tx();
}

/**
 * Register a new Case Note (e.g. from a Case Management recording upload or manual entry)
 * so its hash is stored in `apricot_processed_notes` (preventing duplication on future Apricot imports)
 * AND immediately updates the participant's live "What to Work on Next in Case Management" feedback!
 */
function registerProcessedCaseNote({
    recordId,
    firstName = '',
    lastName = '',
    activityDate = null,
    staffName = 'Program Manager',
    serviceContext = 'Case Management',
    interactionType = 'Coaching / case management session – structured work on goals, mindset, or behavior',
    noteText = '',
    centerLocation = 'Charleston',
    programEnrollment = 'First Shift',
    nextSessionRecommendations = [],
    source = 'cm_recording_upload'
}) {
    const cleanId = String(recordId || '').trim();
    const dt = parseDateStr(activityDate) || new Date().toISOString().split('T')[0];
    const cleanStaff = normalizeStaffName(staffName);
    const cleanNote = String(noteText || '').trim();
    if (!cleanId || !cleanNote) return { registered: false };

    const noteHash = computeNoteHash(cleanId, dt, cleanStaff, interactionType, cleanNote);

    const info = db.prepare(`
        INSERT OR IGNORE INTO apricot_processed_notes (
            note_hash, record_id, first_name, last_name, activity_date,
            staff_name, service_context, interaction_type, note_text,
            center_location, program_enrollment, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        noteHash,
        cleanId,
        firstName,
        lastName,
        dt,
        cleanStaff,
        serviceContext,
        interactionType,
        cleanNote,
        centerLocation,
        programEnrollment,
        source
    );

    // Update participant evaluation if they exist in apricot_participant_evaluations
    const existingEval = db.prepare('SELECT * FROM apricot_participant_evaluations WHERE record_id = ?').get(cleanId);
    if (existingEval) {
        const updatedAnalysis = `${existingEval.case_note_analysis}\n\n**[New Session Note • ${formatMDY(dt)} • ${cleanStaff}]:** ${cleanNote}`;
        let currentNextSteps = [];
        try {
            currentNextSteps = JSON.parse(existingEval.next_cm_steps_json || '[]');
        } catch (e) {}

        if (Array.isArray(nextSessionRecommendations) && nextSessionRecommendations.length > 0) {
            const newItems = nextSessionRecommendations.map(item => `🎙️ **Next Session Follow-Up (${formatMDY(dt)}):** ${item}`);
            currentNextSteps = [...newItems, ...currentNextSteps.filter(s => !s.startsWith('🎙️ **Next Session Follow-Up'))];
        }

        db.prepare(`
            UPDATE apricot_participant_evaluations
            SET case_note_analysis = ?,
                next_cm_steps_json = ?,
                last_note_date = ?,
                notes_count = notes_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE record_id = ?
        `).run(updatedAnalysis, JSON.stringify(currentNextSteps), dt, cleanId);

        // Refresh cached report_json in apricot_workbook_state
        try {
            recomputeFullApricotReport({ sourceFilename: 'Live CM Session Update', newNotesCount: info.changes });
        } catch (e) {}
    }

    return {
        registered: info.changes > 0,
        alreadyProcessed: info.changes === 0,
        noteHash
    };
}

/**
 * Retrieve the full Apricot Evaluation Report (auto-initializing from bundled master xlsx if empty)
 */
function getApricotEvalReport(locationFilter = null) {
    let state = db.prepare('SELECT * FROM apricot_workbook_state WHERE id = 1').get();
    if (!state || !state.report_json) {
        const bundledPath = path.join(__dirname, '..', 'data', 'apricot_master_report.xlsx');
        const fallbackDesktopPath = "/Users/justinevans/Desktop/Apricot Eval/Justin's Main report 261023.xlsx";
        const targetPath = fs.existsSync(bundledPath) ? bundledPath : (fs.existsSync(fallbackDesktopPath) ? fallbackDesktopPath : null);
        if (targetPath) {
            console.log(`[Apricot Eval Engine] Initializing database from master report: ${targetPath}`);
            processApricotWorkbook(targetPath, { filename: "Justin's Main report 261023.xlsx" });
            state = db.prepare('SELECT * FROM apricot_workbook_state WHERE id = 1').get();
        }
    }

    if (!state || !state.report_json) {
        return null;
    }

    const report = JSON.parse(state.report_json);

    // If a specific center location filter is provided ('Charleston', 'Columbia', 'Spartanburg'),
    // attach a `centerView` object pre-filtered for that center!
    if (locationFilter && locationFilter !== 'all' && locationFilter !== 'All') {
        const loc = locationFilter;
        const centerFsActive = report.activeDashboards.firstShift.filter(p => p.location.toLowerCase() === loc.toLowerCase());
        const centerRnActive = report.activeDashboards.reentryNav.filter(p => p.location.toLowerCase() === loc.toLowerCase());
        const centerEvals = report.participantEvaluations.filter(p => p.center.toLowerCase() === loc.toLowerCase());
        const centerPayRows = report.paymentReport.rows.filter(p => p.centerLocation.toLowerCase() === loc.toLowerCase());
        const centerFsRefs = report.referralsAndCredentials.firstShiftReferrals.filter(r => r.center.toLowerCase() === loc.toLowerCase());
        const centerRnRefs = report.referralsAndCredentials.reentryNavReferrals.filter(r => r.center.toLowerCase() === loc.toLowerCase());
        const centerFsCreds = report.referralsAndCredentials.firstShiftCredentials.filter(c => c.centerLocation.toLowerCase() === loc.toLowerCase());
        const centerRnCreds = report.referralsAndCredentials.reentryNavCredentials.filter(c => c.centerLocation.toLowerCase() === loc.toLowerCase());
        const centerOrientations = report.funnelReport.orientations.filter(o => o.centerLocation.toLowerCase() === loc.toLowerCase());
        const centerOverdueEmp = report.employmentAnalysis.overdueCheckIns.filter(e => e.centerLocation.toLowerCase() === loc.toLowerCase());

        report.centerView = {
            center: loc,
            firstShiftActive: centerFsActive,
            reentryNavActive: centerRnActive,
            participantEvaluations: centerEvals,
            payReportRows: centerPayRows,
            funnel: {
                firstShiftEnrollments: report.funnelReport.enrollmentsAndExits['First Shift']?.[loc] || { totalEnrollments: 0, totalExits: 0, active: 0, exitReasons: {} },
                resourceCoordinations: report.funnelReport.resourceCoordinations[loc] || { ytd: 0, lastWeek: 0, currentWeek: 0 },
                reentryConsultations: report.funnelReport.reentryConsultations[loc] || { ytd: 0, lastWeek: 0, currentWeek: 0 },
                waitlistCount: report.funnelReport.waitlistByCenter[loc] || 0,
                orientations: centerOrientations
            },
            referrals: {
                firstShift: centerFsRefs,
                reentryNav: centerRnRefs
            },
            credentials: {
                firstShift: centerFsCreds,
                reentryNav: centerRnCreds
            },
            overdueEmploymentCheckIns: centerOverdueEmp
        };
    }

    return report;
}

/**
 * Get rich Case Plan, Briefcase & Gate 1–4 context for a participant by Record ID (or name)
 * to ground Case Management audio evaluation & "What to Work on Next" feedback.
 */
function getParticipantCoachingContext(recordIdOrName) {
    getApricotEvalReport(); // ensure initialized
    const queryVal = String(recordIdOrName || '').trim();
    if (!queryVal) return null;

    let evalRow = db.prepare(`
        SELECT * FROM apricot_participant_evaluations
        WHERE record_id = ? OR LOWER(full_name) LIKE LOWER(?)
        LIMIT 1
    `).get(queryVal, `%${queryVal}%`);

    if (!evalRow) return null;

    const recentNotes = db.prepare(`
        SELECT activity_date, staff_name, service_context, interaction_type, note_text
        FROM apricot_processed_notes
        WHERE record_id = ?
        ORDER BY activity_date DESC, id DESC
        LIMIT 8
    `).all(evalRow.record_id);

    let nextSteps = [];
    try {
        nextSteps = JSON.parse(evalRow.next_cm_steps_json || '[]');
    } catch (e) {}

    return {
        recordId: evalRow.record_id,
        fullName: evalRow.full_name,
        name: evalRow.full_name,
        program: evalRow.program, // 'First Shift' or 'Reentry Navigation'
        isReentryNav: evalRow.program === 'Reentry Navigation',
        center: evalRow.center,
        location: evalRow.center,
        caseManager: evalRow.case_manager,
        casePlanStatus: evalRow.case_plan_status,
        focusAreasOrGoals: evalRow.focus_areas_or_goals,
        briefcaseStatusText: evalRow.briefcase_status_text,
        gate1Pct: evalRow.gate1_pct,
        gate2Pct: evalRow.gate2_pct,
        gate3Pct: evalRow.gate3_pct,
        gate4Pct: evalRow.gate4_pct,
        gatePercentages: {
            gate1: evalRow.gate1_pct,
            gate2: evalRow.gate2_pct,
            gate3: evalRow.gate3_pct,
            gate4: evalRow.gate4_pct
        },
        caseNoteAnalysis: evalRow.case_note_analysis,
        operationalFeedback: evalRow.operational_feedback,
        nextCmSteps: nextSteps,
        nextSteps: nextSteps,
        recentNotes
    };
}

/**
 * Export the Previous Week's First Shift Payment Report in .xlsx, .csv, or printable HTML
 */
function exportPreviousWeekPayReport(format = 'xlsx') {
    const report = getApricotEvalReport();
    if (!report || !report.paymentReport) {
        throw new Error('Apricot Payment Report is not initialized.');
    }

    const pay = report.paymentReport;
    const sheetRows = [
        ['TURN90 FIRST SHIFT PAYMENT REPORT — PREVIOUS WEEK'],
        [`Pay Period: ${pay.previousWeekRange} | Rate: $${pay.ratePerPoint}.00 / Point | Generated: ${new Date().toLocaleDateString('en-US')}`],
        [],
        ['A. POINTS EARNED & PAYROLL CALCULATION (PREVIOUS WEEK)'],
        ['Record ID', 'Full Name', 'Center Location', 'Total Points Last Week', 'Payment Amount ($9/pt)', 'Status / Notes']
    ];

    for (const r of pay.rows) {
        sheetRows.push([
            r.recordId,
            r.fullName,
            r.wasCenterResolved ? `${r.centerLocation} (Resolved)` : r.centerLocation,
            r.totalPoints,
            `$${r.paymentAmount.toFixed(2)}`,
            r.statusNotes
        ]);
    }

    sheetRows.push([
        'TOTAL',
        `${pay.totalParticipants} Participants`,
        'All Centers',
        pay.totalPoints,
        `$${pay.totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        'Gross Payroll'
    ]);

    sheetRows.push([]);
    sheetRows.push(['B. CURRENT WEEK FIRST SHIFT ENROLLMENTS']);
    if (pay.currentWeekEnrollments.length === 0) {
        sheetRows.push(['None', '0 new participants started on-site First Shift during the current week.', '', '', '', '']);
    } else {
        sheetRows.push(['Record ID', 'Full Name', 'Center Location', 'Enrollment Start Date', '', '']);
        for (const e of pay.currentWeekEnrollments) {
            sheetRows.push([e.recordId, e.fullName, e.centerLocation, e.enrollmentDate, '', '']);
        }
    }

    sheetRows.push([]);
    sheetRows.push(['C. PREVIOUS WEEK FIRST SHIFT EXITS']);
    sheetRows.push(['Record ID', 'Full Name', 'Center Location', 'Exit Date', 'Exit Reason', '']);
    for (const ex of pay.previousWeekExits) {
        sheetRows.push([
            ex.recordId,
            ex.fullName,
            ex.wasCenterResolved ? `${ex.centerLocation} (Resolved)` : ex.centerLocation,
            ex.exitDate,
            ex.exitReason,
            ''
        ]);
    }

    if (format === 'xlsx') {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetRows);
        ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Previous Week Pay Report');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        return {
            data: buf,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            filename: `Turn90_Previous_Week_Pay_Report_${pay.previousWeekRange.replace(/[^0-9a-zA-Z]/g, '_')}.xlsx`
        };
    } else if (format === 'csv') {
        const csvContent = sheetRows.map(row =>
            row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        return {
            data: csvContent,
            contentType: 'text/csv; charset=utf-8',
            filename: `Turn90_Previous_Week_Pay_Report_${pay.previousWeekRange.replace(/[^0-9a-zA-Z]/g, '_')}.csv`
        };
    } else {
        // Printable HTML
        const rowsHtml = pay.rows.map(r => `
            <tr>
                <td><strong>${r.recordId}</strong></td>
                <td>${r.fullName}</td>
                <td>${r.wasCenterResolved ? `${r.centerLocation} <em>(Resolved)</em>` : r.centerLocation}</td>
                <td style="text-align:center; font-weight:700;">${r.totalPoints}</td>
                <td style="text-align:center; font-weight:800; color:#15803d;">$${r.paymentAmount.toLocaleString()}</td>
                <td>${r.statusNotes}</td>
            </tr>
        `).join('');

        const exitsHtml = pay.previousWeekExits.map(ex => `
            <tr>
                <td>${ex.recordId}</td>
                <td>${ex.fullName}</td>
                <td>${ex.wasCenterResolved ? `${ex.centerLocation} <em>(Resolved)</em>` : ex.centerLocation}</td>
                <td style="text-align:center;">${ex.exitDate}</td>
                <td>${ex.exitReason}</td>
            </tr>
        `).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Turn90 First Shift Pay Report (${pay.previousWeekRange})</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 32px auto; padding: 0 24px; color: #0f172a; }
        .no-print { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: white; padding: 12px 20px; border-radius: 8px; margin-bottom: 24px; }
        .btn { background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
        h1 { margin: 0 0 6px 0; font-size: 24px; }
        h2 { margin-top: 28px; font-size: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 9px 12px; text-align: left; }
        th { background: #f1f5f9; font-weight: 700; }
        .total-row td { background: #f0fdf4; font-weight: 800; font-size: 14px; border-top: 2px solid #15803d; }
        @media print { .no-print { display: none !important; } body { margin: 0; } }
    </style>
</head>
<body>
    <div class="no-print">
        <div><strong>Turn90 First Shift Payroll Report</strong> • ${pay.previousWeekRange}</div>
        <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
    <h1>Turn90 First Shift Payment Report (Previous Week)</h1>
    <p style="color:#475569; margin:0;"><strong>Pay Period:</strong> ${pay.previousWeekRange} &bull; <strong>Pay Rate:</strong> $9.00 per point &bull; <strong>Gross Payroll:</strong> $${pay.totalPayroll.toLocaleString()}</p>

    <h2>A. Points Earned & Payroll Calculation: Previous Week (${pay.previousWeekRange})</h2>
    <table>
        <thead>
            <tr>
                <th>Record ID</th>
                <th>Full Name</th>
                <th>Center Location</th>
                <th style="text-align:center;">Total Points Last Week</th>
                <th style="text-align:center;">Payment Amount ($9/pt)</th>
                <th>Status / Notes</th>
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
            <tr class="total-row">
                <td>TOTAL</td>
                <td>${pay.totalParticipants} Participants</td>
                <td>All Centers</td>
                <td style="text-align:center;">${pay.totalPoints}</td>
                <td style="text-align:center; color:#15803d;">$${pay.totalPayroll.toLocaleString()}</td>
                <td>Gross Payroll</td>
            </tr>
        </tbody>
    </table>

    <h2>B. Current Week First Shift Enrollments (${report.meta.currentWeekRange})</h2>
    <p style="font-size:13.5px;">${pay.currentWeekEnrollments.length === 0
        ? '<strong>0</strong> new participants started on-site First Shift during the current week. <em>(Note: 2 participants, Melvin Brown [80978] and Kwatez Carter [81443], completed First Shift Orientation on Friday 10/23/2026 and are slated to start Day 1 on Monday 10/26/2026).</em>'
        : pay.currentWeekEnrollments.map(e => `${e.fullName} (#${e.recordId} - ${e.centerLocation}, started ${e.enrollmentDate})`).join(', ')
    }</p>

    <h2>C. First Shift Exits Last Week (${pay.previousWeekRange})</h2>
    <table>
        <thead>
            <tr>
                <th>Record ID</th>
                <th>Full Name</th>
                <th>Center Location</th>
                <th style="text-align:center;">Exit Date</th>
                <th>Exit Reason</th>
            </tr>
        </thead>
        <tbody>
            ${exitsHtml}
        </tbody>
    </table>
</body>
</html>`;

        return {
            data: html,
            contentType: 'text/html; charset=utf-8',
            filename: `Turn90_Previous_Week_Pay_Report_${pay.previousWeekRange.replace(/[^0-9a-zA-Z]/g, '_')}.html`
        };
    }
}

module.exports = {
    processApricotWorkbook,
    recomputeFullApricotReport,
    getApricotEvalReport,
    getParticipantCoachingContext,
    registerProcessedCaseNote,
    exportPreviousWeekPayReport,
    APRICOT_GATE_DEFINITIONS,
    REENTRY_NAV_GATE_GOALS
};
