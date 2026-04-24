# ACTIVE #17 — mic-aware auto-pause systematic audit

- **Status:** audit-done (no BROKEN, no BRITTLE — feature is robust)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 3 (concurrency)
- **Opened:** 2026-04-25T00:25
- **Method:** code inspection across `app/mic-watcher.ps1`, `app/main.js` (spawn + line-parse),
  `app/lib/audio-player.js` (flag semantics), `app/renderer.js` (IPC bridge).

## Surface

When any other app (Wispr Flow, Windows Voice Access, VoIP, etc.) grabs the microphone,
Terminal Talk must:
1. Pause the currently-playing clip (if any).
2. Suppress all heartbeat + incoming-clip playback while the mic is held.
3. Queue new clips for playback AFTER the mic is released.
4. On release: resume the paused clip + drain the queued clips.

Ben reported earlier this session that this is working. Audit verifies correctness from source.

## Architecture (discovered + verified)

```
mic-watcher.ps1 (PS sidecar)
    └─ polls HKCU\...\ConsentStore\microphone\* every 150ms
    └─ emits "MIC_CAPTURED <key>" | "MIC_RELEASED" on transition
    └─ ALSO emits initial state at startup (lines 112-115)
             ↓ stdout
main.js:1722-1741 — line parser
    └─ forwards to renderer via win.webContents.send()
             ↓ IPC
renderer.js:1180-1196 — bridge
    └─ onMicCapturedElsewhere → audioPlayer.systemAutoPause()
    └─ onMicReleased           → audioPlayer.systemAutoResume()
             ↓
audio-player.js — two-flag gating model
    ├─ _micCaptured       (set/cleared by mic-watcher only)
    ├─ _systemAutoPaused  (set/cleared by MediaSession handlers only)
    └─ isSystemAutoPaused() returns union; heartbeat + playPath both read it.
```

## Invariants verified from source

- ✓ **I1 — Two-flag separation.** `audio-player.js:154-173`. Each flag is authoritative for
  its own source. Previously a single flag was mutated by both sources, causing the 2026-04-23
  race Ben saw (Chromium's audio-focus firing spurious 'play' during Wispr dictation cleared
  the flag and heartbeat resumed mid-dictation). Splitting fixes the race; comment at :164-170
  documents the incident.

- ✓ **I2 — Unconditional flag set on pause.** `audio-player.js:250-258`. `systemAutoPause()`
  sets `_micCaptured = true` BEFORE the conditional `.pause()` call. So even if nothing is
  currently playing, the gate closes and heartbeat stops. Renderer's comment at :1182-1188
  explicitly warns against an early-bail optimisation ("observed live 2026-04-23: MIC_CAPTURED
  → heartbeat 'Working' ← race: flag never set"). Fixed.

- ✓ **I3 — Respect for OS pause intent during mic release.** `audio-player.js:266-278`.
  `systemAutoResume()` clears `_micCaptured` but bails if `_systemAutoPaused` is still set.
  Prevents "mic releases → we hijack OS-level pause and start playing".

- ✓ **I4 — User-click override.** `audio-player.js:281-295`. `playPath(p, manual, userClick)`
  blocks playback when either flag is set, BUT accepts `userClick=true` as override. If the
  user explicitly clicks a dot during dictation, respect their intent.

- ✓ **I5 — Queue drain on release.** `audio-player.js:274-278`. If nothing was mid-clip when
  the mic grab happened, `systemAutoResume` calls `_onPlayNextPending` to drain any clips that
  accumulated during the window.

- ✓ **I6 — Safe initial state.** `mic-watcher.ps1:112-115` emits one MIC_CAPTURED or
  MIC_RELEASED line IMMEDIATELY on startup (before entering the poll loop). So if the toolbar
  launches while the mic is already held, the flag is set correctly. No race between
  mic-watcher spawn and the first dictation.

- ✓ **I7 — Crash-recovery.** `main.js:1742-1746`. If mic-watcher dies, it's restarted after
  2 s. On restart, `I6` fires — the new process emits the current state, so the flag
  re-synchronises. Guard `if (!win || win.isDestroyed()) return` prevents restart during
  app shutdown (no orphan PS process).

- ✓ **I8 — Self-exclusion.** `mic-watcher.ps1:33-82`. Terminal Talk's own wake-word listener
  writes its python path to `~/.terminal-talk/listener-python-path.txt` at startup; mic-watcher
  re-reads this on every poll and excludes it (plus static fragments for standard locations).
  So our own mic use doesn't trigger a pause-of-ourselves.

- ✓ **I9 — Transient read failure tolerance.** `mic-watcher.ps1:30, 89-104`.
  `$ErrorActionPreference = 'SilentlyContinue'` + per-subkey try/catch means transient
  registry read failures silently retry on the next 150 ms poll — never fatal.

- ✓ **I10 — Line-buffered stdout.** `mic-watcher.ps1:115, 124`. `[Console]::Out.Flush()`
  after each transition ensures main.js sees the event within one event-loop turn, not
  held in a buffer until a flush.

## Findings

None. Feature is correct, robust, and well-commented. The 2026-04-23 race that Ben observed
is not reproducible on current code (confirmed by grepping for the two-flag commit and tracing
every call-site).

## Regression tests suggested

The audit invariants I1-I10 above should each have a test. Current test coverage (from
`scripts/run-tests.cjs`) has some — the two-flag split was likely covered when it shipped.
A specific gap would be:

- **Test that systemAutoPause sets `_micCaptured = true` even when no clip is playing.** This
  is I2 — the exact regression Ben saw. Trivial probe: new AudioPlayer with audio.src='', call
  systemAutoPause, assert isSystemAutoPaused() === true.
- **Test that mic-watcher restart re-emits initial state.** Harder to unit-test the PS script;
  a PowerShell mock run in CI could verify. Probably out of scope.

## Close-out

- [x] Architecture mapped
- [x] 10 invariants verified from source
- [x] No BROKEN / BRITTLE findings
- [x] Feature confirmed robust (Ben's "Path C fixed" observation validated from code)
- [ ] Add invariant-guard test for I2 (quick win, TT1 or TT2 lane)
