// Automated Reporting Engine for Program Managers
// - Monday Participant Needs Report (Weekly Case Planning & Rapid Barrier Analysis)
// - Friday Milestone & Termination Report (Stability Red-Flags, Step-Downs, & Director Overrides)
// - Apricot Points CSV Parser & Sync

const { db, STABILITY_STEP_DOWN_TRIGGERS } = require('./db');

function generateMondayNeedsReport(locationFilter = null) {
    let query = `
        SELECT u.id, u.name, u.email, u.phone, u.location, u.track,
               p.current_gate, p.w9_status, p.dl_status, p.dl_notes,
               p.child_support_status, p.child_support_notes, p.housing_status,
               p.transportation_status, p.substance_status, p.court_dates, p.overall_status,
               p.stability_red_flags, p.director_override, p.director_override_notes,
               (SELECT COUNT(*) FROM briefcase_items bi WHERE bi.user_id = u.id AND bi.status = 'green') as completed_briefcase_items,
               (SELECT COUNT(*) FROM briefcase_items bi WHERE bi.user_id = u.id) as total_briefcase_items
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant' AND (p.overall_status IS NULL OR p.overall_status != 'terminated')
    `;
    const params = [];
    if (locationFilter) {
        query += ` AND u.location = ?`;
        params.push(locationFilter);
    }
    query += ` ORDER BY u.location, p.current_gate DESC, u.name ASC`;

    const participants = db.prepare(query).all(...params);

    const reportData = {
        generatedAt: new Date().toISOString(),
        location: locationFilter || 'All Locations',
        totalActiveParticipants: participants.length,
        casePlanningAudit: {
            needsRapidAction: 0,
            needsExtraResources: 0,
            dlBarriers: 0,
            childSupportBarriers: 0,
            housingInstability: 0,
            missingW9orID: 0,
            transportationGaps: 0
        },
        participants: []
    };

    participants.forEach(p => {
        const identifiedBarriers = [];
        let canMeetRapidly = true;
        let needsMoreResources = false;

        // Driver's License
        if (p.dl_status === 'suspended' || p.dl_status === 'reinstatement_plan') {
            reportData.casePlanningAudit.dlBarriers++;
            identifiedBarriers.push(`Driver's License: ${p.dl_status} (${p.dl_notes || 'Action plan needed'})`);
        }
        // Child Support
        if (p.child_support_status === 'behind' || p.child_support_status === 'modification_needed') {
            reportData.casePlanningAudit.childSupportBarriers++;
            identifiedBarriers.push(`Child Support: ${p.child_support_status} (${p.child_support_notes || 'Modification review needed'})`);
        }
        // Housing
        if (p.housing_status === 'at_risk' || p.housing_status === 'shelter' || p.housing_status === 'motel') {
            reportData.casePlanningAudit.housingInstability++;
            identifiedBarriers.push(`Housing: ${p.housing_status}`);
            canMeetRapidly = false;
            needsMoreResources = true;
        }
        // W-9 & ID
        if (p.w9_status !== 'verified') {
            reportData.casePlanningAudit.missingW9orID++;
            identifiedBarriers.push(`ID/W-9: ${p.w9_status || 'Missing documents'}`);
        }
        // Transportation
        if (p.transportation_status === 'none' || p.transportation_status === 'needs_ride') {
            reportData.casePlanningAudit.transportationGaps++;
            identifiedBarriers.push(`Transportation: ${p.transportation_status}`);
        }

        if (!canMeetRapidly) reportData.casePlanningAudit.needsExtraResources++;
        if (identifiedBarriers.length > 0) reportData.casePlanningAudit.needsRapidAction++;

        // Parse stability flags if any
        let flags = [];
        try {
            if (p.stability_red_flags) flags = JSON.parse(p.stability_red_flags);
        } catch(e) {}

        reportData.participants.push({
            id: p.id,
            name: p.name,
            phone: p.phone,
            email: p.email,
            location: p.location,
            track: p.track,
            currentGate: p.current_gate || 1,
            briefcaseProgress: `${p.completed_briefcase_items || 0} / ${p.total_briefcase_items || 47} Items`,
            identifiedBarriers,
            canMeetRapidly,
            needsMoreResources,
            courtDates: p.court_dates || 'None listed',
            stabilityFlags: flags,
            directorOverride: p.director_override === 1 ? `Approved by ${p.director_override_by || 'Director'}: ${p.director_override_notes || ''}` : null,
            urgentPriority: identifiedBarriers.length >= 2 || flags.length > 0
        });
    });

    return reportData;
}

