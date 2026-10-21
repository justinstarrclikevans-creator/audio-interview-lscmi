// Class Facilitation Evaluator
// Evaluates class transcripts/audio against the 20-item Turn90 Facilitator Scoring Guide & Module Workbooks
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-pro-preview" 
});

// Ensure class_facilitation_evaluations table exists
db.exec(`
CREATE TABLE IF NOT EXISTS class_facilitation_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location TEXT NOT NULL,
    session_title TEXT NOT NULL,
    facilitator_name TEXT,
    evaluator_name TEXT DEFAULT 'AI Quality Evaluator',
    class_date DATE DEFAULT (DATE('now')),
    total_score REAL NOT NULL, -- 0 to 100
    starting_score REAL DEFAULT 100,
    modeling_neutrality_score REAL,
    lesson_plan_adherence_score REAL,
    reflective_listening_score REAL,
    avoiding_confrontation_score REAL,
    summary_markdown TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    coaching_feedback TEXT,
    class_headcount INTEGER,
    transcript_text TEXT,
    detected_session_type TEXT DEFAULT 'class',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
try { db.exec("ALTER TABLE class_facilitation_evaluations ADD COLUMN class_headcount INTEGER;"); } catch (e) {}
try { db.exec("ALTER TABLE class_facilitation_evaluations ADD COLUMN transcript_text TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE class_facilitation_evaluations ADD COLUMN detected_session_type TEXT DEFAULT 'class';"); } catch (e) {}

// Self-heal any existing evaluations where total_score was severely miscalculated (e.g. broken 27.5 score)
try {
    const existingRows = db.prepare(`
        SELECT id, total_score, modeling_neutrality_score, lesson_plan_adherence_score,
               reflective_listening_score, avoiding_confrontation_score, scores_json
        FROM class_facilitation_evaluations
    `).all();
    const updateScoreStmt = db.prepare('UPDATE class_facilitation_evaluations SET total_score = ? WHERE id = ?');
    for (const row of existingRows) {
        let subVals = [];
        try {
            const parsed = JSON.parse(row.scores_json || '{}');
            subVals = Object.values(parsed).map(Number).filter(v => !isNaN(v) && v >= 0 && v <= 5);
        } catch (e) {}
        if (subVals.length === 0) {
            subVals = [
                row.modeling_neutrality_score,
                row.lesson_plan_adherence_score,
                row.reflective_listening_score,
                row.avoiding_confrontation_score
            ].map(Number).filter(v => !isNaN(v) && v >= 0 && v <= 5);
        }
        if (subVals.length > 0) {
            const avg = subVals.reduce((a, b) => a + b, 0) / subVals.length;
            const expected100 = Math.round(avg * 20 * 10) / 10;
            // Only fix if total_score was severely corrupted (e.g. under 40 while subscores average > 3.0)
            if (Number(row.total_score) < 40 && expected100 >= 60) {
                console.log(`[Class Evaluation Self-Heal] Updating severely broken Eval #${row.id} from ${row.total_score} -> ${expected100}`);
                updateScoreStmt.run(expected100, row.id);
            }
        }
    }
} catch (e) {
    console.warn("[Class Evaluation Self-Heal] Warning:", e.message);
}

