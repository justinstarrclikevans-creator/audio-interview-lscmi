const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview", generationConfig: { responseMimeType: "application/json" } });

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

// Get the actual CSV header for the LLM
function getCsvHeader() {
    try {
        const csvPath = path.join(__dirname, '..', 'FirstShift20IntakeForm.csv');
        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.split('\n');
        // The first line is "System Header Row...
        // The actual header fields are on the second line (index 1) but because of the multiline string it might be line 3 (index 2).
        // Let's just grab the line that starts with OR THIS COLUMN!
        const headerLine = lines.find(l => l.includes('OR THIS COLUMN!'));
        if (headerLine) return headerLine;
        return lines[2]; // Fallback
    } catch(e) {
        return "field_4297_first,field_4297_middle,field_4297_last"; // ultra fallback
    }
}

async function runPhase1(transcriptText, clientName) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

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
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const manuals = loadManuals();
    const csvHeader = getCsvHeader();
    
    const systemPrompt = `You are a clinical assessment expert. Phase 2: The Program Manager has reviewed your Draft Scoring Form and provided feedback/corrections. 
    You must output the FINAL Scoring Form incorporating their feedback. 
    Then, using the Final Scoring Form, generate the Case Management Brief and the CSV row for the intake form.
    
    CRITICAL CSV INSTRUCTIONS:
    The CSV row MUST map to the following exact column headers:
    ${csvHeader}
    
    Use the "Apricot_Mapping.txt" manual to understand which field_XXXX corresponds to which question. Extract the answers from the transcript and map them into the exact order of the headers. If a question is unanswered, leave the CSV cell empty.
    
    Reference Manuals provided below:
    ${manuals}
    
    You must return a valid JSON object with EXACTLY these three keys:
    {
      "final_scoring_form": "# Final Scoring Form\\n...",
      "case_brief": "# Case Brief\\n...",
      "csv_row": "value1,value2,value3,..."
    }
    
    Ensure the markdown documents are beautifully formatted. The case brief MUST NOT select Criminal History as one of the top needs.`;

    const prompt = `${systemPrompt}\n\nClient: ${clientName}\n\nTranscript:\n${transcriptText}\n\nDraft Scoring Form:\n${draftScoringForm}\n\nProgram Manager Feedback:\n${feedback}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
}

module.exports = { runPhase1, runPhase2 };
