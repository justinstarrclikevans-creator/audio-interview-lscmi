// Automated Reporting Engine for Program Managers
// - Monday Participant Needs Report
// - Friday Milestone & Termination Report
// - Apricot Points CSV Parser & Sync

const { db } = require('./db');

function generateMondayNeedsReport(locationFilter = null) {
    let query = `
        SELECT u.id, u.name, u.email, u.phone, u.location, u.track,
               p.current_gate, p.w9_status, p.dl_status, p.dl_notes,
               p.child_support_status, p.child_support_notes, p.housing_status,
               p.transportation_status, p.substance_status, p.court_dates, p.overall_status
        FROM users u
        LEFT JOIN participant_profiles p ON u.id = p.user_id
        WHERE u.role = 'participant' AND (p.overall_status IS NULL OR p.overall_status = 'active')
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
        needsBreakdown: {
            driversLicenseIssues: 0,
            childSupportIssues: 0,
            housingAtRisk: 0,
            w9Pending: 0,
            transportationBarriers: 0
        },
        participants: []
    };

    participants.forEach(p => {
        const issues = [];
        if (p.dl_status === 'suspended' || p.dl_status === 'reinstatement_plan') {
            reportData.needsBreakdown.driversLicenseIssues++;
            issues.push(`Driver's License: ${p.dl_status} (${p.dl_notes || 'No notes'})`);
        }
        if (p.child_support_status === 'behind' || p.child_support_status === 'modification_needed') {
            reportData.needsBreakdown.childSupportIssues++;
            issues.push(`Child Support: ${p.child_support_status} (${p.child_support_notes || 'Action needed'})`);
        }
        if (p.housing_status === 'at_risk' || p.housing_status === 'shelter') {
            reportData.needsBreakdown.housingAtRisk++;
            issues.push(`Housing: ${p.housing_status}`);
        }
        if (p.w9_status !== 'verified') {
            reportData.needsBreakdown.w9Pending++;
            issues.push(`W-9: ${p.w9_status || 'Missing'}`);
        }
        if (p.transportation_status === 'none' || p.transportation_status === 'needs_ride') {
            reportData.needsBreakdown.transportationBarriers++;
            issues.push(`Transportation: ${p.transportation_status}`);
        }

        reportData.participants.push({
            id: p.id,
            name: p.name,
            phone: p.phone,
            email: p.email,
            location: p.location,
            track: p.track,
            currentGate: p.current_gate || 1,
            activeIssues: issues,
            courtDates: p.court_dates || 'None listed',
            urgentAttentionNeeded: issues.length >= 2
        });
    });

    return reportData;
}

function generateFridayMilestoneReport(locationFilter = null) {
    let query = `
        SELECT u.id, u.name, u.location, u.track,
               p.current_gate, p.overall_status, p.termination_reason, p.termination_date,
               (SELECT COUNT(*) FROM gate_criteria gc WHERE gc.user_id = u.id AND gc.status = 'green') as green_criteria_count,
               (SELECT COUNT(*) FROM gate_criteria gc WHERE gc.user_id = u.id AND gc.status = 'red') as red_criteria_count,
               (SELECT AVG(points_earned) FROM daily_points dp WHERE dp.user_id = u.id) as avg_points
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
        graduatingCount: 0,
        atRiskCount: 0,
        terminatedCount: 0,
        activeCount: 0,
        roster: []
    };

    records.forEach(r => {
        let statusTag = 'On Track';
        if (r.overall_status === 'terminated') {
            reportData.terminatedCount++;
            statusTag = 'Terminated';
        } else if (r.overall_status === 'completed' || (r.current_gate === 4 && r.green_criteria_count >= 14)) {
            reportData.graduatingCount++;
            statusTag = 'Ready for Job Placement';
        } else if (r.red_criteria_count > 0 || (r.avg_points !== null && r.avg_points < 7.5)) {
            reportData.atRiskCount++;
            statusTag = 'At-Risk (Red Criteria / Low Points)';
        } else {
            reportData.activeCount++;
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
            statusTag: statusTag,
            terminationReason: r.termination_reason || null,
            terminationDate: r.termination_date || null
        });
    });

    return reportData;
}

// Parse Apricot Points CSV and update database
function importApricotCsv(csvContent) {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 2) return { success: false, error: 'CSV is empty or missing headers.' };

    const header = lines[0].toLowerCase();
    const rows = lines.slice(1);
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
            const cols = rows[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            if (cols.length < 3) continue;

            // Expecting formats like: Name/Email, Date, Points, Status, Notes
            const identifier = cols[0].toLowerCase();
            const dateStr = cols[1];
            const points = parseFloat(cols[2]) || 0;
            const status = (cols[3] || 'present').toLowerCase();
            const notes = cols[4] || '';

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

module.exports = {
    generateMondayNeedsReport,
    generateFridayMilestoneReport,
    importApricotCsv
};
