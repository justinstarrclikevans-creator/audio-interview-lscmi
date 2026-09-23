require('dotenv').config();
const API_KEY = process.env.GEMINI_API_KEY;
async function list() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
  const json = await res.json();
  if (json.models) {
    console.log(json.models.map(m => m.name).join('\n'));
  } else {
    console.log(json);
  }
}
list();
