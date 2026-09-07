// Training, CBT, T90 Trades Tracks, and Re-entry Resources database module

const cbtModules = [
  {
    number: 1,
    id: "module-1-cognitive-triangle",
    title: "Module 1: Thoughts, Feelings & Actions (The Cognitive Triangle)",
    badge: "Cognitive Awareness",
    description: "Understand the core foundation of CBT: how external situations trigger automatic thoughts, generating physical feelings, and driving your immediate actions.",
    keyTakeaway: "You cannot always control the situation, but by catching your automatic thoughts, you take 100% control of your actions and consequences.",
    overview: "Cognitive Behavioral Training (CBT) is based on the proven principle that thoughts, feelings, and behaviors are constantly influencing each other. In high-risk environments, an automatic negative thought (e.g. 'He is disrespecting me') triggers instant physical anger (clenched fists, rapid pulse), resulting in impulsive violence or defiance. By learning to recognize the Cognitive Triangle, you create a space between the trigger and your reaction.",
    lessons: [
      {
        title: "Lesson 1: The Three Corners of the Triangle",
        content: "1. Thoughts: What you tell yourself inside your head. Thoughts can be truthful, exaggerated, or completely distorted.\n2. Feelings: Emotional and physical body states (anger, fear, anxiety, adrenaline, humiliation).\n3. Actions: The outward behaviors, words, and choices you make that have real-world consequences."
      },
      {
        title: "Lesson 2: Automatic Thoughts vs. Deliberate Choices",
        content: "Automatic thoughts happen in milliseconds without conscious decision. Left unchecked, they feel like facts. Learning to 'catch' the thought before taking action is the single most important skill for staying employed and off probation/parole supervision."
      }
    ],
    tool: {
      key: "cognitive_triangle",
      name: "Situation Breakdown Worksheet",
      description: "Break down a recent stressful event using the Cognitive Triangle to identify where you can change the outcome.",
      fields: [
        { id: "situation", label: "1. Situation / Trigger Event", type: "textarea", placeholder: "Describe what happened objectively (e.g., My supervisor told me I had to redo a pallet in front of other workers)." },
        { id: "automatic_thought", label: "2. Automatic Negative Thought (ANT)", type: "textarea", placeholder: "What immediately flashed through your mind? (e.g., 'He is trying to make me look weak in front of everyone.')" },
        { id: "feelings", label: "3. Feelings & Body Sensations", type: "text", placeholder: "What emotions and physical sensations occurred? (e.g., Anger, heat in chest, clenched jaw)" },
        { id: "reaction_old", label: "4. Past / Impulsive Reaction", type: "textarea", placeholder: "What would your old habit or reaction have been? (e.g., Cursing, walking off the job, arguing)" },
        { id: "replacement_thought", label: "5. Rational Replacement Thought", type: "textarea", placeholder: "What is a truthful, calm thought you can replace it with? (e.g., 'He just wants the pallet done right according to specs. It's not personal.')" },
        { id: "new_action", label: "6. New Prosocial Action", type: "textarea", placeholder: "What choice keeps your job, income, and freedom secure? (e.g., Say 'Yes sir, I'll fix it now' and finish the shift professionally.)" }
      ]
    }
  },
  {
    number: 2,
    id: "module-2-thinking-traps",
    title: "Module 2: Identifying Automatic Thoughts & Cognitive Distortions",
    badge: "Thinking Traps",
    description: "Identify the 5 common thinking traps that distort reality, trigger unnecessary conflict, and sabotage employment.",
    keyTakeaway: "A distorted thought is not a fact. When you challenge thinking traps with evidence, anger loses its power.",
    overview: "Cognitive distortions are biased ways of thinking that our brains use when stressed. In justice-involved individuals, these traps often develop as defense mechanisms during incarceration or street life, but they destroy relationships and employment in the civilian workplace.",
    lessons: [
      {
        title: "Lesson 1: The 5 Big Thinking Traps",
        content: "• All-or-Nothing Thinking: Seeing things only in black or white. 'If I'm not running things, I'm getting played.'\n• Catastrophizing: Blowing setbacks out of proportion. 'I was 5 minutes late, my whole career is over, so I might as well quit.'\n• Mind-Reading: Assuming you know what others think without proof. 'He looked at me funny, he thinks I'm stupid.'\n• Blaming / Victim Stance: Refusing accountability. 'They made me do it, it's not my fault.'\n• Fortune-Telling: Predicting failure in advance. 'No company is ever gonna hire a felon like me.'"
      },
      {
        title: "Lesson 2: The Three Evidence Questions",
        content: "When you notice a negative thought, challenge it with three questions:\n1. Is this 100% true, or am I guessing?\n2. What is the actual factual evidence on both sides?\n3. What would I tell a friend in this exact situation?"
      }
    ],
    tool: {
      key: "thinking_traps",
      name: "Cognitive Reframing Tool",
      description: "Select a thinking trap you recently experienced and reframe it with grounded evidence.",
      fields: [
        { id: "trap_type", label: "1. Select the Thinking Trap", type: "select", options: ["All-or-Nothing Thinking", "Catastrophizing", "Mind-Reading", "Blaming / Externalizing", "Fortune-Telling / Hopelessness"] },
        { id: "distorted_thought", label: "2. Your Distorted Thought", type: "textarea", placeholder: "Write the negative thought you caught yourself having..." },
        { id: "evidence_against", label: "3. Evidence Against This Thought", type: "textarea", placeholder: "What facts prove this thought is exaggerated or untrue?" },
        { id: "balanced_reframe", label: "4. Grounded, Balanced Reframe", type: "textarea", placeholder: "Write a truthful, productive replacement thought..." }
      ]
    }
  },
  {
    number: 3,
    id: "module-3-emotional-regulation",
    title: "Module 3: Emotional Regulation & Anger Management",
    badge: "Emotional Control",
    description: "Master physical body awareness, warning signals, and the Turn90 5-Second De-escalation Protocol.",
    keyTakeaway: "Anger always gives physical warnings first. Catching your body's alarm system gives you time to choose peace over prison.",
    overview: "Anger is a normal human emotion, but aggressive behavior is a choice. You cannot stop feelings from arising, but you can train your nervous system to cool down before your words or fists destroy your future.",
    lessons: [
      {
        title: "Lesson 1: The Physical Warning System",
        content: "Before your mind loses control, your body gives early warning signals:\n• Blood rushes to the face / feeling flushed\n• Clenched fists or teeth grinding\n• Shallow breathing and rapid heart rate\n• Tunnel vision and adrenaline spike\nRecognizing these signals at Level 2 or 3 allows you to step away before reaching Level 10 explosive anger."
      },
      {
        title: "Lesson 2: The Turn90 5-Second De-escalation Protocol",
        content: "1. Step Back: Move one physical step backward from the confrontation.\n2. Deep Breath: 4 seconds in through the nose, 4 seconds out through the mouth.\n3. Drop Shoulders: Intentionally release muscle tension in hands and neck.\n4. Self-Talk Anchor: Repeat your internal anchor phrase ('Keep cool, protect the money').\n5. Strategic Pause: Ask for 60 seconds to get a cup of water or step to the restroom."
      }
    ],
    tool: {
      key: "emotional_regulation",
      name: "Anger Profile & De-escalation Commitment",
      description: "Identify your specific anger triggers and set your personal de-escalation anchor.",
      fields: [
        { id: "physical_cues", label: "1. My Earliest Physical Anger Signals (List all that apply)", type: "textarea", placeholder: "e.g., Heart pounding, clenching fists, feeling hot in the face, tightening in the gut" },
        { id: "primary_triggers", label: "2. My Primary Workplace Triggers", type: "textarea", placeholder: "e.g., People talking down to me, co-workers being lazy while I work, being accused of something I didn't do" },
        { id: "anchor_phrase", label: "3. My Personal De-escalation Anchor Phrase", type: "text", placeholder: "e.g., 'Nothing out here is worth going back inside', 'Cool head, full pockets'" },
        { id: "cool_down_action", label: "4. My Committed Cool-Down Action", type: "textarea", placeholder: "What will you physically do when your anger hits Level 4? (e.g., Ask supervisor for 2 minutes to get water, breathe deeply, call my Turn90 case manager)" }
      ]
    }
  },
  {
    number: 4,
    id: "module-4-sodas-dmt",
    title: "Module 4: Decision Making Tool (DMT) & SODAS Problem-Solving",
    badge: "Problem Solving",
    description: "The core Turn90 5-step SODAS method to evaluate high-stakes problems and choose solutions that protect long-term freedom.",
    keyTakeaway: "SODAS turns overwhelming crises into clear, logical options so you never make permanent mistakes on temporary feelings.",
    overview: "In chaotic moments, we often react to the first impulse that comes to mind. Turn90's Decision Making Tool (DMT) and SODAS framework force you to brainstorm three distinct paths, analyze the real disadvantages and advantages of each, and commit to the smartest resolution.",
    lessons: [
      {
        title: "Lesson 1: The SODAS Framework",
        content: "• S = Situation: Define the problem objectively without emotion or drama.\n• O = Options: Brainstorm at least 3 realistic ways to respond.\n• D = Disadvantages: What are the negative consequences, costs, and risks of each option?\n• A = Advantages: What are the benefits and positive outcomes of each option?\n• S = Solution: Select the option with the highest long-term payoff and lowest risk."
      },
      {
        title: "Lesson 2: The DMT Impulse vs. Consequence Test",
        content: "Ask yourself: 'Will this choice matter in 5 minutes, 5 days, or 5 years?' Fast gratification (getting the last word, walking off a shift) usually leads to long-term devastation (job loss, violation, eviction)."
      }
    ],
    tool: {
      key: "sodas_dmt",
      name: "SODAS Decision Making Tool (DMT) Worksheet",
      description: "Apply the full 5-step SODAS framework to resolve a real-life dilemma or challenge.",
      fields: [
        { id: "s_situation", label: "S - Situation (What is the exact problem?)", type: "textarea", placeholder: "Define the problem clearly (e.g., My ride to work cancelled tomorrow morning and bus doesn't run early enough)." },
        { id: "o_option_1", label: "Option 1 (Impulsive / Default Choice)", type: "text", placeholder: "e.g., Don't show up and don't call anyone" },
        { id: "d_disadvantages_1", label: "Disadvantages of Option 1", type: "textarea", placeholder: "e.g., NCNS points deduction, risk of termination from First Shift, supervisor loses trust" },
        { id: "a_advantages_1", label: "Advantages of Option 1", type: "textarea", placeholder: "e.g., Sleep in, avoid asking for help" },
        { id: "o_option_2", label: "Option 2 (Alternative Choice)", type: "text", placeholder: "e.g., Pay for an expensive Uber/rideshare" },
        { id: "d_disadvantages_2", label: "Disadvantages of Option 2", type: "textarea", placeholder: "e.g., Costs $35 out of my weekly stipend" },
        { id: "a_advantages_2", label: "Advantages of Option 2", type: "textarea", placeholder: "e.g., Arrive on time, maintain perfect attendance, keep job secure" },
        { id: "o_option_3", label: "Option 3 (Proactive Resource Choice)", type: "text", placeholder: "e.g., Call Turn90 case manager tonight and ask fellow cohort member for a ride" },
        { id: "d_disadvantages_3", label: "Disadvantages of Option 3", type: "textarea", placeholder: "e.g., Have to wake up 30 minutes earlier, chip in $5 gas money" },
        { id: "a_advantages_3", label: "Advantages of Option 3", type: "textarea", placeholder: "e.g., Affordable, builds accountability with team, on-time arrival" },
        { id: "s_solution", label: "S - Solution (Which option do you commit to and what is Step 1?)", type: "textarea", placeholder: "I choose Option 3. Step 1: Text case manager right now and message peer before 8:00 PM." }
      ]
    }
  },
  {
    number: 5,
    id: "module-5-stac-communication",
    title: "Module 5: STAC & Workplace Conflict Communication",
    badge: "Communication",
    description: "Learn assertive communication and the STAC (Stop, Think, Act, Check) protocol for handling workplace conflict.",
    keyTakeaway: "Assertive communication gets your point across firmly and respectfully without threatening or backing down.",
    overview: "In commercial workplaces, conflict is inevitable. How you handle conflict determines whether you get promoted or fired. The four communication styles are Passive (saying nothing and stewing), Aggressive (yelling, threatening, disrespect), Passive-Aggressive (gossiping, sabotaging), and Assertive (direct, respectful, calm).",
    lessons: [
      {
        title: "Lesson 1: The STAC Action Model",
        content: "• S = Stop: Pause. Do not react with your tongue or fists.\n• T = Think: What are the consequences of my reaction? What is my professional goal?\n• A = Act: Deliver an assertive 'I' statement calmly and professionally.\n• C = Check: Evaluate if the message was heard and if your job remains secure."
      },
      {
        title: "Lesson 2: The Formula for Assertive 'I' Statements",
        content: "'I feel [emotion] when [factual situation happens] because [concrete reason]. I need [specific action going forward].'\nExample: 'I feel frustrated when tasks are reassigned without notice because it sets my timeline back. Going forward, let's sync up at morning huddle so we stay aligned.'"
      }
    ],
    tool: {
      key: "stac_communication",
      name: "STAC Workplace Conflict Worksheet",
      description: "Practice applying the STAC model to an actual workplace scenario.",
      fields: [
        { id: "scenario", label: "1. Describe the Workplace Disagreement or Conflict", type: "textarea", placeholder: "Describe a dispute with a co-worker or supervisor..." },
        { id: "s_stop", label: "S - Stop (How will you prevent an immediate flare-up?)", type: "textarea", placeholder: "e.g., Take 3 slow breaths, keep hands open and at my side, maintain respectful eye contact without glaring" },
        { id: "t_think", label: "T - Think (What are the 2 worst-case consequences of blowing up?)", type: "textarea", placeholder: "e.g., 1. Terminated on the spot with police called. 2. Parole violation and return to prison." },
        { id: "a_act", label: "A - Act (Write your exact assertive script using 'I' statements)", type: "textarea", placeholder: "e.g., 'I hear what you're saying about the pace of the work. I want to make sure the quality meets standards. Let's look at how we can divide this up.'" },
        { id: "c_check", label: "C - Check (How did this protect your goal of long-term success?)", type: "textarea", placeholder: "e.g., Defused the tension, demonstrated professionalism to management, kept my clean record intact." }
      ]
    }
  },
  {
    number: 6,
    id: "module-6-relapse-prevention",
    title: "Module 6: Re-entry Mindset & Relapse Prevention",
    badge: "Relapse Prevention",
    description: "Map high-risk people, places, and things to build an unbreakable safety boundary around your fresh start.",
    keyTakeaway: "You cannot live a new life with old routines. Changing your environment protects everything you've built at Turn90.",
    overview: "The most dangerous time for any returning citizen is when things start going well and vigilance drops. Old peers, old neighborhoods, and old habits will test your resolve. Relapse prevention is not willpower — it is structured preparation, clear boundaries, and immediate emergency escape plans.",
    lessons: [
      {
        title: "Lesson 1: People, Places, and Things",
        content: "• People: Friends and associates who are still engaged in illegal activity or substance use.\n• Places: Corners, bars, specific neighborhoods, or houses where trouble occurred in the past.\n• Things: Cash in pocket without purpose, idle unsupervised time, late-night phone calls."
      },
      {
        title: "Lesson 2: The Emergency Support Protocol",
        content: "Never face a high-risk craving or trigger alone. Have a minimum of 3 trusted contacts programmed in your phone who will answer 24/7 without judgment and talk you down or give you a ride."
      }
    ],
    tool: {
      key: "relapse_prevention",
      name: "Relapse Prevention & Trigger Mapping Plan",
      description: "Document your high-risk boundaries and 24/7 support safety net.",
      fields: [
        { id: "high_risk_people", label: "1. High-Risk People to Avoid (Initials or names)", type: "textarea", placeholder: "List people whose presence threatens your freedom and sobriety..." },
        { id: "high_risk_places", label: "2. High-Risk Places to Strictly Avoid", type: "textarea", placeholder: "Specific locations, street blocks, or establishments to never visit..." },
        { id: "high_risk_times", label: "3. High-Risk Times & Emotional States", type: "textarea", placeholder: "e.g., Friday evenings after getting paid, being lonely or exhausted, unstructured weekends" },
        { id: "emergency_contacts", label: "4. My 3 Emergency Contacts (Name, Phone & Relationship)", type: "textarea", placeholder: "1. Turn90 Case Manager: (843) ...\n2. Mentor/Sponsor: (843) ...\n3. Supportive Family Member: (843) ..." },
        { id: "safe_exit_strategy", label: "5. My Immediate Safe Exit Strategy", type: "textarea", placeholder: "What exact words and actions will you use if you unexpectedly run into old associates? (e.g., 'Good to see you man, but I'm on a tight schedule for my program, gotta go right now.')" }
      ]
    }
  }
];

