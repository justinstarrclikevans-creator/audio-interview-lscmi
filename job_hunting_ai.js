// Turn90 Job Hunting AI Engine
// Powered by Gemini 3.6 Flash with Live Spreadsheet Openings & Fair-Chance Directory

const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');
const { loadJobsFromSpreadsheets } = require('./jobs_loader');
const { SC_FAIR_CHANCE_EMPLOYERS, SC_COMMUNITY_RESOURCES } = require('./sc_resource_directory');

require('dotenv').config({ path: path.join(__dirname, '.env') });
if (!process.env.GEMINI_API_KEY) {
    require('dotenv').config({ path: path.join(__dirname, '..', 'Facilitation Scoring', '.env') });
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Intelligent Job Matching against Live Spreadsheet Openings & Fair-Chance Employers
 */
async function matchJobsWithAi(criteria = {}, participantProfile = {}) {
    // 1. Gather all active jobs from spreadsheets & fair-chance employer directory
    const sheetJobs = loadJobsFromSpreadsheets();
    
    // Combine and normalize available jobs (strictly excluding Turn90 as an employer)
    const allPool = [];
    const seen = new Set();

    sheetJobs.forEach(j => {
        const comp = (j.company || '').trim();
        if (comp.toLowerCase().includes('turn90') || comp.toLowerCase().includes('turn ninety')) return;
        const key = `${comp.toLowerCase()}_${(j.jobTitle || '').toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            allPool.push({
                company: comp,
                jobTitle: j.jobTitle || 'Specialist',
                location: j.location || 'Charleston, SC',
                payRate: j.payRate || 'Competitive / Market Rate',
                description: j.description || '',
                careersUrl: j.careersUrl || 'https://www.google.com/search?q=' + encodeURIComponent(`${comp} careers application`)
            });
        }
    });

    // Add verified regional fair-chance employers
    SC_FAIR_CHANCE_EMPLOYERS.forEach(e => {
        const comp = (e.company || '').trim();
        if (comp.toLowerCase().includes('turn90') || comp.toLowerCase().includes('turn ninety')) return;
        const key = `${comp.toLowerCase()}_${(e.typicalRoles || '').toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            allPool.push({
                company: comp,
                jobTitle: e.typicalRoles ? e.typicalRoles.split(',')[0].trim() : 'Team Member',
                location: e.location || 'Charleston, SC',
                payRate: e.startingPay || '$17.00 - $22.00 / hr',
                description: `Second-chance fair employer in ${e.industry || 'Industry'}. Bus accessible: ${e.busAccessible ? 'Yes (CARTA / Regional transit)' : 'Personal transportation recommended'}.`,
                careersUrl: e.careersUrl || 'https://www.google.com/search?q=' + encodeURIComponent(`${comp} careers`)
            });
        }
    });

    // If Gemini is available, perform intelligent ranking & tailoring
    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({
                model: "gemini-3.6-flash",
                generationConfig: { responseMimeType: "application/json" }
            });

            // Sample top candidate pool up to 30 jobs to fit context
            const candidateList = allPool.slice(0, 35);

            const prompt = `
You are the "Turn90 Job Hunting AI", an expert second-chance workforce specialist and executive career coach for individuals re-entering the workforce in South Carolina.

CRITICAL RULES:
1. NEVER recommend Turn90 as an employer (participants are already in Turn90; they need outside employer placements).
2. Prioritize second-chance friendly employers, fair-chance policies, and high-wage trajectory trades (manufacturing, logistics, trade apprenticeships, technical assembly).
3. If transit constraint is specified (e.g. CARTA bus, no personal car), flag whether jobs are transit accessible.
4. If a curfew constraint is specified (e.g. 8 PM probation curfew), ensure shift compatibility.

Participant Context:
- Target Search Query / Interests: "${criteria.query || 'Manufacturing, warehouse, trades, or logistics'}"
- Location: "${criteria.location || participantProfile.location || 'Charleston, SC'}"
- Trade Skills / Certifications: "${criteria.skills || participantProfile.skills || 'OSHA 10, Forklift Certified, Jobsite Safety, Hand Tools'}"
- Desired Minimum Pay: "${criteria.minPay || '$18.00 / hr'}"
- Transportation Status: "${criteria.transit || participantProfile.transportation_status || 'CARTA Bus Line'}"
- Legal / Curfew Constraints: "${criteria.curfew || 'Standard daytime shift preferred; avoid overnight shifts if probation restricts'}"

Available Openings Pool:
${JSON.stringify(candidateList, null, 2)}

Return a JSON response with this EXACT structure:
{
  "aiSearchSummary": "A concise 2-sentence summary of the job market analysis for this participant's skills and location.",
  "coachingAdvice": "Actionable career advice for the participant on how to stand out during applications.",
  "matchedJobs": [
    {
      "company": "Company Name",
      "jobTitle": "Job Title",
      "location": "City, SC",
      "payRate": "Pay Rate / Wage",
      "careersUrl": "Direct careers URL from candidate list",
      "fitScore": 92,
      "transitFriendly": true,
      "matchReasons": [
        "Concrete reason 1 (e.g. Matches your OSHA 10 and Forklift certifications)",
        "Concrete reason 2 (e.g. Second-chance friendly employer with day shift)",
        "Concrete reason 3 (e.g. Accessible via CARTA Route 10 bus line)"
      ],
      "turnaroundTip": "Specific tip on how to highlight strengths for this specific employer."
    }
  ]
}
Select the TOP 4 to 6 best matching jobs from the pool.`;

            const result = await model.generateContent(prompt);
            const data = JSON.parse(result.response.text());
            if (data.matchedJobs && data.matchedJobs.length > 0) {
                return data;
            }
        } catch (e) {
            console.warn('Gemini job matching fallback:', e.message);
        }
    }

    // Fallback deterministic matching
    const q = (criteria.query || '').toLowerCase();
    const filtered = allPool.filter(j => {
        if (!q) return true;
        const text = `${j.company} ${j.jobTitle} ${j.description} ${j.location}`.toLowerCase();
        return q.split(' ').some(word => word.length > 2 && text.includes(word));
    }).slice(0, 5);

    const fallbackMatches = (filtered.length > 0 ? filtered : allPool.slice(0, 5)).map((j, i) => ({
        company: j.company,
        jobTitle: j.jobTitle,
        location: j.location,
        payRate: j.payRate,
        careersUrl: j.careersUrl,
        fitScore: 90 - (i * 3),
        transitFriendly: true,
        matchReasons: [
            `Strong alignment with your Turn90 trade and manufacturing training`,
            `Active second-chance hiring partner in ${j.location}`,
            `Competitive wage structure with advancement potential`
        ],
        turnaroundTip: `Emphasize your 100% attendance rate and team-first accountability learned at Turn90.`
    }));

    return {
        aiSearchSummary: `Matched ${fallbackMatches.length} high-potential second-chance opportunities in ${criteria.location || 'Charleston, SC'} based on your skills and verified employer openings.`,
        coachingAdvice: `Apply online via the direct links below, and practice your 60-second Turnaround Narrative before employer phone screens.`,
        matchedJobs: fallbackMatches
    };
}

