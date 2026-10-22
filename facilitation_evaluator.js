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

    // Purge historical hallucinated "Marcus" records and calibrate facilitator names
    const marcusRows = db.prepare(`
        SELECT id, location, facilitator_name, coaching_feedback, summary_markdown
        FROM class_facilitation_evaluations
        WHERE coaching_feedback LIKE '%Marcus%' 
           OR summary_markdown LIKE '%Marcus%'
           OR summary_markdown LIKE '%wouldn%swung%'
    `).all();

    for (const row of marcusRows) {
        console.log(`[Class Evaluation Self-Heal] Sanitizing hallucinated Marcus references from Eval #${row.id} (${row.location})...`);
        let cleanSummary = row.summary_markdown
            .replace(/\*\*2\. Avoiding Confrontation \/ Over-directing: The \"Dating\" Trap[\s\S]*?(?=\*\*3\. Role Play Setup)/, '')
            .replace(/2\. \*\*Practice the \"Group Pivot\":\*\*[\s\S]*?(?=3\. \*\*Lock in the Ending:\*\*)/, '')
            .replace(/3\. \*\*Lock in the Ending:\*\*/, '2. **Lock in the Ending:**')
            .replace(/sounded like James and Marcus/g, 'two active participants')
            .replace(/—especially protecting the clock and letting the group handle resistance—/, '—especially protecting the clock and keeping behavioral roleplay at the center—');

        let cleanFeedback = (row.coaching_feedback || '')
            .split(';')
            .map(s => s.trim())
            .filter(s => !s.toLowerCase().includes('dating') && !s.toLowerCase().includes('debate') && !s.toLowerCase().includes('marcus'))
            .join('; ');

        let targetFacilitator = row.facilitator_name;
        if (row.location === 'Columbia' && (!targetFacilitator || targetFacilitator === 'Staff Facilitator')) {
            targetFacilitator = 'Jenn Jeanquart';
        } else if (row.location === 'Spartanburg' && (!targetFacilitator || targetFacilitator === 'Staff Facilitator')) {
            targetFacilitator = 'Diyoung Dantzler';
        } else if (row.location === 'Charleston' && (!targetFacilitator || targetFacilitator === 'Staff Facilitator')) {
            targetFacilitator = 'TB (Charleston)';
        }

        db.prepare(`
            UPDATE class_facilitation_evaluations
            SET facilitator_name = ?,
                coaching_feedback = ?,
                summary_markdown = ?
            WHERE id = ?
        `).run(targetFacilitator, cleanFeedback, cleanSummary, row.id);
    }

    // Align all historical evaluations to the official center facilitators:
    // Spartanburg -> Diyoung Dantzler, Columbia -> Jenn Jeanquart, Charleston -> TB
    db.prepare("UPDATE class_facilitation_evaluations SET facilitator_name = 'Jenn Jeanquart' WHERE location = 'Columbia'").run();
    db.prepare("UPDATE class_facilitation_evaluations SET facilitator_name = 'Diyoung Dantzler' WHERE location = 'Spartanburg'").run();
    db.prepare("UPDATE class_facilitation_evaluations SET facilitator_name = 'TB (Charleston)' WHERE location = 'Charleston' AND facilitator_name != 'Test Facilitator'").run();
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
        primaryFacilitators: ['Diyoung Dantzler', 'Diyoung'],
        foreignStaffNames: ['matt', 'benjamin', 'justin', 'evans', 'jenn', 'jennifer', 'jeanquart', 'tb', 'terry brooks', 'terrence brown']
    },
    'columbia': {
        centerName: 'Columbia',
        primaryFacilitators: ['Jenn Jeanquart', 'Jenn'],
        foreignStaffNames: ['matt', 'benjamin', 'justin', 'evans', 'diyoung', 'dantzler', 'tb', 'terry brooks', 'terrence brown']
    },
    'charleston': {
        centerName: 'Charleston',
        primaryFacilitators: ['TB', 'Terry Brooks', 'Terrence Brown'],
        foreignStaffNames: ['diyoung', 'dantzler', 'jenn', 'jennifer', 'jeanquart', 'matt', 'benjamin', 'justin', 'evans']
    }
};

