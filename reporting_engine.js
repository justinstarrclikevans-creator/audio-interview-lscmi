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

module.exports = {
    generateMondayNeedsReport,
    generateFridayMilestoneReport,
    importApricotCsv,
    importApricotData
};
