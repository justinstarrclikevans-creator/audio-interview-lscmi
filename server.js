const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');
const { runPipeline } = require('./llm_pipeline');

require('dotenv').config({ path: path.join(__dirname, '..', 'email-settings.txt') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Serve data files statically so they can be downloaded from the dashboard
app.use('/data', express.static(dataDir));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const resend = new Resend(process.env.RESEND_API_KEY);

// Dashboard API to list processed files
app.get('/api/interviews', (req, res) => {
    try {
        const files = fs.readdirSync(dataDir);
        // Group by client
        const clients = {};
        files.forEach(f => {
            const parts = f.split('_');
            if (parts.length > 1) {
                const clientId = parts[0] + '_' + parts[1]; // e.g. timestamp_name
                if (!clients[clientId]) clients[clientId] = [];
                clients[clientId].push(f);
            }
        });
        res.json(clients);
    } catch(err) {
        res.status(500).json({error: "Failed to read data directory"});
    }
});

app.post('/api/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded.' });
        }

        const audioBuffer = req.file.buffer;
        const originalName = req.file.originalname || 'interview_recording.webm';
        const name = req.body.participantName || 'Unknown';
        const location = req.body.participantLocation || 'Unknown';
        const transcriptText = req.body.transcript || 'No transcript available.';
        
        const timestamp = Date.now();
        const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
        const filePrefix = `${timestamp}_${safeName}`;

        // 1. Save Audio and Transcript to disk
        fs.writeFileSync(path.join(dataDir, `${filePrefix}_audio.webm`), audioBuffer);
        fs.writeFileSync(path.join(dataDir, `${filePrefix}_transcript.txt`), transcriptText);

        // 2. Email the initial audio/transcript (fallback)
        const transcriptBuffer = Buffer.from(transcriptText, 'utf8');
        resend.emails.send({
            from: 'Interview App <onboarding@resend.dev>', 
            to: process.env.EMAIL_USER, 
            subject: `New Interview Recording: ${name} (${location})`,
            text: `Please find the attached WebM audio recording and text transcript from the interview app.\n\nParticipant: ${name}\nLocation: ${location}`,
            attachments: [
                { filename: originalName, content: audioBuffer },
                { filename: `${name}_${location}_Transcript.txt`, content: transcriptBuffer }
            ]
        }).catch(err => console.error("Resend error:", err));
        
        // 3. Respond immediately to the client to avoid 100s timeout
        res.status(200).json({ message: 'Audio uploaded successfully. Processing in background...' });

        // 4. Run LLM Pipeline in background
        if (process.env.OPENAI_API_KEY) {
            console.log(`Starting LLM pipeline for ${name}...`);
            try {
                const results = await runPipeline(transcriptText, name);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_interview_guide.md`), results.interview_guide);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_scoring_form.md`), results.scoring_form);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_case_brief.md`), results.case_brief);
                
                // Append CSV row
                const csvRow = results.csv_row + "\n";
                fs.appendFileSync(path.join(__dirname, '..', 'FirstShift20IntakeForm.csv'), csvRow);
                
                console.log(`LLM pipeline finished for ${name}.`);
            } catch (llmErr) {
                console.error("LLM Pipeline failed:", llmErr);
                fs.writeFileSync(path.join(dataDir, `${filePrefix}_error.txt`), `Failed to generate assessment: ${llmErr.message}`);
            }
        } else {
            console.warn("OPENAI_API_KEY not found. Skipping LLM pipeline.");
            fs.writeFileSync(path.join(dataDir, `${filePrefix}_error.txt`), `Failed: OPENAI_API_KEY is missing from environment variables.`);
        }

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Failed to process upload.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