const CBT_MODULE_CATALOG = {
    1: { moduleNumber: 1, moduleTitle: "Module 1: Thinking Controls Behavior (DMT & STAC)" },
    2: { moduleNumber: 2, moduleTitle: "Module 2: Managing Emotions & Warning Signs (Stop Signs)" },
    3: { moduleNumber: 3, moduleTitle: "Module 3: Recognizing Destructive Thinking (Upgrading Beliefs)" },
    4: { moduleNumber: 4, moduleTitle: "Module 4: Interpersonal Communication & Social Skills" },
    5: { moduleNumber: 5, moduleTitle: "Module 5: Problem Solving" },
    6: { moduleNumber: 6, moduleTitle: "Module 6: Control & 5 Worries" },
    7: { moduleNumber: 7, moduleTitle: "Module 7: Relationships & Prosocial Support" },
    8: { moduleNumber: 8, moduleTitle: "Module 8: Reentry Action Planning & Relapse Prevention" }
};

/**
 * Dynamically detects today's CBT module and topic from classroom transcript.
 * Distinguishes today's main lesson from yesterday's homework review.
 */
function detectLessonModuleFromTranscript(transcriptText) {
    if (!transcriptText || typeof transcriptText !== 'string') {
        return { moduleNumber: 1, moduleTitle: "Module 1: Thinking Controls Behavior (DMT & STAC)" };
    }

    const lines = transcriptText.split('\n');
    const todayRegex = /(?:today(?:'s)?(?:\s+main)?(?:\s+class|\s+lesson|\s+session|\s+topic)?(?:\s+is|\s+we are|\s+we're)?|diving into|focus(?:ing)? on|welcome to|starting)\s+(?:module\s*([1-8])(?::\s*([^\n\.\,]+))?|([1-8]))/i;
    const homeworkRegex = /(?:yesterday(?:'s)?|last\s+(?:week|class|time)|homework|worksheet|check-in|recap|check on|turn that in)\b/i;

    let candidateOther = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const isHomework = homeworkRegex.test(line);

        const match = line.match(/(?:module\s*([1-8]))(?::\s*([^\n\.\,\!\?]+))?/i);
        if (match) {
            const modNum = parseInt(match[1], 10);
            const capturedTitle = match[2] ? match[2].trim() : '';
            const catalogEntry = CBT_MODULE_CATALOG[modNum];
            const fullTitle = catalogEntry ? (capturedTitle ? `Module ${modNum}: ${capturedTitle}` : catalogEntry.moduleTitle) : `Module ${modNum}`;

            if (!isHomework && todayRegex.test(line)) {
                return { moduleNumber: modNum, moduleTitle: fullTitle };
            }
            if (!isHomework && !candidateOther) {
                candidateOther = { moduleNumber: modNum, moduleTitle: fullTitle };
            }
        }
    }

    if (candidateOther) {
        return candidateOther;
    }

    // Fallback: Check for key module concepts in the non-homework text
    const lowerText = transcriptText.toLowerCase();
    const conceptScores = [
        { num: 5, pattern: /\bproblem solving\b|\bgenerating (?:multiple )?choices\b|\bthree things you can do\b/i },
        { num: 4, pattern: /\binterpersonal communication\b|\bclear listening\b|\blisten without interrupting\b|\bbody language\b/i },
        { num: 6, pattern: /\bcontrol\b|\b5 worries\b|\bcontrollable vs uncontrollable\b|\bprocess goals\b/i },
        { num: 2, pattern: /\bstop signs\b|\bmanaging emotions\b|\bphysical warning signs\b|\bcooling down\b/i },
        { num: 3, pattern: /\bdestructive thinking\b|\bupgrading thoughts\b|\bblaming\b|\bentitlement\b/i },
        { num: 7, pattern: /\bprosocial support\b|\bpositive associates\b|\bboundaries\b/i },
        { num: 8, pattern: /\breentry action plan\b|\brelapse prevention\b|\bhigh-risk situations\b/i },
        { num: 1, pattern: /\bthinking controls behavior\b|\bdmt\b|\bdecision making tool\b|\bstac\b|\bbehavior chain\b/i }
    ];

    for (const item of conceptScores) {
        if (item.pattern.test(lowerText)) {
            const entry = CBT_MODULE_CATALOG[item.num];
            return { moduleNumber: item.num, moduleTitle: entry ? entry.moduleTitle : `Module ${item.num}` };
        }
    }

    return { moduleNumber: 1, moduleTitle: "Module 1: Thinking Controls Behavior (DMT & STAC)" };
}

function cleanNorm(s) {
    if (!s) return '';
    return s.toLowerCase()
        .replace(/['’]/g, "'")
        .replace(/["“”]/g, '"')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Checks whether an observed feedback quote or named participant dialogue is grounded
 * in the actual classroom transcript.
 */
function isDialogueGrounded(text, transcriptText, normTranscript) {
    if (!text || typeof text !== 'string') return true;

    // Check 1: Named participants with action/dialogue verbs (e.g. 'When Marcus pushed back...', 'Marcus claimed')
    const nameMatches = text.matchAll(/\b(?:when|participant named|participant|with|against)\s+([A-Za-z]+)\b/gi);
    for (const match of nameMatches) {
        const name = match[1];
        const lowerName = name.toLowerCase();
        if (!['the', 'this', 'that', 'our', 'good', 'you', 'when', 'facilitator', 'a', 'an', 'another', 'one', 'staff', 'lead'].includes(lowerName)) {
            const namePattern = new RegExp('\\b' + lowerName + '\\b', 'i');
            if (!namePattern.test(transcriptText)) {
                return false;
            }
        }
    }

    // Check 2: Dialogue quotes in observation text
    // Split off recommendation/coaching suggestions so we don't penalize new suggested questions
    const observationPart = text.split(/->|Try Asking|could have asked|What to Ask Next Time|What You Said/i)[0];
    const quotes = observationPart.match(/['"]([^'"]{10,})['"]/g) || [];
    for (const rawQuote of quotes) {
        const quoteContent = rawQuote.slice(1, -1);
        const cleanQ = cleanNorm(quoteContent);
        if (cleanQ.length < 10) continue;

        if (normTranscript.includes(cleanQ)) continue;

        const words = cleanQ.split(' ').filter(Boolean);
        if (words.length >= 3) {
            let matchCount = 0;
            for (let i = 0; i <= words.length - 3; i++) {
                const trigram = words.slice(i, i + 3).join(' ');
                if (normTranscript.includes(trigram)) {
                    matchCount++;
                }
            }
            const matchRatio = matchCount / (words.length - 2);
            if (matchRatio < 0.25) {
                return false;
            }
        } else {
            if (!normTranscript.includes(cleanQ)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Quote Verification Firewall:
 * Strips ungrounded quotes, fabricated participant dialogue, and hallucinations.
 */
function filterHallucinatedQuotes(evaluation, transcriptText) {
    if (!evaluation || !transcriptText) return evaluation;
    const normTranscript = cleanNorm(transcriptText);

    if (Array.isArray(evaluation.observed_strengths)) {
        evaluation.observed_strengths = evaluation.observed_strengths.filter(item => 
            isDialogueGrounded(item, transcriptText, normTranscript)
        );
    }

    if (Array.isArray(evaluation.areas_for_improvement)) {
        evaluation.areas_for_improvement = evaluation.areas_for_improvement.filter(item => 
            isDialogueGrounded(item, transcriptText, normTranscript)
        );
    }

    if (evaluation.detailed_summary_markdown && typeof evaluation.detailed_summary_markdown === 'string') {
        const paragraphs = evaluation.detailed_summary_markdown.split('\n\n');
        const groundedParagraphs = paragraphs.filter(para => 
            isDialogueGrounded(para, transcriptText, normTranscript)
        );
        evaluation.detailed_summary_markdown = groundedParagraphs.length > 0 
            ? groundedParagraphs.join('\n\n') 
            : 'Facilitation session reviewed and grounded against class transcript.';
    }

    return evaluation;
}

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

IMPORTANT MODULE ADHERENCE RULE:
A classroom session frequently reviews previous homework or past exercises for 5-15 minutes before transitioning into TODAY's new lesson.
You MUST identify today's specific module from the main activity and new instruction, NOT from earlier homework checks.
Judge lesson adherence, roleplay staging, and CBT fidelity solely against TODAY's active module.

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

    const detected = detectLessonModuleFromTranscript(transcriptText);
    let effectiveSessionTitle = sessionTitle || 'Turn90 Workshop';
    if (!effectiveSessionTitle.toLowerCase().includes('module') && detected && detected.moduleTitle) {
        effectiveSessionTitle = `${effectiveSessionTitle} - ${detected.moduleTitle}`;
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
   Spartanburg is facilitated by Spartanburg staff (Diyoung). Columbia is facilitated by Columbia staff (Jenn). Charleston is facilitated by Charleston staff (TB).

2. STRICT FACILITATOR SEPARATION:
   You are evaluating ONLY the individual facilitator leading this specific session.
   The scheduled facilitator is: "${facilitatorName}".
   Under NO circumstances grade, critique, or attribute this class to any third-party staff member mentioned in casual conversation or participant anecdotes (e.g., if someone says "Mr. Matt said...", "Justin told us...", "In Diyoung's class...").
   Do NOT change "facilitator_name" to a mentioned staff member. Only change it if the lead instructor explicitly introduces themselves with their actual name in the opening minutes.
   Evaluate purely their individual facilitation skills, neutrality, pacing, and CBT delivery during this specific session.

3. ZERO EXTERNAL / MANUAL HALLUCINATIONS:
   Every single observation, timestamp, score, and coaching recommendation MUST come DIRECTLY and EXCLUSIVELY from what is in THIS transcript.
   Do NOT pull in fictional names, case studies, or hypothetical scenarios from training manuals or workbooks.
   If a participant's name is not explicitly stated in the transcript, refer to them neutrally as "a participant" or "the participant."

4. ${headcountInstruction}

5. SESSION TYPE CHECK (1-ON-1 CASE MANAGEMENT VS. GROUP CLASS):
   If this transcript is clearly a 1-on-1 Case Management / barrier review meeting with a single client (uploaded to the Class Evaluation tab by mistake) rather than a group CBT class, set "detected_session_type": "case_management" in the JSON output. Otherwise set "detected_session_type": "class".

Location: ${location}
Session / Module: ${effectiveSessionTitle}
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

    // Apply Quote Verification Firewall (Strip Hallucinated Dialogue / Fake Characters)
    filterHallucinatedQuotes(evaluation, transcriptText);

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
        effectiveSessionTitle,
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
    return [];
}

/**
 * Stage 1: Transcribes classroom media into a verbatim, timestamped transcript.
 * Runs at temperature 0.1 without rubric or scoring prompt interference.
 */
async function transcribeClassAudio(fileManager, uploadResults, location = '', facilitatorName = '') {
    console.log(`[Class Evaluation] Stage 1: Transcribing classroom audio verbatim for ${location}...`);
    
    const contentParts = [];
    for (const res of uploadResults) {
        let fileState = res.file;
        while (fileState.state === 'PROCESSING') {
            if (global.syncStatus) global.syncStatus.log = `Waiting for audio processing...`;
            console.log(`[Class Evaluation] Waiting for Gemini to process ${fileState.name}...`);
            await new Promise(resolve => setTimeout(resolve, 8000));
            fileState = await fileManager.getFile(fileState.name);
        }
        if (fileState.state === 'FAILED') {
            throw new Error(`Gemini failed to process media file: ${fileState.name}`);
        }
        contentParts.push({ fileData: { mimeType: fileState.mimeType, fileUri: fileState.uri } });
    }

    const transcribePrompt = `You are an expert audio transcription specialist for Turn90 / First Shift.
Location: ${location}
Scheduled Facilitator: ${facilitatorName}

TASK: Generate a strict, verbatim, timestamped transcript of the audible speech in this classroom recording.
Format each spoken line with timestamp:
[MM:SS] Facilitator: <exact spoken words>
or
[MM:SS] Participant: <exact spoken words> (or [MM:SS] Participant (<Name>): <words> if their name is spoken out loud in class)

MANDATORY TRANSCRIPTION RULES:
1. Verbatim Grounding: Transcribe ONLY the audible words spoken by the human beings in the room.
2. Zero Fabrication: Absolutely DO NOT invent fictional participants, roleplays, or workbook case examples.
3. If an utterance is muffled or unintelligible, write [unintelligible].
4. Do NOT summarize, critique, or score the session. Return ONLY the timestamped dialogue transcript.
5. If the audio is completely silent or contains less than 1 minute of intelligible speech, output: EMPTY_AUDIO.`;

    contentParts.push({ text: transcribePrompt });

    let result;
    let retries = 5;
    while (retries > 0) {
        try {
            result = await model.generateContent({
                contents: [{ role: 'user', parts: contentParts }],
                generationConfig: {
                    temperature: 0.1
                }
            });
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

    const transcriptText = result.response.text().trim();
    if (transcriptText.includes('EMPTY_AUDIO') || transcriptText.length < 50) {
        throw new Error("Recording appears to be silent, empty, or contains no intelligible classroom dialogue. Evaluation aborted.");
    }

    return transcriptText;
}

/**
 * Two-Stage Grounded Facilitation Evaluation:
 * Stage 1: Verbatim timestamped transcription (temperature: 0.1)
 * Stage 2: Dynamic lesson/module detection from spoken dialogue
 * Stage 3: Grounded evaluation against transcript text with quote verification firewall
 */
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
            uploadResults.push(mf);
        } else {
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
            
            if (fs.existsSync(mf.path)) {
                try { fs.unlinkSync(mf.path); } catch(e) {}
            }
        }
    }

    try {
        // Stage 1: Verbatim Transcription (temperature 0.1)
        if (global.syncStatus) global.syncStatus.log = `Transcribing classroom audio for ${location}...`;
        const transcriptText = await transcribeClassAudio(fileManager, uploadResults, location, facilitatorName);

        // Stage 2: Dynamic Module Detection from Spoken Dialogue
        const detected = detectLessonModuleFromTranscript(transcriptText);
        console.log(`[Class Evaluation] Detected Active Lesson: ${detected.moduleTitle} (Module ${detected.moduleNumber})`);

        let effectiveSessionTitle = sessionTitle;
        if (!effectiveSessionTitle || effectiveSessionTitle.includes('Class Session') || effectiveSessionTitle.includes('pm') || effectiveSessionTitle.includes('am')) {
            effectiveSessionTitle = `${sessionTitle} - ${detected.moduleTitle}`;
        }

        // Stage 3: Grounded Evaluation on Verbatim Transcript (with Quote Firewall)
        if (global.syncStatus) global.syncStatus.log = `Evaluating facilitation for ${location}...`;
        const evaluation = await evaluateClassTranscript(location, effectiveSessionTitle, facilitatorName, transcriptText, classHeadcount);

        return evaluation;
    } finally {
        console.log(`[Class Evaluation] Deleting temporary files from Gemini...`);
        for (const res of uploadResults) {
            try {
                if (res.file && res.file.name) {
                    await fileManager.deleteFile(res.file.name);
                }
            } catch (err) {
                console.error("Failed to delete video file from Gemini:", err.message);
            }
        }
    }
}

module.exports = { 
    evaluateClassTranscript, 
    evaluateClassMedia, 
    computeDeterministicClassScore,
    detectLessonModuleFromTranscript,
    filterHallucinatedQuotes,
    getFacilitatorScoringContext,
    transcribeClassAudio,
    KNOWN_CENTER_STAFF
};
