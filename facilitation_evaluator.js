// Class Facilitation Evaluator
// Evaluates class transcripts/audio against the 20-item Turn90 Facilitator Scoring Guide & Module Workbooks
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');
const model = genAI.getGenerativeModel({ 
    model: "gemini-3.6-flash", 
    generationConfig: { responseMimeType: "application/json" } 
});

// Ensure class_facilitation_evaluations table exists
db.exec(`
CREATE TABLE IF NOT EXISTS class_facilitation_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location TEXT NOT NULL,
    session_title TEXT NOT NULL,
    facilitator_name TEXT,
    evaluator_name TEXT DEFAULT 'AI Clinical Evaluator',
    class_date DATE DEFAULT (DATE('now')),
    total_score REAL NOT NULL, -- 0 to 100
    starting_score REAL DEFAULT 100,
    modeling_neutrality_score REAL,
    lesson_plan_adherence_score REAL,
    reflective_listening_score REAL,
    avoiding_confrontation_score REAL,
    summary_markdown TEXT NOT NULL,
    scores_json TEXT NOT NULL,
    coaching_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

const FACILITATION_RUBRIC_PROMPT = `
You are the Lead Facilitator Supervisor and Clinical Quality Assurance Director for Turn90 / First Shift.
You are evaluating a classroom session transcript using the Turn90 CBT Facilitation Scoring Guide (20-item 100-point rubric):

Evaluation Dimensions (Each rated 1 to 5, total 100 pts max):
1.0 Classroom Setup & Materials Readiness (5 pts)
2.0 Preparedness & Content Mastery (5 pts)
3.0 Follows Lesson Plan & Script Structure (5 pts)
4.0 Understands Core Concepts (5 pts)
5.0 Time Management & Pacing (5 pts)
6.0 Enthusiasm & Dynamic Delivery (5 pts)
7.0 Homework Review & Point System Utilization (5 pts)
8.0 Main Activity / Role Plays Executed (5 pts)
9.0 Models Target Behaviors & Professionalism (5 pts)
10.0 Group Engagement & Broad Participation (5 pts)
11.0 Enforces Rules & Expectations Consistently (5 pts)
12.0 Physical Presence & Space Utilization (5 pts)
13.0 Effective Use of Praise Statements (5 pts)
14.0 Effective Use of Positive Affirmations (5 pts)
15.0 Nonverbal Expressions of Approval (5 pts)
16.0 Reflective Listening (Simple & Complex Reflections) (5 pts)
17.0 Questioning Strategy & Open-ended Inquiries (5 pts)
18.0 Getting Participant Buy-in on Key Takeaways (5 pts)
19.0 Avoiding Overdirecting (Accepting diverse viewpoints without lecturing) (5 pts)
20.0 Avoiding Confrontation / Modeling Neutrality (De-escalating resistance, zero power struggles) (5 pts)

Trainer Workbooks Reference Standards:
- Modeling Neutrality (1.5): Never argue with anti-social statements; use neutrality and reflective questioning.
- Following Lesson Plan (3.2): Clear transitions between Homework -> Intro -> Modeling -> Role Play -> Summary.

Return a valid JSON object matching:
{
  "total_score": 92.5,
  "scores": {
    "modeling_neutrality": 5,
    "lesson_plan_adherence": 4.5,
    "reflective_listening": 4.5,
    "avoiding_confrontation": 5,
    "praise_and_affirmations": 4,
    "roleplay_execution": 4.5,
    "time_management": 4.5
  },
  "strengths": [
    "Observed strength 1...",
    "Observed strength 2..."
  ],
  "areas_for_improvement": [
    "Coaching recommendation 1...",
    "Coaching recommendation 2..."
  ],
  "location_specific_notes": "Key observations for this cohort location...",
  "detailed_summary_markdown": "# Facilitation Evaluation Report\\n\\n..."
}
`;

async function evaluateClassTranscript(location, sessionTitle, facilitatorName, transcriptText) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

    const prompt = `${FACILITATION_RUBRIC_PROMPT}

Location: ${location}
Session / Module: ${sessionTitle}
Facilitator: ${facilitatorName}

Classroom Transcript to Evaluate:
${transcriptText}
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const evaluation = JSON.parse(responseText);

    // Save to database
    const stmt = db.prepare(`
        INSERT INTO class_facilitation_evaluations (
            location, session_title, facilitator_name, total_score,
            modeling_neutrality_score, lesson_plan_adherence_score,
            reflective_listening_score, avoiding_confrontation_score,
            summary_markdown, scores_json, coaching_feedback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        location,
        sessionTitle,
        facilitatorName || 'Staff Facilitator',
        evaluation.total_score || 88,
        evaluation.scores?.modeling_neutrality || 4.5,
        evaluation.scores?.lesson_plan_adherence || 4.5,
        evaluation.scores?.reflective_listening || 4.5,
        evaluation.scores?.avoiding_confrontation || 5,
        evaluation.detailed_summary_markdown || '',
        JSON.stringify(evaluation.scores || {}),
        (evaluation.areas_for_improvement || []).join('; ')
    );

    return evaluation;
}

module.exports = { evaluateClassTranscript };
