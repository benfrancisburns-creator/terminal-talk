# ACTIVE #3 — settings-persistence-full-audit

- **Status:** in-review
- **Owner:** tt1
- **Axes in play:** 2 (persistence), 7 (invariant enforcement)
- **MAP page:** [`MAP/settings-persistence.md`](../MAP/settings-persistence.md) *(stub; promoted from TBD when this item closes)*
- **Reported by:** Ben (#1 follow-up), 2026-04-24

## User-reported concern

> "Toggle · reload window · restart app · reboot PC. Verify state survives each. Find all
> classes-of-bug like #1 not just the specific instance."

The class-of-bug is the *allowlist-merge silently drops unlisted top-level keys* pattern found
in #1. #3 is the systematic sweep of every persistable setting against both the write-side
allowlist (`update-config` in `ipc-handlers.js`) and the read-side allowlist (`config-store.load()`).

## Reproduction recipe — [tt1 · 2026-04-24T22:05:00+01:00]

### Recipe for each candidate key

```
# Generic template. Replace <KEY> with each candidate from the audit table below.
1. Close toolbar.
2. Hand-write into ~/.terminal-talk/config.json a known test value for <KEY>.
   Example for heartbeat_enabled:
     python -c "import json, pathlib; p = pathlib.Path.home()/'.terminal-talk/config.json'; \
                c = json.loads(p.read_text()); c['<KEY>'] = <VALUE>; \
                p.write_text(json.dumps(c, indent=2))"
3. Launch toolbar. (Triggers loadConfig.)
4. IMMEDIATELY trigger one update-config cycle (e.g. adjust any toggle). This round-trips
   the config: load → update-config merge → saveConfig → disk.
5. Close toolbar.
6. grep <KEY> ~/.terminal-talk/config.json
   - If returns empty: key was DROPPED. Persistence-broken.
   - If returns the value you wrote in step 2: key ROUND-TRIPS. Persistence OK.
```

### Across-restart matrix (TT2 to fill in)

For each row, TT2 sets via UI, observes 3 state transitions:

| Control | UI path | On-disk key | Set via UI → survives CLOSE panel? | Survives RELOAD window (Ctrl+R)? | Survives APP RESTART? | Survives PC REBOOT? |
|---|---|---|---|---|---|---|
| Heartbeat toggle | Settings → Playback | `heartbeat_enabled` | ? | ? | ? | ? |
| Speed slider | Settings → Playback | `playback.speed` | ? | ? | ? | ? |
| Master volume | Settings → Playback | `playback.master_volume` | ? | ? | ? | ? |
| Auto-prune toggle | Settings → Playback | `playback.auto_prune` | ? | ? | ? | ? |
| Auto-prune seconds | Settings → Playback | `playback.auto_prune_sec` | ? | ? | ? | ? |
| Auto-continue-after-click | Settings → Playback | `playback.auto_continue_after_click` | ? | ? | ? | ? |
| Palette variant | Settings → Playback | `playback.palette_variant` | ? | ? | ? | ? |
| Provider select | Settings → OpenAI | `playback.tts_provider` | ? | ? | ? | ? |
| OpenAI API key (set) | Settings → OpenAI | `openai_key.enc` (NOT config.json) | ? | ? | ? | ? |
| OpenAI API key (clear) | Settings → OpenAI | `openai_key.enc` deleted | ? | ? | ? | ? |
| Global voices (4 selects) | Settings → Voices | `voices.edge_clip|edge_response|openai_clip|openai_response` | ? | ? | ? | ? |
| Speech-includes (6 boxes) | Settings → Speech | `speech_includes.code_blocks|inline_code|urls|headings|bullet_markers|image_alt` | ? | ? | ? | ? |
| Tab selection | click a session tab | `selected_tab` | ? | ? | ? | ? |
| Tab expand | click ▾ overflow | `tabs_expanded` | ? | ? | ? | ? |
| Window position | drag toolbar | `window.x/y/dock` | ? | ? | ? | ? |
| Per-session voice | Session row → voice picker | `~/.terminal-talk/session-colours.json` → `assignments.<short>.voice` | ? | ? | ? | ? |
| Per-session mute | Session row → mute | same → `.muted` | ? | ? | ? | ? |
| Per-session focus | Session row → star | same → `.focus` | ? | ? | ? | ? |
| Per-session label | Session row → rename | same → `.label` | ? | ? | ? | ? |
| Per-session speech-includes | Session row → includes | same → `.speech_includes.<key>` | ? | ? | ? | ? |
| Mic listening toggle | Ctrl+Shift+J | `~/.terminal-talk/listening.state` | ? | ? | ? | ? |

## Reviewer findings — [tt1 · 2026-04-24T22:05:00+01:00]

### Method

1. Grepped `rg 'updateConfig' app/` → found every call site that writes a `partial` object to
   `update-config` IPC.
2. For each call site, recorded the top-level keys of the partial object.
3. Cross-referenced against the two allowlists:
   - **Write allowlist** — `app/lib/ipc-handlers.js:456-462` merge keys: `voices`, `hotkeys`,
     `playback`, `speech_includes`, `openai_api_key`.
   - **Read allowlist** — `app/lib/config-store.js:45-52` return keys: `voices`, `hotkeys`,
     `playback`, `speech_includes`, `window`, `openai_api_key`.
4. Any partial key NOT in both allowlists → dropped somewhere in round-trip.
5. Also audited non-config persistence surfaces (`session-colours.json`, `listening.state`,
   `openai_key.enc`) for different bug classes.

### Every `updateConfig` call site in the app

| Call site | Partial | Top-level key in partial |
|---|---|---|
| `settings-form.js:221` speed slider | `{ playback: { speed: v } }` | `playback` |
| `settings-form.js:241` volume slider | `{ playback: { master_volume: v } }` | `playback` |
| `settings-form.js:252` auto-prune toggle | `{ playback: { auto_prune: on } }` | `playback` |
| `settings-form.js:260` auto-prune sec | `{ playback: { auto_prune_sec: n } }` | `playback` |
| `settings-form.js:271` auto-continue toggle | `{ playback: { auto_continue_after_click: on } }` | `playback` |
| `settings-form.js:294` palette variant | `{ playback: { palette_variant: next } }` | `playback` |
| `settings-form.js:309` **heartbeat toggle** | `{ heartbeat_enabled: on }` | **`heartbeat_enabled` ✗** |
| `settings-form.js:333` voice select | `{ voices: { [key]: el.value } }` | `voices` |
| `settings-form.js:342` speech-includes box | `{ speech_includes: { [key]: el.checked } }` | `speech_includes` |
| `settings-form.js:412` OpenAI clear | `{ openai_api_key: '' }` | `openai_api_key` |
| `settings-form.js:414` OpenAI demote provider | `{ playback: { tts_provider: 'edge' } }` | `playback` |
| `settings-form.js:432` OpenAI save key | `{ openai_api_key: key }` | `openai_api_key` |
| `settings-form.js:446` OpenAI remove | `{ openai_api_key: '' }` | `openai_api_key` |
| `settings-form.js:451` OpenAI demote | `{ playback: { tts_provider: 'edge' } }` | `playback` |
| `settings-form.js:463` provider select | `{ playback: { tts_provider: provider } }` | `playback` |
| **`renderer.js:549` persistTabsState** | `{ selected_tab, tabs_expanded }` | **`selected_tab` ✗ + `tabs_expanded` ✗** |

### Confirmed broken persistence paths

**Three top-level keys are silently dropped by the `update-config` merge:**

1. **`heartbeat_enabled`** — bug #1. Write from settings-form:309. Dropped on every update-config
   save. Not in read-side allowlist either, so hand-writes on disk also get dropped on load.
2. **`selected_tab`** — write from renderer.js:549 via `persistTabsState()`. Dropped on every
   save. Also dropped on load. Ben's tab selection (e.g. filtering to TT2 only) resets to
   'all' on every restart.
3. **`tabs_expanded`** — same path. Dropped write + read. Ben's `▾ N idle` overflow preference
   resets on every restart.

Both #2 and #3 are validator-approved (`config-validate.js:32-33`) — parser accepts them if
hand-written — but the store doesn't round-trip them. Same exact bug shape as #1.

### Partial / racy persistence — `window.*`

Window position (`x`, `y`, `dock`) has a MIXED-status:

- **Save path** (`main.js:262-268` `saveWindowPosition`) — mutates `CFG.window` directly then
  calls `saveConfig(CFG)`. Writes `window` sub-object to disk successfully.
- **Load path** — `config-store.js:50` DOES preserve `parsed.window`. So a loaded CFG has the
  window position.
- **BUT** — `update-config` (`ipc-handlers.js:456-462`) builds `merged` with NO `window` key.
  Any Settings toggle triggers update-config, which overwrites CFG (via `setCFG(merged)`) with
  a window-less object. A subsequent `saveConfig(CFG)` from any path then writes without
  `window` → position lost.

The order-of-operations matters:
- If `saveWindowPosition` runs BEFORE `update-config` → window is on disk, then update-config
  drops it, disk now missing `window`. Next launch → CFG has no window → toolbar opens at
  default position.
- If `saveWindowPosition` runs AFTER → window re-added.
- Sequence depends on user's last Settings interaction before close.

Verdict: **window position is LATENTLY broken** — works most of the time because saveWindowPosition
fires on every drag-release, but a close-immediately-after-Settings-toggle loses it.

### Correctly persisted keys (VERIFIED by reading both allowlists)

- `voices.*` — preserved on write + read
- `hotkeys.*` — preserved on both (no UI setter, but config-passthrough works)
- `playback.*` — preserved on both (covers speed, master_volume, auto_prune, auto_prune_sec,
  auto_continue_after_click, palette_variant, tts_provider)
- `speech_includes.*` — preserved on both (all 6 keys: code_blocks, inline_code, urls,
  headings, bullet_markers, image_alt)
- `openai_api_key` — stored separately in `openai_key.enc` + `config.secrets.json`; config.json
  field is always set to null by design. Persistence via `apiKeyStore.set()` and safeStorage.
  Independent persistence surface, not affected by the config allowlist bug.

### Non-config persistence surfaces audited

| File | Writer | Read pattern | Allowlist bug risk |
|---|---|---|---|
| `~/.terminal-talk/session-colours.json` (session registry) | `saveAssignments` in ipc-handlers.js; multiple PS hooks | Full-object read-write, atomic rename, lock-guarded | **No allowlist — safe.** Direct mutation pattern. |
| `~/.terminal-talk/listening.state` | `setListeningState` in main.js | Direct file read/write | **No allowlist — safe.** Scalar file. |
| `~/.terminal-talk/openai_key.enc` (+ `.secrets.json` sidecar) | `apiKeyStore.set` | `apiKeyStore.get` | **No allowlist — safe.** Opaque value. |
| Per-session working flag files | hooks `mark-working.ps1` + `speak-on-tool.ps1` | `get-working-sessions` IPC | **No allowlist — safe.** Per-file existence check. |
| `~/.terminal-talk/config.json` — **THE bug surface** | `saveConfig` via `update-config` IPC + direct callers | `loadConfig` via `config-store.load()` | **Allowlist everywhere — broken for 3 keys today.** |

### Hypotheses ranked — why THESE keys fell through the allowlist

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | `heartbeat_enabled`, `selected_tab`, `tabs_expanded` added to the validator table at different times from when the config-store + update-config were written; authors of the later additions didn't know they needed to extend the merge/load allowlists | **Confirmed** | All three keys ARE in `config-validate.js:30,32,33` — the RULES table. But none are in either allowlist. Config-validate was extended; config-store + update-config were not. Proves the allowlist pattern has no forcing function linking it to the validator — each needs a manual sync. |
| H2 | The allowlist pattern is intentional — only the listed sub-objects should persist | **False** | Empirically: `heartbeat_enabled` HAS a DEFAULT (main.js:99), HAS a UI toggle that writes it, is VALIDATED as a boolean — all signs point to "should persist". The allowlist is an oversight, not a feature. |
| H3 | Some background writer re-adds the dropped keys | **False** | Confirmed during #1 — no timer rewrites unrelated keys into config.json. Keys stay dropped. |

### Proposed fix pattern (draft — not yet committed code)

Two parallel changes that generalise over all three bugs AND harden against the CLASS of bug:

#### Fix shape A — write side (`ipc-handlers.js:456-462`)

Explicit per-key preservation for the three currently-dropped top-level scalars:

```js
const merged = {
  voices:          { ...cur.voices,          ...(partial.voices || {}) },
  hotkeys:         { ...cur.hotkeys,         ...(partial.hotkeys || {}) },
  playback:        { ...cur.playback,        ...(partial.playback || {}) },
  speech_includes: { ...cur.speech_includes, ...(partial.speech_includes || {}) },
  openai_api_key:  null,
  // Top-level scalars — preserve cur unless partial explicitly sets.
  heartbeat_enabled: (partial.heartbeat_enabled !== undefined
                       ? partial.heartbeat_enabled
                       : cur.heartbeat_enabled),
  selected_tab:      (partial.selected_tab !== undefined
                       ? partial.selected_tab
                       : cur.selected_tab),
  tabs_expanded:     (partial.tabs_expanded !== undefined
                       ? partial.tabs_expanded
                       : cur.tabs_expanded),
  // Preserve window through update-config too (saveWindowPosition-
  // followed-by-update-config was racy).
  window: (partial.window !== undefined ? partial.window : cur.window),
};
```

#### Fix shape B — read side (`config-store.js:45-52`)

Symmetric preservation:

```js
return {
  voices:          { ...defaults.voices,          ...(parsed.voices || {}) },
  hotkeys:         { ...defaults.hotkeys,         ...(parsed.hotkeys || {}) },
  playback:        { ...defaults.playback,        ...(parsed.playback || {}) },
  speech_includes: { ...defaults.speech_includes, ...(parsed.speech_includes || {}) },
  window:          parsed.window && typeof parsed.window === 'object' ? parsed.window : null,
  openai_api_key:  parsed.openai_api_key ?? null,
  // Top-level scalars with default-fallback per validator rule.
  heartbeat_enabled: typeof parsed.heartbeat_enabled === 'boolean'
                       ? parsed.heartbeat_enabled : defaults.heartbeat_enabled,
  selected_tab:      typeof parsed.selected_tab === 'string'
                       ? parsed.selected_tab : undefined,
  tabs_expanded:     typeof parsed.tabs_expanded === 'boolean'
                       ? parsed.tabs_expanded : undefined,
};
```

#### Fix shape C — forcing function (higher-value, larger blast-radius)

Replace both allowlists with a single source of truth driven by the `config-validate.js` RULES
table. Iterate over RULES; preserve any key whose rule exists and whose typechecked value
appears in `parsed` (read) or `partial` (write). That way future additions to the RULES table
automatically round-trip — no parallel allowlist to remember to update.

**Larger blast-radius** — touches every update-config invocation and every loadConfig call site,
so #3's fix commit would need careful devil's-advocate review. Proposed as a *follow-up* QUEUE
item (`#8 config-round-trip-driven-by-validator`), not as part of #3's fix. #3 closes with A+B
(explicit list, 3 keys + window) and locks the bug classes in with a round-trip test that
any future added top-level key must pass before CI.

### Test that blocks regression (required before close)

New test group in `scripts/run-tests.cjs`:

```js
describe('CONFIG PERSISTENCE ROUND-TRIP (all validator-approved top-level keys)', () => {
  // For each top-level key in config-validate RULES, assert that
  // saveConfig({ ...key: value }) followed by loadConfig() returns an
  // object where the key's value is unchanged. This is the invariant
  // that #1 and #3 broke.
  ...
});
```

Specifically tests: `heartbeat_enabled`, `selected_tab`, `tabs_expanded`, `window`. If someone
adds a new top-level key to the validator without updating the store allowlists, this test
goes red immediately — same forcing function as the MAP invariant row.

## Tester findings — [TT? · HH:MM]

*(TT2 fills the "across-restart matrix" above. Most important cells: `heartbeat_enabled`,
`selected_tab`, `tabs_expanded`, `window.x/y/dock` across APP RESTART. Expected result pre-fix:
first three fail every restart; window is intermittent. Post-fix: all four should survive.)*

## Root-cause diagnosis — [TT? · HH:MM]

*(Pre-filled by reviewer, to be validated by TT2:
 **Allowlist pattern drift.** Both `update-config` merge and `config-store.load()` enumerate
 an explicit list of top-level keys. When new top-level keys were added to the validator
 (heartbeat_enabled, selected_tab, tabs_expanded — all validated types), the authors didn't
 also extend the merge/load lists. No test caught it because there was no invariant test
 over "every validator-approved key round-trips". Pattern: no forcing function to keep three
 parallel lists (validator, write-merge, read-merge) in sync.)*

## Fix proposal — [TT? · HH:MM]

*(To be drafted on `fix-pass` after TT2 confirms Recipe results. See "Proposed fix pattern"
above. Smallest-change version = A+B (explicit additions for 3 known bugs + window). Larger
forcing-function version = C (validator-driven round-trip) filed as `#8` for a separate
review cycle.)*

## Blast-radius check — [TT? · HH:MM]

- **Files touched (A+B smallest fix):** `app/lib/ipc-handlers.js`, `app/lib/config-store.js`
- **Features depending on those files (from MAP):** heartbeat-narration, settings-persistence
  (new stub), every feature that reads CFG (= almost everything) — but only scalar-value reads,
  no behavioural change for sub-objects
- **Invariants spanning those files:** *(INDEX entry will be added)* — "every validator-approved
  top-level key round-trips through save→load unchanged"
- **Tests that MUST still pass:** all existing `CONFIG` and `CONFIG PERSISTENCE` tests; all
  `HARDENING` tests; all `MAIN.JS REGISTRY READ TOLERANCE`; all `STATUSLINE` (CFG reads)
- **Tests at silent-regression risk:** any test that asserted `Object.keys(cfg)` was exactly
  the 5-key/6-key shape — unlikely to exist (would be anti-pattern), but grep for
  `Object.keys(cfg)` in scripts/run-tests.cjs before shipping
- **Settings / flag files possibly affected:** `~/.terminal-talk/config.json` — shape expands
  to include the preserved keys; consumers that Object.keys-iterate (unlikely) may see new keys

## Causality

- **Root cause:** allowlist-merge pattern with no forcing function to keep it in sync with the
  validator's key list. Adding a new top-level key to the validator is necessary but not
  sufficient to make it persist.
- **How did this escape prior review?** No test covers "every validator-approved top-level key
  round-trips". The three bugs (heartbeat_enabled, selected_tab, tabs_expanded) landed in
  different commits, each of which only tested its own immediate behaviour (toggle works
  in-session) rather than persistence across restart.
- **Is the fix addressing the cause or the symptom?** A+B addresses the 3 known symptoms
  (the specific keys). The round-trip test + MAP invariant pushes toward cause-level; a full
  cause-level fix (C) is too broad for this cycle.
- **Smallest fix that addresses the cause:** the round-trip test. Any future allowlist drift
  reveals itself on first CI run. The per-key fixes are the visible behaviour patch.

## Devil's advocate — [OTHER TERMINAL · HH:MM]

*(TT2 fills after fix is drafted. Consider: does shipping `selected_tab` persistence change
visible UX in surprising ways — e.g. user on holiday returns, toolbar opens on their old tab
filter and they don't realise why they can't see a new session's clips? Maybe add a defensive
"if selected_tab is a session short that's no longer in assignments, fall back to 'all'" —
the code already does this, so re-verify.)*

## New test that guards against regression

Required before close:
`scripts/run-tests.cjs` → `CONFIG PERSISTENCE ROUND-TRIP` group → per-key `it()` for each
validator-approved top-level key. Minimal implementation: 5 new `it`s (heartbeat_enabled,
selected_tab, tabs_expanded, window, openai_api_key — the last tests the "always-null"
contract).

## Verification — [TT2 · HH:MM]

*(TT2 runs the cross-restart matrix in the live install. Reports each cell true/false.
Confirms the 3 known-bad keys fail pre-fix and pass post-fix.)*

## Close-out checklist

- [ ] Tester matrix filled (all cells)
- [ ] Pre-fix: heartbeat_enabled, selected_tab, tabs_expanded all drop through restart
- [ ] Fix A+B applied; all three keys + window now round-trip
- [ ] New `CONFIG PERSISTENCE ROUND-TRIP` test group green, covers every validator-approved
      top-level key
- [ ] `MAP/settings-persistence.md` created with the full per-control table + invariants
- [ ] `MAP/heartbeat-narration.md` updated — the #1 fix also closes via this item
- [ ] `INDEX.md` updated — new invariant "every validator-approved top-level key round-trips"
- [ ] New QUEUE item `#8 config-round-trip-driven-by-validator` filed (fix-shape C as follow-up)
- [ ] Commit + push
- [ ] Move ACTIVE → DONE/3-settings-persistence-full-audit.md
- [ ] Update QUEUE.md — #3 STATUS=done, #1 STATUS=done (single commit closes both)
