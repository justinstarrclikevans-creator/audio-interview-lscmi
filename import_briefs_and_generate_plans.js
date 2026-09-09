// Batch Import First Shift Briefs & Generate Case Plans
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { generateReentryNavAssessment } = require('./reentry_engine');
const { convertSingleMdToPdf } = require('./convert_md_to_pdf');
const { convertSingleMdToDocx } = require('./convert_md_to_docx');
const pdfParse = require('pdf-parse');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', 'email-settings.txt') });
if (!process.env.GEMINI_API_KEY && fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const dbPath = path.join(__dirname, 'data', 'app_database.sqlite');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
        const buffer = fs.readFileSync(filePath);
        if (typeof pdfParse === 'function') {
            const res = await pdfParse(buffer);
            return res.text || '';
        } else if (pdfParse && pdfParse.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: buffer });
            const res = await parser.getText();
            return res.text || '';
        }
    } else if (ext === '.txt' || ext === '.md') {
        return fs.readFileSync(filePath, 'utf8');
    }
    return '';
}

function findMatchingParticipant(db, filename, text) {
    const participants = db.prepare("SELECT id, name, location, track FROM users WHERE role = 'participant'").all();
    
    // Split camelCase and non-alphanumeric
    const cleanFilename = filename.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const filenameWords = cleanFilename.split(/\s+/).filter(Boolean);
    const textLower = (text || '').toLowerCase();
    const headerSnippet = textLower.substring(0, 3500);

    // 1. Both first and last in filename words
    for (const p of participants) {
        const parts = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
        const first = parts[0];
        const last = parts[parts.length - 1];
        if (filenameWords.includes(first) && filenameWords.includes(last)) return p;
    }

    // 2. Both first and last in text header
    for (const p of participants) {
        const parts = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
        const first = parts[0];
        const last = parts[parts.length - 1];
        if (headerSnippet.includes(first) && headerSnippet.includes(last)) return p;
    }

    // 3. Known aliases (Christopher -> Chris, etc.)
    const aliases = {
        'christopher': 'chris',
        'chris': 'christopher'
    };
    for (const p of participants) {
        const parts = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
        const first = parts[0];
        const last = parts[parts.length - 1];
        const altFirst = aliases[first];
        if ((filenameWords.includes(first) || (altFirst && filenameWords.includes(altFirst))) && 
            (filenameWords.includes(last) || headerSnippet.includes(last))) {
            return p;
        }
    }

    // 4. Unique first name match in filename
    for (const p of participants) {
        const parts = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
        const first = parts[0];
        if (filenameWords.includes(first)) {
            const matchCount = participants.filter(x => x.name.toLowerCase().split(/\s+/)[0] === first).length;
            if (matchCount === 1) return p;
        }
    }

    // 5. Unique last name match in filename or text
    for (const p of participants) {
        const parts = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(Boolean);
        for (const pt of parts) {
            if (pt.length > 3 && (filenameWords.includes(pt) || headerSnippet.includes(pt))) {
                const matchCount = participants.filter(x => x.name.toLowerCase().includes(pt)).length;
                if (matchCount === 1) return p;
            }
        }
    }

    return null;
}