// Authentic T90 SkillsCommons & Trade Tracks
const T90_TRADE_TRACKS = [
  {
    id: "jobsite-safety",
    title: "OSHA 10 & Jobsite Safety",
    icon: "🦺",
    category: "Safety & Foundations",
    description: "Essential worker safety, Personal Protective Equipment (PPE), ladder safety (4-to-1 rule), and hazard recognition required on every commercial jobsite.",
    estimatedHours: 2,
    badgeName: "Jobsite Safety Certified",
    lessons: [
      {
        id: "ppe-basics",
        title: "Personal Protective Equipment (PPE)",
        description: "Hard hats, ANSI Z87.1 eye protection, high-vis vests, steel-toe boots, and hearing protection.",
        videoUrl: "https://www.youtube-nocookie.com/embed/NV2cNmfK8_Y",
        safetyTip: "Always inspect your hard hat and safety glasses for cracks before stepping onto the jobsite.",
        keyTakeaways: [
          "PPE is your last line of defense against physical hazards on site.",
          "Safety glasses must have ANSI Z87.1 certification stamped on the frame.",
          "Steel-toe or composite-toe boots protect against heavy crushing hazards and punctures."
        ]
      },
      {
        id: "ladder-safety",
        title: "Ladder & Fall Safety (The 4-to-1 Rule)",
        description: "How to inspect, set up, and safely climb extension and step ladders without tipping.",
        videoUrl: "https://www.youtube-nocookie.com/embed/WPXagf_UiLE",
        safetyTip: "Always maintain 3 points of contact (two hands and a foot, or two feet and a hand) while climbing.",
        keyTakeaways: [
          "The 4-to-1 Rule: For every 4 feet of height up, place the base 1 foot away from the wall.",
          "An extension ladder must extend at least 3 feet above the roofline or landing.",
          "Never stand on the top step or bucket shelf of a step ladder."
        ]
      },
      {
        id: "hazard-communication",
        title: "Hazard Communication & Safety Data Sheets (SDS)",
        description: "How to read chemical warning pictograms and look up safety sheets on the job.",
        videoUrl: "https://www.youtube-nocookie.com/embed/_yWF-w3CwmU",
        safetyTip: "Never mix cleaning chemicals or solvents unless explicitly trained and authorized.",
        keyTakeaways: [
          "Safety Data Sheets (SDS) are available on every commercial jobsite in the yellow binder or digital portal.",
          "Red diamond pictograms signal immediate dangers like flammability or corrosive acids."
        ]
      }
    ]
  },
  {
    id: "carpentry-construction",
    title: "Core Construction & Carpentry",
    icon: "🪚",
    category: "Building Trades",
    description: "Reading tape measures down to 1/16th inch, circular saw safety, 2x4 wall framing, and drywall layout.",
    estimatedHours: 3,
    badgeName: "Carpentry & Framing Fundamentals",
    lessons: [
      {
        id: "tape-measure-mastery",
        title: "Reading a Tape Measure & Jobsite Math",
        description: "Master 1/2, 1/4, 1/8, and 1/16 inch marks and standard 16-inch on-center stud spacing.",
        videoUrl: "https://www.youtube-nocookie.com/embed/DqKIVmu6grM",
        safetyTip: "Control the tape when retracting — never let the metal hook slam back into the casing.",
        keyTakeaways: [
          "Black diamonds and red numbers mark standard 16-inch stud spacing for wall framing.",
          "'Measure twice, cut once' prevents material waste and project delays."
        ]
      },
      {
        id: "circular-saw-safety",
        title: "Hand & Power Tool Essentials (Circular Saw)",
        description: "Safe operation of circular saws, drills, impact drivers, and miter saws.",
        videoUrl: "https://www.youtube-nocookie.com/embed/S7QOhRRlr6A",
        safetyTip: "Never stand directly in line behind a circular saw blade to avoid kickback.",
        keyTakeaways: [
          "Set the blade depth so only one tooth depth extends below the bottom of the wood board.",
          "Always wait for the blade to come to a complete stop before lifting the saw off the cut."
        ]
      },
      {
        id: "wall-framing-basics",
        title: "Wall Framing & 2x4 Layout",
        description: "Bottom plates, top plates, studs, headers, and assembling a 2x4 wall frame.",
        videoUrl: "https://www.youtube-nocookie.com/embed/Bjuwpo9d3cQ",
        safetyTip: "Always wear safety glasses and ear protection when using pneumatic nail guns.",
        keyTakeaways: [
          "A wall frame consists of a bottom (sole) plate, top plate, and vertical studs.",
          "A finished 2x4 actually measures 1-1/2 inches by 3-1/2 inches."
        ]
      }
    ]
  },
  {
    id: "electrical-basics",
    title: "Basic Electrical & Wiring",
    icon: "⚡",
    category: "Electrical Trades",
    description: "Lockout/Tagout (LOTO), wire gauges (Romex 14 vs 12 AWG), stripping wire, and connecting switches/outlets.",
    estimatedHours: 3,
    badgeName: "Basic Electrical & Wiring Badge",
    lessons: [
      {
        id: "lockout-tagout",
        title: "Electrical Safety & Lockout/Tagout (LOTO)",
        description: "How to de-energize circuits and test with zero voltage verification before touching wires.",
        videoUrl: "https://www.youtube-nocookie.com/embed/HcvJ_Xp-ofo",
        safetyTip: "Use Live-Dead-Live tester testing to confirm your voltage detector works.",
        keyTakeaways: [
          "Lockout/Tagout places a physical padlock on the breaker panel so no one turns it on.",
          "Residential standard voltage in the US is 120V for outlets and 240V for heavy appliances."
        ]
      },
      {
        id: "wire-gauges-romex",
        title: "Understanding NM-B (Romex) Cable & Colors",
        description: "Wire color coding (Black Hot, White Neutral, Bare Ground) and matching wire gauge to circuit breakers.",
        videoUrl: "https://www.youtube-nocookie.com/embed/hFaxkK7348Y",
        safetyTip: "Never put 14-gauge wire on a 20-amp circuit breaker (14 AWG = 15A max).",
        keyTakeaways: [
          "White outer jacket = 14 Gauge (15 Amp circuits).",
          "Yellow outer jacket = 12 Gauge (20 Amp circuits).",
          "Black wire = Hot, White wire = Neutral, Bare wire = Ground."
        ]
      }
    ]
  },
  {
    id: "plumbing-foundations",
    title: "Plumbing & Piping Foundations",
    icon: "🔧",
    category: "Mechanical Trades",
    description: "PEX crimping, PVC cement and primer, replacing shutoff valves, and clearing blockages.",
    estimatedHours: 2.5,
    badgeName: "Plumbing & Pipe Foundations Badge",
    lessons: [
      {
        id: "pipe-types-pex-pvc",
        title: "Modern Pipe Materials: PVC, Copper & PEX",
        description: "Water supply piping (PEX & Copper) vs drainage piping (PVC & ABS) and watertight joints.",
        videoUrl: "https://www.youtube-nocookie.com/embed/grSlImofpe4",
        safetyTip: "Always work in a well-ventilated area when using purple PVC primer and solvent cement.",
        keyTakeaways: [
          "PEX tubing is flexible, resists freezing, and uses crimp rings or push fittings.",
          "Standard plumbing code requires a slope of 1/4 inch drop per linear foot for drain pipes."
        ]
      }
    ]
  },
  {
    id: "home-depot-certs",
    title: "Home Depot Pro & Free Certifications",
    icon: "🟧",
    category: "Industry Certifications",
    description: "Access official, free industry-recognized credentials through Home Depot Academy and Pro trade tracks.",
    estimatedHours: 4,
    badgeName: "Home Depot Pro Ready",
    lessons: [
      {
        id: "hd-academy-walkthrough",
        title: "Accessing Free Home Depot Trade Certifications",
        description: "Step-by-step walkthrough on how to sign up for Home Depot Pro Academy and earn free certificates.",
        videoUrl: "https://www.youtube-nocookie.com/embed/MPXtE6qjWG4",
        safetyTip: "Home Depot Pro certifications are recognized by thousands of employers nationwide.",
        keyTakeaways: [
          "Home Depot provides free online courses in Carpentry, Electrical, Plumbing, and Construction.",
          "Courses can be taken on any Chromebook, phone, or computer for free."
        ]
      }
    ]
  }
];

