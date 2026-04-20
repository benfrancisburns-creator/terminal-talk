# Changelog

All notable changes to Terminal Talk are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.6] — 2026-04-20

Playback UX fix — clicking a dot no longer turns re-listening into a "click exercise".

### Added

- **`playback.auto_continue_after_click` setting (default ON).** When on, clicking a dot plays that clip and then auto-continues through the remaining clips strictly forward in time, regardless of played state. When off, a click plays only the clicked clip. New row in the Playback settings panel with helper copy on hover.
- Schema entry, validator rule, and config parity test covering the new key.

### Fixed

- **State C — "everything already played, click one to re-listen".** Before: `playNextPending`'s fallback branch filtered out `playedPaths`, so after the whole queue had been heard once, the continuation found nothing and died on the first clip; the user had to click every subsequent clip individually. Now: when a user-click-originated clip ends and the setting is on, the renderer picks the next clip by strict mtime ordering (not by played/unplayed state) and chains `userClick=true` so the whole run honours the setting.
- **State B — interrupt mid-auto-play by clicking ahead.** Before: click #3 while #1 was auto-playing would play #3, then resume from `pendingQueue`'s front — which was still #2 — producing an out-of-order 1 → 3 → 2 → 4 → … sequence. Now: a click signals "start from here", the continuation walks strictly forward in time (#3 → #4 → … → #N), and earlier clips stay unplayed until the user clicks them (which they can).

### Internal

- Renderer now distinguishes `currentIsManual` (priority/hey-jarvis or user-click) from `currentIsUserClick` (user-click only). `playPath` gained a third `userClick` parameter; `userPlay` passes `true`, priority callers continue to pass `false`. This is the surface that made the State B/C fixes possible without touching `playNextPending`'s well-established priority → pending → fallback chain.
- Tests: **172 → 177 logic-only.** Four source-grep regression tests lock the new invariants + one schema/validator parity test.

---

## [0.3.5] — 2026-04-20

Latent-boot-playback fix surfaced by the kit demo.

### Fixed

- **`renderer.js:initialLoad` populated `pendingQueue` newest-first; `pendingQueue.shift()` then yielded the newest clip as the first play.** `main.js:getQueueFiles` returns newest-first (`b.mtime - a.mtime`), and `onQueueUpdated` (steady-state) explicitly re-sorts new arrivals ascending before pushing to pending so `shift()` yields oldest — `initialLoad` (first-boot path) skipped that sort, inheriting main's newest-first ordering. Effect: if the toolbar booted with 4+ unplayed clips queued, playback started on the newest and swept rightmost-to-leftmost until the pending buffer drained, instead of walking the dot strip left-to-right. Mostly invisible in daily use because recent-cutoff (`STALE_MS`) usually promotes older clips to `playedPaths` and leaves only 1-2 in pending, but glaring on the kit demo (8 pre-seeded clips spanning 30 s). Fix: mirror `onQueueUpdated`'s ascending sort in `initialLoad` before populating pending.

### Added

- Source-grep regression test that asserts `initialLoad` sorts unplayed files ascending before pushing to `pendingQueue`. Tests: **171 → 172 logic-only.**

---

## [0.3.4] — 2026-04-20

Kit demo hotfix — playback appeared to walk the dot strip right-to-left.

### Fixed

- **Kit demo mock-ipc returns seed queue in authoring order.** `app/main.js:220`'s `getQueueFiles` sorts its result `b.mtime - a.mtime` (newest first), and `renderer.js:_renderDotsNow` relies on that ordering (it takes `.slice(0, MAX_VISIBLE_DOTS).reverse()` to paint oldest-left / newest-right). The kit's mock returned `queueFiles.slice()` unsorted, so ascending-order seeds (the documented authoring convention) produced newest-left / oldest-right dots and playback appeared to walk right-to-left. Fix: the mock's `getQueue` + every `queue-updated` emit now sort with the same `byNewestFirst` comparator, so kit playback direction is seed-order-agnostic and matches the product.

