const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const db = require('./db').db;
const path = require('path');
const fs = require('fs');

function computeDeterministicCmScore(evaluation) {
    if (!evaluation || !evaluation.scores || typeof evaluation.scores !== 'object') {
        return Number(evaluation?.total_cm_score);
    }
    const vals = Object.values(evaluation.scores)
        .map(v => Number(v))
        .filter(v => !isNaN(v) && v >= 0 && v <= 5);
    if (vals.length === 0) return Number(evaluation.total_cm_score);

    const avgOutOf5 = vals.reduce((a, b) => a + b, 0) / vals.length;
    const calculatedOutOf100 = Math.round(avgOutOf5 * 20 * 10) / 10;
    const rawTotal = Number(evaluation.total_cm_score);

    if (isNaN(rawTotal) || rawTotal <= 0 || rawTotal > 100 || Math.abs(rawTotal - calculatedOutOf100) > 6) {
        console.log(`[CM Evaluation] Correcting disproportionate total_cm_score (${evaluation.total_cm_score}) -> deterministic rubric score (${calculatedOutOf100})`);
        evaluation.total_cm_score = calculatedOutOf100;
    } else {
        evaluation.total_cm_score = Math.round(rawTotal * 10) / 10;
    }
    return evaluation.total_cm_score;
}

function buildLongitudinalContext(apricotId) {
    if (!apricotId || !String(apricotId).trim()) {
        return {
            hasHistory: false,
            priorSessionCount: 0,
            contextBlock: `No Apricot ID was linked for this upload. Evaluate this session based on the selected Session Type without assuming what was or wasn't covered in other weeks.`
        };
    }

    const cleanId = String(apricotId).trim();
    let priorEvals = [];
    try {
        priorEvals = db.prepare(`
            SELECT id, session_title, session_type, total_score, apricot_notes, referrals_detected, next_session_recommendations, created_at
            FROM case_management_evaluations
            WHERE apricot_id = ?
            ORDER BY created_at ASC
        `).all(cleanId);
    } catch (e) {
        console.warn("[CM Evaluation] Could not query prior CM evaluations:", e.message);
    }

    let profileContext = '';
    try {
        const prof = db.prepare(`
            SELECT u.id as user_id, p.current_gate, p.dl_status, p.dl_notes,
                   p.housing_status, p.transportation_status, p.child_support_status
            FROM participant_profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.record_id = ?
            LIMIT 1
        `).get(cleanId);

        if (prof) {
            const completedBriefcase = db.prepare(`
                SELECT title, status, notes FROM briefcase_items
                WHERE user_id = ?
            `).all(prof.user_id);

            const briefcaseSummary = completedBriefcase.length > 0
                ? completedBriefcase.map(b => `- ${b.title}: ${b.status}${b.notes ? ` (${b.notes})` : ''}`).join('\n')
                : 'No specific briefcase items logged yet.';

            profileContext = `
CURRENT PARTICIPANT BRIEFCASE & GATE STATUS (Apricot ID #${cleanId}):
- Current Gate: Gate ${prof.current_gate || 1}
- Driver's License: ${prof.dl_status || 'unknown'} ${prof.dl_notes ? `(${prof.dl_notes})` : ''}
- Housing: ${prof.housing_status || 'unknown'}
- Transportation: ${prof.transportation_status || 'unknown'}
- Child Support: ${prof.child_support_status || 'unknown'}
- Briefcase Checklist Progress:
${briefcaseSummary}
`;
        }
    } catch (e) {
        console.warn("[CM Evaluation] Could not load profile context for Apricot ID:", e.message);
    }

    if (priorEvals.length === 0 && !profileContext) {
        return {
            hasHistory: false,
            priorSessionCount: 0,
            contextBlock: `Apricot ID #${cleanId}: This is the FIRST recorded Case Management evaluation in the system for this Apricot ID.`
        };
    }

    const historyLines = priorEvals.map((ev, idx) => {
        const dt = ev.created_at ? new Date(ev.created_at).toISOString().split('T')[0] : `Session ${idx + 1}`;
        return `--- Prior Session #${idx + 1} (${dt} • ${ev.session_type || 'Follow-Up'} • "${ev.session_title}") ---
- Prior Meeting Summary / Apricot Notes: ${ev.apricot_notes || 'N/A'}
- Referrals Already Made/Discussed: ${ev.referrals_detected || 'None noted'}
- Recommended Follow-Ups from that Session: ${ev.next_session_recommendations || 'None noted'}`;
    }).join('\n\n');

    return {
        hasHistory: priorEvals.length > 0,
        priorSessionCount: priorEvals.length,
        contextBlock: `
=== LONGITUDINAL PARTICIPANT HISTORY (APRICOT ID: #${cleanId}) ===
Total Prior Recorded Sessions for this Client: ${priorEvals.length}
${profileContext}
${priorEvals.length > 0 ? `PRIOR SESSION LOGS (CHRONOLOGICAL):\n${historyLines}` : 'No prior session recordings logged yet.'}

CRITICAL LONGITUDINAL GRADING MANDATE:
- Use the above history to understand what the Case Manager and [Client] have ALREADY covered in previous weeks!
- NEVER penalize or deduct points from the Case Manager for not repeating intake items, barriers, or exercises that were ALREADY addressed in a prior session.
- Recognize that Case Managers see [Client] daily in the center/hallways—sometimes a goal from last week was already checked off informally the day before. Do NOT heavily penalize if a prior goal is only briefly acknowledged or already resolved.
==================================================================
`
    };
}