const REENTRY_EMPLOYERS = [
  {
    company: "First Shift Manufacturing Partners",
    location: "Charleston & Columbia, SC",
    role: "Assembly Technician / Machine Operator",
    pay: "$17.50 - $21.00 / hr",
    shift: "1st Shift (7:00 AM - 3:30 PM)",
    felonyFriendly: true,
    description: "Entry level manufacturing with rapid promotion pathway, full medical benefits, and 401(k)."
  },
  {
    company: "Palmetto Logistics & Warehousing",
    location: "Charleston, SC",
    role: "Forklift Operator & Material Handler",
    pay: "$18.00 - $22.50 / hr",
    shift: "Day Shift",
    felonyFriendly: true,
    description: "Fast-paced distribution center. Forklift certification provided on-site during week 2."
  },
  {
    company: "Carolina Industrial Services",
    location: "Columbia, SC",
    role: "Commercial Facility Maintenance",
    pay: "$16.50 - $19.00 / hr",
    shift: "Day Shift (8:00 AM - 4:30 PM)",
    felonyFriendly: true,
    description: "HVAC filter changes, basic electrical troubleshooting, and general commercial building maintenance."
  },
  {
    company: "Lowcountry Construction Group",
    location: "North Charleston, SC",
    role: "Framing & Carpentry Apprentice",
    pay: "$19.00 - $24.00 / hr",
    shift: "6:30 AM - 3:00 PM",
    felonyFriendly: true,
    description: "Residential and light commercial framing. Tools and PPE provided."
  }
];

module.exports = {
  cbtModules,
  T90_TRADE_TRACKS,
  REENTRY_EMPLOYERS
};
