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
        websiteUrl: "https://one80place.org",
        services: "Emergency shelter, rapid rehousing, legal clinic, and re-entry stabilization services.",
        eligibility: "Individuals experiencing homelessness or imminent eviction."
      },
      {
        name: "Star Gospel Mission",
        category: "Transitional Housing for Men",
        phone: "(843) 722-2473",
        address: "474 Meeting St, Charleston, SC 29403",
        websiteUrl: "https://stargospelmission.org",
        services: "Structured transitional housing for men seeking employment and life recovery.",
        eligibility: "Men committed to working or seeking employment."
      },
      {
        name: "Origin SC (Family Housing Solutions)",
        category: "Housing Counseling & Financial Stability",
        phone: "(843) 628-3000",
        address: "8084 Rivers Ave, Suite 200, North Charleston, SC 29406",
        websiteUrl: "https://originsc.org",
        services: "First-time renter coaching, budget planning, credit rehabilitation, and housing navigation."
      }
    ],
    legal_and_id: [
      {
        name: "SC Legal Services - Charleston Office",
        category: "Legal Aid & Expungements",
        phone: "(843) 720-7044",
        address: "2803 Carner Ave, North Charleston, SC 29405",
        websiteUrl: "https://sclegal.org",
        services: "Free civil legal assistance, criminal record expungement consultations, and tenant rights."
      },
      {
        name: "Center for Fathering / Father to Father Project",
        category: "Child Support & Parenting Support",
        phone: "(843) 744-2126",
        address: "4925 Lacross Rd, North Charleston, SC 29406",
        websiteUrl: "https://scfathersandfamilies.com",
        services: "Child support modification assistance, driver's license restoration support, and parenting classes."
      },
      {
        name: "SCDMV Regional Service Center (Leeds Ave)",
        category: "Driver's License Reinstatement",
        phone: "(803) 896-5000",
        address: "3790 Leeds Ave, North Charleston, SC 29405",
        websiteUrl: "https://scdmvonline.com/Driver-Services/Reinstatement",
        services: "Official SCDMV driver records, license reinstatement applications, and fee payment plans."
      }
    ],
    health_and_mental: [
      {
        name: "Welvista (Statewide Prescription Assistance)",
        category: "Free Prescription Medications",
        phone: "1-800-983-3339",
        address: "270 Stoneridge Dr, Suite 200, Columbia, SC 29210 (Direct mail delivery to your home/shelter statewide)",
        websiteUrl: "https://welvista.org/patient-services/",
        services: "Provides 100% free 90-day maintenance prescription medications for uninsured South Carolinians.",
        eligibility: "Uninsured SC residents with household income at or below 300% Federal Poverty Level."
      },
      {
        name: "South Carolina Healthy Connections Medicaid (SCDHHS)",
        category: "State Health Insurance",
        phone: "1-888-549-0820",
        address: "326 Westinghouse Rd, Charleston, SC 29412 (Local Office) / Online apply.scdhhs.gov",
        websiteUrl: "https://apply.scdhhs.gov",
        services: "Comprehensive health insurance covering doctor visits, emergency care, dental, mental health, addiction treatment, and prescriptions.",
        eligibility: "Low-income SC residents, parents, disabled individuals, or individuals in transitional employment."
      },
      {
        name: "Fetter Health Care Network",
        category: "FQHC Primary Care & Dental",
        phone: "(843) 722-4112",
        address: "51 Nassau St, Charleston, SC 29403",
        websiteUrl: "https://fetterhealthcare.org",
        services: "Affordable primary healthcare, sliding-scale dental, behavioral health, and lab services."
      },
      {
        name: "Charleston Center (DAODAS)",
        category: "Substance Recovery & Detox",
        phone: "(843) 958-3300",
        address: "5 Charleston Center Dr, Charleston, SC 29401",
        websiteUrl: "https://charlestoncounty.org/departments/charleston-center/",
        services: "24/7 medically monitored detox, intensive outpatient (IOP), medication-assisted treatment (MAT), peer support."
      }
    ],
    food_and_transit: [
      {
        name: "South Carolina SNAP (Food Stamps) - Charleston County DSS",
        category: "Nutrition & Food Stamps",
        phone: "1-800-616-1309",
        address: "3366 Rivers Ave, North Charleston, SC 29405 / Online benefitsportal.dss.sc.gov",
        websiteUrl: "https://benefitsportal.dss.sc.gov/",
        services: "Monthly grocery funds loaded onto an EBT card. South Carolina allows individuals with past criminal convictions to qualify for SNAP!",
        eligibility: "Income-eligible SC households. Expedited SNAP provided within 7 days if monthly income < $150."
      },
      {
        name: "South Carolina TANF Cash Assistance - SC DSS",
        category: "Family Cash Assistance",
        phone: "1-800-616-1309",
        address: "3366 Rivers Ave, North Charleston, SC 29405 / Online benefitsportal.dss.sc.gov",
        websiteUrl: "https://benefitsportal.dss.sc.gov/",
        services: "Temporary monthly cash assistance and supportive services for low-income families with dependent children or pregnant individuals. Turn90 hours count toward work requirements!",
        eligibility: "Low-income families with children under 18 or pregnant women."
      },
      {
        name: "Lowcountry Food Bank",
        category: "Emergency Food & Nutrition",
        phone: "(843) 747-8146",
        address: "2864 Azalea Dr, North Charleston, SC 29405",
        websiteUrl: "https://lowcountryfoodbank.org",
        services: "Pantry network distribution, fresh produce boxes, SNAP enrollment assistance."
      },
      {
        name: "CARTA (Charleston Area Regional Transportation Authority)",
        category: "Public Transit",
        phone: "(843) 724-7420",
        address: "Service throughout Downtown, North Charleston, West Ashley, Mount Pleasant",
        websiteUrl: "https://ridecarta.com",
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
        websiteUrl: "https://transitionssc.org",
        services: "Comprehensive housing program with case management, job coaching, and daily meals."
      },
      {
        name: "Oliver Gospel Mission",
        category: "Men's Shelter & Recovery Program",
        phone: "(803) 254-6470",
        address: "1100 Taylor St, Columbia, SC 29201",
        websiteUrl: "https://olivergospel.org",
        services: "Emergency shelter, vocational training, life skills classes, and recovery residency."
      }
    ],
    legal_and_id: [
      {
        name: "Midlands Fatherhood Coalition",
        category: "Child Support & Re-entry Support",
        phone: "(803) 933-0530",
        address: "1821 Hampton St, Columbia, SC 29201",
        websiteUrl: "https://midlandsfathers.com",
        services: "Child support court representation, SCDMV reinstatement counseling, job placement assistance."
      },
      {
        name: "SC Legal Services - Columbia Office",
        category: "Legal Aid & Record Relief",
        phone: "(803) 744-9430",
        address: "2109 Bull St, Columbia, SC 29201",
        websiteUrl: "https://sclegal.org",
        services: "Free civil legal help, sealing records / expungements, public benefits advocacy."
      },
      {
        name: "SCDMV Headquarters & Shop Road Branch",
        category: "Driver's License Reinstatement",
        phone: "(803) 896-5000",
        address: "1630 Shop Rd, Columbia, SC 29201",
        websiteUrl: "https://scdmvonline.com/Driver-Services/Reinstatement",
        services: "SCDMV suspension hearings, driving record printouts, payment plan setups."
      }
    ],
    health_and_mental: [
      {
        name: "Welvista Headquarters",
        category: "Free Maintenance Prescriptions",
        phone: "1-800-983-3339",
        address: "270 Stoneridge Dr, Suite 200, Columbia, SC 29210",
        websiteUrl: "https://welvista.org/patient-services/",
        services: "Full prescription program for chronic conditions (blood pressure, diabetes, asthma, mental health) mailed statewide with $0 copays."
      },
      {
        name: "South Carolina Healthy Connections Medicaid (Richland County)",
        category: "State Health Insurance",
        phone: "1-888-549-0820",
        address: "3220 Two Notch Rd, Columbia, SC 29204 / Online apply.scdhhs.gov",
        websiteUrl: "https://apply.scdhhs.gov",
        services: "Comprehensive state Medicaid health insurance covering primary care, hospitals, prescriptions, and mental health."
      },
      {
        name: "LRADAC (Lexington/Richland Alcohol and Drug Abuse Council)",
        category: "Substance Use Treatment & Recovery",
        phone: "(803) 726-9300",
        address: "2711 Colonial Dr, Columbia, SC 29203",
        websiteUrl: "https://lradac.org",
        services: "Detoxification services, outpatient treatment, ADSAP DUI program, recovery peer coaching."
      },
      {
        name: "Cooperative Health (Eau Claire Health Center)",
        category: "Sliding-Scale Primary Care",
        phone: "(803) 786-4831",
        address: "4605 Monticello Rd, Columbia, SC 29203",
        websiteUrl: "https://cooperativehealth.org",
        services: "Affordable medical, dental, behavioral health, and discount pharmacy."
      }
    ],
    food_and_transit: [
      {
        name: "South Carolina SNAP (Food Stamps) - Richland County DSS",
        category: "Nutrition & Food Stamps",
        phone: "1-800-616-1309",
        address: "3220 Two Notch Rd, Columbia, SC 29204 / Online benefitsportal.dss.sc.gov",
        websiteUrl: "https://benefitsportal.dss.sc.gov/",
        services: "Monthly food and grocery assistance on an EBT card. Expedited 7-day SNAP available."
      },
      {
        name: "South Carolina TANF Cash Assistance - Richland County DSS",
        category: "Family Cash Assistance",
        phone: "1-800-616-1309",
        address: "3220 Two Notch Rd, Columbia, SC 29204 / Online benefitsportal.dss.sc.gov",
        websiteUrl: "https://benefitsportal.dss.sc.gov/",
        services: "Monthly cash assistance for eligible low-income families with minor children or pregnant women."
      },
      {
        name: "Harvest Hope Food Bank",
        category: "Emergency Food Assistance",
        phone: "(803) 254-4432",
        address: "2220 Shop Rd, Columbia, SC 29201",
        websiteUrl: "https://harvesthope.org",
        services: "Emergency food pantry, drive-through food boxes, emergency clothing vouchers."
      },
      {
        name: "The COMET (Central Midlands Regional Transit)",
        category: "Public Transportation",
        phone: "(803) 255-7100",
        address: "Columbia, West Columbia, Cayce, Forest Acres",
        websiteUrl: "https://catchthecometsc.gov",
        services: "Bus routes connecting residential neighborhoods to Shop Rd, Farrow Rd, and Killian industrial hubs."
      }
    ],
    employment_and_training: [
      {
        name: "SC Works Midlands (Columbia Center)",
        category: "State Workforce & Job Placement",
        phone: "(803) 737-5627",
        address: "700 Taylor St, Columbia, SC 29201",
        websiteUrl: "http://www.scworksmidlands.org/",
        services: "Job matching, resume labs, WIOA training grants, federal bonding program for justice-impacted jobseekers."
      },
      {
        name: "Automation Personnel Services - Columbia",
        category: "Industrial & Manufacturing Staffing",
        phone: "(803) 798-8841",
        address: "1350 Bush River Rd Ste. C, Columbia, SC 29210",
        websiteUrl: "https://apstemps.com/branch-columbia-sc/",
        services: "Light industrial, manufacturing assembly, warehouse order pulling, and packaging roles."
      },
      {
        name: "Luttrell Staffing Group - Columbia",
        category: "Light Industrial & Warehouse Staffing",
        phone: "(803) 626-0311",
        address: "SOCO BullStreet, 1721 Saunders St Ste 3, Columbia, SC 29201",
        websiteUrl: "https://www.luttrellstaffing.com/columbia-sc/",
        services: "Day shift warehouse associate, machine operation, and manufacturing assembly placements."
      },
      {
        name: "ProLogistix / ResourceMFG Midlands",
        category: "Logistics & Manufacturing Placement",
        phone: "(803) 798-1700",
        address: "3740 Fernandina Rd Ste B, Columbia, SC 29210",
        websiteUrl: "https://www.resourcemfg.com/locations/columbia-sc/",
        services: "Dedicated logistics staffing, forklift operators, pick/pack, and machine operators."
      },
      {
        name: "Onin Staffing West Columbia",
        category: "Warehouse & Production Staffing",
        phone: "(803) 667-4676",
        address: "950 Sunset Blvd, West Columbia, SC 29169",
        websiteUrl: "https://www.oninstaffing.com/",
        services: "Full-time warehouse fulfillment, packaging, order selecting, and light assembly with immediate benefits."
      },
      {
        name: "Spherion Staffing & Recruiting",
        category: "Industrial & Distribution Staffing",
        phone: "(803) 772-4915",
        address: "4727D Sunset Blvd, Lexington, SC 29072",
        websiteUrl: "https://www.spherion.com/our-offices/columbia_1183/",
        services: "Distribution center order selectors, assembly technicians, and general manufacturing roles."
      },
      {
        name: "HireQuest Direct of Columbia & West Columbia",
        category: "Daily Dispatch & Skilled Trades",
        phone: "(803) 256-3330",
        address: "2000 Laurel St, Columbia, SC 29204 / 103 N 12th St, West Columbia, SC 29169",
        websiteUrl: "https://hirequestdirect.com/columbia-sc/",
        services: "Construction trade helpers, site clean-up, material handling, event logistics, and commercial labor."
      },
      {
        name: "PeopleReady Columbia",
        category: "On-Demand Industrial & Trade Labor",
        phone: "(803) 256-5544",
        address: "2600 Millwood Ave, Columbia, SC 29205",
        websiteUrl: "https://locations.peopleready.com/columbia-sc-1304",
        services: "Immediate industrial, warehousing, construction helper, and hospitality logistics dispatch."
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
        websiteUrl: "https://miraclehill.org",
        services: "Emergency shelter, long-term addiction recovery program, hot meals, and work assistance."
      },
      {
        name: "United Ministries",
        category: "Housing Stability & Employment Prep",
        phone: "(864) 232-6463",
        address: "606 Pendleton St, Greenville, SC 29601",
        websiteUrl: "https://united-ministries.com",
        services: "Emergency rent assistance, job training, matched savings accounts, life coaching."
      }
    ],
    legal_and_id: [
      {
        name: "Upstate Fatherhood Initiative",
        category: "Child Support & License Reinstatement",
        phone: "(864) 244-9333",
        address: "201 E Broad St, Suite 200, Greenville, SC 29601",
        websiteUrl: "https://scfathersandfamilies.com",
        services: "Child support modification, driver's license restoration, and job readiness."
      },
      {
        name: "SC Legal Services - Greenville Office",
        category: "Civil Legal Aid",
        phone: "(864) 678-4680",
        address: "701 Laurens Rd, Greenville, SC 29607",
        websiteUrl: "https://sclegal.org",
        services: "Expungement legal guidance, housing rights, consumer debt protection."
      }
    ],
    health_and_mental: [
      {
        name: "The Phoenix Center (Greenville County Commission on Alcohol & Drug Abuse)",
        category: "Comprehensive Addiction Treatment",
        phone: "(864) 467-3790",
        address: "1400 Cleveland St, Greenville, SC 29607",
        websiteUrl: "https://phoenixcenter.org",
        services: "Inpatient medical detox (Serenity Place), outpatient counseling, MAT clinic, women's recovery."
      },
      {
        name: "Greenville Free Medical Clinic",
        category: "Free Health & Dental for Uninsured",
        phone: "(864) 232-1470",
        address: "600 Arlington Ave, Greenville, SC 29601",
        websiteUrl: "https://greenvillefreeclinic.org",
        services: "Comprehensive doctor visits, dental cleanings/extractions, and on-site pharmacy."
      }
    ],
    food_and_transit: [
      {
        name: "GreenSpark / Loaves & Fishes Food Rescue",
        category: "Food Distribution",
        phone: "(864) 232-3595",
        address: "Greenville, SC",
        websiteUrl: "https://loavesandfishesgreenville.org",
        services: "Supplying local emergency pantries with nutritious meals and produce."
      },
      {
        name: "Greenlink Transit",
        category: "Upstate Public Transit",
        phone: "(864) 467-5000",
        address: "Greenville Transit Center",
        websiteUrl: "https://greenvillesc.gov/150/Greenlink-Transit",
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
    careersUrl: "https://www.indeed.com/jobs?q=warehouse+logistics&l=Charleston%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=framing+carpentry&l=Charleston%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=welder+metal+fabrication&l=Charleston%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=waste+route+driver+helper&l=North+Charleston%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=maintenance+technician&l=Columbia%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=concrete+paving+laborer&l=Columbia%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=warehouse+order+selector&l=West+Columbia%2C+SC",
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
    careersUrl: "https://www.indeed.com/jobs?q=commercial+landscaping&l=Columbia%2C+SC",
    felonyPolicy: "Fair-Chance. Prior experience valued; positive attitude required.",
    benefits: "Overtime in peak season, equipment training, reliable year-round work",
    immediateContact: "Capital City Operations Manager • (803) 555-0244"
  },
  {
    company: "CMC Steel South Carolina",
    location: "Cayce & Columbia, SC",
    region: "columbia",
    industries: ["Steel Manufacturing", "Industrial Operations", "Material Handling"],
    roles: ["Mill Operator Trainee", "Material Handler", "Overhead Crane Helper"],
    payRate: "$19.00 – $24.50 / hr",
    shift: "Day Shift (7:00 AM – 3:30 PM)",
    careersUrl: "https://www.cmc.com/en-us/careers",
    felonyPolicy: "Fair-Chance. Values industrial work ethic, safety compliance, and team reliability.",
    benefits: "Comprehensive Medical, 401(k), Safety Gear and Steel-Toe Boots Provided",
    immediateContact: "CMC Steel Midlands HR • (803) 794-0200"
  },
  {
    company: "Schneider Electric Columbia Facility",
    location: "Columbia & Richland County, SC",
    region: "columbia",
    industries: ["Electrical Manufacturing", "Assembly", "Logistics"],
    roles: ["Electro-Mechanical Assembler", "Warehouse Associate", "Shipping Specialist"],
    payRate: "$18.50 – $22.50 / hr",
    shift: "1st Shift (6:30 AM – 3:00 PM)",
    careersUrl: "https://www.se.com/us/en/about-us/careers/overview.jsp",
    felonyPolicy: "Equal opportunity and second-chance advocate for motivated workers.",
    benefits: "Full healthcare from day 1, tuition support, career advancement pathways",
    immediateContact: "Schneider Columbia Talent Acquisition"
  },
  {
    company: "ProLogistix / ResourceMFG Midlands",
    location: "Columbia (Fernandina Rd) & West Columbia, SC",
    region: "columbia",
    industries: ["Logistics", "Distribution", "Manufacturing"],
    roles: ["Forklift Operator", "Order Puller", "Machine Operator"],
    payRate: "$17.50 – $21.50 / hr",
    shift: "1st & 2nd Shifts Available (Curfew-friendly schedules)",
    careersUrl: "https://www.resourcemfg.com/locations/columbia-sc/",
    felonyPolicy: "Fair-Chance Partner. Matches jobseekers based on skills, reliability, and safety record.",
    benefits: "Weekly pay, free online skills courses, medical/dental benefits",
    immediateContact: "ProLogistix Columbia Branch • (803) 798-1700"
  },
  {
    company: "Automation Personnel Services - Columbia",
    location: "Columbia (Bush River Rd corridor), SC",
    region: "columbia",
    industries: ["Light Industrial", "Packaging", "Assembly"],
    roles: ["Packaging Technician", "Assembly Specialist", "Warehouse Stager"],
    payRate: "$16.50 – $20.00 / hr",
    shift: "Day Shift (7:00 AM – 3:30 PM)",
    careersUrl: "https://apstemps.com/branch-columbia-sc/",
    felonyPolicy: "Active second-chance staffing partner. Backgrounds evaluated individually.",
    benefits: "Direct deposit, health benefits, holiday and vacation pay",
    immediateContact: "Automation Personnel Recruiting Team • (803) 798-8841"
  },
  {
    company: "Luttrell Staffing Group - Columbia",
    location: "Columbia (SOCO BullStreet) & Cayce, SC",
    region: "columbia",
    industries: ["Manufacturing", "Warehouse", "Distribution"],
    roles: ["Production Assembler", "Shipping/Receiving Clerk", "Material Handler"],
    payRate: "$17.00 – $21.00 / hr",
    shift: "1st Shift (Daytime)",
    careersUrl: "https://www.luttrellstaffing.com/columbia-sc/",
    felonyPolicy: "Fair-Chance employer. Focuses on punctuality, attitude, and job readiness.",
    benefits: "Weekly pay, direct deposit, safety recognition awards",
    immediateContact: "Luttrell Staffing Columbia • (803) 626-0311 • wayala@lstaff.com"
  },
  {
    company: "Onin Staffing West Columbia",
    location: "West Columbia & Sunset Blvd Industrial Hub, SC",
    region: "columbia",
    industries: ["Logistics", "Food Processing", "Assembly"],
    roles: ["Order Selector", "General Warehouse Teammate", "Machine Feeder"],
    payRate: "$16.50 – $20.50 / hr",
    shift: "1st Shift (6:30 AM – 3:00 PM)",
    careersUrl: "https://www.oninstaffing.com/",
    felonyPolicy: "The Onin Group Teammate-first philosophy with fair-chance opportunities.",
    benefits: "$5 copay health plan, dental, vision, free teledoctor, scholarship programs",
    immediateContact: "Onin Staffing West Columbia • (803) 667-4676"
  },
  {
    company: "Spherion Staffing & Recruiting Midlands",
    location: "Lexington & Columbia, SC",
    region: "columbia",
    industries: ["Distribution", "Packaging", "Light Manufacturing"],
    roles: ["Distribution Center Associate", "Quality Inspection Helper", "Assembly Worker"],
    payRate: "$17.50 – $22.00 / hr",
    shift: "Day Shift (7:00 AM – 3:30 PM)",
    careersUrl: "https://www.spherion.com/our-offices/columbia_1183/",
    felonyPolicy: "Second-chance supportive. Individualized evaluations.",
    benefits: "Weekly pay, training incentives, path to permanent placement",
    immediateContact: "Spherion Lexington/Columbia Office • (803) 772-4915"
  },
  {
    company: "HireQuest Direct Columbia & West Columbia",
    location: "Columbia (Laurel St) & West Columbia (12th St), SC",
    region: "columbia",
    industries: ["Construction Trades", "General Labor", "Event Logistics"],
    roles: ["Construction Helper", "Commercial Site Prep Laborer", "Material Mover"],
    payRate: "$16.00 – $21.00 / hr",
    shift: "Day Shifts / Early Morning Dispatch (6:00 AM)",
    careersUrl: "https://hirequestdirect.com/columbia-sc/",
    felonyPolicy: "Fair-chance dispatch for construction, demolition, and industrial cleanup.",
    benefits: "Daily or weekly pay options, safety equipment provided",
    immediateContact: "HireQuest Columbia • (803) 256-3330 • columbiasc@hirequestdirect.com"
  },
  {
    company: "PeopleReady Midlands",
    location: "Columbia (Millwood Ave), SC",
    region: "columbia",
    industries: ["Industrial", "Warehousing", "Skilled Trades"],
    roles: ["General Laborer", "Warehouse Associate", "Construction Gate Flagger"],
    payRate: "$16.50 – $20.00 / hr",
    shift: "Day Shift Dispatch (Flexible days)",
    careersUrl: "https://locations.peopleready.com/columbia-sc-1304",
    felonyPolicy: "Fair-Chance. Connects motivated workers to immediate local assignments.",
    benefits: "JobStack mobile app dispatch, fast pay cards, referral bonuses",
    immediateContact: "PeopleReady Columbia • (803) 256-5544"
  },
  {
    company: "Condustrial Inc Midlands",
    location: "West Columbia (Sunset Blvd), SC",
    region: "columbia",
    industries: ["Skilled Industrial", "Trades", "Machining"],
    roles: ["Industrial Assembly Helper", "Carpentry Helper", "Concrete Laborer"],
    payRate: "$17.50 – $23.00 / hr",
    shift: "Day Shift (7:00 AM – 3:30 PM)",
    careersUrl: "http://www.condustrial.com/",
    felonyPolicy: "Fair-chance employer supporting re-entry trade careers.",
    benefits: "Safety training, tool programs, high placement retention",
    immediateContact: "Condustrial Hiring Office • (803) 454-0340 • info@condustrial.com"
  },
  {
    company: "SC Works Midlands Career Center",
    location: "Columbia (Taylor St), SC",
    region: "columbia",
    industries: ["State Workforce", "Apprenticeships", "Direct Placements"],
    roles: ["Registered Apprenticeship Trainee", "WIOA On-the-Job Training Placements"],
    payRate: "$17.00 – $24.00 / hr (Varies by employer partner)",
    shift: "Standard business & industrial shifts",
    careersUrl: "http://www.scworksmidlands.org/",
    felonyPolicy: "State workforce agency with specialized justice-impacted workforce navigators & Federal Bonding.",
    benefits: "No-cost certifications, paid on-the-job training, supportive transit grants",
    immediateContact: "SC Works Midlands • (803) 737-5627"
  },

  // Spartanburg, Greenville & Upstate Employers
  {
    company: "Piedmont Distribution & Cold Storage",
    location: "Spartanburg & Duncan, SC",
    region: "spartanburg",
    industries: ["Logistics", "Cold Storage", "Forklift"],
    roles: ["Stand-Up Forklift Driver", "Receiving Clerk", "Freight Handler"],
    payRate: "$18.00 – $22.50 / hr",
    shift: "Day Shift (6:00 AM – 2:30 PM)",
    careersUrl: "https://www.indeed.com/jobs?q=forklift+distribution&l=Spartanburg%2C+SC",
    felonyPolicy: "Second-Chance Employer. Drug screen & identity verification required.",
    benefits: "Freezer suits/thermal PPE provided, annual safety bonus",
    immediateContact: "Piedmont Distribution HR • (864) 555-0182"
  },
  {
    company: "Milliken & Company - Spartanburg Plants",
    location: "Spartanburg, SC",
    region: "spartanburg",
    industries: ["Advanced Materials", "Manufacturing", "Textiles"],
    roles: ["Production Specialist", "Machine Operator", "Material Stager"],
    payRate: "$18.50 – $23.00 / hr",
    shift: "Day Shift Available (7:00 AM – 3:30 PM)",
    careersUrl: "https://milliken.com/careers",
    felonyPolicy: "Fair-chance supportive employer with local workforce partners.",
    benefits: "Full health/vision/dental, on-the-job machine certifications, retirement plan",
    immediateContact: "Milliken Spartanburg Workforce Office"
  },
  {
    company: "Adidas Spartanburg Distribution Campus",
    location: "Spartanburg & Roebuck, SC",
    region: "spartanburg",
    industries: ["Warehousing", "Logistics", "Forklift"],
    roles: ["Warehouse Associate", "Reach Truck Operator", "Inbound Unloader"],
    payRate: "$18.00 – $21.50 / hr",
    shift: "1st Shift (6:30 AM – 3:00 PM)",
    careersUrl: "https://careers.adidas-group.com",
    felonyPolicy: "Fair-chance hiring initiatives with case-by-case evaluation.",
    benefits: "Climate-controlled facility, employee merchandise discounts, safety incentives",
    immediateContact: "Adidas Logistics Recruiting Desk"
  },
  {
    company: "Contec, Inc. Manufacturing",
    location: "Spartanburg, SC",
    region: "spartanburg",
    industries: ["Cleanroom Manufacturing", "Packaging", "Precision Assembly"],
    roles: ["Cleanroom Operator", "Packaging Technician", "Inventory Specialist"],
    payRate: "$17.50 – $21.00 / hr",
    shift: "Day Shift (7:00 AM – 3:30 PM)",
    careersUrl: "https://contecinc.com/careers",
    felonyPolicy: "Values commitment, attention to detail, and accountability.",
    benefits: "Clean modern work environment, comprehensive benefits package",
    immediateContact: "Contec Spartanburg HR"
  },
  {
    company: "BMW Tier-1 Automotive Assembly Partners (MAU / Magna)",
    location: "Spartanburg & Greer, SC",
    region: "spartanburg",
    industries: ["Automotive Manufacturing", "Assembly", "Forklift"],
    roles: ["Automotive Assembly Associate", "Logistics Tugger Driver", "Sub-Assembly Tech"],
    payRate: "$19.50 – $25.00 / hr",
    shift: "Day Shift (6:30 AM – 3:00 PM)",
    careersUrl: "https://www.mau.com/bmw",
    felonyPolicy: "Fair-chance employer with pathways into permanent automotive manufacturing.",
    benefits: "Overtime pay, comprehensive medical/dental, paid holidays",
    immediateContact: "MAU Greer/Spartanburg Recruiting Center • (864) 555-0155"
  },
  {
    company: "Upstate Precision Manufacturing",
    location: "Greenville & Greer, SC",
    region: "greenville",
    industries: ["Manufacturing", "Automotive Parts", "Machining"],
    roles: ["CNC Machine Operator Trainee", "Quality Inspector", "Material Handler"],
    payRate: "$18.50 – $23.00 / hr",
    shift: "1st & 2nd Shifts Available",
    careersUrl: "https://www.indeed.com/jobs?q=manufacturing+machine+operator&l=Greenville%2C+SC",
    felonyPolicy: "Fair-chance partner with local re-entry initiatives.",
    benefits: "401(k) match, medical/vision/dental, on-the-job machine training",
    immediateContact: "Upstate Manufacturing Recruiter • (864) 555-0164"
  },
  {
    company: "Foothills Structural Steel & Welding",
    location: "Greenville (Donaldson Center), SC",
    region: "greenville",
    industries: ["Structural Steel", "Welding", "Heavy Manufacturing"],
    roles: ["Welder Apprentice", "Structural Steel Fitter Helper", "Overhead Crane Operator"],
    payRate: "$19.50 – $26.00 / hr",
    shift: "7:00 AM – 3:30 PM (M–F)",
    careersUrl: "https://www.indeed.com/jobs?q=structural+welder&l=Greenville%2C+SC",
    felonyPolicy: "Fair-Chance. Hires individuals seeking career growth in skilled trades.",
    benefits: "Apprenticeship certification path, tool stipend, comprehensive medical",
    immediateContact: "Foothills Steel Plant Supervisor • (864) 555-0195"
  }
];

module.exports = {
  SC_COMMUNITY_RESOURCES,
  SC_FAIR_CHANCE_EMPLOYERS
};
