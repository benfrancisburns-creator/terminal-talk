# ACTIVE #15 — heartbeat clips must respect `tts_provider`

- **Status:** bug-confirmed, test drop-in staged (RED pending implementation)
- **Owner:** tt2 (test drafter), TT1 (fix drafter when they pick it up)
- **Axes in play:** 1 (correctness)
- **Opened:** 2026-04-24T23:45 (surfaced by #12 audit)
- **Bug class:** UI/code contract mismatch — UI promises behaviour the code doesn't implement

## Bug statement

`app/lib/ipc-handlers.js:604,:616` — the `speak-heartbeat` IPC handler always calls
`callEdgeTTS(verb, voice, outPath)` regardless of `cfg.playback.tts_provider`. There is no
OpenAI branch, no fallback, and the "clip" voice (`voices.edge_clip` / `voices.openai_clip`) is
not consulted — it uses `voices.edge_response` instead.

**UI contract** (`app/index.html:203`):
> *"On — OpenAI is your primary voice: every response, tool narration and heartbeat plays in
> OpenAI's voice."*

**Reality:** heartbeats always play in edge-tts voice. User toggles "Prefer OpenAI" ON,
heartbeats still play in edge. Direct contradiction.

## Empirical proof from Ben's live config

Earlier in this session we parsed Ben's `~/.terminal-talk/config.json`. `playback.tts_provider`
is either `edge` or `openai`. Regardless, the heartbeat-generation path has no code reachable
from the `openai` branch — verified by grep:

```
$ grep -n 'openai' app/lib/ipc-handlers.js | grep -i 'heartbeat\|speak-heartbeat'
(no output)
```

## Code-inspection evidence

```js
ipcMain.handle('speak-heartbeat', async (_e, verb, sessionShort) => {
  // ... validation ...
  const cfg = getCFG();
  if (cfg && cfg.heartbeat_enabled === false) return false;
  const voice = (cfg && cfg.voices && cfg.voices.edge_response) || 'en-GB-RyanNeural';
  const filename = `${ts}-H-0001-${sessionShort}.mp3`;
  const outPath = path.join(QUEUE_DIR, filename);
  await callEdgeTTS(verb, voice, outPath);                  // ← ALWAYS edge
  // no else, no fallback, no provider check
});
```

## Fix shape

Mirror `synth_turn.py::_synthesize_sentence` at `:949-1028` which correctly branches on
`provider`. In JS:

```js
const voices = cfg.voices || {};
const provider = String(((cfg.playback || {}).tts_provider) || 'edge').toLowerCase();
const edgeVoice   = voices.edge_clip   || voices.edge_response   || 'en-GB-RyanNeural';
const openaiVoice = voices.openai_clip || voices.openai_response || 'shimmer';
const apiKey = await apiKeyStore.get();   // existing helper

async function trySynth(which) {
  if (which === 'openai') {
    if (!apiKey) return false;
    try { await callOpenAITTS(apiKey, verb, openaiVoice, outPath); return true; }
    catch { return false; }
  }
  try { await callEdgeTTS(verb, edgeVoice, outPath); return true; }
  catch { return false; }
}

const first = provider === 'openai' ? 'openai' : 'edge';
const second = first === 'openai' ? 'edge' : 'openai';
if (!(await trySynth(first))) { await trySynth(second); }
```

Uses `voices.edge_clip` / `voices.openai_clip` — this is ALSO what the Settings panel's
"Clip voice" dropdown writes (confirmed in `settings-form.js:326, 328`). Closes G-V5 as a
side-effect.

## Regression test drop-in (tt2 · staged for TT1's fix commit)

```js
// scripts/run-tests.cjs — add near the other voice-routing tests
describe('HEARTBEAT VOICE ROUTING respects tts_provider', () => {
  const path = require('path');
  const ipcHandlersModule = require(
    path.join(__dirname, '..', 'app', 'lib', 'ipc-handlers.js')
  );
  // Helper: stub an ipcMain that just captures handle registrations.
  const makeStubIpc = () => {
    const handlers = {};
    return { handle: (ch, fn) => { handlers[ch] = fn; }, handlers };
  };

  it('fires callEdgeTTS when tts_provider=edge + valid API key', async () => {
    const edgeCalls = [], openaiCalls = [];
    const ipc = makeStubIpc();
    ipcHandlersModule.createIpcHandlers({
      ipcMain: ipc,
      getCFG: () => ({
        voices: { edge_clip: 'en-GB-SoniaNeural', openai_clip: 'alloy',
                  edge_response: 'en-GB-RyanNeural', openai_response: 'onyx' },
        playback: { tts_provider: 'edge' },
        heartbeat_enabled: true,
      }),
      callEdgeTTS: async (v, voice, p) => { edgeCalls.push({ v, voice, p }); },
      callOpenAITTS: async (k, v, voice, p) => { openaiCalls.push({ voice }); },
      apiKeyStore: { get: async () => 'sk-fake' },
      QUEUE_DIR: '/tmp/qd',
      // ... other deps minimally stubbed
    });
    await ipc.handlers['speak-heartbeat'](null, 'Musing', 'aef91e8e');
    assertEqual(edgeCalls.length, 1, 'edge called once');
    assertEqual(openaiCalls.length, 0, 'openai NOT called');
    assertEqual(edgeCalls[0].voice, 'en-GB-SoniaNeural', 'uses voices.edge_clip');
  });

  it('fires callOpenAITTS first when tts_provider=openai + API key', async () => {
    /* symmetric: assert openaiCalls[0].voice === 'alloy' (= voices.openai_clip) */
  });

  it('falls back to edge when openai synth throws', async () => {
    /* inject callOpenAITTS that throws; assert edge got the call after */
  });
});
```

## Close-out checklist

- [x] Bug-class identified (UI/code contract mismatch)
- [x] File:line pointers recorded
- [x] Fix shape drafted
- [x] Regression test drop-in staged
- [ ] TT1 implements fix on `fix-pass` (dedicated branch per blast-radius discipline)
- [ ] TT2 verifies RED→GREEN flip
- [ ] Devil's-advocate block filled
- [ ] Merge + close