function generateFridayMilestoneReport(locationFilter = null) {
    let query = `
        SELECT u.id, u.name, u.location, u.track,
               p.current_gate, p.overall_status, p.termination_reason, p.termination_date,
               p.stability_red_flags, p.director_override, p.director_override_notes, p.director_override_by,
               (SELECT COUNT(*) FROM gate_criteria gc WHERE gc.user_id = u.id AND gc.status = 'green') as green_criteria_count,
               (SELECT COUNT(*) FROM gate_criteria gc WHERE gc.user_id = u.id AND gc.status = 'red') as red_criteria_count,
               (SELECT AVG(points_earned) FROM daily_points dp WHERE dp.user_id = u.id) as avg_points,
               (SELECT COUNT(*) FROM daily_points dp WHERE dp.user_id = u.id AND dp.attendance_status = 'ncns') as ncns_count,
               (SELECT COUNT(*) FROM daily_points dp WHERE dp.user_id = u.id AND dp.attendance_status = 'unexcused') as unexcused_count
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant'
    `;
    const params = [];
    if (locationFilter) {
        query += ` WHERE u.location = ?`;
        params.push(locationFilter);
    }
    query += ` ORDER BY u.location, p.overall_status, p.current_gate DESC`;

    const records = db.prepare(query).all(...params);

    const reportData = {
        generatedAt: new Date().toISOString(),
        location: locationFilter || 'All Locations',
        totalParticipants: records.length,
        readyForPlacementCount: 0,
        activeOnTrackCount: 0,
        stepDownStabilizingCount: 0,
        directorOverrideCount: 0,
        terminatedCount: 0,
        roster: []
    };

    records.forEach(r => {
        let statusTag = 'Active On-Track';
        let flags = [];
        try {
            if (r.stability_red_flags) flags = JSON.parse(r.stability_red_flags);
        } catch(e) {}

        // Check for NCNS or attendance infractions
        if (r.ncns_count > 0 && !flags.includes('any_ncns')) {
            flags.push(`ANY No Call No Show (${r.ncns_count} NCNS)`);
        }
        if (r.unexcused_count >= 2 && !flags.includes('two_unplanned_absences')) {
            flags.push(`Two or more unplanned absences (${r.unexcused_count})`);
        }

        if (r.overall_status === 'terminated') {
            reportData.terminatedCount++;
            statusTag = 'Terminated / Dropped';
        } else if (r.overall_status === 'reentry_nav_stabilizing' || (flags.length > 0 && r.director_override !== 1)) {
            reportData.stepDownStabilizingCount++;
            statusTag = 'Action: Step Down to Re-entry Nav for Stabilization';
        } else if (r.director_override === 1) {
            reportData.directorOverrideCount++;
            statusTag = `Director Override Active (${r.director_override_by || 'Director'})`;
        } else if (r.current_gate === 4 && r.green_criteria_count >= 14) {
            reportData.readyForPlacementCount++;
            statusTag = 'Week 9 Job Placement Ready (Green)';
        } else {
            reportData.activeOnTrackCount++;
        }

        reportData.roster.push({
            id: r.id,
            name: r.name,
            location: r.location,
            track: r.track,
            currentGate: r.current_gate || 1,
            greenCriteria: r.green_criteria_count,
            redCriteria: r.red_criteria_count,
            avgPoints: r.avg_points ? Number(r.avg_points).toFixed(1) : 'N/A',
            ncnsCount: r.ncns_count,
            unexcusedCount: r.unexcused_count,
            stabilityRedFlags: flags,
            statusTag: statusTag,
            directorOverride: r.director_override === 1 ? `${r.director_override_by}: ${r.director_override_notes}` : null,
            terminationReason: r.termination_reason || null
        });
    });

    return reportData;
}

const XLSX = require('xlsx');

