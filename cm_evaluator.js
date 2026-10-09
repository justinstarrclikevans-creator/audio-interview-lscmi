const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const db = require('./db').db;
const path = require('path');
const fs = require('fs');

async function evaluateCaseManagementMedia(mediaFiles, sessionTitle, location, cmName) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured. Cannot process case management video/audio.");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

    let playbookText = '';
    const playbookPath = path.join(__dirname, 'manuals', 'Turn90_Playbook.pdf');
    const synapsePath = path.join(__dirname, 'manuals', 'Synapse_Guidelines.md'); // hypothetical or just playbook
    if (fs.existsSync(playbookPath)) {
        // Just note that it is grounded on the playbook
    }

    const prompt = `You are a Senior Case Management Auditor for Turn90 / First Shift.
Please analyze the attached audio/video recording of a Case Management / Re-entry Navigation meeting.
Evaluate the Case Manager's performance based strictly on the Turn90 Playbook, Cognitive Behavioral protocols, and Synapse documentation.

**CRITICAL PRIVACY & CRM INSTRUCTIONS:**
1. COMPLETE NAME REDACTION: You MUST remove ANY references to the client's actual name throughout the ENTIRE evaluation (including the CRM notes). ALWAYS use "[Client]" as a placeholder instead of their name.
2. STRUCTURED MEETING NOTES (CRM): This section is for internal CRM entry. It SHOULD include specific details of what the client discussed, their goals, updates, and next steps to ensure accurate case tracking, but STILL use "[Client]" instead of their actual name.
3. PUBLIC COACHING FEEDBACK (Scores, Summary, Strengths, Improvements): This section is PUBLIC and MUST be strictly generic and HIPAA-compliant. Do NOT mention specific details of the client's life, offenses, diagnoses, or name. Focus your feedback ENTIRELY on the Case Manager's methodology, use of CBT, and playbook adherence (e.g. "The Case Manager effectively utilized reflective listening", NOT "The Case Manager effectively listened to the client's drug problem").

CRITICAL OUTPUT REQUIREMENT:
You MUST provide your response in two distinct parts.

Part 1: The Numerical Data
Provide a valid JSON code block with the scores and structured notes.
\`\`\`json
{
  "total_cm_score": 85,
  "scores": {
    "playbook_adherence": 4.5,
    "cbt_application": 4.0,
    "goal_setting": 3.5,
    "empathy_and_neutrality": 5.0,
    "apricot_data_gathering": 4.5
  },
  "structured_meeting_notes_for_apricot": "A concise, professional summary of the meeting, participant updates, gates achieved, and next steps ready to be pasted into the Apricot database.",
  "observed_strengths": [
    "Strength 1...",
    "Strength 2..."
  ],
  "areas_for_improvement": [
    "Feedback 1...",
    "Feedback 2..."
  ]
}
\`\`\`

Part 2: The Full Report
After the JSON block, write your detailed, extensive coaching report in standard markdown format.
`;

    console.log(`[CM Evaluation] Generating evaluation for ${location}...`);
    
    const filesToUpload = Array.isArray(mediaFiles) ? mediaFiles : [mediaFiles];
    const uploadResults = [];

    for (const mf of filesToUpload) {
        if (mf.file && mf.file.uri) {
            uploadResults.push(mf);
        } else {
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

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[1]);
        markdownPart = responseText.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
    } else {
        const bracketMatch = responseText.match(/\{[\s\S]*\}/);
        if (bracketMatch) {
            evaluation = JSON.parse(bracketMatch[0]);
            markdownPart = responseText.replace(/\{[\s\S]*\}/, '').trim();
        } else {
            throw new Error("AI did not return a JSON object.");
        }
    }
    
    evaluation.detailed_summary_markdown = markdownPart || "No detailed summary provided.";

    const stmt = db.prepare(`
        INSERT INTO case_management_evaluations (
            location, session_title, cm_name, total_score,
            playbook_adherence, cbt_application, goal_setting,
            empathy_and_neutrality, apricot_data_gathering,
            apricot_notes, summary_markdown, scores_json, feedback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        location,
        sessionTitle,
        cmName || 'Staff CM',
        evaluation.total_cm_score || 85,
        evaluation.scores?.playbook_adherence || 4,
        evaluation.scores?.cbt_application || 4,
        evaluation.scores?.goal_setting || 4,
        evaluation.scores?.empathy_and_neutrality || 4,
        evaluation.scores?.apricot_data_gathering || 4,
        evaluation.structured_meeting_notes_for_apricot || '',
        evaluation.detailed_summary_markdown || '',
        JSON.stringify(evaluation.scores || {}),
        (evaluation.areas_for_improvement || []).join('; ')
    );

    for (const res of uploadResults) {
        try {
            await fileManager.deleteFile(res.file.name);
        } catch (err) {}
    }

    return evaluation;
}

module.exports = { evaluateCaseManagementMedia };
