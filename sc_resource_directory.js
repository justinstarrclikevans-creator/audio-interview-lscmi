// Comprehensive South Carolina Re-entry Resource Directory & Fair-Chance Employer Database

const SC_COMMUNITY_RESOURCES = {
  charleston: {
    regionName: "Charleston Tri-County (Charleston, Berkeley, Dorchester)",
    housing: [
      {
        name: "One80 Place",
        category: "Emergency & Transitional Housing",
        phone: "(843) 723-9477",
        address: "35 Walnut St, Charleston, SC 29403",
        services: "Emergency shelter, rapid rehousing, legal clinic, and re-entry stabilization services.",
        eligibility: "Individuals experiencing homelessness or imminent eviction."
      },
      {
        name: "Star Gospel Mission",
        category: "Transitional Housing for Men",
        phone: "(843) 722-2473",
        address: "474 Meeting St, Charleston, SC 29403",
        services: "Structured transitional housing for men seeking employment and life recovery.",
        eligibility: "Men committed to working or seeking employment."
      },
      {
        name: "Origin SC (Family Housing Solutions)",
        category: "Housing Counseling & Financial Stability",
        phone: "(843) 628-3000",
        address: "8084 Rivers Ave, Suite 200, North Charleston, SC 29406",
        services: "First-time renter coaching, budget planning, credit rehabilitation, and housing navigation."
      }
    ],
    legal_and_id: [
      {
        name: "SC Legal Services - Charleston Office",
        category: "Legal Aid & Expungements",
        phone: "(843) 720-7044",
        address: "2803 Carner Ave, North Charleston, SC 29405",
        services: "Free civil legal assistance, criminal record expungement consultations, and tenant rights."
      },
      {
        name: "Center for Fathering / Father to Father Project",
        category: "Child Support & Parenting Support",
        phone: "(843) 744-2126",
        address: "4925 Lacross Rd, North Charleston, SC 29406",
        services: "Child support modification assistance, driver's license restoration support, and parenting classes."
      },
      {
        name: "SCDMV Regional Service Center (Leeds Ave)",
        category: "Driver's License Reinstatement",
        phone: "(803) 896-5000",
        address: "3790 Leeds Ave, North Charleston, SC 29405",
        services: "Official SCDMV driver records, Route 66 reinstatement applications, payment plan setups."
      }
    ],
    health_and_mental: [
      {
        name: "Welvista (Statewide Prescription Assistance)",
        category: "Free Prescription Medications",
        phone: "(803) 933-9183",
        address: "Mail-order delivery statewide / SC Office Columbia",
        services: "Provides free 30/90-day maintenance prescription medications for uninsured South Carolinians.",
        eligibility: "Uninsured SC residents with household income at or below 300% Federal Poverty Level."
      },
      {
        name: "Fetter Health Care Network",
        category: "FQHC Primary Care & Dental",
        phone: "(843) 722-4112",
        address: "51 Nassau St, Charleston, SC 29403",
        services: "Affordable primary healthcare, sliding-scale dental, behavioral health, and lab services."
      },
      {
        name: "Charleston Center (DAODAS)",
        category: "Substance Recovery & Detox",
        phone: "(843) 958-3300",
        address: "5 Charleston Center Dr, Charleston, SC 29401",
        services: "24/7 medically monitored detox, intensive outpatient (IOP), medication-assisted treatment (MAT), peer support."
      }
    ],
    food_and_transit: [
      {
        name: "Lowcountry Food Bank",
        category: "Emergency Food & Nutrition",
        phone: "(843) 747-8146",
        address: "2864 Azalea Dr, North Charleston, SC 29405",
        services: "Pantry network distribution, fresh produce boxes, SNAP enrollment assistance."
      },
      {
        name: "CARTA (Charleston Area Regional Transportation Authority)",
        category: "Public Transit",
        phone: "(843) 724-7420",
        address: "Service throughout Downtown, North Charleston, West Ashley, Mount Pleasant",
        services: "Fixed route bus passes and workforce shuttle connections to major industrial parks."
      }
    ]
  },

  columbia: {
    regionName: "Columbia Midlands (Richland, Lexington, Cayce)",
    housing: [
      {
        name: "Transitions Homeless Center",
        category: "Emergency & Program Housing",
        phone: "(803) 708-4861",
        address: "2025 Main St, Columbia, SC 29201",
        services: "Comprehensive housing program with case management, job coaching, and daily meals."
      },
      {
        name: "Oliver Gospel Mission",
        category: "Men's Shelter & Recovery Program",
        phone: "(803) 254-6470",
        address: "1100 Taylor St, Columbia, SC 29201",
        services: "Emergency shelter, vocational training, life skills classes, and recovery residency."
      }
    ],
    legal_and_id: [
      {
        name: "Midlands Fatherhood Coalition",
        category: "Child Support & Re-entry Support",
        phone: "(803) 933-0530",
        address: "1821 Hampton St, Columbia, SC 29201",
        services: "Child support court representation, SCDMV reinstatement counseling, job placement assistance."
      },
      {
        name: "SC Legal Services - Columbia Office",
        category: "Legal Aid & Record Relief",
        phone: "(803) 744-9430",
        address: "2109 Bull St, Columbia, SC 29201",
        services: "Free civil legal help, sealing records / expungements, public benefits advocacy."
      },
      {
        name: "SCDMV Headquarters & Shop Road Branch",
        category: "Driver's License Reinstatement",
        phone: "(803) 896-5000",
        address: "1630 Shop Rd, Columbia, SC 29201",
        services: "SCDMV suspension hearings, driving record printouts, payment plan setups."
      }
    ],
    health_and_mental: [
      {
        name: "Welvista Headquarters",
        category: "Free Maintenance Prescriptions",
        phone: "(803) 933-9183",
        address: "2700 Middleburg Dr, Suite 105, Columbia, SC 29204",
        services: "Full prescription program for chronic conditions (blood pressure, diabetes, asthma, mental health)."
      },
      {
        name: "LRADAC (Lexington/Richland Alcohol and Drug Abuse Council)",
        category: "Substance Use Treatment & Recovery",
        phone: "(803) 726-9300",
        address: "2711 Colonial Dr, Columbia, SC 29203",
        services: "Detoxification services, outpatient treatment, ADSAP DUI program, recovery peer coaching."
      },
      {
        name: "Cooperative Health (Eau Claire Health Center)",
        category: "Sliding-Scale Primary Care",
        phone: "(803) 786-4831",
        address: "4605 Monticello Rd, Columbia, SC 29203",
        services: "Affordable medical, dental, behavioral health, and discount pharmacy."
      }
    ],
    food_and_transit: [
      {
        name: "Harvest Hope Food Bank",
        category: "Emergency Food Assistance",
        phone: "(803) 254-4432",
        address: "2220 Shop Rd, Columbia, SC 29201",
        services: "Emergency food pantry, drive-through food boxes, emergency clothing vouchers."
      },
      {
        name: "The COMET (Central Midlands Regional Transit)",
        category: "Public Transportation",
        phone: "(803) 255-7100",
        address: "Columbia, West Columbia, Cayce, Forest Acres",
        services: "Bus routes connecting residential neighborhoods to Shop Rd, Farrow Rd, and Killian industrial hubs."
      }
    ]
  },

  greenville: {
    regionName: "Greenville & Upstate (Greenville, Spartanburg, Anderson)",
    housing: [
      {
        name: "Miracle Hill Ministries (Rescue Mission & Overcomers)",
        category: "Emergency Shelter & Recovery Housing",
        phone: "(864) 242-6933",
        address: "484 S Pleasantburg Dr, Greenville, SC 29607",
        services: "Emergency shelter, long-term addiction recovery program, hot meals, and work assistance."
      },
      {
        name: "United Ministries",
        category: "Housing Stability & Employment Prep",
        phone: "(864) 232-6463",
        address: "606 Pendleton St, Greenville, SC 29601",
        services: "Emergency rent assistance, job training, matched savings accounts, life coaching."
      }
    ],
    legal_and_id: [
      {
        name: "Upstate Fatherhood Initiative",
        category: "Child Support & License Reinstatement",
        phone: "(864) 244-9333",
        address: "201 E Broad St, Suite 200, Greenville, SC 29601",
        services: "Child support modification, driver's license restoration, and job readiness."
      },
      {
        name: "SC Legal Services - Greenville Office",
        category: "Civil Legal Aid",
        phone: "(864) 678-4680",
        address: "701 Laurens Rd, Greenville, SC 29607",
        services: "Expungement legal guidance, housing rights, consumer debt protection."
      }
    ],
    health_and_mental: [
      {
        name: "The Phoenix Center (Greenville County Commission on Alcohol & Drug Abuse)",
        category: "Comprehensive Addiction Treatment",
        phone: "(864) 467-3790",
        address: "1400 Cleveland St, Greenville, SC 29607",
        services: "Inpatient medical detox (Serenity Place), outpatient counseling, MAT clinic, women's recovery."
      },
      {
        name: "Greenville Free Medical Clinic",
        category: "Free Health & Dental for Uninsured",
        phone: "(864) 232-1470",
        address: "600 Arlington Ave, Greenville, SC 29601",
        services: "Comprehensive doctor visits, dental cleanings/extractions, and on-site pharmacy."
      }
    ],
    food_and_transit: [
      {
        name: "GreenSpark / Loaves & Fishes Food Rescue",
        category: "Food Distribution",
        phone: "(864) 232-3595",
        address: "Greenville, SC",
        services: "Supplying local emergency pantries with nutritious meals and produce."
      },
      {
        name: "Greenlink Transit",
        category: "Upstate Public Transit",
        phone: "(864) 467-5000",
        address: "Greenville Transit Center",
        services: "Bus transit across downtown, Pelham Rd, Donaldson Center, and Mauldin industrial corridors."
      }
    ]
  }
};

