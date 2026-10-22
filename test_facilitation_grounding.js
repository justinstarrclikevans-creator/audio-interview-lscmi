const assert = require('assert');
const { 
    filterHallucinatedQuotes, 
    detectLessonModuleFromTranscript, 
    getFacilitatorScoringContext,
    KNOWN_CENTER_STAFF
} = require('./facilitation_evaluator');

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
        [02:15] Facilitator: Today we are diving into Module 5: Problem Solving.
        [02:40] Facilitator: We are going to look at how we generate multiple choices when we're in a pinch instead of jumping to the first impulse.
        [15:00] Participant: Like when someone cuts you off in traffic.
        [15:10] Facilitator: Exactly. What are three things you can do?
    `;
    const detectedA = detectLessonModuleFromTranscript(transcriptMod5);
    assert.strictEqual(detectedA.moduleNumber, 5, `Expected Module 5 but got Module ${detectedA.moduleNumber}`);
    assert.ok(detectedA.moduleTitle.toLowerCase().includes('problem solving'), 'Expected title to mention Problem Solving');
    console.log('✅ Case A Passed: Correctly detected Module 5 (Problem Solving).');

    // Case B: Homework check of old module followed by new module
    const transcriptHWCheck = `
        [01:00] Facilitator: Before we start today's lesson, let's do a fast check on yesterday's Module 2 Stop Signs worksheet.
        [03:00] Participant: I had a physical stop sign when my heart started pounding at the grocery store.
        [04:00] Facilitator: Good awareness. Turn that in for points.
        [05:30] Facilitator: Today's main class is Module 4: Interpersonal Communication and Clear Listening.
        [06:00] Facilitator: We are practicing how to listen without interrupting and how our body language sends messages.
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

    console.log('\n======================================================');
    console.log('ALL FACILITATION GROUNDING TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('Test failed with error:', err.message);
    process.exit(1);
});
