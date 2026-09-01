const fs = require('fs');

const questions = require('./old_questions.json').map(q => q.text);

// We need to provide the OCR text to this script
const ocrText = `my full name is Christopher David barranco I'm born on May 7th of 1985
my current address is 200 Marabou Circle West Columbia South Carolina 29169
I have a valid driver's license
I have access to my state issued ID and my social security card
I have four convictions as a juvenile
I have a lot of convictions as a juvenile I have misdemeanors and felonies
nope
no pending charges
I was 11 years old when I was arrested and Coral Springs Florida at the age of 11 for trespassing
I've never been to prison but I have spent a lot of time and County and I was in and out of DJJ as a teenager
no
no
yes
no
10 months
2 years
no
I have an associate's degree in accounting at Midlands Technical College
yes
yes
I worked in kitchen jobs and telemarketing and sales all the way through college which I didn't graduate till I was 26 I went to college late and in my 30s I have learned how to do construction and home renovation I am a gutter installer I can do anything that comes with gutters installing them on houses commercial buildings from building the spout to maintenance on a gutter machine 5 in 6-in on how to do it just like most renovation jobs I've done such as siding Roofing I can run heavy machinery I can run a skid steer a front end loader a loader a excavator a roto chopper I've done landscape work I can install Mulch and I can manufacture mulch from scratch with the proper equipment and I can install it either with a wheelbarrow and a pitchfork or with a blower system built onto a Peterbilt truck I'm a certified forklift operator or I used to be at least I might need to get certified again not sure I'm very interested in recertifying my forklift I enjoyed doing forklift driving I've worked unloading trucks at Target Distribution Center word a lot of jobs I enjoy work that takes physical that's physically demanding I enjoy work that I feel like I earn a high pay wage yet between me and my fiancee having six kids between us she has three I have three plus in my child support was that fees out to pay to the legal side of things and I need to be able to place I live in Oxford House right now so I need a job that's going to pay enough money to do those things a lot of the jobs I've had did have people who use drugs at the job so I prefer a job that I don't have to be around anything like that cuz that's what's healthy for my sobriety
every job I've ever lost was because of my own fault relapsing which usually starts with drinking and which leads to drugs partying being late oversleeping my alarm clock a poor work performance because of stuff like that that's usually why I lose my jobs
I'm engaged to a beautiful 37-year-old Christian Queen me and her follow the lord and his will for our lives she's been in my corner through his battle against addiction and we have not set a wedding date but we're not going to move in with each other until we are married
before I met my fiance I was single for almost 3 years and that's the most growth I've had in my adult life as well I was single it was just me and God out there doing our thing so I think being single is very important for people to have some time where they can find out who they are and that's for a relationship if ever me and my fiance are toxic or unhealthy I will definitely be willing to leave the relationship because I'm aware of the benefits of being single
and my parents split up when I was 13 my mom left my dad raised me my dad died in 2015 and me and my mom are preparing our relationship me and my little brother very tight his son my nephew Zach would love him to death I'm going to rebuilding process with the relationship with all of my other relatives
I'm the criminal nobody else has criminal record
I'm not really a part of any organization as a club so I'm a part of the Oxford House family now I've been involved with the return for Christ and I've been in which is a rehab in Lexington South Carolina and I've been involved in for a long time 9 years and I've been a member of Calvary Chapel Lexington for 9 years now I have assured and serve a family dinner night matter of fact I have to go do that today
spend my free time reading my Bible working out meditating watching movies getting some rest cuz the Lord has a lot of a lot of busyness ahead of me which is fine that's great sometimes if I don't do anything with my free time I just sleep I feel unproductive but usually if I sleep and I need it and I feel satisfied from that but if I'm reading my Bible working out doing things that that make me feel better that are for my mental health then I get a lot of satisfaction a lot of healthy satisfaction for my free time
I know a lot of people that have been in trouble with the law yes very seriously and very often
I do now I surround myself now currently with people who are trying to get their lives together just like me
yes I do have people who are not involved in criminal activities because they're trying to do the right thing now and they're past that point in their life where they have decided to make changes
I'll go and drugs has plagued me since the age of 13 when I started using even before that I had to go to Al-Anon because my dad was an alcoholic so as a child even before I drink alcohol has been an enemy of mine drugs and alcohol has caused me to waste many years of my life however everybody does go on their own journey and I firmly believe that
yes I was high and drunk when I got shot in the chest and I lost half of my left lawn
yes I'm in debt right now because the decisions I made while on drugs and alcohol
I don't think I think that my family does not understand why I use or used to have an addiction because I've always they've always thought of me to have a lot of potential one I've always been able to higher standard so when I use they just don't get it because I should be doing a lot more with my life
I regret and have dealt with a lot of Shame and guilt for the crowns are committed I've had to mentally move past that that's been a process
100% think the crimes are committed were wrong
I would 100% like to continue leading a life without crime as I've already started to do so
yes I've actually gotten mercy and Grace of Jesus Christ to not get the appropriate a fair sentencing I got a lot less than I deserved Praise Jesus
I 100% had a choice of getting involved in crime I was misled as a youth and misguided and from a broken home but those are nice juices I still was making the conscious decision to do the things I was doing
yes I do believe that supervision is appropriate and affair
I recently have been assisted by psychologist yes
no I was not
yes I did
yes they did
no I do not
no I do not
I don't know I live in Oxford House I'm in recovery housing
I don't know it anyways I don't have a job right now so
I repeat I received food stamps
I am very worried about having sufficient money to pay debts I have no money and I'm in a pretty decent amount of debt over my head
I do not have a bank account unless you count PayPal PayPal is the only thing I have to do banking
my credit score last time I checked is in the 500s it's been worse but it needs to be a lot better
yes I've had a lot of phone calls from creditors
I do have existing debts I will about 3,000 500 to Landmark in Lexington I need to pay them
I don't have a personal budget yet that's only cuz I'm not receiving any money yet
when I do have a budget in place I do follow it I'm very good at that
I am very worried about sufficient income to meet my basic needs although I get a sniper from turn 90 which helps out a great deal you're not giving me wrong it is not enough
I live in Oxford House sober living situation
I like it a lot I was elected the president of the Oxford house that I live at and things are going well
agent Burgess is very reasonable
no I'm not afraid of anybody harming me
I have done that my whole life I've been working very hard to start thinking and or praying before making decisions or acting
I do set goals for myself
I do make plans
I do check to see if I'm following my plans yes
yes
no
no
not anymore and sometimes
no
yes
no
no
to me work this is being aware and mindful of I'm on West enemy only I can stop myself
`;

const answers = ocrText.split('\n').filter(l => l.trim().length > 0);

// Simple alignment based on index
let html = '<html><head><meta charset="utf-8"><style>body{font-family: sans-serif; padding: 20px;} h3{color: #2c3e50; font-size: 16px; margin-bottom: 5px;} p{color: #34495e; margin-top: 0; padding-left: 10px; border-left: 3px solid #3498db;}</style></head><body>';
html += '<h1>Interview Transcript Aligned</h1>';

for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i] || '[No answer recorded]';
    html += `<h3>Question ${i+1}: ${q}</h3>`;
    html += `<p>${a}</p>`;
}
html += '</body></html>';

fs.writeFileSync('aligned_transcript.html', html);
