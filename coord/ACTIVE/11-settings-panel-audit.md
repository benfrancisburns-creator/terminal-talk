# ACTIVE #11 — Settings panel systematic audit

- **Status:** fix-drafted — TT1 on `fix-pass`; Ben resolved F5=remove; awaiting TT2 Devil's-advocate
- **Owner:** TT2 (audit) + TT1 (fix draft, Devil's-advocate pending)
- **Axes in play:** 1 (correctness), 2 (persistence), 7 (invariant)
- **Opened:** 2026-04-24T23:10
- **Method:** feature-by-feature contract audit — not interrogation of Ben's memory.

## Contract

Every control in the settings panel is a direct edit on user state. The invariant is:
*"Touching a control changes behaviour immediately AND survives the next restart."* Also:
*"Every validator-declared key has exactly one UI path that sets it, and every UI-written key
has validator coverage."*

## Method

1. Read `app/lib/settings-form.js` (699 LoC) — enumerate every control wired in `_onMount`.
2. Read `app/index.html` — confirm every DOM id the form queries exists.
3. For each control, trace: UI event → IPC channel → `update-config` merge → `saveConfig`
   → `loadConfig` on next boot → `_populateX()` on panel open.
4. Cross-check against `config-validate.js` RULES (the source of truth for what's allowed).

## Findings matrix

| Control | Config key | In validator | Write-path | Read-path | Verdict |
|---|---|---|---|---|---|
| speedSlider | `playback.speed` | ✓ | nested merge | nested merge | ✓ works |
| volumeSlider | `playback.master_volume` | ✓ | nested merge | nested merge | ✓ works |
| autoPruneToggle | `playback.auto_prune` | ✓ | nested merge | nested merge | ✓ works |
| autoPruneSec | `playback.auto_prune_sec` | ✓ (1–600) | nested merge | nested merge | ✓ works |
| autoContinueToggle | `playback.auto_continue_after_click` | ✓ | nested merge | nested merge | ✓ works |
| paletteVariantToggle | `playback.palette_variant` | ✓ | nested merge | nested merge | ✓ works |
| **heartbeatToggle** | **`heartbeat_enabled`** | ✓ | **✗ dropped at `ipc-handlers.js:456-462`** | **✗ dropped at `config-store.js:45-52`** | **✗ BROKEN (#1)** |
| voiceEdgeResp | `voices.edge_response` | ✓ | nested merge | nested merge | ✓ works |
| voiceEdgeClip | `voices.edge_clip` | **✗ NOT DECLARED** | nested merge | nested merge | ~ persists but no validator coverage (**F1**) |
| voiceOaiResp | `voices.openai_response` | **✗ NOT DECLARED** | nested merge | nested merge | ~ persists but no validator coverage (**F1**) |
| voiceOaiClip | `voices.openai_clip` | **✗ NOT DECLARED** | nested merge | nested merge | ~ persists but no validator coverage (**F1**) |
| incCodeBlocks…incImageAlt (6) | `speech_includes.{key}` | parent-only | nested merge | nested merge | ~ persists; sub-keys unvalidated (**F2**) |
| openaiKeyInput | `openai_api_key` | ✓ | nulled at merge; apiKeyStore path | apiKeyStore | ✓ works (by-design out-of-band) |
| openaiPreferToggle | `playback.tts_provider` | ✓ | nested merge | nested merge | ✓ works |
| openaiSectionToggle | (ephemeral UI state) | — | not persisted | not persisted | ~ UX consideration (**F3**) |
| tab selection | `selected_tab` | ✓ | **✗ dropped** | **✗ dropped** | **✗ BROKEN (#1)** |
| tabs expanded | `tabs_expanded` | ✓ | **✗ dropped** | **✗ dropped** | **✗ BROKEN (#1)** |
| window.x/y/dock | `window` | **✗ NOT DECLARED** | `saveWindowPosition` path | load merge | ~ racy w/ update-config (TT1 #3) |

**Also declared in validator but not written by any UI control:**
- `voices.edge_question` — dead declaration. Either restore a UI control or remove from RULES.
- `voices.edge_notification` — dead declaration. Same.

## New findings opened by this audit

- **F1 — Voice validator coverage gap.** `edge_clip`, `openai_response`, `openai_clip` are
  written by the UI but absent from RULES. Future bad value (empty string, non-string) would
  ship to `synth_turn.py` + `tts-helper.psm1` and fail silently or crash the synth. Fix:
  add 3 RULES entries with `type: 'string', maxLen: 80` matching the existing voice rules.
- **F2 — speech_includes sub-key validator gap.** RULES declares `speech_includes` as an
  object but no sub-keys. User-hit scenario: a partial write of `{ speech_includes: { urls: 'yes' }}`
  (non-boolean) would merge and pass validation. Sanitiser reads truthy → urls included.
  Fix: add 6 sub-key RULES (`code_blocks`, `inline_code`, `urls`, `headings`, `bullet_markers`,
  `image_alt`) with `type: 'boolean'`.
- **F3 — Dead validator declarations.** `voices.edge_question` + `voices.edge_notification`
  have no UI and nothing in code writes them. Either remove from RULES or identify the feature
  that was supposed to use them. Likely leftover from v0.2-era plans.
- **F4 — OpenAI section collapse state lost on every panel open.** Ephemeral UI state. Not a
  bug per TT1's design but a small UX rough edge — if the user expands the section to read the
  status text, closing the panel reverts it. Consider persisting as `ui.openai_collapsed` or
  similar if the audit sweep surfaces other UI-persistence gaps.

## Fix shapes (no implementation — TT1's lane)

- **#1 / #3 / #7 already covered** by the combined allowlist fix TT1 is drafting.
- **F1 + F3** — one patch to `app/lib/config-validate.js`:
  ```js
  { path: 'voices.edge_clip',        type: 'string', maxLen: 80 },
  { path: 'voices.openai_response',  type: 'string', maxLen: 80 },
  { path: 'voices.openai_clip',      type: 'string', maxLen: 80 },
  // remove: edge_question, edge_notification (no UI / no caller)
  ```
- **F2** — extend the same patch:
  ```js
  { path: 'speech_includes.code_blocks',    type: 'boolean' },
  { path: 'speech_includes.inline_code',    type: 'boolean' },
  { path: 'speech_includes.urls',           type: 'boolean' },
  { path: 'speech_includes.headings',       type: 'boolean' },
  { path: 'speech_includes.bullet_markers', type: 'boolean' },
  { path: 'speech_includes.image_alt',      type: 'boolean' },
  ```
- **F4** — defer pending other UI-state findings; might fold into a single `ui` sub-object.

## Regression test shape

Extend the planned `CONFIG PERSISTENCE ROUND-TRIP` group with two additions:

```js
it('every RULES entry has a UI write-path OR is explicitly marked as load-only', () => {
  // cross-check RULES vs settings-form.js updateConfig keys; any RULES entry with
  // no writer is a dead declaration.
});

it('every settings-form updateConfig key is declared in RULES', () => {
  // extract all partial.keys from updateConfig call sites in settings-form.js;
  // assert each maps to a RULES path.
});
```

These two tests together enforce the invariant "RULES = exactly the keys the UI writes".
Any future drift trips the test.

## Reviewer findings — [tt1 · 2026-04-25T00:10]

Source-verified TT2's 4 findings + swept for adjacencies. **Bottom line: F1–F4 confirmed. F2
undercounted by one sub-key. Three new findings surfaced.**

### F1 — confirmed (all 3 voice keys are live at runtime)

- `voices.edge_clip` read at `app/main.js:1103` in `speakClipboard` → passed into `callEdgeTTS`.
- `voices.openai_clip` read at `app/main.js:1110` in the OpenAI fallback path.
- `voices.openai_response` read at `hooks/speak-response.ps1:192` (via `$cfg.voices.openai_response`) and at `hooks/speak-notification.ps1:43`.

A hand-edited bad value (non-string, empty, or > 80 chars) lands directly in a TTS invocation.
TT2's fix-shape is correct: add 3 `type: 'string', maxLen: 80` rules matching the existing
`edge_response` shape.

### F2 — confirmed in spirit, but undercount — should be 7 sub-keys not 6

TT2's proposed 6 rules cover the main-settings checkboxes (`incCodeBlocks` through `incImageAlt`
at `settings-form.js:111-116`). But the full set of validator-legit boolean sub-keys is **7**:

- `ALLOWED_INCLUDE_KEYS` (`app/lib/ipc-validate.js:25`) = `code_blocks, inline_code, urls, headings, bullet_markers, image_alt, tool_calls`
- `VALID_INCLUDE_KEYS` (`app/main.js:1146`) = identical 7-key set
- `DEFAULTS.speech_includes` (`app/main.js:81-92`) = same 7 keys (last being `tool_calls: true`)
- `renderer.js:984-985` lists `'tool_calls'` as a per-session-override toggle row

`tool_calls` has NO main-Settings UI control — it's only exposed via the per-session override
dropdown. But a hand-edited global `config.json` with `speech_includes: { tool_calls: false }`
is legitimate and should validate. **Add 7 sub-key rules, not 6.**

### F3 — confirmed (edge_question + edge_notification are dead)

Exhaustive grep for each key across `app/`, `hooks/`, `scripts/`: zero non-RULES runtime
consumers.

- `edge_question` — questions-first extraction was removed 2026-04-22 (`synth_turn.py:1369-1379`
  has the rationale comment). The key has no caller now.
- `edge_notification` — `speak-notification.ps1:42` reads `edge_response` for its voice, NOT
  `edge_notification`. So the hook that sounds like it should use the key ignores it entirely.

TT2's fix-shape (remove from RULES) is correct. **Pair with F5 + F7 below** so README and
schema don't drift.

### F4 — confirmed, agree non-blocking

Ephemeral UI state. Worth revisiting if the audit sweep finds ≥ 2 UI-persistence gaps that
could share a single `ui` sub-object.

### F5 — (new) speak-notification.ps1 wrong-voice silent bug

`hooks/speak-notification.ps1:42-43`:
```
if ($cfg.voices.edge_response)   { $edgeVoice   = $cfg.voices.edge_response }
if ($cfg.voices.openai_response) { $openaiVoice = $cfg.voices.openai_response }
```

A user whose mental model tracks the config keys in README.md (line 263-264 shows
`edge_notification` as a real field) would expect notification audio to use that voice.
Instead the notification hook reuses the response voice. Two resolutions:

1. **Align with F3:** remove `edge_notification` everywhere (RULES, README, schema) since
   nothing reads it. Cleanest.
2. **Wire the hook properly:** `if ($cfg.voices.edge_notification) { $edgeVoice = $cfg.voices.edge_notification }`
   (fall back to `edge_response` if not set). Restores the documented feature.

Recommend (1) unless Ben has a specific use case for distinct notification voices — in which
case (2) brings the codebase back in line with the README. Worth surfacing to Ben explicitly
before the F3 patch lands.

### F6 — (new) README.md exposes two vestigial voice keys

README lines 263-264 show `edge_question` + `edge_notification` as first-class configurable
fields in the documented `config.json` example. Post-F3 removal, README still lists them →
lies to anyone hand-editing. Fix with the F3 patch: delete those 2 lines from README + drop
them from `config.schema.json` (separate from RULES but used by editor autocomplete).

### F7 — (new) `ALLOWED_INCLUDE_KEYS` vs UI checkbox count mismatch reveals `tool_calls` has no global control

Not a bug per se, but an audit-of-audits flag: the main Settings panel has 6 speech-includes
checkboxes; the IPC validator accepts 7 keys (`tool_calls` is the extra). Users can override
`tool_calls` on a PER-SESSION basis via the per-session override panel, but there's no global
Settings control for `speech_includes.tool_calls`. The global defaults to `true` forever
unless the user either hand-edits `config.json` OR overrides per-session.

Two paths: (a) add a 7th checkbox to Settings mirroring the other 6, or (b) leave as-is and
document explicitly that tool-call narration is per-session only (matching the renderer
comment at `renderer.js:984`). Either is fine — flag only.

## Fix-shape revisions

Amending TT2's proposed patch:

- **F1 (unchanged):** 3 new `voices.*` string rules.
- **F2 (add 1):** 7 sub-key `speech_includes.*` boolean rules (include `tool_calls`).
- **F3 (expanded):** remove `voices.edge_question` + `voices.edge_notification` from
  `config-validate.js RULES`, `config.schema.json` properties.voices, AND README.md lines
  263-264.
- **F4 (unchanged):** deferred.
- **F5 (decision required from Ben):** remove or wire the speak-notification voice — I
  recommend removal since no user has (to our knowledge) configured it separately.
- **F6 (pair with F3):** README + schema cleanup in the same patch.
- **F7 (non-blocking, open a follow-up):** decide on global tool_calls control or explicit
  per-session-only docs.

## Regression test shape revisions

Amending TT2's two proposed tests:

- Keep TT2's existing two (RULES ↔ UI writers bidirectional coverage).
- **Add:** `every RULES path has at least one runtime consumer in app/ or hooks/`. Source-
  grep each path segment; fail if a RULES entry has zero matches outside `config-validate.js`
  and `config.schema.json`. Would have caught `edge_question` + `edge_notification` the day
  they went dead. Minor false-positive risk on future parent-only rules (like
  `speech_includes` itself, which is always nested); skip parent-only rules (rules whose
  path has no dot + are `type: 'object'`).
- **Add:** `DEFAULTS.speech_includes keys ⊆ RULES speech_includes sub-keys`. Iterates
  `DEFAULTS.speech_includes` and asserts every key has a matching `speech_includes.<key>`
  RULES entry. Catches drift when someone adds to DEFAULTS but forgets RULES (the F2 shape
  in reverse).

## Bundling recommendation

F1+F2+F3+F5+F6 are the same surface (`config-validate.js RULES` + README + schema +
speak-notification.ps1 OR a 2-line revert) and the 4 new test additions share the same
describe group. Sensible to land as **one fix commit closing #11** after Ben confirms the F5
decision. F4 + F7 defer as follow-up QUEUE items.

### What I need from you or Ben

- **Ben:** F5 resolution — should the notification hook get its own voice config
  (`edge_notification`) or should we treat it as a dead key and remove? Affects whether the
  F3 patch removes or wires.
- **TT2:** agree with the F2 undercount + the 2 new test shapes? Any pushback on treating
  F7 as a follow-up rather than folding into #11?
- **Either:** assuming green on both, this is a small fix (3 file edits + ~25 test LoC) I
  can draft as soon as my current fix-drafted slot clears (Batch 1 post-merge).
