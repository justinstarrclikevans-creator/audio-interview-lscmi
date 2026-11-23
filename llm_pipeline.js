const {
    getGeminiApiKey,
    assertValidGeminiApiKey,
    getEvalModelName,
    getTranscribeModelName,
    getFastModelName,
    buildBudgetGenerationConfig,
    assertWithinDailyGeminiCap
} = require('./env_config');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const {
    sanitizeParticipantSlug,
    getParticipantFolderBundle,
    updateParticipantUnifiedBriefcase,
    syncAllParticipantFolders
} = require('./services/participant_folder_manager');
const { stripReferenceExampleContamination } = require('./facilitation_evaluator');

const skillsRootDir = path.resolve(__dirname, '..', '..', '..', '.agents', 'skills');

// Load ONLY the requested LS/CMI domain reference (Progressive Disclosure)
function loadSingleLscmiDomainReference(domainCode = '01-criminal-history') {
    try {
        const domPath = path.join(skillsRootDir, 'lscmi-dynamic-assessment', 'references', 'domains', `${domainCode}.md`);
        if (fs.existsSync(domPath)) {
            return fs.readFileSync(domPath, 'utf8');
        }
    } catch (e) {}
    return '';
}

// Dynamic LS/CMI Turn-by-Turn Questioning & Discrepancy Engine
async function generateDynamicLscmiNextQuestion({
    clientName = 'Participant',
    location = 'Charleston',
    currentDomain = '01-criminal-history',
    conversationHistory = [],
    intakeAnchors = {},
    claimsLog = [],
    discrepancyAttemptsOnCurrentTopic = 0
}) {
    const DOMAIN_SEQUENCE = [
        { code: '01-criminal-history', title: '1.1 Criminal History & Supervision' },
        { code: '02-education-employment', title: '1.2 Education & Employment' },
        { code: '03-family-marital', title: '1.3 Family & Marital Relationships' },
        { code: '04-leisure-recreation', title: '1.4 Leisure & Recreation (Typical Weekday/Weekend)' },
        { code: '05-companions', title: '1.5 Companions & Social Support' },
        { code: '06-alcohol-drug', title: '1.6 Alcohol & Substance Use' },
        { code: '07-procriminal-attitude', title: '1.7 Attitude, Values & Authority' },
        { code: '08-antisocial-pattern', title: '1.8 Coping, Impulsivity & Frustration Tolerance' }
    ];

    const folderBundle = getParticipantFolderBundle(clientName);
    const mergedAnchors = {
        ...(folderBundle?.screening_consultation?.latest_screening || {}),
        ...(folderBundle?.briefcase?.items || {}),
        ...intakeAnchors
    };

    // Progressive Disclosure: Load ONLY the active domain's scoring criteria + Probation Planner behavioral definitions
    const domainReference = loadSingleLscmiDomainReference(currentDomain);
    const curIdx = Math.max(0, DOMAIN_SEQUENCE.findIndex(d => d.code === currentDomain));
    const nextDomainObj = DOMAIN_SEQUENCE[Math.min(DOMAIN_SEQUENCE.length - 1, curIdx + 1)];

    // Fallback deterministic question if no Gemini key is configured in local test
    if (!getGeminiApiKey()) {
        return {
            move_type: 'probe_deeper',
            active_domain: currentDomain,
            next_domain: currentDomain,
            discrepancy_detected: false,
            discrepancy_details: null,
            matched_probation_planner_definitions: [],
            extracted_claims: [],
            reflection_and_question: `I appreciate you walking me through that. Thinking about ${DOMAIN_SEQUENCE[curIdx]?.title || currentDomain}, walk me through a specific recent situation and how you handled it day-to-day.`
        };
    }

    assertWithinDailyGeminiCap('lscmi_dynamic_question');
    const model = getFastPipelineModel();
    const prompt = `You are a skilled Turn90 LS/CMI Dynamic Interviewer trained in Motivational Interviewing (MI), SYNAPSE (Situate, Yield, Navigate, Activate), and CBT with Justice-Involved Clients.
Participant: ${clientName} (${location})
Active LS/CMI Domain: ${DOMAIN_SEQUENCE[curIdx]?.title || currentDomain}
Next LS/CMI Domain (if current domain has sufficient evidence): ${nextDomainObj.title} (${nextDomainObj.code})
Discrepancy Probes Already Attempted on This Topic: ${discrepancyAttemptsOnCurrentTopic} (MAX 1 ALLOWED — if >= 1, do NOT probe discrepancy again; log unresolved_discrepancy and move on).

=== STRICT ANTI-HALLUCINATION & ZERO-EXAMPLE-LEAKAGE POLICY ===
- Never pull or cite examples, character names, or scenarios from reference manuals.
- Base every claim and behavioral definition match strictly on what ${clientName} said in the conversation history below.

=== PRE-LOADED SCREENING CONSULTATION & BRIEFCASE ANCHORS ===
${JSON.stringify(mergedAnchors, null, 2)}

=== CLAIMS LOGGED SO FAR IN THIS INTERVIEW ===
${JSON.stringify(claimsLog, null, 2)}

=== ACTIVE DOMAIN REFERENCE & PROBATION PLANNER BEHAVIORAL DEFINITIONS ===
${domainReference}

=== RECENT CONVERSATION TURNS ===
${conversationHistory.slice(-8).map(t => `${t.role === 'interviewer' ? 'Interviewer' : clientName}: ${t.text}`).join('\n')}

TASK (2-Step Silent Analysis -> 1 Open-Ended MI Question):
1. Analyze ${clientName}'s last response:
   - Extract any concrete factual claims (frequency, recency, impact).
   - Check if it matches any **Probation and Parole Treatment Planner Behavioral Definitions** listed in the active domain reference above (cite verbatim quote from ${clientName}).
   - Check if it contradicts the Pre-Loaded Screening/Record Anchors or an earlier claim in Claims Logged So Far.
2. Decide ONE move ("move_type"):
   - "gentle_discrepancy": If a contradiction was detected AND Discrepancy Probes Already Attempted < 1. Use SYNAPSE Navigate / Double-Sided Reflection or "I want to make sure my timeline is right..." — NEVER say "You contradicted yourself" or sound confrontational.
   - "probe_deeper": If the answer was vague, minimized, or lacks concrete detail (who, when, how often, impact) needed to score the active LS/CMI domain. Ask for a specific episode ("Walk me through the last time...", "What does a typical Tuesday look like?").
   - "reflect_and_bridge": If the participant shared an emotional or sensitive struggle — validate with Situated Empathy & Yielding before asking an open question.
   - "advance_domain": If we have sufficient behavioral evidence for ${DOMAIN_SEQUENCE[curIdx]?.title}, summarize in 1 warm sentence and ask the opening open-ended question for ${nextDomainObj.title}.
3. Write "reflection_and_question": Start with a brief, non-judgmental reflection, followed by ONE open-ended, non-challenging question (never stack multiple questions).

Return ONE valid JSON object with this exact schema:
{
  "move_type": "probe_deeper" | "gentle_discrepancy" | "reflect_and_bridge" | "advance_domain",
  "active_domain": "${currentDomain}",
  "next_domain": "${currentDomain} or ${nextDomainObj.code}",
  "domain_sufficient": false,
  "discrepancy_detected": false,
  "unresolved_discrepancy": false,
  "discrepancy_details": "null or brief description of the mismatch between anchor/claim A and claim B",
  "matched_probation_planner_definitions": [
    {
      "problem_area": "e.g. IMPULSIVITY or AUTHORITY CONFLICTS",
      "behavioral_definition": "Exact behavioral definition matched from Probation Planner",
      "verbatim_quote": "Exact words spoken by participant"
    }
  ],
  "extracted_claims": [
    { "domain": "${currentDomain}", "claim": "Factual summary of claim", "quote": "Verbatim quote" }
  ],
  "reflection_and_question": "Your 1-sentence reflection followed by ONE open-ended question..."
}`;

    const result = await model.generateContent(prompt);
    const parsed = safeJsonParse(result.response.text()) || {};
    parsed.reflection_and_question = stripReferenceExampleContamination(parsed.reflection_and_question || '', JSON.stringify(conversationHistory));
    return parsed;
}

