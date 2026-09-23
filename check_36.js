require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
(async () => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
        const res = await model.generateContent("hello");
        console.log("gemini-3.6-flash is WORKING: " + res.response.text());
    } catch(e) {
        console.error("gemini-3.6-flash ERROR: " + e.message);
    }
})();
