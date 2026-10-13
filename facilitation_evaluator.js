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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const LANGUAGE_POLICY = `
================================================================================
CRITICAL POLICY: SLANG AND PROFANITY ARE 100% ACCEPTABLE AND NOT UNPROFESSIONAL
================================================================================
Turn90 is an authentic cognitive-behavioral reentry program working directly with formerly incarcerated men.
In our classroom setting:
1. SLANG AND PROFANITY ARE COMPLETELY ACCEPTABLE AND ARE NEVER CONSIDERED UNPROFESSIONAL.
2. Colloquial speech, street slang, African American Vernacular English (AAVE), informal phrasing, and profanity/cussing are normal, authentic, and welcomed in our classroom environment. They build genuine credibility and rapport between facilitators and participants.
3. ABSOLUTE ZERO PENALTY RULE:
   - NEVER penalize, deduct points, or lower any category score (including "Models behavior", "Modeling neutrality", or total score) for the use of slang, informal phrasing, or profanity.
   - NEVER list slang, cussing, or profanity in "areas_for_improvement", coaching feedback, or anywhere in the evaluation report as a negative or area for growth.
   - NEVER recommend that a facilitator "clean up their language," "use more professional phrasing," or "avoid street slang or profanity."
4. THE ONLY EXCEPTION: If profanity is used in an abusive, violent, or aggressive direct personal attack against a participant. Otherwise, conversational, casual, humorous, emphatic, or cultural slang and profanity are 100% permitted, supported, and validated.
================================================================================
`;

function sanitizeLanguageFeedback(evaluation) {
    if (!evaluation) return evaluation;

    if (Array.isArray(evaluation.areas_for_improvement)) {
        evaluation.areas_for_improvement = evaluation.areas_for_improvement.filter(item => {
            if (typeof item !== 'string') return true;
            const lower = item.toLowerCase();
            const mentionsLang = lower.includes('profan') || lower.includes('slang') || lower.includes('vulgar') || 
                                 lower.includes('swear') || lower.includes('curse') || lower.includes('cuss') ||
                                 lower.includes('language') || lower.includes('shorthand expression');
            const isNegative = lower.includes('unprofessional') || lower.includes('clean up') || lower.includes('avoid') || 
                               lower.includes('refrain') || lower.includes('inappropriate') || lower.includes('pissed off') ||
                               lower.includes('fucked up') || lower.includes('tone down') || lower.includes('formal');
            return !(mentionsLang && isNegative);
        });
    }

    if (evaluation.detailed_summary_markdown && typeof evaluation.detailed_summary_markdown === 'string') {
        evaluation.detailed_summary_markdown = evaluation.detailed_summary_markdown
            .split('\n\n')
            .filter(para => {
                const lower = para.toLowerCase();
                const mentionsLang = lower.includes('profan') || lower.includes('slang') || lower.includes('vulgar') || lower.includes('swearing');
                const isNegative = lower.includes('unprofessional') || lower.includes('clean up') || lower.includes('avoid using') || lower.includes('refrain from');
                return !(mentionsLang && isNegative);
            })
            .join('\n\n');
    }

    return evaluation;
}

function getFacilitatorScoringContext() {
    try {
        const guidePath = path.join(__dirname, 'data', 'Facilitator_Scoring_Guide.md');
        const guide = fs.readFileSync(guidePath, 'utf8');
        
        const curriculumPath = path.join(__dirname, 'cbt_curriculum_exact.json');
        const curriculum = fs.readFileSync(curriculumPath, 'utf8');

        return `
${LANGUAGE_POLICY}

You are the Lead Facilitator Supervisor and Quality Assurance Director for Turn90 / First Shift.
You are evaluating a classroom session using the OFFICIAL Turn90 CBT Facilitation Scoring Guide (provided below).

=== OFFICIAL FACILITATOR SCORING GUIDE ===
${guide}

=== CURRICULUM LESSON PLANS (REFERENCE FOR LESSON ADHERENCE) ===
${curriculum}

INSTRUCTIONS:
Evaluate the facilitator based strictly on the above 20-item Scoring Guide. Reference the curriculum lesson plan to judge if they followed the script and setup correctly for the requested module.
Provide detailed coaching feedback based on specific timestamps and behaviors observed.

${LANGUAGE_POLICY}
`;
    } catch (e) {
        console.warn("Could not load official scoring guide or curriculum, using fallback prompt.");
        return `You are evaluating a classroom session transcript using the Turn90 CBT Facilitation Scoring Guide...\n${LANGUAGE_POLICY}`; 
    }
}

