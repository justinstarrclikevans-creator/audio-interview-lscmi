let questions = [];
let currentQuestionIndex = 0;
let mediaRecorder;
let audioChunks = [];

// DOM Elements
const introScreen = document.getElementById('intro-screen');
const questionScreen = document.getElementById('question-screen');
const outroScreen = document.getElementById('outro-screen');

const startBtn = document.getElementById('start-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const restartBtn = document.getElementById('restart-btn');
const permissionError = document.getElementById('permission-error');

const questionText = document.getElementById('question-text');
const questionSubtext = document.getElementById('question-subtext');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const outroTitle = document.getElementById('outro-title');
const outroText = document.getElementById('outro-text');
const spinner = document.getElementById('spinner');

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

async function startInterview() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            await submitAudio();
        };

        mediaRecorder.start();
        
        // Hide intro, show questions
        introScreen.classList.remove('active');
        introScreen.classList.add('hidden');
        questionScreen.classList.remove('hidden');
        questionScreen.classList.add('active');
        
        showQuestion(0);
        
    } catch (error) {
        console.error('Microphone access denied:', error);
        permissionError.classList.remove('hidden');
    }
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

async function finishInterview() {
    // Show outro screen
    questionScreen.classList.remove('active');
    questionScreen.classList.add('hidden');
    outroScreen.classList.remove('hidden');
    outroScreen.classList.add('active');
    
    // Stop recording, which triggers the onstop event to submit
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        
        // Stop all tracks to turn off the microphone light
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
}

async function submitAudio() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    
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
        spinner.classList.add('hidden');
        outroTitle.innerText = "Upload Failed";
        outroTitle.style.color = "var(--danger-color)";
        outroText.innerText = "There was an error sending the recording. Please contact support or try again.";
        restartBtn.classList.remove('hidden');
    }
}

function resetApp() {
    audioChunks = [];
    currentQuestionIndex = 0;
    
    outroScreen.classList.remove('active');
    outroScreen.classList.add('hidden');
    introScreen.classList.remove('hidden');
    introScreen.classList.add('active');
    
    spinner.classList.remove('hidden');
    outroTitle.innerText = "Finishing up...";
    outroTitle.style.color = "var(--primary-color)";
    outroText.innerText = "Please wait while we save and send your recording.";
    restartBtn.classList.add('hidden');
    permissionError.classList.add('hidden');
}

// Event Listeners
startBtn.addEventListener('click', startInterview);
prevBtn.addEventListener('click', () => showQuestion(currentQuestionIndex - 1));
nextBtn.addEventListener('click', () => showQuestion(currentQuestionIndex + 1));
finishBtn.addEventListener('click', finishInterview);
restartBtn.addEventListener('click', resetApp);

// Initialize
loadQuestions();
