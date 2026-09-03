// Turn90 Fresh Start Participant AI Assistant Engine
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const { SC_COMMUNITY_RESOURCES, SC_FAIR_CHANCE_EMPLOYERS } = require('./sc_resource_directory');

require('dotenv').config({ path: path.join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
    require('dotenv').config({ path: path.join(__dirname, '..', 'Facilitation Scoring', '.env') });
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const AI_ASSISTANT_SYSTEM_PROMPT = `
You are the "Turn90 Fresh Start AI Assistant", a compassionate, encouraging, highly practical, and knowledgeable mentor for Turn90 participants re-entering the workforce and society in South Carolina.

Your mission:
Walk participants through employment paperwork, overcome real-life barriers, understand program requirements, and connect them with trusted community resources in Charleston, Columbia, and the Upstate.

Tone & Style:
- Encouraging, respectful, clear, and direct.
- Plain English (6th-8th grade reading level). Avoid complicated legal jargon.
- Format responses with clean bullet points, bold key terms, and numbered step-by-step instructions.
- Provide active clickable markdown links whenever recommending South Carolina resources (e.g., [One80 Place Housing](https://one80place.org)).

KEY EXPERTISE AREAS:

1. EMPLOYMENT PAPERWORK - FORM I-9 (USCIS):
   - What it is: Federal form verifying identity and legal authorization to work in the USA. Every employer requires it.
   - Section 1 (Employee Information & Attestation): Must be completed by the employee on or before their FIRST DAY of work for pay.
   - You must check whether you are:
     1. A citizen of the United States
     2. A noncitizen national
     3. A lawful permanent resident (enter USCIS / A-Number)
     4. An alien authorized to work (enter expiration date and document number)
   - What documents you must show to your employer (within 3 business days of your first day):
     * Option 1: ONE document from LIST A (Proves both identity AND work authorization, e.g., valid U.S. Passport or Permanent Resident Card).
     * Option 2: ONE document from LIST B (Proves identity, e.g., State Driver's License or SC State ID Card) PLUS ONE document from LIST C (Proves work authorization, e.g., unrestricted Social Security Card or certified Birth Certificate).
   - Important Tip: An employer CANNOT dictate which valid documents you choose to present from the Lists!

2. TAX PAPERWORK - FORM W-9:
   - Required for payroll, 1099, and stipend setups.
   - Line 1: Your legal name as it appears on your tax return / Social Security card.
   - Line 3: Check "Individual / sole proprietor".
   - Part I: Enter your 9-digit Social Security Number (SSN).
   - Part II: Certification and Signature certifying your TIN is correct.

3. SOUTH CAROLINA VERIFIED REFERRALS & STABILITY RESOURCES:
   - Housing / Shelter:
     * Charleston: [One80 Place](https://one80place.org) (843-723-9477), Star Gospel Mission (men only, 843-722-2473)
     * Columbia: [Transitions Homeless Center](https://transitionssc.org) (803-708-4861)
     * Greenville: [Miracle Hill Ministries](https://miraclehill.org) (864-268-4357)
   - Driver's License Reinstatement:
     * SCDMV Route 66 Payment Plan: Allows individuals with suspended licenses due to unpaid traffic fines to set up a monthly payment plan and get their physical driver's license reinstated immediately.
     * Legal Assistance: [SC Legal Services](https://sclegal.org) (1-888-346-5592)
   - Free Medications & Healthcare:
     * [Welvista](https://welvista.org) (1-800-983-3339): Statewide program delivering free prescription medications directly to the participant's door for uninsured SC residents.
     * Charleston Healthcare: [Fetter Health Care Network](https://fetterhealthcare.org) (843-577-7388)
   - Child Support Lien Resolution & Driver's License Reinstatement:
     * Charleston / Berkeley / Dorchester: [Father to Father Inc.](https://fathertofatherinc.org) (843-747-1688)
     * Columbia: [Midlands Fatherhood Coalition](https://midlandsfatherhood.com) (803-933-0056)
     * Upstate: [Upstate Fatherhood Coalition](https://upstatefathers.org) (864-241-2180)
   - Transportation:
     * Charleston: CARTA bus routes & bus pass requests via Turn90 Case Manager.
     * Columbia: COMET transit system.

4. TURN90 COGNITIVE-BEHAVIORAL TOOLKIT:
   - Stop & Think: Taking a 3-second pause before responding when triggered.
   - Thinking Report: Situation -> Automatic Thoughts -> Feelings -> Action -> Consequences.
   - Problem Solving 4-Step: 1. Stop & define problem, 2. Brainstorm 3 choices, 3. Check consequences of each, 4. Pick best move.

If the user asks a question, answer with warmth, clarity, specific step-by-step guidance, and relevant resource links.
`;

async function getParticipantAiResponse(userMessage, conversationHistory = []) {
    if (!genAI) {
        return getFallbackResponse(userMessage);
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
        
        let formattedHistory = "";
        if (conversationHistory && conversationHistory.length > 0) {
            formattedHistory = "\n\nPrevious Conversation:\n" + conversationHistory.map(m => `${m.role === 'user' ? 'Participant' : 'Assistant'}: ${m.text}`).join("\n");
        }

        const prompt = `${AI_ASSISTANT_SYSTEM_PROMPT}\n${formattedHistory}\n\nParticipant's Current Question:\n"${userMessage}"\n\nAssistant Response:`;
        
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (err) {
        console.error("Gemini AI Assistant error:", err);
        return getFallbackResponse(userMessage);
    }
}

function getFallbackResponse(query) {
    const q = (query || '').toLowerCase();

    if (q.includes('i-9') || q.includes('i9') || q.includes('employment eligibility')) {
        return `### 📋 Step-by-Step Guide to Completing Form I-9

Form I-9 is the federal form all U.S. employers use to verify that you are legally authorized to work. Here is how to complete it without stress:

#### 1. Section 1 (Employee Information & Attestation)
* **Deadline:** You must complete Section 1 on or before your **first day of work for pay**.
* **What to fill in:** Your legal name, current address, date of birth, and Social Security Number.
* **Citizenship Checkbox:** Check the box that applies to you (most participants check **"A citizen of the United States"**).
* **Sign & Date:** Sign your legal signature and write today's date.

#### 2. Section 2 Documents (Presenting Your IDs)
Within **3 business days** of starting your job, you must show your employer original documents proving your identity and right to work. You have two choices:
* **Option A:** Show **ONE document from List A** (e.g., a valid U.S. Passport or Permanent Resident Card).
* **Option B:** Show **ONE document from List B** (Identity, e.g., your State Driver's License or SC State ID Card) **PLUS ONE document from List C** (Work Authorization, e.g., your Social Security Card or certified Birth Certificate).

> **Important Turn90 Tip:** An employer *cannot* demand a specific document (e.g., they cannot say "you must bring a passport"). As long as you bring a valid State ID + Social Security Card, they must accept them. If you need help obtaining a replacement ID or SS Card, ask your Turn90 Program Manager!`;
    }

    if (q.includes('w-9') || q.includes('w9') || q.includes('tax form')) {
        return `### 📝 How to Complete Form W-9

Form W-9 provides your Taxpayer Identification Number to Turn90 for stipends and payroll setup.

1. **Line 1 (Name):** Enter your full legal name as shown on your Social Security Card and tax return.
2. **Line 3 (Tax Classification):** Check **"Individual / sole proprietor"**.
3. **Line 5 & 6 (Address):** Enter your current street address, city, state, and ZIP code.
4. **Part I (TIN):** Enter your 9-digit Social Security Number (SSN).
5. **Part II (Certification):** Check the certification box and type your legal name to sign and date.

You can complete this directly in your portal under the **"Form W-9"** button!`;
    }

    if (q.includes('license') || q.includes('dmv') || q.includes('suspension') || q.includes('route 66')) {
        return `### 🚗 Getting Your Driver's License Back in South Carolina

If your SC driver's license is suspended due to unpaid traffic tickets or failure to pay fines, you may be eligible for the **SCDMV Route 66 Payment Plan**:

1. **How it works:** Allows eligible South Carolina drivers to set up affordable monthly payment plans for outstanding traffic fines while having their driver's license **reinstated immediately**.
2. **Free Legal Help:** Contact [SC Legal Services](https://sclegal.org) at **1-888-346-5592** or ask your Turn90 Program Manager to help submit a Route 66 application.
3. **Child Support Holds:** If your license has a family court or child support hold, our partner [Father to Father](https://fathertofatherinc.org) (843-747-1688) works directly with child support enforcement to modify arrears and release DMV holds!`;
    }

    if (q.includes('medicine') || q.includes('medication') || q.includes('prescription') || q.includes('welvista')) {
        return `### 💊 Free Prescription Medications Through Welvista

If you take daily prescription medications for conditions like high blood pressure, asthma, diabetes, or mental health, **[Welvista](https://welvista.org)** provides them completely **FREE OF CHARGE** to uninsured South Carolina residents:

* **How it works:** Medications are mailed directly to your home or shelter in discreet packaging.
* **Cost:** 100% Free. No co-pays, no shipping fees.
* **Phone:** **1-800-983-3339**
* **Application:** Your Turn90 Case Manager can help you get the 1-page application signed by a provider at [Fetter Health Care](https://fetterhealthcare.org) (843-577-7388).`;
    }

    return `### 👋 Hello from your Turn90 Fresh Start AI Assistant!

I am here to help you navigate your journey through Turn90 and into a stable, high-paying career. Here are some of the things you can ask me:

* **"How do I fill out Form I-9 for my new employer?"**
* **"What documents do I need to bring on my first day of work?"**
* **"How do I get my suspended driver's license back with SCDMV Route 66?"**
* **"How can I get free prescription medications through Welvista?"**
* **"Where can I find emergency housing or shelter in Charleston, Columbia, or Greenville?"**
* **"How can Father to Father help me reduce my child support arrears?"**

Type your question below or click one of the suggested topics!`;
}

module.exports = {
    getParticipantAiResponse
};
