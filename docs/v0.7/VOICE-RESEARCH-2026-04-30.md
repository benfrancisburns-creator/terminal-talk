# Terminal Talk Voice Research - 2026-04-30

## Current State

Terminal Talk currently ships:

- 47 verified Microsoft Edge / edge-tts English voices in `app/lib/voices.json`.
- 6 OpenAI premium voices.
- Per-session manual voice overrides stored in `~/.terminal-talk/session-colours.json`.
- Heartbeat clips use the global clip voice (`voices.edge_clip` / `voices.openai_clip`), not per-session response voices.

Live check from this machine:

- `edge_tts.list_voices()` returned `322` total Edge voices.
- English Edge voices returned: `47`.
- Terminal Talk already includes all 47 English Edge voices.

Conclusion: the apparent "400 voices" in competitor products is usually a multilingual catalogue, not 400 extra English Edge voices.

## Free / No-Per-Clip-Cost Sources

### 1. Microsoft Edge / edge-tts

Best for Terminal Talk today.

- No API key.
- No per-character billing inside the current app path.
- Very good quality and low friction.
- Requires internet and relies on Microsoft Edge's online Read Aloud service behavior.
- Current live catalogue observed: 322 total voices, 47 English voices.

Recommended use:

- Keep as the default provider.
- Expand the UI so users can optionally show all locales, not only English.
- Keep English-only as the default curated list for coding sessions.

Sources:

- `https://github.com/rany2/edge-tts`
- `https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts`

### 2. Piper / rhasspy voices

Best path for a large genuinely free/offline library.

Public Piper voice catalogue check:

- `158` model entries.
- `2,667` total speaker slots when multi-speaker models are counted.
- `37` English model entries.
- `2,005` English speaker slots, largely due to multi-speaker English models such as LibriTTS / VCTK.

Tradeoffs:

- Local/offline after model download.
- No per-clip billing.
- Model files are large. Many are around 60 MB each, and high-quality models can be much larger.
- Voice quality varies a lot by model and speaker.
- Multi-speaker models need UI support for `model + speaker_id`, not just one flat voice id.
- Licensing and model cards need to be surfaced per model before bundling or auto-downloading.

Recommended use:

- Add Piper as an optional offline provider, not as an automatic bundled dependency.
- Ship a curated starter pack of maybe 6-12 good English voices.
- Add a "download more voices" catalogue later.
- Treat Piper voices as provider-qualified ids, e.g. `piper:en_GB-vctk-medium#p225`.

Sources:

- `https://github.com/OHF-Voice/piper1-gpl`
- `https://huggingface.co/rhasspy/piper-voices`
- `https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json`

### 3. Azure Speech official neural voices

Large, high-quality catalogue, but not the free default path.

- Official Microsoft Speech platform.
- Huge neural voice list across many languages.
- Requires Azure account / key and pricing applies.

Recommended use:

- Do not use as the default "free" expansion.
- Could be a future premium provider, similar to OpenAI, if users want it.

Source:

- `https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts`

### 4. Windows SAPI installed voices

Available locally, but not a strong expansion path.

- Free/local.
- Quality is inconsistent and usually below Edge/Piper.
- Catalogue depends on the user's Windows install and language packs.

Recommended use:

- Useful as an emergency fallback only.

## Auto Voice Assignment Design

Goal: when a new session is created, Terminal Talk should assign a voice automatically so different sessions sound different without manual setup.

Rules:

1. Manual voice always wins.
   - If `entry.voice` exists, never overwrite it.

2. PID/session migration preserves voice.
   - Existing behavior already preserves `voice` during PID migration.

3. Fresh session gets an automatic voice.
   - Add `voice_auto: true` or `voice_source: "auto"` to distinguish auto-assigned voices from manual choices.
   - This matters because auto voices can be rotated later, while manual voices must be protected.

4. Voice pool should follow the active provider.
   - Edge mode: assign from curated Edge English voices.
   - OpenAI-primary mode: either keep per-session voice on Edge fallback only or restrict to OpenAI's tiny 6-voice set.
   - Piper mode, if added: assign from installed Piper voices only.

5. Avoid assigning the same voice to adjacent/live sessions.
   - Prefer least-used voice among currently live sessions.
   - Tie-break by palette index or session short hash for deterministic behavior.
   - This gives stable, predictable assignment without a watcher loop.

6. Heartbeat should stay separate for now.
   - User likes the current heartbeat voice.
   - Heartbeat uses `edge_clip` / `openai_clip`, not per-session voice.
   - Do not change heartbeat voice assignment as part of session voice work unless explicitly requested.

Suggested registry shape:

```json
{
  "voice": "en-GB-SoniaNeural",
  "voice_auto": true
}
```

When the user changes the dropdown manually:

```json
{
  "voice": "en-AU-NatashaNeural",
  "voice_auto": false
}
```

When the user selects "follow global default":

- Remove `voice`.
- Remove `voice_auto`.

## Recommended Implementation Order

1. Expand voice metadata model.
   - Add provider field in `voices.json`: `edge`, later `piper`.
   - Keep generated `voices-window.js`.

2. Add auto voice allocator for existing Edge catalogue.
   - No provider changes yet.
   - Assign different Edge voices to fresh sessions automatically.
   - Preserve manual overrides.

3. Add Settings toggle:
   - "Auto-assign voices to new sessions".
   - Default on.

4. Add Piper as optional provider later.
   - Provider ids like `piper:<model>#<speaker>`.
   - Local model cache under `~/.terminal-talk/voices/piper/`.
   - Download/install UI only after model-card/license handling is settled.

## Recommendation

Short term:

- Implement auto-assigned Edge voices now. We already have 47 English Edge voices and the current app can synthesize them.

Medium term:

- Add optional "all Edge locales" view if the user wants non-English/accented sessions.

Long term:

- Add Piper as the real free/offline large-library provider. It is the only researched path here that plausibly gives hundreds/thousands of distinct free speaker slots without billing.
