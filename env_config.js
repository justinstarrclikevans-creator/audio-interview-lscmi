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

/**
 * Centralized Cost-Controlled Gemini Model & Budget Helpers
 * - Heavy audio transcription: gemini-3.8-flash with thinkingBudget: 0 (accurate verbatim transcripts without thinking-token cost bloat)
 * - Structured feedback / scoring / auditing: gemini-3.8-flash with capped thinkingBudget: 1024 (replaces ~10x pricier pro-preview)
 * - Live per-turn Q&A, dynamic probes & chat: gemini-3.5-flash-lite (zero thinking-token overhead, lowest cost per call)
 * - Daily circuit breaker: GEMINI_DAILY_CALL_CAP (default 250 calls/day UTC) prevents runaway loops or unexpected bills.
 */
const os = require('os');
const BUDGET_STATE_PATH = path.join(os.tmpdir(), 'turn90_gemini_daily_budget.json');

function getDailyCallCap() {
    const raw = parseInt(process.env.GEMINI_DAILY_CALL_CAP || '250', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 250;
}

function getEvalModelName() {
    return (process.env.GEMINI_EVAL_MODEL || 'gemini-3.8-flash').trim();
}

function getTranscribeModelName() {
    return (process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.8-flash').trim();
}

function getFastModelName() {
    return (process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite').trim();
}

function readBudgetState() {
    const today = new Date().toISOString().slice(0, 10);
    try {
        if (fs.existsSync(BUDGET_STATE_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(BUDGET_STATE_PATH, 'utf8'));
            if (parsed && parsed.date === today) return parsed;
        }
    } catch (e) { /* ignore corrupt temp file */ }
    return { date: today, count: 0, byTag: {} };
}

function assertWithinDailyGeminiCap(tag = 'general') {
    const cap = getDailyCallCap();
    const state = readBudgetState();
    if (state.count >= cap) {
        throw new Error(
            `Daily Gemini safety cap reached (${state.count}/${cap} calls on ${state.date}). ` +
            `Raise GEMINI_DAILY_CALL_CAP in .env/Render if you intentionally need more volume today.`
        );
    }
    state.count += 1;
    state.byTag[tag] = (state.byTag[tag] || 0) + 1;
    try {
        fs.writeFileSync(BUDGET_STATE_PATH, JSON.stringify(state));
    } catch (e) { /* non-fatal */ }
    return state;
}

function getGeminiBudgetStatus() {
    const state = readBudgetState();
    return {
        date: state.date,
        calls_today: state.count,
        daily_cap: getDailyCallCap(),
        eval_model: getEvalModelName(),
        transcribe_model: getTranscribeModelName(),
        fast_model: getFastModelName(),
        by_tag: state.byTag
    };
}

function buildBudgetGenerationConfig({
    role = 'eval',
    temperature,
    maxOutputTokens,
    responseMimeType
} = {}) {
    const cfg = {};
    if (typeof temperature === 'number') cfg.temperature = temperature;
    if (responseMimeType) cfg.responseMimeType = responseMimeType;

    const modelName = role === 'transcribe'
        ? getTranscribeModelName()
        : (role === 'fast' ? getFastModelName() : getEvalModelName());

    if (typeof maxOutputTokens === 'number') {
        cfg.maxOutputTokens = maxOutputTokens;
    } else if (role === 'fast') {
        cfg.maxOutputTokens = 1024;
    } else if (role === 'transcribe') {
        cfg.maxOutputTokens = 32768;
    } else {
        cfg.maxOutputTokens = 16384;
    }

    // Apply thinkingBudget caps on Gemini 3.x non-lite models to prevent runaway reasoning-token costs
    if (!modelName.includes('lite') && (modelName.includes('gemini-3') || modelName.includes('gemini-2.5'))) {
        if (role === 'transcribe') {
            cfg.thinkingConfig = { thinkingBudget: 0 };
        } else if (role === 'eval') {
            cfg.thinkingConfig = { thinkingBudget: 1024 };
        }
    }
    return cfg;
}

module.exports = {
    sanitizeApiKey,
    getGeminiApiKey,
    assertValidGeminiApiKey,
    getEvalModelName,
    getTranscribeModelName,
    getFastModelName,
    assertWithinDailyGeminiCap,
    getGeminiBudgetStatus,
    buildBudgetGenerationConfig
};
