const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');

const { db, initReentryClientBriefcase } = require('../db');
const {
    UNIFIED_BRIEFCASE_SCHEMA,
    resolveCanonicalSlug,
    invalidateFolderIndexCache,
    appendParticipantHistoryEvent,
    syncAllParticipantFolders,
    getParticipantFolderBundle,
    updateParticipantUnifiedBriefcase
} = require('./participant_folder_manager');

const dataDir = path.join(__dirname, '..', 'data');
const participantsRootDir = path.join(dataDir, 'participants');

const VALID_CENTERS = [
    'Charleston',
    'Columbia',
    'Spartanburg',
    'Reentry Navigation',
    'Prison Program'
];

const CENTER_PM_MAP = {
    'terrence brown': 'Charleston',
    'terrence': 'Charleston',
    'tb': 'Charleston',
    'terry brooks': 'Charleston',
    'deon nowell': 'Charleston',
    'jenn jeanquart': 'Columbia',
    'jenn': 'Columbia',
    'jennifer jeanquart': 'Columbia',
    'terrance ferrell': 'Columbia',
    'terrance': 'Columbia',
    'diyoung dantzler': 'Spartanburg',
    'diyoung': 'Spartanburg',
    'matt carlisle': 'Spartanburg',
    'matt': 'Spartanburg',
    'winard eady': 'Spartanburg'
};

const LOOKUP_CACHE_TTL_MS = 60000;
let _cachedExternalLookups = null;
let _cachedExternalLookupsAt = 0;

function invalidateWorkspaceCaches() {
    _cachedExternalLookups = null;
    _cachedExternalLookupsAt = 0;
    invalidateFolderIndexCache();
}

function shortHash(val) {
    return crypto.createHash('sha1').update(String(val || '')).digest('hex').slice(0, 12);
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

function normalizeCenterName(raw) {
    const val = String(raw || '').trim();
    if (!val) return '';
    const low = val.toLowerCase();
    if (low === 'all') return 'All';
    if (low.includes('charleston') || low === 'chs') return 'Charleston';
    if (low.includes('columbia') || low === 'col') return 'Columbia';
    if (low.includes('spartanburg') || low === 'spb') return 'Spartanburg';
    if (low.includes('reentry') || low === 'reentry_nav' || low === 'rn' || low === 'statewide') return 'Reentry Navigation';
    if (low.includes('prison') || low.includes('pre-release') || low.includes('pre_release') || low.includes('macdougal')) return 'Prison Program';
    return '';
}

function normalizeUserAccount(row) {
    if (!row) return null;
    const roleLow = String(row.role || '').toLowerCase();
    const portalLow = String(row.portal_type || '').toLowerCase();
    const isAdmin = roleLow === 'admin' || roleLow === 'director' || portalLow === 'admin' || portalLow === 'supervisor';
    const userType = isAdmin ? 'Admin' : 'User';
    const assignedCenter = isAdmin ? 'All' : (normalizeCenterName(row.location) || 'Charleston');
    const allowedCenters = isAdmin ? [...VALID_CENTERS] : [assignedCenter];

    return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone || '',
        role: isAdmin ? 'admin' : (roleLow === 'user' || !roleLow ? 'user' : roleLow),
        user_type: userType,
        location: assignedCenter,
        assigned_center: assignedCenter,
        allowed_centers: allowedCenters,
        track: row.track || 'first_shift',
        portal_type: isAdmin ? 'admin' : 'center',
        login_name: row.login_name || null,
        is_active: row.is_active === undefined || row.is_active === null ? 1 : Number(row.is_active),
        created_at: row.created_at || null
    };
}

function isAdminUser(user) {
    if (!user) return false;
    const ut = String(user.user_type || '').toLowerCase();
    const role = String(user.role || '').toLowerCase();
    const pt = String(user.portal_type || '').toLowerCase();
    return ut === 'admin' || role === 'admin' || role === 'director' || pt === 'admin' || pt === 'supervisor';
}

function getAllowedCentersForUser(user) {
    if (!user) return [];
    if (isAdminUser(user)) return [...VALID_CENTERS];
    if (Array.isArray(user.allowed_centers) && user.allowed_centers.length > 0) {
        return user.allowed_centers.map(normalizeCenterName).filter(c => VALID_CENTERS.includes(c));
    }
    const single = normalizeCenterName(user.assigned_center || user.location);
    return single && VALID_CENTERS.includes(single) ? [single] : [];
}

function canUserAccessCenters(user, participantCenters = []) {
    if (!user) return false;
    if (isAdminUser(user)) return true;
    const allowed = new Set(getAllowedCentersForUser(user));
    return (participantCenters || []).some(c => allowed.has(normalizeCenterName(c)));
}

function detectCenterFromProgramManagerName(pmName) {
    const raw = String(pmName || '').trim();
    if (!raw) return '';
    const parts = raw.split(/[/,&;]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
    for (const part of parts) {
        if (CENTER_PM_MAP[part]) return CENTER_PM_MAP[part];
        for (const [key, center] of Object.entries(CENTER_PM_MAP)) {
            if (key.length > 2 && part.includes(key)) return center;
        }
    }
    return '';
}

function parseSimpleCsv(text) {
    const rows = [];
    if (!text) return rows;
    const lines = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            lines.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.length > 0) lines.push(cur);
    if (lines.length < 2) return rows;

    const splitLine = (line) => {
        const out = [];
        let field = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (q && line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    q = !q;
                }
            } else if (c === ',' && !q) {
                out.push(field.trim());
                field = '';
            } else {
                field += c;
            }
        }
        out.push(field.trim());
        return out;
    };

    const headers = splitLine(lines[0]);
    for (let r = 1; r < lines.length; r++) {
        if (!lines[r].trim()) continue;
        const vals = splitLine(lines[r]);
        const obj = {};
        for (let c = 0; c < headers.length; c++) {
            if (headers[c]) obj[headers[c]] = vals[c] || '';
        }
        rows.push(obj);
    }
    return rows;
}

function getExternalIntakeLookups({ force = false } = {}) {
    if (!force && _cachedExternalLookups && (Date.now() - _cachedExternalLookupsAt < LOOKUP_CACHE_TTL_MS)) {
        return _cachedExternalLookups;
    }

    const sheets = {};
    for (const row of safeQueryAll('SELECT sheet_key, rows_json FROM apricot_sheet_cache')) {
        try {
            sheets[row.sheet_key] = JSON.parse(row.rows_json || '[]');
        } catch (e) {
            sheets[row.sheet_key] = [];
        }
    }

    // Load Consultation Info - Rows from bundled Apricot workbook if present
    let consultationInfoRows = [];
    try {
        const wbPath = path.join(dataDir, 'apricot_master_report.xlsx');
        if (fs.existsSync(wbPath)) {
            const wb = xlsx.readFile(wbPath, { sheetStubs: false });
            const sheetName = wb.SheetNames.find(n => /^Consultation Info\s*-\s*Rows/i.test(n));
            if (sheetName) {
                consultationInfoRows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
            }
        }
    } catch (e) {}

    // Load FirstShift20IntakeForm.csv if present in parent docs/lscmi/ directory
    let intakeCsvRows = [];
    try {
        const csvPath = path.resolve(__dirname, '..', '..', 'FirstShift20IntakeForm.csv');
        if (fs.existsSync(csvPath)) {
            intakeCsvRows = parseSimpleCsv(fs.readFileSync(csvPath, 'utf8'));
        }
    } catch (e) {}

    const indexByPerson = (rows, getNameFn = null) => {
        const byRecordId = new Map();
        const bySlug = new Map();
        for (const r of (rows || [])) {
            const recId = String(r['Record ID'] || r.record_id || r['Participant ID'] || '').trim();
            const fullName = getNameFn
                ? getNameFn(r)
                : `${r.First || r['First Name'] || ''} ${r.Last || r['Last Name'] || ''}`.trim();
            const slug = fullName ? resolveCanonicalSlug(fullName) : '';
            if (recId) {
                if (!byRecordId.has(recId)) byRecordId.set(recId, []);
                byRecordId.get(recId).push(r);
            }
            if (slug) {
                if (!bySlug.has(slug)) bySlug.set(slug, []);
                bySlug.get(slug).push(r);
            }
        }
        return { byRecordId, bySlug };
    };

    const indexed = {
        enrollments: indexByPerson(sheets.enrollments),
        caseloads: indexByPerson(sheets.caseloads),
        resourceCoord: indexByPerson(sheets.resourceCoord),
        consultations: indexByPerson(sheets.consultations),
        consultationInfo: indexByPerson(consultationInfoRows),
        bioInfo: indexByPerson(sheets.bioInfo),
        fsCasePlan: indexByPerson(sheets.fsCasePlan),
        rnCasePlan: indexByPerson(sheets.rnCasePlan),
        briefcase: indexByPerson(sheets.briefcase),
        lscmi: indexByPerson(sheets.lscmi),
        intakeCsv: indexByPerson(intakeCsvRows, (r) => `${r['First Name'] || ''} ${r['Last Name'] || ''}`.trim())
    };

    _cachedExternalLookups = {
        sheets,
        consultationInfoRows,
        intakeCsvRows,
        indexed
    };
    _cachedExternalLookupsAt = Date.now();
    return _cachedExternalLookups;
}

function getIndexedRows(indexGroup, slug, apricotIds = []) {
    if (!indexGroup) return [];
    const out = [];
    const seen = new Set();
    const pushUnique = (arr) => {
        for (const item of (arr || [])) {
            if (!seen.has(item)) {
                seen.add(item);
                out.push(item);
            }
        }
    };
    for (const rid of (apricotIds || [])) {
        if (rid) pushUnique(indexGroup.byRecordId.get(String(rid).trim()));
    }
    if (slug) pushUnique(indexGroup.bySlug.get(slug));
    return out;
}

function maskSsn(ssnVal) {
    const raw = String(ssnVal || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
        return `***-**-${digits.slice(-4)}`;
    }
    return '***-**-****';
}

