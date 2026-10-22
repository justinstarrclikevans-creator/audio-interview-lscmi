const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Safe dotenv loader that searches multiple common locations
const prospectivePaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', 'email-settings.txt'),
    path.join(process.cwd(), 'email-settings.txt')
];

for (const envPath of prospectivePaths) {
    if (fs.existsSync(envPath)) {
        try {
            dotenv.config({ path: envPath });
        } catch (e) {
            // Non-fatal if a specific file cannot be read
        }
    }
}

/**
 * Strips surrounding quotation marks (single, double, backtick, smart quotes),
 * carriage returns, newlines, and leading/trailing whitespace.
 * Also flags dummy placeholders copied from sample code.
 */
function sanitizeApiKey(key) {
    if (!key) return '';
    let cleaned = String(key).trim();

    // Strip wrapping single/double quotes, backticks, or smart quotes
    cleaned = cleaned.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim();

    // Catch common dummy / literal placeholder values
    const placeholders = [
        'process.env.gemini_api_key',
        'dummy_key',
        'your_api_key',
        'your_gemini_api_key',
        'undefined',
        'null'
    ];

    if (placeholders.includes(cleaned.toLowerCase()) || cleaned.length < 20) {
        return '';
    }

    return cleaned;
}

// 2. Auto-sanitize process.env.GEMINI_API_KEY in place
if (process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = sanitizeApiKey(process.env.GEMINI_API_KEY);
}

// Also sanitize DROPBOX and SKILLCAT credentials if present with quotes
if (process.env.DROPBOX_REFRESH_TOKEN) {
    process.env.DROPBOX_REFRESH_TOKEN = String(process.env.DROPBOX_REFRESH_TOKEN).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}
if (process.env.DROPBOX_APP_KEY) {
    process.env.DROPBOX_APP_KEY = String(process.env.DROPBOX_APP_KEY).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}
if (process.env.DROPBOX_APP_SECRET) {
    process.env.DROPBOX_APP_SECRET = String(process.env.DROPBOX_APP_SECRET).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

/**
 * Returns the sanitized Gemini API key, or empty string if not configured.
 */
function getGeminiApiKey() {
    if (process.env.GEMINI_API_KEY) {
        process.env.GEMINI_API_KEY = sanitizeApiKey(process.env.GEMINI_API_KEY);
        return process.env.GEMINI_API_KEY;
    }
    return '';
}

/**
 * Asserts that a valid Gemini API key is present. Throws a helpful human-readable
 * error with exact guidance if missing or invalid.
 */
function assertValidGeminiApiKey() {
    const key = getGeminiApiKey();
    if (!key) {
        throw new Error(
            "GEMINI_API_KEY is not configured or is invalid. " +
            "If using Render, please go to your Render Dashboard -> Environment Variables -> " +
            "ensure GEMINI_API_KEY is set to your Google AI Studio key WITHOUT quotes or spaces."
        );
    }
    return key;
}

module.exports = {
    sanitizeApiKey,
    getGeminiApiKey,
    assertValidGeminiApiKey
};