async function evaluateClassTranscript(location, sessionTitle, facilitatorName, transcriptText) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const prompt = `${getFacilitatorScoringContext()}

CRITICAL ISOLATION & OBJECTIVITY MANDATES:
1. STRICT CENTER SEPARATION:
   You are evaluating ONLY the cohort at ${location}.
   Each Turn90 Center (Charleston, Columbia, Spartanburg) operates with complete autonomy.
   Do NOT compare, reference, or pull in information, participants, or staff from other centers. Keep this report 100% focused on ${location}.

2. STRICT FACILITATOR SEPARATION:
   You are evaluating ONLY the individual facilitator leading this specific session.
   Do NOT grade or penalize them on what another facilitator did in another session or shift (e.g., do not blend morning and afternoon facilitators).
   Evaluate purely their individual facilitation skills, neutrality, pacing, and CBT delivery during this specific session.
   If the facilitator introduces themselves by name or is addressed by name, record their actual name in "facilitator_name". If not mentioned, use "${facilitatorName}".

3. ZERO EXTERNAL / MANUAL HALLUCINATIONS:
   Every single observation, timestamp, score, and coaching recommendation MUST come DIRECTLY and EXCLUSIVELY from what is in THIS transcript.
   Do NOT pull in fictional names, case studies (such as "Marcus"), or hypothetical scenarios from training manuals or workbooks.
   If a participant's name is not explicitly stated in the transcript, refer to them neutrally as "a participant" or "the participant."

4. NON-NEGOTIABLE POLICY: SLANG AND PROFANITY ARE FULLY ACCEPTABLE AND NOT UNPROFESSIONAL:
   Slang, colloquial expressions, cultural vernacular (AAVE), and profanity are authentic communication tools in our setting.
   - NEVER penalize or lower any score for the use of slang or profanity.
   - NEVER list slang or profanity in "areas_for_improvement" or suggest more "professional" language.

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

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
        evaluation = JSON.parse(responseText);
    }

    // Apply language policy sanitizer to guarantee zero slang/profanity penalties
    sanitizeLanguageFeedback(evaluation);

    const savedFacilitator = (evaluation.facilitator_name && evaluation.facilitator_name !== 'Staff Facilitator')
        ? evaluation.facilitator_name
        : (facilitatorName || 'Staff Facilitator');

    // Save to database
    const stmt = db.prepare(`
        INSERT INTO class_facilitation_evaluations (
            location, session_title, facilitator_name, total_score,
            modeling_neutrality_score, lesson_plan_adherence_score,
            reflective_listening_score, avoiding_confrontation_score,
            summary_markdown, scores_json, coaching_feedback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        location,
        sessionTitle,
        savedFacilitator,
        evaluation.total_score || 88,
        evaluation.scores?.modeling_neutrality || 4.5,
        evaluation.scores?.lesson_plan_adherence || 4.5,
        evaluation.scores?.reflective_listening || 4.5,
        evaluation.scores?.avoiding_confrontation || 5,
        evaluation.detailed_summary_markdown || '',
        JSON.stringify(evaluation.scores || {}),
        (evaluation.areas_for_improvement || []).join('; ')
    );

    return evaluation;
}

