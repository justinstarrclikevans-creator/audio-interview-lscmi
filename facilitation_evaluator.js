// Class Facilitation Evaluator
// Evaluates class transcripts/audio against the 20-item Turn90 Facilitator Scoring Guide & Module Workbooks
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
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

Return ONLY valid JSON matching this exact structure:
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
  "location_specific_notes": "Key observations for this cohort location...",
  "detailed_summary_markdown": "# Facilitation Evaluation Report\\n\\n..."
}
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

async function evaluateClassMedia(location, sessionTitle, facilitatorName, filePath, mimeType) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const { GoogleAIFileManager } = require("@google/generative-ai/server");
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    console.log(`[Class Evaluation] Uploading media to Gemini for ${location}...`);
    const uploadResult = await fileManager.uploadFile(filePath, {
        mimeType: mimeType || 'video/mp4',
        displayName: `${location}_Class_Evaluation`
    });

    try {
        const prompt = `${getFacilitatorScoringContext()}

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

Please watch/listen to the attached classroom recording and evaluate the facilitator. Pay special attention to their physical presence, tone of voice, pacing, and neutrality.
`;

        console.log(`[Class Evaluation] Generating evaluation for ${location}...`);
        const result = await model.generateContent([
            { fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri } },
            { text: prompt }
        ]);
        const responseText = result.response.text();
        
        let evaluation;
        try {
            evaluation = JSON.parse(responseText);
        } catch (e) {
            // Strip markdown formatting if any
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            evaluation = JSON.parse(cleanJson);
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
        console.log(`[Class Evaluation] Deleting temporary file from Gemini...`);
        try {
            await fileManager.deleteFile(uploadResult.file.name);
        } catch (err) {
            console.error("Failed to delete file from Gemini:", err);
        }
    }
}

module.exports = { evaluateClassTranscript, evaluateClassMedia };
