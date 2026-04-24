# ACTIVE #11 — Settings panel systematic audit

- **Status:** in-test (audit delivered)
- **Owner:** TT2
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
