# ACTIVE #30 — heartbeat fires during Wispr dictation (REGRESSION)

- **Status:** diagnosed → fix in progress
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 3 (concurrency)
- **Reported by:** Ben, live use, 2026-04-25T20:50
- **Smoking gun captured:** YES — `_toolbar.log` shows MIC_CAPTURED → heartbeat → MIC_RELEASED
- **Class:** regression of #2 Path C (originally fixed 2026-04-24)

## Symptom

Ben hits Wispr Flow dictation hotkey → mic captures. Heartbeat ("Piecing it together",
"Channelling", etc.) plays audibly + visibly through the dictation window. Reproduces
consistently.

## Smoking gun (`_toolbar.log` 2026-04-25)

```
19:51:05.236Z mic-watcher: MIC_CAPTURED ...Wispr Flow.exe
19:51:07.804Z heartbeat: "Piecing it together" → ...mp3 provider=openai voice=shimmer
19:52:01.932Z mic-watcher: MIC_RELEASED
```

Heartbeat fired 2.5s after MIC_CAPTURED, mid-window.

## Root cause

`app/lib/audio-player.js` has a **single `_systemAutoPaused` flag** shared by TWO
sources:

1. **mic-watcher** sets it via `systemAutoPause()` when MIC_CAPTURED IPC fires.
2. **MediaSession 'pause' / 'play' actions** also write to the same flag (lines 601,
   610) — Chromium emits these in response to OS audio-focus changes.

**The race:** Wispr Flow dictation triggers Chromium's audio-focus subsystem, which
fires a spurious `mediaSession 'play'` action. The handler at line 610 clears
`_systemAutoPaused = false` — even though the mic-watcher's MIC_CAPTURED is still
authoritative. `isSystemAutoPaused()` now returns false. `decideHeartbeatAction()` sees
the gate open + emits.

This race was discussed in code comments but the documented fix (separate `_micCaptured`
flag for mic-watcher, keep `_systemAutoPaused` for MediaSession only) **was never
implemented.** The Surface D audit (#17) on 2026-04-25T01:00 quoted invariants for the
two-flag design from comments, but the actual code was always single-flag. My audit
mistake: trusted the comments without verifying the implementation. Adding a forcing-
function lesson to memory: **assertions about invariants must come from code reads,
not comment reads.**

## Fix shape — two-flag split (matches the design the comments describe)

`app/lib/audio-player.js`:

1. Add second instance flag `_micCaptured = false` next to `_systemAutoPaused`.
2. `systemAutoPause()` sets `_micCaptured = true` (NOT `_systemAutoPaused`). Keeps the
   `audio.pause()` call as-is.
3. `systemAutoResume()` clears `_micCaptured` + bails if `_systemAutoPaused` is still
   set (don't hijack OS-level pause).
4. `mediaSession 'pause'` handler stays on `_systemAutoPaused`. `mediaSession 'play'`
   handler clears `_systemAutoPaused` only — leaves `_micCaptured` alone.
5. `isSystemAutoPaused()` returns `!!(this._micCaptured || this._systemAutoPaused)`.
6. `playPath()` guard reads `(_micCaptured || _systemAutoPaused) && !userClick`.

Net: each source owns its own flag. Chromium's spurious `'play'` cannot clear
`_micCaptured` because only mic-watcher writes that.

## Regression test

```js
it('mediaSession "play" action does NOT clear _micCaptured (HB4 two-flag split)', () => {
  const ap = new AudioPlayer({ ... });
  ap.systemAutoPause();                  // mic-watcher path
  // simulate Chromium's spurious 'play' action
  navigator.mediaSession.actionHandlers.play();
  // mic STILL held
  assertEqual(ap.isSystemAutoPaused(), true,
    'gate must remain closed: mic-watcher independent of mediaSession');
});
```

Lock-in test that the regression cannot recur silently.

## Process lesson — own findings on memory

Codifying as `feedback-audit-from-code-not-comments.md`: when an audit asserts an
invariant, the assertion must come from reading the IMPLEMENTATION, not from quoting
the design comment around it. Comments can drift from code. The whole point of an audit
is to catch that drift.

## Close-out checklist

- [x] Smoking gun captured
- [x] Root cause identified (mediaSession 'play' clears the only flag)
- [x] Fix shape drafted
- [ ] Two-flag split implemented in audio-player.js
- [ ] Regression test added
- [ ] Suite green
- [ ] Live verify on Ben's install (capture another _toolbar.log over a dictation window;
      no heartbeat lines between MIC_CAPTURED and MIC_RELEASED)
