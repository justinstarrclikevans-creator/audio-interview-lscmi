const { GoogleAIFileManager } = require("@google/generative-ai/server");
require('dotenv').config();
const fm = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
async function run() {
    const response = await fm.listFiles();
    for (const f of response.files || []) {
        console.log(f.name, f.displayName, f.sizeBytes, f.state);
    }
}
run();