// Parse Apricot Points Excel Spreadsheet or CSV and update database
function importApricotData(input, isBuffer = false) {
    let rawRows = [];

    if (isBuffer || Buffer.isBuffer(input)) {
        try {
            const workbook = XLSX.read(input, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch(e) {
            return { success: false, error: 'Failed to parse Excel workbook: ' + e.message };
        }
    } else if (typeof input === 'string') {
        const lines = input.trim().split(/\r?\n/);
        rawRows = lines.map(l => l.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')));
    }

    if (!rawRows || rawRows.length < 2) {
        return { success: false, error: 'Spreadsheet or CSV is empty or missing data rows.' };
    }

    const rows = rawRows.slice(1);
    let importedCount = 0;
    let errors = [];

    const insertPointsStmt = db.prepare(`
        INSERT INTO daily_points (user_id, date, points_earned, max_points, attendance_status, notes, imported_from_apricot)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET
            points_earned = excluded.points_earned,
            attendance_status = excluded.attendance_status,
            notes = excluded.notes,
            imported_from_apricot = 1
    `);

    const findUserStmt = db.prepare(`
        SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(name) LIKE ? LIMIT 1
    `);

    const tx = db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || cols.length < 3) continue;

            const identifier = String(cols[0] || '').trim().toLowerCase();
            if (!identifier) continue;

            let dateVal = cols[1];
            let dateStr = '';
            if (dateVal instanceof Date) {
                dateStr = dateVal.toISOString().split('T')[0];
            } else if (typeof dateVal === 'number') {
                const parsedDate = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
                dateStr = !isNaN(parsedDate.getTime()) ? parsedDate.toISOString().split('T')[0] : String(dateVal);
            } else {
                dateStr = String(dateVal || '').trim();
            }

            const points = parseFloat(cols[2]) || 0;
            const status = String(cols[3] || 'present').trim().toLowerCase();
            const notes = String(cols[4] || '').trim();

            const user = findUserStmt.get(identifier, `%${identifier}%`);
            if (user) {
                insertPointsStmt.run(user.id, dateStr, points, 10, status, notes);
                importedCount++;
            } else {
                errors.push(`Row ${i + 2}: Participant not found for '${cols[0]}'`);
            }
        }
    });

    tx();
    return { success: true, importedCount, errors };
}

function importApricotCsv(csvContent) {
    return importApricotData(csvContent, false);
}

// Compute Weekly Points (Out of 50) and Current Week Progress
function getWeeklyPointsSummary(userId) {
    const pointsRecords = db.prepare(`
        SELECT date, points_earned, attendance_status, notes
        FROM daily_points
        WHERE user_id = ?
        ORDER BY date ASC
    `).all(userId);

    if (pointsRecords.length === 0) {
        return {
            overallWeeklyAverage: 0,
            totalWeeksCounted: 0,
            currentWeekPoints: 0,
            currentWeekMax: 50,
            currentWeekEntries: 0,
            weeks: []
        };
    }

    // Group records by calendar week (Monday to Friday/Sunday)
    const weeksMap = {};

    pointsRecords.forEach(rec => {
        const d = new Date(rec.date + 'T12:00:00Z');
        if (isNaN(d.getTime())) return;
        
        // Find Monday of the week
        const dayOfWeek = d.getUTCDay(); // 0 = Sun, 1 = Mon ...
        const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() + diff);
        const weekKey = monday.toISOString().split('T')[0];

        if (!weeksMap[weekKey]) {
            weeksMap[weekKey] = {
                weekStartDate: weekKey,
                totalPoints: 0,
                daysLogged: 0,
                records: []
            };
        }

        weeksMap[weekKey].totalPoints += Number(rec.points_earned) || 0;
        weeksMap[weekKey].daysLogged += 1;
        weeksMap[weekKey].records.push(rec);
    });

    const sortedWeeks = Object.values(weeksMap).sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
    
    // Overall average of weekly totals (scaled out of 50 max points per week)
    let totalWeeklySum = 0;
    sortedWeeks.forEach(w => {
        totalWeeklySum += Math.min(50, w.totalPoints);
    });
    const overallWeeklyAverage = sortedWeeks.length > 0 ? (totalWeeklySum / sortedWeeks.length) : 0;

    // Current (most recent) week
    const currentWeek = sortedWeeks[0] || { totalPoints: 0, daysLogged: 0, records: [] };

    return {
        overallWeeklyAverage: parseFloat(overallWeeklyAverage.toFixed(1)),
        totalWeeksCounted: sortedWeeks.length,
        currentWeekPoints: parseFloat(currentWeek.totalPoints.toFixed(1)),
        currentWeekMax: 50,
        currentWeekEntries: currentWeek.daysLogged,
        weeks: sortedWeeks.map(w => ({
            weekStartDate: w.weekStartDate,
            weeklyPoints: parseFloat(w.totalPoints.toFixed(1)),
            maxPoints: 50,
            daysLogged: w.daysLogged,
            records: w.records
        }))
    };
}

