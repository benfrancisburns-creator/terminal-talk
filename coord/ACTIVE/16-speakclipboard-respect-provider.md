# ACTIVE #16 — `speakClipboard` must respect `tts_provider`

- **Status:** bug-confirmed, fix shape + test drop-in staged (RED pending implementation)
- **Owner:** tt2 (test drafter), TT1 (fix drafter)
- **Axes in play:** 1 (correctness)
- **Opened:** 2026-04-24T23:45 (surfaced by #12 audit)
- **Bug class:** UI/code contract mismatch — same family as #15

## Bug statement

`app/main.js:1097-1117` — the `speakClipboard` pipeline (triggered by Ctrl+Shift+S and
"hey jarvis speak this") always tries edge-tts FIRST and only falls back to OpenAI on
edge failure. There is no branch on `cfg.playback.tts_provider`.

**UI contract** (`app/index.html:203`):
> *"On — OpenAI is your primary voice: every response, tool narration and heartbeat plays
> in OpenAI's voice. Edge-tts only runs if OpenAI errors."*

The tooltip doesn't explicitly name "highlight-to-speak" but it does say "OpenAI is your
primary voice" when the toggle is on. Highlight-to-speak is a voice-producing surface; Ben
would reasonably expect it to honour the setting. Today, with "Prefer OpenAI" ON, clipboard
reads still go through edge first.

## Code-inspection evidence

```js
// app/main.js:1097-1117
const CLIP_CONCURRENCY = 4;
const positional = await mapLimit(chunks, CLIP_CONCURRENCY, async (chunk, i) => {
  const idx = String(i + 1).padStart(2, '0');
  const edgeOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.mp3`);
  const wavOut  = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.wav`);
  try {
    await callEdgeTTS(chunk, CFG.voices.edge_clip, edgeOut);      // ← ALWAYS edge-first
    return edgeOut;
  } catch (e1) {
    if (!apiKey) return null;
    try {
      await callOpenAITTS(apiKey, chunk, CFG.voices.openai_clip, wavOut);  // ← fallback only
      return wavOut;
    } catch (e2) { return null; }
  }
});
```

No `tts_provider` check anywhere in the path.

## Fix shape

Provider-aware branch before the first call:

```js
const provider = String(((CFG.playback || {}).tts_provider) || 'edge').toLowerCase();

const positional = await mapLimit(chunks, CLIP_CONCURRENCY, async (chunk, i) => {
  const idx = String(i + 1).padStart(2, '0');
  const edgeOut = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.mp3`);
  const wavOut  = path.join(QUEUE_DIR, `${ts}-clip-${sessionTag}-${idx}.wav`);

  async function tryEdge() {
    try { await callEdgeTTS(chunk, CFG.voices.edge_clip, edgeOut); return edgeOut; }
    catch (e) { diag(`speakClipboard edge fail chunk ${idx}: ${e.message}`); return null; }
  }
  async function tryOpenAI() {
    if (!apiKey) { diag(`speakClipboard: no OpenAI key for chunk ${idx}`); return null; }
    try { await callOpenAITTS(apiKey, chunk, CFG.voices.openai_clip, wavOut); return wavOut; }
    catch (e) { diag(`speakClipboard openai fail chunk ${idx}: ${e.message}`); return null; }
  }

  if (provider === 'openai') {
    return (await tryOpenAI()) || (await tryEdge());
  }
  return (await tryEdge()) || (await tryOpenAI());
});
```

Two-line change in spirit (one provider check, one branch flip). Preserves all existing diag
logging, the mapLimit concurrency, and the positional ordering. No new deps.

## Regression test drop-in (tt2 · staged for TT1's fix commit)

```js
// scripts/run-tests.cjs — near the VOICE ROUTING group from #15
describe('SPEAKCLIPBOARD VOICE ROUTING respects tts_provider', () => {
  // Pattern: require('../app/main.js') would spawn electron; instead
  // extract the speakClipboard function into a testable surface, OR
  // test via a thin stub harness that simulates the positional call
  // site. Prefer the former — either extract into `app/lib/speak-
  // clipboard.js` as part of the fix, or export the function
  // conditionally under TT_TEST_MODE.
  // Either way, the test asserts:

  it('fires callOpenAITTS FIRST when tts_provider=openai + api key', async () => {
    // Setup:
    //   CFG.playback.tts_provider = 'openai'
    //   voices.edge_clip = 'en-GB-SoniaNeural'
    //   voices.openai_clip = 'alloy'
    //   apiKey = 'sk-fake'
    //   callOpenAITTS spy resolves; callEdgeTTS spy never throws
    // Assert:
    //   callOpenAITTS called at least once with voice='alloy'
    //   callEdgeTTS NOT called
  });

  it('fires callEdgeTTS FIRST when tts_provider=edge', async () => {
    // Symmetric: provider='edge', assert edge called first, openai not called
  });

  it('falls back to the other provider when primary fails', async () => {
    // provider='openai', callOpenAITTS throws on first chunk,
    // assert callEdgeTTS called for that chunk afterwards
  });

  it('returns null for a chunk when BOTH providers fail', async () => {
    // Both stubs throw; assert chunk result is null (not undefined, not throw)
  });
});
```

## Refactor opportunity surfaced

`speakClipboard` is 120+ lines of inline code in `main.js`. Extracting to
`app/lib/speak-clipboard.js` (factory with injected `callEdgeTTS`, `callOpenAITTS`,
`apiKeyStore`, `getCFG`) would make this + any future routing logic unit-testable without
spinning electron. Matches the pattern already used for `config-store`, `heartbeat`, `voice-
dispatch`, etc. Open #17 if TT1 agrees the extract is in scope for this fix.

## Fix/bugs-tests pairing summary

| Bug | Fix commits (TT1 lane) | Test drop-in (tt2 staged) |
|---|---|---|
| #15 heartbeat-voice ignores provider | add provider branch in `speak-heartbeat` handler | `HEARTBEAT VOICE ROUTING` describe × 3 |
| #16 speakClipboard ignores provider | add provider branch in speakClipboard; optional extract to lib module | `SPEAKCLIPBOARD VOICE ROUTING` describe × 4 |

Both close G-V1+G-V2 together; suggest landing as one commit pair (#15 first because
blast-radius is smaller; #16 can include the extract+test simultaneously).

## Close-out checklist

- [x] Bug-class identified (UI/code contract mismatch — same family as #15)
- [x] File:line pointers recorded
- [x] Fix shape drafted
- [x] Regression test drop-in shape staged (spy-based; will need a testable surface)
- [ ] TT1 implements fix (optionally with lib extract)
- [ ] TT2 verifies RED→GREEN
- [ ] Devil's-advocate filled
- [ ] Merge + close
