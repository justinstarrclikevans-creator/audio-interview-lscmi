// Splits long classroom recordings into short mono MP3 chunks so each chunk can be
// transcribed in full. Transcribing a 1-3 hour file in a single model call causes the
// model to skip large stretches or stop early, which produced truncated transcripts.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { /* optional */ }

const DEFAULT_CHUNK_SECONDS = 600; // 10 minutes

function isChunkingAvailable() {
    return !!(ffmpegPath && fs.existsSync(ffmpegPath));
}

/**
 * @returns {Promise<{chunks: Array<{path: string, offsetSec: number}>, dir: string}>}
 */
function splitAudioToChunks(inputPath, chunkSeconds = DEFAULT_CHUNK_SECONDS) {
    return new Promise((resolve, reject) => {
        if (!isChunkingAvailable()) {
            return reject(new Error('ffmpeg binary is not available on this host.'));
        }
        const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'turn90_chunks_'));
        const outPattern = path.join(dir, 'chunk_%03d.mp3');
        const args = [
            '-y', '-v', 'error',
            '-i', inputPath,
            '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
            '-f', 'segment',
            '-segment_time', String(chunkSeconds),
            '-reset_timestamps', '1',
            outPattern
        ];
        execFile(ffmpegPath, args, { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 }, (err, stdout, stderr) => {
            if (err) {
                cleanupChunks(dir);
                return reject(new Error(`ffmpeg failed to split audio: ${(stderr || err.message || '').toString().slice(0, 400)}`));
            }
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
                .sort();
            if (files.length === 0) {
                cleanupChunks(dir);
                return reject(new Error('ffmpeg produced no audio chunks (file may contain no audio track).'));
            }
            const chunks = files.map((f, i) => ({ path: path.join(dir, f), offsetSec: i * chunkSeconds }));
            resolve({ chunks, dir });
        });
    });
}

function cleanupChunks(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

module.exports = { splitAudioToChunks, cleanupChunks, isChunkingAvailable, DEFAULT_CHUNK_SECONDS };