---

## [0.3.3] — 2026-04-20

Three-part hardening against a phantom-audio class of bug. Field report: an "orange" session (`cafebeef`, marked "(closed)") played a synthesised clip despite never matching an active terminal. Root cause was a race between the test harness seeding the real registry and a live Electron's `saveAssignments` overwriting that seed between seed-write and `synth_turn.py` reading it — the synth fell back to default (`muted=false`) and emitted an MP3 under the test fixture short. Three independent defences now cover this class of bug.

### Fixed

- **Fix 1 — synth-mute tests can no longer touch the user's real `~/.terminal-talk/`.** `app/synth_turn.py` now honours a `TT_HOME` env var to override its whole root (registry, sessions, queue, logs). `scripts/run-tests.cjs`'s SYNTH TURN MUTE block creates a per-run `mkdtemp`'d temp dir and passes `TT_HOME` to every spawned python. Belt-and-brace: a `scrubCafebeef()` finally step deletes any `*-cafebeef.mp3` produced under the test's TT_HOME in case the env var ever fails to propagate.
- **Fix 2 — `playNextPending` now treats closed-terminal sessions like muted for auto-play.** Prior behaviour: `staleSessionShorts` (populated by the 10 s `get-stale-sessions` poll) was a visual-only signal; a late-arriving detached-synth clip (or a leaked fixture) would still auto-play after the terminal closed. New: a `isPathSessionStale(path)` helper is applied in the three non-priority branches (focus, pendingQueue, fallback). Priority (hey-jarvis) still plays unconditionally. The dot stays clickable so the user can hear the clip manually if they want it.
- **Fix 3 — registry writes are now serialised via `app/lib/registry-lock.js`.** `saveAssignments` wraps its atomic temp-then-rename in `withRegistryLock()`, which O_EXCL-creates a sentinel `.lock` file next to `session-colours.json`, retries for up to 500 ms, and steals locks older than 3 s. Protects against any future concurrent writer (second Electron instance, PS hook direct write, future tooling). Fix 1 solves the specific race that motivated this release; Fix 3 prevents the class.

### Added

- Five unit tests covering `withRegistryLock`: runs-and-returns, releases-on-success, releases-on-throw, stale-steal, and serial-order-preserved.
- Source-grep test asserting `playNextPending` calls `isPathSessionStale` in at least three branches.
- Tests: **165 → 171 logic-only.**

---

## [0.3.2] — 2026-04-20

Hotfix for the kit demo on GitHub Pages.

### Fixed

- **D2-3c — kit demo 404s on GitHub Pages.** Pages publishes `/docs` only, so every `../../app/…` path from `docs/ui-kit/` resolved outside the served directory and returned 404. This was a silent bug in v0.3.0 (nothing visibly changed because the kit had hand-duplicated DOM masking the missing `renderer.js`) and a loud one in v0.3.1 (D2-3b's fetch failure now shows an error banner — which is how we caught it). Fix: new mirror at `docs/app-mirror/` containing the six product files the kit consumes (`index.html`, `renderer.js`, `styles.css`, `lib/tokens-window.js`, `lib/voices-window.js`, `lib/palette-classes.css`), generated by `scripts/sync-app-mirror.cjs`. Kit paths changed from `../../app/` to `../app-mirror/`. A `--check` mode of the sync script, wired into the test suite, fails CI if the mirror drifts from `app/`, so a product change can't silently re-break the online demo.

---

## [0.3.1] — 2026-04-20

Kit-demo completeness release. Two small follow-ups to v0.3.0's D2-3 renderer-iframed kit that close the last user-visible gaps in the online preview. Product code untouched.

### Added

- **D2-3a — silent-WAV audio shim in `docs/ui-kit/mock-ipc.js`.** The kit demo can't play real `file://` audio in a browser sandbox, so `HTMLMediaElement.prototype.src` is patched to swap any `file://*.mp3` for a 200 ms, 8 kHz silent base64-encoded WAV. This lets `audio.ended` fire naturally, so the full clip lifecycle — `playNextPending` → `scheduleAutoDelete` → dot-state transition — plays through exactly as it would on a real machine. Silently, but completely. Closes the "kit demo looks frozen when you press play" papercut.
- **D2-3b — runtime fetch + splice of `app/index.html` in the kit.** New `docs/ui-kit/kit-bootstrap.js` fetches the real product's `index.html`, strips its `<script>` / `<link>` tags (they'd re-fire with wrong paths), splices the body into the kit document, then sequentially loads `tokens-window.js` → `voices-window.js` → `mock-ipc.js` → `../../app/renderer.js`. Replaces the ~100 lines of hand-duplicated DOM the kit carried in v0.3.0 — a structural drift surface that would silently break every time the product added a new `id=`. Three new regression tests guard the new shape.