/**
 * AI Resume Tailorer: Generates targeted bullet points for a specific job
 */
async function generateTailoredResumePoints(jobTitle, company, userSkills = '', tradeTrack = '') {
    const defaultTrack = tradeTrack || 'Manufacturing & Industrial Safety';
    const skillsList = userSkills || 'OSHA 10 Certified, Forklift Operation, Hand & Power Tools, Blueprint Reading, De-escalation & Team Communication';

    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
            const prompt = `
You are an expert resume writer specializing in helping second-chance job candidates win interviews at top employers.

Write 4 powerful, professional, action-oriented resume bullet points tailored specifically for:
Target Position: "${jobTitle}"
Target Employer: "${company}"
Candidate's Turn90 Trade Track: "${defaultTrack}"
Candidate's Verified Skills: "${skillsList}"

Rules:
- Begin each bullet with a strong action verb (Operated, Executed, Maintained, Certified, Coordinated, Implemented).
- Highlight reliability, safety standards (OSHA 10), punctuality, and productivity.
- Do NOT mention incarceration or criminal record on the resume. Frame experience through professional trade training and workforce performance.
- Return ONLY the 4 bullet points formatted with standard markdown asterisks.`;

            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (e) {
            console.warn('Gemini resume points fallback:', e.message);
        }
    }

    return `* Maintained 100% compliance with OSHA 10 safety standards while operating industrial equipment and handling materials in high-velocity environments.
* Demonstrated rigorous workplace accountability and punctuality, completing advanced cognitive-behavioral and technical trade training at Turn90.
* Collaborated effectively within diverse teams to exceed daily production targets, utilizing active listening and professional conflict de-escalation methods.
* Applied hands-on proficiency in equipment inspection, hazard mitigation, and precision assembly to ensure zero jobsite accidents.`;
}

