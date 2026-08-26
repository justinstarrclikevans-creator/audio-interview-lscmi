let questions = [];
let currentQuestionIndex = 0;

let mediaRecorder;
let audioChunks = [];

let participantName = "";
let participantLocation = "";

// DOM Elements
const introScreen1 = document.getElementById('intro-screen-1');
const introScreen2 = document.getElementById('intro-screen-2');
const introScreen3 = document.getElementById('intro-screen-3');
const detailsScreen = document.getElementById('details-screen');
const questionScreen = document.getElementById('question-screen');
const outroScreen = document.getElementById('outro-screen');

const nextIntro1Btn = document.getElementById('next-intro-1-btn');
const nextIntro2Btn = document.getElementById('next-intro-2-btn');
const startBtn = document.getElementById('start-btn');
const beginInterviewBtn = document.getElementById('begin-interview-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const restartBtn = document.getElementById('restart-btn');

const nameInput = document.getElementById('participant-name');
const locationSelect = document.getElementById('participant-location');
const detailsError = document.getElementById('details-error');
const permissionError = document.getElementById('permission-error');

const questionText = document.getElementById('question-text');
const questionSubtext = document.getElementById('question-subtext');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const outroTitle = document.getElementById('outro-title');
const outroText = document.getElementById('outro-text');
const spinner = document.getElementById('spinner');

let recognition;
let isRecording = false;
let finalTranscript = "";

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech recognition not supported in this browser.");
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    
    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + "\n";
            }
        }
    };
    
    recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } catch(e) {}
        }
    };
    
    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
    };
}
initSpeechRecognition();

// Initialize
async function loadQuestions() {
    try {
        const response = await fetch('questions.json');
        questions = await response.json();
    } catch (error) {
        console.error('Failed to load questions:', error);
        questionText.innerText = "Error loading questions. Please contact support.";
    }
}

function showDetailsScreen() {
    introScreen3.classList.remove('active');
    introScreen3.classList.add('hidden');
    detailsScreen.classList.remove('hidden');
    detailsScreen.classList.add('active');
}

function startInterview() {
    participantName = nameInput.value.trim();
    participantLocation = locationSelect.value;

    if (!participantName || !participantLocation) {
        detailsError.classList.remove('hidden');
        return;
    }
    
    detailsError.classList.add('hidden');
    audioChunks = [];
    
    isRecording = true;
    finalTranscript = "";
    if (recognition) { 
        try { recognition.start(); } catch(e) {} 
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                submitAudio(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();

            // Hide details, show questions
            detailsScreen.classList.remove('active');
            detailsScreen.classList.add('hidden');
            questionScreen.classList.remove('hidden');
            questionScreen.classList.add('active');
            
            showQuestion(0);
        })
        .catch(error => {
            console.error('Microphone access denied:', error);
            permissionError.classList.remove('hidden');
        });
}

function showQuestion(index) {
    if (index < 0 || index >= questions.length) return;
    
    currentQuestionIndex = index;
    const q = questions[index];
    
    questionText.innerText = q.text;
    questionSubtext.innerText = q.subtext || "";
    
    // Update progress
    const progressPercent = ((index + 1) / questions.length) * 100;
    progressBar.style.width = `${progressPercent}%`;
    progressText.innerText = `Question ${index + 1} of ${questions.length}`;
    
    // Update buttons
    if (index === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }
    
    if (index === questions.length - 1) {
        nextBtn.classList.add('hidden');
        finishBtn.classList.remove('hidden');
    } else {
        nextBtn.classList.remove('hidden');
        finishBtn.classList.add('hidden');
    }
}

function finishInterview() {
    // Show outro screen
    questionScreen.classList.remove('active');
    questionScreen.classList.add('hidden');
    outroScreen.classList.remove('hidden');
    outroScreen.classList.add('active');
    
    // Stop recording and submit
    isRecording = false;
    if (recognition) { 
        try { recognition.stop(); } catch(e) {} 
    }
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    } else {
        showUploadError();
    }
}

async function submitAudio(audioBlob) {
    // Clean up name for filename
    const safeName = participantName.replace(/[^a-z0-9]/gi, '_');
    const safeLocation = participantLocation.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeName}_${safeLocation}.webm`;

    const formData = new FormData();
    formData.append('audio', audioBlob, filename);
    formData.append('participantName', participantName);
    formData.append('participantLocation', participantLocation);
    formData.append('transcript', finalTranscript);
    
    try {
        const response = await fetch('/api/upload-audio', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            spinner.classList.add('hidden');
            outroTitle.innerText = "All done!";
            outroTitle.style.color = "var(--success-color)";
            outroText.innerText = "Your interview has been recorded and emailed successfully. You may close this window.";
            restartBtn.classList.remove('hidden');
        } else {
            throw new Error('Server returned an error');
        }
    } catch (error) {
        console.error('Upload failed:', error);
        showUploadError();
    }
}

function showUploadError() {
    spinner.classList.add('hidden');
    outroTitle.innerText = "Upload Failed";
    outroTitle.style.color = "var(--danger-color)";
    outroText.innerText = "There was an error sending the recording. Please contact support or try again.";
    restartBtn.classList.remove('hidden');
}

function resetApp() {
    currentQuestionIndex = 0;
    nameInput.value = '';
    locationSelect.value = '';
    participantName = '';
    participantLocation = '';
    
    outroScreen.classList.remove('active');
    outroScreen.classList.add('hidden');
    introScreen1.classList.remove('hidden');
    introScreen1.classList.add('active');
    
    spinner.classList.remove('hidden');
    outroTitle.innerText = "Finishing up...";
    outroTitle.style.color = "var(--primary-color)";
    outroText.innerHTML = "You may leave the room, but <strong>please leave the computer and browser open while it uploads.</strong>";
    restartBtn.classList.add('hidden');
    permissionError.classList.add('hidden');
    detailsError.classList.add('hidden');
}

// Event Listeners
nextIntro1Btn.addEventListener('click', () => { introScreen1.classList.remove('active'); introScreen1.classList.add('hidden'); introScreen2.classList.remove('hidden'); introScreen2.classList.add('active'); });
nextIntro2Btn.addEventListener('click', () => { introScreen2.classList.remove('active'); introScreen2.classList.add('hidden'); introScreen3.classList.remove('hidden'); introScreen3.classList.add('active'); });
startBtn.addEventListener('click', showDetailsScreen);
beginInterviewBtn.addEventListener('click', startInterview);
prevBtn.addEventListener('click', () => showQuestion(currentQuestionIndex - 1));
nextBtn.addEventListener('click', () => showQuestion(currentQuestionIndex + 1));
finishBtn.addEventListener('click', finishInterview);
restartBtn.addEventListener('click', resetApp);

// Initialize
loadQuestions();