// Generate Apricot-Compatible Case Notes & Attendance Export (Excel or CSV)
function generateApricotCaseNotesExport(asExcel = true, locationFilter = null) {
    let query = `
        SELECT cn.id, cn.session_date, cn.note_type, cn.category, cn.content, cn.author_name,
               u.name as participant_name, u.email as participant_email, u.location, u.track
        FROM case_notes cn
        JOIN users u ON cn.user_id = u.id
    `;
    const params = [];
    if (locationFilter) {
        query += ` WHERE u.location = ?`;
        params.push(locationFilter);
    }
    query += ` ORDER BY cn.session_date DESC, cn.id DESC`;

    const notes = db.prepare(query).all(...params);

    const exportRows = [
        ['Participant Name', 'Email', 'Location', 'Program Track', 'Date of Contact', 'Contact Type', 'Category / Domain', 'Case Note Content', 'Staff / Author']
    ];

    notes.forEach(n => {
        exportRows.push([
            n.participant_name,
            n.participant_email,
            n.location,
            n.track === 'first_shift' ? 'First Shift' : 'Re-entry Navigation',
            n.session_date,
            n.note_type,
            n.category,
            n.content,
            n.author_name
        ]);
    });

    if (asExcel) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(exportRows);
        XLSX.utils.book_append_sheet(wb, ws, 'Apricot Case Notes');
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } else {
        return exportRows.map(row => 
            row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');
    }
}

// Helper: Normalize various date formats from Excel/CSV
function parseDateValue(val) {
    if (!val) return new Date().toISOString().split('T')[0];
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'number') {
        const parsed = new Date(Math.round((val - 25569) * 86400 * 1000));
        return !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : String(val);
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
        const [m, d, y] = str.split('/');
        const fullY = y.length === 2 ? '20' + y : y;
        return `${fullY}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return str;
}

// -------------------------------------------------------------
// DRUG TEST SPREADSHEET / CSV IMPORTER
// -------------------------------------------------------------
function importDrugTestData(input, isBuffer = false) {
    let rawRows = [];
    if (isBuffer || Buffer.isBuffer(input)) {
        try {
            const workbook = XLSX.read(input, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch(e) {
            return { success: false, error: 'Failed to parse Excel workbook: ' + e.message };
        }
    } else if (typeof input === 'string') {
        const lines = input.trim().split(/\r?\n/);
        rawRows = lines.map(l => l.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')));
    }

    if (!rawRows || rawRows.length < 2) {
        return { success: false, error: 'Spreadsheet or CSV is empty or missing data rows.' };
    }

    const rows = rawRows.slice(1);
    let importedCount = 0;
    let errors = [];

    const insertStmt = db.prepare(`
        INSERT INTO drug_tests (user_id, test_date, result, substances_detected, notes, administered_by)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const findUserStmt = db.prepare(`
        SELECT id, name FROM users WHERE role = 'participant' AND (LOWER(email) = ? OR LOWER(name) LIKE ?) LIMIT 1
    `);

    const tx = db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || cols.length < 2) continue;

            const identifier = String(cols[0] || '').trim().toLowerCase();
            if (!identifier) continue;

            const dateStr = parseDateValue(cols[1]);
            let result = String(cols[2] || 'negative').trim().toLowerCase();
            if (result.includes('neg') || result.includes('pass') || result.includes('clean')) result = 'negative';
            else if (result.includes('pos') || result.includes('fail')) result = 'positive';
            else if (result.includes('dil')) result = 'dilute';
            else if (result.includes('ref')) result = 'refused';

            const substances = String(cols[3] || '').trim();
            const notes = String(cols[4] || '').trim();
            const admin = String(cols[5] || 'Program Staff').trim();

            const user = findUserStmt.get(identifier, `%${identifier}%`);
            if (user) {
                insertStmt.run(user.id, dateStr, result, substances, notes, admin);
                importedCount++;
            } else {
                errors.push(`Row ${i + 2}: Participant not found for '${cols[0]}'`);
            }
        }
    });

    tx();
    return { success: true, importedCount, errors };
}