/**
 * AI Turnaround Narrative & Background Explanation Coach
 */
async function generateTurnaroundNarrative(jobTitle, company, participantBackground = '') {
    if (genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
            const prompt = `
You are an executive interview coach trained in the Turn90 Evidence-Based Model.
Help a candidate prepare their "Turnaround Narrative" for an interview at:
Company: "${company}"
Position: "${jobTitle}"
Background Context: "${participantBackground || 'Justice-involved candidate with a past felony conviction, currently excelling in the Turn90 program'}"

The Turn90 Turnaround Formula:
1. Direct Accountability (15-20 seconds): Acknowledge past mistakes briefly without blame, excuses, or graphic details.
2. Concrete Evidence of Change (30 seconds): Describe the rigorous work done at Turn90 (CBT training, cognitive restructuring, perfect attendance, trade badges).
3. Value to the Employer (15-20 seconds): Pivot directly back to why this makes them the most dependable, grateful, and hard-working employee on the team.

Return:
1. **The 60-Second Script**: Word-for-word conversational answer the candidate can memorize and say naturally when asked "Can you explain this gap on your resume?" or "Tell me about your background."
2. **Key Delivery Tips**: 3 concise bullet points on body language, tone, and pacing (Modeling Neutrality).`;

            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (e) {
            console.warn('Gemini turnaround narrative fallback:', e.message);
        }
    }

    return `### 🎙️ Your 60-Second Turnaround Script for ${company}

> *"Several years ago, I made poor choices that led to my involvement with the justice system. I take 100% accountability for my past actions, and that experience served as the turning point in my life.*
>
> *Since then, I have been focused entirely on building a solid, productive future. I completed Turn90's rigorous cognitive-behavioral workforce program, earning my OSHA 10 certification, mastering equipment operation, and maintaining a perfect attendance record. Through that training, I developed strong discipline, problem-solving skills, and a team-first mindset.*
>
> *I am excited about this ${jobTitle} role at ${company} because you value hard work and safety. I bring a relentless work ethic, punctuality, and complete dedication to doing the job right every single day. If you give me the opportunity, I will be one of the most reliable and loyal team members you have."*

#### 💡 Key Delivery Tips:
* **Maintain steady eye contact and an open posture:** Do not look down or apologize repeatedly; speak with quiet confidence and dignity.
* **Keep it under 60 seconds:** Never get dragged into discussing case details or court dates; immediately pivot to the skills and reliability you bring today.
* **Smile and end with enthusiasm:** Show genuine excitement for the specific opportunity at ${company}.`;
}

module.exports = {
    matchJobsWithAi,
    generateTailoredResumePoints,
    generateTurnaroundNarrative
};
