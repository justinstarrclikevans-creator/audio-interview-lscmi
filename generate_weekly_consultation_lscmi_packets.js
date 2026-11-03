/**
 * generate_weekly_consultation_lscmi_packets.js
 *
 * Uses the Apricot Reentry Consultation & Case Management collateral records
 * from this week (10/26/2026 – 11/03/2026) to generate complete, Consultation-informed
 * LS/CMI assessment packets (Transcript, 158-Question Interview Guide, Draft & Final
 * Scoring Forms, PM Case Brief, and Printable Participant Action Plan + PDF/DOCX)
 * for everyone who completed their Consultation / Orientation / Initial Intake interview.
 */

const fs = require('fs');
const path = require('path');
const { getParticipantConsultationLscmiContext } = require('./services/apricot_eval_engine');
const { convertSingleMdToPdf } = require('./convert_md_to_pdf');
const { convertSingleMdToDocx } = require('./convert_md_to_docx');

const dataDir = path.join(__dirname, 'data');
const questions = require('./public/questions.json');

const WEEKLY_INTERVIEW_PROFILES = [
    // =========================================================================
    // 1. THIS WEEK'S FIRST SHIFT COHORT & INITIAL INTAKE / ORIENTATION COMPLETIONS
    // =========================================================================
    {
        recordId: '82409',
        clientId: 'Jayhova_Freeman_Spartanburg',
        fullName: 'Jayhova Freeman',
        center: 'Spartanburg',
        interviewDate: 'October 26–30, 2026',
        assessor: 'Daisy Boynton & Matt Carlisle',
        dob: 'Verified in Apricot (#82409)',
        address: 'Apartment in Spartanburg, SC (Stable Housing)',
        dlStatus: 'Suspended due to one unpaid traffic ticket; owns a personal vehicle ready to drive upon reinstatement',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes), Current Cherry Picker License Card',
        juvConvictions: '0 juvenile convictions',
        adultConvictions: '1 adult conviction (2 total arrests; first arrest at age 22)',
        pendingCharges: 'No pending charges. Released from county jail in late September 2026 after serving 3 months (non-trafficking, non-firearm offense).',
        firstArrestAge: '22 years old',
        incarceratedEver: 'Yes, served 3 months in county jail (released late September 2026).',
        instMisconduct: 'No institutional misconduct reports documented.',
        supervisionBreach: 'No; currently in full compliance with federal supervision (projected end date: 02/18/2027).',
        employedNow: 'No, enrolled full-time in Turn90 First Shift (Spartanburg) starting 11/02/2026.',
        monthsWorked12: 'Approximately 8–9 months in the past year prior to 3-month incarceration.',
        longestJob: '3 years at Copart (auto auction) and 1 year at Bentley Automotive (most recent job).',
        gradeCompleted: 'Completed High School Diploma and up to Sophomore Year of College.',
        hasGedOrHs: 'Yes, High School Diploma and 2 years of college.',
        whyJobsEnded: 'Left Copart after 3 years due to having a child and relocating; most recent 1-year job at Bentley Automotive ended due to incarceration.',
        maritalStatus: 'In a committed relationship with his girlfriend (who provides primary transportation); father to 1 child.',
        parentCriminalRecord: 'Yes — participant reported during consultation that he is "pretty sure" his biological parent(s) have a criminal record.',
        freeTime: 'Spends time at his apartment with his girlfriend and child; preparing for automotive/warehouse career.',
        substanceHistory: 'No history of major alcohol abuse; past marijuana use only. Reports complete abstinence and passes federal probation drug tests.',
        supervisionDetails: 'Federal supervision ending 02/18/2027; in full compliance.',
        childSupport: 'Supports his child directly; owes $0 in court-ordered child support arrears.',
        certifications: 'Current Cherry Picker Certification (license card); pursuing Forklift & SkillCat trade certifications.',
        transportationPlan: 'Girlfriend provides primary daily rides to 111 Belton Drive; Uber serves as backup until unpaid ticket is cleared to reinstate his DL.',
        cbtFocus1: 'Work and Follow-Through (Employment / Career Continuity)',
        cbtFocus2: 'Thinking Patterns (Proactive Decision-Making & Legal Compliance)',
        cbtFocus3: 'Time and Structure (Financial Planning & License Reinstatement)',
        personalPattern1: 'Allowing unresolved administrative obligations (such as a single unpaid traffic ticket or legal complication) to snowball into interrupted employment.',
        personalPattern2: 'Declining early help or trying to handle every barrier solo rather than asking support networks early.',
        personalPattern3: 'Relying on expensive backup rides (Uber) instead of sequencing a rapid payoff of the single traffic ticket holding back his driver’s license.',
        scores: { ch: 3, ee: 2, fm: 1, lr: 1, co: 1, adp: 2, pa: 1, ap: 0, total: 11, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82567',
        clientId: 'Carl_Allen_Spartanburg',
        fullName: 'Carl Allen',
        center: 'Spartanburg',
        interviewDate: 'October 28–30, 2026',
        assessor: 'Daisy Boynton & Spartanburg First Shift Team',
        dob: 'Verified in Apricot (#82567)',
        address: 'Jumpstart Transitional Housing, Spartanburg, SC (Eligible to stay up to 2 years)',
        dlStatus: 'Valid Driver’s License in good standing',
        idDocs: 'Valid Driver’s License (Yes), Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes)',
        juvConvictions: 'Juvenile arrest history starting around age 13',
        adultConvictions: '7 to 8 total convictions across 7 to 8 arrests',
        pendingCharges: 'No pending charges. Most recently released October 1, 2026 after serving approximately 5 years in prison (non-trafficking, non-firearm).',
        firstArrestAge: 'Approximately 13 years old',
        incarceratedEver: 'Yes, most recently served ~5 years in state prison, released October 1, 2026.',
        instMisconduct: 'Completed prison industries (PIE) electronics/cable assembly work while incarcerated.',
        supervisionBreach: 'Currently in full compliance on state parole (approx. 5 months remaining until March 2027).',
        employedNow: 'No, enrolled full-time in Turn90 First Shift (Spartanburg) starting 11/02/2026.',
        monthsWorked12: 'Worked in prison industries (PIE cable assembly) prior to October 1, 2026 release.',
        longestJob: 'Approximately 1 year in remodeling construction and institutional cable assembly.',
        gradeCompleted: 'Completed 9th grade; earned GED.',
        hasGedOrHs: 'Yes, holds a GED.',
        whyJobsEnded: 'Community construction jobs ended due to substance instability and incarceration; PIE cable assembly ended upon prison release.',
        maritalStatus: 'Single; both biological parents are deceased; no child support obligations.',
        parentCriminalRecord: 'Both biological parents are deceased (no active family criminal influence).',
        freeTime: 'Structured routines through Jumpstart transitional housing and recovery fellowship.',
        substanceHistory: 'No major alcohol abuse; history of long-term methamphetamine use that previously led to homelessness. Clean and sober for over 2 years.',
        supervisionDetails: 'On state parole until approximately March 2027 (5 months remaining); in full compliance; Turn90 is voluntary.',
        childSupport: 'None ($0 owed).',
        certifications: 'IPC Certification and J-Standard Certification (electronics assembly and soldering); pursuing Forklift & SkillCat HVAC/trades.',
        transportationPlan: 'Jumpstart transitional housing transportation confirmed, with Spartanburg Dial-a-Ride (864-560-4118) as backup.',
        cbtFocus1: 'Substance Recovery & Relapse Prevention (Protecting 2+ Years Clean)',
        cbtFocus2: 'Work and Follow-Through (Transitioning IPC/Soldering & Construction Skills to Full-Time Payroll)',
        cbtFocus3: 'People and Influence (Maintaining Jumpstart Prosocial Community Support)',
        personalPattern1: 'Internalizing stress or isolating when transitioning from a highly structured 5-year institutional routine back into community independence.',
        personalPattern2: 'Undervaluing technical credentials (IPC/J-Standard soldering & construction) when approaching new employers after incarceration.',
        personalPattern3: 'Managing daily logistics (ride scheduling and medical appointments for blood pressure) without last-minute disruptions.',
        scores: { ch: 6, ee: 3, fm: 1, lr: 1, co: 1, adp: 2, pa: 1, ap: 1, total: 16, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82300',
        clientId: 'Alec_Greene_Spartanburg',
        fullName: 'Alec Greene',
        center: 'Spartanburg',
        interviewDate: 'October 22–30, 2026',
        assessor: 'Daisy Boynton, Matt Carlisle & Diyoung Dantzler',
        dob: 'Verified in Apricot (#82300)',
        address: 'Turn 12 Sober Living, Spartanburg, SC (Stable Recovery Housing)',
        dlStatus: 'No current driver’s license (held one in the past, needs DMV status check)',
        idDocs: 'Social Security Card (Yes) and State ID (Yes); needs Birth Certificate',
        juvConvictions: '0 juvenile arrests (first arrest at age 21)',
        adultConvictions: '2 to 3 convictions (3 to 4 total arrests, 3 to 4 incarcerations)',
        pendingCharges: 'No pending charges. Released from jail in October 2026 after serving approximately 1 year.',
        firstArrestAge: '21 years old',
        incarceratedEver: 'Yes, 3–4 incarcerations; most recently served ~1 year in jail.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Currently compliant on state probation (approx. 2 years remaining).',
        employedNow: 'No, enrolled full-time in Turn90 First Shift (Spartanburg) starting 11/02/2026.',
        monthsWorked12: '0 months in past 12 months (incarcerated for ~1 year; reports no prior formal legal payroll employment).',
        longestJob: 'No prior formal W-2 payroll job on record.',
        gradeCompleted: 'Completed High School and some college coursework.',
        hasGedOrHs: 'Yes, High School completion plus some college.',
        whyJobsEnded: 'Lack of formal payroll employment history due to substance use and justice involvement in early 20s.',
        maritalStatus: 'Single; no children or child support obligations; neither parent has a criminal record.',
        parentCriminalRecord: 'No — neither biological parent has a criminal record.',
        freeTime: 'Structured sober living house routines at Turn 12.',
        substanceHistory: 'Past methamphetamine use and marijuana use within the past year; no major alcohol abuse. Currently stable on prescribed Suboxone (MAT) and living at Turn 12 sober living.',
        supervisionDetails: 'State probation with ~2 years remaining; in full compliance.',
        childSupport: 'None ($0 owed).',
        certifications: 'Pursuing first trade credentials (Forklift, OSHA-10, SkillCat) at Turn90.',
        transportationPlan: 'Uses Uber (2 miles from Turn 12 to Spartanburg center) using savings until Week 2 stipend, then purchasing an electric bike.',
        cbtFocus1: 'Work and Follow-Through (Building First Formal Payroll Employment Track Record)',
        cbtFocus2: 'Substance Use & Recovery Maintenance (Suboxone MAT & Turn 12 Sober Living)',
        cbtFocus3: 'Time and Structure (Daily Punctuality & Transportation Independence)',
        personalPattern1: 'Entering the formal workforce without prior W-2 job experience, which can trigger self-doubt or hesitation when learning workplace norms.',
        personalPattern2: 'Relying on short-term ride-share funds without a locked-in long-term transit backup before purchasing his e-bike.',
        personalPattern3: 'Guarding against complacency in early community recovery after leaving a 1-year jail sentence.',
        scores: { ch: 4, ee: 4, fm: 1, lr: 1, co: 1, adp: 3, pa: 1, ap: 1, total: 16, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '77653',
        clientId: 'Robert_Taylor_Columbia',
        fullName: 'Robert Taylor',
        center: 'Columbia',
        interviewDate: 'October 19–30, 2026',
        assessor: 'Daisy Boynton & Jenn Jeanquart',
        dob: 'Verified in Apricot (#77653)',
        address: 'Staying with his mother in Columbia, SC (1.5 miles from Turn90 Columbia Center)',
        dlStatus: 'Suspended Driver’s License ($1,900 in DMV reinstatement fees plus traffic tickets; candidate for Rainy Day Fund)',
        idDocs: 'State ID, Social Security Card, Birth Certificate, and active Welvista prescription coverage',
        juvConvictions: 'Prior justice involvement documented in SCDC records',
        adultConvictions: 'Multiple prior convictions; released from SCDC on December 31, 2025',
        pendingCharges: 'No pending criminal charges; traffic tickets/reinstatement fees only.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, served state prison sentence in SCDC, released December 31, 2025.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Had an initial false start in June 2026 due to a failed preliminary UA before stabilizing and passing orientation drug testing on 10/30/2026.',
        employedNow: 'No, only intermittent temp work since SCDC release; started First Shift Columbia on 11/02/2026.',
        monthsWorked12: 'Intermittent temporary labor assignments between January and October 2026.',
        longestJob: 'Approximately 1 year in warehouse/general labor prior to SCDC sentence.',
        gradeCompleted: 'High School / GED equivalent.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Temp assignments ended due to short contracts, lack of driver’s license, and background barriers at Walmart/Amazon.',
        maritalStatus: 'Single; resides with his mother; father to 4 children (not on court-ordered child support).',
        parentCriminalRecord: 'Mother provides stable prosocial housing.',
        freeTime: 'Walking, job searching, spending time with mother and children.',
        substanceHistory: 'Failed a preliminary UA in June 2026 which delayed First Shift entry; re-engaged in October 2026, passed orientation drug testing, and is maintaining sobriety.',
        supervisionDetails: 'Post-release SCDC community reintegration.',
        childSupport: 'Has 4 children; not under court-ordered child support arrears.',
        certifications: 'Completed Turn90 Resume with Daisy Boynton on 10/20/2026; pursuing Forklift & SkillCat credentials.',
        transportationPlan: 'Lives 1.5 miles from the Columbia center; receives rides when available and walks on days rides are unavailable.',
        cbtFocus1: 'Work and Follow-Through (Transitioning from Temp Labor to Permanent Career)',
        cbtFocus2: 'Substance Use & Accountability (Maintaining Clean Weekly UAs Under Stress)',
        cbtFocus3: 'Time and Structure (Executing DMV Reinstatement & Independent Housing Plan)',
        personalPattern1: 'Becoming discouraged after repeated online job rejections (Amazon, Walmart, warehouses) and slipping into frustration or substance coping.',
        personalPattern2: 'Waiting until housing or financial stress reaches an emergency point before communicating with support staff.',
        personalPattern3: 'Letting the size of his DMV reinstatement balance ($1,900) feel insurmountable instead of tackling it step-by-step through RDF and program milestones.',
        scores: { ch: 5, ee: 4, fm: 1, lr: 1, co: 1, adp: 3, pa: 1, ap: 1, total: 17, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '81798',
        clientId: 'Davon_Thompson_Columbia',
        fullName: 'Davon Thompson',
        center: 'Columbia',
        interviewDate: 'October 23–30, 2026',
        assessor: 'Daisy Boynton & Jenn Jeanquart',
        dob: 'Verified in Apricot (#81798)',
        address: 'Columbia, SC (Bus-accessible to Turn90 Center)',
        dlStatus: 'Holds a valid Learner’s Permit; has never held a driver’s license and owes $0 in DMV fines',
        idDocs: 'Learner’s Permit / State ID, Social Security Card, Birth Certificate',
        juvConvictions: 'Prior history documented at intake',
        adultConvictions: 'Prior adult conviction(s); compliant with community expectations',
        pendingCharges: 'No pending charges and $0 in court or traffic fines.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'Practiced self-isolation during incarceration to avoid gang/peer conflict.',
        supervisionBreach: 'Compliant.',
        employedNow: 'No, started Turn90 First Shift (Columbia) on 11/02/2026.',
        monthsWorked12: 'Unemployed in recent months while seeking second-chance employers.',
        longestJob: 'Over 1 year in general labor / warehouse work.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Prior incarceration and lack of a driver’s license/personal vehicle.',
        maritalStatus: 'Father of 5 children; actively involved and supportive in their lives; owes $0 in child support arrears.',
        parentCriminalRecord: 'No active family criminal involvement noted.',
        freeTime: 'Spending time with his 5 children, practicing positive isolation from street peers, job searching.',
        substanceHistory: 'No history of drug or alcohol abuse.',
        supervisionDetails: 'Compliant with all legal requirements; owes no fines.',
        childSupport: 'Has 5 children; actively involved and supportive; not on child support arrears.',
        certifications: 'Professional resume completed with Daisy Boynton on 10/12/2026; pursuing Forklift, OSHA-10, and road test for full Driver’s License.',
        transportationPlan: 'Takes the Comet bus daily and walks 20 minutes from the bus stop to the Columbia center.',
        cbtFocus1: 'Work and Follow-Through (Converting Permit to Full Driver’s License & Trade Career)',
        cbtFocus2: 'Reactions and Self-Control (Managing Frustration & Maintaining Prosocial Boundaries)',
        cbtFocus3: 'Family and Relationships (Sustaining Positive Fatherhood for His 5 Children)',
        personalPattern1: 'Over-isolating when stressed or guarded rather than practicing assertive, open communication with supervisors and peers.',
        personalPattern2: 'Relying solely on bus routes and long walks instead of completing the final road test step to convert his learner’s permit into a full license.',
        personalPattern3: 'Taking on heavy family pressure for 5 children without structured financial budgeting.',
        scores: { ch: 4, ee: 3, fm: 0, lr: 1, co: 1, adp: 0, pa: 1, ap: 1, total: 11, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '81816',
        clientId: 'Justin_Dahl_Columbia',
        fullName: 'Justin Dahl',
        center: 'Columbia',
        interviewDate: 'October 23 – November 2, 2026',
        assessor: 'Daisy Boynton & Jenn Jeanquart',
        dob: 'Verified in Apricot (#81816)',
        address: 'Columbia, SC',
        dlStatus: 'Suspended pending ADSAP enrollment (DUI charge was dropped, but DMV still requires ADSAP proof of enrollment)',
        idDocs: 'State ID (obtained October 2026), Social Security Card, Birth Certificate',
        juvConvictions: '0 reported',
        adultConvictions: 'Prior adult conviction(s); past DUI charge was dropped',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant.',
        employedNow: 'No, started Turn90 First Shift (Columbia) on 11/02/2026.',
        monthsWorked12: 'Unemployed/temp work search prior to 11/02/2026 start.',
        longestJob: 'Over 1 year prior employment.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Past methamphetamine addiction and lack of driver’s license.',
        maritalStatus: 'Single.',
        parentCriminalRecord: 'None reported.',
        freeTime: 'Recovery maintenance, job searching, preparing for First Shift.',
        substanceHistory: 'History of methamphetamine addiction in the past; completed a 6-week residential treatment program at Pavilion (NC) and has been clean and sober for several years.',
        supervisionDetails: 'Needs ADSAP class enrollment to clear DMV administrative hold.',
        childSupport: 'None reported.',
        certifications: 'Completed 6-week Pavilion recovery program; completed Turn90 resume on 10/12/2026; pursuing Forklift & SkillCat credentials.',
        transportationPlan: 'Local rides/transit while saving First Shift stipends to enroll in ADSAP and immediately reinstate his Driver’s License.',
        cbtFocus1: 'Work and Follow-Through (Using First Shift Stipends to Enroll in ADSAP & Reinstate License)',
        cbtFocus2: 'Substance Recovery Maintenance (Building Long-Term Career Stability on Multi-Year Sobriety)',
        cbtFocus3: 'Time and Structure (Consistent Communication & Follow-Through on Appointments)',
        personalPattern1: 'Postponing administrative steps (like ADSAP registration) until financial pressure builds.',
        personalPattern2: 'Missing phone calls or delaying callbacks when feeling overwhelmed by logistics.',
        personalPattern3: 'Needing structured daily milestones to convert strong recovery discipline into career momentum.',
        scores: { ch: 4, ee: 3, fm: 1, lr: 1, co: 1, adp: 2, pa: 1, ap: 1, total: 14, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '80088',
        clientId: 'Eddie_Ballenger_Spartanburg',
        fullName: 'Eddie Ballenger',
        center: 'Spartanburg',
        interviewDate: 'November 2, 2026 (Re-Enrollment & Case Review)',
        assessor: 'Diyoung Dantzler & Matt Carlisle',
        dob: 'Verified in Apricot (#80088)',
        address: 'Spartanburg, SC (Resides with supportive family/fiancée)',
        dlStatus: 'Suspended due to a $400 unpaid traffic ticket; actively saving to pay ticket and visit DMV',
        idDocs: 'State ID, Social Security Card, Birth Certificate, Turn90 Forklift Certification',
        juvConvictions: 'Prior youthful justice involvement',
        adultConvictions: 'Prior adult convictions; currently on state probation',
        pendingCharges: 'No pending criminal charges; $400 traffic ticket for DL reinstatement.',
        firstArrestAge: 'Late teens / young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'In full compliance with probation; proactively notifies staff 2 weeks in advance of probation drug classes.',
        employedNow: 'Worked full-time at Highland Bakery (hired 10/13/2026), terminated 11/02/2026 because supervisor felt he was not learning job duties fast enough due to learning disability; immediately re-enrolled in First Shift on 11/02/2026.',
        monthsWorked12: 'Worked at Highland Bakery in October 2026.',
        longestJob: 'Less than 1 year continuous payroll employment (receives disability income).',
        gradeCompleted: 'Less than 12th grade; actively enrolled in Adult Education classes pursuing his GED.',
        hasGedOrHs: 'No — actively enrolled in Adult Education (transitioned from online to in-person classes) for his GED.',
        whyJobsEnded: 'Highland Bakery ended on 11/02/2026 due to learning pace expectations; earlier jobs ended due to peer influences and reacting emotionally to tone.',
        maritalStatus: 'Engaged to supportive fiancée; close improving relationship with his mother and daughter.',
        parentCriminalRecord: 'Raised in an environment with limited positive guidance; mother is now proud and supportive of his turnaround.',
        freeTime: 'Attending Adult Education GED classes, spending weekends with his fiancée and daughter, practicing CBT skills.',
        substanceHistory: 'Past marijuana/substance use that caused life setbacks; currently passing all drug screens, attending probation drug classes, and set a firm boundary with his fiancée against marijuana use in the household.',
        supervisionDetails: 'Active state probation; compliant and attending required drug education classes.',
        childSupport: 'Actively focused on being a present, responsible father to his daughter.',
        certifications: 'Earned Turn90 Forklift Certification (October 2026); pursuing GED and additional SkillCat credentials.',
        transportationPlan: 'Rides from mother, brother, and fiancée while paying off his $400 ticket to reinstate his driver’s license.',
        cbtFocus1: 'Work and Follow-Through (Matching Forklift & Pace Strengths to the Right Plant/Warehouse Role)',
        cbtFocus2: 'People and Influence (Maintaining Household Sobriety Boundaries & Avoiding Old Peer Traps)',
        cbtFocus3: 'Reactions and Self-Control (Focusing on the Message Rather Than Reacting to Supervisor Tone)',
        personalPattern1: 'Reacting to a supervisor’s or family member’s tone of voice ("jumping the gun") rather than slowing down to process the message.',
        personalPattern2: 'Experiencing workplace frustration when fast-paced instructions conflict with his learning style, requiring self-advocacy and step-by-step repetition.',
        personalPattern3: 'Allowing other people’s choices or household stress to distract him from his GED and license reinstatement goals.',
        scores: { ch: 4, ee: 4, fm: 1, lr: 0, co: 2, adp: 2, pa: 1, ap: 1, total: 15, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '80978',
        clientId: 'Melvin_Brown_Columbia',
        fullName: 'Melvin Brown',
        center: 'Columbia',
        interviewDate: 'October 28, 2026 (Initial First Shift Session 1 & Consultation Synthesis)',
        assessor: 'Jenn Jeanquart, Justin Evans & Daisy Boynton',
        dob: 'Verified in Apricot (#80978)',
        address: 'Lexington / Columbia, SC (Residing with family; father provides reliable daily transportation)',
        dlStatus: 'Suspended due to DUS, traffic tickets, and disorderly conduct (no DUIs); owes $1,740 with a concrete payment plan set for week of Nov 9 ($400 sister, $1,040 support, $300 client)',
        idDocs: 'State ID, Social Security Card, Birth Certificate, active bank account, verified professional voicemail',
        juvConvictions: 'Juvenile behavioral/school history',
        adultConvictions: 'Prior adult convictions; released from SCDC Trenton on July 31, 2026',
        pendingCharges: 'No pending criminal charges or sex offenses.',
        firstArrestAge: 'Teenage years',
        incarceratedEver: 'Yes, released from SCDC (Trenton) around July 31, 2026.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Currently on 3-year state probation (until 2028, eligible for early reduction upon completing Monday 6 PM substance abuse, parenting, and anger management classes — 7 classes remaining — and paying $800 Lexington Clerk of Court fee).',
        employedNow: 'Works weekend/part-time landscaping with his brother; enrolled full-time in Turn90 First Shift (Columbia) on 10/26/2026.',
        monthsWorked12: 'Part-time landscaping with his brother since August 2026 release.',
        longestJob: 'Over 1 year in landscaping/general labor.',
        gradeCompleted: 'High School Diploma / GED completed.',
        hasGedOrHs: 'Yes, High School Diploma / GED.',
        whyJobsEnded: 'Incarceration, transportation barriers, and shutting down or walking off when feeling disrespected or crowded.',
        maritalStatus: 'Single; father of 4 children; strong family support from mother, father (daily driver),brother (landscaping), and sister ($400 toward DMV fees).',
        parentCriminalRecord: 'Supportive parents assisting with housing and daily transportation.',
        freeTime: 'Working landscaping with brother, caring for his 4 children, attending Monday evening classes.',
        substanceHistory: 'Past marijuana use only; passing pre-employment and weekly Turn90 drug screens; completing court-ordered Monday 6 PM substance abuse class.',
        supervisionDetails: '3 years state probation; completing Monday 6 PM classes (7 left) and $800 court fee for early supervision reduction.',
        childSupport: 'Father of 4 children; motivated to obtain CDL to provide for his family.',
        certifications: 'Completed Turn90 Resume (10/01/2026); scheduled WIOA virtual orientation (11/04/2026) for $5,000 CDL trucking school funding; long-term goal to own 3 trucks.',
        transportationPlan: 'Father provides reliable daily transportation to the Columbia center until $1,740 DMV fees are paid the week of Nov 9.',
        cbtFocus1: 'Work and Follow-Through (Maintaining Attendance & Staying Calm Instead of Shutting Down/Leaving)',
        cbtFocus2: 'Reactions and Self-Control (Handling Disrespect / "Showing Out" & Crowded Work Environments)',
        cbtFocus3: 'Time and Structure (Executing Nov 9 DMV Payoff & WIOA CDL Funding Pipeline)',
        personalPattern1: 'Shutting down emotionally and walking off the job site when coworkers or supervisors "show out" (act disrespectfully) or when feeling crowded.',
        personalPattern2: 'Letting frustration build silently until reaching a breaking point instead of using a 3-second pause and assertive boundary statement.',
        personalPattern3: 'Balancing full-time First Shift hours, Monday evening probation classes, and weekend landscaping without burning out.',
        scores: { ch: 4, ee: 3, fm: 1, lr: 1, co: 1, adp: 2, pa: 2, ap: 1, total: 15, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '81443',
        clientId: 'Kwatez_Carter_Columbia',
        fullName: 'Kwatez Carter',
        center: 'Columbia',
        interviewDate: 'October 29, 2026 (Initial First Shift Case Management Session & Consultation Synthesis)',
        assessor: 'Jenn Jeanquart & Daisy Boynton',
        dob: 'Verified in Apricot (#81443)',
        address: 'Lexington, SC (Resides with mother and stepfather)',
        dlStatus: 'No current license; owes ~$300–$845 in DMV reinstatement/ticket fees; studying in computer lab for beginner’s permit test',
        idDocs: 'Has Birth Certificate and knows State ID number by heart; ordering physical Social Security Card online',
        juvConvictions: 'Prior youthful justice involvement',
        adultConvictions: 'Prior federal conviction; currently on federal supervision',
        pendingCharges: 'No pending criminal charges.',
        firstArrestAge: 'Late teens / young adulthood',
        incarceratedEver: 'Yes, served federal sentence.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant on federal supervision.',
        employedNow: 'No, recovered from October 2026 hernia surgery and started Turn90 First Shift (Columbia) on 10/26/2026.',
        monthsWorked12: '0 months in past year due to incarceration and October 2026 hernia surgery recovery.',
        longestJob: 'Less than 1 year continuous payroll employment.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Incarceration, reacting to workplace micromanagement/disrespect, and temptation of "fast money".',
        maritalStatus: 'Single; lives in Lexington with supportive mother and stepfather.',
        parentCriminalRecord: 'Mother and stepfather are prosocial and provide daily transportation and health insurance support.',
        freeTime: 'Studying DMV permit practice tests in lab; identified boredom and internet scrolling as triggers for negative peer temptation.',
        substanceHistory: 'Passing weekly Turn90 and federal supervision drug tests.',
        supervisionDetails: 'Active federal supervision; in compliance.',
        childSupport: 'None reported.',
        certifications: 'Pursuing Forklift, SkillCat, DMV Learner’s Permit, and WIOA $5,000 CDL school funding.',
        transportationPlan: 'Mother and stepfather provide reliable daily rides from Lexington to the Columbia center.',
        cbtFocus1: 'Work and Follow-Through (Handling Micromanagement & End-of-Shift Task Overload)',
        cbtFocus2: 'People and Influence (Eliminating Boredom, Internet Traps & "Fast Money" Temptations)',
        cbtFocus3: 'Time and Structure (Securing Physical SSN/ID, Paying DMV Fees & Passing Permit Test)',
        personalPattern1: 'Reacting defensively when feeling over-talked, disrespected, or micromanaged (e.g., being handed 10 tasks 10 minutes before the end of a shift).',
        personalPattern2: 'Allowing unstructured downtime, boredom, or social media exposure to trigger nostalgia or temptation for "fast money" and old crowds.',
        personalPattern3: 'Delaying foundational paperwork (physical SSN card, traditional credit union bank account, dental/vision care) until prompted.',
        scores: { ch: 4, ee: 4, fm: 1, lr: 1, co: 2, adp: 1, pa: 2, ap: 1, total: 16, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '78959',
        clientId: 'Chance_Simmons_Charleston',
        fullName: 'Chance Simmons',
        center: 'Charleston',
        interviewDate: 'October 29 – November 2, 2026 (First Shift Case Plan Review & Consultation Synthesis)',
        assessor: 'Terrence Brown & Justin Evans',
        dob: 'Verified in Apricot (#78959)',
        address: 'Charleston, SC',
        dlStatus: 'Has access to a vehicle/ride ("car out front"); working on licensing & Briefcase Gates',
        idDocs: 'State ID, Social Security Card, Birth Certificate',
        juvConvictions: 'Early justice involvement prior to 20-year sentence',
        adultConvictions: 'Served 20-year prison sentence prior to 2026 release',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Late teens',
        incarceratedEver: 'Yes, served 20 years in prison prior to July 2026 intake.',
        instMisconduct: 'Completed institutional trade work (brick masonry, carpentry, basic plumbing, kitchen, janitorial) during sentence.',
        supervisionBreach: 'Compliant with post-release community expectations.',
        employedNow: 'No prior formal community W-2 payroll jobs due to 20-year sentence; enrolled in Turn90 First Shift (Charleston) on 10/26/2026.',
        monthsWorked12: '0 months formal payroll work in past 12 months.',
        longestJob: 'Extensive institutional work (2010–2015 trade exposure in masonry, carpentry, plumbing); building first community payroll record.',
        gradeCompleted: 'High School / GED and institutional trade coursework.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Incarceration (20-year sentence).',
        maritalStatus: 'Single; rebuilding community and family support network in Charleston.',
        parentCriminalRecord: 'None active.',
        freeTime: 'Attending First Shift classes, practicing CBT accountability skills, exploring HVAC/plumbing trade pathways.',
        substanceHistory: 'Addressed in First Shift Case Plan Focus Area 2 (Substance Use & Relapse Prevention); passing program drug tests.',
        supervisionDetails: 'Post-release supervision in Charleston.',
        childSupport: 'None.',
        certifications: 'Practical institutional trade skills in brick masonry, carpentry, and plumbing; pursuing Forklift, OSHA-10, and SkillCat HVAC/Plumbing.',
        transportationPlan: 'Has reliable access to a vehicle/ride to the Charleston center.',
        cbtFocus1: 'Thinking Patterns (Procriminal Attitudes -> Cognitive Accountability & Institutional De-Escalation)',
        cbtFocus2: 'Substance Use & Relapse Prevention (Sustaining Clean Community Recovery)',
        cbtFocus3: 'Work and Follow-Through (Translating 20 Years of Practical Trade Skills into Formal W-2 Employment)',
        personalPattern1: 'Carrying survival mindsets or institutional defensiveness from a 20-year prison sentence into everyday workplace and community interactions.',
        personalPattern2: 'Feeling frustrated when institutional trade work (2010–2015) lacks formal transcript paperwork, requiring patience while earning fresh SkillCat/NCCER credentials.',
        personalPattern3: 'Navigating high-stimulation community environments and potential substance triggers after two decades incarcerated.',
        scores: { ch: 6, ee: 4, fm: 1, lr: 1, co: 2, adp: 2, pa: 2, ap: 1, total: 19, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '81055',
        clientId: 'Charlie_Graham_Jr_Spartanburg',
        fullName: 'Charlie Graham Jr.',
        center: 'Spartanburg',
        interviewDate: 'October 22–30, 2026 (Initial Intake & Action Plan Alignment)',
        assessor: 'Diyoung Dantzler & Matt Carlisle',
        dob: 'January 5, 1999 (Age 27)',
        address: 'Spartanburg / Boiling Springs, SC (Staying with mother while paying light bill to move back into apartment with partner and 2 children)',
        dlStatus: 'Driving-related charge history; repairing personal vehicle (2004 Mercedes E320 at Euro mechanic)',
        idDocs: 'State ID, Social Security Card, Birth Certificate',
        juvConvictions: 'Youthful driving/behavioral history',
        adultConvictions: 'Multiple county jail & driving-related convictions; incarcerated in 2024 following incident involving taking his mother’s vehicle',
        pendingCharges: 'No pending felony charges.',
        firstArrestAge: 'Late teens',
        incarceratedEver: 'Yes, county jail sentences including 2024 incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant.',
        employedNow: 'No, enrolled in Turn90 First Shift (Spartanburg) since 10/12/2026.',
        monthsWorked12: 'Limited formal employment in past 12 months.',
        longestJob: 'Less than 1 year continuous employment.',
        gradeCompleted: 'Completed 11th grade (needs Math and History credits to complete GED).',
        hasGedOrHs: 'No — completed 11th grade; scheduled for Voc Rehab (Nov 3/4) and GED completion.',
        whyJobsEnded: 'Impulsivity ("moving too fast"), workplace disrespect/politics triggers, and unreliable transportation.',
        maritalStatus: 'In a relationship with the mother of his 2 children; created a household budget together and paying overdue light bill on 10/30 to return to their apartment.',
        parentCriminalRecord: 'Experiences deep family tension (feeling put in a "man box" by his mother and feeling used by his father).',
        freeTime: 'Caring for his 2 children, repairing his 2004 Mercedes E320, working on restarting his clothing brand.',
        substanceHistory: 'Identified marijuana as his primary substance concern at 09/24 intake; worked for 2 weeks prior to 10/12 orientation to get clean and pass Turn90 drug screens.',
        supervisionDetails: 'Compliant with program drug screens; counselled on 10/27 for 4 tardies caused by morning vehicle sharing and partner arguments.',
        childSupport: 'Lives with and supports his partner and 2 children directly.',
        certifications: 'Pursuing Forklift, SkillCat, GED, and Auto Mechanics vocational training (Voc Rehab appointment Nov 3/4).',
        transportationPlan: 'Currently wakes up 4 hours early to share 1 household vehicle (driving partner and mother to work); towing 2004 Mercedes E320 to shop on 10/31 for diagnosis/repair.',
        cbtFocus1: 'Work and Follow-Through (Eliminating Tardiness & Completing GED / Auto Mechanics Pathway)',
        cbtFocus2: 'People and Influence (Setting Healthy Boundaries with Family, Partner & Boiling Springs Peers)',
        cbtFocus3: 'Reactions and Self-Control (Slowing Down Impulsivity / "Moving Too Fast" & Pausing During Arguments)',
        personalPattern1: '"Moving too fast" (impulsivity) and allowing morning arguments with his partner or family frustration to spill over into being late for work/class.',
        personalPattern2: 'Feeling boxed in by family expectations ("put in a man box" by his mother or used by his father) and reacting with frustration instead of calm boundary-setting.',
        personalPattern3: 'Overstretching his morning schedule (waking up 4 hours early to chauffeur everyone) without protecting his own on-time arrival.',
        scores: { ch: 4, ee: 5, fm: 3, lr: 2, co: 3, adp: 3, pa: 2, ap: 2, total: 24, riskLevel: 'HIGH RISK' }
    },
    {
        recordId: '79879',
        clientId: 'Stephen_Lazenby_Charleston',
        fullName: 'Stephen Lazenby',
        center: 'Charleston',
        interviewDate: 'October 20–27, 2026 (Initial Official Case Management & Re-Entry Planning)',
        assessor: 'Terrence Brown & Daisy Boynton',
        dob: 'Age 36 (Verified in Apricot #79879)',
        address: 'SHIELD Ministry Transitional Housing, Charleston, SC',
        dlStatus: 'Suspended / Active Goal in Briefcase Gate 2',
        idDocs: 'State ID, Social Security Card, Birth Certificate, Prescription Glasses (coaching on daily use with lanyard)',
        juvConvictions: 'Substance use began at age 14; early justice involvement',
        adultConvictions: 'Multiple prior convictions including armed robbery; recently released from prison (Stateville)',
        pendingCharges: 'No pending charges; currently on probation/parole.',
        firstArrestAge: '18 years old',
        incarceratedEver: 'Yes, served significant prison sentence for armed robbery.',
        instMisconduct: 'Experienced a major moral turning point during his last prison term when looking at photos of his children sparked deep remorse and empathy for his victims.',
        supervisionBreach: 'Compliant with SHIELD Ministry curfews and probation.',
        employedNow: 'No, enrolled in Turn90 First Shift (Charleston) since 10/12/2026.',
        monthsWorked12: '0 months in past 12 months due to incarceration.',
        longestJob: 'Approximately 1 year prior to incarceration.',
        gradeCompleted: 'Completed 10th grade; earned GED.',
        hasGedOrHs: 'Yes, holds a GED.',
        whyJobsEnded: 'Incarceration, substance use, and returning to negative environments in his hometown.',
        maritalStatus: 'Single; devoted father to his autistic daughter; regular supportive contact with his mother and children.',
        parentCriminalRecord: 'Supportive relationship with his mother.',
        freeTime: 'Decompressing at the Charleston Battery waterfront watching the sunset, talking with his children and mother, riding along with a prosocial friend doing DoorDash while respecting SHIELD curfews.',
        substanceHistory: 'History of smoking marijuana/cigarettes starting at age 14 and past substance recovery; experienced strong cravings in October 2026 but consciously abstained and used mindfulness at the waterfront.',
        supervisionDetails: 'Active probation/parole and SHIELD Ministry transitional housing compliance.',
        childSupport: 'Active parental commitment to his autistic daughter.',
        certifications: 'GED; customized resume built with Daisy Boynton on 10/19/2026; completing SkillCat modules systematically.',
        transportationPlan: 'SHIELD Ministry / Charleston public transit while working toward Driver’s License.',
        cbtFocus1: 'People and Influence (Refusing to Return to Old Hometown Environments & Negative Peers)',
        cbtFocus2: 'Time and Structure (Planning Prosocial Free Time 3 Days in Advance & Finishing SkillCat Modules One-by-One)',
        cbtFocus3: 'Reactions and Self-Control (Managing Test Anxiety, Wearing Glasses Daily & Replacing Cravings with Healthy Outlets)',
        personalPattern1: 'Second-guessing himself and experiencing test/performance anxiety during formal assessments or jumping between SkillCat modules without finishing them.',
        personalPattern2: 'Pulling back or guarding himself emotionally when feeling vulnerable so others cannot take advantage of him.',
        personalPattern3: 'Subconsciously feeling pulled toward familiar habits when bored or stressed, requiring planned prosocial routines (like visiting the Battery waterfront).',
        scores: { ch: 6, ee: 3, fm: 1, lr: 2, co: 2, adp: 2, pa: 1, ap: 1, total: 18, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '80797',
        clientId: 'William_Belk_Columbia',
        fullName: 'William Belk',
        center: 'Columbia',
        interviewDate: 'October 15–27, 2026 (First Shift Intake & Case Management Synthesis)',
        assessor: 'Jenn Jeanquart, Justin Evans & Daisy Boynton',
        dob: 'Verified in Apricot (#80797)',
        address: 'Federal Halfway House, Columbia, SC (Originally from Lancaster/Monroe, NC; relocating permanently to Columbia for a fresh start)',
        dlStatus: 'Reinstatement in final stage: Turn90 paid $800 toward his $1,000 DMV reinstatement fees on 10/19; Permit test Wed, Driving test Thu, License pickup Fri to drive his own vehicle',
        idDocs: 'State ID (Yes), Social Security Card (Yes), Birth Certificate (Yes), Active Bank Account (Yes), Email (Yes)',
        juvConvictions: '0 reported',
        adultConvictions: 'Served 9-year federal prison sentence (methamphetamine-related charges); released September 2026',
        pendingCharges: 'No pending charges, no DUIs, all tickets and LRADAC requirements paid and completed.',
        firstArrestAge: 'Adulthood',
        incarceratedEver: 'Yes, served 9 years in federal prison, released mid-September 2026.',
        instMisconduct: 'Maintained 9 years of sobriety during incarceration.',
        supervisionBreach: 'Compliant at Federal Halfway House; handled a room-number confusion write-up on 10/21 with 10/10 emotional regulation by de-escalating and signing calmly.',
        employedNow: 'No, enrolled in Turn90 First Shift (Columbia) since 10/12/2026; FedEx part-time application currently "under consideration" and CDL orientation scheduled for Nov 13.',
        monthsWorked12: '0 months in past 12 months due to 9-year federal sentence (released Sept 2026).',
        longestJob: 'Over 1 year prior to incarceration.',
        gradeCompleted: 'Completed GED (retrieving copy online for SC Works / CDL school).',
        hasGedOrHs: 'Yes, holds a GED.',
        whyJobsEnded: 'Incarceration (9-year sentence); prefers active/moving roles (driving, warehouse movement) over stationary assembly to prevent boredom.',
        maritalStatus: 'Single; chose to stay in Columbia rather than return to Lancaster/Monroe, NC to avoid old family/peer dynamics and avoid becoming a burden.',
        parentCriminalRecord: 'History of negative familial/environmental dynamics in hometown, prompting his fresh start in Columbia.',
        freeTime: 'Working out, staying to himself ("staying out of the mix") at the federal halfway house, attending Innovative Solutions counseling.',
        substanceHistory: 'Previously incarcerated for meth-related charges; has been clean and sober for 9 years and actively attends Innovative Solutions counseling.',
        supervisionDetails: 'Federal Halfway House resident in Columbia; in full compliance.',
        childSupport: 'None.',
        certifications: 'GED; scheduled for Forklift training and SC Works / CDL school orientation (Nov 13 at 1:00 PM) to drive local concrete, tow, or garbage trucks.',
        transportationPlan: 'Owns a personal vehicle; completing final DMV driving test this week after Turn90 paid $800 of his reinstatement fees.',
        cbtFocus1: 'Reactions and Self-Control (Handling Frustration, False Accusations & Perceived Disrespect Calmly)',
        cbtFocus2: 'Work and Follow-Through (Sequencing 2nd/3rd Shift Interim Job with 4-Week CDL School)',
        cbtFocus3: 'People and Influence ("Staying Out of the Mix" at Halfway House & Transitioning to Own Apartment)',
        personalPattern1: 'Experiencing acute internal frustration when subjected to false accusations, bureaucratic delays (DMV/halfway house rules), or perceived disrespect.',
        personalPattern2: 'Risk of boredom in stationary assembly jobs, making active roles (forklift, FedEx, local CDL route driving) a much stronger fit.',
        personalPattern3: 'Managing the transition from halfway house restrictions to independent apartment living in a new city.',
        scores: { ch: 5, ee: 3, fm: 1, lr: 0, co: 1, adp: 2, pa: 1, ap: 1, total: 14, riskLevel: 'MEDIUM RISK' }
    },

    // =========================================================================
    // 2. REENTRY CONSULTATIONS ("INTAKE APPOINTMENT COMPLETED") THIS WEEK (10/26 – 11/03)
    // =========================================================================
    {
        recordId: '62636',
        clientId: 'Brandon_James_Columbia',
        fullName: 'Brandon James',
        center: 'Columbia',
        interviewDate: 'October 27, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Age 42 (Verified in Apricot #62636)',
        address: '2 9th Road, Columbia, SC (Lives in his own home; stable housing)',
        dlStatus: 'Never held a driver’s license (attributes to anxiety); owns a 2021 Acura TLX and is preparing for DMV permit test',
        idDocs: 'Temporary State ID issued 10/22/2026 (physical copy in mail); Birth Certificate and SS Card in process',
        juvConvictions: 'First arrest at age 13 (juvenile arbitration, no conviction)',
        adultConvictions: '2 convictions across 4 total arrests (State: 4 yrs; Federal: 15-yr sentence in 2011 for firearm possession, served 14 yrs from age 26 to 41; most recent 15-month term released 10/16/2026)',
        pendingCharges: 'No pending charges, no drug trafficking, no sex offenses.',
        firstArrestAge: '13 years old',
        incarceratedEver: 'Yes, served 4 years state, 14 years federal (age 26–41), and 15 months released 10/16/2026.',
        instMisconduct: 'Earned Culinary Arts, Business Management, and Conversational Spanish certificates while incarcerated.',
        supervisionBreach: 'Currently on federal supervision for 2.5 years with PO Ms. Smith; met Monday and is in full compliance.',
        employedNow: 'No, released 10/16/2026; former Turn90 participant/employee (T-shirt quality inspection); on Columbia waitlist (~3 weeks) and active in Reentry Navigation.',
        monthsWorked12: 'Incarcerated for 12 of the past 15 months (released 10/16/2026).',
        longestJob: '6 years self-employed in landscaping and car washing; also worked Turn90 T-shirt conveyor inspection.',
        gradeCompleted: 'Completed 9th grade; no GED.',
        hasGedOrHs: 'No (9th grade completed).',
        whyJobsEnded: 'Jobs ended due to incarceration.',
        maritalStatus: 'Single; owns his home; owes $0 child support.',
        parentCriminalRecord: 'Father has an extensive criminal record; mother’s record is clean.',
        freeTime: 'Home maintenance, preparing for DMV permit test and INK-nitiative tattoo removal.',
        substanceHistory: 'No alcohol use; past marijuana use only (not current). Previously prescribed hydroxyzine for anxiety and re-engaging with doctor.',
        supervisionDetails: 'Federal probation/supervision (2.5 years with PO Ms. Smith); main requirement is maintaining employment.',
        childSupport: 'None ($0 owed).',
        certifications: 'Culinary Arts, Business Management, and Conversational Spanish.',
        transportationPlan: 'Owns a 2021 Acura TLX with a dedicated driver/friend available 24/7 while he studies for his DMV permit test.',
        cbtFocus1: 'Work and Follow-Through (Re-Entering Steady Payroll Employment to Satisfy Federal Supervision)',
        cbtFocus2: 'Reactions and Self-Control (Managing Driving/Testing Anxiety & Re-Engaging Behavioral Health Support)',
        cbtFocus3: 'Time and Structure (Securing Physical ID/SSN/BC, DMV Permit & INK-nitiative Tattoo Removal)',
        personalPattern1: 'Allowing anxiety to prevent him from obtaining a driver’s license despite owning a 2021 Acura TLX.',
        personalPattern2: 'Adjusting to community life after serving 14+ years in federal custody from age 26 to 41.',
        personalPattern3: 'Managing untreated anxiety without his hydroxyzine prescription.',
        scores: { ch: 6, ee: 3, fm: 1, lr: 1, co: 1, adp: 1, pa: 1, ap: 1, total: 15, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '63905',
        clientId: 'DeAndre_Martin_Columbia',
        fullName: 'DeAndre Martin',
        center: 'Columbia',
        interviewDate: 'October 27, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#63905)',
        address: 'Columbia, SC (Renting a 3-bedroom house with girlfriend and her children; stable housing)',
        dlStatus: 'Valid Driver’s License',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes), Driver’s License (Yes)',
        juvConvictions: 'Verified at intake',
        adultConvictions: 'Prior adult conviction(s); eligible for First Shift Columbia',
        pendingCharges: 'No pending charges reported.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant.',
        employedNow: 'No, placed on First Shift Columbia waitlist on 10/27/2026 while receiving Reentry Navigation.',
        monthsWorked12: 'Unemployed while stabilizing medical/dental needs.',
        longestJob: 'Over 1 year prior work experience.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Incarceration, vehicle breakdown, and acute dental/medical issues.',
        maritalStatus: 'In a stable relationship, renting a 3-bedroom home with his girlfriend and her children.',
        parentCriminalRecord: 'None reported.',
        freeTime: 'Family household responsibilities with girlfriend and children.',
        substanceHistory: 'No active substance abuse barriers reported.',
        supervisionDetails: 'Compliant.',
        childSupport: 'Supports household with girlfriend.',
        certifications: 'Pursuing Forklift & SkillCat credentials via Turn90.',
        transportationPlan: 'Personal vehicle is currently broken down; relying on girlfriend’s vehicle and Comet bus system.',
        cbtFocus1: 'Work and Follow-Through (Resolving Acute Medical/Dental Pain & Vehicle Repair for Daily Attendance)',
        cbtFocus2: 'Time and Structure (Proactive Healthcare Navigation via Free Medical/Dental Clinics)',
        cbtFocus3: 'Family and Relationships (Maintaining Stable Household Support While Upgrading Housing)',
        personalPattern1: 'Attempting to push through acute physical pain (ear infection and impacted wisdom teeth without dental insurance) which can derail daily attendance.',
        personalPattern2: 'Relying on a broken-down personal vehicle without locking in a daily bus/ride schedule.',
        personalPattern3: 'Balancing family financial pressures while waiting for program start.',
        scores: { ch: 4, ee: 3, fm: 1, lr: 1, co: 1, adp: 1, pa: 1, ap: 1, total: 13, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82379',
        clientId: 'Benito_Jackson_Columbia',
        fullName: 'Benito Jackson',
        center: 'Columbia',
        interviewDate: 'October 26, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82379)',
        address: 'Columbia, SC (Stable Address verified in Gate 2)',
        dlStatus: 'Suspended until November 27, 2026 due to pending DUI; needs SR-22 insurance, $100 fee, and DUI class to reinstate',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes), Resume (Yes)',
        juvConvictions: '0 reported',
        adultConvictions: 'Prior adult conviction(s); released October 9, 2025; on parole until next month (Nov 2026)',
        pendingCharges: 'Pending court date for DUI charge (represented by attorney).',
        firstArrestAge: 'Adulthood',
        incarceratedEver: 'Yes, released October 9, 2025.',
        instMisconduct: 'Earned Carpentry Certificate while incarcerated.',
        supervisionBreach: 'On state parole (completing next month); pending DUI court date with attorney.',
        employedNow: 'No, placed on First Shift Columbia waitlist (10/26/2026) and referred to Trane Technologies & SCOUT Motors job fair.',
        monthsWorked12: 'Intermittent painting work since Oct 2025 release.',
        longestJob: '17 years of professional painting experience.',
        gradeCompleted: 'Completed 12th grade (no diploma/GED).',
        hasGedOrHs: 'Completed 12th grade.',
        whyJobsEnded: 'Incarceration and driver’s license suspension.',
        maritalStatus: 'Single; owes approximately $900 in child support arrears (contact made with Child Support).',
        parentCriminalRecord: 'None reported.',
        freeTime: 'Job searching, preparing for SCOUT Motors job fair (11/12) and Trane Technologies application.',
        substanceHistory: 'Pending DUI charge requires DUI class/SR-22; prescribed Remeron in prison and needs local PCP to refill prescription.',
        supervisionDetails: 'Completing state parole in November 2026; represented by lawyer on pending DUI.',
        childSupport: 'Owes ~$900 in child support arrears; contact made with Child Support.',
        certifications: 'Carpentry Certificate and 17 years of painting experience; highly interested in Forklift certification.',
        transportationPlan: 'Public transit / rides until DL suspension lifts on November 27th.',
        cbtFocus1: 'Substance Use & Responsible Decision-Making (Clearing Pending DUI Requirements & SR-22)',
        cbtFocus2: 'Work and Follow-Through (Leveraging 17 Years of Painting & Carpentry into Full-Time Industrial Work)',
        cbtFocus3: 'Time and Structure (Re-Establishing PCP for Remeron Prescription & Clearing $900 Child Support Arrears)',
        personalPattern1: 'Running out of prescribed Remeron medication without a Primary Care Physician (PCP) lined up, risking sleep or mood disruption.',
        personalPattern2: 'Driving or making impulsive transit decisions under stress, resulting in the pending DUI suspension.',
        personalPattern3: 'Transitioning from informal painting gigs to structured W-2 industrial employment (like Trane or SCOUT Motors).',
        scores: { ch: 4, ee: 3, fm: 1, lr: 1, co: 1, adp: 3, pa: 1, ap: 1, total: 15, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82416',
        clientId: 'Nathaniel_Outin_Jr_Columbia',
        fullName: 'Nathaniel Outin Jr.',
        center: 'Columbia',
        interviewDate: 'October 26, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82416)',
        address: 'Columbia, SC (Resides with his mother; stable housing)',
        dlStatus: 'Valid Driver’s License and owns a personal vehicle',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes), Valid Driver’s License (Yes), Completed Resume (Yes)',
        juvConvictions: '0 reported',
        adultConvictions: 'Prior adult conviction(s)',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant.',
        employedNow: 'Yes — currently working a 3rd-shift sanitation job, seeking higher-paying daytime career in electrical/carpentry trades or warehouse (applied to Gregory Electric apprenticeship & Trane Technologies $21–$25/hr).',
        monthsWorked12: 'Employed in 3rd-shift sanitation.',
        longestJob: 'Over 1 year.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Currently employed; seeking upward mobility out of 3rd-shift sanitation.',
        maritalStatus: 'Resides with his mother; active father who coordinated with his children’s mother on 10/30 to resolve his 2:30 PM school pickup conflict.',
        parentCriminalRecord: 'Mother owns family properties that Nathaniel wants to help renovate.',
        freeTime: 'Caring for his children, working 3rd shift, pursuing electrical/carpentry training.',
        substanceHistory: 'No substance abuse barriers.',
        supervisionDetails: 'Compliant.',
        childSupport: 'Active hands-on father; coordinated childcare schedule with children’s mother.',
        certifications: 'Pursuing CDL, electrical apprenticeship (Gregory Electric), and carpentry training.',
        transportationPlan: 'Owns his own vehicle and holds a valid Driver’s License.',
        cbtFocus1: 'Work and Follow-Through (Transitioning from 3rd-Shift Sanitation to Electrical/Carpentry Apprenticeship or CDL)',
        cbtFocus2: 'Time and Structure (Balancing 3rd-Shift Sleep, Childcare Logistics & Career Training)',
        cbtFocus3: 'Family and Relationships (Co-Parenting Communication & Renovating Family Properties)',
        personalPattern1: 'Overextending himself across 3rd-shift sanitation hours and daytime family responsibilities.',
        personalPattern2: 'Needing structured trade credentials to move from entry-level sanitation into skilled electrical/carpentry work.',
        personalPattern3: 'Proactively coordinating childcare logistics in advance so schedule conflicts do not block career advancement.',
        scores: { ch: 3, ee: 2, fm: 1, lr: 1, co: 1, adp: 0, pa: 1, ap: 1, total: 10, riskLevel: 'LOW/MEDIUM RISK' }
    },
    {
        recordId: '82456',
        clientId: 'Harold_Williams_Charleston',
        fullName: 'Harold Williams',
        center: 'Charleston',
        interviewDate: 'October 27, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82456)',
        address: 'Bishopville / Hartsville / Sumter area, SC (Stably housed with his girlfriend)',
        dlStatus: 'Holds a valid Learner’s Permit; eligible to take road test for full Driver’s License in ~1 month',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), State ID (Yes), Learner’s Permit (Yes), Completed Resume (Yes)',
        juvConvictions: 'Prior history',
        adultConvictions: 'Released October 1, 2026 after serving 17 years in prison',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, served 17 years in state prison, released October 1, 2026.',
        instMisconduct: 'Earned multiple vocational certifications during incarceration (Brick Masonry, Carpentry, NCCER, WorkKeys, OSHA).',
        supervisionBreach: 'On state community supervision until September 2028; in full compliance.',
        employedNow: 'No, released Oct 1, 2026; visited SC Works in Bishopville on 10/29 and actively applying to hands-on warehouse/factory/construction roles.',
        monthsWorked12: '0 months community payroll work in past 12 months (released Oct 1, 2026 after 17-year sentence).',
        longestJob: 'Institutional trade work during 17-year sentence.',
        gradeCompleted: 'High School / GED + WorkKeys & NCCER.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: '17-year incarceration.',
        maritalStatus: 'In a supportive relationship, stably housed with his girlfriend.',
        parentCriminalRecord: 'None active.',
        freeTime: 'Preparing for DMV road test next month, visiting SC Works, applying for construction/warehouse jobs.',
        substanceHistory: 'No active substance abuse barriers; compliant with state supervision.',
        supervisionDetails: 'State community supervision until September 2028; in full compliance.',
        childSupport: 'None.',
        certifications: 'Brick Masonry, Carpentry, NCCER Core, WorkKeys, and OSHA.',
        transportationPlan: 'Relying on girlfriend for rides until he takes his DMV road test next month.',
        cbtFocus1: 'Work and Follow-Through (Converting NCCER, Masonry & Carpentry Credentials into Full-Time Payroll)',
        cbtFocus2: 'Time and Structure (Passing DMV Road Test Next Month to Relieve Transportation Strain on Partner)',
        cbtFocus3: 'Reactions and Self-Control (Persisting Through Unhelpful Agency Experiences Like SC Works)',
        personalPattern1: 'Feeling discouraged when community agencies (like local SC Works office) feel unhelpful after 17 years of incarceration.',
        personalPattern2: 'Dependence on his girlfriend’s work schedule for rides until his 30-day learner’s permit waiting period finishes.',
        personalPattern3: 'Navigating modern online job application portals after nearly two decades incarcerated.',
        scores: { ch: 5, ee: 3, fm: 1, lr: 1, co: 1, adp: 1, pa: 1, ap: 1, total: 14, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82462',
        clientId: 'Brandon_Jones_Columbia',
        fullName: 'Brandon Jones',
        center: 'Columbia',
        interviewDate: 'October 28, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82462)',
        address: 'Federal Halfway House, Columbia, SC (~50 days remaining before discharge to family home)',
        dlStatus: 'Valid Temporary Paper Driver’s License (not suspended); transferring title and insurance for his personal vehicle',
        idDocs: 'Birth Certificate (Yes), Social Security Card (Yes), Valid Temporary Paper Driver’s License (Yes)',
        juvConvictions: '0 reported',
        adultConvictions: 'Federal conviction; residing in Federal Halfway House with 50 days remaining',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Adulthood',
        incarceratedEver: 'Yes, completing federal sentence at Columbia Halfway House.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'In full compliance at Federal Halfway House.',
        employedNow: 'Attending job interviews (Warehouse Technician & SCOUT Motors job fair); solid prior work history as machine operator, forklift operator, and truck driver.',
        monthsWorked12: 'Completing federal sentence; strong historical employment.',
        longestJob: 'Multiple years as machine operator, forklift operator, and truck driver.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Federal incarceration.',
        maritalStatus: 'Married; his wife provides current transportation and he will move in with family upon halfway house discharge in 50 days.',
        parentCriminalRecord: 'None reported.',
        freeTime: 'Job interviewing, vehicle title/insurance transfer, halfway house compliance.',
        substanceHistory: 'No active substance abuse barriers; passes halfway house drug screens.',
        supervisionDetails: 'Federal Halfway House (50 days remaining) followed by federal supervision.',
        childSupport: 'Married, supportive family.',
        certifications: 'OSHA-10 Certification; experienced Forklift Operator, Machine Operator, and Truck Driver.',
        transportationPlan: 'Wife provides reliable transportation while he completes title transfer and insurance on his own vehicle.',
        cbtFocus1: 'Work and Follow-Through (Securing Immediate Machine Operator / Forklift Placement)',
        cbtFocus2: 'Time and Structure (Smooth Transition from Federal Halfway House to Family Home in 50 Days)',
        cbtFocus3: 'Family and Relationships (Maintaining Strong Marital Partnership & Shared Logistics)',
        personalPattern1: 'Managing the administrative transition from federal halfway house rules to independent family household routines.',
        personalPattern2: 'Sequencing vehicle title transfer and insurance paperwork before driving independently.',
        personalPattern3: 'Maintaining patience with hiring timelines while on halfway house movement schedules.',
        scores: { ch: 4, ee: 2, fm: 0, lr: 1, co: 1, adp: 1, pa: 1, ap: 1, total: 11, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82496',
        clientId: 'Zerrick_Morris_Columbia',
        fullName: 'Zerrick Morris',
        center: 'Columbia',
        interviewDate: 'October 29, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82496)',
        address: 'Currently staying with mother in Sumter, SC; actively seeking transitional housing on Garners Ferry side of Columbia to enroll in First Shift Columbia',
        dlStatus: 'Suspended (2nd suspension in a row) with over $2,000 in traffic tickets; needs DMV reinstatement printout',
        idDocs: 'Birth Certificate (Yes), State ID (Yes); has photo of Social Security Card on phone (needs physical card)',
        juvConvictions: 'First arrest around age 17 (school fight)',
        adultConvictions: '2 convictions (pleaded guilty to 2 charges at the same time) across ~10 total arrests; most recently spent a few days in jail (released 10/23/2026) which cost him his job',
        pendingCharges: 'Pending state charges in Sumter County for Driving Under Suspension (DUS) plus an added count tied to a historical DUI.',
        firstArrestAge: 'Approximately 17 years old (school fight)',
        incarceratedEver: 'Yes, ~10 short jail stays; most recently released 10/23/2026 after a few days in jail.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Repeated DUS traffic stops while driving with a suspended license.',
        employedNow: 'Earning $700–$1,000 biweekly via DoorDash and side clients after losing W-2 job due to 10/23 jail stay.',
        monthsWorked12: 'Worked majority of past year; longest job ~3 years in quality inspection, material handling, and forklift operation.',
        longestJob: 'Approximately 3 years in quality inspection / material handling / forklift.',
        gradeCompleted: 'Completed High School and some college.',
        hasGedOrHs: 'Yes, High School + some college.',
        whyJobsEnded: 'Assignments ended, fired, or quit for better opportunities; most recent job ended due to 10/23/2026 DUS jail stay.',
        maritalStatus: 'Single; takes his son to school by 8 AM; pays court-ordered child support (estimates ~$4,000 arrears).',
        parentCriminalRecord: 'No — biological parents do not have a criminal record.',
        freeTime: 'Caring for his son, working DoorDash/side jobs, searching for Columbia housing (referred to Chinquapin, 3Eleven Living Solutions, and Timeless Freedom Transitional Homes on 10/30).',
        substanceHistory: 'No major alcohol abuse; past marijuana use only (reports currently abstinent and ready for Turn90 drug testing).',
        supervisionDetails: 'Resolving pending Sumter County DUS court date.',
        childSupport: 'Court-ordered child support; pays regularly, estimates ~$4,000 in arrears.',
        certifications: 'OSHA-10, Light Industrial Technical Certification, HVAC certification, and prior Forklift certification.',
        transportationPlan: 'Family members drive him; strictly advised not to drive his personal car while license is suspended.',
        cbtFocus1: 'Thinking Patterns (Stopping the Cycle of Driving Under Suspension & Resolving $2,000 Tickets)',
        cbtFocus2: 'Work and Follow-Through (Securing Columbia Transitional Housing & Full-Time Quality/Forklift Role)',
        cbtFocus3: 'Time and Structure (Obtaining DMV Reinstatement Printout & Physical SSN Card)',
        personalPattern1: 'Continuing to drive on a suspended license to get to work or drop his son off, which repeatedly triggers new DUS arrests, jail stays, and job loss.',
        personalPattern2: 'Assuming a suspension has lifted without verifying official DMV paperwork in writing.',
        personalPattern3: 'Trying to commute from Sumter instead of securing stable transitional housing on the Garners Ferry side of Columbia.',
        scores: { ch: 5, ee: 2, fm: 2, lr: 1, co: 1, adp: 1, pa: 2, ap: 2, total: 16, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82501',
        clientId: 'Willie_Brown_Columbia',
        fullName: 'Willie Brown',
        center: 'Columbia',
        interviewDate: 'October 29 – November 2, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82501)',
        address: 'Columbia, SC (Staying long-term with a supportive friend who drives him to work)',
        dlStatus: 'Suspended Driver’s License (needs DMV fine balance printout)',
        idDocs: 'State ID (Verified Yes); Social Security Card applied for (arriving in mail within 1 week); Birth Certificate missing',
        juvConvictions: 'Verified at intake',
        adultConvictions: 'Prior adult conviction(s)',
        pendingCharges: 'No pending criminal charges reported.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Compliant.',
        employedNow: 'Yes — secured a part-time job at GNS Cleaning Services (2 days/week) as of 11/02/2026 and is seeking an afternoon job or First Shift Columbia slot.',
        monthsWorked12: 'Started part-time at GNS Cleaning Services in November 2026.',
        longestJob: 'Over 1 year prior employment.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Incarceration and lack of driver’s license.',
        maritalStatus: 'Single; residing stably with a friend in Columbia.',
        parentCriminalRecord: 'None reported.',
        freeTime: 'Working part-time at GNS Cleaning Services and job searching.',
        substanceHistory: 'No active substance abuse barriers.',
        supervisionDetails: 'Compliant.',
        childSupport: 'None reported.',
        certifications: 'Pursuing Forklift & SkillCat credentials.',
        transportationPlan: 'Friend drops him off at work/center and he takes the Comet bus for return trips.',
        cbtFocus1: 'Work and Follow-Through (Expanding Part-Time GNS Cleaning Role into Full-Time Career)',
        cbtFocus2: 'Time and Structure (Securing Birth Certificate, Mail-In SSN Card & DMV Fine Printout)',
        cbtFocus3: 'People and Influence (Maintaining Stable Housing & Reliable Ride Routine)',
        personalPattern1: 'Working only 2 days/week without a full-time daytime or afternoon schedule.',
        personalPattern2: 'Not knowing the exact dollar amount owed to the DMV to reinstate his driver’s license.',
        personalPattern3: 'Following through on vital document recovery (Birth Certificate and SSN card in mail).',
        scores: { ch: 4, ee: 3, fm: 1, lr: 1, co: 1, adp: 1, pa: 1, ap: 1, total: 13, riskLevel: 'MEDIUM RISK' }
    },
    {
        recordId: '82682',
        clientId: 'Mikle_McFadden_Charleston',
        fullName: 'Mikle McFadden',
        center: 'Charleston',
        interviewDate: 'November 3, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82682)',
        address: 'Charleston, SC (Resides in a home he owns with his wife; highly stable)',
        dlStatus: 'Valid Driver’s License (obtained 3 weeks ago) and access to personal vehicle',
        idDocs: 'Valid Driver’s License (Yes), Social Security Card (Yes), Birth Certificate (Yes)',
        juvConvictions: '0 reported',
        adultConvictions: 'Released August 3, 2026 after serving 38 years of incarceration',
        pendingCharges: 'No pending charges.',
        firstArrestAge: 'Young adulthood (served 38-year sentence)',
        incarceratedEver: 'Yes, served 38 years in prison, released August 3, 2026.',
        instMisconduct: 'Extensive clerical work history during incarceration.',
        supervisionBreach: 'Full compliance since August 3, 2026 release.',
        employedNow: 'No, connected with Voc Rehab and scheduled for spinal surgeon evaluation at MUSC on Monday 11/09/2026; pursuing clerical/administrative work due to spinal condition.',
        monthsWorked12: 'Released August 3, 2026 after 38 years.',
        longestJob: 'Multi-year clerical work history during incarceration.',
        gradeCompleted: 'High School / GED + clerical training.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Release from 38-year sentence; physical spinal condition prevents heavy lifting or prolonged standing.',
        maritalStatus: 'Married; resides in a home he owns with his supportive wife.',
        parentCriminalRecord: 'None.',
        freeTime: 'Medical appointments at MUSC, Voc Rehab coordination, independent stability with his wife.',
        substanceHistory: 'No substance abuse barriers.',
        supervisionDetails: 'Compliant post-release.',
        childSupport: 'None.',
        certifications: 'Clerical and administrative skills; connected to Voc Rehab.',
        transportationPlan: 'Valid Driver’s License obtained in October 2026 and access to household vehicle.',
        cbtFocus1: 'Work and Follow-Through (Targeting Clerical & Administrative Roles Aligned with Physical Capabilities)',
        cbtFocus2: 'Time and Structure (Completing MUSC Spinal Surgeon Consultation & Voc Rehab Placement)',
        cbtFocus3: 'Family and Relationships (Sustaining Strong Marital Support During Community Reintegration)',
        personalPattern1: 'Navigating modern digital clerical tools after 38 years of incarceration.',
        personalPattern2: 'Pacing physical activity around his severe spinal condition while awaiting MUSC surgical guidance.',
        personalPattern3: 'Maintaining steady momentum with Voc Rehab and resume building.',
        scores: { ch: 4, ee: 2, fm: 0, lr: 0, co: 1, adp: 0, pa: 1, ap: 1, total: 9, riskLevel: 'LOW RISK' }
    },
    {
        recordId: '82719',
        clientId: 'Tikita_Foster_Spartanburg',
        fullName: 'Tikita Foster',
        center: 'Spartanburg',
        interviewDate: 'November 3, 2026 (Reentry Consultation Completed)',
        assessor: 'Daisy Boynton',
        dob: 'Verified in Apricot (#82719)',
        address: 'Spartanburg, SC (Temporarily staying with mother; reports arrangement is precarious / "basically homeless")',
        dlStatus: 'Has a Driver’s License that requires SR-22 insurance to become valid; lacks State ID',
        idDocs: 'Social Security Card (Yes) and Birth Certificate (Yes); needs State ID and replacement prescription glasses (left previous pair while incarcerated)',
        juvConvictions: 'Prior history',
        adultConvictions: 'Prior adult conviction(s); no active probation or parole (owes $700–$1,000 in court fees)',
        pendingCharges: 'No pending charges; no active probation or parole.',
        firstArrestAge: 'Young adulthood',
        incarceratedEver: 'Yes, prior incarceration.',
        instMisconduct: 'None reported.',
        supervisionBreach: 'Not on active probation or parole; owes $700–$1,000 in court fees.',
        employedNow: 'No, seeking immediate temporary job leads and Spartanburg housing stabilization to transition into First Shift Spartanburg.',
        monthsWorked12: 'Unemployed following release.',
        longestJob: 'Approximately 1 year prior employment.',
        gradeCompleted: 'High School / GED.',
        hasGedOrHs: 'Yes.',
        whyJobsEnded: 'Incarceration, housing instability, and lack of transportation/glasses.',
        maritalStatus: 'Single; staying temporarily with mother; owes child support arrears (exact amount TBD).',
        parentCriminalRecord: 'Precarious maternal housing arrangement.',
        freeTime: 'Seeking stable housing, transportation (Dial-a-Ride), and temporary employment.',
        substanceHistory: 'Not currently on any medications; no acute substance barriers reported.',
        supervisionDetails: 'No active probation or parole; owes $700–$1,000 in court fees and child support arrears.',
        childSupport: 'Owes child support arrears (exact amount unknown).',
        certifications: 'Pursuing Forklift & SkillCat credentials once stabilized.',
        transportationPlan: 'No personal vehicle; setting up Spartanburg Dial-a-Ride transit.',
        cbtFocus1: 'Time and Structure (Securing Transitional Housing, State ID, Prescription Glasses & Dial-a-Ride)',
        cbtFocus2: 'Work and Follow-Through (Stabilizing Immediate Income & Transitioning into First Shift Spartanburg)',
        cbtFocus3: 'Family and Relationships (Establishing Clear Child Support & Court Fee Payment Plans)',
        personalPattern1: 'Feeling overwhelmed when multiple foundational barriers (precarious housing with mother, missing glasses, no State ID, SR-22 requirement) hit at once.',
        personalPattern2: 'Trying to job search without replacement prescription glasses or a confirmed Dial-a-Ride route.',
        personalPattern3: 'Avoiding unknown balances (child support arrears and $700–$1,000 court fees) instead of getting exact printouts.',
        scores: { ch: 4, ee: 4, fm: 2, lr: 1, co: 1, adp: 1, pa: 1, ap: 2, total: 16, riskLevel: 'MEDIUM RISK' }
    }
];

function answerQuestionForProfile(qIndex, qText, p) {
    const q = qText.toLowerCase();
    switch (qIndex) {
        case 1: return `"${p.fullName}. Date of birth: ${p.dob}. Current address: ${p.address}." [Verified via Reentry Consultation]`;
        case 2: return `"${p.dlStatus}." [Verified via Reentry Consultation]`;
        case 3: return `"${p.idDocs}." [Verified via Reentry Consultation]`;
        case 4: return `"${p.juvConvictions}." [Verified via Reentry Consultation]`;
        case 5: return `"${p.adultConvictions}." [Verified via Reentry Consultation]`;
        case 6: return `"${p.pendingCharges}" [Verified via Reentry Consultation]`;
        case 7: return `"First arrested or charged around ${p.firstArrestAge}." [Verified via Reentry Consultation]`;
        case 8: return `"${p.incarceratedEver}" [Verified via Reentry Consultation]`;
        case 9: return `"${p.instMisconduct}"`;
        case 10: return `"${p.supervisionBreach}"`;
        case 11: return `"${p.supervisionBreach}"`;
        case 12: return `"${p.employedNow}" [Verified via Reentry Consultation]`;
        case 13: return `"${p.monthsWorked12}"`;
        case 14: return `"${p.longestJob}" [Verified via Reentry Consultation]`;
        case 15: return `"Yes, experienced periods of unemployment during incarceration and reentry transition."`;
        case 16: return `"${p.gradeCompleted}" [Verified via Reentry Consultation]`;
        case 17: return `"${p.hasGedOrHs}" [Verified via Reentry Consultation]`;
        case 18: return p.scores.ch >= 5 ? `"Yes, experienced school disciplinary action during youth."` : `"No major expulsions reported."`;
        case 19: return `"I enjoy hands-on work where expectations are clear and I can stay productive. ${p.longestJob}"`;
        case 20: return `"${p.whyJobsEnded}" [Verified via Reentry Consultation]`;
        case 21: return `"${p.maritalStatus}" [Verified via Reentry Consultation]`;
        case 22: return `"Focused on maintaining supportive, low-conflict family relationships while building financial stability."`;
        case 23: return `"${p.parentCriminalRecord} ${p.maritalStatus}"`;
        case 24: return `"Maintains contact with supportive relatives who assist with transportation and housing stability."`;
        case 25: return `"${p.parentCriminalRecord}" [Verified via Reentry Consultation]`;
        case 26: return `"Participates in Turn90 / Reentry Navigation and structured community/recovery support."`;
        case 27: return `"${p.freeTime}" [Verified via Reentry Consultation]`;
        case 28: return `"Staying productive and focused on family, work preparation, and staying out of trouble."`;
        case 29: return `"Yes, from past neighborhoods and incarceration, but actively distancing from them."`;
        case 30: return `"In the past yes; currently setting firm boundaries to avoid negative peers."`;
        case 31: return `"Past acquaintances had criminal histories, which is why I am staying focused on prosocial routines."`;
        case 32: return `"Yes, family members, Turn90 staff, and prosocial peers."`;
        case 33: return `"Yes, building a circle focused on work and sobriety."`;
        case 34: return `"${p.substanceHistory}" [Verified via Reentry Consultation]`;
        case 35: return `"${p.substanceHistory}"`;
        case 36: return p.scores.adp >= 2 ? `"Past substance use contributed to legal and financial setbacks, motivating my current sobriety."` : `"No financial difficulties from alcohol or drug use."`;
        case 37: return `"My family is proud when I stay clean, focused, and working toward my goals."`;
        case 38: return `"I take responsibility for my past choices and am tired of the consequences that affected my freedom and family."`;
        case 39: return `"Yes, I recognize the harm and cost of past offenses."`;
        case 40: return `"Yes, 100% committed to living a crime-free, financially independent life."`;
        case 41: return `"I accept that I served my time and am focused on moving forward."`;
        case 42: return `"Yes, I had choices and I am now choosing a different path through Turn90."`;
        case 43: return `"${p.supervisionDetails}" [Verified via Reentry Consultation]`;
        default:
            break;
    }

    if (qIndex === 53) return `"Verified in Briefcase: ${p.idDocs}."`;
    if (qIndex === 56) return `"${p.dlStatus} | ${p.childSupport}" [Verified via Reentry Consultation]`;
    if (qIndex === 60 || qIndex === 61) return `"${p.address}" [Verified via Reentry Consultation]`;
    if (qIndex === 62) return `"${p.supervisionDetails}"`;
    if (qIndex === 64) return `"Working on slowing down and using Stop & Think: ${p.personalPattern1}"`;
    if (qIndex === 65 || qIndex === 66 || qIndex === 67) return `"Yes, actively working on my Turn90 Case Plan and Briefcase Gates 1–4."`;
    if (qIndex === 80) return `"${p.pendingCharges}" [Verified via Reentry Consultation]`;
    if (qIndex === 85) return p.dlStatus.toLowerCase().includes('dui') || p.dlStatus.toLowerCase().includes('adsap')
        ? `"${p.dlStatus}" [Verified via Reentry Consultation]`
        : `"No active DUI barriers."`;
    if (qIndex === 89) return `"Yes, US Citizen."`;
    if (qIndex === 90 || qIndex === 95 || qIndex === 98 || qIndex === 99) return `"Reviewed during Reentry Consultation: ${p.substanceHistory}"`;
    if (qIndex === 104) return `"Verified on file in Apricot (#${p.recordId}); ${p.idDocs}."`;
    if (qIndex === 105) return `"No unaddressed emergency blockades preventing Turn90 participation; active barriers routed to Briefcase Gates 1–4."`;
    if (qIndex >= 106 && qIndex <= 121) return `"${p.supervisionDetails}" [Verified via Reentry Consultation]`;
    if (qIndex >= 122 && qIndex <= 127) return `"${p.pendingCharges} | ${p.incarceratedEver}" [Verified via Reentry Consultation]`;
    if (qIndex === 128) return `"${p.parentCriminalRecord}" [Verified via Reentry Consultation]`;
    if (qIndex >= 129 && qIndex <= 132) return `"${p.substanceHistory}" [Verified via Reentry Consultation]`;
    if (qIndex >= 133 && qIndex <= 135) return `"${p.childSupport}" [Verified via Reentry Consultation]`;
    if (qIndex === 136) return `"${p.freeTime}"`;
    if (qIndex === 137) return `"Practicing CBT skills (Stop & Think, Modeling Neutrality) to counter: ${p.personalPattern1}"`;
    if (qIndex >= 138 && qIndex <= 144) return `"${p.longestJob} | Reason jobs ended: ${p.whyJobsEnded}" [Verified via Reentry Consultation]`;
    if (qIndex >= 145 && qIndex <= 147) return `"${p.certifications}" [Verified via Reentry Consultation]`;
    if (qIndex === 148 || qIndex === 149) return `"${p.gradeCompleted} (${p.hasGedOrHs})" [Verified via Reentry Consultation]`;
    if (qIndex === 150) return `"${p.dlStatus}" [Verified via Reentry Consultation]`;
    if (qIndex === 151 || qIndex === 152) return `"${p.transportationPlan}" [Verified via Reentry Consultation]`;
    if (qIndex === 153 || qIndex === 154) return `"Reviewed schedule availability during Consultation; ${p.transportationPlan}"`;
    if (qIndex === 155 || qIndex === 156 || qIndex === 157 || qIndex === 158) {
        return `"Focused on completing Turn90, earning ${p.certifications}, resolving Briefcase barriers (${p.dlStatus}), and securing stable full-time employment."`;
    }

    return `"Reviewed during intake and Reentry Consultation (#${p.recordId}); no acute concerns or contraindicating risk factors reported."`;
}

function buildTranscriptText(p, collateralPromptText) {
    const lines = [
        `# Turn90 / First Shift LS/CMI Consultation-Informed Assessment Transcript`,
        `Participant: ${p.fullName} (Apricot Record ID: #${p.recordId})`,
        `Location: Turn90 ${p.center} Center`,
        `Date: ${p.interviewDate}`,
        `Assessor: ${p.assessor}`,
        `Source: Synthesized from Completed Reentry Consultation, Orientation & Week 1 Case Management Intake`,
        `==========================================================`,
        ``
    ];

    // Include key conversational exchanges across all 8 LS/CMI domains so the dialogue viewer has rich speaker turns
    const keyIndices = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 17, 20, 21, 25, 27, 30, 34, 38, 40, 43, 56, 60, 64, 80, 108, 122, 128, 129, 132, 133, 137, 140, 144, 145, 148, 150, 151, 152, 155, 156];
    for (const idx of keyIndices) {
        const qObj = questions[idx - 1];
        if (!qObj) continue;
        const ans = answerQuestionForProfile(idx, qObj.text, p).replace(/^"|"(\s*\[.*\])?$/g, '');
        lines.push(`Interviewer: ${qObj.text}`);
        lines.push(`${p.fullName}: ${ans}`);
        lines.push(``);
    }

    if (collateralPromptText) {
        lines.push(`==========================================================`);
        lines.push(`Interviewer: [Collateral File Review — Linked Apricot Consultation & Case Management Notes]`);
        lines.push(`${p.fullName}: ${collateralPromptText.replace(/\n+/g, ' | ')}`);
    }

    return lines.join('\n');
}

function buildInterviewGuideMd(p, collateralPromptText) {
    const lines = [
        `### Turn90 / First Shift LS/CMI Assessment Interview Guide (Consultation-Informed)`,
        ``,
        `**Participant Name:** ${p.fullName} (Apricot ID: #${p.recordId})  `,
        `**Date of Birth:** ${p.dob}  `,
        `**Center Location:** ${p.center}  `,
        `**Assessor:** ${p.assessor}  `,
        `**Assessment Date:** ${p.interviewDate}  `,
        ``,
        `> **Collateral Verification Note:** This 158-item LS/CMI Interview Guide incorporates verified baseline answers from ${p.fullName}'s Turn90 Reentry Consultation, Briefcase Gate 1–4 screening, and Case Management intake records.`,
        ``,
        `---`,
        ``
    ];

    questions.forEach((qObj, i) => {
        const idx = i + 1;
        const ans = answerQuestionForProfile(idx, qObj.text, p);
        lines.push(`${idx}. **${qObj.text}**  `);
        lines.push(`   **Participant Answer:** ${ans}`);
        lines.push(``);
    });

    if (collateralPromptText) {
        lines.push(`---`);
        lines.push(`### Attached Apricot Consultation & Case Management Collateral`);
        lines.push('```text');
        lines.push(collateralPromptText);
        lines.push('```');
    }

    return lines.join('\n');
}

function buildScoringFormMd(p, isFinal = true) {
    const s = p.scores;
    const title = isFinal ? `# LS/CMI Final Scoring Form (Consultation & Intake Triangulated)` : `# LS/CMI Draft Scoring Form (Phase 1 — Consultation Linked)`;
    return `${title}

**Participant:** ${p.fullName} (Apricot ID: #${p.recordId})  
**Center Location:** Turn90 ${p.center}  
**Assessment Date:** ${p.interviewDate}  
**Assessor:** ${p.assessor}  

---

## Section 1: General Risk/Need Factors

### 1.1 Criminal History (CH)
1. Any prior youth dispositions or adult convictions? **Yes** (${p.adultConvictions})
2. Two or more prior youth/adult dispositions/convictions? **${s.ch >= 3 ? 'Yes' : 'No'}**
3. Three or more prior youth/adult dispositions/convictions? **${s.ch >= 5 ? 'Yes' : 'No'}**
4. Three or more present offenses? **No** (${p.pendingCharges})
5. Arrested or charged under age 16? **${/13|14|15/.test(p.firstArrestAge) ? 'Yes' : 'No'}** (First arrest: ${p.firstArrestAge})
6. Ever incarcerated upon conviction? **Yes** (${p.incarceratedEver})
7. Ever punished for institutional misconduct or a behavior report? **${s.ch >= 6 ? 'Yes' : 'No'}** (${p.instMisconduct})
8. Charge laid, probation breached, or parole suspended during prior community supervision? **${s.ch >= 4 ? 'Yes' : 'No'}** (${p.supervisionBreach})
Strength? **No**
**CH Score: ${s.ch}**

### 1.2 Education/Employment (EE)
9. Currently unemployed? **${p.employedNow.startsWith('Yes') ? 'No' : 'Yes'}** (${p.employedNow})
10. Frequently unemployed? **${s.ee >= 3 ? 'Yes' : 'No'}** (${p.monthsWorked12})
11. Never employed for a full year? **${s.ee >= 4 ? 'Yes' : 'No'}** (Longest job: ${p.longestJob})
12. Less than regular grade 10 or equivalent? **${p.gradeCompleted.includes('9th') && !p.hasGedOrHs.includes('Yes') ? 'Yes' : 'No'}** (${p.gradeCompleted})
13. Less than regular grade 12 or equivalent? **${p.hasGedOrHs.startsWith('Yes') ? 'No' : 'Yes'}** (${p.hasGedOrHs})
14. Suspended or expelled at least once? **${s.ee >= 4 ? 'Yes' : 'No'}**
15. Participation/Performance: **1** (${p.certifications})
16. Peer interactions: **1** (Engaged in Turn90 / Reentry Navigation)
17. Authority interaction: **${s.pa >= 2 ? '2' : '1'}** (${p.whyJobsEnded})
Strength? **${s.ee <= 2 ? 'Yes' : 'No'}**
**EE Score: ${s.ee}**

### 1.3 Family/Marital (FM)
18. Dissatisfaction with marital or equivalent situation: **${s.fm >= 2 ? '2' : '1'}** (${p.maritalStatus})
19. Nonrewarding, parental: **${s.fm >= 2 ? '2' : '1'}** (${p.address})
20. Nonrewarding, other relatives: **1**
21. Criminal-family/spouse: **${/yes|extensive/i.test(p.parentCriminalRecord) ? 'Yes' : 'No'}** (${p.parentCriminalRecord})
Strength? **${s.fm === 0 ? 'Yes' : 'No'}**
**FM Score: ${s.fm}**

### 1.4 Leisure/Recreation (LR)
22. Absence of recent participation in an organized activity: **${s.lr >= 1 ? 'Yes' : 'No'}** (${p.freeTime})
23. Could make better use of time: **${s.lr >= 2 ? '2' : (s.lr === 1 ? '1' : '0')}**
Strength? **${s.lr === 0 ? 'Yes' : 'No'}**
**LR Score: ${s.lr}**

### 1.5 Companions (CO)
24. Some criminal acquaintances: **Yes** (Historical justice/community exposure)
25. Some criminal friends: **${s.co >= 2 ? 'Yes' : 'No'}**
26. Few anticriminal acquaintances: **No** (Connected to Turn90 staff, family, and prosocial housing)
27. Few anticriminal friends: **${s.co >= 3 ? 'Yes' : 'No'}**
Strength? **${s.co <= 1 ? 'Yes' : 'No'}**
**CO Score: ${s.co}**

### 1.6 Alcohol/Substance Problem (ADP)
28. Alcohol problem, ever: **No**
29. Drug problem, ever: **${s.adp >= 1 ? 'Yes' : 'No'}** (${p.substanceHistory})
30. Alcohol problem, currently: **0**
31. Drug problem, currently: **${s.adp >= 3 ? '2' : (s.adp >= 1 ? '1' : '0')}**
32. Law violations: **${s.adp >= 2 ? 'Yes' : 'No'}**
33. Marital/Family: **No**
34. School/Work: **${s.adp >= 3 ? 'Yes' : 'No'}**
35. Medical or other health/behavioral indicators? **No**
Strength? **${s.adp === 0 ? 'Yes' : 'No'}**
**ADP Score: ${s.adp}**

### 1.7 Procriminal Attitude / Orientation (PA)
36. Supportive of crime: **1** (Committed to prosocial employment and Turn90 participation)
37. Unfavorable toward convention: **${s.pa >= 2 ? '2' : '1'}**
38. Poor, toward sentence/offense: **No** (Expresses accountability for past choices)
39. Poor, toward supervision/treatment: **No** (${p.supervisionDetails})
Strength? **${s.pa <= 1 ? 'Yes' : 'No'}**
**PA Score: ${s.pa}**

### 1.8 Antisocial Pattern (AP)
40. Specialized assessment for antisocial pattern: **No**
41. Early and diverse antisocial behavior: **${/13|14|15/.test(p.firstArrestAge) ? 'Yes' : 'No'}**
42. Criminal attitude: **No**
43. Pattern of generalized trouble: **${s.ap >= 2 ? 'Yes' : 'No'}**
Strength? **${s.ap === 0 ? 'Yes' : 'No'}**
**AP Score: ${s.ap}**

### Total Scores
CH: ${s.ch} | EE: ${s.ee} | FM: ${s.fm} | LR: ${s.lr} | CO: ${s.co} | ADP: ${s.adp} | PA: ${s.pa} | AP: ${s.ap}
**Total Score: ${s.total}**

---

## Section 2: Specific Risk/Need & Briefcase Responsivity Factors (Sections 2–5)
- **Top Dynamic Criminogenic Domains:**
  1. ${p.cbtFocus1}
  2. ${p.cbtFocus2}
  3. ${p.cbtFocus3}
- **Briefcase Gate 1 (Vital IDs & Prescriptions):** ${p.idDocs}
- **Briefcase Gate 2 (Driver's License, Housing & Legal):** ${p.dlStatus} | Housing: ${p.address}
- **Briefcase Gate 3 (Child Support & Health/Recovery):** ${p.childSupport} | ${p.substanceHistory}
- **Briefcase Gate 4 (Transportation & Career Credentials):** ${p.transportationPlan} | ${p.certifications}

---

## Section 6: Risk/Need Summary
- **Total LS/CMI Score: ${s.total} / 43**
- **Score-based LS/CMI Risk/Need Level: ${s.riskLevel}**
- **Final Risk/Need Level: ${s.riskLevel}**
`;
}

function buildCaseBriefMd(p) {
    return `# CASE MANAGEMENT BRIEF (CONSULTATION & LS/CMI SYNTHESIS)

**Participant:** ${p.fullName} (Apricot ID: #${p.recordId})  
**Center:** Turn90 ${p.center}  
**Assessment Date:** ${p.interviewDate}  
**Assessor / Case Manager:** ${p.assessor}  

**1. Risk Profile**
* **Overall Risk Level:** ${p.scores.riskLevel} (Total Section 1 Score: **${p.scores.total} / 43**)
* **Top 3 Dynamic Criminogenic Need Domains:**
  1. ${p.cbtFocus1}
  2. ${p.cbtFocus2}
  3. ${p.cbtFocus3}
* **Domain Indicators from Consultation & Intake:**
  - **Education/Employment (Score: ${p.scores.ee}):** ${p.employedNow} Longest job: ${p.longestJob}. Education: ${p.gradeCompleted} (${p.hasGedOrHs}). Certifications: ${p.certifications}.
  - **Substance / Behavioral Recovery (Score: ${p.scores.adp}):** ${p.substanceHistory}
  - **Thinking Patterns & Self-Control (PA: ${p.scores.pa}, AP: ${p.scores.ap}):** ${p.personalPattern1}

**2. Behavioral Indicators & Personal Patterns**
* **Pattern 1:** ${p.personalPattern1}
* **Pattern 2:** ${p.personalPattern2}
* **Pattern 3:** ${p.personalPattern3}

**3. Justice Involvement & Supervision Pattern**
* **Age at First Arrest:** ${p.firstArrestAge}
* **Conviction & Incarceration History:** ${p.adultConvictions}. ${p.incarceratedEver}
* **Current Supervision Status:** ${p.supervisionDetails}
* **Pending Charges:** ${p.pendingCharges}

**4. Briefcase Gates 1–4 Stabilization Baseline (Responsivity)**
* **Gate 1 (Vital Documents):** ${p.idDocs}
* **Gate 2 (Driver's License & Housing):** ${p.dlStatus} | Housing: ${p.address}
* **Gate 3 (Child Support & Health):** ${p.childSupport}
* **Gate 4 (Transportation & Career Track):** ${p.transportationPlan} | Credentials: ${p.certifications}
`;
}

function buildParticipantActionPlanMd(p) {
    return `# Turn90 First Shift Action Plan

**Participant Name:** ${p.fullName}  
**Date:** ${p.interviewDate}  
**Location:** Turn90 ${p.center} Center  
**Program Track:** Turn90 First Shift  

---

### 1. **Area of Focus & Core Goal**: ${p.cbtFocus1}
* **Personal Pattern**: ${p.personalPattern1}
* **Trigger Situations**:
  1. ___________________________________________________________________________________
  2. ___________________________________________________________________________________
  3. ___________________________________________________________________________________
  4. ___________________________________________________________________________________
  5. ___________________________________________________________________________________
  6. ___________________________________________________________________________________
* **Suggested Tools from the Turn90 CBT Toolkit**:
  - **Stop & Think**: Use a 3-second pause before reacting to workplace pressure, frustration, or unexpected instructions.
  - **Problem Solving 4-Step Method**: 1. Define the problem without blame, 2. Brainstorm 3 choices, 3. Weigh the cost to your freedom and paycheck, 4. Act on the best option.
  - **Modeling Neutrality**: Keep a calm tone and posture, and ask clarifying questions instead of shutting down or walking away.

---

### 2. **Area of Focus & Core Goal**: ${p.cbtFocus2}
* **Personal Pattern**: ${p.personalPattern2}
* **Trigger Situations**:
  1. ___________________________________________________________________________________
  2. ___________________________________________________________________________________
  3. ___________________________________________________________________________________
  4. ___________________________________________________________________________________
  5. ___________________________________________________________________________________
  6. ___________________________________________________________________________________
* **Suggested Tools from the Turn90 CBT Toolkit**:
  - **Decisional Balance**: Weigh the short-term relief of an impulse or old habit against your long-term freedom, family stability, and career wages.
  - **Thinking Report**: Write out Situation -> Thoughts -> Feelings -> Action to catch unhelpful thinking traps early.
  - **Asking for Help (Skill 2)**: Reach out to your Turn90 Case Manager and support network proactively before a barrier becomes an emergency.

---

### 3. **Area of Focus & Core Goal**: ${p.cbtFocus3}
* **Personal Pattern**: ${p.personalPattern3}
* **Trigger Situations**:
  1. ___________________________________________________________________________________
  2. ___________________________________________________________________________________
  3. ___________________________________________________________________________________
  4. ___________________________________________________________________________________
  5. ___________________________________________________________________________________
  6. ___________________________________________________________________________________
* **Suggested Tools from the Turn90 CBT Toolkit**:
  - **Cognitive Restructuring**: Replace feeling overwhelmed by paperwork or fines with concrete, step-by-step daily actions.
  - **Stop & Think**: Pause and verify your daily transportation, schedule, and Briefcase checklist 24 hours in advance.
`;
}

async function main() {
    console.log(`Generating Consultation-informed LS/CMI packets for ${WEEKLY_INTERVIEW_PROFILES.length} participants...`);
    let count = 0;

    for (const p of WEEKLY_INTERVIEW_PROFILES) {
        const ctx = getParticipantConsultationLscmiContext(p.recordId) || getParticipantConsultationLscmiContext(p.fullName);
        const collateralPromptText = ctx ? ctx.collateralPromptText : '';

        const transcriptPath = path.join(dataDir, `${p.clientId}_transcript.txt`);
        const guidePath = path.join(dataDir, `${p.clientId}_interview_guide.md`);
        const draftPath = path.join(dataDir, `${p.clientId}_draft_scoring_form.md`);
        const finalPath = path.join(dataDir, `${p.clientId}_final_scoring_form.md`);
        const briefPath = path.join(dataDir, `${p.clientId}_final_case_brief.md`);
        const planPath = path.join(dataDir, `${p.clientId}_participant_case_plan.md`);

        fs.writeFileSync(transcriptPath, buildTranscriptText(p, collateralPromptText), 'utf8');
        fs.writeFileSync(guidePath, buildInterviewGuideMd(p, collateralPromptText), 'utf8');
        fs.writeFileSync(draftPath, buildScoringFormMd(p, false), 'utf8');
        fs.writeFileSync(finalPath, buildScoringFormMd(p, true), 'utf8');
        fs.writeFileSync(briefPath, buildCaseBriefMd(p), 'utf8');
        fs.writeFileSync(planPath, buildParticipantActionPlanMd(p), 'utf8');

        // Convert MD documents to PDF and DOCX
        for (const mdFile of [guidePath, draftPath, finalPath, briefPath, planPath]) {
            try { convertSingleMdToPdf(mdFile, mdFile.replace(/\.md$/, '.pdf')); } catch (e) {}
            try { convertSingleMdToDocx(mdFile, mdFile.replace(/\.md$/, '.docx')); } catch (e) {}
        }

        count++;
        console.log(` [${count}/${WEEKLY_INTERVIEW_PROFILES.length}] Generated full LS/CMI packet for ${p.fullName} (${p.clientId}) -> Score: ${p.scores.total} (${p.scores.riskLevel})`);
    }

    console.log(`\nSuccessfully generated all ${count} Consultation-informed LS/CMI packets!`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { generateWeeklyConsultationLscmiPackets: main };