async function evaluateCaseManagementMedia(mediaFiles, sessionTitle, location, cmName, options = {}) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured. Cannot process case management video/audio.");
    }

    const apricotId = options.apricotId ? String(options.apricotId).trim() : null;
    const longitudinal = buildLongitudinalContext(apricotId);

    // Determine session type: explicit option, or infer if first session
    let sessionType = options.sessionType || 'auto';
    if (sessionType === 'auto') {
        const lowerTitle = (sessionTitle || '').toLowerCase();
        if (lowerTitle.includes('first') || lowerTitle.includes('intake') || lowerTitle.includes('initial') || lowerTitle.includes('session 1') || (!longitudinal.hasHistory && apricotId)) {
            sessionType = 'first_session';
        } else {
            sessionType = 'follow_up';
        }
    }

    const cadenceInstructions = sessionType === 'first_session'
        ? `
=== STAGE-SPECIFIC RUBRIC: FIRST SESSION (INITIAL INTAKE / ACTION PLAN ALIGNMENT — ~45 MINS) ===
This is a FIRST SESSION with [Client]. A Case Manager CANNOT and SHOULD NOT try to solve every problem or complete all 18 program steps in Session 1!
Evaluate the Case Manager strictly against the realistic 45-Minute First Session Cadence:
1. Rapport & Psychological Safety: Building genuine trust, Situated Empathy (SYNAPSE), and non-judgmental connection.
2. Reviewing & Collaborating on the Action Plan: Reviewing the initial assessment/Action Plan with [Client], asking if [Client] agrees with the focus areas, and noting any adjustments if [Client] wants to prioritize different goals (using the Adjust Action Plan workflow).
3. Initial Briefcase & Stability Check: Identifying immediate stability needs (ID/Driver's License, Housing, Transportation, Voc Rehab work boots/clothes voucher, Welvista/Medical).
4. Setting 1–2 Realistic Weekly Process Goals: Helping [Client] set 1–2 achievable process steps for Week 1.
CRITICAL FIRST-SESSION RULE: DO NOT penalize the Case Manager for not doing deep CBT skill drills, roleplays, or solving every long-term barrier in Session 1!
`
        : `
=== STAGE-SPECIFIC RUBRIC: WEEKLY FOLLOW-UP SESSION (REALISTIC 45-MINUTE CADENCE) ===
This is a WEEKLY FOLLOW-UP SESSION with [Client]. Case Management meetings are roughly 45 minutes long—do NOT expect the Case Manager to cram 18 different interventions into a single 45-minute meeting!
Evaluate the Case Manager strictly against the realistic 45-Minute Follow-Up Cadence:
1. Goal Check-In: Checking progress on current goals (NOTE: Case Managers interact with [Client] daily in the hallway/center, so if a goal from last week was already resolved informally, do NOT penalize the CM for moving forward).
2. Briefcase & Referrals Progress: Advancing active Briefcase items and referrals (e.g., Voc Rehab work boots/clothing voucher, DMV, Welvista, housing, job readiness).
3. Focused CBT / Personal Pattern Application: Practicing ONE relevant CBT tool, thinking report, or personal pattern connected to [Client]'s real-world week (using accessible "5th-grade" language rather than clinical therapy jargon).
4. Next Week's Process Goal: Collaboratively setting 1–2 clear, controllable process goals for the upcoming week.
`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

    const prompt = `You are a Senior Case Management Quality Assurance Coach for Turn90 / First Shift.
Please analyze the attached audio/video recording of a Case Management / Re-entry Navigation meeting at ${location}.
Case Manager: ${cmName || 'Staff CM'}
Meeting Title: ${sessionTitle}
Apricot ID: ${apricotId || 'Not Specified'}
Session Stage: ${sessionType === 'first_session' ? 'First Session (Initial Intake & Action Plan Alignment)' : 'Weekly Follow-Up Session'}

${longitudinal.contextBlock}

${cadenceInstructions}

**CRITICAL TURN90 CULTURAL, LANGUAGE & PRIVACY MANDATES:**
1. COMPLETE NAME REDACTION: You MUST remove ANY references to the client's actual name throughout the ENTIRE evaluation (including CRM notes and transcript). ALWAYS use "[Client]" as a placeholder instead of their name.
2. SLANG, PROFANITY & "PRACTICE COURT" PHILOSOPHY:
   - Slang, colloquial expressions, AAVE, and profanity from either the Case Manager or [Client] are 100% ACCEPTABLE and are NEVER considered unprofessional in our setting.
   - When [Client] shares real-world risky thoughts or frustrations, raw unsanitized language is welcomed ("Practice Court"). NEVER penalize or critique slang or profanity.
3. REWARD "5TH-GRADE" ACCESSIBLE LANGUAGE & PROSOCIAL VULNERABILITY:
   - Reward Case Managers who translate CBT concepts into everyday, relatable "5th-grade" language rather than clinical therapy-speak.
   - Reward authentic Case Manager self-disclosure/vulnerability that models real-world resilience and emotional regulation.
4. TIMESTAMPED "WHAT TO ASK INSTEAD" COACHING REWRITES:
   - Never give vague critiques like "use more CBT." Every item in \`areas_for_improvement\` and the coaching report MUST cite an exact \`[MM:SS]\` timestamp, what was said, and a concrete example script of **what the Case Manager could have asked instead** (blending CBT + Motivational Interviewing + SYNAPSE Situated Empathy & Yielding the Narrative).
5. EMPTY / SILENT AUDIO CHECK:
   - If the recording is silent, empty, or contains less than 1 minute of actual speech, set \`"audio_empty_or_invalid": true\`.

CRITICAL OUTPUT REQUIREMENT:
You MUST provide your response in three distinct parts.

Part 1: The Numerical Data (JSON block)
\`\`\`json
{
  "audio_empty_or_invalid": false,
  "session_type_evaluated": "${sessionType}",
  "total_cm_score": 90,
  "scores": {
    "playbook_adherence": 4.5,
    "cbt_application": 4.5,
    "goal_setting": 4.5,
    "empathy_and_neutrality": 5.0,
    "apricot_data_gathering": 4.5
  },
  "structured_meeting_notes_for_apricot": "A concise, professional summary of the meeting, [Client] updates, Briefcase progress, gates achieved, and next steps ready to be pasted into Apricot.",
  "referrals_detected": [
    "e.g. Vocational Rehabilitation (Work Boots / Clothing Voucher)",
    "e.g. SC DMV (Driver's License Reinstatement)"
  ],
  "next_session_recommendations": [
    "Specific item 1 for the Case Manager to follow up on in next week's session...",
    "Specific item 2 to check in on next session..."
  ],
  "observed_strengths": [
    "[MM:SS] Specific observed strength..."
  ],
  "areas_for_improvement": [
    "[MM:SS] When [Client] said '...' -> CM said '...' -> Try Asking This Next Time: 'Concrete CBT/MI/SYNAPSE question...'"
  ]
}
\`\`\`

Part 2: The Full Coaching Report (Markdown)
After the JSON block, write your detailed coaching report in standard markdown format.
Include:
- **### 🎯 Timestamped Coaching Rewrites ("What You Said" vs. "What to Ask Next Time")** with exact timestamps and verbatim alternative questions.
- **### 🗓️ Recommended Gameplan for Next Session** summarizing what to follow up on next week.

Part 3: Diarized Session Transcript (for NotebookLM)
At the very end of your response, include \`===SESSION_TRANSCRIPT_START===\` followed by a clean, timestamped transcript of the session (\`[MM:SS] CM: ...\` / \`[MM:SS] [Client]: ...\`, with the client's name redacted to \`[Client]\`), and close with \`===SESSION_TRANSCRIPT_END===\`.
`;

    console.log(`[CM Evaluation] Generating evaluation for ${location} (Apricot ID: ${apricotId || 'N/A'}, Type: ${sessionType})...`);
    
    const filesToUpload = Array.isArray(mediaFiles) ? mediaFiles : [mediaFiles];
    const uploadResults = [];

    for (const mf of filesToUpload) {
        if (mf.file && mf.file.uri) {
            uploadResults.push(mf);
        } else {
            if (!mf.path || !fs.existsSync(mf.path)) {
                throw new Error("Audio/video file is missing or could not be read.");
            }
            const stat = fs.statSync(mf.path);
            if (stat.size < 10240) {
                try { fs.unlinkSync(mf.path); } catch (e) {}
                throw new Error(`Recording file is empty or too small (${stat.size} bytes). Evaluation aborted to prevent a placeholder score.`);
            }

            const uploadResult = await fileManager.uploadFile(mf.path, {
                mimeType: mf.mimeType || 'audio/mp3',
                displayName: `CM_Eval_${Date.now()}`
            });
            uploadResults.push(uploadResult);
            
            if (fs.existsSync(mf.path)) {
                try { fs.unlinkSync(mf.path); } catch(e) {}
            }
        }
    }
    
    const contentParts = [];
    
    try {
        for (const res of uploadResults) {
            let fileState = res.file;
            while (fileState.state === 'PROCESSING') {
                await new Promise(resolve => setTimeout(resolve, 8000));
                fileState = await fileManager.getFile(fileState.name);
            }
            if (fileState.state === 'FAILED') {
                throw new Error(`Gemini failed to process media file: ${fileState.name}`);
            }
            contentParts.push({ fileData: { mimeType: fileState.mimeType, fileUri: fileState.uri } });
        }
        contentParts.push({ text: prompt });

        let result;
        let retries = 5;
        while (retries > 0) {
            try {
                result = await model.generateContent(contentParts);
                break;
            } catch (err) {
                if (err.message && err.message.includes('503') && retries > 1) {
                    await new Promise(r => setTimeout(r, 15000));
                    retries--;
                } else {
                    throw err;
                }
            }
        }
        const responseText = result.response.text();
        
        let evaluation;
        let markdownPart = responseText;
        let extractedTranscript = '';

        const transcriptMatch = markdownPart.match(/===SESSION_TRANSCRIPT_START===([\s\S]*?)===SESSION_TRANSCRIPT_END===/);
        if (transcriptMatch) {
            extractedTranscript = transcriptMatch[1].trim();
            markdownPart = markdownPart.replace(/===SESSION_TRANSCRIPT_START===[\s\S]*?===SESSION_TRANSCRIPT_END===/, '').trim();
        }

        const jsonMatch = markdownPart.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            evaluation = JSON.parse(jsonMatch[1]);
            markdownPart = markdownPart.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
        } else {
            const bracketMatch = markdownPart.match(/\{[\s\S]*\}/);
            if (bracketMatch) {
                evaluation = JSON.parse(bracketMatch[0]);
                markdownPart = markdownPart.replace(/\{[\s\S]*\}/, '').trim();
            } else {
                throw new Error("AI did not return a JSON object.");
            }
        }

        if (evaluation.audio_empty_or_invalid === true) {
            throw new Error("Recording appears to be silent, empty, or contains no intelligible session speech. Evaluation aborted to prevent an inaccurate score.");
        }

        const finalScore = computeDeterministicCmScore(evaluation);
        if (isNaN(finalScore) || finalScore <= 0) {
            throw new Error("Could not compute a valid rubric score from the recording.");
        }
        
        evaluation.detailed_summary_markdown = markdownPart || "No detailed summary provided.";

        const referralsStr = Array.isArray(evaluation.referrals_detected)
            ? evaluation.referrals_detected.join('; ')
            : (evaluation.referrals_detected || '');

        const nextSessionStr = Array.isArray(evaluation.next_session_recommendations)
            ? evaluation.next_session_recommendations.join('; ')
            : (evaluation.next_session_recommendations || '');

        const stmt = db.prepare(`
            INSERT INTO case_management_evaluations (
                location, session_title, cm_name, apricot_id, session_type,
                total_score, playbook_adherence, cbt_application, goal_setting,
                empathy_and_neutrality, apricot_data_gathering,
                apricot_notes, summary_markdown, scores_json, feedback,
                next_session_recommendations, referrals_detected, transcript_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            location,
            sessionTitle,
            cmName || 'Staff CM',
            apricotId || null,
            sessionType,
            finalScore,
            evaluation.scores?.playbook_adherence ?? 4.5,
            evaluation.scores?.cbt_application ?? 4.5,
            evaluation.scores?.goal_setting ?? 4.5,
            evaluation.scores?.empathy_and_neutrality ?? 4.5,
            evaluation.scores?.apricot_data_gathering ?? 4.5,
            evaluation.structured_meeting_notes_for_apricot || '',
            evaluation.detailed_summary_markdown || '',
            JSON.stringify(evaluation.scores || {}),
            (evaluation.areas_for_improvement || []).join('; '),
            nextSessionStr,
            referralsStr,
            extractedTranscript || evaluation.detailed_summary_markdown || ''
        );

        evaluation.id = info.lastInsertRowid;
        return evaluation;
    } finally {
        for (const res of uploadResults) {
            try {
                await fileManager.deleteFile(res.file.name);
            } catch (err) {}
        }
    }
}

module.exports = { evaluateCaseManagementMedia, computeDeterministicCmScore };
