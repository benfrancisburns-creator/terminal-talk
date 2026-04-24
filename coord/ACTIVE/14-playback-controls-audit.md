# ACTIVE #14 — playback controls systematic audit

- **Status:** audit-done (no material bugs; 3 minor UX inconsistencies)
- **Owner:** TT2
- **Axes in play:** 1 (correctness)
- **Opened:** 2026-04-25T00:10
- **Method:** code inspection of renderer.js, audio-player.js, voice-dispatch.js, main.js global shortcuts.

## Surface

Every control that affects playback state: the bar buttons (playPause, back10, fwd10, scrubber,
clearPlayed), global-shortcut hotkeys, and voice-command dispatch.

## Findings matrix

| Control | Source | Verdict | Notes |
|---|---|---|---|
| playPause click | `audio-player.js:402-414` | ✓ works | No src → picks next-unheard or queue[0]; paused → play; playing → pause |
| back10 click | `audio-player.js:416-420` | ✓ works | `Math.max(0, currentTime - 10)` — clamped |
| fwd10 click | `audio-player.js:421-427` | ✓ works | Guarded on `isFinite(duration)` — won't crash on streaming clips |
| scrubber drag | `audio-player.js:725-842` | ✓ works | rAF-based, debounced; scrub direction tracked; mascot + verb cloud wired |
| clearPlayed click | `renderer.js:748-...` | ✓ works | Soft-delete + undo toast; excludes currently-playing; serialises pending clears |
| pause_resume hotkey | `main.js:1899-1904` | ✓ works | Ctrl+Shift+P → IPC `toggle-pause-playback` → audio-player toggles |
| pause_only hotkey | `main.js:1906-1912` | ✓ works | Ctrl+Shift+O → IPC `pause-playback-only` → audio-player pauses if playing |
| voice "play" / "pause" / "next" / "back" / "stop" | `voice-dispatch.js` | ✓ works | Full state-machine treatment per action; more aggressive fallback than button-click |
| keyboard Escape/Space/Arrow | `renderer.js:949-964` | ✓ works (intentionally disabled) | Removed per focus-steal incident; documented in code |

## Findings

### ~ H-P1 — UX inconsistency: button-click "play" vs voice-command "play"

`audio-player.js:403-414` playPause click handler:
- No src loaded → picks next-unheard clip; if queue is empty, silently does nothing.
- Nothing else.

`voice-dispatch.js:79-103` voice "play" command:
- No src loaded → tries `playNextPending()`, then falls back to `pickFallbackClip()` (most-recent
  playable clip regardless of heard-state).

So if the dot strip is full of already-played clips and Ben clicks the play button, nothing
happens. If he says "play", a clip plays. Inconsistent mental model.

**Severity:** low. User has "Undo" via clearPlayed, and the voice command works.
**Fix shape:** make the playPause click use the same fallback chain as voice-dispatch. Extract
`pickFallbackClip` into a shared helper (already exported from voice-dispatch). 4-line diff.

### ~ H-P2 — No keyboard shortcuts for back10 / fwd10

Global hotkeys exist for pause_resume and pause_only but not for skip-forward / skip-back.
In-window keyboard (Space/Arrow) is explicitly disabled for focus-steal reasons. So skip-10s
is click-only.

**Severity:** low-UX. Not a bug — a design choice. Flag for Ben's awareness.
**Action:** none unless Ben wants them.

### ~ H-P3 — clearPlayed undo window duration not auditable from source alone

`clearAllPlayed` schedules `_finaliseClear` via a timer. Duration constant not surfaced
in the excerpt read — likely 5-10 s per UX convention. If a user presses Undo after the
timer fires, the button is gone (toast removed).

**Severity:** expected behaviour; documenting so it's not a surprise.

## No BROKEN findings

All playback controls honour their contracts as documented. No provider-routing issues (those
are #15 / #16's domain, separate surface). No race conditions between click handlers and voice
dispatch (they share the audio element; state transitions are atomic inside the event loop).
No missing handlers.

## Regression tests

The existing test suite already covers most playback scenarios (voice-dispatch has its own
describe group from the 2026-04-24 extract). Gap: no test asserts that playPause button and
voice "play" produce the same result on an all-heard queue. Drafting:

```js
describe('PLAYBACK CONTROL SYMMETRY', () => {
  it('playPause click on all-heard queue should pick a fallback clip (parity with voice "play")', () => {
    // Seed queue with 3 clips, mark all heard, audio.src = ''.
    // Simulate click → assert playPath was called (any clip, doesn't matter which).
  });
});
```

## Close-out checklist

- [x] Every control enumerated
- [x] Contract + verdict for each
- [x] Findings ranked
- [x] Regression test gap flagged
- [ ] Address H-P1 if Ben wants parity with voice-command behaviour