### Changed

- `docs/ui-kit/index.html` shrunk from ~130 lines of mirrored DOM to a 28-line shell loading `kit-bootstrap.js`. The kit's drift surface is now structurally zero.
- Tests: **162 → 164 logic-only.** Replaced the single `kit index.html loads app/renderer.js + mock-ipc + canonical tokens` assertion with three tighter ones: `kit index.html delegates to kit-bootstrap.js`, `kit-bootstrap loads app/renderer.js + mock-ipc + canonical tokens`, and `kit fetch-splices app/index.html at runtime`.

---

## [0.3.0] — 2026-04-20

Audit-closure release. Every deferral from v0.2.0's shipping audit (11 D-tier items + 3 explicit deferrals) is now resolved. The ULTRAPLAN backlog is closed.

### Added

- **D1 — Electron 32 → 41.2.1.** `app/package.json` pin bumped; 13/13 Playwright E2E green against the new runtime. No code changes needed — Pass-4's static review held (zero relevant breakages across Electron 33-41 migration notes).
- **D2 — `safeStorage` encryption for `openai_api_key`.** Key no longer lives plaintext in `config.json`. `app/lib/api-key-store.js` writes two files on save: `openai_key.enc` (base64 of DPAPI-encrypted bytes, useless on another machine) and `config.secrets.json` (plaintext sidecar with user-only ACL set by `install.ps1`). PS hooks + `synth_turn.py` read the sidecar; `main.js` and the renderer stay on the encrypted side. First-boot migration moves any existing plaintext key out of `config.json` and blanks the field.
- **D3 — pixel-diff palette regression rig.** `scripts/palette-pixel-diff.cjs` + 24 baseline PNGs in `tests/baselines/palette/`. `npm run test:palette-diff` compares current renders to baselines at 2% tolerance. `npm run test:palette-diff:update` re-captures. Stand-alone (no Playwright-project hassle); log-only until CI tolerance is characterised.
- **D2-1 — dynamic `components.html?name=X` router** (T-2). Four per-component design-system pages (`colors-session.html`, `components-dots.html`, `component-sessions-row.html`, `components-forms.html`) replaced by one iframe-kit router with redirect stubs for the three that were pure duplicates.
- **D2-2 — docs versioning** (T-2). `scripts/archive-docs.sh` + `.github/workflows/release.yml`. On `v*` tag push, `docs/` is snapshotted to `docs/v<N>/`. v0.2 seed committed as `docs/v0.2/`. v0.1 screenshots linked from the top-level README still work.
- **D2-3 — kit iframes `app/renderer.js`** (this release's big structural move). `docs/ui-kit/` no longer ships 8 hand-rolled JSX components + `palette.js` + `kit.css`. Instead `index.html` loads the real shipping `app/renderer.js` verbatim with a new `mock-ipc.js` impersonating the full Electron IPC surface (16 invoke handlers + 8 event channels + 5 seed states). The kit **is** the product now. When `renderer.js` changes, the kit changes with it — drift is structurally impossible. Only audio playback is absent; every visual, every interaction, every timing is genuine. Pass-1 §8b closed.
- **D2-4 — PS → synth_turn IPC integrity decision** (T-2). `docs/architecture/ipc-integrity.md` captures the threat-model review of three options (HMAC / named pipe / accept trust boundary) and documents the accept-trust-boundary decision with rationale. Trust-boundary comment added to `app/synth_turn.py`'s argv parser.
- **D2-5 — `config.schema.json`** (JSON Schema draft-07). Gives VS Code + any editor honouring `json.schemas` autocomplete + validation on save. Zero runtime cost (hand-rolled `app/lib/config-validate.js` stays authoritative). Four parity tests guard schema ↔ validator drift.
- **D2-8 — action SHA pinning + Node 24 opt-in.** Every `uses:` reference in `.github/workflows/*.yml` pinned to a 40-char commit SHA with matching semver tag comment. Dependabot's github-actions ecosystem rewrites both on upgrade. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at workflow env opts action runtimes into Node 24 ahead of GitHub's June 2026 forced rollout.
- **D2-9 — CSP `'unsafe-inline'` dropped from `style-src`.** Four replacement patterns: `data-palette` attribute + generated `app/lib/palette-classes.css` (48 rules covering all 24 arrangements × non-heard/heard), `.hidden` utility class for play/pause toggle, Constructable Stylesheet (`document.adoptedStyleSheets`) for continuous mascot / Jarvis-arm / spinner-word positions, and CSP meta tag tightened from `style-src 'self' 'unsafe-inline'` to `style-src 'self'`. Three CI regression tests in the `HARDENING: renderer CSP` block catch any regression.
- **D2-11 — Playwright `globalSetup` pre-flight + `reportSlowTests`.** Fail-fast check that the Electron binary exists before the first test times out; 5 s slow-test detector catches flakiness creep.

### Closed with rationale

- **D2-10 — renderer keyed-reconciliation.** Z11's focus-bail in `renderSessionsTable` (shipped in Tier C) handles the practical 90% of state-loss cases (focus, caret, in-progress label edits, open dropdowns). Full morphdom stays deferred for v0.4+ if the state-loss surface grows.

### Fixed

- Windows full-harness CI regressions from over-greedy regex in D2-9's regression tests — both now tolerate CRLF line endings + HTML comments.
- Voice-list validation test (`scripts/run-tests.cjs`) re-pointed from `app/renderer.js` (which no longer has inline voice literals) to `app/lib/voices.json`.

### Changed

- Tests: **107 → 162 logic-only + 13 Playwright E2E.** All green on Electron 41.2.1, Node 18/20/22 matrix, Windows full harness, E2E-Windows, doc-drift guard, coverage (c8).
- `Claude Assesments/AUDIT-FINAL.md` updated with post-v0.3 Tier D-2 closure table.

---

## [0.2.0] — 2026-04-20

Large quality-of-life release built iteratively in one long session. Everything here is on top of v0.1.0.

### Added — streaming TTS
- **Streaming auto-speak.** Audio now starts ~2-3 seconds after Claude begins responding, instead of 6-24 seconds after the turn ends. Two mechanisms combine:
  - *Sentence-parallel synthesis.* Response text is split into sentences and sent to edge-tts in parallel (4-wide). Completed clips roll into the queue in order as they arrive, so the first sentence starts playing while later ones are still synthesising.
  - *Between-tool streaming via new PreToolUse hook.* Each time Claude is about to use a tool, any text written since the last synthesis gets spoken while the tool runs. Genuinely streaming audio for tool-heavy responses.
- New files: `app/synth_turn.py` (Python orchestrator — transcript extraction, sanitisation, sentence split, parallel synthesis, sync state), `app/sentence_split.py` (splitter with abbreviation / URL / decimal / paragraph-break handling), `hooks/speak-on-tool.ps1` (PreToolUse hook).
- Per-session sync state at `~/.terminal-talk/sessions/<id>-sync.json` prevents the same text being spoken twice; file-based session lock prevents hook-invocation races.
- Stop hook (`speak-response.ps1`) now spawns `synth_turn.py` detached and exits in ~150 ms instead of blocking 6-24 s during synthesis. Legacy inline path preserved as fallback if the Python script is missing.
- `install.ps1` registers the new PreToolUse hook; `uninstall.ps1` cleans it up.

### Added — toolbar UX redesign
- **Two-row layout.** 680 × 114 window: controls on top (play/pause, ±10 s, scrubber, time, clear, settings, close), dots on the bottom strip — ~30 dots fit before any clipping. Dot order flipped to oldest-left, newest-right so the row reads in playback order.
- **Session-run grouping.** Visual gaps on the dot strip between runs from different terminals, so you see at a glance which terminal said what without reordering playback.
- **Edge snapping.** Drag the toolbar anywhere; release within 20 px of the top or bottom edge and it snaps flush. Horizontal-only (no left / right vertical dock — that was shipped then pulled in the pre-release for an unrecoverable-state bug on multi-monitor setups). Position and dock edge persist across launches.
- **Auto-collapse / hover-expand.** 15 s of no interaction → bar shrinks to a 14 px strip and becomes click-through so clicks pass to apps below. Hover, new clip, or keystroke → expands back. Deferred while audio is playing or unplayed clips remain in the queue, so streaming sessions don't flicker.
- **Persistent sessions.** Colour registry entries keep their slot indefinitely until removed via a new × button on each Sessions table row. No more "labelled the session, went away for an hour, came back and the label was gone".

### Added — per-session controls
- **Mute toggle.** `🔊 / 🔇` button on each Sessions row. Muted sessions skip synthesis entirely (no edge-tts calls), are filtered from the dot strip, any currently-playing clip stops if its session gets muted, and the terminal's statusline shows a `🔇` prefix.
- **Focus toggle.** `☆ / ★` button on each Sessions row. Marking a session as focus jumps its unplayed clips to the front of the playback queue (but never interrupts a currently-playing clip). Exclusive — only one session can be focused at a time; clicking focus on another clears the prior focus. Persisted to the registry.
- **Auto-prune controls.** Playback panel has a toggle ("Auto-prune played clips") and a configurable delay (3-600 s, default 20 s). On = self-managing toolbar. Off = clips stack up for review when you return to the desk. Per-clip timers honour the manual-vs-auto-play distinction (20 s manual, 20 s auto by default).

### Changed — installer / process identity
- Electron binary copied to `terminal-talk.exe` at install time (alongside the original `electron.exe`), and Startup VBS launches the rebranded binary — Task Manager now shows "terminal-talk.exe" entries instead of anonymous "electron.exe" ones.

### Fixed
- `Ctrl+Shift+J` mic mute actually releases the microphone now. Orphan sweep plus a Python-side state-file poll that tears down the `sd.InputStream` when state flips to "off". Two independent kill paths — either alone is sufficient.
- Focus-stealing toolbar. `win.show()` on every clip was grabbing focus mid-type; switched to `showInactive()` for queue-driven shows and downgraded `alwaysOnTop` from `screen-saver` to `floating`.
- Robust auto-play. `playNextPending()` now has a four-tier decision: (1) priority queue (hey-jarvis clips), (2) focused session's oldest unplayed clip, (3) pending queue in arrival order, (4) fallback scan for any unplayed + unmuted clip. The old `ended` handler gate that blocked the fallback has been removed.
- Monotonic mtime on rolling release. `os.replace()` was preserving source mtime (= synth-finish time, random due to parallelism), causing playback order to skip around; now `os.utime()` stamps a monotonic counter so order matches seq.
- Active-dot pulse halo no longer clips against the window edge (window taller, overflow:hidden removed from the inner dots container).
- `speak-response.ps1` palette size corrected from 32 → 24 (matched the actual palette everywhere else).

### Added — architecture refactor (external-audit follow-up)
Three shared modules extracted from copy-pasted logic:
- **`app/lib/text.js`** — canonical `stripForTTS` (markdown → speakable prose). Replaces 4 copies (main.js, tests, synth_turn.py, speak-response.ps1). Python + PowerShell mirrors remain (can't share JS code) and are verified against the canonical on every test run by a new `STRIP-FOR-TTS PARITY` group.
- **`app/session-registry.psm1`** — shared PowerShell module for session-colour assignment: `Read-Registry`, `Update-SessionAssignment`, `Save-Registry`, `Write-SessionPidFile`. Replaces the ~80-line lowest-free-index + hash-fallback + atomic-write block that used to live copy-pasted in `statusline.ps1`, `speak-response.ps1`, and `speak-on-tool.ps1`.
- **`app/tts-helper.psm1`** — shared edge-tts + OpenAI fallback chain: `Resolve-OpenAiApiKey`, `Invoke-EdgeTts`, `Invoke-OpenAiTts`, `Invoke-TtsWithFallback`. Replaces the Invoke-TTS function + key-walker duplicated across the response and notification hooks.

Net: ~260 lines of duplication deleted. New regression-guard test groups hard-fail if any caller re-inlines the logic.

### Added — installer hardening
- `-Unattended` / `-HooksYes` / `-StatuslineYes` / `-StartupYes` flags. CI install step now uses these instead of piping newlines into stdin.
- **`requirements.txt`** pinning Python deps (edge-tts 7.2.8, openwakeword 0.6.0, onnxruntime 1.24.4, sounddevice 0.5.5, numpy 2.4.4). Dependabot raises weekly PRs; harness gates them.
- Corrupt `~/.claude/settings.json` is detected and the installer refuses to proceed (prevents mid-edit crash leaving the user with both no hooks AND a broken settings file).
- Settings.json backups auto-rotate — keep the last 5, prune older.
- Installer parses clean under strict `[ScriptBlock]::Create()` (em-dashes in UTF-8-no-BOM strings that tripped PS 5.1's ANSI codepage are gone).

### Added — security hardening
Following [Electron's 2026 security checklist](https://www.electronjs.org/docs/latest/tutorial/security) + CNCF TAG-Security hygiene guide:
- Strict **CSP** on the renderer: `default-src 'none'`, `connect-src 'none'`, `script-src 'self'`, `media-src 'self' blob: file:`. Renderer has no network fetch surface.
- **Navigation guards**: `will-navigate` blocks anything off-app, `setWindowOpenHandler` denies by default, `will-attach-webview` prevented.
- **Single-instance lock** via `app.requestSingleInstanceLock()` — duplicate launches surface the existing window and exit (fixes "5 terminal-talk.exe in Task Manager" bug).
- **Self-cleanup watchdog** runs every 30 minutes — prunes stale audio, dead-PID session files, orphan wake-word listener processes. Logs to `~/.terminal-talk/queue/_watchdog.log`.
- Repo meta: `SECURITY.md` (responsible-disclosure policy + hardening summary), `.github/dependabot.yml` (npm + pip + github-actions weekly), `.github/workflows/codeql.yml` (JS + Python + actions SAST), `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODE_OF_CONDUCT.md`.
- Workflow default-deny: `permissions: contents: read` at top of `test.yml`.
- Electron dependency pinned exactly (`32.2.0` — was `^32.2.0`).

### Added — UX (scrubber mascot)
- Native `<input type="range">` thumb replaced with an SVG overlay of the wallpaper mascot. While audio plays forward his legs bob + body scurries up-down (walk cycle). Drag the scrubber forward → legs sweep right; drag backward → mascot **rotates 180° (angry face)** + legs sweep left. Body bob skips during angry-flip to avoid transform collision.
- Scrubber now driven by `requestAnimationFrame` (~60 fps) instead of `timeupdate` (~4 fps) — mascot glides instead of stepping.
- Claude Code's 90 `tengu_spinner_words` (Moonwalking, Flibbertigibbeting, Cerebrating, Honking…) float up from the mascot's head as tiny white pixel-cloud speech bubbles with a stepped wallpaper silhouette + drop-shadow. Random order, jittered 850–1500 ms between emits.

### Added — branding
- Full-size **1280 × 800 wallpaper** (`docs/assets/wallpaper/`) of the ASCII TERMINAL TALK wordmark + pixel mascot + HEY JARVIS speech bubble. Used as the README hero + GitHub OG image.
- Per-letter 3D cast-shadow via `text-shadow` (each letter's shadow is a darker shade of its face colour, not a bevel line inside the glyph). R + TALK's L both cyan for visual through-line.
- Six annotated UI mocks in `docs/design-system/mocks-annotated.html` rendered to individual PNGs, embedded in the README's new "UI states" section.

### Fixed — bugs from external code review
- **User-visible: wrong voice config keys** in `synth_turn.py`. Read `voices.response_voice` (doesn't exist) and `voices.openai_api_key` (wrong nesting) — so changing the global response voice in the settings panel silently did nothing, and the streaming OpenAI fallback never fired. Now reads `voices.edge_response` and root-level `openai_api_key` to match the JS writer.
- **Speech-includes defaults drift**: Python had `bullet_markers=True, image_alt=True` while JS had `false, false`. Streaming hook was speaking bullet markers the clipboard-speak flow wasn't. Flipped Python to match JS. Lock-step now enforced by test group `JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP`.
- **Stale palette bound**: `set-session-index` clamped to 31 but palette is 24 (0–23). Valid IPC input was rejected by the registry sanitiser → silent UI/registry drift. Clamp now 23.
- **Silent edge-tts sentence drops**: one-shot failures with no retry + no log meant ~1 sentence per turn could vanish. Now retries 3× with 0.4/0.8 s backoff; final failure logs an 80-char preview of the lost sentence to `_hook.log`.
- **Settings-panel flicker at bottom edge**: the off-screen rescue tested the whole window's centre, which with the panel open was below the work area → rescue yanked the window back mid-drag. Now tests only the 114 px bar region.
- **`applyDock('bottom')` slammed the panel shut**: hard-coded collapsed height. Now reads current height, preserves whichever state the user was in.
- **Panel-open while bottom-docked grew off-screen**: `setSize` kept y fixed. Now uses `setBounds` with y-adjust so the panel grows *upward* from a bottom-docked bar.
- **Space / Arrow keys hijacked typing**: toolbar's renderer listened for `Space` / `ArrowLeft` / `ArrowRight`, which fired when the user had recently clicked the bar and then typed in another app. Removed — pause is `Ctrl+Shift+P` / `Ctrl+Shift+O` globals. Kept Escape with a `document.hasFocus()` guard.
- **Vertical left/right dock removed entirely**: unrecoverable-state bug on multi-monitor rearrangement (bar stuck vertical mid-screen with no drag path back). Horizontal-only snap (top/bottom) now. Ctrl+Shift+A stays the recovery hotkey.
- **Off-screen rescue**: if the bar ends up off every connected display (unplugged monitor, swapped laptop), it re-centres on primary-top automatically.

### Changed — docs
- README hero is the wallpaper, not the retired dots-lettered banner.
- README has a new "UI states" section with 5 annotated mocks + captions, plus a "Status: early beta · solo-maintained" banner above the marketing copy.
- CONTRIBUTING source-tree listing updated with `synth_turn.py`, `sentence_split.py`, `lib/text.js`, `session-registry.psm1`, `tts-helper.psm1`, `speak-on-tool.ps1`, `tests/e2e/`, `render-mocks.cjs`.
- SECURITY.md function name corrected: `redactSecrets()` → `redactForLog()`.
- Test counts synced across README (121 → 128), SECURITY.md (83 → 128), CONTRIBUTING (75 → 128).

### Tests
- **128 unit + 13 Playwright E2E**, all green. **+53 new tests** since the session started.
- New regression-guard groups: `STRIP-FOR-TTS PARITY`, `PS SESSION-REGISTRY MODULE IS CANONICAL`, `PS TTS-HELPER MODULE IS CANONICAL`, `JS ↔ PYTHON DEFAULTS ARE IN LOCK-STEP`, `HARDENING: renderer CSP`, `HARDENING: navigation guards`, `SELF-CLEANUP WATCHDOG`. Each hard-fails if a consolidated module gets re-inlined or a documented default flips.
- Cross-platform CI: Linux logic-only (58/58) + Windows full harness (128/128) + CodeQL (JS + Python + actions).

## [0.1.0] — 2026-04-19

Initial release.

### Added

**Voice in / out**
- Wake-word detection via `openWakeWord` (offline, CPU). Default phrase: "hey jarvis".
- Highlight-to-speak via wake word or `Ctrl+Shift+S`.
- Auto-speak Claude Code responses via Stop hook (PowerShell, opt-in at install).
- Voice notification on Claude Code permission prompts.
- TTS via Microsoft Edge neural voices (45 verified English voices).
- Optional OpenAI TTS fallback (`gpt-4o-mini-tts`) when edge-tts is unreachable.

**Floating toolbar (Electron)**
- Always-on-top letterbox bar with play/pause, ±10s skip, scrubber, time readout.
- Per-clip dot. Click to play, right-click to delete. Auto-deletes 90 s after manual play.
- Currently-playing dot has subtle white pulsing ring.
- Heard dots fade to white but keep a coloured outer ring.
- `Ctrl+Shift+A` toggles toolbar visibility.

**Per-terminal identity**
- 24 distinguishable arrangements: 8 solid colours, 8 horizontal splits, 8 vertical splits. (Quad patterns removed in the pre-release because they read as noise at 16 px.)
- Each Claude Code terminal gets a unique colour automatically (lowest-free-index assignment).
- Session colour shown three ways: dot on toolbar, emoji in terminal statusline, optional per-session voice.
- Manual colour pinning via Sessions table dropdown — pinned colours never get reassigned.
- Session labels — set a name; appears next to the emoji in the statusline (e.g. `🟢 Frontend`).

**Per-session controls**
- Per-session voice override — pick any of 45 Edge voices for one terminal.
- Per-session speech-includes overrides (tri-state Default / On / Off):
  - Code blocks (content kept, fences stripped when on)
  - Inline code (content kept, backticks stripped when on)
  - URLs
  - Headings
  - Bullet markers
  - Image alt-text
- Saves persist through every read/write cycle in the registry.
- Hook reads global config + merges session overrides on every turn (no restart needed).

**Mic toggle**
- `Ctrl+Shift+J` toggles wake-word listener; chimes confirm on/off.
- Mic is fully released when off (`taskkill /F /T` on the listener PID).
- State persists across restarts.

**Settings panel**
- Gear icon expands the toolbar to a panel with: playback speed slider, sessions table (label + colour + chevron expand to per-session controls), about section with ASCII banner and shortcuts cheat-sheet.
- Native dropdowns rendered dark via `nativeTheme.themeSource = 'dark'`.

**Installer (Windows)**
- `install.ps1` checks Python 3.10+ / Node 18+, pip-installs deps, pre-downloads wake-word model, npm-installs Electron, copies files to `%USERPROFILE%\.terminal-talk\`, opt-in registers Claude Code hooks + statusline + Startup shortcut.
- `uninstall.ps1` reverses everything; backs up `~/.claude/settings.json` first.
- Re-runnable safely; preserves `config.json` and session colour assignments.

**Test harness**
- 54 tests covering palette logic, filename parsing, statusline assignment, edge-tts wrapper, speech-includes filtering, voice list validation, registry round-trip, BOM handling, pinned-session preservation.
- Tests use a tmp registry path so they don't race the live install.

### Notes

- Windows-only at v0.1.0. Mac and Linux ports tracked for v0.2.
- All functionality works without any cloud account (free tier). OpenAI is optional fallback only.
- No telemetry, analytics, or remote logging anywhere in the codebase.
