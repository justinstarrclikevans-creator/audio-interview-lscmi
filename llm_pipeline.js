const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
});

const manualsDir = path.join(__dirname, 'manuals');

function loadManuals() {
    let manualsText = '';
    const files = fs.readdirSync(manualsDir);
    for (const file of files) {
        if (file.endsWith('.txt')) {
            manualsText += `\n\n=== MANUAL: ${file} ===\n`;
            manualsText += fs.readFileSync(path.join(manualsDir, file), 'utf8');
        }
    }
    return manualsText;
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

async function runPhase1(transcriptText, clientName) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const manuals = loadManuals();
    const systemPrompt = `You are an expert case manager and assessor for First Shift / Turn90.
    Phase 1 Task: Based on the provided 158-question LS/CMI interview transcript and assessment scoring manuals, complete:
    1. The comprehensive Interview Guide.
    2. The DRAFT LS/CMI Scoring Form.
    
    Reference Manuals:
    ${manuals}
    
    You must return a valid JSON object with EXACTLY these two keys:
    {
      "interview_guide": "# Interview Guide\\n...",
      "draft_scoring_form": "# Draft Scoring Form\\n..."
    }
    
    Format requirements:
    - Follow LS/CMI Scoring Manual rules strictly.
    - Be thorough, evidence-based, and objective.`;

    const prompt = `${systemPrompt}\n\nClient Name: ${clientName}\n\nInterview Transcript:\n${transcriptText}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
}

// Process Audio Uploads Directly with Gemini Multimodal Processing
async function runPhase1WithAudio(audioBuffer, mimeType, clientName, location, additionalNotes = "") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const manuals = loadManuals();
    const systemPrompt = `You are an expert case manager and LS/CMI assessor for First Shift / Turn90.
Phase 1 Audio Task: Listen to the attached audio recording of the intake assessment interview with participant "${clientName}" conducted at the Turn90 ${location} center.
Using the audio interview and the assessment scoring manuals provided below, complete the following three requirements:

1. "transcript": Provide a high-quality, verbatim text transcript of the audio interview.
2. "interview_guide": Complete the comprehensive 158-question LS/CMI Interview Guide incorporating the participant's direct quotes and responses.
3. "draft_scoring_form": Complete the Phase 1 DRAFT LS/CMI Scoring Form strictly following the scoring rules in the manual, evaluating all 8 subcomponents (Criminal History, Education/Employment, Family/Marital, Leisure/Recreation, Companions, Alcohol/Drug Problem, Procriminal Attitude/Orientation, Antisocial Pattern) and identifying clear strengths (rated 0) and high risk/needs (rated 2 or 3).

${additionalNotes && additionalNotes.trim() ? `Additional Intake Notes:\n${additionalNotes}\n\n` : ''}

Reference Manuals:
${manuals}

You must return a valid JSON object with EXACTLY these three keys:
{
  "transcript": "Verbatim transcript of the interview...",
  "interview_guide": "# Interview Guide\\n...",
  "draft_scoring_form": "# Draft Scoring Form\\n..."
}

Format requirements:
- Follow LS/CMI Scoring Manual rules strictly.
- Be thorough, evidence-based, and objective.`;

    // Package audio: inline base64 if <= 20MB, or GoogleAIFileManager if > 20MB
    let audioPart;
    const { GoogleAIFileManager } = require('@google/generative-ai/server');
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    let tempFilePath = null;
    try {
        if (audioBuffer.length > 20 * 1024 * 1024) {
            tempFilePath = path.join(__dirname, 'data', `temp_audio_${Date.now()}.webm`);
            fs.writeFileSync(tempFilePath, audioBuffer);
            const uploadResult = await fileManager.uploadFile(tempFilePath, {
                mimeType: mimeType || 'audio/webm',
                displayName: `${clientName}_interview_audio`
            });
            audioPart = { fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri } };
        } else {
            audioPart = {
                inlineData: {
                    mimeType: mimeType || 'audio/webm',
                    data: audioBuffer.toString('base64')
                }
            };
        }

        const result = await model.generateContent([
            audioPart,
            { text: systemPrompt }
        ]);

        const responseText = result.response.text();
        return safeJsonParse(responseText);
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch(e) {}
        }
    }
}

async function runPhase2(transcriptText, clientName, draftScoringForm, feedback, criminalHistoryText = "") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const manuals = loadManuals();
    const csvHeader = getCsvHeader();
    
    const systemPrompt = `You are an experienced case manager and assessor for First Shift / Turn90.
    Phase 2 Task: Incorporate Program Manager review feedback and any Criminal History record into the assessment, and produce:
    
    1. "final_scoring_form": The completed, validated LS/CMI Scoring Form.
    2. "case_brief": The Program Manager Case Brief.
       - Use the Probation and Parole Treatment Planner & Scoring Manual.
       - Identify the TOP 2-3 Dynamic Criminogenic Need Domains (NEVER choose Criminal History, as it is static).
       - Detail primary stability factors (housing, driver's license, child support, transportation, health/meds).
    3. "participant_case_plan": A beautiful, empowering, PRINTABLE First Shift Action Plan written directly for the participant.
       - Header: Participant Name, Date, Location, Program Track (Turn90 First Shift).
       - CRITICAL REQUIREMENT: DO NOT INCLUDE ANY GOALS. Remove all goal sections entirely.
       - For each of the TOP 2-3 Dynamic Criminogenic Domains identified for this participant, structure into EXACTLY these 4 sections:
         * **Domain & Dynamic Need**: (e.g., "Domain: Pro-Criminal Attitudes & Thinking Patterns | Core Need: Rewiring Automatic Assumptions & Hostile Attribution").
         * **Identified Cognitive / Behavioral Pattern**: (The specific unhelpful thinking trap, defense mechanism, or automatic loop identified from their interview, e.g., "Interpreting workplace feedback as personal disrespect", "Externalizing responsibility when rules are enforced", "Black-and-white thinking when stressed").
         * **Trigger Situations (High-Risk Traps to Fill In)**:
           - Provide initial examples from their story PLUS clear structured prompts/fill-in lines for the participant and case manager to complete together:
             - [ ] Specific People / Past Associations: ___________________________
             - [ ] High-Risk Environments / Neighborhoods / Places: ___________________________
             - [ ] Emotional / Physical States (HALT - Hungry, Angry, Lonely, Tired, Stressed): ___________________________
             - [ ] Specific Workplace / Authority Situations (e.g., unexpected overtime, supervisor correction, coworker friction): ___________________________
         * **Suggested Tools to Apply from the Turn90 CBT Toolkit**:
           - Explicitly recommend 2-3 tools tailored to counteract this exact pattern:
             - **Stop & Think**: The 3-second pause before reacting to an authority figure or stressor.
             - **Thinking Report**: Writing out Situation -> Thoughts -> Physical Sensations -> Action -> Outcome to expose faulty beliefs.
             - **Problem Solving 4-Step Method**: 1. Define problem without blame, 2. Brainstorm 3 choices, 3. Weigh costs to freedom/job, 4. Act.
             - **Decisional Balance**: Immediate impulse payoff vs Long-term freedom & wages.
             - **Cognitive Restructuring**: Replacing the automatic thinking trap with a grounded, helpful thought.
             - **Modeling Neutrality**: De-escalating posture and tone, asking open-ended clarifying questions.
       - Conclude with a strong, motivating closing message recognizing the participant's resilience and strengths.
    4. "csv_row": The exact CSV row for Apricot import mapping to:
       ${csvHeader}
       (Use Apricot_Mapping.txt. If a question was unasked/unanswered, leave blank).
    5. "briefcase_autofill": A structured JSON object identifying participant barrier statuses to automatically update their profile and briefcase:
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
         "top_criminogenic_domains": ["string", "string"],
         "detected_stability_flags": ["array of matching trigger keys if any"]
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

    const prompt = `${systemPrompt}\n\nClient Name: ${clientName}\n\nTranscript:\n${transcriptText}\n\nDraft Scoring Form:\n${draftScoringForm}\n\nSupervisor Review Feedback:\n${feedback || 'Approved as drafted.'}\n\nCriminal History Record Text:\n${criminalHistoryText || 'None provided; inferred from interview.'}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
}

module.exports = { runPhase1, runPhase1WithAudio, runPhase2, safeJsonParse };