const LANGUAGE_POLICY = `
================================================================================
CRITICAL TURN90 CLASSROOM QA POLICIES (NON-NEGOTIABLE)
================================================================================
Turn90 is an authentic cognitive-behavioral reentry program working directly with formerly incarcerated men.
You MUST enforce the following 7 Turn90 operational standards without exception:

1. "PRACTICE COURT" RULE — SLANG & PROFANITY (FACILITATORS & PARTICIPANTS):
   - Slang, colloquial speech, street vernacular, African American Vernacular English (AAVE), and profanity/cussing are 100% ACCEPTABLE from BOTH facilitators and participants and are NEVER considered unprofessional.
   - The classroom is "Practice Court": when participants share risky thoughts, triggers, or roleplay real-world situations, they MUST express their actual, raw thoughts (e.g., "fuck it", "fuck this bitch"). Sanitizing their language prevents their brain from recognizing real-world stop signs.
   - ABSOLUTE ZERO PENALTY RULE:
     * NEVER penalize, deduct points, or lower any category score when a facilitator OR participant uses slang or profanity.
     * NEVER list slang, cussing, or profanity in "areas_for_improvement" or coaching feedback.
     * NEVER advise a facilitator to "clean up their language," "use more professional phrasing," or correct participants when they curse.
     * THE ONLY EXCEPTION: If profanity is used in an abusive, violent personal attack directed at another person in the room.

2. OPERATIONAL PHONE CALL & LOGISTICS EXCEPTION:
   - Facilitators are required to answer brief operational phone calls during class (e.g., halfway houses calling to verify participant attendance, urgent center logistics).
   - NEVER deduct points or criticize a facilitator under "Models behavior" or "Time management" for answering a brief operational or attendance-verification phone call.

3. ACTUAL CLASS HEADCOUNT AWARENESS (NO GHOST PARTICIPANTS):
   - Count the actual number of distinct participant voices heard in the recording (or use the provided Class Headcount).
   - If a class only has 2, 3, or 4 participants present in the room and all of them participate, score Group Engagement as 5.0 / 5.0!
   - NEVER penalize a facilitator for "only engaging 3 people" or tell them to "call on quieter participants" when there are literally only 3 participants in class that day.

4. PROSOCIAL VULNERABILITY & FACILITATOR SELF-DISCLOSURE:
   - Do NOT apply clinical "Counseling 101" rules against self-disclosure.
   - Turn90 intentionally encourages facilitators to share relatable real-life struggles (e.g., an argument with a spouse, being at the ER with a child the night before, having a rough day) while still showing up positive and working hard. This models real-world emotional regulation and prosocial resilience.
   - Reward authentic facilitator vulnerability when it connects to the lesson (only flag it if personal venting hijacks the entire class period).

5. REWARD "5TH-GRADE" ACCESSIBLE LANGUAGE OVER CLINICAL JARGON:
   - Many participants are anti-therapy or have lower literacy levels.
   - Explicitly REWARD facilitators who translate clinical/workbook terms (e.g., "low frustration tolerance", "neuroplasticity") into plain, everyday "5th-grade" language (e.g., "zero tolerance for frustration"). Never penalize a facilitator for replacing clinical jargon with relatable everyday explanations.

6. MODULE 6 ("CONTROL" / 5 WORRIES) SUPPLEMENTAL EXERCISES:
   - Because Module 6 ("Control") is shorter and can feel repetitive by Day 3–4, praise and reward facilitators who use approved CBT-aligned control extensions:
     (a) Pre/Post "% of Control" visual board ratings
     (b) Process Goals vs. Outcome Goals (identifying the 5 controllable steps toward an outcome)
     (c) Persona / Emotional Goals ("How do I want to feel/show up?" without implanting negative self-labels).

7. SPECIFIC, TIMESTAMPED "WHAT TO ASK INSTEAD" COACHING REWRITES:
   - Never give vague feedback like "use more CBT application" or "ask better open-ended questions."
   - Every single coaching recommendation MUST pinpoint a specific moment in the session with:
     (1) Exact Timestamp & Quote: What the participant or facilitator said (e.g., "[14:20] Participant said: '...'").
     (2) What You Said: How the facilitator responded.
     (3) Try Asking This Next Time (Concrete Script): 2–3 exact alternative questions combining CBT + Motivational Interviewing (MI) + SYNAPSE (Situated Empathy & Yielding the Narrative).
================================================================================
`;

function sanitizeLanguageFeedback(evaluation) {
    if (!evaluation) return evaluation;

    const isForbiddenCritique = (text) => {
        if (typeof text !== 'string') return false;
        const lower = text.toLowerCase();
        const mentionsLang = lower.includes('profan') || lower.includes('slang') || lower.includes('vulgar') || 
                             lower.includes('swear') || lower.includes('curse') || lower.includes('cuss') ||
                             lower.includes('language') || lower.includes('shorthand expression');
        const isNegativeLang = mentionsLang && (
            lower.includes('unprofessional') || lower.includes('clean up') || lower.includes('avoid') || 
            lower.includes('refrain') || lower.includes('inappropriate') || lower.includes('pissed off') ||
            lower.includes('fucked up') || lower.includes('tone down') || lower.includes('formal') ||
            lower.includes('redirect participant') || lower.includes('correct participant')
        );
        const isPhonePenalty = (lower.includes('phone call') || lower.includes('answering the phone') || lower.includes('answered a call')) &&
                               (lower.includes('unprofessional') || lower.includes('avoid') || lower.includes('disrupt') || lower.includes('models behavior'));
        return isNegativeLang || isPhonePenalty;
    };

    if (Array.isArray(evaluation.areas_for_improvement)) {
        evaluation.areas_for_improvement = evaluation.areas_for_improvement.filter(item => !isForbiddenCritique(item));
    }

    if (evaluation.detailed_summary_markdown && typeof evaluation.detailed_summary_markdown === 'string') {
        evaluation.detailed_summary_markdown = evaluation.detailed_summary_markdown
            .split('\n\n')
            .filter(para => !isForbiddenCritique(para))
            .join('\n\n');
    }

    return evaluation;
}

// Strict Center-to-Staff Isolation Mapping
const KNOWN_CENTER_STAFF = {
    'spartanburg': {
        centerName: 'Spartanburg',
        primaryFacilitators: ['TB', 'Terry Brooks'],
        foreignStaffNames: ['matt', 'benjamin', 'justin', 'evans', 'diyoung', 'dantzler', 'jenn', 'jennifer']
    },
    'columbia': {
        centerName: 'Columbia',
        primaryFacilitators: ['Diyoung Dantzler', 'Jenn'],
        foreignStaffNames: ['matt', 'benjamin', 'justin', 'evans', 'tb', 'terry brooks']
    },
    'charleston': {
        centerName: 'Charleston',
        primaryFacilitators: ['Matt Benjamin', 'Justin Evans'],
        foreignStaffNames: ['diyoung', 'dantzler', 'jenn', 'jennifer', 'tb', 'terry brooks']
    }
};

