const { sanitizeApiKey, getGeminiApiKey, assertValidGeminiApiKey } = require('./env_config');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const fs = require('fs');
const path = require('path');

async function runTests() {
    console.log('=== TEST 1: Key Sanitization Logic ===');
    const mockKey = 'AIzaSyTestSyntheticKey1234567890abcdefghijklmnopqrstuvwxyz';

    const testCases = [
        { input: `"${mockKey}"`, expected: mockKey, desc: 'Double quotes' },
        { input: `'${mockKey}'`, expected: mockKey, desc: 'Single quotes' },
        { input: ` \t"${mockKey}"\n `, expected: mockKey, desc: 'Quotes with leading/trailing whitespace' },
        { input: `“${mockKey}”`, expected: mockKey, desc: 'Smart quotes' },
        { input: `\`${mockKey}\``, expected: mockKey, desc: 'Backticks' },
        { input: 'process.env.GEMINI_API_KEY', expected: '', desc: 'Literal placeholder' },
        { input: 'dummy_key', expected: '', desc: 'Dummy key placeholder' },
        { input: '', expected: '', desc: 'Empty string' },
        { input: null, expected: '', desc: 'Null' }
    ];

    for (const tc of testCases) {
        const result = sanitizeApiKey(tc.input);
        if (result === tc.expected) {
            console.log(`  PASS: ${tc.desc}`);
        } else {
            console.error(`  FAIL: ${tc.desc} -> Expected "${tc.expected}", got "${result}"`);
            process.exit(1);
        }
    }

    const realKey = getGeminiApiKey();
    if (!realKey) {
        console.log('\n[SKIP] No live GEMINI_API_KEY detected in .env; skipping live network tests.');
        return;
    }

    console.log('\n=== TEST 2: Real Google API Call With Raw Quoted Key ===');
    // Simulate what happens in Render when the user inputs quotes into the dashboard
    process.env.GEMINI_API_KEY = `"${realKey}"`;
    const cleanKey = getGeminiApiKey();
    console.log(`  Injected quoted key. Sanitized key length: ${cleanKey.length}`);
    
    if (cleanKey.includes('"')) {
        console.error('  FAIL: Sanitized key still contains quotes!');
        process.exit(1);
    }
    console.log('  PASS: Quotation marks successfully stripped.');

    console.log('\n=== TEST 3: Google Generative AI Connection ===');
    const genAI = new GoogleGenerativeAI(cleanKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
    const response = await model.generateContent('ping');
    console.log('  PASS: Gemini API responded successfully. Response:', response.response.text().trim().substring(0, 30));

    console.log('\n=== TEST 4: Google AI File Manager (Used in Case Management Upload) ===');
    const fileManager = new GoogleAIFileManager(cleanKey);
    const tempFile = path.join(__dirname, 'test_sample_audio.txt');
    fs.writeFileSync(tempFile, 'Sample audio content for file manager verification.');
    
    try {
        const uploadResult = await fileManager.uploadFile(tempFile, {
            mimeType: 'text/plain',
            displayName: 'Test_CM_Upload'
        });
        console.log('  PASS: File upload succeeded! File URI:', uploadResult.file.uri);
        
        // Clean up from Google servers
        await fileManager.deleteFile(uploadResult.file.name);
        console.log('  PASS: Remote file cleanup succeeded.');
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }

    console.log('\n=== TEST 5: Assertion Error on Empty / Invalid Key ===');
    process.env.GEMINI_API_KEY = 'process.env.GEMINI_API_KEY';
    try {
        assertValidGeminiApiKey();
        console.error('  FAIL: assertValidGeminiApiKey should have thrown!');
        process.exit(1);
    } catch (e) {
        console.log('  PASS: Threw informative error:', e.message.substring(0, 60) + '...');
    }

    // Restore valid key
    process.env.GEMINI_API_KEY = realKey;
    console.log('\n ALL TESTS PASSED SUCCESSFULLY! Key sanitization firewall is airtight.');
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
