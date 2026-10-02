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
Turn90 Facilitation & Case Management Standards (Modeling Neutrality, CBT Workbooks & Case Planner):
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
        model: "gemini-pro-latest",
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

APRICOT DATABASE PATTERN CODES (Use exactly these for the Data Entry Guide):
- Antisocial Pattern: A1. Reactive anger when corrected, A2. Impulsive decisions under stress, A3. Retaliatory thinking, A4. Emotional escalation / poor regulation, A5. Rule resistance / authority pushback, A6. Low frustration tolerance
- Procriminal Attitudes: P1. Minimizing consequences, P2. Externalizing blame, P3. Justifying illegal behavior as survival, P4. Short-term reward focus, P5. Distrust of authority / rigid system thinking
- Peer Associations: C1. Loyalty to high-risk peers, C2. Difficulty distancing from criminal network, C3. Identity tied to past lifestyle, C4. Susceptibility to peer pressure, C5. Lack of pro-social supports
- Employment/Education: E1. Difficulty accepting supervision, E2. Inconsistent follow-through, E3. Attendance instability, E4. Avoidance of skill development, E5. Task frustration leading to disengagement
- Family/Marital: F1. Escalating conflict in relationships, F2. Avoidance of difficult conversations, F3. Inconsistent follow-through with family commitments, F4. Controlling or defensive communication style, F5. Limited healthy support within family system
- Substance Use: S1. Social use reinforcing risky peer ties, S2. Using to cope with stress or emotion, S3. Underestimating impact on employment stability, S4. Difficulty refusing in social settings, S5. Motivation decline linked to marijuana use
- Leisure/Recreation: L1. Lack of structured pro-social activities, L2. Idle time increasing risk exposure, L3. Recreation tied to high-risk peer network, L4. Limited development of positive identity outside work

You are the Lead Re-entry Navigator and Case Management Specialist for Turn90 / First Shift.
Analyze the following Re-entry Navigation interview transcript, participant background, and goals against our facilitation standards, community directories, and active jobs spreadsheet.

FACILITATION & CASE MANAGEMENT FRAMEWORK:
Based on the transcript or uploaded document, assess and build the case plan adhering STRICTLY to these Gates:

Gate 1:
- State ID or Driver's License: Do they have a valid, unexpired ID? IF a state issued ID is missing, THEN the case plan must include scheduling DMV visit IF the participant has a birth certificate AND proof of residence.
- Social Security Card: Do they have the physical card or a receipt from the SSA office? IF the social security card is missing, THEN the case plan must include scheduling an appointment IF the person has a birth certificate and state issued photo ID.
- Birth Certificate: IF a birth certificate is missing AND the person was born in South Carolina AND the person has a state issued ID THEN the case plan must include scheduling an appointment with vital records. IF the person is born outside of South Carolina, THEN the case should include finding out what their state of birth requires to order a birth certificate.
- Notes on Identification: If they have never had a state issued ID and they cannot receive a copy of their birth certificate and do not have a social security card, the process becomes very difficult and requires escalation to the Program Director to make a plan. Out of state birth certificates require multiple rounds of identity verification. If the participant is in First Shift, then a determination should be made if the issues would interfere with job placement, and staff must decide whether to move them to Reentry Navigation.
- Prescriptions: IF a participant is actively on medication THEN the case plan must include Welvista or a medical visit to ensure prescriptions are filled.
- Healthcare Options: Go over healthcare options (Welvista, local free clinics, Healthcare Exchange). They must understand the exchange incurs costs via copays.
- Supervision: IF the participant is on supervision THEN the officer's information, county, and report dates should be noted.
- Main Goal: Participant should answer: What do I want my life to look like in 90 days? What is the biggest thing I want to improve? What would make me proud? What would create stability?
- Track: Chose skillcat track. Make sure track is appropriate based on background and location.

