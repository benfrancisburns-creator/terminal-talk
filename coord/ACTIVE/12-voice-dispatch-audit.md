# ACTIVE #12 — voice-routing systematic audit

- **Status:** in-test (audit delivered — 2 material bugs, 2 dead declarations)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 7 (invariant)
- **Opened:** 2026-04-24T23:45
- **Method:** code inspection + grep across all voice-consuming surfaces. No Ben interrogation.

## Contract

The `tts_provider` setting (`edge` / `openai`) is the switch. When `openai`, every TTS-producing
subsystem should try OpenAI first and fall back to edge only on failure. When `edge` (default),
every subsystem should try edge first and fall back to OpenAI only on failure. The UI tooltip
for the Prefer OpenAI toggle (`app/index.html:203`) makes this contract explicit:

> *"On — OpenAI is your primary voice: every response, tool narration and **heartbeat** plays
> in OpenAI's voice."*

The voice keys each subsystem consumes:

| Subsystem | Edge key | OpenAI key | Routing |
|---|---|---|---|
| Response body (synth_turn.py) | `voices.edge_response` | `voices.openai_response` | respects `tts_provider` |
| Heartbeat clip (ipc-handlers `speak-heartbeat`) | *(expected: `voices.edge_clip`?)* | *(expected: `voices.openai_clip`?)* | **should** respect `tts_provider` per UI |
| Highlight-to-speak (`speakClipboard`) | `voices.edge_clip` | `voices.openai_clip` | **should** respect `tts_provider` per UI |
| Tool narration (hooks/speak-on-tool.ps1) | `voices.edge_response` | `voices.openai_response` | respects `tts_provider` |
| Notification (hooks/speak-notification.ps1) | `voices.edge_response` | `voices.openai_response` | respects `tts_provider` |

## Findings

### ✗ G-V1 — Heartbeat clips ignore `tts_provider`

**Site:** `app/lib/ipc-handlers.js:604, :616`

```js
const voice = (cfg && cfg.voices && cfg.voices.edge_response) || 'en-GB-RyanNeural';
// ... then always:
await callEdgeTTS(verb, voice, outPath);
```

Heartbeats ALWAYS call `callEdgeTTS`. There's no branch on `tts_provider`, no OpenAI fallback,
and no read of `voices.edge_clip` or `voices.openai_clip`. Ben's toggle in Settings has no
effect on heartbeat voice — contradicts the UI tooltip directly.

**Also subtle:** uses `voices.edge_response` for the verb, not `voices.edge_clip`. The clip-voice
dropdown in settings claims to control this but doesn't.

**Fix shape:** introduce a dedicated path like `synth_turn.py::synthesize_parallel` — try OpenAI
first when `cfg.playback.tts_provider === 'openai'` + API key present, else edge. Use
`voices.edge_clip` / `voices.openai_clip` to honour the Clip voice dropdown.

**Regression test shape:** `describe('HEARTBEAT VOICE ROUTING')` — stub the two TTS call wrappers,
set `tts_provider='openai'` + fake key, fire `speak-heartbeat`, assert the OpenAI wrapper got
the call with `voices.openai_clip`.

### ✗ G-V2 — `speakClipboard` (highlight-to-speak) ignores `tts_provider`

**Site:** `app/main.js:1103-1117`

```js
await callEdgeTTS(chunk, CFG.voices.edge_clip, edgeOut);   // always first
// catch → callOpenAITTS(apiKey, chunk, CFG.voices.openai_clip, wavOut);  // fallback only
```

Hardcoded edge-first. When Ben has OpenAI as primary, "hey jarvis this" still goes through edge.

**Fix shape:** mirror `synth_turn.py::synthesize_parallel` — branch on `cfg.playback.tts_provider`
before the wrapper call. Provider-aware order, then the other as fallback.

**Regression test shape:** stub both wrappers, set provider='openai', invoke the speak-clipboard
IPC, assert OpenAI called first.

### ~ G-V3 — `voices.edge_question` dead declaration

**Sites:**
- Declared: `app/lib/config-validate.js:11` (RULES entry, `type: 'string', maxLen: 80`)
- Consumers: **NONE** (grep across `app/`, `hooks/`, `scripts/` returned 0 reads)
- UI writers: **NONE** (settings-form.js has no `voiceEdgeQuestion` ref)

Defaults in `app/main.js:34-40` don't even define it. The RULES entry is an orphan. Either
ship the feature (distinct voice for Claude's questions) or drop the RULES entry.

**Fix shape:** remove from RULES. Zero-risk edit; no caller depends on it.

### ~ G-V4 — `voices.edge_notification` dead declaration

**Sites:**
- Declared: `app/lib/config-validate.js:12`
- Consumers: `hooks/speak-notification.ps1:42` reads `$cfg.voices.edge_response` instead
- UI writers: NONE

Same shape as G-V3. The notification hook was apparently supposed to use `edge_notification`
but now reuses `edge_response`. Either wire the setting through or remove the declaration.

**Fix shape:** remove from RULES, and open a separate small item if Ben wants a distinct
notification voice (currently out of scope).

### ~ G-V5 — Clip voice dropdown vs heartbeat disconnect (minor)

Settings panel has "Clip voice" dropdown bound to `voices.edge_clip`. User would reasonably
expect this to affect heartbeat narration. It doesn't (G-V1). If G-V1's fix lands, G-V5 closes
as a side-effect. If G-V1 is deferred, add a Settings tooltip clarifying that Clip voice only
affects highlight-to-speak, not heartbeats — less work but more confusion.

## Summary table

| Finding | Class | Severity | Fix effort |
|---|---|---|---|
| G-V1 heartbeat ignores provider | ✗ BROKEN vs UI contract | **High** | Medium (mirror synth_turn routing) |
| G-V2 speakClipboard ignores provider | ✗ BROKEN vs UI contract | **High** | Small (2-branch conditional) |
| G-V3 edge_question dead | ~ drift | Low | Trivial (remove 1 line) |
| G-V4 edge_notification dead | ~ drift | Low | Trivial (remove 1 line) |
| G-V5 Clip voice ↔ heartbeat UX | ~ UX ambiguity | Low | Closes with G-V1 |

## Regression tests to land with fixes

```js
describe('VOICE ROUTING HONOURS tts_provider', () => {
  it('heartbeat uses openai path when provider=openai + key set');
  it('heartbeat falls back to edge when openai fails');
  it('speakClipboard uses openai path when provider=openai + key set');
  it('speakClipboard falls back to edge when openai fails');
  it('no RULES declaration is dead — every voices.* path has at least one consumer');
});
```

The last assertion is the forcing function for G-V3/G-V4: if a future PR adds a RULES entry
without a consumer, the test trips.

## Recommended disposition

Open 2 new QUEUE items:

- **#15 heartbeat-voice-respect-provider** — close G-V1. AXIS=1.
- **#16 speakClipboard-respect-provider** — close G-V2. AXIS=1.

Fold G-V3 + G-V4 into the F3 patch already drafted under #11 (all three are "remove dead
RULES entries + add the ones UI actually writes").
