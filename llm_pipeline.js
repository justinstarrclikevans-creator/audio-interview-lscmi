const { getGeminiApiKey, assertValidGeminiApiKey } = require('./env_config');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

function getPipelineGenAI() {
    const apiKey = assertValidGeminiApiKey();
    return new GoogleGenerativeAI(apiKey);
}

function getPipelineModel() {
    const genAI = getPipelineGenAI();
    return genAI.getGenerativeModel({ 
        model: "gemini-3.1-pro-preview", 
        generationConfig: { 
            responseMimeType: "application/json",
            maxOutputTokens: 65536
        } 
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
   - For each question:
     - Bold the question title.
     - Provide the participant's direct quotes and evidence from the transcript AND/OR verified collateral from their Reentry Consultation / Intake Screening notes.
     - CRITICAL COLLATERAL PRE-FILL RULE: Official LS/CMI rules require synthesizing interview responses with collateral file review. Whenever an item (such as age at first arrest, total arrests/convictions, supervision status, education/GED, employment history, substance use history, parental criminal record, housing, or IDs/DL status) is documented in the Apricot Reentry Consultation / Intake Screening notes, use that verified information to answer the question and cite "[Verified via Reentry Consultation / Collateral Record]" if not repeated verbatim in the audio transcript.
     - CRITICAL: Interviewers rarely read the questions verbatim. They often paraphrase, ask conversational questions, or do rapid-fire Yes/No checklists. You MUST intelligently map their conversational answers to the appropriate LS/CMI questions.
     - ONLY say "Not explicitly discussed in intake interview" if the entire topic or domain was completely absent from BOTH the interview transcript and the Consultation collateral notes.
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
        if (audioBuffer.length > 100) {
            console.log(`[Audio Pipeline] Audio is > 20MB, uploading via Gemini REST API to bypass disk...`);
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
            audioPart = {
                inlineData: {
                    mimeType: mimeType || 'audio/webm',
                    data: audioBuffer.toString('base64')
                }
            };
        }

        // Stage 1: Full Verbatim Audio Transcription
        console.log(`[Audio Pipeline] Transcribing complete audio recording for ${clientName}...`);
        const transcriptionModel = genAI.getGenerativeModel({
            model: "gemini-3.1-pro-preview",
            generationConfig: { maxOutputTokens: 65536, temperature: 0.1 }
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
        const transcriptText = transcriptionResult.response.text();
        console.log(`[Audio Pipeline] Transcription complete. Length: ${transcriptText.length} characters.`);

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
        }
    } catch (e) {}
    return parsed;
}

async function adjustActionPlan(clientName, existingPlanText, feedback, supportingContext = "") {
    assertValidGeminiApiKey();
    const model = getPipelineModel();

    const systemPrompt = `You are an expert case manager and CBT specialist for First Shift / Turn90.
Your task is to refine and update the Participant's First Shift Action Plan based STRICTLY on the supervisor's feedback.

CRITICAL FIRST SHIFT ACTION PLAN SPECIFICATIONS:
- Beautiful, empowering, PRINTABLE First Shift Action Plan written directly for the participant.
- Header: Participant Name, Date, Location, Program Track (Turn90 First Shift).
- CRITICAL REQUIREMENT: DO NOT INCLUDE ANY GOALS. Remove all goal sections entirely.
- Identify EXACTLY the TOP 3 Areas of Focus (these correspond to their criminogenic domains, but use highly accessible, less clinical language). For each of the 3 areas, structure into EXACTLY these 4 sections:
  * **Area of Focus & Core Goal**: (e.g., "Area of Focus: Handling Frustration & Anger | Core Goal: Staying calm when things don't go your way", rather than using clinical terms like 'Criminogenic Domain' or 'Hostile Attribution').
  * **Personal Pattern**: (The specific unhelpful thinking trap, defense mechanism, or automatic loop identified from their interview, explained in everyday language, e.g., "Taking workplace feedback as a personal attack" or "Walking away or quitting when feeling overwhelmed").
  * **Trigger Situations**:
    - Leave this section entirely empty so the participant and case manager can identify triggers together. Simply provide 5 to 8 numbered blank lines where the participant can write down specific situations that trigger this pattern:
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

INCORPORATE SUPERVISOR ADJUSTMENTS:
Apply the supervisor's feedback to update the focus areas, personal patterns, trigger count, or suggested CBT tools accordingly.

You must return a valid JSON object with EXACTLY this key:
{
  "participant_case_plan": "# My First Shift Action Plan\\n..."
}`;

    const prompt = `${systemPrompt}\n\nParticipant Name: ${clientName}\n\nSupervisor Adjustments & Feedback:\n${feedback || 'Refine and polish the action plan based on standard Turn90 CBT practices.'}\n\nExisting Action Plan:\n${existingPlanText || 'None currently on file; generate new plan based on supporting context.'}\n\nSupporting Assessment Context:\n${supportingContext || 'None available.'}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
}

module.exports = { runPhase1, runPhase1WithAudio, runPhase2, adjustActionPlan, safeJsonParse, validateAndNormalizeLscmiScoringForm };

