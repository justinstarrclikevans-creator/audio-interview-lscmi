const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Resend } = require('resend');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'email-settings.txt') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

app.post('/api/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded.' });
        }

        const audioBuffer = req.file.buffer;
        
        const { data, error } = await resend.emails.send({
            from: 'Interview App <onboarding@resend.dev>', 
            to: process.env.EMAIL_USER, 
            subject: 'New Interview Recording Submission',
            text: 'Please find the attached audio recording from the interview app.',
            attachments: [
                {
                    filename: 'interview_recording.webm',
                    content: audioBuffer
                }
            ]
        });

        if (error) {
            console.error('Resend API Error:', error);
            return res.status(500).json({ error: 'Failed to send the audio email via Resend.' });
        }
        
        res.status(200).json({ message: 'Audio uploaded and emailed successfully!' });
    } catch (error) {
        console.error('Unexpected error sending email:', error);
        res.status(500).json({ error: 'Failed to send the audio email. Please check server logs.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