function formatExcelOrStringDate(val) {
    if (val === undefined || val === null || val === '') return '';
    if (typeof val === 'number' && val > 20000 && val < 80000) {
        const utcDays = Math.floor(val - 25569);
        const d = new Date(utcDays * 86400 * 1000);
        if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    return str;
}

function computeParticipantMetaMap({ forceRefresh = false } = {}) {
    const folders = syncAllParticipantFolders({ force: forceRefresh });
    const lookups = getExternalIntakeLookups({ force: forceRefresh });

    const basicRows = safeQueryAll('SELECT * FROM participant_basic_info');
    const basicBySlug = new Map(basicRows.map(r => [r.participant_key, r]));

    const userRows = safeQueryAll(`SELECT id, name, email, phone, address, ssn, birthdate, role, track, location FROM users WHERE role = 'participant'`);
    const usersById = new Map(userRows.map(u => [u.id, u]));
    const usersBySlug = new Map();
    for (const u of userRows) {
        usersBySlug.set(resolveCanonicalSlug(u.name), u);
    }

    const reentryRows = safeQueryAll('SELECT * FROM reentry_clients');
    const reentryBySlug = new Map();
    for (const rc of reentryRows) {
        const slug = resolveCanonicalSlug(`${rc.first_name || ''} ${rc.last_name || ''}`);
        if (!reentryBySlug.has(slug)) reentryBySlug.set(slug, rc);
    }

    const evalRows = safeQueryAll('SELECT * FROM apricot_participant_evaluations');
    const evalsBySlug = new Map();
    for (const ae of evalRows) {
        const slug = resolveCanonicalSlug(ae.full_name || '');
        if (!slug) continue;
        if (!evalsBySlug.has(slug)) evalsBySlug.set(slug, []);
        evalsBySlug.get(slug).push(ae);
    }

    const todoCounts = safeQueryAll(`
        SELECT participant_key,
               SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS open_count,
               SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed_count
        FROM participant_todos
        GROUP BY participant_key
    `);
    const todoCountBySlug = new Map(todoCounts.map(t => [t.participant_key, t]));

    const metaList = [];
    const metaBySlug = new Map();

    for (const prof of folders) {
        const slug = prof.participant_key;
        const basic = basicBySlug.get(slug) || null;
        const userRow = (prof.user_id && usersById.get(prof.user_id)) || usersBySlug.get(slug) || null;
        const rcRow = reentryBySlug.get(slug) || null;
        const aeList = evalsBySlug.get(slug) || [];

        const apricotIds = Array.from(new Set([
            prof.apricot_id,
            rcRow && rcRow.apricot_id,
            ...aeList.map(a => a.record_id)
        ].filter(Boolean).map(String)));

        const enrollRows = getIndexedRows(lookups.indexed.enrollments, slug, apricotIds);
        const caseloadRows = getIndexedRows(lookups.indexed.caseloads, slug, apricotIds);
        const fsPlanRows = getIndexedRows(lookups.indexed.fsCasePlan, slug, apricotIds);
        const rnPlanRows = getIndexedRows(lookups.indexed.rnCasePlan, slug, apricotIds);

        // Determine assigned Program Manager cleanly
        const candidatePms = [
            basic && basic.assigned_program_manager,
            ...aeList.map(a => a.case_manager),
            rcRow && rcRow.case_manager,
            ...rnPlanRows.map(r => r['Case Manager']),
            ...fsPlanRows.map(r => r['Program Manager'])
        ].map(v => String(v || '').trim()).filter(v => v && !/^unassigned$/i.test(v));
        const assignedPm = candidatePms[0] || 'Unassigned';

        // Determine attached centers
        const centers = new Set();
        let hasExplicitManualCenters = false;
        if (basic && basic.attached_centers_json) {
            try {
                const parsed = JSON.parse(basic.attached_centers_json);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    hasExplicitManualCenters = true;
                    for (const c of parsed) {
                        const nc = normalizeCenterName(c);
                        if (VALID_CENTERS.includes(nc)) centers.add(nc);
                    }
                }
            } catch (e) {}
        }

        // Track & program-derived centers
        const allProgramStrings = [
            ...aeList.map(a => a.program),
            ...enrollRows.map(r => r['Program Enrollment:'] || r['Which Program?']),
            ...caseloadRows.map(r => r['Program Enrollment:'])
        ].filter(Boolean);
        const allFacilityStrings = [
            ...enrollRows.map(r => r['At which facility are the classes taking...']),
            ...caseloadRows.map(r => r['At which facility are the classes taking...'])
        ].filter(Boolean);

        const isReentryProgram = Boolean(
            rcRow
            || prof.track === 'reentry_nav'
            || rnPlanRows.length > 0
            || allProgramStrings.some(p => /reentry/i.test(p))
        );
        const isFirstShiftProgram = Boolean(
            (userRow && userRow.track === 'first_shift')
            || prof.has_lscmi_brief
            || prof.has_lscmi_scoring
            || prof.has_action_plan
            || fsPlanRows.length > 0
            || allProgramStrings.some(p => /first\s*shift/i.test(p))
        );
        const isPrisonProgram = Boolean(
            prof.track === 'prison_program'
            || normalizeCenterName(prof.location) === 'Prison Program'
            || allProgramStrings.some(p => /pre-release|prison/i.test(p))
            || allFacilityStrings.some(f => /prison|macdougal/i.test(f))
        );

        if (!hasExplicitManualCenters) {
            if (isReentryProgram) centers.add('Reentry Navigation');
            if (isPrisonProgram) centers.add('Prison Program');

            if (isFirstShiftProgram) {
                const fsCenters = [
                    ...aeList.filter(a => /first\s*shift/i.test(a.program || '')).map(a => a.center),
                    ...enrollRows.filter(r => /first\s*shift/i.test(r['Program Enrollment:'] || r['Which Program?'] || '')).map(r => r['At which Turn90 Center is the client...']),
                    ...caseloadRows.filter(r => /first\s*shift/i.test(r['Program Enrollment:'] || '')).map(r => r['At which Turn90 Center is the client...']),
                    userRow && userRow.location,
                    prof.location
                ].map(normalizeCenterName).filter(c => ['Charleston', 'Columbia', 'Spartanburg'].includes(c));

                for (const fc of fsCenters) centers.add(fc);
            }
        }

        // Dual-Attachment Rule: Reentry Navigation participants assigned to a center Program Manager
        // must appear in BOTH the center they are attached to AND Reentry Navigation.
        const pmCenter = detectCenterFromProgramManagerName(assignedPm);
        let isDualAttachedReentry = false;
        let dualAttachedCenter = '';
        if ((centers.has('Reentry Navigation') || isReentryProgram) && ['Charleston', 'Columbia', 'Spartanburg'].includes(pmCenter)) {
            centers.add('Reentry Navigation');
            centers.add(pmCenter);
            isDualAttachedReentry = true;
            dualAttachedCenter = pmCenter;
        }

        // Fallback if no center matched yet
        if (centers.size === 0) {
            const fallbackCenter = normalizeCenterName(
                (basic && basic.primary_center)
                || (aeList[0] && aeList[0].center)
                || (enrollRows[0] && enrollRows[0]['At which Turn90 Center is the client...'])
                || prof.location
            );
            centers.add(VALID_CENTERS.includes(fallbackCenter) ? fallbackCenter : 'Charleston');
        }

        const orderedCenters = VALID_CENTERS.filter(c => centers.has(c));
        const primaryCenter = (basic && normalizeCenterName(basic.primary_center))
            || dualAttachedCenter
            || orderedCenters[0]
            || 'Charleston';

        const lastNoteDate = (aeList[0] && aeList[0].last_note_date)
            || (rcRow && rcRow.last_contact_date)
            || '';

        const tc = todoCountBySlug.get(slug);
        const item = {
            participant_key: slug,
            name: (basic && basic.full_name) || prof.name || slug.replace(/_/g, ' '),
            centers: orderedCenters,
            primary_center: primaryCenter,
            assigned_program_manager: assignedPm,
            is_dual_attached_reentry: isDualAttachedReentry,
            dual_attached_center: dualAttachedCenter,
            track: (basic && basic.track) || (isPrisonProgram && !isFirstShiftProgram && !isReentryProgram ? 'prison_program' : prof.track),
            status: (basic && basic.status) || prof.status || 'active',
            apricot_id: apricotIds[0] || null,
            user_id: prof.user_id || (userRow && userRow.id) || null,
            client_id: prof.client_id || (rcRow && rcRow.id) || null,
            lscmi_client_id: prof.lscmi_client_id,
            phone: (basic && basic.phone) || prof.phone || (userRow && userRow.phone) || (rcRow && rcRow.phone) || '',
            email: (basic && basic.email) || prof.email || (userRow && userRow.email) || (rcRow && rcRow.email) || '',
            waitlist_ready: Boolean(prof.waitlist_ready),
            waitlist_met_count: Number(prof.waitlist_met_count || 0),
            has_lscmi_brief: Boolean(prof.has_lscmi_brief),
            has_lscmi_scoring: Boolean(prof.has_lscmi_scoring),
            has_action_plan: Boolean(prof.has_action_plan),
            documents_count: Number(prof.documents_count || 0),
            cm_notes_count: Number(prof.cm_notes_count || 0),
            apricot_notes_count: Number(prof.apricot_notes_count || 0),
            history_events_count: Number(prof.history_events_count || 0),
            open_todos_count: tc ? Number(tc.open_count || 0) : 0,
            completed_todos_count: tc ? Number(tc.completed_count || 0) : 0,
            last_note_date: lastNoteDate
        };

        metaList.push(item);
        metaBySlug.set(slug, item);
    }

    metaList.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return { metaList, metaBySlug };
}

