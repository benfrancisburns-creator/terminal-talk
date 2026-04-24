# Feature: Heartbeat narration

*(Stub — grows as #1 and any future heartbeat-adjacent items investigate it.)*

## User story

During the silent gap between Ben submitting a Claude Code prompt and Claude's first audio response,
the toolbar plays short ambient spinner-verb clips (*"Thinking…"*, *"Pondering…"*, *"Fingling…"*) on a
heartbeat interval so Ben knows Claude is working, not stuck. Stops the moment real response audio
begins. User-togglable via Settings › Playback › *"Heartbeat narration"*.

## Files involved — filled by tt1 during item #1 review · 2026-04-24

Confirmed from `rg '\bheartbeat_enabled\b' app/` + `rg 'heartbeatEnabled' app/`:

| File | Role |
|---|---|
| `app/main.js:99` | `DEFAULTS.heartbeat_enabled = true` |
| `app/main.js:137` | `CFG = loadConfig()` — main-process live state |
| `app/lib/config-store.js:28-53` | `load()` — **drops `heartbeat_enabled` on READ** (bug site B per #1) |
| `app/lib/config-store.js:55-68` | `save()` — writes whatever it's given (not a bug site) |
| `app/lib/ipc-handlers.js:448-468` | `update-config` IPC — **drops `heartbeat_enabled` on WRITE** (bug site A per #1) |
| `app/lib/ipc-handlers.js:584-626` | `speak-heartbeat` IPC — reads `cfg.heartbeat_enabled === false` as the per-tick skip gate |
| `app/lib/settings-form.js:298-312` | `_wireHeartbeatToggle` — sends `{ heartbeat_enabled: on }` to update-config |
| `app/lib/settings-form.js:650-657` | `_populateHeartbeat` — reads `cfg.heartbeat_enabled !== false` into the toggle checkbox |
| `app/lib/config-validate.js:30` | Validator rule — accepts `heartbeat_enabled` as a legal top-level boolean |
| `app/lib/heartbeat.js:120-153` | `decideHeartbeatAction` — pure decision function; skips emit when `heartbeatEnabled === false` |
| `app/renderer.js:275-290` | Heartbeat tick — calls `decideHeartbeatAction` with `cfg.heartbeat_enabled !== false` |

## State surfaces

- **`DEFAULTS.heartbeat_enabled`** — const `true` in `main.js:99`.
- **`CFG.heartbeat_enabled`** — main-process live config. Reassigned by `setCFG(merged)` in
  `update-config`. Currently stays undefined because bug A drops the key from `merged`.
- **`config.json` on disk** — persistent at `~/.terminal-talk/config.json`. Currently never
  contains the key because of bug A (verified against Ben's live file, 2026-04-24).
- **`window.TT_CONFIG_SNAPSHOT.heartbeat_enabled`** — renderer mirror, refreshed on every
  `loadSettings()`. Briefly holds the user's toggle state across Settings close/open via
  `settings-form.js:310` writing directly into the snapshot after a successful `updateConfig`.
- **No per-session override.** Heartbeat is a global/app-wide toggle; the session registry doesn't
  carry a per-session heartbeat flag. Confirmed by `rg 'heartbeat' app/session-registry.psm1`
  returning nothing.

## Invariants this feature SHOULD uphold

1. Setting the toggle to OFF and waiting any amount of time → next re-open of Settings shows OFF.
   *(This is precisely what #1 is flagging is broken.)*
2. Heartbeat never fires while `AudioPlayer._systemAutoPaused` is true (mic-gate respect).
3. Heartbeat never fires after real response audio has started and before the turn ends.

## Settings that affect it

- Master: Settings › Playback › *"Heartbeat narration"* On/Off
- *(is there a per-session override?)*

## Tests guarding it

*(to be enumerated — search `scripts/run-tests.cjs` for "heartbeat")*

## Known quirks / gotchas

- **Allowlist-style merges drop unlisted top-level keys silently.** Both `update-config` in
  `ipc-handlers.js` and `load()` in `config-store.js` enumerate a fixed set of top-level keys and
  drop any others. This is the mechanism behind item #1. The adjacent keys `selected_tab` and
  `tabs_expanded` (validator rules 32-33) are at identical risk if they are ever user-settable
  via `updateConfig` — tracked for follow-up in the QUEUE.
- **`_populateHeartbeat` uses `!== false` defaulting.** Means `undefined` reads as ON, masking
  the symptom as "revert to default" when the persisted key has been silently dropped. Keep this
  defaulting — it matches DEFAULTS policy — but remember it *hides* persistence bugs below it.
- **`window.TT_CONFIG_SNAPSHOT` can transiently hold a value that doesn't match disk.**
  `settings-form.js:310` writes `on` into the snapshot after the updateConfig round-trip. Even if
  the value was dropped from CFG/disk, the local snapshot carries the user's intent for the
  current renderer session — until the next `loadSettings()` clobbers it from the stale CFG.

## Recent commits touching any of the files

```
1ae7678 fix(openai): key off argv (log leak) + bump OpenAI timeout 15s → 60s
6a499ad fix(openai): ship openai_tts.py + route Test clip via a real session short
4b345cc chore(debug): instrument auto-delete + heartbeat + mic-watcher for intermittent-bug capture
dc7c859 fix(toolbar): reset setIgnoreMouseEvents on reload so the new renderer is clickable
7ebf581 feat(openai): Settings UI to enter an API key + 'Prefer OpenAI' provider toggle
27e91b4 feat(settings): surface heartbeat + tool-call toggles + version readout
49f7f54 feat(audio): HB3 — heartbeat verbs play quieter than body + tool-call clips
a691e58 fix(audio): HB4 — playPath guards against system-auto-pause + HB3 H- re-apply
82de51d fix(heartbeat): HB4 — suppress emission while external app holds the mic
1cecfed test(heartbeat): extract decision logic + 19 unit tests — HB1/HB2/HB3 locked
```

Bug almost certainly predates `27e91b4` — that commit SURFACED the toggle in the UI but the
allowlist-merge pattern in `update-config` has been there much longer. Would need `git blame` on
`ipc-handlers.js` to pinpoint introduction; not needed for the fix.

## Open questions (resolved during #1 review)

- **Is `heartbeat_enabled` written synchronously by the toggle?** Yes — `_wireHeartbeatToggle`
  awaits `updateConfig({ heartbeat_enabled: on })` directly on the checkbox's change event.
- **Does any OTHER code path overwrite `config.json`?** Yes — `saveConfig(CFG)` is called at 6
  sites (main.js boot-migration, update-config, remove-session, add-session, a label/index setter,
  openai-key-invalid auto-unset). None of them rewrite the key deliberately; all of them drop it
  because `CFG` itself no longer has it after the first post-startup `update-config`.
- **Is the setting read from disk on each render?** No — cached in `CFG` on main side and in
  `TT_CONFIG_SNAPSHOT` on renderer side. `get-config` returns in-memory `CFG`; only a full toolbar
  restart re-reads from disk.
