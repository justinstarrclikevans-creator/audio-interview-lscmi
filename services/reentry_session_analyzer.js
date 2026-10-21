// Reentry Navigation Session Analyzer
// Analyzes audio recordings, transcripts, or case notes to update live case plans, goals, briefcase items, and next-session agenda
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({
    model: "gemini-3.1-pro-preview",
    generationConfig: { responseMimeType: "application/json" }
});

/**
 * Analyzes a Reentry Navigation session upload (audio, transcript, or notes)
 */
async function analyzeReentrySession({ client, sessionTitle, sessionType, sessionText = '', mediaPath = null, currentGoals = [], currentBriefcase = [] }) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }

    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
    let uploadedMedia = null;
    let extractedTranscript = sessionText || '';

    try {
        const contentParts = [];

        if (mediaPath && fs.existsSync(mediaPath)) {
            console.log(`[Reentry Analyzer] Uploading media to Gemini: ${mediaPath}`);
            const stat = fs.statSync(mediaPath);
            if (stat.size < 5120) {
                throw new Error("Audio file is too small or empty.");
            }

            uploadedMedia = await fileManager.uploadFile(mediaPath, {
                mimeType: mediaPath.endsWith('.mp3') ? 'audio/mpeg' : (mediaPath.endsWith('.wav') ? 'audio/wav' : 'audio/mp4'),
                displayName: `Reentry_Nav_${client.first_name}_${client.last_name}_${Date.now()}`
            });

            // Poll until processed if needed
            let fileState = uploadedMedia.file;
            while (fileState.state === 'PROCESSING') {
                console.log(`[Reentry Analyzer] Processing audio in Gemini...`);
                await new Promise(r => setTimeout(r, 4000));
                fileState = await fileManager.getFile(fileState.name);
            }
            if (fileState.state === 'FAILED') {
                throw new Error("Gemini failed to process session audio.");
            }

            contentParts.push({ fileData: { mimeType: fileState.mimeType, fileUri: fileState.uri } });
        }

        // Format existing goals and briefcase context for continuity
        const goalsContext = currentGoals.length > 0
            ? currentGoals.map(g => `- [${g.status.toUpperCase()}] ${g.goal_title} (Target: ${g.target_date || 'No date'}, Category: ${g.category})`).join('\n')
            : 'No existing goals recorded yet.';

        const briefcaseContext = currentBriefcase.length > 0
            ? currentBriefcase.filter(b => b.status === 'green' || b.status === 'red')
                .map(b => `- [${b.status.toUpperCase()}] ${b.title}: ${b.notes || ''}`).join('\n')
            : 'Briefcase currently pending.';

        const prompt = `
You are the Lead Reentry Navigator and Case Planning Specialist for Turn90.
You are analyzing a 1-on-1 community navigation interaction between a Reentry Navigator and client ${client.first_name} ${client.last_name} in ${client.location}.

CLIENT PROFILE:
- Name: ${client.first_name} ${client.last_name}
- Apricot ID: ${client.apricot_id || 'N/A'}
- Center / Region: ${client.location}
- Session Title: ${sessionTitle}
- Session Type: ${sessionType || 'check_in'}

CURRENT CASE PLAN CONTEXT:
Active Goals:
${goalsContext}

Key Briefcase Verified / Barrier Items:
${briefcaseContext}

${sessionText ? `SESSION TRANSCRIPT / MEETING NOTES:\n${sessionText}\n` : ''}

CRITICAL TURN90 REENTRY NAVIGATION INSTRUCTIONS:
1. SESSION SUMMARY: Provide a concise, professional 2-3 paragraph markdown summary of what was discussed, progress made, and barriers identified.
2. STABILITY TIER ASSESSMENT:
   - "stable": Client has safe housing, reliable communication, stable legal/probation standing, and active prosocial routine.
   - "at_risk": Client is facing moderate barriers (housing precarious, transit difficulty, license issues, job search plateau).
   - "immediate_triage": Urgent crises present (active eviction, immediate court warrant risk, food crisis, mental health/substance relapse crisis).
3. IDENTIFIED NEEDS: Extract concrete need categories (e.g., "Emergency Housing Assistance", "SNAP Food Stamps", "Driver's License Reinstatement", "Steel-toe Work Boots", "Mental Health Referral").
4. BRIEFCASE UPDATES:
   Identify any specific briefcase checklist items that were verified completed ("green") or flagged as active barriers ("red") during this interaction.
   Available item keys include: state_id, ss_card, birth_cert, drivers_license, reliable_phone, prof_email, library_card, bank_account, snap_food_stamps, tanf_assistance, child_support_status, transportation_plan, housing_plan, resume_completed, interview_prep, work_clothing, medical_home, vision_screen, dental_check, welvista_medications, medicaid_active.
5. PROPOSED / UPDATED GOALS:
   Recommend 1–3 concrete, collaborative process goals based on what client and navigator agreed to work on.
   Each goal must have a realistic target date (within 1–4 weeks), a category, and 1–3 specific action steps.
6. WHAT TO TALK ABOUT IN THE NEXT CONVERSATION (AGENDA):
   Provide a bulleted markdown checklist specifying EXACTLY what the navigator should follow up on in their next conversation with ${client.first_name}. Pinpoint accountability items, questions to ask, and pending verification checks.

OUTPUT JSON FORMAT:
Provide a valid JSON object matching this structure:
\`\`\`json
{
  "session_summary": "Markdown summary of the session...",
  "diarized_transcript": "Clean speaker transcript if audio was provided, or summary dialogue...",
  "stability_tier": "stable",
  "identified_needs": [
    "Need 1...",
    "Need 2..."
  ],
  "briefcase_updates": [
    {
      "item_key": "drivers_license",
      "status": "red",
      "notes": "Suspended due to unpaid court fees; navigator connecting to DSS child support modification."
    }
  ],
  "proposed_goals": [
    {
      "goal_title": "Concrete goal...",
      "target_date": "YYYY-MM-DD",
      "category": "housing",
      "action_steps": [
        "Step 1...",
        "Step 2..."
      ],
      "assigned_to": "client"
    }
  ],
  "next_conversation_agenda": "### 🗣️ Next Session Agenda for ${client.first_name}\n- [ ] Follow up on X...\n- [ ] Check if client received Y...\n- [ ] Review progress on Z..."
}
\`\`\`
`;

        contentParts.push({ text: prompt });

        const result = await model.generateContent(contentParts);
        const responseText = result.response.text();

        let parsed;
        try {
            const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(responseText);
        } catch(err) {
            const bracketMatch = responseText.match(/\{[\s\S]*\}/);
            if (bracketMatch) parsed = JSON.parse(bracketMatch[0]);
            else throw new Error("AI did not return valid JSON analysis.");
        }

        return parsed;

    } finally {
        if (uploadedMedia && uploadedMedia.file) {
            try {
                await fileManager.deleteFile(uploadedMedia.file.name);
            } catch(e) {
                console.warn("[Reentry Analyzer] Could not delete temp audio from Gemini:", e.message);
            }
        }
    }
}

module.exports = { analyzeReentrySession };
