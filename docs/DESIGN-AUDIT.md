# Terminal Talk — Design Audit (v0.2)

Status snapshot: 2026-04-19. Author: Ben + Claude, after a marathon day of
shipping. The goal of this document is an honest, research-backed review
of every user-facing feature so we can separate "shipped correctly" from
"shipped but needs rework". Each section cites sources where an industry
standard applies, so a future contributor can trace the reasoning.

Conventions:
- ✅ = implementation matches industry-standard approach
- ⚠️ = works today but has a known rough edge worth revisiting
- 🔴 = needs rework before we call it production-grade

---

## 1. Click-through toolbar with hover-to-reveal

**What we ship.** Collapsed toolbar = 14 px strip with
`setIgnoreMouseEvents(true, { forward: true })` so clicks pass through to
apps below. Renderer still receives mousemove events to detect hover and
re-expand.

**Industry pattern.** This is exactly the recipe Electron's own docs
prescribe for click-through floating widgets — `forward: true` enables
`mouseenter`/`mouseleave` detection without consuming clicks ([Electron:
Custom Window Interactions][elec-window]; [Click-Through Window in
ElectronJS — GeeksForGeeks][gfg-clickthrough]).

**Known gotchas from the ecosystem.** Electron issue
[#33281][elec-33281] documents that mouse event forwarding is not 100%
reliable — specifically, when certain non-Electron windows are in focus,
forwarded events can drop. Our 2026-04-19 poll-based fix covers this: we
don't rely on `mouseleave` firing; we poll every 1 s with a last-activity
timestamp. That design is directly a response to the known forwarding
flakiness.

**Status.** ✅ Current design is industry-correct and resilient to the
documented bug.

**Follow-ups.** None required. The poll approach is inherently robust
against any event-forwarding edge case we haven't seen yet.

---

## 2. Edge snapping with vertical layout

**What we ship.** Custom snap-on-drag: `move`/`moved` events, find
nearest edge, snap within 50 px threshold, respect drag-direction intent
(horizontal drag → left/right edge; vertical drag → top/bottom edge).
Left/right edges trigger a vertical layout variant.

**Industry pattern.** Electron itself doesn't ship drag-to-snap —
`setMovable(true)` only enables OS-native Aero Snap on Windows, which is
the "drag window to screen edge → maximise" behaviour, not what we want
([Electron BrowserWindow API][elec-bw]). Third-party dock managers
(Infragistics DockManager, Hammerspoon) build their own snap logic on
top of `setBounds` — same pattern we're using.

**Known friction we hit and resolved.** Corner tie-breaking (commit
`2b40ada`) — tracking drag start position and using |dX| vs |dY| to pick
the right axis. This was the biggest footgun; the "naive nearest-edge"
approach snapped horizontal-bar-at-top-right to `top` instead of the
intended `right` because top was numerically closer.

**Known Electron gotcha we accepted.** [Issue #37888][elec-37888]:
`transparent: true` (which we use for the rounded letterbox) disables
Windows Snap Assist. We implement our own snap instead, so this doesn't
matter — but it's worth being aware of if we ever want native snap back.

**Another Electron gotcha.** [Issue #20173][elec-20173]:
`setMovable(false)` *still* lets Aero Snap fire on Windows — so if we
ever tried to disable movement, the OS could still move our window. We
don't hit this today but it's lurking.

**Status.** ✅ Our snap design is equivalent to what IDE dock managers
do; the direction-intent refinement puts us ahead of most naive
implementations.

**Follow-ups.**
- Multi-monitor support is untested. Currently we only query
  `screen.getPrimaryDisplay()`. On a second monitor, snap would fire
  against the primary display's edges — wrong. Should use
  `screen.getDisplayNearestPoint(cursorPosition)` instead. Rework
  needed before anyone with multi-monitor uses this seriously.

---

## 3. Sentence splitting for streaming TTS

**What we ship.** Custom Python splitter (`app/sentence_split.py`) —
rule-based, protects abbreviations / URLs / decimals, respects
paragraph breaks, merges shorts, hard-splits longs. ~180 lines of
defensive regex.

**Industry baseline.** The two well-known options:
- **pySBD** (Pragmatic Sentence Boundary Disambiguation) — rule-based,
  passes 97.92 % of the "Golden Rules" English test set, ~25 % better
  than the next-best open-source tool ([pySBD paper,
  ACL 2020][pysbd-paper]; [pySBD on PyPI][pysbd-pypi]). Supports 22
  languages. Runs as a standalone library or as a spaCy pipeline
  component.
- **spaCy dependency-parser splitter** — learnt model, slower, struggles
  on mixed-case/out-of-domain text.

Our splitter is rule-based too, matching the pySBD philosophy (which
their paper argues beats learnt models for robustness + interpretability).

**Status.** ⚠️ Works for common English cases but we haven't run it
against the Golden Rules. pySBD would almost certainly cover edge cases
ours misses (e.g., quoted sentences, nested punctuation, some
international variants).

**Trade-off of switching.** pySBD is 5 MB, pure-Python, no heavy deps.
It'd add ~300 ms to cold-start the listener but Claude Code responses
already take longer than that to arrive. The robustness win is likely
worth it.

**Follow-ups.**
- **Swap to pySBD.** Keep our sanitisation (code blocks, URLs, etc.)
  before passing to pySBD, and use pySBD just for the split step. Our
  min/max-length merging stays on top.
- **Alternative: use edge-tts's own SentenceBoundary metadata.** See
  next section.

---

## 4. TTS chunking strategy

**What we ship.** We split text into sentences in Python, then fire each
to `edge_tts_speak.py` (one subprocess per sentence, 4 parallel). Each
sentence becomes a separate MP3 file in the queue.

**Industry pattern we didn't use.** `edge-tts` itself provides
`WordBoundary` and `SentenceBoundary` metadata events during synthesis
([edge-tts on PyPI][edge-pypi]; [communicate.py][edge-comm]). Instead of
pre-splitting, we could:
1. Send the full response to edge-tts in ONE request.
2. Stream the audio + boundary events.
3. Split the audio at `SentenceBoundary` offsets to produce per-clip files.

**Trade-off.**
- Current approach: simple, parallel, easy to reason about. Downside:
  N subprocess invocations, each paying edge-tts's own fixed overhead
  (handshake + first-byte latency).
- Boundary approach: single request, lower total overhead, Microsoft's
  own splitter boundaries (likely better than ours for edge cases).
  Downside: sequential — we can't start playing sentence 2 until
  sentence 1's audio bytes arrive. Our current parallel setup gets
  sentence-1 audio faster because all sentences are synthesising
  simultaneously.

**Status.** ⚠️ Current approach is defensible and gives fastest first-
audio-byte latency due to parallelism. But the overhead of N
subprocesses and N handshakes adds up; for a 20-sentence response we
pay 20× the fixed cost.

**Follow-ups.**
- Benchmark: time-to-first-audio-byte on current impl vs a single-
  streaming-request impl. If the single-request is within ~1 s of our
  parallel path, switch — we get better sentence boundaries and less
  process churn.
- If kept: lower MAX_PARALLEL_SYNTH from 4 to 2 or 3 to reduce burst
  load on Edge's endpoint (rate-limit headroom).

---

## 5. Audio ducking / pause during dictation

**What we ship.** Global hotkey `Ctrl+Shift+P` that toggles pause/
resume. User binds this hotkey in their dictation tool's activation
macro. Today's commit (`6891e04`).

**Industry pattern.** The "real" Windows-native approach is the
`IAudioVolumeDuckNotification` COM interface — apps implement it and
get `OnVolumeDuckNotification` / `OnVolumeUnduckNotification` callbacks
when communication sessions open/close ([Microsoft Learn: Handling
Audio Ducking Events][msdn-ducking]). This would let us detect any
dictation/call app taking the mic, not just Wispr Flow.

**Why we don't do that yet.** Adding `IAudioVolumeDuckNotification`
means a native node addon (edge-js, N-API, or similar). That's a
significant install-footprint hit — prebuilt binaries per Node.js
version, per platform, per architecture. For a ~50-line feature it's
disproportionate.

**Hotkey alternative we chose.** The user binds their dictation tool
(Wispr Flow, Talon, Dragon) to send `Ctrl+Shift+P`. Works for any
dictation app. Zero native dep.

**Gotcha we identified today.** Ben wanted `Ctrl+Win` (his Wispr Flow
trigger) to auto-pause Terminal Talk. Can't be done via
`globalShortcut.register` because Wispr Flow already owns that combo
([Electron globalShortcut docs][elec-shortcut] — "silently fails if
accelerator is already taken"). Three ways around it: PowerToys
Keyboard Manager remap, AutoHotkey chain script, or a proper
native-hook module (`uiohook-napi` or similar) that listens without
consuming events.

**Status.** ✅ For v1, the hotkey approach is the right call.

**Follow-ups.**
- Document the AutoHotkey one-liner in `README.md` for users who want
  hands-off Wispr Flow integration.
- V2 (if users ask): `uiohook-napi`-based global key listener that
  catches arbitrary user-configured key combos without needing
  exclusive registration. Also gets us multi-key chains for free.
- V3 (if we ever ship cross-platform): evaluate the macOS equivalent
  (CoreAudio's `kAudioHardwarePropertyDefaultInputDevice` change
  notifications).

---

## 6. Auto-collapse / show-on-idle

**What we ship.** 1-second poll that checks `lastActivityTs`. Collapses
15 s after last "something interesting happened" event
(mousemove-over-bar, click, keydown, new clip arrival, force-expand).
Suppressed while settings panel is open or audio queue is active.

**Industry pattern.** This exact pattern is what hardware-media-key
Electron widgets use. Daily.co's Spotify miniplayer clone writes up:
Electron miniplayer apps wake every 2.3 s for media-key polling
([Daily.co blog on Electron overlays][daily-electron]). Our 1 s poll
interval is marginally more aggressive; we could pull back to 2 s with
no visible user impact and save some CPU cycles.

**Status.** ✅ Correct pattern, backed by prior art. The poll design was
chosen *specifically* because the event-transition approach got stuck
on Electron issue #33281's mousemove-forwarding bug.

**Follow-ups.**
- Stretch to 2 s poll — imperceptible to the user, halves the wake-ups.
- Document the 15 s delay as configurable via settings (already is in
  theory via `COLLAPSE_DELAY_MS`; surfaced in the settings panel? Not
  yet — could be added alongside auto-prune).

---

## 7. Session colour registry + persistence

**What we ship.** 24-slot palette assigned by lowest-free-index on
first hook fire, with fallback to modulo-hash collision when all 24
are used. Sessions persist indefinitely until the user explicitly
removes them via × button (commit `2334704`).

**Industry pattern.** IDEs (VS Code, JetBrains) use LRU caches with
grace windows — old sessions eventually evict. Slack's workspace
colours persist but the registry has a hard cap and oldest evict.

**Ben's reason for our approach.** "I labelled 'rag graph', went away,
came back, it was gone." Preserving labelled state was worth more than
the minor risk of unbounded registry growth.

**Unbounded-growth concern.** Every Claude Code session gets a new
UUID. If a user has Terminal Talk installed for months and opens 100s
of sessions (one per project), the registry could grow large.
Registry JSON parsing is O(n) per hook fire. At 10 000 entries that's
potentially slow.

**Status.** ✅ for the current "keep intent stable" UX. ⚠️ for long-term
registry growth.

**Follow-ups.**
- Soft cap: after e.g. 500 entries, start LRU-evicting unpinned
  entries on registry write. (Pinned would be anything the user
  explicitly labelled or chose a colour for.)
- Visual: show a count + "remove old" action in the settings panel.

---

## 8. Per-session mute with cut-the-wire semantics

**What we ship.** `muted: true` in registry. Three independent effects:
(a) `synth_turn.py` skips synthesis entirely — no edge-tts calls,
(b) renderer filters muted-session clips from dots and pending queue,
(c) statusline prefixes `🔇`.

**Industry pattern.** Three independent enforcement points is the
"defense in depth" pattern. Typical muting in media apps touches only
one layer (the playback gate). Our approach also cuts the expensive
synthesis step, which matters for cloud-calling services like edge-tts.

**Status.** ✅ Design is sound.

**Follow-ups.** None. Tests cover the three paths.

---

## 9. Queue auto-play robustness

**What we ship.** Three-tier pickup in `playNextPending`:
priority → pending → fallback scan of unplayed+unmuted in `queue`.
Monotonic mtimes on rolling release so playback order matches seq
order even when parallel syntheses finish out of order.

**What we learned the hard way.**
- Dropping the `if (pendingQueue.length > 0)` gate on `ended` fixed the
  "click-ahead, nothing plays next" bug (commit `5be6877`).
- `os.replace` preserves source mtime, so we needed explicit
  `os.utime` to get monotonic ordering (commit `2febbaa`).

**Status.** ✅ Robust after the two fixes.

**Follow-ups.** None urgent.

---

## 10. Mic release on Ctrl+Shift+J

**What we ship.** Two independent release paths:
(a) toolbar kills the Python listener process (`taskkill /F /T /PID`),
(b) Python listener polls `listening.state` every 250 ms and closes
its `sd.InputStream` when it flips to `off`.

**Industry pattern.** "Defense in depth" — either path alone is
sufficient; both would have to fail for the mic to stay hot. This is
the pattern for safety-critical release logic.

**Why it matters.** Before the fix, Ben had 30 orphan Python listeners
all holding the mic simultaneously.

**Status.** ✅ Exemplary. 2 commits of hardening (`97f0928`, `7c34f48`).

---

## Summary of follow-ups, ordered by priority

| # | Feature | Action | Risk if skipped |
|---|---------|--------|----------------|
| 1 | Multi-monitor edge snap | Use `getDisplayNearestPoint(cursor)` instead of `getPrimaryDisplay()` | Snap misfires on second monitor |
| 2 | Sentence splitter robustness | Swap ours → pySBD | Edge cases in quoted text / some abbreviations mispronounced |
| 3 | TTS chunking strategy | Benchmark single-stream vs parallel | Wasted subprocess overhead, potential rate-limit pressure |
| 4 | Wispr Flow auto-pause UX | Document AutoHotkey / PowerToys recipe in README | Users have to bind manually; worth a runbook |
| 5 | Registry growth | Soft LRU cap at ~500 entries | Long-term performance concern; not urgent |
| 6 | Auto-collapse config | Surface `COLLAPSE_DELAY_MS` in settings panel | Currently requires hand-editing config |

---

## Sources

- [Electron: Custom Window Interactions][elec-window]
- [Electron BrowserWindow API][elec-bw]
- [Electron globalShortcut docs][elec-shortcut]
- [Electron issue #33281: mouse event forwarding bug][elec-33281]
- [Electron issue #37888: transparent breaks snap assist][elec-37888]
- [Electron issue #20173: Aero Snap despite setMovable(false)][elec-20173]
- [Click-Through Window in ElectronJS — GeeksForGeeks][gfg-clickthrough]
- [pySBD paper (ACL 2020)][pysbd-paper]
- [pySBD on PyPI][pysbd-pypi]
- [edge-tts on PyPI][edge-pypi]
- [edge-tts communicate.py source][edge-comm]
- [Microsoft Learn: Handling Audio Ducking Events][msdn-ducking]
- [Daily.co blog: Building an Electron overlay app][daily-electron]

[elec-window]: https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions
[elec-bw]: https://www.electronjs.org/docs/latest/api/browser-window
[elec-shortcut]: https://www.electronjs.org/docs/latest/api/global-shortcut
[elec-33281]: https://github.com/electron/electron/issues/33281
[elec-37888]: https://github.com/electron/electron/issues/37888
[elec-20173]: https://github.com/electron/electron/issues/20173
[gfg-clickthrough]: https://www.geeksforgeeks.org/javascript/click-through-window-in-electronjs/
[pysbd-paper]: https://aclanthology.org/2020.nlposs-1.15.pdf
[pysbd-pypi]: https://pypi.org/project/pysbd/
[edge-pypi]: https://pypi.org/project/edge-tts/
[edge-comm]: https://github.com/rany2/edge-tts/blob/master/src/edge_tts/communicate.py
[msdn-ducking]: https://learn.microsoft.com/en-us/windows/win32/coreaudio/handling-audio-ducking-events-from-communication-devices
[daily-electron]: https://www.daily.co/blog/building-a-video-call-overlay-app-with-electron-and-daily-part-1/