async function uploadFacilitationResources(fileManager) {
    const resourcesDir = path.join(__dirname, '..', 'Facilitation Scoring');
    if (!fs.existsSync(resourcesDir)) return [];
    
    const files = fs.readdirSync(resourcesDir);
    const uploadedResources = [];
    
    for (const file of files) {
        const lower = file.toLowerCase();
        // ONLY upload pure rubrics and methodology standards (e.g. Synapse, Neutrality).
        // NEVER upload training workbooks that contain mock case studies (e.g. Marcus, practice cases) which cause AI hallucinations!
        const isExcluded = lower.includes('workbook') || lower.includes('lesson plan') || lower.includes('case') || lower.includes('sample') || lower.includes('module');
        if (!isExcluded && (lower.endsWith('.pdf') || lower.endsWith('.txt') || lower.endsWith('.md')) && 
            (lower.includes('guide') || lower.includes('synapse') || lower.includes('scoring') || lower.includes('neutrality'))) {
            const filePath = path.join(resourcesDir, file);
            console.log(`[Class Evaluation] Uploading background resource file ${file}...`);
            try {
                const uploadResult = await fileManager.uploadFile(filePath, {
                    mimeType: lower.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
                    displayName: file.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)
                });
                uploadedResources.push({
                    fileUri: uploadResult.file.uri,
                    mimeType: uploadResult.file.mimeType,
                    name: uploadResult.file.name // To delete later
                });
            } catch (err) {
                console.error(`[Class Evaluation] Failed to upload resource ${file}:`, err.message);
            }
        }
    }
    
    return uploadedResources;
}

