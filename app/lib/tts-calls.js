'use strict';

// TTS subprocess / HTTPS callers — extracted from app/main.js (2026-10-05)
// to bring main.js back under the 2725-line file-length ceiling.
//
// Two primitives, both returning a Promise that resolves to `outPath`:
//   callEdgeTTS(input, voice, outPath)        — spawns edge_tts_speak.py
//   callOpenAITTS(apiKey, input, voice, outPath) — POSTs to OpenAI speech
//
// Factory-injected deps (spawn / https / fs / pythonExe / edgeScript /
// diag) keep the module Electron-free and unit-testable. main.js creates
// one instance at boot and hands the two functions to speakClipboard,
// the IPC handlers (speak-heartbeat / test-openai-voice), the Codex
// session watcher and the footer watcher exactly as before.

const realFs = require('node:fs');
const realHttps = require('node:https');
const { spawn: realSpawn } = require('node:child_process');

// 45 s hard timeout on the Python subprocess — edge-tts can hang indefinitely
// on a stuck WebSocket / DNS wedge. Without this the Promise never resolves
// and the Python process lives forever, accumulating over hours of use
// (30-50 MB + open FDs per wedged call). Responsiveness audit R17.
const EDGE_TTS_HARD_TIMEOUT_MS = 45_000;

function createTtsCalls({
  spawn = realSpawn,
  https = realHttps,
  fs = realFs,
  pythonExe,
  edgeScript,
  diag = () => {},
  hardTimeoutMs = EDGE_TTS_HARD_TIMEOUT_MS,
} = {}) {
  if (!pythonExe) throw new Error('createTtsCalls: pythonExe required');
  if (!edgeScript) throw new Error('createTtsCalls: edgeScript required');

  function callEdgeTTS(input, voice, outPath) {
    return new Promise((resolve, reject) => {
      const proc = spawn(pythonExe, [edgeScript, voice, outPath], {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe']
      });
      let err = '';
      let settled = false;
      const killTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill('SIGKILL'); } catch {}
        diag(`edge-tts hard-timeout after ${hardTimeoutMs}ms — killed zombie spawn`);
        reject(new Error(`edge-tts timeout after ${hardTimeoutMs / 1000}s`));
      }, hardTimeoutMs);
      proc.stderr.on('data', (d) => { err += d.toString(); });
      proc.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        reject(e);
      });
      proc.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code === 0) resolve(outPath);
        else reject(new Error(`edge-tts exit ${code}: ${err.trim().slice(0, 200)}`));
      });
      proc.stdin.end(input, 'utf8');
    });
  }

  function callOpenAITTS(apiKey, input, voice, outPath) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice,
        input,
        instructions: 'Speak clearly and naturally at a moderate pace. Do not read punctuation aloud.',
        response_format: 'wav'
      });
      const req = https.request({
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/audio/speech',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body, 'utf8')
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          let errData = '';
          res.on('data', d => errData += d);
          res.on('end', () => reject(new Error(`TTS ${res.statusCode}: ${errData}`)));
          return;
        }
        const tmpPath = outPath + '.partial';
        const stream = fs.createWriteStream(tmpPath);
        res.pipe(stream);
        stream.on('finish', () => { fs.renameSync(tmpPath, outPath); resolve(outPath); });
        stream.on('error', reject);
      });
      req.on('error', reject);
      req.write(body, 'utf8');
      req.end();
    });
  }

  return { callEdgeTTS, callOpenAITTS };
}

module.exports = { createTtsCalls, EDGE_TTS_HARD_TIMEOUT_MS };
