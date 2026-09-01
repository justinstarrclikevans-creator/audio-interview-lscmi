const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

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

async function runPipeline(transcriptText, clientName) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set. Please add it to your environment variables in Render.");
    }

    const manuals = loadManuals();
    const systemPrompt = `You are a clinical assessment expert. You must complete four deliverables based on the provided interview transcript and manuals.
    
    Reference Manuals provided below:
    ${manuals}
    
    Output your response EXACTLY as a JSON object with four keys:
    {
      "interview_guide": "# Interview Guide\\n...",
      "scoring_form": "# Scoring Form\\n...",
      "case_brief": "# Case Brief\\n...",
      "csv_row": "comma,separated,values,representing,the,answers,to,the,intake,form"
    }
    
    Ensure the markdown documents are beautifully formatted and follow the rules in the manuals strictly. The case brief MUST NOT select Criminal History as one of the top needs.`;

    const completion = await openai.chat.completions.create({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the transcript for ${clientName}:\n\n${transcriptText}` }
        ],
        model: "gpt-4o",
        response_format: { type: "json_object" }
    });

    return JSON.parse(completion.choices[0].message.content);
}

module.exports = { runPipeline };