// Map any of the 158 LS/CMI Audio Intake questions (1-based qNum) to its Central Eight domain for progressive disclosure
function mapQuestionIndexToLscmiDomain(questionIndex = 0, questionText = '') {
    const qNum = Number(questionIndex) + 1;
    if ((qNum >= 1 && qNum <= 11) || (qNum >= 106 && qNum <= 127)) {
        return '01-criminal-history';
    }
    if ((qNum >= 12 && qNum <= 20) || (qNum >= 50 && qNum <= 59) || (qNum >= 138 && qNum <= 157)) {
        return '02-education-employment';
    }
    if ((qNum >= 21 && qNum <= 25) || qNum === 128 || (qNum >= 133 && qNum <= 135)) {
        return '03-family-marital';
    }
    if (qNum >= 26 && qNum <= 28) {
        return '04-leisure-recreation';
    }
    if ((qNum >= 29 && qNum <= 33) || qNum === 136) {
        return '05-companions';
    }
    if ((qNum >= 34 && qNum <= 37) || (qNum >= 129 && qNum <= 132)) {
        return '06-alcohol-drug';
    }
    if ((qNum >= 38 && qNum <= 43) || qNum === 137) {
        return '07-procriminal-attitude';
    }
    const t = String(questionText || '').toLowerCase();
    if (/alcohol|drink|drug|marijuana|weed|cocaine|meth|opiate|substance|sober|relapse/.test(t)) return '06-alcohol-drug';
    if (/job|work|employ|school|grade|diploma|ged|boss|supervisor|income|money|skill/.test(t)) return '02-education-employment';
    if (/arrest|convict|incarcerat|probation|parole|supervision|charge|court|jail|prison/.test(t)) return '01-criminal-history';
    return '08-antisocial-pattern';
}

function buildConsultationAnchorSummary(clientName) {
    const anchors = {
        screening_consultation: null,
        unified_briefcase: null,
        apricot_consultation: null
    };
    try {
        const bundle = getParticipantFolderBundle(clientName);
        if (bundle) {
            if (bundle.screening_consultation && bundle.screening_consultation.latest_screening) {
                anchors.screening_consultation = bundle.screening_consultation.latest_screening;
            }
            if (bundle.briefcase && bundle.briefcase.items) {
                const compactBriefcase = {};
                for (const [k, v] of Object.entries(bundle.briefcase.items)) {
                    compactBriefcase[k] = v && v.value ? `${v.value}${v.notes ? ` (${v.notes})` : ''}` : '';
                }
                anchors.unified_briefcase = compactBriefcase;
            }
        }
    } catch (e) {}
    try {
        const { getParticipantConsultationLscmiContext } = require('./services/apricot_eval_engine');
        const ctx = getParticipantConsultationLscmiContext(clientName);
        if (ctx) {
            anchors.apricot_consultation = {
                recordId: ctx.recordId,
                center: ctx.center,
                consultationDate: ctx.consultationDate,
                domainCrosswalk: ctx.domainCrosswalk || {},
                collateralSnippet: (ctx.collateralPromptText || '').slice(0, 2500)
            };
        }
    } catch (e) {}
    return anchors;
}

// Deterministic fallback discrepancy check (ensures re-ask discrepancy flags still work if API key is missing/offline)
function detectDeterministicConsultationDiscrepancy(questionText, liveAnswer, anchors) {
    const q = String(questionText || '').toLowerCase();
    const a = String(liveAnswer || '').toLowerCase();
    if (!a || a.length < 2) return null;

    const bc = anchors?.unified_briefcase || {};
    const cw = anchors?.apricot_consultation?.domainCrosswalk || {};
    const scRaw = JSON.stringify(anchors?.screening_consultation || '').toLowerCase();

    // 1. Driver's license / ID check
    if (/license|dl\b|driver/.test(q)) {
        const bcId = String(bc.state_id_or_dl || '').toLowerCase();
        if (bcId.includes('suspended') && /\b(valid|good|active|clean|not suspended|have my license)\b/.test(a) && !/suspended/.test(a)) {
            return {
                consultation_value: bc.state_id_or_dl,
                live_value: liveAnswer,
                details: 'Consultation/Briefcase indicates DL is suspended, while participant stated license is valid/active.',
                follow_up: 'Thanks for sharing that. Have you checked in with the DMV recently about your license status, or is there anything still open there?'
            };
        }
        if (bcId.includes('valid_dl') && /\b(suspended|revoked|no license|never had)\b/.test(a)) {
            return {
                consultation_value: bc.state_id_or_dl,
                live_value: liveAnswer,
                details: 'Consultation/Briefcase lists a valid Driver\'s License, while participant stated it is suspended or missing.',
                follow_up: 'Thanks for letting me know. About when did your license status change, and is there anything needed with the DMV to get it sorted out?'
            };
        }
    }

    // 2. Housing check
    if (/address|housing|live|staying|homeless|shelter/.test(q)) {
        const bcHouse = String(bc.stable_housing || '').toLowerCase();
        if ((bcHouse.includes('unhoused') || bcHouse.includes('temporary') || scRaw.includes('shelter') || scRaw.includes('motel')) && /\b(stable|own place|lease|apartment|no issues)\b/.test(a)) {
            return {
                consultation_value: bc.stable_housing || 'Temporary/Unstable housing on screening',
                live_value: liveAnswer,
                details: 'Screening consultation noted temporary/unstable housing, while participant reported stable housing.',
                follow_up: 'Thanks for sharing. Could you tell me a little more about your current living setup and how long you\'ve been staying there?'
            };
        }
    }

    // 3. Arrests / Criminal history / Supervision check
    if (/arrest|convict|probation|parole|supervision|charge|pending/.test(q)) {
        const recText = String(cw.criminalHistory?.arrestsAndConvictions || cw.criminalHistory?.supervisionStatus || '').toLowerCase();
        if ((recText.includes('probation') || recText.includes('parole') || scRaw.includes('active_logged') || scRaw.includes('pending_charges')) && /\b(no supervision|not on probation|never arrested|no arrests|clean record|maxed out)\b/.test(a)) {
            return {
                consultation_value: cw.criminalHistory?.supervisionStatus || bc.supervision_information || 'Active supervision/charges noted on consultation',
                live_value: liveAnswer,
                details: 'Consultation/intake records note supervision or charges, while participant denied supervision/arrests.',
                follow_up: 'Thanks for letting me know. About when did everything with court or supervision wrap up, or is anything still active?'
            };
        }
    }

    // 4. Alcohol / Drug check
    if (/alcohol|drug|marijuana|weed|cocaine|meth|opiate|substance/.test(q)) {
        const subText = String(cw.alcoholDrug?.substanceSummary || '').toLowerCase();
        if ((subText.includes('thc') || subText.includes('marijuana') || subText.includes('positive') || subText.includes('history')) && /\b(never|none|no drug|never used|nothing at all)\b/.test(a)) {
            return {
                consultation_value: cw.alcoholDrug?.substanceSummary || 'Prior substance/screen note in consultation',
                live_value: liveAnswer,
                details: 'Consultation/collateral notes reference substance history or positive screen, while participant denied any use.',
                follow_up: 'Thanks for sharing. Have alcohol or substances ever played a part in things for you in the past, even a while back?'
            };
        }
    }

    return null;
}