async function evaluateClassMedia(location, sessionTitle, facilitatorName, mediaFiles) {
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
            const uploadResult = await fileManager.uploadFile(mf.path, {
                mimeType: mf.mimeType || 'video/mp4',
                displayName: `${location}_Class_Evaluation_${Date.now()}`
            });
            uploadResults.push(uploadResult);
            
            // Immediately delete local file to free disk space
            const fs = require('fs');
            if (fs.existsSync(mf.path)) {
                try { fs.unlinkSync(mf.path); } catch(e) {}
            }
        }
    }
    
    let uploadedResources = [];

    try {
        uploadedResources = await uploadFacilitationResources(fileManager);

        const prompt = `You are the Lead Facilitator Supervisor and Quality Assurance Director for Turn90 / First Shift.
Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

${getFacilitatorScoringContext()}

CRITICAL ISOLATION & OBJECTIVITY MANDATES:
1. STRICT CENTER SEPARATION:
   You are evaluating ONLY the cohort at ${location}.
   Each Turn90 Center (Charleston, Columbia, Spartanburg) operates with complete autonomy.
   Do NOT compare, reference, or pull in information, participants, or staff from other centers. Keep this report 100% focused on ${location}.

2. STRICT FACILITATOR SEPARATION:
   You are evaluating ONLY the individual facilitator leading this specific session recording.
   Do NOT grade or penalize them on what another facilitator did in another session or shift (e.g., do not blend morning and afternoon facilitators).
   Evaluate purely their individual facilitation skills, neutrality, pacing, and CBT delivery during this specific recording.
   If the facilitator introduces themselves by name or is addressed by name in the audio, record their actual name in the "facilitator_name" field. If not mentioned, use "${facilitatorName}".

3. ZERO EXTERNAL / MANUAL HALLUCINATIONS:
   Every single observation, timestamp, score, and coaching recommendation MUST come DIRECTLY and EXCLUSIVELY from what is audibly spoken and heard in THIS recording.
   Do NOT pull in fictional names, case studies (such as "Marcus"), or hypothetical scenarios from training manuals or workbooks.
   If a participant's name is not explicitly spoken in the audio, refer to them neutrally as "a participant" or "the participant."

4. AUDIO-ONLY CRITERIA:
   These are AUDIO ONLY recordings. Do not penalize or refuse to score based on a lack of visual "physical presence". Instead, evaluate their presence and engagement purely through their tone of voice, pacing, neutrality, and interactions with participants across this session.

5. NON-NEGOTIABLE POLICY: SLANG AND PROFANITY ARE FULLY ACCEPTABLE AND NOT UNPROFESSIONAL:
   In our setting, slang, street vernacular, cultural idioms (AAVE), and profanity are authentic communication tools. They build genuine rapport.
   - NEVER penalize, deduct points, or lower any category score for the use of slang or profanity.
   - NEVER list slang or profanity in "areas_for_improvement" or coaching recommendations.
   - NEVER advise a facilitator to use "more professional language" or avoid slang/cussing.

Use the provided official Turn90 Facilitation PDFs and curriculum documents to ground your feedback exactly in the Turn90 Evidence-Based CBT practices.

CRITICAL OUTPUT REQUIREMENT:
You MUST provide your response in two distinct parts.

Part 1: The Numerical Data
Provide a valid JSON code block with the scores and brief notes.
\`\`\`json
{
  "facilitator_name": "Audibly identified facilitator name, or '${facilitatorName}'",
  "total_score": 85,
  "scores": {
    "modeling_neutrality": 4.5,
    "lesson_plan_adherence": 3.0,
    "reflective_listening": 4.0,
    "avoiding_confrontation": 5.0,
    "time_management": 4.0,
    "enthusiasm": 5.0
  },
  "observed_strengths": [
    "Observed strength 1...",
    "Observed strength 2..."
  ],
  "areas_for_improvement": [
    "Coaching recommendation 1 (DO NOT critique slang or profanity)...",
    "Coaching recommendation 2..."
  ],
  "location_specific_notes": "Key observations for ${location} only..."
}
\`\`\`

Part 2: The Full Report
After the JSON block, write your detailed, extensive coaching report in standard markdown format (do not put this inside the JSON).
CRITICAL RULE: DO NOT criticize, penalize, or mention slang or profanity as a negative anywhere in this report. Slang and profanity are 100% acceptable and not considered unprofessional in our setting.
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
        let markdownPart = responseText; // Default to full text if json extraction is weird

        // Extract the JSON block
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        
        if (jsonMatch) {
            try {
                evaluation = JSON.parse(jsonMatch[1]);
                // Remove the json block from the markdown report
                markdownPart = responseText.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
            } catch(err) {
                console.error("[Class Evaluation] Extracted JSON was still invalid:", err);
                throw new Error("AI returned invalid JSON syntax. Raw: " + jsonMatch[1].substring(0, 500));
            }
        } else {
            // Fallback: try to find any { ... } if they forgot backticks
            const bracketMatch = responseText.match(/\{[\s\S]*\}/);
            if (bracketMatch) {
                try {
                    evaluation = JSON.parse(bracketMatch[0]);
                    markdownPart = responseText.replace(/\{[\s\S]*\}/, '').trim();
                } catch(err) {
                    console.error("[Class Evaluation] Extracted bracket JSON was invalid:", err);
                    throw new Error("AI returned invalid JSON syntax. Raw: " + responseText.substring(0, 500));
                }
            } else {
                console.error("[Class Evaluation] No JSON object found in response:", responseText);
                throw new Error("AI did not return a JSON object. Raw output: " + responseText.substring(0, 500));
            }
        }
        
        // Attach the markdown part back to the evaluation object
        evaluation.detailed_summary_markdown = markdownPart || "No detailed summary provided.";

        if (evaluation.total_score === undefined || !evaluation.scores) {
            console.error("[Class Evaluation] AI returned an invalid schema or refused the prompt:", responseText);
            throw new Error("AI returned invalid JSON schema. It may have refused to evaluate the audio.");
        }

        // Apply language policy sanitizer to guarantee zero slang/profanity penalties
        sanitizeLanguageFeedback(evaluation);

        const savedFacilitator = (evaluation.facilitator_name && evaluation.facilitator_name !== 'Staff Facilitator')
            ? evaluation.facilitator_name
            : (facilitatorName || 'Staff Facilitator');

        // Save to database
        const stmt = db.prepare(`
            INSERT INTO class_facilitation_evaluations (
                location, session_title, facilitator_name, total_score,
                modeling_neutrality_score, lesson_plan_adherence_score,
                reflective_listening_score, avoiding_confrontation_score,
                summary_markdown, scores_json, coaching_feedback
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            location,
            sessionTitle,
            savedFacilitator,
            evaluation.total_score || 88,
            evaluation.scores?.modeling_neutrality || 4.5,
            evaluation.scores?.lesson_plan_adherence || 4.5,
            evaluation.scores?.reflective_listening || 4.5,
            evaluation.scores?.avoiding_confrontation || 5,
            evaluation.detailed_summary_markdown || '',
            JSON.stringify(evaluation.scores || {}),
            (evaluation.areas_for_improvement || []).join('; ')
        );

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

module.exports = { evaluateClassTranscript, evaluateClassMedia };