/**
 * Ensures a session at one center is NEVER attributed to staff from another center
 * when participants casually mention third-party names during class discussion.
 */
function sanitizeFacilitatorName(location, detectedName, defaultName) {
    if (!detectedName || typeof detectedName !== 'string') return defaultName || 'Staff Facilitator';
    const locKey = (location || '').toLowerCase().trim();
    const centerInfo = KNOWN_CENTER_STAFF[locKey];

    // Check if the detected name contains any staff member known to belong to a DIFFERENT center
    if (centerInfo) {
        const lowerDetected = detectedName.toLowerCase();
        const hasForeignStaff = centerInfo.foreignStaffNames.some(foreign => lowerDetected.includes(foreign));
        if (hasForeignStaff) {
            console.log(`[Class Evaluation] Detected cross-center facilitator leakage: "${detectedName}" for center "${location}". Reverting to center staff.`);
            return defaultName || `${centerInfo.primaryFacilitators[0]} (${centerInfo.centerName})`;
        }
    }

    // Clean up generic placeholders or prompt echoes
    const lower = detectedName.toLowerCase();
    if (lower === 'staff facilitator' || lower.includes('audibly identified') || lower.startsWith('staff facilitator (')) {
        return defaultName || detectedName;
    }

    return detectedName.trim();
}

/**
 * Calibrated Deterministic Total Score Calculation.
 * Computes mathematical 0-100 score directly from the 0-5 rubric sub-scores.
 * Scale: 3.5 = 70.0, 4.0 = 80.0, 4.5 = 90.0, 5.0 = 100.0.
 */
function computeDeterministicClassScore(evaluation) {
    if (!evaluation || !evaluation.scores || typeof evaluation.scores !== 'object') {
        return evaluation?.total_score;
    }

    const numericSubScores = Object.values(evaluation.scores)
        .map(v => Number(v))
        .filter(v => !isNaN(v) && v >= 0 && v <= 5);

    if (numericSubScores.length === 0) {
        return Number(evaluation.total_score);
    }

    const avgOutOf5 = numericSubScores.reduce((sum, v) => sum + v, 0) / numericSubScores.length;
    const calculatedOutOf100 = Math.round(avgOutOf5 * 20 * 10) / 10; // e.g., 3.9 -> 78.0

    const rawTotal = Number(evaluation.total_score);
    // Align with deterministic rubric calculation if rawTotal is invalid, missing, or deviates by > 8 points
    if (isNaN(rawTotal) || rawTotal <= 0 || rawTotal > 100 || Math.abs(rawTotal - calculatedOutOf100) > 8) {
        console.log(`[Class Evaluation] Aligning LLM total_score (${evaluation.total_score}) -> rubric calculated score (${calculatedOutOf100})`);
        evaluation.total_score = calculatedOutOf100;
    } else {
        evaluation.total_score = Math.round(rawTotal * 10) / 10;
    }

    return evaluation.total_score;
}

function getFacilitatorScoringContext() {
    try {
        const guidePath = path.join(__dirname, 'data', 'Facilitator_Scoring_Guide.md');
        const guide = fs.readFileSync(guidePath, 'utf8');

        const CBT_CURRICULUM_FRAMEWORK = `
TURN90 CBT CURRICULUM OVERVIEW & CORE METHODOLOGY:
Turn90 uses evidence-based Cognitive Behavioral Training across 8 Core Modules:
- Module 1: Thinking Controls Behavior (DMT: Decision Making Tool, STAC: Situation -> Thinking -> Action -> Consequences, Behavior Chains)
- Module 2: Managing Emotions & Recognizing Warning Signs (Physical sensations, identifying triggers, Stop Signs, cooling down)
- Module 3: Recognizing Destructive Thinking (Blaming, Entitlement, Excuses, Overreacting; Upgrading Thoughts to Helpful Beliefs)
- Module 4: Interpersonal Communication & Social Skills (Clear listening, assertive communication, body language, non-defensive responses)
- Module 5: Problem Solving (Generating alternatives, evaluating pros/cons, picking the best long-term option)
- Module 6: Control & 5 Worries (Sorting Controllable vs Uncontrollable, Process Goals vs Outcome Goals, emotional goals)
- Module 7: Relationships & Prosocial Support (Evaluating associate influences, boundary setting, positive support networks)
- Module 8: Reentry Action Planning & Relapse Prevention (High-risk situations, emergency escape plans, ongoing stability)

FACILITATION PROTOCOL EXPECTATIONS:
1. Pacing & Time Management: Homework review MUST not exceed 20 minutes (2 min/person). Class should finish main activity with all participants.
2. Rule Enforcement: Point board used in real-time, addresses disengagement (heads down, side talk) using core correctional practices.
3. Roleplay Protocol: Set the Stage, identify the situation, assign clear co-actor roles, "Begin with the End in Mind" (confirm the exit action BEFORE calling "Action"), call "Freeze" if off track, and conduct immediate positive/constructive debrief.
4. Reflective Listening: Balance simple reflections (acknowledgment) with complex reflections (paraphrasing, reframing, double-sided change talk).
5. Avoiding Overdirecting: Ask guided questions rather than giving lectures or lecturing answers.
`;

        return `
${LANGUAGE_POLICY}

You are the Lead Facilitator Supervisor and Quality Assurance Director for Turn90 / First Shift.
You are evaluating a classroom session using the OFFICIAL Turn90 CBT Facilitation Scoring Guide (provided below).

=== OFFICIAL FACILITATOR SCORING GUIDE (20-ITEM STANDARD) ===
${guide}

=== TURN90 CBT CURRICULUM FRAMEWORK ===
${CBT_CURRICULUM_FRAMEWORK}

INSTRUCTIONS:
Evaluate the facilitator based strictly on the 20-item Scoring Guide. Reference the CBT curriculum framework to judge adherence and setup.
Provide detailed, calibrated coaching feedback based on specific timestamps and behaviors observed, including concrete "What to Ask Instead" example scripts.
`;
    } catch (e) {
        console.warn("Could not load official scoring guide, using fallback prompt.");
        return `You are evaluating a classroom session transcript using the Turn90 CBT Facilitation Scoring Guide...\n${LANGUAGE_POLICY}`; 
    }
}

