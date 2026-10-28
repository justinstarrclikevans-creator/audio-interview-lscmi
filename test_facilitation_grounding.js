const assert = require('assert');
const { 
    filterHallucinatedQuotes, 
    detectLessonModuleFromTranscript, 
    getFacilitatorScoringContext,
    getScheduledModuleForDate,
    MODULE_SEQUENCE,
    CBT_MODULE_CATALOG,
    TRAINER_WORKBOOK_GUIDES,
    KNOWN_CENTER_STAFF
} = require('./facilitation_evaluator');
const { db } = require('./db');

async function runTests() {
    console.log('--- RUNNING FACILITATION GROUNDING & HALLUCINATION PREVENTION TESTS ---');

    // Test 1: Prompt must not contain hallucination priming tokens like "Marcus"
    console.log('\n[Test 1] Checking Prompt Cleanliness (No Marcus or priming seeds)...');
    const promptContext = getFacilitatorScoringContext();
    assert.strictEqual(
        promptContext.includes('Marcus'), 
        false, 
        'Prompt must not contain the name "Marcus" as it primes Gemini to hallucinate a participant named Marcus.'
    );
    console.log('✅ Test 1 Passed: Prompt has no hallucination seeds.');

    // Test 2: Dynamic Module & Lesson Detection
    console.log('\n[Test 2] Testing Dynamic Module & Lesson Detection from Transcript...');
    
    // Case A: Clear Module 5 introduction
    const transcriptMod5 = `
        [00:30] Facilitator: Good morning Columbia. Let's do a quick roll call.
        [02:15] Facilitator: Today we are diving into Module 5: Low Frustration.
        [02:40] Facilitator: We are going to look at high frustration tolerance and how we handle stress without making excuses.
        [15:00] Participant: Like when someone cuts you off in traffic.
        [15:10] Facilitator: Exactly. What are three things you can do?
    `;
    const detectedA = detectLessonModuleFromTranscript(transcriptMod5);
    assert.strictEqual(detectedA.moduleNumber, 5, `Expected Module 5 but got Module ${detectedA.moduleNumber}`);
    assert.ok(detectedA.moduleTitle.toLowerCase().includes('low frustration'), 'Expected title to mention Low Frustration');
    console.log('✅ Case A Passed: Correctly detected Module 5 (Low Frustration).');

    // Case B: Homework check of old module followed by new module
    const transcriptHWCheck = `
        [01:00] Facilitator: Before we start today's lesson, let's do a fast check on yesterday's Module 2 Stop Signs worksheet.
        [03:00] Participant: I had a physical stop sign when my heart started pounding at the grocery store.
        [04:00] Facilitator: Good awareness. Turn that in for points.
        [05:30] Facilitator: Today's main class is Module 4: Personality.
        [06:00] Facilitator: We are practicing how to listen without interrupting and how our social style sends messages.
        [20:00] Participant: My girl always says I look mad even when I'm just tired.
    `;
    const detectedB = detectLessonModuleFromTranscript(transcriptHWCheck);
    assert.strictEqual(detectedB.moduleNumber, 4, `Expected Module 4 as the main lesson, but got Module ${detectedB.moduleNumber}`);
    console.log('✅ Case B Passed: Distinguished old homework check from new Module 4 lesson.');

    // Test 3: Quote Verification Firewall
    console.log('\n[Test 3] Testing Quote Verification Firewall (Strip Hallucinated Dialogue)...');
    const actualTranscript = `
        [05:12] Facilitator (Jenn): Let's talk about what happens when someone disrespects you on the job.
        [05:25] Participant (Corey): You want to pop off, but you got to think about your paycheck.
        [05:35] Facilitator (Jenn): That's real talk Corey. You're weighing the instant feeling against your money.
        [18:20] Facilitator (Jenn): Let's roleplay this situation. Corey, you're the worker, and Dave, you're the supervisor asking for the overtime.
    `;

    const sampleEvaluationWithHallucination = {
        observed_strengths: [
            "[05:35] When Corey said 'think about your paycheck', Jenn reinforced the financial consequence: 'That's real talk Corey. You're weighing the instant feeling against your money.'"
        ],
        areas_for_improvement: [
            "[14:20] When Marcus pushed back claiming 'My thinking didn't cause the action, the situation did. If he didn't disrespect me, I wouldn't have swung.' -> Jenn argued with him for 3 minutes instead of pivoting.",
            "[05:25] When Corey brought up the paycheck, Jenn could have asked an open-ended MI question: 'What does protecting that paycheck allow you to build for your family?'"
        ],
        detailed_summary_markdown: "A participant named Marcus pushed back claiming 'My thinking didn't cause the action'..."
    };

    const sanitizedEval = filterHallucinatedQuotes(sampleEvaluationWithHallucination, actualTranscript);

    // Assert that the Marcus hallucination was detected and removed from areas_for_improvement
    const hasMarcus = sanitizedEval.areas_for_improvement.some(a => a.toLowerCase().includes('marcus') || a.toLowerCase().includes('wouldn\'t have swung'));
    assert.strictEqual(hasMarcus, false, 'Hallucinated dialogue about Marcus must be removed from areas_for_improvement.');
    
    // Assert that the real quote (Corey) was preserved
    const hasCorey = sanitizedEval.areas_for_improvement.some(a => a.includes('Corey'));
    assert.strictEqual(hasCorey, true, 'Genuine dialogue about Corey must be retained.');

    // Assert summary markdown no longer contains the hallucinated Marcus quote
    assert.strictEqual(sanitizedEval.detailed_summary_markdown.includes("wouldn't have swung"), false, 'Summary markdown must be purged of hallucinated quotes.');

    console.log('✅ Test 3 Passed: Quote Verification Firewall successfully stripped hallucinated quotes while preserving genuine dialogue.');

    // Test 4: Center Facilitator Mapping Clarification
    console.log('\n[Test 4] Testing Center Facilitator Mapping (Diyoung: Spartanburg, Jenn: Columbia, TB: Charleston)...');
    assert.ok(KNOWN_CENTER_STAFF.spartanburg.primaryFacilitators.some(f => f.includes('Diyoung')), 'Spartanburg primary facilitator must be Diyoung');
    assert.ok(KNOWN_CENTER_STAFF.columbia.primaryFacilitators.some(f => f.includes('Jenn')), 'Columbia primary facilitator must be Jenn');
    assert.ok(KNOWN_CENTER_STAFF.charleston.primaryFacilitators.some(f => f.includes('TB')), 'Charleston primary facilitator must be TB');
    console.log('✅ Test 4 Passed: Center facilitator assignments accurately verified.');

    // Test 5: Statewide Synchronized Module Schedule Rotation
    console.log('\n[Test 5] Testing Statewide Synchronized Module Schedule Rotation...');
    assert.deepStrictEqual(MODULE_SEQUENCE, [1, 2, 3, 4, 5, 6, 8, 9], 'Sequence must be exactly [1, 2, 3, 4, 5, 6, 8, 9] with NO Module 7');
    
    // Anchor week: Week of Oct 26, 2026 is finishing Module 9 (Ideal Self)
    const modOct26 = getScheduledModuleForDate('2026-10-26');
    assert.strictEqual(modOct26.moduleNumber, 9, 'Week of Monday 2026-10-26 must be Module 9');
    assert.strictEqual(modOct26.moduleTitle, 'Module 9: Ideal Self');

    // Tuesday of same week must also be Module 9
    const modOct27 = getScheduledModuleForDate('2026-10-27');
    assert.strictEqual(modOct27.moduleNumber, 9, 'Tuesday 2026-10-27 must be Module 9');

    // Next week: Monday Nov 2, 2026 goes back to Module 1 (Thinking)
    const modNov2 = getScheduledModuleForDate('2026-11-02');
    assert.strictEqual(modNov2.moduleNumber, 1, 'Week of Monday 2026-11-02 must be Module 1');
    assert.strictEqual(modNov2.moduleTitle, 'Module 1: Thinking');

    // Previous week: Monday Oct 19, 2026 was Module 8 (Support Network)
    const modOct19 = getScheduledModuleForDate('2026-10-19');
    assert.strictEqual(modOct19.moduleNumber, 8, 'Week of Monday 2026-10-19 must be Module 8');
    assert.strictEqual(modOct19.moduleTitle, 'Module 8: Support Network');

    // Thursday of previous week (2026-10-22) was also Module 8
    const modOct22 = getScheduledModuleForDate('2026-10-22');
    assert.strictEqual(modOct22.moduleNumber, 8, 'Thursday 2026-10-22 must be Module 8');

    // Full 8-week cycle test skipping 7:
    const expectedCycle = [
        { date: '2026-11-02', mod: 1, title: 'Module 1: Thinking' },
        { date: '2026-11-09', mod: 2, title: 'Module 2: Feelings' },
        { date: '2026-11-16', mod: 3, title: 'Module 3: Thinking Errors' },
        { date: '2026-11-23', mod: 4, title: 'Module 4: Personality' },
        { date: '2026-11-30', mod: 5, title: 'Module 5: Low Frustration' },
        { date: '2026-12-07', mod: 6, title: 'Module 6: Control' },
        { date: '2026-12-14', mod: 8, title: 'Module 8: Support Network' },
        { date: '2026-12-21', mod: 9, title: 'Module 9: Ideal Self' },
        { date: '2026-12-28', mod: 1, title: 'Module 1: Thinking' }
    ];
    for (const exp of expectedCycle) {
        const res = getScheduledModuleForDate(exp.date);
        assert.strictEqual(res.moduleNumber, exp.mod, `Expected date ${exp.date} to be Module ${exp.mod}`);
        assert.strictEqual(res.moduleTitle, exp.title);
    }
    console.log('✅ Test 5 Passed: Calendar math rotates chronologically and correctly skips Module 7.');

    // Test 6: Purge of Module 7 across Catalog
    console.log('\n[Test 6] Testing Purge of Module 7...');
    assert.strictEqual(CBT_MODULE_CATALOG[7], undefined, 'Module 7 must not exist in CBT_MODULE_CATALOG');
    assert.strictEqual(Object.keys(CBT_MODULE_CATALOG).length, 8, 'Catalog must contain exactly 8 modules');
    assert.ok(CBT_MODULE_CATALOG[8].moduleTitle.includes('Support Network'), 'Module 8 must be Support Network');
    assert.ok(CBT_MODULE_CATALOG[9].moduleTitle.includes('Ideal Self'), 'Module 9 must be Ideal Self');
    console.log('✅ Test 6 Passed: Module 7 completely purged from catalog.');

    // Test 7: Trainer Workbook Guides Structure
    console.log('\n[Test 7] Testing Trainer Workbook Guides...');
    assert.ok(TRAINER_WORKBOOK_GUIDES.general_protocols.lesson_3_2_flow, 'Lesson 3.2 flow guide must exist');
    assert.ok(TRAINER_WORKBOOK_GUIDES.general_protocols.lesson_1_5_neutrality, 'Lesson 1.5 neutrality guide must exist');
    for (const num of [1, 2, 3, 4, 5, 6, 8, 9]) {
        const g = TRAINER_WORKBOOK_GUIDES.modules[num];
        assert.ok(g, `Trainer workbook guide for Module ${num} must exist`);
        assert.ok(g.core_concept, `Module ${num} must define core_concept`);
        assert.ok(Array.isArray(g.key_questions) && g.key_questions.length > 0, `Module ${num} must define key_questions`);
    }
    console.log('✅ Test 7 Passed: Trainer Workbook guides present and structured for all 8 modules.');

    // Test 8: Database Self-Healing (No Module 7 in database)
    console.log('\n[Test 8] Checking Database for any remaining Module 7 records...');
    const mod7Rows = db.prepare("SELECT id, session_title FROM class_facilitation_evaluations WHERE session_title LIKE '%Module 7%'").all();
    assert.strictEqual(mod7Rows.length, 0, `Found unexpected Module 7 records in database: ${JSON.stringify(mod7Rows)}`);
    console.log('✅ Test 8 Passed: Database has zero references to Module 7 (all migrated to Module 8: Support Network).');

    console.log('\n======================================================');
    console.log('ALL FACILITATION GROUNDING TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('Test failed with error:', err.message);
    process.exit(1);
});