// Live Dynamic 158-Question Audio Intake Engine (Always re-asks consultation topics to flag discrepancies)
async function evaluateLive158QuestionTurn({
    clientName = 'Participant',
    location = 'Charleston',
    questionIndex = 0,
    questionNumber = 1,
    questionText = '',
    questionSubtext = '',
    liveAnswer = '',
    answers158 = {},
    discrepancyFollowupsUsed = 0
}) {
    const activeDomain = mapQuestionIndexToLscmiDomain(questionIndex, questionText);
    const domainReference = loadSingleLscmiDomainReference(activeDomain);
    const anchors = buildConsultationAnchorSummary(clientName);

    const trimmedAnswer = String(liveAnswer || '').trim();
    const isVague = trimmedAnswer.length > 0 && (
        trimmedAnswer.split(/\s+/).length <= 3 ||
        /^(yes|no|yeah|nah|idk|i don't know|maybe|fine|good|nothing|none|normal|same)\.?$/i.test(trimmedAnswer)
    );

    function buildDeterministic158Fallback(modeLabel) {
        if (detMismatch && discrepancyFollowupsUsed < 1) {
            return {
                move_type: 'gentle_discrepancy',
                active_domain: activeDomain,
                question_number: questionNumber,
                discrepancy_detected: true,
                discrepancy_details: detMismatch.details,
                consultation_value_on_file: detMismatch.consultation_value,
                live_participant_value: detMismatch.live_value,
                follow_up_question: detMismatch.follow_up,
                matched_probation_planner_definitions: [],
                ready_to_advance: false,
                engine_mode: modeLabel
            };
        }
        if (isVague && discrepancyFollowupsUsed < 1) {
            const subHint = questionSubtext ? `${questionSubtext} — ` : '';
            return {
                move_type: 'probe_deeper',
                active_domain: activeDomain,
                question_number: questionNumber,
                discrepancy_detected: false,
                discrepancy_details: null,
                follow_up_question: `Thanks for sharing that. ${subHint}Could you tell me a little more about that in your own words?`,
                matched_probation_planner_definitions: [],
                ready_to_advance: false,
                engine_mode: modeLabel
            };
        }
        return {
            move_type: 'advance_next_question',
            active_domain: activeDomain,
            question_number: questionNumber,
            discrepancy_detected: Boolean(detMismatch),
            discrepancy_details: detMismatch ? detMismatch.details : null,
            consultation_value_on_file: detMismatch ? detMismatch.consultation_value : null,
            live_participant_value: trimmedAnswer,
            follow_up_question: '',
            matched_probation_planner_definitions: [],
            ready_to_advance: true,
            engine_mode: modeLabel
        };
    }

    // Deterministic fallback if GEMINI_API_KEY is not configured or fails
    const detMismatch = detectDeterministicConsultationDiscrepancy(questionText, trimmedAnswer, anchors);
    if (!getGeminiApiKey()) {
        return buildDeterministic158Fallback('deterministic_offline');
    }

    try {
        assertWithinDailyGeminiCap('lscmi_dynamic_question');
    const model = getFastPipelineModel();
        const answerList = Array.isArray(answers158) ? answers158 : Object.entries(answers158 || {}).map(([qIdx, rec]) => ({ index: Number(qIdx), ...rec }));
        const recentAnswers = answerList
            .slice(-12)
            .map((rec, i) => `Q${rec.questionNumber || (rec.index != null ? Number(rec.index) + 1 : i + 1)} (${rec.questionText || rec.question || ''}): "${rec.liveAnswer || rec.answer || ''}"`)
            .join('\n');

        const prompt = `You are a Turn90 LS/CMI Audio Intake Co-Pilot guiding a live 158-question recorded intake interview.
Participant: ${clientName} (${location})
Current Question: Q${questionNumber} of 158: "${questionText}" ${questionSubtext ? `(Sub-prompt: ${questionSubtext})` : ''}
Active Central Eight Domain: ${activeDomain}
Follow-Up Probes Already Used on Q${questionNumber}: ${discrepancyFollowupsUsed} (MAX 1 FOLLOW-UP PER QUESTION — if >= 1, set ready_to_advance: true and log unresolved discrepancy if still mismatched).

=== MANDATORY RE-ASK & DISCREPANCY POLICY ===
1. Even when information is already present in the Screening Consultation, Briefcase, or Apricot Consultation below, the interviewer MUST ask the participant all 158 questions live to verify accuracy and catch discrepancies.
2. Compare ${clientName}'s live answer below against BOTH:
   a) Pre-loaded Screening Consultation / Briefcase / Apricot Consultation records, AND
   b) Prior answers already given in this 158-question interview.
3. NEVER pull examples, names, or anecdotes from reference manuals.
4. If a discrepancy exists (and follow-ups used < 1): set "move_type": "gentle_discrepancy", "discrepancy_detected": true, and record the hidden staff details in "discrepancy_details" and "consultation_value_on_file". IMPORTANT: "follow_up_question" is shown directly to the participant on a plain, comfortable participant-facing screen—it MUST NEVER mention or hint at consultation sheets, screening notes, Briefcase, prior records, discrepancies, contradictions, conflicts, "on file", "our records", or question numbers. Write ONLY one short, warm, plain-English clarifying question (1 sentence) inviting helpful context or timeline (e.g. "Thanks for sharing that. Could you tell me a little more about how that's been going recently?").
5. If the answer is vague, minimized, or misses the sub-prompt (and follow-ups used < 1): set "move_type": "probe_deeper" and ask ONE open-ended episodic follow-up ("Walk me through the last time...", "What does a typical day look like?").
6. Otherwise set "move_type": "advance_next_question" and "ready_to_advance": true.

=== PRE-LOADED CONSULTATION & BRIEFCASE ANCHORS (FOR DISCREPANCY CHECKING) ===
${JSON.stringify(anchors, null, 2)}

=== RECENT PRIOR ANSWERS IN THIS 158-QUESTION INTERVIEW ===
${recentAnswers || 'None logged yet.'}

=== ACTIVE DOMAIN & PROBATION PLANNER BEHAVIORAL DEFINITIONS ===
${domainReference}

=== PARTICIPANT'S LIVE ANSWER TO Q${questionNumber} ===
"${trimmedAnswer}"

Return ONE valid JSON object:
{
  "move_type": "gentle_discrepancy" | "probe_deeper" | "reflect_and_bridge" | "advance_next_question",
  "discrepancy_detected": false,
  "discrepancy_details": null,
  "consultation_value_on_file": null,
  "live_participant_value": "${trimmedAnswer.replace(/"/g, '\\"')}",
  "follow_up_question": "",
  "matched_probation_planner_definitions": [
    { "problem_area": "...", "behavioral_definition": "...", "verbatim_quote": "..." }
  ],
  "ready_to_advance": true
}`;

        const result = await model.generateContent(prompt);
        const parsed = safeJsonParse(result.response.text()) || {};
        parsed.active_domain = activeDomain;
        parsed.question_number = questionNumber;
        parsed.engine_mode = 'gemini';
        if (parsed.follow_up_question) {
            parsed.follow_up_question = stripReferenceExampleContamination(parsed.follow_up_question, trimmedAnswer);
            const LEAKY_DISCREPANCY_RE = /\b(discrepanc\w*|contradict\w*|inconsisten\w*|mismatch\w*|consultation\w*|screening\s+(?:sheet|notes?|record|form)s?|earlier\s+at\s+screening|briefcase|collateral|on\s+file|our\s+records|prior\s+records?|probation\s+planner|flagged)\b/i;
            if (LEAKY_DISCREPANCY_RE.test(parsed.follow_up_question)) {
                parsed.follow_up_question = 'Thanks for sharing that. Could you tell me a little more about how that played out or the timing of it?';
            }
        }
        return parsed;
    } catch (apiErr) {
        // Safe fallback to deterministic check if Gemini key is invalid/rate-limited
        return buildDeterministic158Fallback('deterministic_fallback');
    }
}

function getPipelineGenAI() {
    const apiKey = assertValidGeminiApiKey();
    return new GoogleGenerativeAI(apiKey);
}

function getFastPipelineModel() {
    const genAI = getPipelineGenAI();
    return genAI.getGenerativeModel({
        model: getFastModelName(),
        generationConfig: buildBudgetGenerationConfig({
            role: 'fast',
            responseMimeType: 'application/json',
            maxOutputTokens: 1024
        })
    });
}

function getPipelineModel() {
    assertWithinDailyGeminiCap('lscmi_eval');
    const genAI = getPipelineGenAI();
    return genAI.getGenerativeModel({ 
        model: getEvalModelName(), 
        generationConfig: buildBudgetGenerationConfig({
            role: 'eval',
            responseMimeType: 'application/json',
            maxOutputTokens: 32768
        })
    });
}

const manualsDir = path.join(__dirname, 'manuals');

function loadManuals(includeApricotMapping = false) {
    let manualsText = '';
    const orderedFiles = [
        'LS_CMI_Scoring_Guide.md',
        'Scoring Form.txt',
        'Interview Guide.txt',
        'Case Brief Template.txt',
        'Briefcase_Template.txt',
        'Probation_and_Parole_Planner_Guide.txt'
    ];
    if (includeApricotMapping) {
        orderedFiles.push('Apricot_Mapping.txt');
    }

    for (const file of orderedFiles) {
        const fullPath = path.join(manualsDir, file);
        if (fs.existsSync(fullPath)) {
            manualsText += `\n\n=== OFFICIAL MANUAL: ${file} ===\n`;
            manualsText += fs.readFileSync(fullPath, 'utf8');
        }
    }
    return manualsText;
}

const RATED_0_TO_3_ITEMS = new Set([15, 16, 17, 18, 19, 20, 23, 25, 27, 30, 31, 36, 37]);

function validateAndNormalizeLscmiScoringForm(mdContent, headerInfo = {}) {
    if (!mdContent || typeof mdContent !== 'string') return mdContent;
    let text = mdContent;

    // 1. Ensure top header has DOB & Age (avoid circular require warning during initial load)
    try {
        if (headerInfo && headerInfo.fullName) {
            const pktMod = require('./generate_weekly_consultation_lscmi_packets');
            if (Object.prototype.hasOwnProperty.call(pktMod, 'ensureScoringHeaderHasDobAndAge') && typeof pktMod.ensureScoringHeaderHasDobAndAge === 'function') {
                text = pktMod.ensureScoringHeaderHasDobAndAge(text, headerInfo);
            }
        }
    } catch (e) {}

    // Split into Section 1 and everything from Section 2 onward so we only normalize Section 1 items 1-43
    const sec2Idx = text.search(/\n(?:#+\s*|\*\*)Section\s*2:/i);
    let sec1Text = sec2Idx !== -1 ? text.slice(0, sec2Idx) : text;
    const afterSec1Text = sec2Idx !== -1 ? text.slice(sec2Idx) : '';

    const lines = sec1Text.split('\n');
    const itemRisk = {};
    const itemRatingVal = {};

    const POSITIVE_RATIONALE_RE = /\b(abstinent|no active|no current|negative screen|negative random|clean drug|sobriety|sober|lifelong abstainer|strongly denounces|rejects criminal|rejects current criminal|desire to leave street economy|respects .*compliance|believes in hard work|positive communication|positive,?\s*respectful|positive team|respectful and open|cooperative,?\s*professional|constructive family|supportive communication|structured recovery routine|active recovery in oxford house|daily schedule focused on transit|skilled trades|skilled culinarian|satisfied being single|reflecting on past convictions)\b/i;
    const NEGATIVE_RATIONALE_RE = /\b(unemployed|fired|terminated|conflict|argument|tension|friction|strain|resent|cynic|hostile|rationaliz|minimiz|justify|idle|bored|unstructured|relapse|active use|daily use|craving|codefendant|justice-involved peers|criminal friends|few prosocial|limited support|limited engagement|violation|breach|misconduct|disciplinary|guarded around probation)\b/i;

    const lineIndexByItem = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^(\s*)(\d+)\.\s+(.*?)\*\*([^*]+)\*\*(.*)$/);
        if (!m) continue;
        const indent = m[1];
        const num = parseInt(m[2], 10);
        if (num < 1 || num > 43) continue;
        lineIndexByItem[num] = i;
        const label = m[3];
        let val = m[4].trim();
        const rest = m[5] || '';

        if (RATED_0_TO_3_ITEMS.has(num)) {
            const numMatch = val.match(/([0-3])/);
            let numRating;
            if (numMatch) {
                numRating = parseInt(numMatch[1], 10);
                if (val !== String(numRating)) {
                    val = String(numRating);
                    lines[i] = `${indent}${num}. ${label}**${val}**${rest}`;
                }
            } else {
                numRating = /^yes$/i.test(val) ? 1 : 2;
                val = String(numRating);
                lines[i] = `${indent}${num}. ${label}**${val}**${rest}`;
            }
            // If rated 0 or 1 (risk) but rationale is clearly positive/prosocial and not unemployed/negative, flip to 2 or 3
            if ((numRating === 0 || numRating === 1) && POSITIVE_RATIONALE_RE.test(rest) && !NEGATIVE_RATIONALE_RE.test(rest)) {
                numRating = numRating === 0 ? 3 : 2;
                val = String(numRating);
                lines[i] = `${indent}${num}. ${label}**${val}**${rest}`;
            }
            itemRatingVal[num] = numRating;
            itemRisk[num] = (numRating === 0 || numRating === 1) ? 1 : 0;
        } else {
            let isYes = /^yes$/i.test(val) || val === '1';
            // If marked Yes (or 1) when rationale is clearly positive/compliant/non-risk
            if (isYes && (
                (/\b(none reported|no major disciplinary|compliant with community|no pending charges|never incarcerated|reflecting on past convictions)\b/i.test(rest) && !/\b(prior|violation|breach|revoked|infraction)\b/i.test(rest))
            )) {
                isYes = false;
            }
            const normalizedYesNo = isYes ? 'Yes' : 'No';
            if (val !== normalizedYesNo) {
                lines[i] = `${indent}${num}. ${label}**${normalizedYesNo}**${rest}`;
            }
            itemRatingVal[num] = normalizedYesNo;
            itemRisk[num] = isYes ? 1 : 0;
        }
    }

    // Enforce LS/CMI IF/THEN rules for Alcohol/Drug (Items 28-35)
    if (itemRatingVal[28] === 'No' && (itemRatingVal[30] === 0 || itemRatingVal[30] === 1)) {
        itemRatingVal[30] = 3;
        itemRisk[30] = 0;
        const idx30 = lineIndexByItem[30];
        if (idx30 !== undefined) {
            lines[idx30] = lines[idx30].replace(/\*\*[0-3]\*\*/, '**3**');
        }
    }
    if (itemRatingVal[29] === 'No' && (itemRatingVal[31] === 0 || itemRatingVal[31] === 1)) {
        itemRatingVal[31] = 3;
        itemRisk[31] = 0;
        const idx31 = lineIndexByItem[31];
        if (idx31 !== undefined) {
            lines[idx31] = lines[idx31].replace(/\*\*[0-3]\*\*/, '**3**');
        }
    }

    const sumRange = (start, end) => {
        let s = 0;
        for (let n = start; n <= end; n++) s += (itemRisk[n] || 0);
        return s;
    };

    const scores = {
        CH: sumRange(1, 8),
        EE: sumRange(9, 17),
        FM: sumRange(18, 21),
        LR: sumRange(22, 23),
        CO: sumRange(24, 27),
        ADP: sumRange(28, 35),
        PA: sumRange(36, 39),
        AP: sumRange(40, 43)
    };
    const total = scores.CH + scores.EE + scores.FM + scores.LR + scores.CO + scores.ADP + scores.PA + scores.AP;
    const riskLevel = total >= 30 ? 'Very High' : (total >= 20 ? 'High' : (total >= 11 ? 'Medium' : (total >= 5 ? 'Low' : 'Very Low')));

    sec1Text = lines.join('\n');

    // Update each domain score line in Section 1
    for (const [code, val] of Object.entries(scores)) {
        const re1 = new RegExp(`(\\*\\*${code}\\s*Score:\\s*)\\d+(\\*\\*)`, 'gi');
        const re2 = new RegExp(`(\\*${code}\\s*Score:\\*\\s*\\*\\*)\\d+(\\*\\*)`, 'gi');
        sec1Text = sec1Text.replace(re1, `$1${val}$2`).replace(re2, `$1${val}$2`);
    }

    // Update Total Scores summary inside Section 1
    sec1Text = sec1Text.replace(
        /CH:\s*\d+\s*\|\s*EE:\s*\d+\s*\|\s*FM:\s*\d+\s*\|\s*LR:\s*\d+\s*\|\s*CO:\s*\d+\s*\|\s*ADP:\s*\d+\s*\|\s*PA:\s*\d+\s*\|\s*AP:\s*\d+/gi,
        `CH: ${scores.CH} | EE: ${scores.EE} | FM: ${scores.FM} | LR: ${scores.LR} | CO: ${scores.CO} | ADP: ${scores.ADP} | PA: ${scores.PA} | AP: ${scores.AP}`
    );
    sec1Text = sec1Text
        .replace(/(\* CH:\s*)\d+/i, `$1${scores.CH}`)
        .replace(/(\* EE:\s*)\d+/i, `$1${scores.EE}`)
        .replace(/(\* FM:\s*)\d+/i, `$1${scores.FM}`)
        .replace(/(\* LR:\s*)\d+/i, `$1${scores.LR}`)
        .replace(/(\* CO:\s*)\d+/i, `$1${scores.CO}`)
        .replace(/(\* ADP:\s*)\d+/i, `$1${scores.ADP}`)
        .replace(/(\* PA:\s*)\d+/i, `$1${scores.PA}`)
        .replace(/(\* AP:\s*)\d+/i, `$1${scores.AP}`);

    sec1Text = sec1Text
        .replace(/(\*\*Total(?:\s+Section\s*1)?\s+Score:\s*)\d+(\*\*)/gi, `$1${total}$2`)
        .replace(/(\*Total(?:\s+Section\s*1)?\s+Score:\*\s*\*\*)\d+(\*\*)/gi, `$1${total}$2`);

    let updatedAfter = afterSec1Text;
    if (updatedAfter) {
        updatedAfter = updatedAfter
            .replace(/(Total\s+LS\/CMI\s+Score:\s*\*\*)\d+(\s*(?:\/\s*43)?\*\*)/gi, `$1${total}$2`)
            .replace(/(\*\*Total\s+LS\/CMI\s+Score:\s*)\d+(\s*(?:\/\s*43)?\*\*)/gi, `$1${total}$2`)
            .replace(/(Score-based\s+LS\/CMI\s+Risk\/Need\s+Level:\*\*?\s*)\**[A-Za-z\s]+(?:\(\d+\))?\**/gi, `$1**${riskLevel} (${total})**`)
            .replace(/(Final\s+(?:LS\/CMI\s+)?Risk\/Need\s+Level:\*\*?\s*)\**[A-Za-z\s]+\**/gi, `$1**${riskLevel}**`);
    }

    return sec1Text + updatedAfter;
}

// Get the actual CSV header for the LLM
function getCsvHeader() {
    try {
        const localCsv = path.join(__dirname, 'data', 'FirstShift20IntakeForm.csv');
        const parentCsv = path.join(__dirname, '..', 'FirstShift20IntakeForm.csv');
        const csvPath = fs.existsSync(localCsv) ? localCsv : (fs.existsSync(parentCsv) ? parentCsv : null);
        if (csvPath) {
            const content = fs.readFileSync(csvPath, 'utf8');
            const lines = content.split('\n');
            const headerLine = lines.find(l => l.includes('OR THIS COLUMN!'));
            if (headerLine) return headerLine;
            return lines[2];
        }
    } catch(e) {}
    return "field_4297_first,field_4297_middle,field_4297_last";
}

// Safe JSON Parser that handles unescaped control characters inside string literals from LLMs
function safeJsonParse(jsonStr) {
    if (!jsonStr || typeof jsonStr !== 'string') return null;
    let text = jsonStr.trim();
    if (text.startsWith('```json')) {
        text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    } else if (text.startsWith('```')) {
        text = text.replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    }

    try {
        return JSON.parse(text);
    } catch (initialError) {
        let insideString = false;
        let isEscaped = false;
        let result = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = text.charCodeAt(i);

            if (char === '"' && !isEscaped) {
                insideString = !insideString;
                result += char;
            } else if (insideString) {
                if (isEscaped) {
                    result += char;
                    isEscaped = false;
                } else if (char === '\\') {
                    isEscaped = true;
                    result += char;
                } else if (char === '\n') {
                    result += '\\n';
                } else if (char === '\r') {
                    result += '\\r';
                } else if (char === '\t') {
                    result += '\\t';
                } else if (code < 32) {
                    result += '\\u' + code.toString(16).padStart(4, '0');
                } else {
                    result += char;
                }
            } else {
                result += char;
                isEscaped = false;
            }
        }

        return JSON.parse(result);
    }
}

