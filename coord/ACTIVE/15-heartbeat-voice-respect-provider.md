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

## TT1 pre-read notes — [tt1 · 2026-04-25T01:05]

Source-verified TT2's fix shape before I draft. Landing direction is correct; four small
corrections to incorporate into the actual commit.

### Verified against current source

- **Line numbers:** `ipc-handlers.js:616` is the handler opener; `:648` is the actual
  `await callEdgeTTS(verb, voice, outPath)` call (TT2's `:604,:616` was approximate —
  immaterial since the diff lands on the whole block).
- **`callOpenAITTS` signature:** `(apiKey, input, voice, outPath)` at `main.js:814`.
  Matches TT2's test stub positionally. ✓
- **`heartbeatInFlight` guard** at `:615` / `:634`: single-flight latch. Fix must keep
  the latch set across BOTH provider attempts, reset only in `finally`. TT2's
  `if (!(await trySynth(first))) { await trySynth(second); }` pattern preserves this if
  the `try/finally` at `:634-:659` wraps it.
- **UI contract** at `app/index.html:203`: confirmed — promises heartbeat plays in
  OpenAI's voice when "Prefer OpenAI" is on.

### Corrections to TT2's fix shape

1. **`apiKeyStore.get()` is SYNC, not async.** Verified at `ipc-handlers.js:349, :372`
   (both existing call sites use `const k = apiKeyStore.get()`). TT2's shape used
   `const apiKey = await apiKeyStore.get()` — harmless (await on a non-Promise
   resolves to the value) but inconsistent with the rest of the file. Drop the await.

2. **Voice-key choice design call — `edge_clip` vs `edge_response`.** TT2's shape uses
   `edge_clip || edge_response` (+ openai symmetric). Current shipped code uses
   `edge_response` unconditionally for heartbeats. Users who've tuned `edge_response`
   have been hearing heartbeats in it; switching to `edge_clip` post-fix will change
   their heartbeat voice even if they didn't change Settings. Two valid positions:
   - **TT2's (semantic correctness):** heartbeats are short ephemeral clips → use clip
     voice. Aligns with the Settings panel "Clip voice" dropdown's semantic group.
   - **Alternative (behavioural stability):** preserve `edge_response` first, fall back
     to `edge_clip`, keep existing listeners' voice consistent.

   **TT1 decision:** TT2's is correct. The current use of `edge_response` for
   heartbeats is itself a bug of the same class (wrong voice key, same way the provider
   branch is missing). Fixing both in one commit is cleaner than splitting. Worth
   noting in the commit body so users who notice a voice change post-update have a
   documented "why".

3. **Observability — log the provider + voice chosen.** Consistent with #6 Batch 1's
   philosophy: the existing `diag('heartbeat: "${verb}" → ${filename}")` line should
   extend to include `provider=${first} voice=${voice}`. Makes post-fix live behaviour
   visible in `_toolbar.log` without any extra observation plumbing. Very small — one
   diag-line change.

4. **Error handling on synth-throw.** TT2's `trySynth` swallows with `catch { return
   false; }` — no diag. Current heartbeat code doesn't log synth errors either
   (fire-and-forget ephemeral clip semantics), so matching that is fine. BUT: if both
   providers fail in sequence, the user hears nothing and has no log trace. Suggest:
   `catch (e) { diag(`heartbeat: ${which} synth failed: ${e.message}`); return false; }`
   — 2 lines, only fires on actual failure (not on the normal first-try-edge path).

### Test-suite additions beyond TT2's 3

TT2's 3 tests cover edge-first, openai-first, openai→edge fallback. Two blind spots
worth adding:

- **Test 4 — provider=openai + no API key → edge used.** If key is missing,
  `trySynth('openai')` returns false immediately; handler must still produce a clip via
  edge. Protects against the regression "OpenAI preferred but key revoked/missing".
- **Test 5 — heartbeat_enabled=false short-circuits BEFORE any synth.** Existing
  `:633` check. Easy to accidentally reorder when adding provider logic; guard
  explicitly with an assert that `callEdgeTTS` + `callOpenAITTS` are both zero-called
  when the flag is off.

### Fix draft estimate

3 files (ipc-handlers.js + the new test block + the ACTIVE close-out). ~40 LoC in the
handler, ~120 LoC of tests (TT2's 3 + my 2). ETA 15 min actual once TT2 clears #11 and
frees my fix-drafted slot.

## Close-out checklist

- [x] Bug-class identified (UI/code contract mismatch)
- [x] File:line pointers recorded
- [x] Fix shape drafted
- [x] Regression test drop-in staged
- [x] TT1 pre-read done — 4 corrections + 2 extra tests queued
- [ ] TT1 implements fix on `fix-pass` (next fix-drafted slot after #11 merges)
- [ ] TT2 verifies RED→GREEN flip
- [ ] Devil's-advocate block filled
- [ ] Merge + close
