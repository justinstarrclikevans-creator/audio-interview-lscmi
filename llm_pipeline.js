const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-pro-preview", 
    generationConfig: { 
        responseMimeType: "application/json",
        maxOutputTokens: 65536
    } 
});

const manualsDir = path.join(__dirname, 'manuals');

function loadManuals() {
    let manualsText = '';
    
    // Prioritize official LS/CMI Scoring Guide & Standards at the top
    const primaryGuide = path.join(manualsDir, 'LS_CMI_Scoring_Guide.md');
    if (fs.existsSync(primaryGuide)) {
        manualsText += `\n\n=== OFFICIAL LS/CMI SCORING GUIDE & ITEM CRITERIA ===\n`;
        manualsText += fs.readFileSync(primaryGuide, 'utf8');
    }

    const files = fs.readdirSync(manualsDir);
    for (const file of files) {
        if ((file.endsWith('.txt') || file.endsWith('.md')) && file !== 'LS_CMI_Scoring_Guide.md') {
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

async function runPhase1(transcriptText, clientName, location = "", additionalNotes = "") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const manuals = loadManuals();
    const systemPrompt = `You are an expert case manager and LS/CMI assessor for First Shift / Turn90.
Phase 1 Task: Based on the provided LS/CMI interview transcript and assessment scoring manuals, produce:
1. "interview_guide": The COMPLETE, UNABBREVIATED 158-question LS/CMI Interview Guide.
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
     - Provide the participant's direct quotes and evidence from the transcript.
     - CRITICAL: Interviewers rarely read the questions verbatim. They often paraphrase, ask conversational questions, or do rapid-fire Yes/No checklists. You MUST intelligently map their conversational answers to the appropriate LS/CMI questions. 
     - ONLY say "Not explicitly discussed in intake interview" if the entire topic or domain was completely skipped. If they discussed the topic (e.g., family relationships, school suspensions, drug use) in ANY way, use that context to answer the related questions.
   - DO NOT truncate, skip, or summarize questions. Provide all questions systematically.
   - Do NOT use the word "clinical". Use "behavioral health", "support", or "assessment" instead.
   - Do NOT reference Route 66.
2. "draft_scoring_form": The comprehensive Phase 1 DRAFT LS/CMI Scoring Form evaluating all 8 Section 1 subcomponents (Criminal History, Education/Employment, Family/Marital, Leisure/Recreation, Companions, Alcohol/Drug Problem, Procriminal Attitude/Orientation, Antisocial Pattern) and Section 2-6 factors strictly following the scoring rules in the manual, identifying clear strengths (rated 0) and high risk/needs (rated 2 or 3). Include subcomponent scores, total score, and risk category.

${additionalNotes && additionalNotes.trim() ? `Additional Intake Notes:\n${additionalNotes}\n\n` : ''}

Reference Manuals:
${manuals}

You must return a valid JSON object with EXACTLY these two keys:
{
  "interview_guide": "# Turn90 / First Shift: LS/CMI Standardized Assessment Interview Guide\\n...",
  "draft_scoring_form": "# LS/CMI Draft Scoring Form\\n..."
}

Format requirements:
- Follow LS/CMI Scoring Manual rules strictly.
- Be thorough, evidence-based, objective, and complete.`;

    const prompt = `${systemPrompt}\n\nClient Name: ${clientName}\nLocation: ${location || 'Turn90 Center'}\n\nInterview Transcript:\n${transcriptText}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return safeJsonParse(responseText);
}

// Process Audio Uploads with High-Fidelity 2-Stage Gemini Pipeline
async function runPhase1WithAudio(audioBuffer, mimeType, clientName, location, additionalNotes = "") {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    // Package audio: inline base64 if <= 20MB, or GoogleAIFileManager if > 20MB
    let audioPart;
    let uploadedFileName = null;
    try {
        if (audioBuffer.length > 20 * 1024 * 1024) {
            console.log(`[Audio Pipeline] Audio is > 20MB, uploading via Gemini REST API to bypass disk...`);
            const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${process.env.GEMINI_API_KEY}`;
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
- CRITICAL: Interviewers often ask questions conversationally or rapidly go through a checklist without reading the full question out loud. Capture all of these conversational cues perfectly, because they will be used to score an assessment later.`;

        const transcriptionResult = await transcriptionModel.generateContent([audioPart, { text: transcriptionPrompt }]);
        const transcriptText = transcriptionResult.response.text();
        console.log(`[Audio Pipeline] Transcription complete. Length: ${transcriptText.length} characters.`);

        // Stage 2: LS/CMI Information Extraction
        console.log(`[Audio Pipeline] Extracting LS/CMI scoring data from transcript for ${clientName}...`);
        const extractionModel = genAI.getGenerativeModel({
            model: "gemini-3.1-pro-preview",
            generationConfig: { responseMimeType: "application/json" }
        });

        // Stage 2: Comprehensive 158-Question Interview Guide & Draft Scoring Form
        console.log(`[Audio Pipeline] Generating full 158-question Interview Guide and Draft Scoring Form for ${clientName}...`);
        const phase1Output = await runPhase1(transcriptText, clientName, location, additionalNotes);

        return {
            transcript: transcriptText,
            interview_guide: phase1Output.interview_guide,
            draft_scoring_form: phase1Output.draft_scoring_form
        };
    } finally {
        if (uploadedFileName) {
            try {
                const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${process.env.GEMINI_API_KEY}`;
                await fetch(deleteUrl, { method: 'DELETE' });
                console.log(`[Audio Pipeline] Deleted temporary audio file from Gemini: ${uploadedFileName}`);
            } catch(e) {
                console.error(`[Audio Pipeline] Failed to delete temporary audio file:`, e);
            }
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