async function runPhase1(transcriptText, clientName, location = "", additionalNotes = "", explicitCollateral = "") {
    assertValidGeminiApiKey();
    const model = getPipelineModel();

    // Auto-resolve Apricot Consultation & Case Management Collateral Context if available
    let consultationCollateral = explicitCollateral || "";
    let resolvedBio = { dob: 'Pending Verification', age: 'Pending Verification' };
    let recordId = '';
    try {
        const { getParticipantConsultationLscmiContext, resolveParticipantDobAndAge } = require('./services/apricot_eval_engine');
        const ctx = getParticipantConsultationLscmiContext(clientName);
        if (ctx && ctx.collateralPromptText && !consultationCollateral) {
            consultationCollateral = ctx.collateralPromptText;
        }
        if (ctx && ctx.recordId) recordId = ctx.recordId;
        resolvedBio = resolveParticipantDobAndAge(recordId || clientName, [transcriptText, additionalNotes, consultationCollateral]);
    } catch (e) {
        console.warn('[LLM Phase 1] Could not auto-load Apricot consultation context:', e.message);
    }

    const combinedCollateral = [additionalNotes, consultationCollateral].filter(s => s && s.trim()).join('\n\n');

    const manuals = loadManuals(false);
    const systemPrompt = `You are an expert case manager and LS/CMI assessor for First Shift / Turn90.
Phase 1 Task: Based on the provided LS/CMI interview transcript, Apricot Reentry Consultation / Intake Screening collateral notes, and assessment scoring manuals, produce:
1. "interview_guide": The COMPLETE, UNABBREVIATED 158-question LS/CMI Interview Guide.
   - Start at the very top with a header block stating Participant Name, Date of Birth (DOB): ${resolvedBio.dob}, Age: ${resolvedBio.age}, and Center Location.
   - You MUST include and answer ALL questions from the standard 158-question Interview Guide covering all domains:
     * Domain 1: Administrative & Identification
     * Domain 2: Criminal History
     * Domain 3: Education / Employment
     * Domain 4: Family / Marital
     * Domain 5: Leisure / Recreation
     * Domain 6: Companions
     * Domain 7: Alcohol / Substance Problem
     * Domain 8: Procriminal Attitude / Orientation
     * Domain 9: Antisocial Pattern
     * Domain 10: Specific Risk/Need & Personal Barrier Factors
   - For each of the **158 questions**:
     - Bold the question title (\`1.\` through \`158.\`).
     - Provide the participant's direct quotes and evidence from the **live interview transcript/audio**.
     - **CRITICAL RE-ASK & DISCREPANCY VERIFICATION RULE:** Even when information was previously documented in the Screening Consultation or Apricot Consultation, all 158 questions must be asked and answered live in the interview to catch discrepancies.
       * If the participant answered the question live and it **matches** the consultation/collateral, cite their live quote (\`[Answered Live]\`).
       * If the participant's live answer **conflicts** with the Screening Consultation, Briefcase, or Apricot Consultation, explicitly mark **\`⚠️ DISCREPANCY FLAGGED\`** and state both what the consultation/collateral recorded AND what the participant stated live.
       * If a question was **not asked/answered live** in the audio or transcript, explicitly mark **\`⚠️ NOT ASKED LIVE IN INTERVIEW\`** (you may note \`[Consultation Only — Unverified Live: ...]\` so staff follow up, never silently pretending it was asked live).
     - At the very top of \`interview_guide\` (right under the header), include a **\`## ⚠️ Consultation vs. Live Interview Discrepancy Log & Missing Questions Check\`** summary listing:
       1. Every discrepancy detected between Consultation/Collateral and Live Interview answers.
       2. Any of the 158 questions not yet answered live.
     - CRITICAL: Interviewers may paraphrase or use dynamic MI follow-up probes. Map conversational answers and follow-ups accurately to the corresponding numbered question (\`1–158\`).
   - DO NOT truncate, skip, or summarize questions. Provide all questions systematically.
   - Do NOT use the word "clinical". Use "behavioral health", "support", or "assessment" instead.
   - Do NOT reference Route 66.

2. "draft_scoring_form": The comprehensive Phase 1 DRAFT LS/CMI Scoring Form evaluating all 8 Section 1 subcomponents (Items 1–43), Section 2 (2.1 Personal Problems 1–14, 2.2 History of Perpetration 1–21), Section 4 (Other Client Issues 1–21), Section 5 (Special Responsivity Considerations 1–10), Section 6 (Risk/Need Summary and Override), Section 7 (Risk/Need Profile), and a # CASE MANAGEMENT BRIEF (Sections 1–7).
   - CRITICAL TOP HEADER REQUIREMENT: State the Participant's Name, Date of Birth (DOB): ${resolvedBio.dob}, and Age: ${resolvedBio.age} clearly at the very top of "draft_scoring_form" before Section 1!
   - CRITICAL LS/CMI 3-TO-0 RATING SCALE & YES/NO SCORING RULES (DO NOT INVERT!):
     * For Yes/No items:
       - **Yes** = +1 risk point (risk/need factor is present)
       - **No** = 0 risk points (risk/need factor is absent)
     * For 0–3 Rated items (Items 15, 16, 17, 18, 19, 20, 23, 25, 27, 30, 31, 36, 37):
       - **3** = Satisfactory situation with NO need for improvement -> **0 risk points** (Strength / Prosocial!)
       - **2** = Relatively satisfactory situation with some room for improvement -> **0 risk points** (Generally stable / Prosocial)
       - **1** = Relatively unsatisfactory situation with a need for improvement -> **+1 risk point** (Moderate risk factor)
       - **0** = Very unsatisfactory situation with a clear and strong need for improvement -> **+1 risk point** (High risk factor)
       - NEVER rate a positive/abstinent/prosocial item as 0 or 1! If the participant is abstinent from alcohol/drugs, rejects crime, or has positive relationships, rate that item **3** or **2**!
     * Employment Items 15–17 Rule: If Item 9 (Currently unemployed?) is **Yes** and the participant is not in school, official LS/CMI rules state to rate Items 15, 16, 17 as **0** (Unemployed/available for labor market, adding +3 points to EE Score), OR if evaluating active First Shift / recent job interactions, rate 0–3 based on actual workplace performance/peer/authority evidence.
     * Alcohol/Drug Items 28–35 Rule: If Item 28 (Alcohol problem, ever) is **No**, Item 30 (Alcohol problem, currently) MUST be **3** (0 risk pts). If Item 29 (Drug problem, ever) is **No**, Item 31 (Drug problem, currently) MUST be **3** (0 risk pts).
     * Antisocial Pattern Items 40–43 Rule:
       - Item 41 (Early and diverse antisocial behavior) is **Yes** ONLY IF arrested under age 16 (Item 5 = Yes) or severe childhood adjustment problems AND at least one of assault/violence, escape, or supervision breach (Item 8 = Yes).
       - Item 42 (Criminal attitude) is **Yes** ONLY IF at least one of Item 36 (rated 0 or 1), Item 37 (rated 0 or 1), or Item 39 (Yes) is scored as a risk.
       - Item 43 (Pattern of generalized trouble) is **Yes** ONLY IF at least 4 of: Financial problems, 3+ address changes, Item 11=Yes, Item 12=Yes, Item 14=Yes, Item 19=0/1, Item 23=0/1, Item 27=0/1 are scored as risks.
     * MANDATORY EXACT SUBCOMPONENT MATH:
       - For EVERY subcomponent (CH, EE, FM, LR, CO, ADP, PA, AP), the subcomponent score (**CH Score: X**, **EE Score: X**, etc.) MUST equal the exact count of items in that subcomponent marked **Yes**, **0**, or **1**!
       - **Total Section 1 Score** MUST equal CH + EE + FM + LR + CO + ADP + PA + AP.

${combinedCollateral ? `Apricot Reentry Consultation & Collateral Intake Notes:\n${combinedCollateral}\n\n` : ''}

Reference Manuals:
${manuals}

You must return a valid JSON object with EXACTLY these two keys:
{
  "interview_guide": "# Turn90 / First Shift: LS/CMI Standardized Assessment Interview Guide\\n...",
  "draft_scoring_form": "# LS/CMI Scoring Form\\n\\n**Participant Name:** ${clientName}\\n**Date of Birth (DOB):** ${resolvedBio.dob} | **Age:** ${resolvedBio.age}\\n..."
}

Format requirements:
- Follow LS/CMI Scoring Manual rules strictly.
- Provide specific, concise factual evidence in parentheses after each item's rating (e.g., "**Yes** (2 adult convictions)" or "**3** (Abstinent; no active alcohol problem)").`;

    const prompt = `${systemPrompt}\n\nClient Name: ${clientName}\nDate of Birth (DOB): ${resolvedBio.dob}\nCurrent Age: ${resolvedBio.age}\nLocation: ${location || 'Turn90 Center'}\n\nInterview Transcript:\n${transcriptText}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = safeJsonParse(responseText);
    try {
        const postBio = require('./services/apricot_eval_engine').resolveParticipantDobAndAge(
            recordId || clientName,
            [transcriptText, parsed?.interview_guide || '', parsed?.draft_scoring_form || '', combinedCollateral]
        );
        if (parsed && parsed.draft_scoring_form) {
            parsed.draft_scoring_form = validateAndNormalizeLscmiScoringForm(parsed.draft_scoring_form, {
                fullName: clientName,
                recordId,
                dob: postBio.dob,
                age: postBio.age,
                center: location || 'Turn90 Center'
            });
        }
    } catch (e) {}
    return parsed;
}

// Process Audio Uploads with High-Fidelity 2-Stage Gemini Pipeline
async function runPhase1WithAudio(audioBuffer, mimeType, clientName, location, additionalNotes = "", unusedArg = "", explicitCollateral = "") {
    const apiKey = assertValidGeminiApiKey();
    const genAI = getPipelineGenAI();

    // Package audio: inline base64 if <= 20MB, or GoogleAIFileManager if > 20MB
    let audioPart;
    let uploadedFileName = null;
    try {
        if (audioBuffer.length > 20 * 1024 * 1024) {
            console.log(`[Audio Pipeline] Audio is > 20MB (${(audioBuffer.length / (1024 * 1024)).toFixed(1)} MB), uploading via Gemini REST API to bypass disk...`);
            const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Protocol': 'raw',
                    'X-Goog-Upload-Command': 'start, upload, finalize',
                    'X-Goog-Upload-Header-Content-Length': audioBuffer.length.toString(),
                    'X-Goog-Upload-File-Name': `${clientName}_interview_audio_${Date.now()}`,
                    'Content-Type': mimeType || 'audio/webm'
                },
                body: audioBuffer
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            
            uploadedFileName = data.file.name;
            
            // Poll until file is ACTIVE
            let fileState = data.file.state;
            let attempts = 0;
            while (fileState === 'PROCESSING' && attempts < 20) {
                console.log(`[Audio Pipeline] Waiting for Gemini to process audio file... (${attempts + 1}/20)`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(apiKey)}`);
                const checkData = await checkRes.json();
                if (checkData.error) throw new Error(checkData.error.message);
                fileState = checkData.state;
                if (fileState === 'FAILED') throw new Error('Gemini failed to process the uploaded audio file.');
                attempts++;
            }
            
            audioPart = { fileData: { mimeType: data.file.mimeType, fileUri: data.file.uri } };
        } else {
            console.log(`[Audio Pipeline] Audio is ${(audioBuffer.length / 1024).toFixed(1)} KB (<= 20MB), streaming inline base64 to Gemini...`);
            audioPart = {
                inlineData: {
                    mimeType: mimeType || 'audio/webm',
                    data: audioBuffer.toString('base64')
                }
            };
        }

        // Stage 1: Full Verbatim Audio Transcription (thinkingBudget: 0 saves thinking-token spend)
        console.log(`[Audio Pipeline] Transcribing complete audio recording for ${clientName}...`);
        assertWithinDailyGeminiCap('lscmi_transcribe');
        const transcriptionModel = genAI.getGenerativeModel({
            model: getTranscribeModelName(),
            generationConfig: buildBudgetGenerationConfig({
                role: 'transcribe',
                temperature: 0.1,
                maxOutputTokens: 32768
            })
        });

        const transcriptionPrompt = `You are an expert intake assessment transcriber for Turn90 / First Shift.
Listen to the attached audio recording with participant "${clientName}" conducted at the Turn90 ${location} center.
Provide a complete, high-fidelity, verbatim text transcript of the ENTIRE interview.
CRITICAL TRANSCRIPTION REQUIREMENTS:
- Label every single speaker turn clearly as "Interviewer:" or "${clientName}:" (or "Participant:").
- Include every question asked, all participant dialogue, direct quotes, and explanations.
- Do NOT summarize, truncate, condense, or omit any section of the conversation.
- If the audio is unclear, make your absolute best phonetic guess and mark it with [unclear].
- CRITICAL: Interviewers often ask questions conversationally or rapidly go through a checklist without reading the full question out loud. Capture all of these conversational cues perfectly, because they will be used to score an assessment later.
${additionalNotes && additionalNotes.trim() ? `\nFor context, here is a chronological log of the questions the participant was looking at on the screen while recording this audio. Use this to help identify what they are answering if they just say "Yes" or "No":\n${additionalNotes}` : ''}`;

        let transcriptionResult;
        let retries = 3;
        while (retries > 0) {
            try {
                transcriptionResult = await transcriptionModel.generateContent([audioPart, { text: transcriptionPrompt }]);
                break;
            } catch (err) {
                console.error(`[Audio Pipeline] generateContent error (${retries} retries left):`, err.message);
                retries--;
                if (retries === 0) throw err;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        let transcriptText = transcriptionResult?.response?.text() || '';
        if (!transcriptText || transcriptText.trim().length < 50) {
            console.warn(`[Audio Pipeline] Audio produced very short or blank transcript (${transcriptText.length} chars). Enhancing with intake contextual disclosures...`);
            transcriptText = `# Turn90 / First Shift Intake Assessment Transcript\nParticipant: ${clientName}\nLocation: Turn90 ${location || 'Center'}\nDate: ${new Date().toLocaleDateString('en-US')}\nAssessor: Turn90 Case Management Team\n==========================================================\n\n${transcriptText || `Interview audio recorded for ${clientName}.`}\n\n${additionalNotes || ''}`;
        }
        console.log(`[Audio Pipeline] Transcription complete. Length: ${transcriptText.length} characters.`);

        // Auto-enroll Participant Voice Profile from LS/CMI Audio Recording
        try {
            const pSlug = sanitizeParticipantSlug(clientName);
            const voiceDir = path.join(__dirname, 'data', 'voice_profiles', 'participants');
            if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
            const refPath = path.join(voiceDir, `${pSlug}_lscmi_ref.webm`);
            // Store up to 512KB voice reference sample
            fs.writeFileSync(refPath, audioBuffer.slice(0, Math.min(audioBuffer.length, 512 * 1024)));
            db.prepare(`
                INSERT OR REPLACE INTO voice_profiles (profile_id, person_type, name, location, role, source_type, audio_file_path, duration_seconds, acoustic_notes, enrolled_at)
                VALUES (?, 'participant', ?, ?, 'participant', 'lscmi_interview', ?, 30, 'Enrolled automatically from LS/CMI assessment recording (separated from staff interviewer voice)', CURRENT_TIMESTAMP)
            `).run(`participant_${pSlug}`, clientName, location || 'Charleston', refPath);
        } catch (vErr) {
            console.warn('[Voice Recognition] Could not save participant voice profile from LS/CMI audio:', vErr.message);
        }

        // Stage 2: Comprehensive 158-Question Interview Guide & Draft Scoring Form
        console.log(`[Audio Pipeline] Generating full 158-question Interview Guide and Draft Scoring Form for ${clientName}...`);
        const phase1Output = await runPhase1(transcriptText, clientName, location, additionalNotes, explicitCollateral);

        return {
            transcript: transcriptText,
            interview_guide: phase1Output.interview_guide,
            draft_scoring_form: phase1Output.draft_scoring_form
        };
    } finally {
        if (uploadedFileName) {
            try {
                const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(apiKey)}`;
                await fetch(deleteUrl, { method: 'DELETE' });
                console.log(`[Audio Pipeline] Deleted temporary audio file from Gemini: ${uploadedFileName}`);
            } catch(e) {
                console.error(`[Audio Pipeline] Failed to delete temporary audio file:`, e);
            }
        }
    }
}

async function runPhase2(transcriptText, clientName, draftScoringForm, feedback, criminalHistoryText = "") {
    assertValidGeminiApiKey();
    const model = getPipelineModel();

    // Auto-resolve Apricot Consultation & Case Management Collateral Context
    let consultationCollateral = "";
    let resolvedBio = { dob: 'Pending Verification', age: 'Pending Verification' };
    let recordId = '';
    let center = 'Turn90 Center';
    try {
        const { getParticipantConsultationLscmiContext, resolveParticipantDobAndAge } = require('./services/apricot_eval_engine');
        const ctx = getParticipantConsultationLscmiContext(clientName);
        if (ctx && ctx.collateralPromptText) {
            consultationCollateral = ctx.collateralPromptText;
            recordId = ctx.recordId || '';
            center = ctx.center || center;
        }
        resolvedBio = resolveParticipantDobAndAge(recordId || clientName, [transcriptText, draftScoringForm, criminalHistoryText, consultationCollateral]);
    } catch (e) {
        console.warn('[LLM Phase 2] Could not auto-load Apricot consultation context:', e.message);
    }
    const combinedCollateral = [criminalHistoryText, consultationCollateral].filter(s => s && s.trim()).join('\n\n');

    const manuals = loadManuals(true);
    const csvHeader = getCsvHeader();
    
    const systemPrompt = `You are an experienced case manager and assessor for First Shift / Turn90.
    Phase 2 Task: Incorporate Program Manager review feedback and any Criminal History record into the assessment, and produce:
    
    1. "final_scoring_form": The completed, validated LS/CMI Scoring Form.
       - CRITICAL TOP HEADER REQUIREMENT: State the Participant's Name, Date of Birth (DOB): ${resolvedBio.dob}, and Age: ${resolvedBio.age} clearly at the very top of "final_scoring_form" before Section 1!
       - Strictly follow the LS/CMI 3-to-0 scale (3 = Satisfactory / 0 risk pts, 2 = Relatively Satisfactory / 0 risk pts, 1 = Relatively Unsatisfactory / +1 risk pt, 0 = Very Unsatisfactory / +1 risk pt) and Yes/No scale (Yes = +1 risk pt, No = 0 risk pts).
       - Ensure every subcomponent score (CH, EE, FM, LR, CO, ADP, PA, AP) equals the exact count of items in that subcomponent marked Yes, 0, or 1.
    2. "case_brief": The Program Manager Case Brief.
       - Use the Probation and Parole Treatment Planner & Scoring Manual.
       - Identify the TOP 2-3 Dynamic Criminogenic Need Domains (NEVER choose Criminal History, as it is static).
       - Detail primary stability factors (housing, driver's license, child support, transportation, health/meds).
    3. "participant_case_plan": A beautiful, empowering, PRINTABLE First Shift Action Plan written directly for the participant.
       - Header: Participant Name, Date, Location, Program Track (Turn90 First Shift).
       - CRITICAL REQUIREMENT: DO NOT INCLUDE ANY GOALS. Remove all goal sections entirely.
       - Identify EXACTLY the TOP 3 Areas of Focus (these correspond to their criminogenic domains, but use highly accessible, less clinical language). For each of the 3 areas, structure into EXACTLY these 4 sections:
         * **Area of Focus & Core Goal**: (e.g., "Area of Focus: Handling Frustration & Anger | Core Goal: Staying calm when things don't go your way", rather than using clinical terms like 'Criminogenic Domain' or 'Hostile Attribution').
         * **Personal Pattern**: (The specific unhelpful thinking trap, defense mechanism, or automatic loop identified from their interview, explained in everyday language, e.g., "Taking workplace feedback as a personal attack" or "Walking away or quitting when feeling overwhelmed").
         * **Trigger Situations**:
           - Leave this section entirely empty so the participant and case manager can identify triggers together. Simply provide 5 to 8 numbered blank lines where the participant can write down specific situations that trigger this pattern.
             1. ___________________________________________________________________________________
             2. ___________________________________________________________________________________
             3. ___________________________________________________________________________________
             4. ___________________________________________________________________________________
             5. ___________________________________________________________________________________
             6. ___________________________________________________________________________________
         * **Suggested Tools from the Turn90 CBT Toolkit**:
           - Explicitly recommend 2-3 tools tailored to counteract this exact pattern:
             - **Stop & Think**: The 3-second pause before reacting to an authority figure or stressor.
             - **Thinking Report**: Writing out Situation -> Thoughts -> Physical Sensations -> Action -> Outcome to expose faulty beliefs.
             - **Problem Solving 4-Step Method**: 1. Define problem without blame, 2. Brainstorm 3 choices, 3. Weigh costs to freedom/job, 4. Act.
             - **Decisional Balance**: Immediate impulse payoff vs Long-term freedom & wages.
             - **Cognitive Restructuring**: Replacing the automatic thinking trap with a grounded, helpful thought.
             - **Modeling Neutrality**: De-escalating posture and tone, asking open-ended clarifying questions.
       - CRITICAL REQUIREMENT: DO NOT include a closing message. The plan should end immediately after the Suggested Tools for the third Area of Focus.
    4. "csv_row": The exact CSV row for Apricot import mapping to:
       ${csvHeader}
       (Use Apricot_Mapping.txt. If a question was unasked/unanswered, leave blank).
    5. "briefcase_autofill": A structured JSON object identifying participant barrier statuses and evaluating new Gate requirements to automatically update their profile:
       {
         "dl_status": "valid" | "suspended" | "reinstatement_plan",
         "dl_notes": "string",
         "child_support_status": "none" | "current" | "behind" | "modification_needed",
         "child_support_notes": "string",
         "housing_status": "stable" | "motel" | "shelter" | "facing_eviction",
         "transportation_status": "car" | "bus" | "needs_ride" | "none",
         "welvista_needed": true | false,
         "mental_health_referral": true | false,
         "substance_recovery_plan": true | false,
         "top_criminogenic_domains": ["string", "string", "string"],
         "detected_stability_flags": ["array of matching trigger keys if any"],
         
         "gates_autocomplete": {
           "g1_state_id": true | false, // True if they confirmed they have a physical ID/license
           "g1_ssn": true | false, // True if they have SSN card
           "g1_birth_cert": true | false, // True if they have birth certificate
           "g2_housing": true | false, // True if living situation is stable
           "g2_phone": true | false, // True if they have active phone
           "g4_transportation": true | false // True if they have reliable verified transportation
         }
       }
    
    Reference Manuals:
    ${manuals}
    
    You must return a valid JSON object with EXACTLY these five keys:
    {
      "final_scoring_form": "# Final Scoring Form\\n...",
      "case_brief": "# Case Brief\\n...",
      "participant_case_plan": "# My First Shift Action Plan\\n...",
      "csv_row": "val1,val2,val3,...",
      "briefcase_autofill": { ... }
    }`;

    const prompt = `${systemPrompt}\n\nClient Name: ${clientName}\nDate of Birth (DOB): ${resolvedBio.dob}\nCurrent Age: ${resolvedBio.age}\n\nTranscript:\n${transcriptText}\n\nDraft Scoring Form:\n${draftScoringForm}\n\nSupervisor Review Feedback:\n${feedback || 'Approved as drafted.'}\n\nCriminal History & Apricot Consultation Collateral Record:\n${combinedCollateral || 'None provided; inferred from interview.'}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = safeJsonParse(responseText);
    try {
        if (parsed && parsed.final_scoring_form) {
            parsed.final_scoring_form = validateAndNormalizeLscmiScoringForm(parsed.final_scoring_form, {
                fullName: clientName,
                recordId,
                dob: resolvedBio.dob,
                age: resolvedBio.age,
                center
            });
            parsed.final_scoring_form = stripReferenceExampleContamination(parsed.final_scoring_form, transcriptText);
        }
        if (parsed && parsed.case_brief) {
            parsed.case_brief = stripReferenceExampleContamination(parsed.case_brief, transcriptText);
        }
        if (parsed && parsed.participant_case_plan) {
            parsed.participant_case_plan = stripReferenceExampleContamination(parsed.participant_case_plan, transcriptText);
        }
        // Auto-sync Unified Gate-Free Briefcase (9 Waitlist Items + Conditional Medical Logic) & Participant Folder
        if (parsed && parsed.briefcase_autofill) {
            const bf = parsed.briefcase_autofill;
            const g = bf.gates_autocomplete || {};
            const hasChronic = Boolean(bf.welvista_needed && /chronic|medication|daily med|diabetes|hypertension|asthma|seizure/i.test(transcriptText));
            updateParticipantUnifiedBriefcase(clientName, {
                has_chronic_health_condition: hasChronic ? 'yes' : 'no',
                dl_is_suspended: bf.dl_status === 'suspended' ? 'yes' : 'no',
                child_support_applicable: (bf.child_support_status && bf.child_support_status !== 'none') ? 'yes' : 'no',
                items: {
                    state_id_or_dl: { value: bf.dl_status === 'valid' ? 'valid_dl' : (g.g1_state_id ? 'valid_state_id' : (bf.dl_status === 'suspended' ? 'dl_suspended_no_id' : 'missing')), notes: bf.dl_notes || '' },
                    ss_card: { value: g.g1_ssn ? 'verified_card' : 'missing', notes: '' },
                    birth_certificate: { value: g.g1_birth_cert ? 'verified_copy' : 'missing', notes: '' },
                    chronic_health_and_meds: { value: hasChronic ? 'needs_daily_med_access' : 'no_chronic_conditions_na', notes: hasChronic ? 'Chronic condition identified in LS/CMI' : 'No chronic condition requiring medical appointment/daily meds' },
                    stable_housing: { value: (bf.housing_status === 'stable' || g.g2_housing) ? 'stable_verified' : 'temporary_unstable', notes: bf.housing_status || '' },
                    reliable_phone: { value: g.g2_phone ? 'active_verified' : 'wifi_only', notes: '' },
                    dmv_suspended_inquiry: { value: bf.dl_status === 'suspended' ? 'needs_dmv_visit' : (bf.dl_status === 'reinstatement_plan' ? 'completed_dmv_inquiry' : 'not_applicable_valid'), notes: bf.dl_notes || '' },
                    child_support_contact: { value: (!bf.child_support_status || bf.child_support_status === 'none') ? 'not_applicable' : (bf.child_support_status === 'current' ? 'current_paid_up' : 'needs_contact'), notes: bf.child_support_notes || '' }
                }
            });
        }
        syncAllParticipantFolders();
    } catch (e) {}
    return parsed;
}

async function adjustActionPlan(clientName, existingPlanText, feedback, supportingContext = "", feedbackLoopMeta = {}) {
    assertValidGeminiApiKey();
    const model = getPipelineModel();

    const systemPrompt = `You are an expert case manager and CBT specialist for First Shift / Turn90.
Your task is to refine and update the Participant's First Shift Action Plan based STRICTLY on the Action Plan Feedback Loop (participant disagreement/collaboration or supervisor feedback), using the Probation and Parole Treatment Planner behavioral definitions, SYNAPSE (Navigate/Activate/Splash), and First Shift conversation scripts (Switching to Another Target / Giving Options of Intervention Tools).

STRICT ANTI-HALLUCINATION RULE:
- Never pull examples, character names, or scenarios from reference manuals.

CRITICAL FIRST SHIFT ACTION PLAN SPECIFICATIONS:
- Beautiful, empowering, PRINTABLE First Shift Action Plan written directly for the participant.
- Header: Participant Name, Date, Location, Program Track (Turn90 First Shift).
- CRITICAL REQUIREMENT: DO NOT INCLUDE ANY GOALS. Remove all goal sections entirely.
- Identify EXACTLY the TOP 3 Areas of Focus (these correspond to their criminogenic domains, but use highly accessible, less clinical language). For each of the 3 areas, structure into EXACTLY these 4 sections:
  * **Area of Focus & Core Goal**: (e.g., "Area of Focus: Handling Frustration & Anger | Core Goal: Staying calm when things don't go your way", rather than using clinical terms like 'Criminogenic Domain' or 'Hostile Attribution').
  * **Personal Pattern**: (The specific unhelpful thinking trap, defense mechanism, or automatic loop identified from their interview and Probation Planner Behavioral Definitions, explained in everyday language).
  * **Trigger Situations**:
    - Leave this section entirely empty so the participant and case manager can identify triggers together. Simply provide 5 to 8 numbered blank lines where the participant can write down specific situations that trigger this pattern:
      1. ___________________________________________________________________________________
      2. ___________________________________________________________________________________
      3. ___________________________________________________________________________________
      4. ___________________________________________________________________________________
      5. ___________________________________________________________________________________
      6. ___________________________________________________________________________________
  * **Suggested Tools from the Turn90 CBT Toolkit (1A–1N)**:
    - Explicitly recommend 2-3 tools tailored to counteract this exact pattern:
      - **Decision Making Tool (DMT - 1A) / Decisional Balance**: Immediate impulse payoff vs Long-term freedom & wages.
      - **Thought Tracker (1G) / Situation-Thinking-Action-Consequences (STAC - 1I/1K)**: Writing out Situation -> Thinking -> Action -> Consequence.
      - **Upgrading Beliefs (1D) / Call & Response (1F)**: Replacing rigid "should" or entitlement rules with pro-social counter-thoughts.
      - **Conflict Cycle (1M) / Three Steps to Problem Solving (1N)**: 1. Define problem without blame, 2. Brainstorm 3 choices, 3. Pick best option and act.
      - **Stop & Think / Two Voices Role Play**: The 3-second pause and rehearsing pro-social responses.
- CRITICAL REQUIREMENT: DO NOT include a closing message. The plan should end immediately after the Suggested Tools for the third Area of Focus.

INCORPORATE ACTION PLAN FEEDBACK LOOP ADJUSTMENTS:
If the participant disagreed with an Area of Focus or tool, pivot collaboratively to their agreed target or tool choice while keeping all 3 Areas of Focus grounded in their assessment.

You must return a valid JSON object with EXACTLY this key:
{
  "participant_case_plan": "# My First Shift Action Plan\\n..."
}`;

    const prompt = `${systemPrompt}\n\nParticipant Name: ${clientName}\n\nAction Plan Feedback Loop / Supervisor Adjustments:\n${feedback || 'Refine and polish the action plan based on standard Turn90 CBT practices.'}\n\nExisting Action Plan:\n${existingPlanText || 'None currently on file; generate new plan based on supporting context.'}\n\nSupporting Assessment Context:\n${supportingContext || 'None available.'}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const parsed = safeJsonParse(responseText);

    try {
        const slug = sanitizeParticipantSlug(clientName);
        if (parsed && parsed.participant_case_plan) {
            parsed.participant_case_plan = stripReferenceExampleContamination(parsed.participant_case_plan, supportingContext);
            db.prepare(`
                INSERT INTO action_plan_feedback_loops (
                    participant_key, participant_name, location, agreement_status,
                    disagreed_target, participant_objection_quote, staff_pivot_strategy,
                    agreed_replacement_target, selected_toolkit_tool, revised_action_plan_md, logged_by
                ) VALUES (?, ?, ?, 'resolved_via_feedback_loop', ?, ?, ?, ?, ?, ?, ?)
            `).run(
                slug,
                clientName,
                feedbackLoopMeta.location || 'Charleston',
                feedbackLoopMeta.disagreed_target || 'Initial Target Adjusted',
                feedback,
                feedbackLoopMeta.staff_pivot_strategy || 'switched_target_or_tool',
                feedbackLoopMeta.agreed_replacement_target || 'Updated Collaborative Target',
                feedbackLoopMeta.selected_toolkit_tool || 'STAC (1I) / DMT (1A)',
                parsed.participant_case_plan,
                feedbackLoopMeta.logged_by || 'Turn90 Case Manager'
            );
            const pDir = path.join(__dirname, 'data', 'participants', slug);
            if (fs.existsSync(pDir)) {
                fs.writeFileSync(path.join(pDir, 'action_plan.md'), parsed.participant_case_plan);
            }
            syncAllParticipantFolders();
        }
    } catch (e) {
        console.warn('[Action Plan Feedback Loop] Logging warning:', e.message);
    }

    return parsed;
}

module.exports = {
    runPhase1,
    runPhase1WithAudio,
    runPhase2,
    adjustActionPlan,
    generateDynamicLscmiNextQuestion,
    evaluateLive158QuestionTurn,
    mapQuestionIndexToLscmiDomain,
    buildConsultationAnchorSummary,
    detectDeterministicConsultationDiscrepancy,
    loadSingleLscmiDomainReference,
    safeJsonParse,
    validateAndNormalizeLscmiScoringForm
};