async function evaluateClassTranscript(location, sessionTitle, facilitatorName, transcriptText, classHeadcount = null) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    if (!transcriptText || transcriptText.trim().length < 50) {
        throw new Error("Transcript is empty or too short to evaluate (under 50 characters). Evaluation aborted to prevent a placeholder score.");
    }

    const headcountInstruction = classHeadcount
        ? `REPORTED CLASS HEADCOUNT: There were exactly ${classHeadcount} participants in class today. Judge group engagement strictly against ${classHeadcount} participants.`
        : `CLASS HEADCOUNT DETECTION: Count the actual number of distinct participant speakers in the transcript. Judge group engagement strictly against that actual number—never assume silent participants exist if they are not in the transcript.`;

    const prompt = `${getFacilitatorScoringContext()}

================================================================================
CRITICAL SCORING CALIBRATION & RUBRIC DISTRIBUTION:
================================================================================
You are an objective Quality Assurance Director. Your evaluations must reflect genuine, calibrated performance.
DO NOT inflate scores into the 90s. In our program, a 90+ score is reserved strictly for exceptional mastery.

THE 1.0 TO 5.0 RATING SCALE & BENCHMARKS:
- 5.0 (Exemplary / Mastery — 95–100%): Flawless, textbook execution. Demonstrates advanced complex reflections, seamless buy-in, perfect roleplay staging ("Begin with the End in Mind"), and masterful group engagement. This is rare and must be earned with clear evidence.
- 4.0 – 4.4 (Good / Proficient — 80–88%): Strong, competent delivery. Solid adherence to the lesson, good pacing, positive climate. Has minor areas for refinement (e.g. relied on simple reflections instead of complex, or minor overdirecting on one question).
- 3.3 – 3.9 (Acceptable Baseline — 66–78%): Meets baseline standard. Got through the lesson, but has noticeable flaws (e.g. homework review ran over 20 minutes, co-actor instructions were unclear in roleplay, or struggled with buy-in). MOST NORMAL, EVERYDAY SESSIONS WITH REAL-WORLD MISTAKES LAND IN THIS RANGE (74–84%).
- 2.5 – 3.2 (Needs Improvement — 50–64%): Noticeable inconsistency. Lectured instead of facilitating, rushed or skipped the main activity, lost time management, or struggled to keep group on track.
- 1.0 – 2.4 (Unsatisfactory — 20–48%): Did not follow the lesson plan or violated core standards.

SCORING REALITY CHECK:
- If you identify specific areas for improvement (e.g. homework pacing went long, lacked complex reflections, missed "Begin with End in Mind"), the corresponding subscore MUST be lowered (e.g. 3.0 to 3.5).
- A session with typical areas for improvement should realistically score in the 75–85 range.
- Differentiate each category based on actual evidence.

================================================================================
CRITICAL ISOLATION MANDATES (STRICT CENTER & FACILITATOR SEPARATION):
================================================================================
1. STRICT CENTER SEPARATION:
   You are evaluating ONLY the cohort at ${location}.
   Each Turn90 Center (Charleston, Columbia, Spartanburg) operates with complete autonomy.
   Do NOT compare, reference, or pull in information, participants, or staff from other centers. Keep this report 100% focused on ${location}.
   Spartanburg is facilitated by Spartanburg staff (TB). Columbia is facilitated by Columbia staff (Diyoung, Jenn). Charleston is facilitated by Charleston staff (Matt, Justin).

2. STRICT FACILITATOR SEPARATION:
   You are evaluating ONLY the individual facilitator leading this specific session.
   The scheduled facilitator is: "${facilitatorName}".
   Under NO circumstances grade, critique, or attribute this class to any third-party staff member mentioned in casual conversation or participant anecdotes (e.g., if someone says "Mr. Matt said...", "Justin told us...", "In Diyoung's class...").
   Do NOT change "facilitator_name" to a mentioned staff member. Only change it if the lead instructor explicitly introduces themselves with their actual name in the opening minutes.
   Evaluate purely their individual facilitation skills, neutrality, pacing, and CBT delivery during this specific session.

3. ZERO EXTERNAL / MANUAL HALLUCINATIONS:
   Every single observation, timestamp, score, and coaching recommendation MUST come DIRECTLY and EXCLUSIVELY from what is in THIS transcript.
   Do NOT pull in fictional names, case studies (such as "Marcus"), or hypothetical scenarios from training manuals or workbooks.
   If a participant's name is not explicitly stated in the transcript, refer to them neutrally as "a participant" or "the participant."

4. ${headcountInstruction}

5. SESSION TYPE CHECK (1-ON-1 CASE MANAGEMENT VS. GROUP CLASS):
   If this transcript is clearly a 1-on-1 Case Management / barrier review meeting with a single client (uploaded to the Class Evaluation tab by mistake) rather than a group CBT class, set "detected_session_type": "case_management" in the JSON output. Otherwise set "detected_session_type": "class".

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

CRITICAL OUTPUT REQUIREMENT:
Provide a valid JSON object with the following structure:
\`\`\`json
{
  "facilitator_name": "${facilitatorName}",
  "detected_session_type": "class",
  "estimated_headcount": ${classHeadcount || 4},
  "total_score": 80.0,
  "scores": {
    "modeling_neutrality": 4.0,
    "lesson_plan_adherence": 3.8,
    "reflective_listening": 3.5,
    "avoiding_confrontation": 4.2,
    "time_management": 3.5,
    "enthusiasm": 4.5,
    "group_engagement": 4.0
  },
  "observed_strengths": [
    "[Timestamp] Specific strength with quote..."
  ],
  "areas_for_improvement": [
    "[Timestamp] Quote/Context -> What Facilitator Said -> Try Asking This Next Time: 'Exact CBT/MI/SYNAPSE alternative question...'"
  ],
  "detailed_summary_markdown": "Full markdown coaching report including a '### 🎯 Timestamped Coaching Rewrites (What You Said vs. What to Ask Next Time)' table."
}
\`\`\`

Classroom Transcript to Evaluate:
${transcriptText}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    let evaluation;
    try {
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        evaluation = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(responseText);
    } catch(err) {
        const bracketMatch = responseText.match(/\{[\s\S]*\}/);
        if (bracketMatch) {
            evaluation = JSON.parse(bracketMatch[0]);
        } else {
            throw new Error("AI did not return valid evaluation JSON.");
        }
    }

    // Apply language & operational policy sanitizer
    sanitizeLanguageFeedback(evaluation);

    // Enforce deterministic score math (no more 27.5 bug or inflated high 90s)
    const finalTotalScore = computeDeterministicClassScore(evaluation);
    if (isNaN(finalTotalScore) || finalTotalScore <= 0) {
        throw new Error("Evaluation produced an invalid score. Transcript may be empty or unintelligible.");
    }

    const savedFacilitator = sanitizeFacilitatorName(location, evaluation.facilitator_name, facilitatorName);
    const savedHeadcount = classHeadcount || evaluation.estimated_headcount || null;
    const detectedType = evaluation.detected_session_type || 'class';

    // Save to database
    const stmt = db.prepare(`
        INSERT INTO class_facilitation_evaluations (
            location, session_title, facilitator_name, total_score,
            modeling_neutrality_score, lesson_plan_adherence_score,
            reflective_listening_score, avoiding_confrontation_score,
            summary_markdown, scores_json, coaching_feedback,
            class_headcount, transcript_text, detected_session_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
        location,
        sessionTitle,
        savedFacilitator,
        finalTotalScore,
        evaluation.scores?.modeling_neutrality ?? 4.0,
        evaluation.scores?.lesson_plan_adherence ?? 3.8,
        evaluation.scores?.reflective_listening ?? 3.5,
        evaluation.scores?.avoiding_confrontation ?? 4.0,
        evaluation.detailed_summary_markdown || '',
        JSON.stringify(evaluation.scores || {}),
        (evaluation.areas_for_improvement || []).join('; '),
        savedHeadcount,
        transcriptText,
        detectedType
    );

    evaluation.id = info.lastInsertRowid;
    return evaluation;
}

