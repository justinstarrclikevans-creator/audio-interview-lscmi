const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const dns = require('dns');

// Force IPv4 to fix Render ENETUNREACH error with Gmail
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config({ path: path.join(__dirname, '..', 'email-settings.txt') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Email configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD
    }
});

app.post('/api/upload-audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded.' });
        }

        const audioBuffer = req.file.buffer;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Sending to yourself
            subject: 'New Interview Recording Submission',
            text: 'Please find the attached audio recording from the interview app.',
            attachments: [
                {
                    filename: 'interview_recording.webm',
                    content: audioBuffer
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        
        res.status(200).json({ message: 'Audio uploaded and emailed successfully!' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ error: 'Failed to send the audio email. Please check server logs.' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