Gate 2:
- Child Support: IF on child support, THEN find out cases and contact Enforcement via the app. IF there are legal issues, THEN include a plan to deal with them via referrals.
- Housing: Is living situation stable enough that it won't disrupt daily work routine in next 30-60 days? IF there are housing stability issues, THEN plan to stabilize.
- Phone: IF they do not have a reliable phone number or voicemail set up, then this must be part of their case plan.
- Probation/Legal: IF they have probation meetings, court dates, or community service hours that conflict with work, add to case plan.
- DMV / License: IF license is suspended, they must go to the DMV or check online for fines/suspensions.
- Email / Resume: IF they do not have a professional email, add to plan. IF no updated resume, create one.
- Skillcat: Making progress on Skillcat track.

Gate 3:
- Undiagnosed Needs/Disabilities: Staff should complete health screen for medical or mental health issues. Add to case plan if identified.
- Medical/Vision: IF untreated illnesses or vision issues exist, scheduling a doctor/vision appointment should be added to the case plan.
- Prescriptions & Mental Health: Support plan in place to ensure they do not get overwhelmed.
- Bank Account: IF they do not have an active account for direct deposit (Chime/Cash App is sufficient), setting one up should be added to the case plan.

Gate 4:
- Work Tools & Clothing: Are required items identified based on desired placement? IF so, a plan to acquire these must be added to case plan.
- Transportation Plan: Before referring to an employer, a transportation plan with at least TWO stable and reliable options must be identified (car, bus pass, carpool).
- Budget completed, Savings goals, Credit reviewed, 6 month job plan created, Long term career goal identified.


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
4. Build a STAFF-FACING Re-entry Navigation Case Plan (markdown). It MUST include an "Apricot Data Entry Guide" section at the top that crosswalks the clinical analysis into the rigid Apricot database dropdowns. Map the participant's risks to EXACTLY two of the following Focus Areas: Reactions and Self Control (Antisocial Pattern), Thinking Patterns (Procriminal Attitudes), People and Influence (Peer Associations), Work and Follow-Through (Employment/Education), Family and Relationships (Family/Marital), Substance Use, Time and Structure (Leisure/Recreation). Then, select 2-3 specific sub-pattern codes (e.g., "A1. Reactive anger when corrected", "P2. Externalizing blame", "E3. Attendance instability") that match their interview. Finally, include a concise, copy-pasteable clinical note for the Apricot 'Client Brief Text' field summarizing the nuances.
5. Build a PARTICIPANT-FACING Printable Action & Referral Guide (markdown). This will be printed for them to keep in their binder. It MUST contain:
   - Positive, respectful framing of their personal fresh start vision.
   - **CBT Triggers Worksheet**: Identify their top three cognitive behavioral patterns based on the interview. For EACH pattern, provide a blank fill-in table or bulleted list with blank lines (e.g., "_____") so they can write down 5 to 10 real-life situations that could trigger that pattern.
   - **Gate Checklist**: An explicit, printed 4-week step-by-step milestone checklist outlining the program Gates they must pass.
   - Specific, localized resource referrals with CLICKABLE markdown web links: [Visit Website](websiteUrl) or [Directions](https://maps.google.com/?q=...), phone numbers, addresses, and next action steps.
   - Targeted local fair-chance job matches with pay rates, shifts, why it fits their background, and a direct CLICKABLE markdown link. (IMPORTANT: Do NOT suggest Turn90 / First Shift as the employer option since the participant is already engaged with us. Recommend external second-chance employers from the provided directory and spreadsheet).

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

    let retries = 0;
    while (retries < 5) {
        try {
            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            return JSON.parse(responseText);
        } catch (e) {
            if (e.message.includes('503') || e.message.includes('429')) {
                console.log(`  [Retry] Gemini API high demand (503/429). Retrying in 15s (Attempt ${retries + 1}/5)...`);
                await new Promise(r => setTimeout(r, 15000));
                retries++;
            } else {
                throw e;
            }
        }
    }
    throw new Error('Gemini API failed after 5 retries due to high demand.');
}

module.exports = {
    generateReentryNavAssessment
};