async function processBriefsFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        console.error(`Folder not found: ${folderPath}`);
        return;
    }

    const db = new Database(dbPath);
    const files = fs.readdirSync(folderPath).filter(f => !f.startsWith('.'));
    console.log(`\n======================================================`);
    console.log(`Found ${files.length} file(s) in: ${folderPath}`);
    console.log(`======================================================\n`);

    let matchedCount = 0;
    let createdCount = 0;

    for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        console.log(`\nProcessing file: "${file}"...`);
        let text = '';
        try {
            text = await extractTextFromFile(filePath);
        } catch (err) {
            console.error(`  [!] Failed to extract text from ${file}:`, err.message);
            continue;
        }

        if (!text || text.trim().length === 0) {
            console.warn(`  [!] File contains no readable text: ${file}`);
            continue;
        }

        const participant = findMatchingParticipant(db, file, text);
        if (!participant) {
            console.warn(`  [?] Could not match file "${file}" to any participant in the database.`);
            continue;
        }

        matchedCount++;
        console.log(`  [✓] Matched to Participant: ${participant.name} (ID: ${participant.id}, ${participant.location})`);

        // 1. Copy source brief to data directory and record in documents table
        const timestamp = Date.now();
        const safeName = participant.name.replace(/[^a-zA-Z0-9]/g, '_');
        const ext = path.extname(file);
        const storedDocFilename = `${safeName}_Case_Brief_${timestamp}${ext}`;
        const storedDocPath = path.join(dataDir, storedDocFilename);
        fs.copyFileSync(filePath, storedDocPath);

        const docUrl = `/data/${storedDocFilename}`;
        const docStat = fs.statSync(storedDocPath);
        try {
            db.prepare(`
                INSERT INTO documents (user_id, doc_type, title, filename, file_path, file_size, status, metadata_json, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
            `).run(participant.id, 'case_brief', `Case Brief - ${participant.name}`, storedDocFilename, docUrl, docStat.size, JSON.stringify({ originalName: file }));
            console.log(`  [✓] Attached source document "${file}" to ${participant.name}'s file.`);
        } catch (e) {
            console.warn(`  [!] Could not save document record:`, e.message);
        }

        // 2. Generate Case Plan via Reentry Engine
        console.log(`  [...] Generating Case Plan and Participant Action Guide for ${participant.name}...`);
        try {
            const assessmentData = {
                participantName: participant.name,
                location: participant.location || 'Charleston',
                interviewTranscript: text,
                statedGoals: 'First Shift graduation, prosocial stabilization, career placement',
                identifiedNeeds: ['Prosocial Modeling', 'Workplace Stabilization'],
                livingSituation: 'Transitional / Community Housing',
                legalStatus: 'Active Community Supervision'
            };

            const result = await generateReentryNavAssessment(assessmentData);

            const filePrefix = `${timestamp}_${safeName}_reentry`;
            const staffPlanPath = path.join(dataDir, `${filePrefix}_staff_case_plan.md`);
            const participantGuidePath = path.join(dataDir, `${filePrefix}_participant_action_guide.md`);
            const jsonResultPath = path.join(dataDir, `${filePrefix}_assessment_data.json`);

            fs.writeFileSync(staffPlanPath, result.navigator_case_plan_md);
            fs.writeFileSync(participantGuidePath, result.participant_guide_md);
            fs.writeFileSync(jsonResultPath, JSON.stringify({ ...result, assessmentData }, null, 2));

            const staffPdfPath = path.join(dataDir, `${filePrefix}_staff_case_plan.pdf`);
            const partPdfPath = path.join(dataDir, `${filePrefix}_participant_action_guide.pdf`);
            const staffDocxPath = path.join(dataDir, `${filePrefix}_staff_case_plan.docx`);
            const partDocxPath = path.join(dataDir, `${filePrefix}_participant_action_guide.docx`);

            convertSingleMdToPdf(staffPlanPath, staffPdfPath);
            convertSingleMdToPdf(participantGuidePath, partPdfPath);
            await convertSingleMdToDocx(staffPlanPath, staffDocxPath);
            await convertSingleMdToDocx(participantGuidePath, partDocxPath);

            const staffDocxUrl = `/data/${filePrefix}_staff_case_plan.docx`;
            const staffPdfUrl = `/data/${filePrefix}_staff_case_plan.pdf`;
            const partDocxUrl = `/data/${filePrefix}_participant_action_guide.docx`;
            const partPdfUrl = `/data/${filePrefix}_participant_action_guide.pdf`;

            // Upsert into reentry_case_plans
            const existingPlan = db.prepare('SELECT id FROM reentry_case_plans WHERE user_id = ?').get(participant.id);
            if (existingPlan) {
                db.prepare(`
                    UPDATE reentry_case_plans SET
                        participant_name = ?,
                        location = ?,
                        stability_status = ?,
                        stated_goals = ?,
                        identified_needs = ?,
                        living_situation = ?,
                        legal_status = ?,
                        detected_flags = ?,
                        top_criminogenic_domains = ?,
                        staff_case_plan_md = ?,
                        participant_guide_md = ?,
                        recommended_referrals = ?,
                        matched_employers = ?,
                        staff_plan_docx = ?,
                        staff_plan_pdf = ?,
                        participant_guide_docx = ?,
                        participant_guide_pdf = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ?
                `).run(
                    participant.name, participant.location || 'Charleston', result.stability_status || 'stable',
                    assessmentData.statedGoals, JSON.stringify(assessmentData.identifiedNeeds), assessmentData.livingSituation, assessmentData.legalStatus,
                    JSON.stringify(result.detected_flags || []), JSON.stringify(result.top_criminogenic_domains || []),
                    result.navigator_case_plan_md, result.participant_guide_md,
                    JSON.stringify(result.recommended_referrals || []), JSON.stringify(result.matched_employers || []),
                    staffDocxUrl, staffPdfUrl, partDocxUrl, partPdfUrl,
                    participant.id
                );
            } else {
                db.prepare(`
                    INSERT INTO reentry_case_plans (
                        user_id, participant_name, location, stability_status,
                        stated_goals, identified_needs, living_situation, legal_status,
                        detected_flags, top_criminogenic_domains, staff_case_plan_md, participant_guide_md,
                        recommended_referrals, matched_employers, staff_plan_docx, staff_plan_pdf,
                        participant_guide_docx, participant_guide_pdf
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    participant.id, participant.name, participant.location || 'Charleston', result.stability_status || 'stable',
                    assessmentData.statedGoals, JSON.stringify(assessmentData.identifiedNeeds), assessmentData.livingSituation, assessmentData.legalStatus,
                    JSON.stringify(result.detected_flags || []), JSON.stringify(result.top_criminogenic_domains || []),
                    result.navigator_case_plan_md, result.participant_guide_md,
                    JSON.stringify(result.recommended_referrals || []), JSON.stringify(result.matched_employers || []),
                    staffDocxUrl, staffPdfUrl, partDocxUrl, partPdfUrl
                );
            }

            // Update participant profile
            db.prepare(`
                UPDATE participant_profiles SET
                    reentry_status = ?,
                    has_reentry_plan = 1,
                    stability_red_flags = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            `).run(result.stability_status || 'stable', JSON.stringify(result.detected_flags || []), participant.id);

            // Mark Gate 1 w1_interview as green
            try {
                db.prepare(`
                    UPDATE gate_criteria 
                    SET status = 'green', pm_notes = 'Completed via imported Case Brief', updated_at = CURRENT_TIMESTAMP 
                    WHERE user_id = ? AND criterion_key = 'w1_interview'
                `).run(participant.id);
                console.log(`  [✓] Marked Gate 1 Assessment Interview as green for ${participant.name}`);
            } catch (e) {
                console.warn(`  [!] Could not update gate_criteria:`, e.message);
            }

            createdCount++;
            console.log(`  [✓] Successfully created Case Plan & Action Guide for ${participant.name}!`);
        } catch (err) {
            console.error(`  [!] Case plan generation error for ${participant.name}:`, err.message);
        }
    }

    console.log(`\n======================================================`);
    console.log(`Batch Import Complete!`);
    console.log(`Files Processed: ${files.length}`);
    console.log(`Participants Matched: ${matchedCount}`);
    console.log(`Case Plans Generated: ${createdCount}`);
    console.log(`======================================================\n`);
}

// Support CLI argument: node import_briefs_and_generate_plans.js /path/to/folder
const targetFolder = process.argv[2] || path.join('/Users/justinevans/Desktop', 'FirstShiftBriefs');
processBriefsFolder(targetFolder).then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error during batch import:', err);
    process.exit(1);
});
