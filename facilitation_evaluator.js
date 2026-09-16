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

function getFacilitatorScoringContext() {
    try {
        const guidePath = path.join(__dirname, 'data', 'Facilitator_Scoring_Guide.md');
        const guide = fs.readFileSync(guidePath, 'utf8');
        
        const curriculumPath = path.join(__dirname, 'cbt_curriculum_exact.json');
        const curriculum = fs.readFileSync(curriculumPath, 'utf8');

        return `
You are the Lead Facilitator Supervisor and Quality Assurance Director for Turn90 / First Shift.
You are evaluating a classroom session using the OFFICIAL Turn90 CBT Facilitation Scoring Guide (provided below).

=== OFFICIAL FACILITATOR SCORING GUIDE ===
${guide}

=== CURRICULUM LESSON PLANS (REFERENCE FOR LESSON ADHERENCE) ===
${curriculum}

INSTRUCTIONS:
Evaluate the facilitator based strictly on the above 20-item Scoring Guide. Reference the curriculum lesson plan to judge if they followed the script and setup correctly for the requested module.
Provide detailed coaching feedback based on specific timestamps and behaviors observed. 

You MUST format your entire response EXACTLY according to the following template. DO NOT write any conversational text before the JSON block. Start your response immediately with the \`{\` character.

{
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
    "Coaching recommendation 1...",
    "Coaching recommendation 2..."
  ],
  "location_specific_notes": "Key observations for this cohort location..."
}
=== SUMMARY ===
# Facilitation Evaluation Report

(Write your extensive markdown report here...)
`;
    } catch (e) {
        console.warn("Could not load official scoring guide or curriculum, using fallback prompt.");
        return `You are evaluating a classroom session transcript using the Turn90 CBT Facilitation Scoring Guide... (Fallback)`; 
    }
}

async function evaluateClassTranscript(location, sessionTitle, facilitatorName, transcriptText) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const prompt = `${getFacilitatorScoringContext()}

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

Classroom Transcript to Evaluate:
${transcriptText}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const evaluation = JSON.parse(responseText);

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
        facilitatorName || 'Staff Facilitator',
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
        if (file.toLowerCase().endsWith('.pdf') || file.toLowerCase().endsWith('.txt') || file.toLowerCase().endsWith('.md')) {
            const filePath = path.join(resourcesDir, file);
            console.log(`[Class Evaluation] Uploading background resource file ${file}...`);
            try {
                const uploadResult = await fileManager.uploadFile(filePath, {
                    mimeType: file.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain',
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

        const prompt = `${getFacilitatorScoringContext()}

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

Please listen to the attached classroom audio recording(s) for the day and evaluate the facilitator across the full day of classes. 
Note: These are AUDIO ONLY recordings. Do not penalize or refuse to score based on a lack of visual "physical presence". Instead, evaluate their presence and engagement purely through their tone of voice, pacing, neutrality, and interactions with participants across all attached sessions.

Use the provided official Turn90 Facilitation PDFs and curriculum documents to ground your feedback exactly in the Turn90 Evidence-Based CBT practices.
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

        const result = await model.generateContent(contentParts);
        const responseText = result.response.text();
        
        const parts = responseText.split('=== SUMMARY ===');
        const jsonPart = parts[0];
        const markdownPart = parts[1] ? parts[1].trim() : '';

        let evaluation;
        try {
            // First try strict parsing
            evaluation = JSON.parse(jsonPart);
        } catch (e) {
            // Fallback: extract substring from first { to last }
            const match = jsonPart.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    evaluation = JSON.parse(match[0]);
                } catch(err) {
                    console.error("[Class Evaluation] Extracted JSON was still invalid:", err);
                    throw new Error("AI returned invalid JSON syntax.");
                }
            } else {
                console.error("[Class Evaluation] No JSON object found in response:", responseText);
                throw new Error("AI did not return a JSON object. Raw output: " + responseText.substring(0, 500));
            }
        }

        // Attach the markdown part back to the evaluation object
        evaluation.detailed_summary_markdown = markdownPart;

        if (evaluation.total_score === undefined || !evaluation.scores) {
            console.error("[Class Evaluation] AI returned an invalid schema or refused the prompt:", responseText);
            throw new Error("AI returned invalid JSON schema. It may have refused to evaluate the audio.");
        }

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
            facilitatorName || 'Staff Facilitator',
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
