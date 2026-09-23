require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Just try to fetch gemini-1.5-flash and gemini-2.0-flash
(async () => {
    const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-3.5-flash"];
    for(const m of models) {
        try {
            const model = genAI.getGenerativeModel({ model: m });
            await model.generateContent("hello");
            console.log(m + " is WORKING");
        } catch(e) {
            console.error(m + " ERROR: " + e.message);
        }
    }
})();