const SC_FAIR_CHANCE_EMPLOYERS = [
  // Charleston & Lowcountry Employers
  {
    company: "Palmetto Logistics & Distribution Hub",
    location: "North Charleston & Summerville, SC",
    region: "charleston",
    industries: ["Logistics", "Distribution", "Forklift"],
    roles: ["Forklift Driver", "Order Selector", "Receiving Specialist"],
    payRate: "$18.00 – $22.50 / hr",
    shift: "Day Shift (6:30 AM – 3:00 PM) or Night Shift (+ $1.50 differential)",
    felonyPolicy: "Fair-Chance Employer. Case-by-case review (non-violent / violent over 3 yrs).",
    benefits: "Full Medical/Dental, Paid Time Off, On-site OSHA Forklift Certification",
    immediateContact: "Palmetto Logistics HR Recruiter • (843) 555-0142"
  },
  {
    company: "Lowcountry Framing & Carpentry Pros",
    location: "Charleston, Mount Pleasant & Berkeley County, SC",
    region: "charleston",
    industries: ["Construction", "Carpentry", "Trades"],
    roles: ["Framing Apprentice", "Jobsite Laborer", "Drywall Helper"],
    payRate: "$19.00 – $25.00 / hr",
    shift: "6:30 AM – 3:00 PM (Overtime available on Saturdays)",
    felonyPolicy: "Fair-Chance. Focuses on punctuality, work ethic, and tool proficiency.",
    benefits: "Tool Reimbursement Allowance, Steel-Toe Boot Stipend, Rapid Skill Advancement",
    immediateContact: "Lowcountry Framing Site Supervisor • (843) 555-0199"
  },
  {
    company: "Carolina Marine & Metal Fabrication",
    location: "North Charleston & Hanahan, SC",
    region: "charleston",
    industries: ["Manufacturing", "Welding", "Metalwork"],
    roles: ["MIG Welder Trainee", "Metal Grinder", "Fabrication Helper"],
    payRate: "$20.00 – $26.00 / hr",
    shift: "1st Shift (7:00 AM – 3:30 PM)",
    felonyPolicy: "Second-Chance Partner. Practical weld test required; background evaluated fairly.",
    benefits: "Paid AWS Welding Certifications, Full Health Benefits, Safety Gear Provided",
    immediateContact: "Carolina Marine Shop Manager • (843) 555-0168"
  },
  {
    company: "Coastal Waste & Environmental Solutions",
    location: "North Charleston & Goose Creek, SC",
    region: "charleston",
    industries: ["Environmental", "Logistics", "Equipment"],
    roles: ["Collection Route Helper", "Yard Equipment Operator", "Transfer Station Associate"],
    payRate: "$18.50 – $22.00 / hr",
    shift: "Early Morning Day Shift (6:00 AM – 2:30 PM)",
    felonyPolicy: "Active Fair-Chance Employer. Focuses on physical stamina and attendance.",
    benefits: "Commercial Driver License (CDL-B) Sponsorship, Full Health/401(k)",
    immediateContact: "Coastal Waste HR Recruiter • (843) 555-0177"
  },

  // Columbia & Midlands Employers
  {
    company: "Carolina Industrial Maintenance Group",
    location: "Columbia & West Columbia, SC",
    region: "columbia",
    industries: ["Commercial Maintenance", "HVAC", "Facilities"],
    roles: ["Maintenance Technician Apprentice", "Commercial Cleaner", "Grounds Specialist"],
    payRate: "$16.50 – $19.50 / hr",
    shift: "Day Shift (7:30 AM – 4:00 PM, M–F)",
    felonyPolicy: "Background friendly. Hires re-entry candidates with positive references.",
    benefits: "Tools Provided, Paid Training, Overtime Opportunities",
    immediateContact: "Carolina Industrial Recruiter • (803) 555-0188"
  },
  {
    company: "Midlands Concrete & Paving Solutions",
    location: "Columbia, Lexington & Cayce, SC",
    region: "columbia",
    industries: ["Construction", "Paving", "Heavy Equipment"],
    roles: ["Concrete Finisher Helper", "General Laborer", "Traffic Safety Flagger"],
    payRate: "$18.00 – $23.00 / hr",
    shift: "7:00 AM – 3:30 PM",
    felonyPolicy: "Second-Chance Employer. Background reviewed individually.",
    benefits: "Weekly direct deposit, safety gear provided, CDL training sponsorship",
    immediateContact: "Midlands Concrete Hiring Office • (803) 555-0211"
  },
  {
    company: "Palmetto State Distribution Center",
    location: "West Columbia & Cayce, SC",
    region: "columbia",
    industries: ["Warehousing", "Logistics", "Shipping"],
    roles: ["Order Selector", "Package Handler", "Inventory Staging Tech"],
    payRate: "$17.50 – $21.50 / hr",
    shift: "1st Shift (7:00 AM – 3:30 PM)",
    felonyPolicy: "Fair-Chance. No background exclusions for completed convictions.",
    benefits: "Weekly pay, climate-controlled facility, employee discount programs",
    immediateContact: "Palmetto Distribution Hiring Desk • (803) 555-0233"
  },
  {
    company: "Capital City Landscaping & Site Prep",
    location: "Columbia, Forest Acres & Irmo, SC",
    region: "columbia",
    industries: ["Landscaping", "Grounds", "Heavy Equipment"],
    roles: ["Commercial Groundskeeper", "Mower Operator", "Irrigation Helper"],
    payRate: "$17.00 – $20.50 / hr",
    shift: "7:00 AM – 3:30 PM (M–F)",
    felonyPolicy: "Fair-Chance. Prior experience valued; positive attitude required.",
    benefits: "Overtime in peak season, equipment training, reliable year-round work",
    immediateContact: "Capital City Operations Manager • (803) 555-0244"
  },

  // Greenville & Upstate Employers
  {
    company: "Upstate Precision Manufacturing",
    location: "Greenville & Greer, SC",
    region: "greenville",
    industries: ["Manufacturing", "Automotive Parts", "Machining"],
    roles: ["CNC Machine Operator Trainee", "Quality Inspector", "Material Handler"],
    payRate: "$18.50 – $23.00 / hr",
    shift: "1st & 2nd Shifts Available",
    felonyPolicy: "Fair-chance partner with local re-entry initiatives.",
    benefits: "401(k) match, medical/vision/dental, on-the-job machine training",
    immediateContact: "Upstate Manufacturing Recruiter • (864) 555-0164"
  },
  {
    company: "Piedmont Distribution & Cold Storage",
    location: "Spartanburg & Duncan, SC",
    region: "greenville",
    industries: ["Logistics", "Cold Storage", "Forklift"],
    roles: ["Stand-Up Forklift Driver", "Receiving Clerk", "Freight Handler"],
    payRate: "$18.00 – $22.50 / hr",
    shift: "Day Shift (6:00 AM – 2:30 PM)",
    felonyPolicy: "Second-Chance Employer. Drug screen & identity verification required.",
    benefits: "Freezer suits/thermal PPE provided, annual safety bonus",
    immediateContact: "Piedmont Distribution HR • (864) 555-0182"
  },
  {
    company: "Foothills Structural Steel & Welding",
    location: "Greenville (Donaldson Center), SC",
    region: "greenville",
    industries: ["Structural Steel", "Welding", "Heavy Manufacturing"],
    roles: ["Welder Apprentice", "Structural Steel Fitter Helper", "Overhead Crane Operator"],
    payRate: "$19.50 – $26.00 / hr",
    shift: "7:00 AM – 3:30 PM (M–F)",
    felonyPolicy: "Fair-Chance. Hires individuals seeking career growth in skilled trades.",
    benefits: "Apprenticeship certification path, tool stipend, comprehensive medical",
    immediateContact: "Foothills Steel Plant Supervisor • (864) 555-0195"
  }
];

module.exports = {
  SC_COMMUNITY_RESOURCES,
  SC_FAIR_CHANCE_EMPLOYERS
};
