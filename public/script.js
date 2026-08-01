let questions = [];
let currentQuestionIndex = 0;

// MicRecorder from mic-recorder-to-mp3
const recorder = new MicRecorder({ bitRate: 128 });

let participantName = "";
let participantLocation = "";

// DOM Elements
const introScreen = document.getElementById('intro-screen');
const detailsScreen = document.getElementById('details-screen');
const questionScreen = document.getElementById('question-screen');
const outroScreen = document.getElementById('outro-screen');

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
    introScreen.classList.remove('active');
    introScreen.classList.add('hidden');
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

    // Start recording
    recorder.start().then(() => {
        // Hide details, show questions
        detailsScreen.classList.remove('active');
        detailsScreen.classList.add('hidden');
        questionScreen.classList.remove('hidden');
        questionScreen.classList.add('active');
        
        showQuestion(0);
    }).catch((error) => {
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
    recorder.stop().getMp3().then(([buffer, blob]) => {
        submitAudio(blob);
    }).catch((e) => {
        console.error('Error stopping recording:', e);
        showUploadError();
    });
}

async function submitAudio(audioBlob) {
    // Clean up name for filename
    const safeName = participantName.replace(/[^a-z0-9]/gi, '_');
    const safeLocation = participantLocation.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeName}_${safeLocation}.mp3`;

    const formData = new FormData();
    formData.append('audio', audioBlob, filename);
    formData.append('participantName', participantName);
    formData.append('participantLocation', participantLocation);
    
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
    introScreen.classList.remove('hidden');
    introScreen.classList.add('active');
    
    spinner.classList.remove('hidden');
    outroTitle.innerText = "Finishing up...";
    outroTitle.style.color = "var(--primary-color)";
    outroText.innerHTML = "You may leave the room, but <strong>please leave the computer and browser open while it uploads.</strong>";
    restartBtn.classList.add('hidden');
    permissionError.classList.add('hidden');
    detailsError.classList.add('hidden');
}

// Event Listeners
startBtn.addEventListener('click', showDetailsScreen);
beginInterviewBtn.addEventListener('click', startInterview);
prevBtn.addEventListener('click', () => showQuestion(currentQuestionIndex - 1));
nextBtn.addEventListener('click', () => showQuestion(currentQuestionIndex + 1));
finishBtn.addEventListener('click', finishInterview);
restartBtn.addEventListener('click', resetApp);

// Initialize
loadQuestions();