// -------------------------------------------------------------
// CASE MANAGEMENT LOGS / NOTES SPREADSHEET IMPORTER
// -------------------------------------------------------------
function importCaseManagementNotesData(input, isBuffer = false) {
    let rawRows = [];
    if (isBuffer || Buffer.isBuffer(input)) {
        try {
            const workbook = XLSX.read(input, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch(e) {
            return { success: false, error: 'Failed to parse Excel workbook: ' + e.message };
        }
    } else if (typeof input === 'string') {
        const lines = input.trim().split(/\r?\n/);
        rawRows = lines.map(l => l.split(',').map(c => c.trim().replace(/^["']|["']$/g, '')));
    }

    if (!rawRows || rawRows.length < 2) {
        return { success: false, error: 'Spreadsheet or CSV is empty or missing data rows.' };
    }

    const rows = rawRows.slice(1);
    let importedCount = 0;
    let errors = [];

    const insertStmt = db.prepare(`
        INSERT INTO case_notes (user_id, author_id, author_name, session_date, note_type, category, content)
        VALUES (?, 1, ?, ?, ?, ?, ?)
    `);

    const findUserStmt = db.prepare(`
        SELECT id, name FROM users WHERE role = 'participant' AND (LOWER(email) = ? OR LOWER(name) LIKE ?) LIMIT 1
    `);

    const tx = db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || cols.length < 3) continue;

            const identifier = String(cols[0] || '').trim().toLowerCase();
            if (!identifier) continue;

            const dateStr = parseDateValue(cols[1]);
            const category = String(cols[2] || 'Case Management').trim();
            const noteType = String(cols[3] || 'Individual Session').trim();
            const content = String(cols[4] || '').trim();
            const author = String(cols[5] || 'Program Manager').trim();

            if (!content) continue;

            const user = findUserStmt.get(identifier, `%${identifier}%`);
            if (user) {
                insertStmt.run(user.id, author, dateStr, noteType, category, content);
                importedCount++;
            } else {
                errors.push(`Row ${i + 2}: Participant not found for '${cols[0]}'`);
            }
        }
    });

    tx();
    return { success: true, importedCount, errors };
}

// -------------------------------------------------------------
// WEEKLY COMPLIANCE CALCULATOR (POINTS, DRUG TEST, CASE MGMT)
// -------------------------------------------------------------
function getWeeklyComplianceSummary(userId, refDate = null) {
    const d = refDate ? new Date(refDate + 'T12:00:00Z') : new Date();
    const dayOfWeek = d.getUTCDay(); // 0 = Sun, 1 = Mon ...
    const diffToMon = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() + diffToMon);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const monStr = monday.toISOString().split('T')[0];
    const sunStr = sunday.toISOString().split('T')[0];

    // 1. Points that week
    const pointsRows = db.prepare(`
        SELECT points_earned FROM daily_points
        WHERE user_id = ? AND date >= ? AND date <= ?
    `).all(userId, monStr, sunStr);
    const weekPoints = pointsRows.reduce((acc, r) => acc + (Number(r.points_earned) || 0), 0);

    // 2. Drug test that week
    const drugTest = db.prepare(`
        SELECT id, test_date, result, substances_detected, notes 
        FROM drug_tests
        WHERE user_id = ? AND test_date >= ? AND test_date <= ?
        ORDER BY test_date DESC LIMIT 1
    `).get(userId, monStr, sunStr);

    // 3. Case management session that week
    const caseNote = db.prepare(`
        SELECT id, session_date, category, note_type, content, author_name
        FROM case_notes
        WHERE user_id = ? AND session_date >= ? AND session_date <= ?
        ORDER BY session_date DESC LIMIT 1
    `).get(userId, monStr, sunStr);

    const totalNotesThisWeek = db.prepare(`
        SELECT COUNT(*) as count FROM case_notes
        WHERE user_id = ? AND session_date >= ? AND session_date <= ?
    `).get(userId, monStr, sunStr).count;

    return {
        weekStart: monStr,
        weekEnd: sunStr,
        weekPoints: parseFloat(weekPoints.toFixed(1)),
        hasDrugTest: !!drugTest,
        drugTest: drugTest || null,
        hasCaseManagement: !!caseNote,
        caseNote: caseNote || null,
        totalNotesThisWeek
    };
}

// -------------------------------------------------------------
// CASE MANAGEMENT VS. BRIEFCASE CROSS-CHECK AUDIT REPORT
// -------------------------------------------------------------
function generateCaseManagementBriefcaseAudit(userId) {
    const user = db.prepare('SELECT id, name, email, phone, location, track, created_at FROM users WHERE id = ?').get(userId);
    if (!user) return null;
    const profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(userId) || {};
    const notes = db.prepare('SELECT * FROM case_notes WHERE user_id = ? ORDER BY session_date DESC').all(userId);
    const briefcaseItems = db.prepare('SELECT * FROM briefcase_items WHERE user_id = ? ORDER BY id').all(userId);

    const allNotesText = notes.map(n => `${n.session_date} [${n.category}]: ${n.content}`).join('\n\n').toLowerCase();

    // Mapping of briefcase item keys to regex search patterns in case notes
    const itemPatterns = {
        'state_id': { label: 'State ID', regex: /(state id|dmv id|picture id|obtained id|got id|photo id)/i },
        'ss_card': { label: 'Social Security Card', regex: /(social security|ss card|ssn card|ss administration)/i },
        'birth_cert': { label: 'Birth Certificate', regex: /(birth cert|vital statistics|birth certificate)/i },
        'drivers_license': { label: "Driver's License / Route 66", regex: /(driver'?s license|route 66|license reinstat|scdmv|dl reinstat)/i },
        'reliable_phone': { label: 'Reliable Phone Number', regex: /(phone number|government phone|obama phone|cellular|cell phone)/i },
        'bank_account': { label: 'Bank Account', regex: /(bank account|checking account|us bank|direct deposit)/i },
        'child_support_status': { label: 'Child Support Review', regex: /(child support|dss|clerk of court|support payment|modification)/i },
        'transportation_plan': { label: 'Transportation Plan', regex: /(bus pass|carta|comet|transportation|riding bus|bus ticket)/i },
        'housing_plan': { label: 'Housing Plan / Stable Address', regex: /(housing|shelter|transitional|apartment|oxford house|lease)/i },
        'resume_completed': { label: 'Resume Completed', regex: /(resume|completed resume|drafted resume|updated resume)/i },
        'interview_clothing': { label: 'Interview Clothing', regex: /(interview cloth|suit|clothing voucher|dressed for success)/i },
        'health_insurance': { label: 'Health Insurance', regex: /(medicaid|health insurance|healthy connections)/i },
        'welvista_referral': { label: 'Welvista Referral', regex: /(welvista|free prescription|medication assist)/i },
        'primary_care_visit': { label: 'Primary Care Visit', regex: /(doctor visit|clinic visit|primary care|fetter)/i },
        'budget_worksheet': { label: 'Budget Worksheet', regex: /(budget worksheet|financial budget|spending plan)/i },
        'osha_10': { label: 'OSHA-10 Certification', regex: /(osha|osha 10|safety cert)/i },
        'forklift_cert': { label: 'Forklift Certification', regex: /(forklift|forklift cert)/i }
    };

    const verified = [];
    const discrepancies = []; // Mentioned in notes but still pending/red in briefcase
    const unaddressedBarriers = []; // Marked red in briefcase but never mentioned in notes

    briefcaseItems.forEach(item => {
        const pattern = itemPatterns[item.item_key];
        const isMentionedInNotes = pattern && pattern.regex.test(allNotesText);

        if (item.status === 'green') {
            if (isMentionedInNotes) {
                verified.push({
                    key: item.item_key,
                    title: item.title,
                    domain: item.domain,
                    notes: item.notes,
                    finding: 'Documented in case management notes and verified complete in Briefcase.'
                });
            }
        } else {
            // Item is pending or red
            if (isMentionedInNotes) {
                discrepancies.push({
                    key: item.item_key,
                    title: item.title,
                    domain: item.domain,
                    currentStatus: item.status,
                    notes: item.notes,
                    finding: `Mentioned in case notes as discussed or resolved, but briefcase item is currently marked ${item.status.toUpperCase()}. Needs review / status update.`
                });
            }
        }

        if (item.status === 'red' && !isMentionedInNotes) {
            unaddressedBarriers.push({
                key: item.item_key,
                title: item.title,
                domain: item.domain,
                finding: `Marked as an active BARRIER in the Briefcase, but no case management notes have addressed or documented resolution steps for this item.`
            });
        }
    });

    // Generate markdown feedback narrative
    let md = `# Case Management & Briefcase Alignment Audit: ${user.name}\n\n`;
    md += `**Participant:** ${user.name} | **Track:** ${user.track === 'reentry_nav' ? 'Re-entry Navigation' : 'First Shift'} | **Location:** ${user.location}, SC\n`;
    md += `**Audit Date:** ${new Date().toLocaleDateString()} | **Total Case Notes Evaluated:** ${notes.length} | **Briefcase Items Evaluated:** ${briefcaseItems.length}\n\n`;

    md += `### 1. Executive Compliance & Feedback Summary\n`;
    md += `- **Verified Milestones Aligned:** ${verified.length} items verified in both notes and briefcase checklist.\n`;
    md += `- **Actionable Discrepancies:** ${discrepancies.length} items referenced in notes that require briefcase status check-offs.\n`;
    md += `- **Unaddressed Priority Barriers:** ${unaddressedBarriers.length} active red barriers lacking documented case management action plans.\n\n`;

    if (discrepancies.length > 0) {
        md += `### 2. Discrepancies Requiring Briefcase Updates\n`;
        discrepancies.forEach(d => {
            md += `- ⚠️ **${d.title}** (${d.domain.replace(/_/g, ' ').toUpperCase()}): ${d.finding}\n`;
        });
        md += `\n`;
    }

    if (unaddressedBarriers.length > 0) {
        md += `### 3. Unaddressed Briefcase Barriers\n`;
        unaddressedBarriers.forEach(u => {
            md += `- 🔴 **${u.title}** (${u.domain.replace(/_/g, ' ').toUpperCase()}): ${u.finding}\n`;
        });
        md += `\n`;
    }

    md += `### 4. Recommended Case Management Actions\n`;
    if (discrepancies.length > 0) {
        md += `1. Review recent case notes and update verified briefcase items to **GREEN**.\n`;
    }
    if (unaddressedBarriers.length > 0) {
        md += `2. Schedule an individual session to target unaddressed red barriers (${unaddressedBarriers.map(u => u.title).slice(0, 3).join(', ')}).\n`;
    }
    md += `3. Continue weekly documentation of stability, CBT tool application, and employer contact.\n`;

    // Persist audit record in cm_briefcase_audits
    try {
        db.prepare(`
            INSERT INTO cm_briefcase_audits (user_id, audit_date, discrepancies_json, verified_json, unaddressed_json, feedback_markdown)
            VALUES (?, DATE('now'), ?, ?, ?, ?)
        `).run(
            user.id,
            JSON.stringify(discrepancies),
            JSON.stringify(verified),
            JSON.stringify(unaddressedBarriers),
            md
        );
    } catch(e) {}

    const completedBriefcaseCount = briefcaseItems.filter(i => i.status === 'green').length;
    const totalBriefcaseItems = briefcaseItems.length;
    const briefcaseCompletionRate = totalBriefcaseItems > 0 ? Math.round((completedBriefcaseCount / totalBriefcaseItems) * 100) : 0;

    return {
        userId: user.id,
        participantName: user.name,
        auditDate: new Date().toISOString().split('T')[0],
        totalNotesCount: notes.length,
        summary: {
            completedBriefcaseCount,
            totalBriefcaseItems,
            briefcaseCompletionRate,
            verifiedCount: verified.length,
            discrepanciesCount: discrepancies.length,
            unaddressedCount: unaddressedBarriers.length
        },
        verified,
        discrepancies,
        unaddressedBarriers,
        feedbackMarkdown: md
    };
}

module.exports = {
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
};