function getScopedCaseloads(user, { forceRefresh = false } = {}) {
    const allowedCenters = getAllowedCentersForUser(user);
    const { metaList, metaBySlug } = computeParticipantMetaMap({ forceRefresh });
    const scopedParticipants = metaList.filter(p => canUserAccessCenters(user, p.centers));

    const centerBuckets = allowedCenters.map(centerName => {
        const list = scopedParticipants
            .filter(p => p.centers.includes(centerName))
            .sort((a, b) => {
                const aActive = a.status === 'active' ? 0 : 1;
                const bActive = b.status === 'active' ? 0 : 1;
                if (aActive !== bActive) return aActive - bActive;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
        return {
            center: centerName,
            total: list.length,
            active_count: list.filter(p => p.status === 'active').length,
            dual_attached_count: list.filter(p => p.is_dual_attached_reentry).length,
            participants: list
        };
    });

    return {
        allowed_centers: allowedCenters,
        caseloads: centerBuckets,
        scoped_participants: scopedParticipants,
        metaBySlug
    };
}

function cleanTodoTitle(rawText) {
    let txt = String(rawText || '')
        .replace(/^\*\*|\*\*$/g, '')
        .replace(/\[[0-9,\s-]+\]/g, '')
        .replace(/\*\*/g, '')
        .replace(/^[•\-*\s]+/, '')
        .trim();
    if (txt.length > 180) txt = `${txt.slice(0, 177).trim()}...`;
    return txt;
}

const ACTIONABLE_NOTE_RE = /\b(next step|follow\s*-?\s*up|will\s+(?:call|send|contact|meet|schedule|follow|check|submit|complete|apply|assist|help|remind|visit)|needs?\s+to|scheduled|appointment|waiting\s+(?:on|for)|working\s+on|reminded|dmv|birth\s+certificate|social\s+security|ss\s+card|state\s+id|driver'?s?\s+license|child\s+support|resume|housing|medicaid|welvista|disability|voc\s*rehab|public\s+defender|court|probation|parole|intake|case\s+plan)\b/i;

function extractActionableTodosFromNoteText(noteText) {
    if (!noteText) return [];
    const cleaned = String(noteText)
        .replace(/###+\s*/g, '\n')
        .replace(/\r/g, '');
    const candidates = cleaned
        .split(/(?:\n+|(?<=[.!?])\s+)/)
        .map(s => cleanTodoTitle(s))
        .filter(s => s.length >= 16 && s.length <= 185);

    const out = [];
    for (const line of candidates) {
        if (/^(Conversation Summary|Client Overview|Session Type|Contact Summary|The conversation consists)/i.test(line)) {
            continue;
        }
        if (ACTIONABLE_NOTE_RE.test(line)) {
            out.push(line);
        }
        if (out.length >= 2) break;
    }
    return out;
}

function syncCaseNoteTodosForAllParticipants({ metaBySlug = null } = {}) {
    const map = metaBySlug || computeParticipantMetaMap().metaBySlug;

    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO participant_todos (
            participant_key, participant_name, centers_json, title, details,
            source, source_key, source_date, completed, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const updateCentersStmt = db.prepare(`
        UPDATE participant_todos
        SET participant_name = ?, centers_json = ?
        WHERE participant_key = ?
    `);

    // 1. Apricot evaluation next_cm_steps_json
    const evalRows = safeQueryAll('SELECT full_name, next_cm_steps_json, last_note_date, case_manager FROM apricot_participant_evaluations');
    const seenSlugs = new Set();

    const syncTx = db.transaction(() => {
        for (const ae of evalRows) {
            if (!ae.full_name || !ae.next_cm_steps_json) continue;
            const slug = resolveCanonicalSlug(ae.full_name);
            const meta = map.get(slug);
            const centersJson = JSON.stringify(meta ? meta.centers : ['Charleston']);
            const pName = meta ? meta.name : ae.full_name;
            seenSlugs.add(slug);

            let steps = [];
            try {
                steps = JSON.parse(ae.next_cm_steps_json);
            } catch (e) {
                steps = [];
            }
            if (!Array.isArray(steps)) continue;

            for (const step of steps.slice(0, 4)) {
                const rawStep = String(step || '').trim();
                if (!rawStep) continue;
                const colonIdx = rawStep.indexOf(':**');
                let title = rawStep;
                let details = '';
                if (colonIdx > 0) {
                    title = cleanTodoTitle(rawStep.slice(0, colonIdx));
                    details = cleanTodoTitle(rawStep.slice(colonIdx + 3));
                } else {
                    title = cleanTodoTitle(rawStep);
                }
                if (!title) continue;
                const sKey = `apricot_step:${shortHash(`${slug}:${title}`)}`;
                insertStmt.run(
                    slug,
                    pName,
                    centersJson,
                    title,
                    details,
                    'apricot_eval',
                    sKey,
                    ae.last_note_date || '',
                    ae.case_manager || 'Apricot Eval'
                );
            }
        }

        // 2. Local case_notes + reentry_client_sessions + apricot_processed_notes + manual_folder_notes
        for (const [slug, meta] of map.entries()) {
            const centersJson = JSON.stringify(meta.centers || ['Charleston']);
            seenSlugs.add(slug);
            updateCentersStmt.run(meta.name, centersJson, slug);

            const noteRows = [];
            if (meta.user_id) {
                for (const cn of safeQueryAll('SELECT session_date, author_name, note_type, content FROM case_notes WHERE user_id = ? ORDER BY session_date DESC, id DESC LIMIT 4', [meta.user_id])) {
                    noteRows.push({
                        date: cn.session_date || '',
                        author: cn.author_name || 'Turn90 Staff',
                        text: cn.content || ''
                    });
                }
            }
            if (meta.client_id) {
                for (const rs of safeQueryAll('SELECT session_date, notes_text, next_conversation_topics FROM reentry_client_sessions WHERE client_id = ? ORDER BY session_date DESC, id DESC LIMIT 4', [meta.client_id])) {
                    noteRows.push({
                        date: rs.session_date || '',
                        author: 'Reentry Navigator',
                        text: rs.next_conversation_topics || rs.notes_text || ''
                    });
                }
            }
            // Check participant folder's apricot_history.json & case_management_notes.json for newest notes without hammering DB
            const pDir = path.join(participantsRootDir, slug);
            try {
                const apPath = path.join(pDir, 'apricot_history.json');
                if (fs.existsSync(apPath)) {
                    const ap = JSON.parse(fs.readFileSync(apPath, 'utf8'));
                    for (const n of (ap.processed_notes || []).slice(0, 3)) {
                        noteRows.push({
                            date: n.activity_date || '',
                            author: n.staff_name || 'Turn90 Staff',
                            text: n.note_text || ''
                        });
                    }
                }
            } catch (e) {}
            try {
                const cmPath = path.join(pDir, 'case_management_notes.json');
                if (fs.existsSync(cmPath)) {
                    const cm = JSON.parse(fs.readFileSync(cmPath, 'utf8'));
                    for (const mn of (cm.manual_folder_notes || []).slice(0, 3)) {
                        noteRows.push({
                            date: mn.session_date || '',
                            author: mn.author_name || 'Turn90 Staff',
                            text: mn.content || ''
                        });
                    }
                }
            } catch (e) {}

            let extractedCount = 0;
            for (const nr of noteRows) {
                const snippets = extractActionableTodosFromNoteText(nr.text);
                for (const snip of snippets) {
                    const sKey = `note:${shortHash(`${slug}:${snip.toLowerCase()}`)}`;
                    insertStmt.run(
                        slug,
                        meta.name,
                        centersJson,
                        snip,
                        nr.author ? `From case note by ${nr.author}` : 'From case note',
                        'case_note',
                        sKey,
                        nr.date || '',
                        nr.author || 'Case Note'
                    );
                    extractedCount++;
                    if (extractedCount >= 3) break;
                }
                if (extractedCount >= 3) break;
            }
        }
    });

    syncTx();
}

function getScopedTodos(user, { includeCompleted = true, participantKey = '', autoSync = false } = {}) {
    const { metaBySlug } = computeParticipantMetaMap();
    if (autoSync) {
        syncCaseNoteTodosForAllParticipants({ metaBySlug });
    } else {
        const count = safeQueryGet('SELECT COUNT(*) AS n FROM participant_todos')?.n || 0;
        if (count === 0) syncCaseNoteTodosForAllParticipants({ metaBySlug });
    }

    let rows = safeQueryAll('SELECT * FROM participant_todos ORDER BY completed ASC, source_date DESC, id DESC');
    if (participantKey) {
        const slug = resolveCanonicalSlug(participantKey);
        rows = rows.filter(r => r.participant_key === slug);
    }

    const items = [];
    for (const r of rows) {
        const meta = metaBySlug.get(r.participant_key);
        let rowCenters = [];
        try {
            rowCenters = JSON.parse(r.centers_json || '[]');
        } catch (e) {}
        const liveCenters = meta ? meta.centers : (rowCenters.length ? rowCenters : ['Charleston']);
        if (!canUserAccessCenters(user, liveCenters)) continue;
        if (!includeCompleted && Number(r.completed) === 1) continue;

        items.push({
            id: r.id,
            participant_key: r.participant_key,
            participant_name: meta ? meta.name : (r.participant_name || r.participant_key.replace(/_/g, ' ')),
            centers: liveCenters,
            assigned_program_manager: meta ? meta.assigned_program_manager : '',
            title: r.title,
            details: r.details || '',
            source: r.source || 'case_note',
            source_date: r.source_date || '',
            completed: Boolean(r.completed),
            completed_by: r.completed_by || '',
            completed_at: r.completed_at || '',
            created_by: r.created_by || ''
        });
    }

    const groupedMap = new Map();
    for (const t of items) {
        if (!groupedMap.has(t.participant_key)) {
            groupedMap.set(t.participant_key, {
                participant_key: t.participant_key,
                participant_name: t.participant_name,
                centers: t.centers,
                assigned_program_manager: t.assigned_program_manager,
                open_count: 0,
                completed_count: 0,
                todos: []
            });
        }
        const grp = groupedMap.get(t.participant_key);
        if (t.completed) grp.completed_count++;
        else grp.open_count++;
        grp.todos.push(t);
    }

    const groups = Array.from(groupedMap.values()).sort((a, b) => {
        if (b.open_count !== a.open_count) return b.open_count - a.open_count;
        return String(a.participant_name || '').localeCompare(String(b.participant_name || ''));
    });

    const openCount = items.filter(i => !i.completed).length;
    const completedCount = items.filter(i => i.completed).length;

    return {
        open_count: openCount,
        completed_count: completedCount,
        total_count: items.length,
        groups,
        items
    };
}

function addManualTodo(slugOrName, payload, user) {
    const slug = resolveCanonicalSlug(slugOrName);
    const { metaBySlug } = computeParticipantMetaMap();
    const meta = metaBySlug.get(slug);
    const centers = meta ? meta.centers : getAllowedCentersForUser(user).slice(0, 1);
    if (meta && !canUserAccessCenters(user, centers)) {
        const err = new Error('Access restricted to your assigned center.');
        err.status = 403;
        throw err;
    }

    const title = cleanTodoTitle(payload.title || payload.text || '');
    if (!title) {
        const err = new Error('To-do title is required.');
        err.status = 400;
        throw err;
    }

    const details = String(payload.details || '').trim();
    const sourceDate = payload.source_date || new Date().toISOString().split('T')[0];
    const sourceKey = `manual:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const info = db.prepare(`
        INSERT INTO participant_todos (
            participant_key, participant_name, centers_json, title, details,
            source, source_key, source_date, completed, created_by
        ) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, 0, ?)
    `).run(
        slug,
        meta ? meta.name : slug.replace(/_/g, ' '),
        JSON.stringify(centers),
        title,
        details,
        sourceKey,
        sourceDate,
        (user && user.name) || 'Turn90 Staff'
    );

    appendParticipantHistoryEvent(slug, {
        category: 'todo',
        action: 'Added Case To-Do',
        summary: title,
        actor: (user && user.name) || 'Turn90 Staff'
    });
    invalidateWorkspaceCaches();

    return db.prepare('SELECT * FROM participant_todos WHERE id = ?').get(info.lastInsertRowid);
}

function toggleTodoComplete(todoId, completed, user) {
    const row = db.prepare('SELECT * FROM participant_todos WHERE id = ?').get(todoId);
    if (!row) {
        const err = new Error('To-do item not found.');
        err.status = 404;
        throw err;
    }
    const { metaBySlug } = computeParticipantMetaMap();
    const meta = metaBySlug.get(row.participant_key);
    let rowCenters = [];
    try { rowCenters = JSON.parse(row.centers_json || '[]'); } catch (e) {}
    const liveCenters = meta ? meta.centers : rowCenters;
    if (!canUserAccessCenters(user, liveCenters)) {
        const err = new Error('Access restricted to your assigned center.');
        err.status = 403;
        throw err;
    }

    const isDone = completed ? 1 : 0;
    db.prepare(`
        UPDATE participant_todos
        SET completed = ?,
            completed_by = ?,
            completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(isDone, isDone ? ((user && user.name) || 'Turn90 Staff') : null, isDone, todoId);

    invalidateWorkspaceCaches();
    return db.prepare('SELECT * FROM participant_todos WHERE id = ?').get(todoId);
}

function deleteTodo(todoId, user) {
    const row = db.prepare('SELECT * FROM participant_todos WHERE id = ?').get(todoId);
    if (!row) {
        const err = new Error('To-do item not found.');
        err.status = 404;
        throw err;
    }
    const { metaBySlug } = computeParticipantMetaMap();
    const meta = metaBySlug.get(row.participant_key);
    let rowCenters = [];
    try { rowCenters = JSON.parse(row.centers_json || '[]'); } catch (e) {}
    const liveCenters = meta ? meta.centers : rowCenters;
    if (!canUserAccessCenters(user, liveCenters)) {
        const err = new Error('Access restricted to your assigned center.');
        err.status = 403;
        throw err;
    }
    db.prepare('DELETE FROM participant_todos WHERE id = ?').run(todoId);
    invalidateWorkspaceCaches();
    return { deleted: true, id: Number(todoId) };
}

function getScopedWorkspaceOverview(user, { forceRefresh = false } = {}) {
    const { allowed_centers, caseloads, scoped_participants, metaBySlug } = getScopedCaseloads(user, { forceRefresh });
    const count = safeQueryGet('SELECT COUNT(*) AS n FROM participant_todos')?.n || 0;
    if (count === 0 || forceRefresh) {
        syncCaseNoteTodosForAllParticipants({ metaBySlug });
    }
    const todos = getScopedTodos(user, { includeCompleted: true, autoSync: false });

    return {
        user: normalizeUserAccount(user) || user,
        valid_centers: VALID_CENTERS,
        allowed_centers,
        total_participants: scoped_participants.length,
        caseloads,
        todos
    };
}

function searchScopedParticipants(user, { q = '', center = 'all', filter = 'all' } = {}) {
    const { scoped_participants } = getScopedCaseloads(user);
    let list = scoped_participants;

    const cNorm = center && center !== 'all' ? normalizeCenterName(center) : '';
    if (cNorm) {
        list = list.filter(p => p.centers.includes(cNorm));
    }

    const qLow = String(q || '').trim().toLowerCase();
    if (qLow) {
        list = list.filter(p => {
            const hay = [
                p.name,
                p.participant_key,
                p.centers.join(' '),
                p.assigned_program_manager,
                p.apricot_id,
                p.phone,
                p.email,
                p.lscmi_client_id
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(qLow);
        });
    }

    const fLow = String(filter || 'all').trim().toLowerCase();
    if (fLow === 'has_brief') list = list.filter(p => p.has_lscmi_brief);
    else if (fLow === 'has_action_plan') list = list.filter(p => p.has_action_plan);
    else if (fLow === 'waitlist_ready') list = list.filter(p => p.waitlist_ready);
    else if (fLow === 'needs_waitlist') list = list.filter(p => !p.waitlist_ready);
    else if (fLow === 'dual_reentry') list = list.filter(p => p.is_dual_attached_reentry);
    else if (fLow === 'has_todos') list = list.filter(p => p.open_todos_count > 0);

    return {
        total: list.length,
        participants: list
    };
}

function assertParticipantAccess(slugOrName, user) {
    const slug = resolveCanonicalSlug(slugOrName);
    const { metaBySlug } = computeParticipantMetaMap();
    const meta = metaBySlug.get(slug);
    if (!meta) {
        const err = new Error('Participant file not found.');
        err.status = 404;
        throw err;
    }
    if (!canUserAccessCenters(user, meta.centers)) {
        const err = new Error('Access restricted: you do not have permission for this participant\'s center.');
        err.status = 403;
        throw err;
    }
    return { slug, meta };
}

function buildBasicInfoForSlug(slug, meta, lookups) {
    const dbBasic = safeQueryGet('SELECT * FROM participant_basic_info WHERE participant_key = ?', [slug]);
    const pDir = path.join(participantsRootDir, slug);
    let diskBasic = null;
    try {
        const p = path.join(pDir, 'basic_info.json');
        if (fs.existsSync(p)) diskBasic = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}

    const userRow = meta.user_id
        ? safeQueryGet('SELECT id, name, email, phone, address, ssn, birthdate, location, track FROM users WHERE id = ?', [meta.user_id])
        : null;
    const rcRow = meta.client_id
        ? safeQueryGet('SELECT * FROM reentry_clients WHERE id = ?', [meta.client_id])
        : null;

    const apricotIds = meta.apricot_id ? [String(meta.apricot_id)] : [];
    const bioRows = getIndexedRows(lookups.indexed.bioInfo, slug, apricotIds);
    const intakeRows = getIndexedRows(lookups.indexed.intakeCsv, slug, apricotIds);
    const latestBio = bioRows[0] || {};
    const latestIntake = intakeRows[0] || {};

    const streetFromBio = [latestBio.Line1, latestBio.Line2].filter(Boolean).join(', ');
    const fullIntakeAddress = [latestIntake['Street Address'], latestIntake['City / State / Zip']].filter(Boolean).join(', ');

    const street_address = (dbBasic && dbBasic.street_address)
        || (diskBasic && diskBasic.street_address)
        || streetFromBio
        || (userRow && userRow.address)
        || latestIntake['Street Address']
        || '';
    const city = (dbBasic && dbBasic.city)
        || (diskBasic && diskBasic.city)
        || latestBio.City
        || '';
    const state = (dbBasic && dbBasic.state)
        || (diskBasic && diskBasic.state)
        || 'SC';
    const zip = (dbBasic && dbBasic.zip)
        || (diskBasic && diskBasic.zip)
        || (latestBio.Zip ? String(latestBio.Zip) : '');
    const phone = (dbBasic && dbBasic.phone)
        || (diskBasic && diskBasic.phone)
        || (latestBio['Phone Number'] ? String(latestBio['Phone Number']) : '')
        || meta.phone
        || '';
    const email = (dbBasic && dbBasic.email)
        || (diskBasic && diskBasic.email)
        || latestBio.Email
        || meta.email
        || '';
    const dob = formatExcelOrStringDate(
        (dbBasic && dbBasic.dob)
        || (diskBasic && diskBasic.dob)
        || latestBio['Date of Birth (DOB)']
        || (userRow && userRow.birthdate)
        || latestIntake['Date of Birth']
        || ''
    );
    const ssn = String(
        (dbBasic && dbBasic.ssn)
        || (diskBasic && diskBasic.ssn)
        || latestBio['Social Security Number (SSN)']
        || (userRow && userRow.ssn)
        || latestIntake['Social Security Number (Last 4 Digits Only or Full)']
        || ''
    ).trim();

    const full_address = [street_address, [city, state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || fullIntakeAddress;

    return {
        full_name: (dbBasic && dbBasic.full_name) || (diskBasic && diskBasic.full_name) || meta.name,
        street_address,
        city,
        state,
        zip,
        full_address,
        phone,
        email,
        dob,
        ssn,
        ssn_masked: maskSsn(ssn),
        assigned_program_manager: (dbBasic && dbBasic.assigned_program_manager) || meta.assigned_program_manager || 'Unassigned',
        attached_centers: meta.centers,
        primary_center: meta.primary_center,
        track: meta.track,
        status: meta.status,
        apricot_id: meta.apricot_id || null,
        updated_at: (dbBasic && dbBasic.updated_at) || (diskBasic && diskBasic.updated_at) || null,
        updated_by: (dbBasic && dbBasic.updated_by) || (diskBasic && diskBasic.updated_by) || null,
        sources: {
            has_manual_override: Boolean(dbBasic || diskBasic),
            has_apricot_bio: Boolean(bioRows.length),
            has_intake_csv: Boolean(intakeRows.length)
        }
    };
}

function collectParticipantTextAndStructuredSources(slug, meta, bundle, lookups) {
    const apricotIds = meta.apricot_id ? [String(meta.apricot_id)] : [];
    const scRow = safeQueryGet('SELECT * FROM participant_screening_consultation WHERE participant_key = ?', [slug]);
    let manualScreening = null;
    let manualConsultation = null;
    try { if (scRow && scRow.screening_json) manualScreening = JSON.parse(scRow.screening_json); } catch (e) {}
    try { if (scRow && scRow.consultation_json) manualConsultation = JSON.parse(scRow.consultation_json); } catch (e) {}

    const pDir = path.join(participantsRootDir, slug);
    if (!manualScreening) {
        try {
            const sp = path.join(pDir, 'screening.json');
            if (fs.existsSync(sp)) manualScreening = JSON.parse(fs.readFileSync(sp, 'utf8'));
        } catch (e) {}
    }
    if (!manualConsultation) {
        try {
            const cp = path.join(pDir, 'consultation.json');
            if (fs.existsSync(cp)) manualConsultation = JSON.parse(fs.readFileSync(cp, 'utf8'));
        } catch (e) {}
    }

    const apricotScreenings = getIndexedRows(lookups.indexed.resourceCoord, slug, apricotIds);
    const apricotConsultations = getIndexedRows(lookups.indexed.consultations, slug, apricotIds);
    const consultationInfoRows = getIndexedRows(lookups.indexed.consultationInfo, slug, apricotIds);
    const apricotBriefcaseRows = getIndexedRows(lookups.indexed.briefcase, slug, apricotIds);
    const apricotLscmiRows = getIndexedRows(lookups.indexed.lscmi, slug, apricotIds);
    const fsPlanRows = getIndexedRows(lookups.indexed.fsCasePlan, slug, apricotIds);
    const rnPlanRows = getIndexedRows(lookups.indexed.rnCasePlan, slug, apricotIds);
    const appConsultations = (bundle && bundle.screening_consultation && bundle.screening_consultation.history) || [];

    const cmNotesData = (bundle && bundle.case_management_notes) || {};
    const localNotes = [...(cmNotesData.case_notes || []), ...(cmNotesData.manual_folder_notes || [])];
    const cmEvals = cmNotesData.cm_session_evaluations || [];
    const apricotNotes = (bundle && bundle.apricot_history && bundle.apricot_history.processed_notes) || [];
    const reentrySessions = (bundle && bundle.reentry_history && bundle.reentry_history.sessions) || [];

    return {
        manualScreening,
        manualConsultation,
        apricotScreenings,
        apricotConsultations,
        consultationInfoRows,
        appConsultations,
        apricotBriefcaseRows,
        apricotLscmiRows,
        fsPlanRows,
        rnPlanRows,
        localNotes,
        cmEvals,
        apricotNotes,
        reentrySessions
    };
}

function getParticipantFileBundle(slugOrName, user) {
    const { slug, meta } = assertParticipantAccess(slugOrName, user);
    const bundle = getParticipantFolderBundle(slug);
    if (!bundle) {
        const err = new Error('Participant folder not found.');
        err.status = 404;
        throw err;
    }

    const lookups = getExternalIntakeLookups();
    const basic_info = buildBasicInfoForSlug(slug, meta, lookups);
    const src = collectParticipantTextAndStructuredSources(slug, meta, bundle, lookups);
    const todos = getScopedTodos(user, { participantKey: slug, includeCompleted: true });

    const apricotEvals = (bundle.apricot_history && bundle.apricot_history.evaluations) || [];
    const unifiedNotes = [
        ...src.localNotes.map(n => ({
            source: 'Local Case Note',
            date: n.session_date || (n.created_at ? String(n.created_at).slice(0, 10) : ''),
            staff: n.author_name || 'Turn90 Staff',
            context: `${n.note_type || 'Session'} • ${n.category || 'Case Management'}`,
            text: n.content || ''
        })),
        ...src.apricotNotes.map(n => ({
            source: 'Apricot Case Note',
            date: n.activity_date || '',
            staff: n.staff_name || 'Turn90 Staff',
            context: `${n.program_enrollment || ''} ${n.service_context || n.interaction_type || ''}`.trim(),
            text: n.note_text || ''
        })),
        ...src.reentrySessions.map(n => ({
            source: 'Reentry Session',
            date: n.session_date || '',
            staff: 'Reentry Navigator',
            context: n.session_title || 'Session',
            text: [n.notes_text, n.next_conversation_topics].filter(Boolean).join('\nNext Topics: ')
        }))
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    return {
        participant_key: slug,
        name: meta.name,
        centers: meta.centers,
        primary_center: meta.primary_center,
        assigned_program_manager: meta.assigned_program_manager,
        is_dual_attached_reentry: meta.is_dual_attached_reentry,
        dual_attached_center: meta.dual_attached_center,
        track: meta.track,
        status: meta.status,
        apricot_id: meta.apricot_id,
        lscmi_client_id: bundle.lscmi_client_id,
        folder_path: bundle.folder_path,
        basic_info,
        screening: {
            manual_record: src.manualScreening,
            apricot_screenings: src.apricotScreenings,
            app_screenings: src.appConsultations
        },
        consultation: {
            manual_record: src.manualConsultation,
            apricot_consultations: src.apricotConsultations,
            consultation_info_rows: src.consultationInfoRows,
            app_consultations: src.appConsultations
        },
        lscmi: {
            lscmi_client_id: bundle.lscmi_client_id,
            lscmi_files: bundle.lscmi_files,
            lscmi_documents: bundle.lscmi_documents,
            lscmi_brief_md: bundle.lscmi_brief_md,
            lscmi_scoring_md: bundle.lscmi_scoring_md,
            action_plan_md: bundle.action_plan_md,
            lscmi_transcript_txt: bundle.lscmi_transcript_txt,
            apricot_lscmi_rows: src.apricotLscmiRows,
            feedback_loop_log: bundle.feedback_loop_log,
            lscmi_discrepancies: bundle.lscmi_discrepancies,
            lscmi_158_answers: bundle.lscmi_158_answers,
            history_files: bundle.history_files,
            history_log: bundle.history_log
        },
        briefcase: {
            schema: UNIFIED_BRIEFCASE_SCHEMA,
            state: bundle.briefcase,
            apricot_briefcase_rows: src.apricotBriefcaseRows
        },
        case_notes: unifiedNotes,
        cm_session_evaluations: src.cmEvals,
        apricot_evaluations: apricotEvals,
        todos: todos.items,
        caseload_evaluation: bundle.caseload_evaluation,
        skillcat_progress: bundle.skillcat_progress
    };
}

function saveParticipantBasicInfo(slugOrName, payload, user) {
    const { slug, meta } = assertParticipantAccess(slugOrName, user);
    const actor = (user && user.name) || 'Turn90 Staff';
    const existing = safeQueryGet('SELECT * FROM participant_basic_info WHERE participant_key = ?', [slug]) || {};

    let attachedCenters = meta.centers;
    if (Array.isArray(payload.attached_centers) && payload.attached_centers.length > 0) {
        const cleaned = payload.attached_centers.map(normalizeCenterName).filter(c => VALID_CENTERS.includes(c));
        if (cleaned.length > 0) {
            if (!isAdminUser(user)) {
                const allowed = new Set(getAllowedCentersForUser(user));
                if (!cleaned.some(c => allowed.has(c))) {
                    const err = new Error('Cannot remove all centers accessible to your account.');
                    err.status = 403;
                    throw err;
                }
            }
            attachedCenters = cleaned;
        }
    }

    const fullName = String(payload.full_name ?? existing.full_name ?? meta.name).trim() || meta.name;
    const assignedPm = String(payload.assigned_program_manager ?? existing.assigned_program_manager ?? meta.assigned_program_manager ?? 'Unassigned').trim();
    const pmCenter = detectCenterFromProgramManagerName(assignedPm);
    if (attachedCenters.includes('Reentry Navigation') && ['Charleston', 'Columbia', 'Spartanburg'].includes(pmCenter) && !attachedCenters.includes(pmCenter)) {
        attachedCenters.push(pmCenter);
    }

    const streetAddress = String(payload.street_address ?? existing.street_address ?? '').trim();
    const city = String(payload.city ?? existing.city ?? '').trim();
    const state = String(payload.state ?? existing.state ?? 'SC').trim() || 'SC';
    const zip = String(payload.zip ?? existing.zip ?? '').trim();
    const phone = String(payload.phone ?? existing.phone ?? '').trim();
    const email = String(payload.email ?? existing.email ?? '').trim();
    const dob = String(payload.dob ?? existing.dob ?? '').trim();
    const ssn = String(payload.ssn ?? existing.ssn ?? '').trim();
    const primaryCenter = normalizeCenterName(payload.primary_center) || attachedCenters[0] || meta.primary_center;
    const track = String(payload.track ?? existing.track ?? meta.track ?? 'first_shift').trim();
    const status = String(payload.status ?? existing.status ?? meta.status ?? 'active').trim();

    db.prepare(`
        INSERT OR REPLACE INTO participant_basic_info (
            participant_key, full_name, street_address, city, state, zip,
            phone, email, dob, ssn, assigned_program_manager, attached_centers_json,
            primary_center, track, status, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
        slug, fullName, streetAddress, city, state, zip,
        phone, email, dob, ssn, assignedPm, JSON.stringify(attachedCenters),
        primaryCenter, track, status, actor
    );

    if (meta.user_id) {
        const composedAddress = [streetAddress, [city, state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        db.prepare(`
            UPDATE users SET phone = ?, address = ?, birthdate = ?, ssn = ?, location = ?
            WHERE id = ?
        `).run(phone, composedAddress, dob || null, ssn || null, primaryCenter, meta.user_id);
    }

    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, 'basic_info.json'), JSON.stringify({
        participant_key: slug,
        full_name: fullName,
        street_address: streetAddress,
        city,
        state,
        zip,
        phone,
        email,
        dob,
        ssn,
        assigned_program_manager: assignedPm,
        attached_centers: attachedCenters,
        primary_center: primaryCenter,
        track,
        status,
        updated_by: actor,
        updated_at: new Date().toISOString()
    }, null, 2));

    appendParticipantHistoryEvent(slug, {
        category: 'basic_info',
        action: 'Updated Basic Information',
        summary: `Updated participant bio/contact record (${attachedCenters.join(', ')}).`,
        filename: 'basic_info.json',
        actor
    });

    invalidateWorkspaceCaches();
    return getParticipantFileBundle(slug, user);
}

function saveParticipantScreening(slugOrName, payload, user) {
    const { slug } = assertParticipantAccess(slugOrName, user);
    const actor = (user && user.name) || 'Turn90 Staff';
    const existing = safeQueryGet('SELECT * FROM participant_screening_consultation WHERE participant_key = ?', [slug]);
    let prevScreening = {};
    try { if (existing && existing.screening_json) prevScreening = JSON.parse(existing.screening_json); } catch (e) {}

    const record = {
        screening_date: payload.screening_date || prevScreening.screening_date || new Date().toISOString().split('T')[0],
        staff_name: payload.staff_name || actor,
        eligibility_status: payload.eligibility_status || 'Eligible for Consultation',
        referral_source: payload.referral_source || '',
        age_25_to_50: payload.age_25_to_50 || 'yes',
        released_within_12_months: payload.released_within_12_months || 'yes',
        notes: payload.notes || '',
        updated_by: actor,
        updated_at: new Date().toISOString()
    };

    db.prepare(`
        INSERT INTO participant_screening_consultation (participant_key, screening_json, consultation_json, updated_by, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(participant_key) DO UPDATE SET
            screening_json = excluded.screening_json,
            updated_by = excluded.updated_by,
            updated_at = CURRENT_TIMESTAMP
    `).run(slug, JSON.stringify(record), (existing && existing.consultation_json) || null, actor);

    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, 'screening.json'), JSON.stringify(record, null, 2));

    appendParticipantHistoryEvent(slug, {
        category: 'screening',
        action: 'Updated Screening Record',
        summary: `${record.eligibility_status} (${record.screening_date})`,
        filename: 'screening.json',
        actor
    });
    invalidateWorkspaceCaches();
    return getParticipantFileBundle(slug, user);
}

function saveParticipantConsultation(slugOrName, payload, user) {
    const { slug, meta } = assertParticipantAccess(slugOrName, user);
    const actor = (user && user.name) || 'Turn90 Staff';
    const existing = safeQueryGet('SELECT * FROM participant_screening_consultation WHERE participant_key = ?', [slug]);

    const record = {
        consultation_date: payload.consultation_date || new Date().toISOString().split('T')[0],
        staff_name: payload.staff_name || actor,
        preferred_center: payload.preferred_center || meta.primary_center,
        eligibility_decision: payload.eligibility_decision || 'reentry_navigation',
        has_state_id_or_dl: payload.has_state_id_or_dl || '',
        has_ss_card: payload.has_ss_card || '',
        has_birth_certificate: payload.has_birth_certificate || '',
        has_chronic_health_condition: payload.has_chronic_health_condition || 'no',
        chronic_health_and_meds: payload.chronic_health_and_meds || 'no_chronic_conditions_na',
        housing_status: payload.housing_status || '',
        transportation_plan: payload.transportation_plan || '',
        phone_status: payload.phone_status || '',
        dmv_suspended_status: payload.dmv_suspended_status || '',
        child_support_status: payload.child_support_status || '',
        supervision_status: payload.supervision_status || '',
        supervision_notes: payload.supervision_notes || '',
        summary_notes: payload.summary_notes || '',
        updated_by: actor,
        updated_at: new Date().toISOString()
    };

    db.prepare(`
        INSERT INTO participant_screening_consultation (participant_key, screening_json, consultation_json, updated_by, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(participant_key) DO UPDATE SET
            consultation_json = excluded.consultation_json,
            updated_by = excluded.updated_by,
            updated_at = CURRENT_TIMESTAMP
    `).run(slug, (existing && existing.screening_json) || null, JSON.stringify(record), actor);

    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, 'consultation.json'), JSON.stringify(record, null, 2));

    // Log into screening_consultations history table as well
    db.prepare(`
        INSERT INTO screening_consultations (
            participant_key, participant_name, location, age, release_timeframe,
            eligibility_decision, ineligibility_reason, consultation_data_json, summary_markdown, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        slug,
        meta.name,
        record.preferred_center || meta.primary_center,
        Number(payload.age || 30),
        payload.release_timeframe || 'within_12_months',
        record.eligibility_decision,
        '',
        JSON.stringify(record),
        record.summary_notes || `Consultation logged on ${record.consultation_date} by ${actor}.`,
        actor
    );

    appendParticipantHistoryEvent(slug, {
        category: 'consultation',
        action: 'Logged Consultation',
        summary: `${record.eligibility_decision} (${record.consultation_date})`,
        filename: 'consultation.json',
        actor
    });

    // Non-destructively auto-fill Briefcase from the newly saved consultation + case notes + case plan
    autofillBriefcaseFromSources(slug, { overwriteManual: false, actor });
    invalidateWorkspaceCaches();
    return getParticipantFileBundle(slug, user);
}

function autofillBriefcaseFromSources(slugOrName, { overwriteManual = false, actor = 'Auto-Fill Engine' } = {}) {
    const slug = resolveCanonicalSlug(slugOrName);
    const { metaBySlug } = computeParticipantMetaMap();
    const meta = metaBySlug.get(slug) || {
        participant_key: slug,
        name: slug.replace(/_/g, ' '),
        centers: ['Charleston'],
        primary_center: 'Charleston',
        track: 'reentry_nav',
        apricot_id: null,
        user_id: null,
        client_id: null
    };

    const bundle = getParticipantFolderBundle(slug);
    if (!bundle) {
        const err = new Error('Participant folder not found.');
        err.status = 404;
        throw err;
    }

    const lookups = getExternalIntakeLookups();
    const src = collectParticipantTextAndStructuredSources(slug, meta, bundle, lookups);
    const currentState = (bundle.briefcase && bundle.briefcase.items) ? bundle.briefcase : {};
    const currentItems = currentState.items || {};

    const isManualField = (key) => {
        const srcTag = currentItems[key] && currentItems[key].source;
        return !overwriteManual && (srcTag === 'manual_dropdown' || srcTag === 'manual_entry');
    };

    const proposed = {};
    const setProposal = (key, value, notes, source) => {
        if (!value || isManualField(key)) return;
        proposed[key] = { value, notes, source };
    };

    // 1. From Consultation (Manual Consultation, App Consultations, Apricot Consultation Info - Rows)
    const mc = src.manualConsultation || {};
    const ci = src.consultationInfoRows[0] || {};
    const apBc = src.apricotBriefcaseRows[0] || {};

    const consultBirthCert = String(mc.has_birth_certificate || ci['Do you have a birth certificate?'] || '').toLowerCase();
    if (/yes|verified|have it/i.test(consultBirthCert)) {
        setProposal('birth_certificate', 'verified_copy', 'Confirmed birth certificate on Consultation.', 'consultation');
    } else if (/no|missing|need/i.test(consultBirthCert)) {
        setProposal('birth_certificate', 'missing', 'Reported missing birth certificate on Consultation.', 'consultation');
    }

    const consultSs = String(mc.has_ss_card || ci['Do you have your social security card?'] || '').toLowerCase();
    if (/yes|verified|have it/i.test(consultSs)) {
        setProposal('ss_card', 'verified_card', 'Confirmed SS card on Consultation.', 'consultation');
    } else if (/no|missing|need/i.test(consultSs)) {
        setProposal('ss_card', 'missing', 'Reported missing SS card on Consultation.', 'consultation');
    }

    const consultId = String(mc.has_state_id_or_dl || ci['Do you have a drivers license?'] || ci['Do you have a state issued ID?'] || '').toLowerCase();
    if (/valid driver|yes.*driver/i.test(consultId) || /^yes$/i.test(String(ci['Do you have a drivers license?'] || '').trim())) {
        setProposal('state_id_or_dl', 'valid_dl', 'Reported valid Driver\'s License on Consultation.', 'consultation');
    } else if (/valid.*id|yes.*state id/i.test(consultId) || /^yes$/i.test(String(ci['Do you have a state issued ID?'] || '').trim())) {
        setProposal('state_id_or_dl', 'valid_state_id', 'Reported valid State ID on Consultation.', 'consultation');
    } else if (/suspend/i.test(consultId)) {
        setProposal('state_id_or_dl', /state id/i.test(consultId) ? 'dl_suspended_has_state_id' : 'dl_suspended_no_id', 'Reported suspended DL on Consultation.', 'consultation');
    }

    const consultHousing = String(mc.housing_status || ci['Current Housing Status'] || '').toLowerCase();
    if (/own|rent|independent|stable|family.*stable/i.test(consultHousing)) {
        setProposal('stable_housing', 'stable_verified', `Consultation housing: ${mc.housing_status || ci['Current Housing Status']}`, 'consultation');
    } else if (/transitional|halfway|co-living|oxford/i.test(consultHousing)) {
        setProposal('stable_housing', 'transitional_verified', `Consultation transitional housing: ${mc.housing_status || ci['Current Housing Status']}`, 'consultation');
    } else if (/unhoused|homeless|shelter|couch|temporary|hotel/i.test(consultHousing)) {
        setProposal('stable_housing', /shelter|unhoused|homeless/i.test(consultHousing) ? 'unhoused_shelter' : 'temporary_unstable', `Consultation housing need: ${mc.housing_status || ci['Current Housing Status']}`, 'consultation');
    }

    let hasChronic = mc.has_chronic_health_condition === 'yes' ? 'yes' : (currentState.has_chronic_health_condition === 'yes' ? 'yes' : 'no');
    const medCol = String(ci['If yes to prescribed medication in the...'] || ci['In the last five years, have you been...'] || '').trim();
    if (mc.chronic_health_and_meds && mc.chronic_health_and_meds !== 'no_chronic_conditions_na') {
        hasChronic = 'yes';
        setProposal('chronic_health_and_meds', mc.chronic_health_and_meds, 'Recorded in Consultation.', 'consultation');
    } else if (medCol && !/^(no|none|n\/a)$/i.test(medCol)) {
        hasChronic = 'yes';
        setProposal('chronic_health_and_meds', 'needs_daily_med_access', `Consultation health note: ${medCol}`, 'consultation');
    }

    if (mc.phone_status) setProposal('reliable_phone', mc.phone_status, 'Consultation phone status.', 'consultation');
    if (mc.dmv_suspended_status) setProposal('dmv_suspended_inquiry', mc.dmv_suspended_status, 'Consultation DMV status.', 'consultation');
    if (mc.child_support_status) setProposal('child_support_contact', mc.child_support_status, 'Consultation child support status.', 'consultation');
    if (mc.supervision_status) setProposal('supervision_information', mc.supervision_status, mc.supervision_notes || 'Consultation supervision status.', 'consultation');

    // 2. From Case Notes (local notes + manual folder notes + Reentry sessions + Apricot notes)
    const allCaseNoteTexts = [
        ...src.localNotes.map(n => `[${n.session_date || ''}] ${n.content || ''}`),
        ...src.reentrySessions.map(n => `[${n.session_date || ''}] ${n.notes_text || ''} ${n.next_conversation_topics || ''}`),
        ...src.apricotNotes.map(n => `[${n.activity_date || ''}] ${n.note_text || ''}`)
    ];
    const combinedCaseNotes = allCaseNoteTexts.join('\n');

    if (combinedCaseNotes.trim()) {
        if (/(?:received|got|picked up|obtained|has)\s+(?:his|her|their)?\s*(?:driver'?s?\s*license|dl)\b/i.test(combinedCaseNotes)) {
            setProposal('state_id_or_dl', 'valid_dl', 'Detected Driver\'s License confirmation in Case Notes.', 'case_notes');
        } else if (/(?:received|got|picked up|obtained|has)\s+(?:his|her|their)?\s*(?:state\s*id|photo\s*id)/i.test(combinedCaseNotes)) {
            setProposal('state_id_or_dl', 'valid_state_id', 'Detected State ID confirmation in Case Notes.', 'case_notes');
        } else if (/suspended\s+(?:driver|license|dl)/i.test(combinedCaseNotes) && !proposed.state_id_or_dl) {
            setProposal('state_id_or_dl', 'dl_suspended_has_state_id', 'Detected suspended DL mention in Case Notes.', 'case_notes');
        }

        if (/(?:received|got|has|verified|brought in)\s+(?:his|her|their)?\s*(?:social\s*security\s*card|ss\s*card|ssn\s*card)/i.test(combinedCaseNotes)) {
            setProposal('ss_card', 'verified_card', 'Detected Social Security Card confirmation in Case Notes.', 'case_notes');
        }
        if (/(?:received|got|has|verified|ordered)\s+(?:his|her|their)?\s*(?:birth\s*certificate)/i.test(combinedCaseNotes)) {
            const orderedOnly = /ordered\s+(?:his|her|their)?\s*birth\s*certificate/i.test(combinedCaseNotes);
            setProposal('birth_certificate', orderedOnly ? 'ordered_in_transit' : 'verified_copy', 'Detected Birth Certificate update in Case Notes.', 'case_notes');
        }
        if (/went\s+to\s+(?:the\s+)?dmv|scdmv|reinstatement\s+fee/i.test(combinedCaseNotes)) {
            setProposal('dmv_suspended_inquiry', 'completed_dmv_inquiry', 'Detected DMV / SCDMV reinstatement check in Case Notes.', 'case_notes');
        }
        if (/has\s+a\s+(?:working|new|active)\s+phone|got\s+a\s+phone|active\s+phone/i.test(combinedCaseNotes)) {
            setProposal('reliable_phone', 'active_verified', 'Detected active phone in Case Notes.', 'case_notes');
        }
        if (/maintains?\s+stable\s+housing|stable\s+housing|moved\s+into/i.test(combinedCaseNotes)) {
            setProposal('stable_housing', 'stable_verified', 'Detected stable housing update in Case Notes.', 'case_notes');
        }
        if (/child\s+support/i.test(combinedCaseNotes) && !/no\s+child\s+support/i.test(combinedCaseNotes)) {
            const compliant = /compliant|resolution|resolved|contact(?:ed)?\s+child\s+support|making\s+payments/i.test(combinedCaseNotes);
            setProposal('child_support_contact', compliant ? 'contact_made_compliant' : 'needs_contact', 'Detected child support details in Case Notes.', 'case_notes');
        }
        if (/probation|parole|home\s+detention|public\s+defender|po\b/i.test(combinedCaseNotes)) {
            const noIssue = /progressing\s+without\s+issue|cleared|no\s+conflict|written\s+(?:pd|po)/i.test(combinedCaseNotes);
            setProposal('supervision_information', noIssue ? 'active_logged_no_conflict' : (currentItems.supervision_information?.value || 'active_logged_no_conflict'), 'Detected supervision context in Case Notes.', 'case_notes');
        }
        if (/resume\s+(?:completed|built|updated)|build\s+his\s+resume|built\s+resume/i.test(combinedCaseNotes)) {
            setProposal('resume_and_email', 'completed', 'Detected resume completion in Case Notes.', 'case_notes');
        }
        if (/bank\s+account|direct\s+deposit|opened\s+(?:a\s+)?checking/i.test(combinedCaseNotes)) {
            setProposal('w9_and_banking', 'verified', 'Detected banking setup in Case Notes.', 'case_notes');
        }
        if (/snap|food\s+stamps|ebt|medicaid/i.test(combinedCaseNotes)) {
            setProposal('snap_and_benefits', /approved|active|receiving/i.test(combinedCaseNotes) ? 'enrolled' : 'applied', 'Detected benefits activity in Case Notes.', 'case_notes');
        }
        if (/\b(?:diabetes|hypertension|insulin|prescribed\s+med|daily\s+med|blood\s+pressure|seizure|chronic)\b/i.test(combinedCaseNotes)) {
            hasChronic = 'yes';
            if (!proposed.chronic_health_and_meds) {
                setProposal('chronic_health_and_meds', /has\s+meds|refill|taking/i.test(combinedCaseNotes) ? 'treated_and_has_daily_meds' : 'needs_daily_med_access', 'Detected chronic health / medication reference in Case Notes.', 'case_notes');
            }
        }
    }

    // 3. From Case Plan & Apricot Briefcase
    const planText = [
        bundle.action_plan_md,
        bundle.lscmi_brief_md,
        ...src.fsPlanRows.map(r => `${r['Focus Area 1'] || ''} ${r['Focus Area 1 Situation'] || ''} ${r['Focus Area 2'] || ''} ${r['Focus Area 2 Situations'] || ''}`),
        ...src.rnPlanRows.map(r => `${r['Case Plan'] || ''} ${r['Requirements to be eligible for First Shift'] || ''}`),
        `${apBc['Gate 1 Checklist'] || ''} ${apBc['Gate 2 Checklist'] || ''} ${apBc['Gate 3 Checklist'] || ''} ${apBc['Gate 4 Checklist'] || ''} ${apBc['Immediate Next Step / Referral Made:'] || ''}`
    ].filter(Boolean).join('\n');

    if (planText.trim()) {
        if (/hvac/i.test(planText) && !isManualField('skillcat_pathway')) {
            setProposal('skillcat_pathway', 'HVAC', 'Matched from Case Plan / Brief.', 'case_plan');
        } else if (/appliance/i.test(planText)) {
            setProposal('skillcat_pathway', 'Appliance Repair', 'Matched from Case Plan / Brief.', 'case_plan');
        } else if (/maintenance|property/i.test(planText)) {
            setProposal('skillcat_pathway', 'Property Maintenance', 'Matched from Case Plan / Brief.', 'case_plan');
        } else if (/electrical/i.test(planText)) {
            setProposal('skillcat_pathway', 'Electrical', 'Matched from Case Plan / Brief.', 'case_plan');
        } else if (/plumbing/i.test(planText)) {
            setProposal('skillcat_pathway', 'Plumbing', 'Matched from Case Plan / Brief.', 'case_plan');
        }

        if (/photo\s*id|state\s*id/i.test(String(apBc['Gate 1 Checklist'] || '')) && !proposed.state_id_or_dl) {
            setProposal('state_id_or_dl', 'valid_state_id', 'Checked off in Apricot Briefcase Gate 1.', 'case_plan');
        }
        if (/social\s*security/i.test(String(apBc['Gate 1 Checklist'] || '')) && !proposed.ss_card) {
            setProposal('ss_card', 'verified_card', 'Checked off in Apricot Briefcase Gate 1.', 'case_plan');
        }
        if (/birth\s*certificate/i.test(String(apBc['Gate 1 Checklist'] || '')) && !proposed.birth_certificate) {
            setProposal('birth_certificate', 'verified_copy', 'Checked off in Apricot Briefcase Gate 1.', 'case_plan');
        }
        if (/housing/i.test(String(apBc['Gate 2 Checklist'] || '')) && !proposed.stable_housing) {
            setProposal('stable_housing', 'stable_verified', 'Checked off in Apricot Briefcase Gate 2.', 'case_plan');
        }
        if (/phone/i.test(String(apBc['Gate 2 Checklist'] || '')) && !proposed.reliable_phone) {
            setProposal('reliable_phone', 'active_verified', 'Checked off in Apricot Briefcase Gate 2.', 'case_plan');
        }
        if (/resume/i.test(String(apBc['Gate 2 Checklist'] || '')) && !proposed.resume_and_email) {
            setProposal('resume_and_email', 'completed', 'Checked off in Apricot Briefcase Gate 2.', 'case_plan');
        }
    }

    // Conditional medical enforcement
    if (hasChronic !== 'yes' && !isManualField('chronic_health_and_meds')) {
        proposed.chronic_health_and_meds = {
            value: 'no_chronic_conditions_na',
            notes: 'No chronic health conditions reported — medical appointments not required.',
            source: 'case_plan'
        };
    }

    const updated = updateParticipantUnifiedBriefcase(slug, {
        has_chronic_health_condition: hasChronic,
        items: proposed,
        history_action: 'Auto-Filled Briefcase',
        actor
    });
    invalidateWorkspaceCaches();

    return {
        briefcase: updated,
        updated_fields: Object.keys(proposed)
    };
}

function createNewParticipantFile(payload, user) {
    const fullName = String(payload.full_name || payload.name || '').trim();
    if (!fullName) {
        const err = new Error('Participant full name is required.');
        err.status = 400;
        throw err;
    }

    const requestedCenter = normalizeCenterName(payload.primary_center || payload.center || payload.location)
        || getAllowedCentersForUser(user)[0]
        || 'Charleston';

    if (!isAdminUser(user) && !getAllowedCentersForUser(user).includes(requestedCenter)) {
        const err = new Error(`Access restricted: you can only create participants in ${getAllowedCentersForUser(user).join(', ')}.`);
        err.status = 403;
        throw err;
    }

    const slug = resolveCanonicalSlug(fullName);
    const attachedCenters = [requestedCenter];
    const pm = String(payload.assigned_program_manager || '').trim() || 'Unassigned';
    const pmCenter = detectCenterFromProgramManagerName(pm);
    if (requestedCenter === 'Reentry Navigation' && ['Charleston', 'Columbia', 'Spartanburg'].includes(pmCenter) && !attachedCenters.includes(pmCenter)) {
        attachedCenters.push(pmCenter);
    }

    const track = payload.track || (requestedCenter === 'Reentry Navigation' ? 'reentry_nav' : (requestedCenter === 'Prison Program' ? 'prison_program' : 'first_shift'));
    const actor = (user && user.name) || 'Turn90 Staff';

    db.prepare(`
        INSERT OR REPLACE INTO participant_basic_info (
            participant_key, full_name, street_address, city, state, zip,
            phone, email, dob, ssn, assigned_program_manager, attached_centers_json,
            primary_center, track, status, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
    `).run(
        slug,
        fullName,
        String(payload.street_address || '').trim(),
        String(payload.city || '').trim(),
        String(payload.state || 'SC').trim() || 'SC',
        String(payload.zip || '').trim(),
        String(payload.phone || '').trim(),
        String(payload.email || '').trim(),
        String(payload.dob || '').trim(),
        String(payload.ssn || '').trim(),
        pm,
        JSON.stringify(attachedCenters),
        requestedCenter,
        track,
        actor
    );

    const pDir = path.join(participantsRootDir, slug);
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });
    if (!fs.existsSync(path.join(pDir, 'documents'))) fs.mkdirSync(path.join(pDir, 'documents'), { recursive: true });
    if (!fs.existsSync(path.join(pDir, 'history'))) fs.mkdirSync(path.join(pDir, 'history'), { recursive: true });

    appendParticipantHistoryEvent(slug, {
        category: 'general',
        action: 'Created Participant File',
        summary: `New participant file created in ${attachedCenters.join(', ')}.`,
        actor
    });

    invalidateWorkspaceCaches();
    syncAllParticipantFolders({ force: true });
    return getParticipantFileBundle(slug, user);
}

// ============================================================================
// ADMIN STAFF USER ACCOUNT MANAGEMENT
// ============================================================================
function listStaffAccounts() {
    const rows = safeQueryAll(`
        SELECT id, name, email, phone, role, track, location, portal_type, login_name, is_active, created_at
        FROM users
        WHERE role != 'participant'
        ORDER BY CASE WHEN role IN ('admin', 'director') OR portal_type IN ('admin', 'supervisor') THEN 0 ELSE 1 END, location ASC, name ASC
    `);
    return rows.map(normalizeUserAccount);
}

async function createStaffAccount(payload, adminUser) {
    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');
    const userType = String(payload.user_type || 'User').toLowerCase() === 'admin' ? 'Admin' : 'User';
    const center = userType === 'Admin' ? 'All' : normalizeCenterName(payload.location || payload.assigned_center || payload.center);

    if (!name || !email || password.length < 8) {
        const err = new Error('Full name, email, and a password of at least 8 characters are required.');
        err.status = 400;
        throw err;
    }
    if (userType === 'User' && !VALID_CENTERS.includes(center)) {
        const err = new Error(`Valid center assignment required for User accounts (${VALID_CENTERS.join(', ')}).`);
        err.status = 400;
        throw err;
    }

    const existing = safeQueryGet('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    if (existing) {
        const err = new Error('An account with that email address already exists.');
        err.status = 400;
        throw err;
    }

    const hash = await bcrypt.hash(password, 10);
    const dbRole = userType === 'Admin' ? 'admin' : 'user';
    const portalType = userType === 'Admin' ? 'admin' : 'center';
    const track = center === 'Reentry Navigation' ? 'reentry_nav' : 'first_shift';

    const res = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, role, track, location, portal_type, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(name, email, String(payload.phone || '').trim(), hash, dbRole, track, center, portalType);

    const created = db.prepare('SELECT id, name, email, phone, role, track, location, portal_type, is_active, created_at FROM users WHERE id = ?').get(res.lastInsertRowid);
    return normalizeUserAccount(created);
}

async function updateStaffAccount(targetId, payload, adminUser) {
    const existing = safeQueryGet(`SELECT * FROM users WHERE id = ? AND role != 'participant'`, [targetId]);
    if (!existing) {
        const err = new Error('Staff account not found.');
        err.status = 404;
        throw err;
    }

    const nextUserType = payload.user_type
        ? (String(payload.user_type).toLowerCase() === 'admin' ? 'Admin' : 'User')
        : (normalizeUserAccount(existing).user_type);

    const nextIsActive = payload.is_active !== undefined ? (payload.is_active ? 1 : 0) : (existing.is_active === 0 ? 0 : 1);

    // Prevent locking out the last active Admin
    const wasAdmin = isAdminUser(existing);
    if (wasAdmin && (nextUserType !== 'Admin' || nextIsActive === 0)) {
        const activeAdmins = safeQueryAll(`
            SELECT id FROM users
            WHERE role != 'participant'
              AND (role IN ('admin', 'director') OR portal_type IN ('admin', 'supervisor'))
              AND COALESCE(is_active, 1) = 1
        `);
        if (activeAdmins.length <= 1 && activeAdmins.some(a => a.id === existing.id)) {
            const err = new Error('Cannot demote or deactivate the last active Admin account.');
            err.status = 400;
            throw err;
        }
    }

    const nextName = payload.name !== undefined ? String(payload.name).trim() : existing.name;
    const nextEmail = payload.email !== undefined ? String(payload.email).trim().toLowerCase() : existing.email;
    if (!nextName || !nextEmail) {
        const err = new Error('Name and email cannot be empty.');
        err.status = 400;
        throw err;
    }

    const dup = safeQueryGet('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [nextEmail, existing.id]);
    if (dup) {
        const err = new Error('Another account already uses that email address.');
        err.status = 400;
        throw err;
    }

    let nextCenter = nextUserType === 'Admin'
        ? 'All'
        : normalizeCenterName(payload.location || payload.assigned_center || payload.center || existing.location);

    if (nextUserType === 'User' && !VALID_CENTERS.includes(nextCenter)) {
        nextCenter = 'Charleston';
    }

    const nextRole = nextUserType === 'Admin' ? 'admin' : 'user';
    const nextPortal = nextUserType === 'Admin' ? 'admin' : 'center';

    let nextPasswordHash = existing.password_hash;
    if (payload.password && String(payload.password).trim().length > 0) {
        if (String(payload.password).trim().length < 8) {
            const err = new Error('New password must be at least 8 characters.');
            err.status = 400;
            throw err;
        }
        nextPasswordHash = await bcrypt.hash(String(payload.password).trim(), 10);
    }

    db.prepare(`
        UPDATE users
        SET name = ?, email = ?, phone = ?, password_hash = ?, role = ?, location = ?, portal_type = ?, is_active = ?
        WHERE id = ?
    `).run(
        nextName,
        nextEmail,
        payload.phone !== undefined ? String(payload.phone).trim() : (existing.phone || ''),
        nextPasswordHash,
        nextRole,
        nextCenter,
        nextPortal,
        nextIsActive,
        existing.id
    );

    const updated = db.prepare('SELECT id, name, email, phone, role, track, location, portal_type, is_active, created_at FROM users WHERE id = ?').get(existing.id);
    return normalizeUserAccount(updated);
}

function deleteStaffAccount(targetId, adminUser) {
    const existing = safeQueryGet(`SELECT * FROM users WHERE id = ? AND role != 'participant'`, [targetId]);
    if (!existing) {
        const err = new Error('Staff account not found.');
        err.status = 404;
        throw err;
    }
    if (adminUser && Number(adminUser.id) === Number(existing.id)) {
        const err = new Error('You cannot delete your own currently signed-in account.');
        err.status = 400;
        throw err;
    }
    if (isAdminUser(existing)) {
        const activeAdmins = safeQueryAll(`
            SELECT id FROM users
            WHERE role != 'participant'
              AND (role IN ('admin', 'director') OR portal_type IN ('admin', 'supervisor'))
              AND COALESCE(is_active, 1) = 1
        `);
        if (activeAdmins.length <= 1) {
            const err = new Error('Cannot delete the last active Admin account.');
            err.status = 400;
            throw err;
        }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
    return { deleted: true, id: Number(targetId) };
}

async function changeOwnPassword(userId, currentPassword, newPassword) {
    const user = safeQueryGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
        const err = new Error('Account not found.');
        err.status = 404;
        throw err;
    }
    if (!newPassword || String(newPassword).length < 8) {
        const err = new Error('New password must be at least 8 characters.');
        err.status = 400;
        throw err;
    }
    const valid = await bcrypt.compare(String(currentPassword || ''), user.password_hash || '');
    if (!valid) {
        const err = new Error('Current password is incorrect.');
        err.status = 401;
        throw err;
    }
    const newHash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    return { success: true };
}

module.exports = {
    VALID_CENTERS,
    CENTER_PM_MAP,
    normalizeCenterName,
    normalizeUserAccount,
    isAdminUser,
    getAllowedCentersForUser,
    canUserAccessCenters,
    invalidateWorkspaceCaches,
    computeParticipantMetaMap,
    getScopedCaseloads,
    syncCaseNoteTodosForAllParticipants,
    getScopedTodos,
    addManualTodo,
    toggleTodoComplete,
    deleteTodo,
    getScopedWorkspaceOverview,
    searchScopedParticipants,
    assertParticipantAccess,
    getParticipantFileBundle,
    saveParticipantBasicInfo,
    saveParticipantScreening,
    saveParticipantConsultation,
    autofillBriefcaseFromSources,
    createNewParticipantFile,
    listStaffAccounts,
    createStaffAccount,
    updateStaffAccount,
    deleteStaffAccount,
    changeOwnPassword
};
