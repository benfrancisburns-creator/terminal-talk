# Feature: Heartbeat narration

*(Stub — grows as #1 and any future heartbeat-adjacent items investigate it.)*

## User story

During the silent gap between Ben submitting a Claude Code prompt and Claude's first audio response,
the toolbar plays short ambient spinner-verb clips (*"Thinking…"*, *"Pondering…"*, *"Fingling…"*) on a
heartbeat interval so Ben knows Claude is working, not stuck. Stops the moment real response audio
begins. User-togglable via Settings › Playback › *"Heartbeat narration"*.

## Files involved

*(to be filled in by TT1 on review of item #1)*

Candidates from a quick grep:
- `app/lib/heartbeat.js`
- `app/lib/settings-form.js` (toggle wiring)
- `app/lib/config-store.js` (persistence)
- `app/main.js` (IPC)
- `app/lib/audio-player.js` (plays heartbeat clips)

## State surfaces

- `heartbeat_enabled` config key (to be confirmed) in `~/.terminal-talk/config.json`
- Per-session override? — *unknown, part of review*

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

*(populated as the review progresses)*

## Recent commits touching any of the files

*(populated by TT1 — `git log --oneline -20 app/lib/heartbeat.js`)*

## Open questions

- Is `heartbeat_enabled` written synchronously by the toggle, or batched?
- Does any OTHER code path overwrite `config.json` (PS hook, synth, etc.) that could stomp the
  toggle state?
- Is the setting read from disk on each render of Settings, or cached in the renderer?
