// Training, CBT, T90 Trades Tracks, and Re-entry Resources database module

const cbtModules = [
  {
    number: 1,
    title: "Module 1: Thoughts, Feelings & Actions",
    description: "Understand the connection between how your thoughts lead to emotions and direct behaviors.",
    keyTakeaway: "Thoughts drive behaviors. By catching automatic negative thoughts, you take control of your outcomes.",
    sections: [
      { title: "The Cognitive Triangle", content: "Learn how situations trigger thoughts, which produce feelings, leading directly to physical choices." },
      { title: "Worksheet: Situation Breakdown", content: "Identify a recent high-stress situation and break down what you thought vs. how you responded." }
    ]
  },
  {
    number: 2,
    title: "Module 2: Identifying Automatic Thoughts & Cognitive Distortions",
    description: "Recognize thinking traps like all-or-nothing thinking, jumping to conclusions, and personalization.",
    keyTakeaway: "Notice when your mind is making assumptions that escalate conflict with supervisors or family.",
    sections: [
      { title: "Common Thinking Traps", content: "Catastrophizing, mind-reading, blaming, and black-and-white perspectives." },
      { title: "Reframing Exercise", content: "Practice turning 'They are out to get me' into 'Let me clarify expectations with my supervisor.'" }
    ]
  },
  {
    number: 3,
    title: "Module 3: Emotional Regulation & Anger Management",
    description: "Physical body awareness, cooling techniques, and de-escalation strategies in the workplace.",
    keyTakeaway: "Responding thoughtfully always beats reacting impulsively on the job site.",
    sections: [
      { title: "Physical Warning Signs", content: "Heart rate increases, clenched fists, tunnel vision — recognizing anger early." },
      { title: "The 5-Second Pause", content: "Concrete breathing and grounding techniques before responding to disrespect." }
    ]
  },
  {
    number: 4,
    title: "Module 4: Problem Solving & Decision Making",
    description: "A 5-step structured framework for resolving complex life and job barriers.",
    keyTakeaway: "Define the real problem, brainstorm 3 options, weigh consequences, choose, and evaluate.",
    sections: [
      { title: "The SODAS Method", content: "Situation, Options, Disadvantages, Advantages, Solution." },
      { title: "Real Life Practice", content: "Resolving transportation failures or schedule conflicts without quitting." }
    ]
  },
  {
    number: 5,
    title: "Module 5: Interpersonal Communication & Workplace Conflict",
    description: "Assertive communication vs. aggressive or passive communication.",
    keyTakeaway: "Use 'I' statements and active listening to get your needs met without creating enemies.",
    sections: [
      { title: "Communication Styles", content: "Passive, Aggressive, Passive-Aggressive, and Assertive communication models." },
      { title: "Roleplay Scenarios", content: "How to disagree with a boss or co-worker professionally." }
    ]
  },
  {
    number: 6,
    title: "Module 6: Re-entry Mindset & Relapse Prevention",
    description: "Mapping high-risk people, places, and things; building a solid supportive circle.",
    keyTakeaway: "Old habits return in old environments. Protect your fresh start with clear boundaries.",
    sections: [
      { title: "High-Risk Trigger Mapping", content: "Identify people, neighborhood corners, and emotional states that trigger violations." },
      { title: "Emergency Support Protocol", content: "Who to call when feeling overwhelmed or triggered to use substances/reoffend." }
    ]
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