async function uploadFacilitationResources(fileManager) {
    // Intentionally return empty: The 20-item Facilitator Scoring Guide and Turn90 CBT framework are directly embedded in the prompt.
    // Uploading external PDFs caused Gemini's multimodal attention to blend sample workbook transcripts/cases with the audio recording.
    return [];
}

async function evaluateClassMedia(location, sessionTitle, facilitatorName, mediaFiles, classHeadcount = null) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const { GoogleAIFileManager } = require("@google/generative-ai/server");
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    console.log(`[Class Evaluation] Uploading media to Gemini for ${location}...`);
    
    // Support single object or array
    const filesToUpload = Array.isArray(mediaFiles) ? mediaFiles : [mediaFiles];
    const uploadResults = [];

    for (const mf of filesToUpload) {
        if (mf.file && mf.file.uri) {
            // Already uploaded to Gemini
            uploadResults.push(mf);
        } else {
            // Guardrail against empty / 0-byte recordings (prevents phantom score)
            if (!mf.path || !fs.existsSync(mf.path)) {
                throw new Error("Audio/video file is missing or could not be read.");
            }
            const stat = fs.statSync(mf.path);
            if (stat.size < 10240) {
                try { fs.unlinkSync(mf.path); } catch (e) {}
                throw new Error(`Recording file is empty or too small (${stat.size} bytes). Evaluation aborted so no placeholder score is recorded.`);
            }

            const uploadResult = await fileManager.uploadFile(mf.path, {
                mimeType: mf.mimeType || 'video/mp4',
                displayName: `${location}_Class_Evaluation_${Date.now()}`
            });
            uploadResults.push(uploadResult);
            
            // Immediately delete local file to free disk space
            if (fs.existsSync(mf.path)) {
                try { fs.unlinkSync(mf.path); } catch(e) {}
            }
        }
    }
    
    let uploadedResources = [];

    try {
        uploadedResources = await uploadFacilitationResources(fileManager);

        const headcountInstruction = classHeadcount
            ? `REPORTED CLASS HEADCOUNT: There were exactly ${classHeadcount} participants in class today. Judge group engagement strictly against ${classHeadcount} participants—if all ${classHeadcount} speak, score Group Engagement 5/5.`
            : `ACTUAL CLASS HEADCOUNT DETECTION: Listen carefully and count the actual number of distinct participant voices in the room. If only 2, 3, or 4 participants are present in class and all of them participate, score Group Engagement 5/5! NEVER assume silent participants exist in the room without audio evidence, and NEVER penalize a small class for "only engaging 3 people."`;

        const prompt = `You are the Lead Facilitator Supervisor and Quality Assurance Director for Turn90 / First Shift.
Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

${getFacilitatorScoringContext()}

================================================================================
CRITICAL SCORING CALIBRATION & RUBRIC DISTRIBUTION:
================================================================================
You are an objective Quality Assurance Director. Your evaluations must reflect genuine, calibrated performance.
DO NOT inflate scores into the 90s. In our program, a 90+ score is reserved strictly for exceptional mastery.

THE 1.0 TO 5.0 RATING SCALE & BENCHMARKS:
- 5.0 (Exemplary / Mastery — 95–100%): Flawless, textbook execution. Demonstrates advanced complex reflections, seamless buy-in, perfect roleplay staging ("Begin with the End in Mind"), and masterful group engagement. This is rare and must be earned with clear evidence.
- 4.0 – 4.4 (Good / Proficient — 80–88%): Strong, competent delivery. Solid adherence to the lesson, good pacing, positive climate. Has minor areas for refinement (e.g. relied on simple reflections instead of complex, or minor overdirecting on one question).
- 3.3 – 3.9 (Acceptable Baseline — 66–78%): Meets baseline standard. Got through the lesson, but has noticeable flaws (e.g. homework review ran over 20 minutes, co-actor instructions were unclear in roleplay, or struggled with buy-in). MOST NORMAL, EVERYDAY SESSIONS WITH REAL-WORLD MISTAKES LAND IN THIS RANGE (74–84%).
- 2.5 – 3.2 (Needs Improvement — 50–64%): Noticeable inconsistency. Lectured instead of facilitating, rushed or skipped the main activity, lost time management, or struggled to keep group on track.
- 1.0 – 2.4 (Unsatisfactory — 20–48%): Did not follow the lesson plan or violated core standards.

SCORING REALITY CHECK:
- If you identify specific areas for improvement (e.g. homework pacing went long, lacked complex reflections, missed "Begin with End in Mind"), the corresponding subscore MUST be lowered (e.g. 3.0 to 3.5).
- A session with typical areas for improvement should realistically score in the 75–85 range.
- Differentiate each category based on actual evidence.

================================================================================
CRITICAL ISOLATION MANDATES (STRICT CENTER & FACILITATOR SEPARATION):
================================================================================
1. STRICT CENTER SEPARATION:
   You are evaluating ONLY the cohort at ${location}.
   Each Turn90 Center (Charleston, Columbia, Spartanburg) operates with complete autonomy.
   Do NOT compare, reference, or pull in information, participants, or staff from other centers. Keep this report 100% focused on ${location}.
   Spartanburg is facilitated by Spartanburg staff (TB). Columbia is facilitated by Columbia staff (Diyoung, Jenn). Charleston is facilitated by Charleston staff (Matt, Justin).

2. STRICT FACILITATOR SEPARATION:
   You are evaluating ONLY the individual facilitator leading this specific session recording.
   The scheduled facilitator is: "${facilitatorName}".
   Under NO circumstances grade, critique, or attribute this class to any third-party staff member mentioned in casual conversation or participant anecdotes (e.g., if someone says "Mr. Matt said...", "Justin told us...", "In Diyoung's class...").
   Do NOT change "facilitator_name" to a mentioned staff member. Only change it if the lead instructor explicitly introduces themselves with their actual name in the opening minutes.
   Evaluate purely their individual facilitation skills, neutrality, pacing, and CBT delivery during this specific recording.

3. ZERO EXTERNAL / MANUAL HALLUCINATIONS:
   Every single observation, timestamp, score, and coaching recommendation MUST come DIRECTLY and EXCLUSIVELY from what is audibly spoken and heard in THIS recording.
   Do NOT pull in fictional names, case studies (such as "Marcus"), or hypothetical scenarios from training manuals or workbooks.
   If a participant's name is not explicitly spoken in the audio, refer to them neutrally as "a participant" or "the participant."

4. AUDIO-ONLY CRITERIA & OPERATIONAL PHONE CALL EXCEPTION:
   These are AUDIO ONLY recordings. Do not penalize based on a lack of visual "physical presence".
   CRITICAL: If the facilitator answers a brief phone call during class (e.g., a halfway house calling to verify participant attendance or center logistics), DO NOT penalize or deduct points. Halfway house verification calls are mandatory operational duties.

5. ${headcountInstruction}

6. "PRACTICE COURT" RULE (SLANG & PROFANITY FROM FACILITATORS & PARTICIPANTS):
   In our setting, slang, street vernacular, AAVE, and profanity from BOTH facilitators and participants are 100% acceptable and authentic. When participants share risky thoughts (e.g. "fuck it", "fuck this bitch"), they MUST state them raw and unsanitized so their brain recognizes the real stop sign.
   - NEVER penalize or deduct points for facilitator or participant slang/profanity.
   - NEVER advise the facilitator to clean up their language or correct participants' profanity.

7. PROSOCIAL VULNERABILITY & "5TH-GRADE" ACCESSIBLE DEFINITIONS:
   - Praise and reward facilitators when they share relatable personal struggles (e.g. family stress, rough day, ER visit) while modeling positive emotional regulation.
   - Praise and reward facilitators when they translate clinical terms (e.g. "low frustration tolerance", "neuroplasticity") into everyday "5th-grade" accessible definitions (e.g. "zero tolerance for frustration").

8. EMPTY / SILENT AUDIO & 1-ON-1 CASE MANAGEMENT DETECTION:
   - If the recording is silent, empty, or contains less than 1 minute of actual speech, set "audio_empty_or_invalid": true.
   - If the recording is clearly a 1-on-1 Case Management / Re-entry Navigation session with a single client (uploaded to the Class Evaluation tab by mistake) rather than a group CBT class, set "detected_session_type": "case_management". Otherwise set "detected_session_type": "class".

CRITICAL OUTPUT REQUIREMENT:
You MUST provide your response in three distinct parts:

Part 1: The Numerical Data (JSON block)
\`\`\`json
{
  "facilitator_name": "${facilitatorName}",
  "audio_empty_or_invalid": false,
  "detected_session_type": "class",
  "estimated_headcount": ${classHeadcount || 4},
  "total_score": 80.0,
  "scores": {
    "modeling_neutrality": 4.0,
    "lesson_plan_adherence": 3.8,
    "reflective_listening": 3.5,
    "avoiding_confrontation": 4.2,
    "time_management": 3.5,
    "enthusiasm": 4.5,
    "group_engagement": 4.0
  },
  "observed_strengths": [
    "[MM:SS] Specific observed strength with quote..."
  ],
  "areas_for_improvement": [
    "[MM:SS] When participant said '...' -> You said '...' -> Try Asking This Next Time: 'Exact CBT / MI / SYNAPSE question...'"
  ],
  "location_specific_notes": "Key observations for ${location} only..."
}
\`\`\`

Part 2: The Full Coaching Report (Markdown)
After the JSON block, write your detailed coaching report in standard markdown format.
You MUST include a dedicated section titled:
### 🎯 Actionable Coaching Rewrites: "What You Said" vs. "What to Ask Next Time"
For each coaching moment, provide:
- **Timestamp & Context ([MM:SS]):** Exact quote of what the participant or facilitator said.
- **What You Said:** The facilitator's actual response.
- **Try Asking This Next Time (CBT + MI + SYNAPSE Script):** 2–3 concrete, verbatim alternative questions or reflections the facilitator can use next time (incorporating Situated Empathy, Yielding the Narrative, or accessible 5th-grade CBT framing).

Part 3: Diarized Session Transcript (for NotebookLM)
At the very end of your response, include a delimiter \`===SESSION_TRANSCRIPT_START===\` followed by a clean, timestamped transcript of the session dialogue (\`[MM:SS] Facilitator: ...\` / \`[MM:SS] Participant: ...\`), and close with \`===SESSION_TRANSCRIPT_END===\`.
`;

        console.log(`[Class Evaluation] Generating evaluation for ${location}...`);
        
        const contentParts = uploadedResources.map(r => ({
            fileData: { mimeType: r.mimeType, fileUri: r.fileUri }
        }));
        
        for (const res of uploadResults) {
            let fileState = res.file;
            // Poll if it's a video/audio that needs processing
            while (fileState.state === 'PROCESSING') {
                if (global.syncStatus) global.syncStatus.log = `Waiting for Gemini to process video...`;
                console.log(`[Class Evaluation] Waiting for Gemini to process ${fileState.name}...`);
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
                if (err.message && err.message.includes('503 Service Unavailable') && retries > 1) {
                    console.warn(`[Class Evaluation] Gemini API 503 Overloaded. Retrying in 15 seconds... (${retries - 1} attempts left)`);
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

        // Extract optional transcript block
        const transcriptMatch = markdownPart.match(/===SESSION_TRANSCRIPT_START===([\s\S]*?)===SESSION_TRANSCRIPT_END===/);
        if (transcriptMatch) {
            extractedTranscript = transcriptMatch[1].trim();
            markdownPart = markdownPart.replace(/===SESSION_TRANSCRIPT_START===[\s\S]*?===SESSION_TRANSCRIPT_END===/, '').trim();
        }

        // Extract the JSON block
        const jsonMatch = markdownPart.match(/```json\s*([\s\S]*?)\s*```/);
        
        if (jsonMatch) {
            try {
                evaluation = JSON.parse(jsonMatch[1]);
                markdownPart = markdownPart.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
            } catch(err) {
                console.error("[Class Evaluation] Extracted JSON was still invalid:", err);
                throw new Error("AI returned invalid JSON syntax. Raw: " + jsonMatch[1].substring(0, 500));
            }
        } else {
            const bracketMatch = markdownPart.match(/\{[\s\S]*\}/);
            if (bracketMatch) {
                try {
                    evaluation = JSON.parse(bracketMatch[0]);
                    markdownPart = markdownPart.replace(/\{[\s\S]*\}/, '').trim();
                } catch(err) {
                    console.error("[Class Evaluation] Extracted bracket JSON was invalid:", err);
                    throw new Error("AI returned invalid JSON syntax. Raw: " + responseText.substring(0, 500));
                }
            } else {
                console.error("[Class Evaluation] No JSON object found in response:", responseText);
                throw new Error("AI did not return a JSON object. Raw output: " + responseText.substring(0, 500));
            }
        }

        // Guardrail: Reject empty / silent recordings so they never get a fake 88 score!
        if (evaluation.audio_empty_or_invalid === true) {
            throw new Error("Recording appears to be silent, empty, or contains no intelligible classroom dialogue. Evaluation aborted to prevent an inaccurate score.");
        }

        if (!evaluation.scores) {
            console.error("[Class Evaluation] AI returned an invalid schema or refused the prompt:", responseText);
            throw new Error("AI returned invalid JSON schema. It may have refused to evaluate the audio.");
        }

        // Attach notice banner if a 1-on-1 CM session was uploaded to the Class tab by mistake
        if (evaluation.detected_session_type === 'case_management') {
            markdownPart = `> ⚠️ **CROSS-TAB UPLOAD NOTICE:** This recording appears to be a **1-on-1 Case Management / Barrier Review Session** rather than a group classroom session. You can move or re-evaluate this file under the **Case Management Evaluations** tab so it does not skew classroom facilitation metrics.\n\n` + markdownPart;
        }
        
        // Attach the markdown part back to the evaluation object
        evaluation.detailed_summary_markdown = markdownPart || "No detailed summary provided.";

        // Apply language & operational policy sanitizer
        sanitizeLanguageFeedback(evaluation);

        // Enforce deterministic score calculation from rubric sub-scores (fixes 27.5 bug & removes 88 fallback)
        const finalTotalScore = computeDeterministicClassScore(evaluation);
        if (isNaN(finalTotalScore) || finalTotalScore <= 0) {
            throw new Error("Could not compute a valid rubric score from the recording.");
        }

        const savedFacilitator = sanitizeFacilitatorName(location, evaluation.facilitator_name, facilitatorName);

        const savedHeadcount = classHeadcount || evaluation.estimated_headcount || null;
        const detectedType = evaluation.detected_session_type || 'class';

        // Save to database
        const stmt = db.prepare(`
            INSERT INTO class_facilitation_evaluations (
                location, session_title, facilitator_name, total_score,
                modeling_neutrality_score, lesson_plan_adherence_score,
                reflective_listening_score, avoiding_confrontation_score,
                summary_markdown, scores_json, coaching_feedback,
                class_headcount, transcript_text, detected_session_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
            location,
            sessionTitle,
            savedFacilitator,
            finalTotalScore,
            evaluation.scores?.modeling_neutrality ?? 4.0,
            evaluation.scores?.lesson_plan_adherence ?? 3.8,
            evaluation.scores?.reflective_listening ?? 3.5,
            evaluation.scores?.avoiding_confrontation ?? 4.0,
            evaluation.detailed_summary_markdown || '',
            JSON.stringify(evaluation.scores || {}),
            (evaluation.areas_for_improvement || []).join('; '),
            savedHeadcount,
            extractedTranscript || evaluation.detailed_summary_markdown || '',
            detectedType
        );

        evaluation.id = info.lastInsertRowid;
        return evaluation;
    } finally {
        console.log(`[Class Evaluation] Deleting temporary files from Gemini...`);
        for (const res of uploadResults) {
            try {
                await fileManager.deleteFile(res.file.name);
            } catch (err) {
                console.error("Failed to delete video file from Gemini:", err.message);
            }
        }
        
        for (const res of uploadedResources) {
            try {
                await fileManager.deleteFile(res.name);
            } catch (err) {
                console.error(`Failed to delete background resource ${res.name} from Gemini:`, err.message);
            }
        }
    }
}

module.exports = { evaluateClassTranscript, evaluateClassMedia, computeDeterministicClassScore };
