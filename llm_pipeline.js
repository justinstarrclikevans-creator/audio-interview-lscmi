const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
// We will use gemini-1.5-pro or gemini-1.5-flash. Flash is fast, Pro is smarter. Pro is better for complex clinical stuff.
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro", generationConfig: { responseMimeType: "application/json" } });

const manualsDir = path.join(__dirname, 'manuals');

function loadManuals() {
    let manualsText = '';
    const files = fs.readdirSync(manualsDir);
    for (const file of files) {
        if (file.endsWith('.txt')) {
            manualsText += `\n\n--- ${file} ---\n`;
            manualsText += fs.readFileSync(path.join(manualsDir, file), 'utf8');
        }
    }
    return manualsText;
}

async function runPhase1(transcriptText, clientName) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing");
    }

    const manuals = loadManuals();
    const systemPrompt = `You are a clinical assessment expert. Phase 1: You must complete the Interview Guide and a DRAFT Scoring Form based on the provided interview transcript and manuals.
    
    Reference Manuals provided below:
    ${manuals}
    
    You must return a valid JSON object with EXACTLY these two keys:
    {
      "interview_guide": "# Interview Guide\\n...",
      "draft_scoring_form": "# Draft Scoring Form\\n..."
    }
    
    Ensure the markdown documents are beautifully formatted and follow the rules in the manuals strictly.`;

    const prompt = `${systemPrompt}\n\nHere is the transcript for ${clientName}:\n\n${transcriptText}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
}

async function runPhase2(transcriptText, clientName, draftScoringForm, feedback) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing");
    }

    const manuals = loadManuals();
    const systemPrompt = `You are a clinical assessment expert. Phase 2: The Program Manager has reviewed your Draft Scoring Form and provided feedback/corrections. 
    You must output the FINAL Scoring Form incorporating their feedback. 
    Then, using the Final Scoring Form, generate the Case Management Brief and the CSV row for the intake form.
    
    Reference Manuals provided below:
    ${manuals}
    
    You must return a valid JSON object with EXACTLY these three keys:
    {
      "final_scoring_form": "# Final Scoring Form\\n...",
      "case_brief": "# Case Brief\\n...",
      "csv_row": "comma,separated,values,representing,the,answers,to,the,intake,form"
    }
    
    Ensure the markdown documents are beautifully formatted. The case brief MUST NOT select Criminal History as one of the top needs.`;

    const prompt = `${systemPrompt}\n\nClient: ${clientName}\n\nTranscript:\n${transcriptText}\n\nDraft Scoring Form:\n${draftScoringForm}\n\nProgram Manager Feedback:\n${feedback}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
}

module.exports = { runPhase1, runPhase2 };
