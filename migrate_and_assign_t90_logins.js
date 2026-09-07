/**
 * migrate_and_assign_t90_logins.js
 * 
 * 1. Fetches all valid participants from Briefcase app Supabase.
 * 2. Deduplicates participants properly by name.
 * 3. Assigns each participant:
 *    - Email: firstnamelastname@t90.com (e.g. jenniferjeanquart@t90.com, clydewilliams@t90.com, dillonjohnson@t90.com)
 *    - Password: "3765Turn90" (hashed with bcrypt)
 *    - Role: "participant"
 *    - Track: "first_shift"
 *    - Location: participant's center (Charleston, Columbia, Spartanburg)
 * 4. Syncs all completed Briefcase items, resumes, barrier statuses, and gate criteria.
 */

const https = require('https');
const bcrypt = require('bcryptjs');
const { db, initParticipantBriefcase } = require('./db.js');

const SUPABASE_URL = 'https://koapktcdquynxmooaoqa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_dYVdJG5p6wNu4Ivj07YmhQ_cX8Psukf';

function fetchSupabaseParticipants() {
    return new Promise((resolve, reject) => {
        const url = `${SUPABASE_URL}/rest/v1/participants?select=*`;
        https.get(url, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const list = JSON.parse(data);
                    resolve(list);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function normalizeTitleCase(str) {
    if (!str) return '';
    return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function generateT90Email(firstName, lastName) {
    const cleanFirst = (firstName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanLast = (lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${cleanFirst}${cleanLast}@t90.com`;
}

async function run() {
    console.log('🔄 Fetching participants from Supabase...');
    const rawList = await fetchSupabaseParticipants();
    
    // Filter out system configs
    const validRows = rawList.filter(p => {
        if (!p.first_name) return false;
        if (p.id === '_GLOBAL_SETTINGS_' || p.first_name.includes('_GLOBAL_SETTINGS_')) return false;
        if (p.location === 'System') return false;
        return true;
    });

    console.log(`📋 Found ${validRows.length} valid participant records from Supabase.`);

    // Deduplicate & deep merge strictly by normalized person name
    const mergedMap = new Map();

    for (const row of validRows) {
        let first = (row.first_name || '').trim();
        let last = (row.last_name || '').trim();

        // Typo correction
        if (first.toLowerCase() === 'andresd') first = 'Andres';

        const fullName = `${normalizeTitleCase(first)} ${normalizeTitleCase(last)}`.trim();
        const key = fullName.toLowerCase();

        if (!mergedMap.has(key)) {
            mergedMap.set(key, {
                fullName,
                firstName: normalizeTitleCase(first),
                lastName: normalizeTitleCase(last),
                location: row.location || 'Charleston',
                phone: row.phone || '',
                supabaseId: row.id,
                stateData: row.state_data || {}
            });
        } else {
            // Merge state data
            const existing = mergedMap.get(key);
            console.log(`   Merging duplicate entry for: ${fullName}`);
            const curState = row.state_data || {};
            const exState = existing.stateData;

            const mergedCs = Object.assign({}, exState.coreStability || {}, curState.coreStability || {});
            for (const [k, v] of Object.entries(curState.coreStability || {})) {
                if (v === true || (typeof v === 'string' && v.trim().length > 0)) {
                    mergedCs[k] = v;
                }
            }

            const mergedEr = Object.assign({}, exState.employmentReadiness || {}, curState.employmentReadiness || {});
            if (curState.employmentReadiness?.resumeData && Object.keys(curState.employmentReadiness.resumeData).length > 0) {
                mergedEr.resumeData = curState.employmentReadiness.resumeData;
            }

            const mergedCp = Object.assign({}, exState.careerPlanning || {}, curState.careerPlanning || {});
            for (const [k, v] of Object.entries(curState.careerPlanning || {})) {
                if (v && typeof v === 'string' && v.trim().length > 0) {
                    mergedCp[k] = v;
                }
            }

            const mergedFin = Object.assign({}, exState.financial || {}, curState.financial || {});
            if (curState.financial?.budgetData && Object.keys(curState.financial.budgetData).length > 0) {
                mergedFin.budgetData = curState.financial.budgetData;
            }

            const mergedWo = Object.assign({}, exState.wo_progress || {}, curState.wo_progress || {});

            existing.stateData = {
                ...exState,
                ...curState,
                coreStability: mergedCs,
                employmentReadiness: mergedEr,
                careerPlanning: mergedCp,
                financial: mergedFin,
                wo_progress: mergedWo
            };

            if (!existing.phone && row.phone) existing.phone = row.phone;
        }
    }

    console.log(`✨ Total unique individuals to configure: ${mergedMap.size}`);

    const passwordPlain = '3765Turn90';
    const passwordHash = bcrypt.hashSync(passwordPlain, 10);

    const logList = [];

    const tx = db.transaction(() => {
        for (const [key, p] of mergedMap.entries()) {
            const s = p.stateData || {};
            const cs = s.coreStability || {};
            const er = s.employmentReadiness || {};
            const fin = s.financial || {};
            const cp = s.careerPlanning || {};
            const wo = s.wo_progress || {};

            const t90Email = generateT90Email(p.firstName, p.lastName);
            const phone = p.phone || er.resumeData?.phone || '';

            // Match existing user by exact fullName
            let user = db.prepare('SELECT * FROM users WHERE LOWER(name) = ?').get(p.fullName.toLowerCase());

            let userId;
            if (user) {
                userId = user.id;
                db.prepare(`
                    UPDATE users SET
                        email = ?,
                        password_hash = ?,
                        phone = COALESCE(NULLIF(?, ''), phone),
                        location = ?,
                        track = 'first_shift',
                        role = 'participant'
                    WHERE id = ?
                `).run(t90Email, passwordHash, phone, p.location, userId);
            } else {
                // If not found by name, check if email is already there
                const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(t90Email);
                if (existingEmail) {
                    userId = existingEmail.id;
                    db.prepare(`
                        UPDATE users SET
                            name = ?,
                            password_hash = ?,
                            phone = ?,
                            location = ?,
                            track = 'first_shift',
                            role = 'participant'
                        WHERE id = ?
                    `).run(p.fullName, passwordHash, phone, p.location, userId);
                } else {
                    const res = db.prepare(`
                        INSERT INTO users (name, email, phone, password_hash, role, track, location)
                        VALUES (?, ?, ?, ?, 'participant', 'first_shift', ?)
                    `).run(p.fullName, t90Email, phone, passwordHash, p.location);
                    userId = res.lastInsertRowid;
                }
            }

            logList.push({
                id: userId,
                name: p.fullName,
                email: t90Email,
                location: p.location,
                password: passwordPlain
            });

            // Ensure profile exists
            let profile = db.prepare('SELECT * FROM participant_profiles WHERE user_id = ?').get(userId);
            if (!profile) {
                db.prepare(`
                    INSERT INTO participant_profiles (user_id, current_gate, overall_status)
                    VALUES (?, 1, 'active')
                `).run(userId);
            }

            initParticipantBriefcase(userId);

            // Barrier mappings
            const dlStatus = cs.driversLicense === true ? 'valid' : (cs.transportationPlan ? 'suspended' : 'unknown');
            const dlNotes = cs.transportationPlan || '';
            const csStatus = (cs.legalRequirements?.childSupport === true || fin.childSupportReviewed === true) ? 'active_case' : 'none';
            const csNotes = cs.childSupportContact ? 'Child support contact/enforcement reviewed' : '';
            const housingStatus = (cs.housingPlan && cs.housingPlan.length > 5) ? 'stable' : 'transitional';
            const transportStatus = cs.transportationPlan ? (cs.transportationPlan.toLowerCase().includes('bus') ? 'CARTA Bus Line' : 'Personal Vehicle / Ride') : 'bus';

            db.prepare(`
                UPDATE participant_profiles SET
                    dl_status = ?,
                    dl_notes = ?,
                    child_support_status = ?,
                    child_support_notes = ?,
                    housing_status = ?,
                    transportation_status = ?,
                    overall_status = 'active',
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            `).run(dlStatus, dlNotes, csStatus, csNotes, housingStatus, transportStatus, userId);

            // Populate Briefcase Items
            const updateBriefcase = db.prepare(`
                UPDATE briefcase_items SET
                    status = ?,
                    notes = COALESCE(?, notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND item_key = ?
            `);

            // Core Stability
            if (cs.stateId === true) updateBriefcase.run('green', 'State ID verified', userId, 'state_id');
            if (cs.ssnCard === true) updateBriefcase.run('green', 'Social Security card on file', userId, 'ss_card');
            if (cs.birthCertificate === true) updateBriefcase.run('green', 'Birth certificate on file', userId, 'birth_cert');
            if (cs.driversLicense === true) updateBriefcase.run('green', 'Valid Driver\'s License', userId, 'drivers_license');
            if (cs.reliablePhone === true) updateBriefcase.run('green', 'Reliable phone operational', userId, 'reliable_phone');
            if (cs.professionalEmail === true) updateBriefcase.run('green', `Email: ${t90Email}`, userId, 'prof_email');
            if (cs.libraryCard === true) updateBriefcase.run('green', 'Library card issued', userId, 'library_card');
            if (cs.bankAccount === true) updateBriefcase.run('green', 'Bank account active', userId, 'bank_account');
            if (cs.childSupportContact === true || fin.childSupportReviewed === true) updateBriefcase.run('green', 'Child support reviewed', userId, 'child_support_status');
            if (cs.transportationPlan) updateBriefcase.run('green', cs.transportationPlan, userId, 'transportation_plan');
            if (cs.housingPlan) updateBriefcase.run('green', cs.housingPlan, userId, 'housing_plan');

            // Employment Readiness
            if (er.careerInterest) updateBriefcase.run('green', `Interest: ${er.careerInterest}`, userId, 'career_interest');
            updateBriefcase.run('green', `Email: ${t90Email}`, userId, 'prof_email_created');
            if (er.resumeCompleted === true || (er.resumeData && Object.keys(er.resumeData).length > 0)) {
                updateBriefcase.run('green', 'Master resume completed', userId, 'resume_completed');
            }
            if (er.workplaceReferences === true) updateBriefcase.run('green', 'References identified', userId, 'workplace_references');
            if (er.interviewPractice === true) updateBriefcase.run('green', 'Interview practice completed', userId, 'interview_practice');
            if (er.interviewClothing === true) updateBriefcase.run('green', 'Interview attire prepared', userId, 'interview_clothing');
            if (er.workTools === true) updateBriefcase.run('green', 'Boots and work gear verified', userId, 'work_tools_clothing');

            // Health & Wellness
            const hw = s.healthWellness || {};
            if (hw.healthInsurance === true) updateBriefcase.run('green', 'Health insurance active', userId, 'health_insurance');
            if (hw.welvistaReferral === true) updateBriefcase.run('green', 'Welvista referral complete', userId, 'welvista_referral');
            if (hw.primaryCare === true) updateBriefcase.run('green', 'Primary care visit documented', userId, 'primary_care_visit');
            if (hw.visionAppointment === true) updateBriefcase.run('green', 'Vision appointment completed', userId, 'vision_appointment');
            if (hw.prescriptionNeeds === true) updateBriefcase.run('green', 'Prescription needs reviewed', userId, 'prescription_needs');
            if (hw.mentalHealthReferral === true) updateBriefcase.run('green', 'Mental health referral active', userId, 'mental_health_referral');
            if (hw.substanceRecovery === true) updateBriefcase.run('green', 'Substance recovery plan active', userId, 'substance_recovery_plan');

            // Financial
            if (fin.bankAccountOpened === true) updateBriefcase.run('green', 'Direct deposit bank account open', userId, 'bank_account_opened');
            if (fin.budgetWorksheetCompleted === true || (fin.budgetData && fin.budgetData.incomeJob > 0)) {
                const bNotes = fin.budgetData ? `Monthly Income: $${fin.budgetData.incomeJob || 0}` : 'Budget complete';
                updateBriefcase.run('green', bNotes, userId, 'budget_worksheet');
            }
            if (fin.understandingPaychecks === true) updateBriefcase.run('green', 'Paycheck deductions & taxes reviewed', userId, 'paycheck_taxes_understanding');
            if (fin.savingsGoal === true) updateBriefcase.run('green', 'Savings plan established', userId, 'savings_goal');
            if (fin.creditReport === true) updateBriefcase.run('green', 'Credit report checked', userId, 'credit_report');
            if (fin.childSupportReviewed === true) updateBriefcase.run('green', 'Child support orders reviewed', userId, 'child_support_questions');
            if (fin.probationObligations === true) updateBriefcase.run('green', 'Probation / court fees reviewed', userId, 'probation_obligations');

            // Career Planning
            if (cp.careerGoal) updateBriefcase.run('green', cp.careerGoal, userId, 'career_goal');
            if (cp.targetIndustry) updateBriefcase.run('green', cp.targetIndustry, userId, 'target_industry');
            if (cp.entryLevelJob) updateBriefcase.run('green', cp.entryLevelJob, userId, 'entry_job_goal');
            if (cp.nextCredential) updateBriefcase.run('green', cp.nextCredential, userId, 'next_credential_goal');
            if (cp.sixMonthGoal) updateBriefcase.run('green', cp.sixMonthGoal, userId, 'six_month_goal');
            if (cp.longTermWageGoal) updateBriefcase.run('green', cp.longTermWageGoal, userId, 'long_term_wage_goal');

            // Credentials
            const training = s.training || {};
            const woCount = Object.keys(wo).length;
            if (training.osha10External === true) updateBriefcase.run('green', 'OSHA-10 card verified', userId, 'osha_10');
            if (training.forkliftExternal === true) updateBriefcase.run('green', 'Forklift certification verified', userId, 'forklift_cert');
            if (woCount > 0) {
                updateBriefcase.run('green', `${woCount} trades workorders completed in Briefcase app`, userId, 'general_construction');
            }

            // Save Resume
            if (er.resumeData && (er.resumeData.skills || er.resumeData.summary || er.resumeData.experience || (er.resumeData.jobs && er.resumeData.jobs.length > 0))) {
                db.prepare(`
                    INSERT INTO resumes (user_id, resume_data_json)
                    VALUES (?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        resume_data_json = excluded.resume_data_json,
                        updated_at = CURRENT_TIMESTAMP
                `).run(userId, JSON.stringify(er.resumeData));

                db.prepare(`
                    UPDATE gate_criteria SET status = 'green', pm_notes = 'Master resume on file'
                    WHERE user_id = ? AND criterion_key = 'w3_resume_approved'
                `).run(userId);
            }

            // Gate criteria
            const updateGate = db.prepare(`
                UPDATE gate_criteria SET
                    status = ?,
                    pm_notes = COALESCE(?, pm_notes),
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND criterion_key = ?
            `);

            if (cs.stateId === true || cs.ssnCard === true || cs.birthCertificate === true) {
                updateGate.run('green', 'Identification on file', userId, 'w1_w9_id');
                db.prepare(`UPDATE participant_profiles SET w9_status = 'verified' WHERE user_id = ?`).run(userId);
            }

            if (cp.careerGoal || cp.sixMonthGoal || cs.professionalEmail === true) {
                updateGate.run('green', cp.careerGoal || '90-day goal established', userId, 'w1_goal_email');
            }

            if (cs.driversLicense === true || cs.transportationPlan) {
                updateGate.run('green', cs.transportationPlan || 'Driver\'s license verified', userId, 'w2_dl_cs_plan');
            }

            if (fin.bankAccountOpened === true || cs.bankAccount === true) {
                updateGate.run('green', 'Bank account verified for direct deposit', userId, 'w4_bank_direct_deposit');
            }

            if (er.workTools === true) {
                updateGate.run('green', 'Work boots & attire confirmed', userId, 'w4_work_gear');
            }

            // Calculate current gate
            let currentGate = 1;
            const g1Green = db.prepare("SELECT COUNT(*) as c FROM gate_criteria WHERE user_id = ? AND week_number = 1 AND status = 'green'").get(userId).c;
            const g2Green = db.prepare("SELECT COUNT(*) as c FROM gate_criteria WHERE user_id = ? AND week_number = 2 AND status = 'green'").get(userId).c;
            const g3Green = db.prepare("SELECT COUNT(*) as c FROM gate_criteria WHERE user_id = ? AND week_number = 3 AND status = 'green'").get(userId).c;

            if (g1Green >= 2) currentGate = 2;
            if (g2Green >= 2) currentGate = 3;
            if (g3Green >= 1) currentGate = 4;

            db.prepare('UPDATE participant_profiles SET current_gate = ? WHERE user_id = ?').run(currentGate, userId);
        }
    });

    tx();

    console.log('✅ Successfully assigned all participants firstnamelastname@t90.com logins and 3765Turn90 password!\n');
    console.table(logList);
}

run().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
