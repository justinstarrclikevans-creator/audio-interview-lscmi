// Re-entry Navigation Case Planning & Flag Analysis Engine
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { SC_COMMUNITY_RESOURCES, SC_FAIR_CHANCE_EMPLOYERS } = require('./sc_resource_directory');
const { loadJobsFromSpreadsheets } = require('./jobs_loader');

// Load environment from local .env or fallback paths
require('dotenv').config({ path: path.join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
    require('dotenv').config({ path: path.join(__dirname, '..', 'Facilitation Scoring', '.env') });
}

const FACILITATION_GUIDELINES = `
Turn90 Facilitation & Clinical Standards (Modeling Neutrality, CBT Workbooks & Treatment Planner):
1. Modeling Neutrality (1.5): Never challenge or debate anti-social statements; use neutral curiosity and reflective questions to expose contradictions without escalating resistance.
2. Managing Resistance & Buy-In (3.2 & 18.0): Acknowledge frustration, avoid power struggles, and link every requirement directly to the participant's self-interest (e.g. steady pay, keeping freedom).
3. Core Criminogenic Domains (Treatment Planner):
   - Dynamic Targets: Procriminal attitudes, antisocial peer influence, substance use, family conflict, education/employment deficits.
   - Non-Dynamic: Criminal history is static and cannot be treated as a dynamic intervention target.
4. Stability Red-Flag Triggers:
   - Housing instability / homelessness (< 60 days stable address)
   - Active substance use without a relapse prevention plan
   - No viable transportation to work sites
   - Suspended driver's license with active bench warrants or insurmountable child support liens
   - High emotional volatility / hostility towards supervisors
`;

async function generateReentryNavAssessment(data) {
    const apiKey = data.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured. Please check your environment variables or settings.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const {
        participantName,
        location = "Charleston",
        interviewTranscript = "",
        statedGoals = "",
        identifiedNeeds = [],
        livingSituation = "",
        legalStatus = ""
    } = data;

    // Retrieve localized resources & employers for this city
    const locKey = location.toLowerCase().includes('columbia') ? 'columbia' : (location.toLowerCase().includes('greenville') || location.toLowerCase().includes('spartanburg') ? 'greenville' : 'charleston');
    const localResources = SC_COMMUNITY_RESOURCES[locKey] || SC_COMMUNITY_RESOURCES.charleston;
    const localEmployers = SC_FAIR_CHANCE_EMPLOYERS.filter(e => e.region === locKey || e.region === 'all');
    const spreadsheetJobs = loadJobsFromSpreadsheets();

    const prompt = `
You are the Lead Re-entry Navigator and Forensic Clinical Specialist for Turn90 / First Shift.
Analyze the following Re-entry Navigation interview transcript, participant background, and goals against our facilitation standards, community directories, and active jobs spreadsheet.

FACILITATION & CLINICAL FRAMEWORK:
${FACILITATION_GUIDELINES}

LOCAL RESOURCE DIRECTORY FOR ${location.toUpperCase()}:
${JSON.stringify(localResources, null, 2)}

ACTIVE HIRING JOBS FROM SPREADSHEET (${spreadsheetJobs.length} active positions in Charleston/SC area):
${JSON.stringify(spreadsheetJobs.slice(0, 30), null, 2)}

FAIR-CHANCE REGIONAL EMPLOYERS:
${JSON.stringify(localEmployers, null, 2)}

PARTICIPANT PROFILE:
- Name: ${participantName}
- Location: ${location}
- Stated Goals: ${statedGoals}
- Identified Needs / Barriers: ${Array.isArray(identifiedNeeds) ? identifiedNeeds.join(', ') : identifiedNeeds}
- Living Situation: ${livingSituation}
- Legal / Supervision Status: ${legalStatus}
- Interview Transcript & Notes:
${interviewTranscript || 'Assessment based on intake notes and self-reported barriers.'}

TASK INSTRUCTIONS:
1. Examine the interview for Cognitive & Behavioral Flags (e.g., entitlement, externalizing blame, resistance, emotional reactivity) using Modeling Neutrality and CBT standards.
2. Identify Critical Stability Red Flags that threaten immediate employment.
3. Recommend specific Facilitation / Coaching Strategies for the Re-entry Navigator.
4. Build a STAFF-FACING Re-entry Navigation Case Plan (markdown).
5. Build a PARTICIPANT-FACING Printable Action & Referral Guide (markdown) containing:
   - Positive, respectful framing of their personal fresh start vision.
   - Specific, localized resource referrals with CLICKABLE markdown web links: [Visit Website](websiteUrl) or [Directions](https://maps.google.com/?q=...), phone numbers, addresses, and next action steps.
   - Targeted local fair-chance job matches with pay rates, shifts, why it fits their background, and a direct CLICKABLE markdown link: [Apply Online / View Careers Page](careersUrl). Use the exact URL from the directory or spreadsheet. (IMPORTANT: Do NOT suggest Turn90 / First Shift as the employer option since the participant is already engaged with us. Recommend external second-chance employers from the provided directory and spreadsheet).
   - An encouraging 4-week step-by-step milestone checklist.

Return a valid JSON object matching EXACTLY this structure:
{
  "detected_flags": [
    {
      "category": "Cognitive / Attitude" | "Stability Risk" | "Supervision / Legal" | "Substance / Health",
      "flag": "Short title of flag",
      "evidence": "Quote or specific evidence from interview",
      "severity": "high" | "medium" | "low",
      "navigator_recommendation": "Concrete de-escalation / facilitation advice for staff"
    }
  ],
  "top_criminogenic_domains": ["string", "string"],
  "stability_status": "stable" | "at_risk" | "immediate_triage_needed",
  "navigator_case_plan_md": "# Re-entry Navigation Case Plan: [Name]\\n\\n...",
  "participant_guide_md": "# My Fresh Start Action & Resource Guide: [Name]\\n\\n...",
  "recommended_referrals": [
    {
      "resourceName": "string",
      "category": "Housing" | "Legal / ID" | "Healthcare" | "Recovery" | "Food / Transit",
      "contact": "Phone & Address",
      "websiteUrl": "https://...",
      "actionStep": "What the participant should do next"
    }
  ],
  "matched_employers": [
    {
      "company": "string",
      "role": "string",
      "pay": "string",
      "shift": "string",
      "careersUrl": "https://...",
      "matchReason": "Why this aligns with their goals and background"
    }
  ]
}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
}

module.exports = {
    generateReentryNavAssessment
};
