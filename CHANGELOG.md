# Changelog

All notable changes to Terminal Talk are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Windows synth daemon** — the Phase 11 long-lived synth dispatcher
  now runs on Windows too, over a token-authenticated TCP loopback
  port advertised in `TT_HOME/synth-port.json` (Unix socket path on
  POSIX unchanged). Every hook fire previously paid a full Python
  cold-start via `Start-Process`; dispatchers now try the daemon
  first: `app/synth-dispatch.psm1` (Windows hooks),
  `app/lib/synth-client.js` (in-app transcript watcher — the hottest
  spawn site, up to one spawn per 500 ms per active session), with
  the old spawn path as automatic fallback.
- **Incremental transcript cache** (daemon only, `TT_SYNTH_DAEMON=1`).
  Transcript JSONLs are append-only, so the daemon parses each line
  once and serves unchanged reads from memory (measured: 200
  unchanged reads in ~1 ms vs a full multi-MB JSON re-parse per hook
  fire on long sessions). Partial trailing lines are deferred until
  their newline lands; truncation resets the slot.
- **Queue TTL prune in synth_turn** — clip artifacts older than 24 h
  are swept (stamp-gated, ≤1 sweep/10 min) as defence in depth behind
  `app/lib/prune.js`, which only runs while the toolbar is up.

### Fixed

- **Toolbar-off synthesis storm (2026-07-13 incident)**. With the
  toolbar closed, Claude/Codex hooks kept spawning Python + edge-tts
  and writing MP3s nobody could ever play — thousands of queue files
  and a 90-99 °C CPU for 10+ minutes on an otherwise light machine.
  Both Windows hooks now gate on toolbar liveness (`terminal-talk.exe`
  process check) before any synthesis: no player, no synth. Session
  registry + working-flag bookkeeping still runs.
- **Backlog audio dump after downtime**. Transcript entries older
  than 15 minutes are marked handled without synthesis (same state
  bookkeeping as the muted path), so the first hook fire after the
  toolbar returns speaks "from now on" instead of replaying hours of
  idle-period prose.
- **macOS `say(1)` fallback honours the configured edge voice**.
  Ben (2026-05-09): "I have the voice set as Sonia but every now and
  then I'm getting a male voice in the audio clips". Cause: when
  edge-tts timed out (transient `speech.platform.bing.com` flake),
  `_run_say_fallback` invoked `say` with no `-v` flag, falling back
  to the macOS system default voice (typically male) — so a single
  Sonia stream sporadically produced male sentences when edge had a
  bad minute. Fix: a new `_EDGE_TO_SAY_VOICE` map projects the
  configured edge voice onto the closest native macOS voice (Sonia
  → Kate, Ryan → Daniel, US Aria → Samantha, Guy → Alex, etc.) and
  `say` is invoked with `-v <native>`. The voice arg is passed
  through `synthesize_parallel` so per-session overrides apply.

## [0.7.0] — 2026-05-09

### Fixed

- **install.sh resolves brew Python before the macOS system Python**
  (#48). On Darwin the script now probes
  `/opt/homebrew/opt/python@3.13|3.12|3.11/bin/python3.X` (and the
  Intel-Mac `/usr/local/opt/...` equivalents) in version-priority
  order before falling back to PATH-resolved `python3`. Bug pre-fix:
  a fresh-shell Mac with brew Python installed but `/opt/homebrew/bin`
  not yet on PATH would bail out with "Python 3.10+ required; found
  3.9.6" — workaround was setting `TT_PYTHON_EXE` explicitly. The
  env-var override still takes priority over the probe.

### Tested

- **Queue delivery defences locked in via source-level invariants**
  (#41). Three regression-guard tests pin the existing protections
  for "queue keeps delivering when the toolbar is hidden":
  `powerSaveBlocker.start("prevent-app-suspension")` fires on app
  ready (App Nap mitigation), `notifyQueue` doesn't gate the
  `queue-updated` IPC on `win.isVisible()`, and `posix_hooks.py`'s
  synth dispatch is independent of toolbar visibility. No code
  changes needed — the protections were already there from earlier
  work; the tests prevent silent regression in a future refactor.

- **Heartbeat clips no longer churn the dot strip + tab badges**.
  Ben (2026-05-09): the H-prefix ambient-filler clips were rendering
  as visible dots and ticking the per-tab unread count up + down
  every ~8 s as each one played and auto-deleted. Both `dot-strip`
  and `tabs.update` now filter heartbeats out of their input via the
  existing `isHeartbeatClip` helper. Heartbeats stay in the master
  `queue` array (audio-player still picks them up via pendingQueue
  and plays them as designed) — they just don't render as visible
  state any more.
- **Auto-played dot is now noticeably smaller** (2 px tiny pixel
  vs. 9 px near-solid centre for manual). The earlier 4 px / 7 px
  pair read as "the same big white dot" to Ben in practice; the new
  4.5× size ratio plus stronger glow contrast gives an unmistakeable
  at-a-glance differential between autoplay-from-queue and a clip
  the user explicitly asked for via click / hey-jarvis / Ctrl+Shift+S.
- **Auto-played clips now show the small inner dot during the
  auto-continue chain** (#42 follow-up). After a user clicked a dot,
  the continuation chain was passing `manual=true` to each
  subsequent `playPath`, so every clip in the chain inherited the
  big-dot manual treatment — exactly the differential the dot-size
  fix was supposed to provide. Now the continuation passes
  `manual=false` for the visual flag (small dot, since only the
  initial click was user-driven) while preserving `userClick=true`
  so the auto-continue-after-click chain logic still chains. Source-
  level test asserts the correct `(false, true)` arg order.

### Added

- **Homebrew tap** (Phase 9 / #33) — install via `brew tap
  benfrancisburns-creator/tap && brew install terminal-talk`. Formula
  builds from source against the published `v0.6.0` tag, runs
  `install.sh --unattended --no-claude-hooks --no-codex-hooks`
  (hooks deferred because brew's build sandbox can't see
  `~/.claude` / `~/.codex`), and drops `terminal-talk` + `tt-doctor`
  shims into `HOMEBREW_PREFIX/bin`. Caveats document the post-install
  hook-registration step + the macOS first-run permission wizard.
  Tap repo: <https://github.com/benfrancisburns-creator/homebrew-tap>.
- **First-run permission wizard for macOS** (Phase 6 / #30) —
  `app/lib/first-run-wizard.js` walks first-launch users through
  the three Privacy & Security permissions Terminal Talk needs:
  Accessibility (synthetic Cmd+C for highlight-to-speak),
  Microphone (wake-word listener), Speech Recognition (voice
  commands). Each step has an "Open System Settings" button that
  deep-links via `x-apple.systempreferences:` to the right pane,
  plus "I've granted it" / "Skip" / "Done" controls. Replaces the
  generic toast on Mac; toast still fires on Windows / Linux.
  New `open-external` IPC handler with allowlisted schemes
  (`https://`, `http://`, `x-apple.systempreferences:`) so a
  compromised renderer can't trigger arbitrary protocol handlers.
  Re-runnable from any caller that imports `wireFirstRunWizard`.

### Fixed

- **Clear-played clips no longer reappear briefly during the undo
  window** (#47). Race condition: clicking "Clear all played"
  removed clips from the renderer's in-memory queue immediately
  but the actual `fs.unlink` was deferred 10 s for the Undo
  affordance. During that window, main.js's `notifyQueue()` would
  rescan the on-disk queue (files still there), fire
  `queue-updated` with the full list, and the renderer's handler
  blindly assigned `queue = files` — clips popped back, then
  disappeared again on the next `notifyQueue` after the unlink.
  Fix: filter pending-clear paths out of the incoming `files`
  array (and the `allPaths` companion list) before the
  `queue = files` assignment, so soft-deleted clips stay invisible
  during the entire undo window. Source-level invariant tests
  prevent the order-of-ops regression.

### Added

- **Action library — 12-kind developer-action taxonomy** — new
  `app/narration_library.py` recognises common developer actions
  (COMMIT, TEST, BUILD, BLOCK, PLAN, EDIT, RUN, INVESTIGATE,
  DISCOVER, DECIDE, STATUS, QUESTION) and rewrites each detected
  paragraph into a tight spoken-form template:
  - `Tests 974/974 passed; all green.` → `Tests: 974 of 974 passed.`
  - `Edited app/main.js to add the gear-icon update badge.` →
    `Edited app/main.js: add the gear-icon update badge.`
  - `Plan: 4 steps — investigate, fix, test, ship.` →
    `Plan: 4 steps, starting with investigate.`
  Each kind has a regex matcher with a confidence score (0-1);
  threshold 0.70 — pure prose passes through unchanged so the
  library is strictly additive (never lossy). Below-threshold
  matches and any internal failure return the original text.
  Wired into `synth_turn.sanitize` as the final pass before
  sentence-split, so the audit + SSML pipeline see the rewritten
  forms.

- **SSML for pauses + pronunciation in edge-tts** — new
  `app/narration_ssml.py` builds `<speak>...</speak>` payloads with:
  - `<break time="...">` between bullets (200 ms), table rows
    (400 ms), paragraphs (600 ms), headings (100 ms after);
  - `<say-as interpret-as="characters">` around 7-char hex commit
    SHAs so they spell out letter-by-letter;
  - `<sub alias="...">` for ~30 dev acronyms (npm, DMG, CLI, IPC,
    JSON, JSONL, API, SDK, etc.) and ~25 file extensions
    (`.py`→"dot py", `.json`→"dot jay son", etc.).
  Wrapper applied per-call by `synth_turn._maybe_ssml_wrap` only
  when `needs_ssml(text)` is True (commit hashes, multi-bullet,
  multi-row table, or known acronym present); pure prose stays
  plain-text. `edge_tts_speak.py` detects the `<speak` prefix and
  feeds it as SSML; on persistent failure, strips every tag and
  retries plain-text — daemon-down ≠ broken audio.

- **Synth-audit semantic categorisation + duration estimate** —
  every per-turn JSONL record now carries `category`
  (prose/list/table/code based on dominant character share) and
  `est_spoken_sec` (spoken_chars / 14, edge-tts default rate).
  The text report adds a "Retention by content category" block
  showing per-bucket retention + total audio time, so we can see
  whether (e.g.) Block A's table fixes moved table-heavy retention
  while prose-heavy stayed flat. First post-Block-A run on 248
  turns: prose 92%, list 89%, **table 56%** — confirms tables
  are the worst category by a wide margin and Block A's targeting
  was correct.

### Fixed

- **Narration regressions surfaced by the May-9 audit corpus
  (231 turns)**:
  - **Empty-header tables** now narrate every non-empty cell with a
    `col 1: ...; col 2: ...` fallback label. The 2026-05-08 fix
    (`652b640`) silently dropped tables with `| | |` blank headers
    because the row-phrase builder skipped pairs where the header
    was empty — Ben's "Commits added · CI gates · Phases done"
    summary table reduced to just `Table with 5 rows.` with no
    content. Now every non-empty cell speaks regardless of header
    state.
  - **Tables up to 25 rows** (was 10) read every row.
    The previous 10-row limit was field-tested too tight: a 12-row
    decision matrix lost 11/12 of its rows. 26-50 row tables use
    a new "abridged" mode (rows 1-3 + last 2 + omitted-count
    note); > 50 rows still falls back to the first-row sample.
  - **Angle-bracket placeholders** (`<file>`, `<one-line why>`,
    `<sha7>`) now survive into spoken text. The HTML-tag stripper
    in `_table_cell_summary` was killing every `<...>` span
    indiscriminately; restricted to entries containing real HTML
    markup chars (`=`, `"`, `/`).
  - **Synth-audit underscore false-positive** — `findMissing` no
    longer strips underscores from the `bare` form before the
    substring check. `node_modules` now stays `node_modules` and
    is also checked as `node modules` (the synth pipeline
    substitutes `_` → space). Eliminates the largest false-positive
    class in the audit JSONL.

### Added

- **Long-lived synth daemon over Unix socket (POSIX)** — `app/synth_daemon.py`
  imports `synth_turn` once at boot and dispatches per-turn synth runs
  via `~/.terminal-talk/synth.sock` (line-delimited JSON request /
  response). Saves ~80 ms cold-start + module imports per hook fire;
  on a typical turn (6-12 hooks) that's 0.5-1 s of pure overhead
  reclaimed. `posix_hooks.spawn_synth` tries the socket first with a
  200 ms connect timeout and falls through to per-hook `subprocess.Popen`
  on any failure — daemon down ≠ broken hooks. Lifecycle managed by
  `app/lib/synth-daemon.js` (POSIX-only, watchdog respawn, SIGTERM on
  app quit). Daemon log rotates at 1 MB into
  `~/.terminal-talk/queue/_synth_daemon.log`.
- **Tag-driven release pipeline** — `.github/workflows/build-release.yml`
  fires on `v*` tag pushes (or manual dry-run), builds Mac DMGs +
  zips (arm64 + x64) on `macos-latest` and Windows Setup.exe +
  Portable on `windows-latest` in parallel, then attaches every
  artefact to a GitHub Release with auto-generated notes from the
  commits since the previous tag. Pre-release marker auto-applies to
  `v*-rc*` / `-beta*` / `-alpha*` / `-dev*` tags. `docs/RELEASING.md`
  documents the playbook.
- **In-app update notifier** — `app/lib/update-checker.js` periodically
  runs `git fetch origin main` (default interval 60 min, configurable
  via `cfg.update_check_interval_min`) and counts commits ahead. When
  > 0, fires `update-available` IPC carrying `{count, subject}`; the
  renderer adds a small pulsing green dot to the gear icon (`.icon-btn.has-update::after`).
  When the user pulls out-of-band and the next probe sees count = 0,
  fires a clear so the badge drops. Quietly no-ops outside a git
  checkout (DMG / Homebrew installs). Disable knob:
  `cfg.update_check_enabled = false`.

### Documentation

- **`docs/TROUBLESHOOTING-MACOS.md`** — common Mac issues and their
  fixes: no audio, wake-word not firing, highlight-to-speak doing
  nothing, voice commands not recognised, footer audio randomised,
  auto-pause-during-dictation, custom wake words, permission resets,
  and a log-inspection cheat-sheet. README's macOS section links to
  it; first-line advice is `bash ~/.terminal-talk/tt-doctor.sh`.

### Fixed

- **Dot-size differential between auto-played and manual clips restored**
  — the inner white dot inside the active session-coloured dot now
  renders 4 px for autoplay-from-queue clips and 7 px for manual
  ("hey jarvis", Ctrl+Shift+S, click-on-dot) clips. Lets the user tell
  at a glance whether the toolbar is following the queue or reading
  something they explicitly asked for. Wired via
  `audio-player.isCurrentManual()` → `dot-strip` adds `active-manual`
  vs `active-auto` class → `styles.css` ::after pseudo with size
  differential.

### Added

- **`tt-doctor` triage script** — `bash ~/.terminal-talk/tt-doctor.sh`
  prints a one-shot pass/fail report across 7 sections: environment
  (node / python / git / brew), venv + Python deps (edge_tts /
  sounddevice / openwakeword + macOS frameworks CoreAudio / Speech /
  Quartz), hooks (Claude + Codex registered + executable), audio
  synthesis (`say(1)` + `edge-tts` round-trip), macOS TCC permissions
  (Accessibility / Microphone / Speech Recognition introspected from
  TCC.db when readable), toolbar + listener processes, and recent
  errors from `_hook.log` / `_voice.log` / `_toolbar.log`. Exit 0 on
  pass, exit 1 on failures (warnings don't fail the report). Use
  `--no-net` to skip the edge-tts probe (CI / offline). Deployed to
  `~/.terminal-talk/tt-doctor.sh` by `install.sh`.
- **Custom wake words via config.json** — `wake_words` array in
  `~/.terminal-talk/config.json` lets users pick from openWakeWord 0.6's
  canned models (`alexa`, `hey_jarvis`, `hey_mycroft`, `hey_rhasspy`,
  `timer`, `weather`) or supply absolute paths to user-trained `.onnx`
  files (< 5 MB). Invalid entries are skipped with a warning to
  `_voice.log`; config that yields zero valid entries falls back to
  `['hey_jarvis']`. Loader extracted to `app/wake_word_config.py` so
  it can be tested without the audio stack. Restart-on-write handled
  by the existing voice-listener watchdog.
- **Synth-audit diagnostic** — `npm run synth-audit` (one-shot) +
  `--watch --jsonl=path` (background watcher) compute per-turn
  shrinkage ratios and surface dropped backticked / bolded / table-
  cell / list-marker spans across the queue. Built to identify
  what gets scrubbed from spoken audio — tracker for the action-
  library effort.
- **macOS mic-watcher closes the last Windows-only feature gap** —
  `app/mic_watcher_mac.py` mirrors `mic-watcher.ps1`'s stdout protocol
  (`MIC_CAPTURED <app>` / `MIC_RELEASED`) using CoreAudio HAL's process
  audio objects (macOS 14+: `kAudioHardwarePropertyProcessObjectList`
  + `kAudioProcessPropertyIsRunningInput`). Auto-pauses TTS when
  Wispr Flow / Voice Control / Zoom / QuickTime starts capturing the
  mic; resumes when they let go. Self-excludes our own wake-word
  listener via script-name match (robust against venv symlink quirks)
  and skips Apple system daemons (`corespeechd`, `speechrecognitiond`)
  that always hold the mic for "Hey Siri".
- **One-line installer for macOS / Linux** —
  `curl -fsSL https://benfrancisburns-creator.github.io/terminal-talk/install | bash`.
  Auto-installs Homebrew if missing, `brew install`s `node + python@3.12 + portaudio`,
  clones the repo, runs `install.sh --unattended`. End-to-end ~3-10 min
  with no clicks. Re-run with `bash -s update` to pick up new commits
  (skips the brew/python/npm dance, just refreshes app code + restarts
  the toolbar). Same shape as the Homebrew / Rust / nvm install UX.
- **Per-session statusline glyph for Claude Code on macOS** —
  `app/statusline.py` mirrors `statusline.ps1`'s output contract
  (same colour, same glyph format, same ⭐/🔇 prefixes). Registered
  via Claude Code's `statusLine.command` setting in `~/.claude/settings.json`
  during install. The terminal footer now shows the session colour
  matching the toolbar's queue dot.
- **Terminal.app + iTerm2 footer scrape on macOS** —
  `app/claude_footer_scrape.py` resolves `claude_pid` → `/dev/ttysXXX`
  → terminal-app tab → grep latest "<verb> for <duration>" line via
  AppleScript. The synthesised end-of-turn footer now matches Claude
  Code's literal printed line on Terminal.app and iTerm2 (Warp /
  WezTerm / Hyper / Alacritty fall back to the verb-randomised
  format_elapsed_phrase path because they don't expose buffer content
  via AppleScript). Full Windows parity for footer accuracy.
- **Local `say`(1) TTS fallback on macOS** when every cloud TTS
  provider has refused a sentence — typically transient
  `NoAudioReceived` from edge-tts. Uses `say -o tmp.aiff` +
  `afconvert -f WAVE -d LEI16` (both ship with macOS — no extra
  dependency) to produce a WAV-format file at the synth's expected
  `.mp3` path. Voice quality is lower than neural voices, but the
  user always hears *something* instead of a silently-dropped
  sentence. Logged distinctly in `_hook.log` so audits can tell
  when the local path took over.
- **macOS port — Terminal Talk now runs natively on macOS** (in addition to
  Windows). The Electron toolbar, queue, audio playback, transcript
  watcher, on-stream/on-tool/on-stop synth pipeline, hooks (Claude Code
  + Codex), wake-word listener, highlight-to-speak (`Cmd+C` via Quartz
  CGEvent), settings panel (with HIG-glyph hotkey display: ⌃⇧S etc.),
  tray icon, and "Worked for X seconds" footer audio all work on
  macOS. See `README.md` for the brew prereqs and the install command.
  Permissions Mac will prompt for on first launch: Accessibility (for
  synthetic Cmd+C) and Microphone (for the wake-word listener).
- **`Create session` button now wires through to Terminal.app on
  macOS** via `osascript`. Picks the project folder, opens a new
  Terminal.app window in that directory, sets the tab title, and
  exec's `claude` (or `codex`). The toolbar assigns a colour to the
  session as soon as its first hook fires. iTerm2 / Warp variants can
  follow as auto-detected fallbacks behind the same entrypoint.
- **DMG + zip release artifacts for macOS** (arm64 + x64) via a
  `build:mac` script using electron-builder. Adds the `mac` block to
  `app/package.json` with the required Info.plist usage descriptions
  (`NSMicrophoneUsageDescription`, `NSAppleEventsUsageDescription`).
  Code signing is left to a future commit once the Apple Developer ID
  is in place (`identity: null`).
- **macos-latest CI runner.** New `macos-logic` job in
  `.github/workflows/test.yml` runs `scripts/run-tests.cjs
  --logic-only` on every push, catching platform-conditional
  regressions (path separators, `process.platform` branches, Quartz
  shims) before they hit a Mac user.
- **Live UI demo on the landing page.** `docs/index.html` now embeds the
  real Electron renderer in an iframe with a click-to-explore detail
  panel covering ~50 controls (every button, dot, tab, slider, and
  Settings toggle). Replaces the static screenshot galleries.
- **First-run welcome toast.** `cfg.first_run_completed` flag drives a
  one-time 15-second toast on fresh install pointing the user at the
  toolbar's location, the speak-clipboard hotkey, and the show/hide
  hotkey. Persists `true` immediately so it never re-fires.
- **Empty-selection / TTS-fail / hotkey-collision toasts.** Three
  silent failure surfaces now produce visible toast warnings:
  empty highlight-to-speak selection, all-chunks TTS failure, and
  any global hotkey that failed to register because another app
  (Wispr Flow, Voice Mode, etc.) already owns the chord.
- **`docs/MCP-API.md`** — full schema for the 5 Terminal Talk MCP
  server tools (`register_session`, `speak`, `mark_working`,
  `set_session`, `list_sessions`), with parameters, examples,
  validation rules, error codes, and Claude Desktop config snippet.
- **`TELEMETRY.md`** — durable no-telemetry policy. Spells out what
  is not collected, what's the only outbound traffic, how to verify,
  and the rule for any future deviation.
- **`docs/BUILD-WINDOWS-INSTALLER.md`** — prereqs, build commands,
  branding asset list, code-signing roadmap, sanity checklist before
  any public download. Pairs with the new electron-builder config.
- **electron-builder Windows installer scaffold.** `app/package.json`
  build block configures NSIS installer + portable .exe targets.
  Untested — needs local Windows test build before attaching to a
  release.
- **JSDoc `@typedef` for `window.api`.** Full IPC surface in
  `app/preload.js` documented with parameter types, return shapes,
  validation rules, and the disposer pattern for event subscribers.
- **"Why Terminal Talk" landing-page section.** Compares against
  Aider voice, Voice Mode, ElevenLabs MCP, and Cursor dictation;
  explains the multi-session monitoring differentiator.
- **JSON-LD SoftwareApplication schema** + missing twitter meta tags
  on the landing page so Slack/Twitter/LinkedIn previews resolve
  correctly and Google rich-results pick the right snippet.
- **GitHub Discussions enabled** for community Q&A so support
  questions stay separate from bug reports.

### Changed

- Reframed the README, landing page, docs, and in-app About copy around
  Terminal Talk as the shared voice layer for Claude Code and OpenAI Codex CLI,
  with Claude-only hook features called out separately from shared assistant
  queue/session features.
- Installer now creates user-facing Start Menu/Desktop relaunch shortcuts plus a
  dedicated **Terminal Talk Codex** shortcut; uninstall removes those shortcuts.
- **Platform story reconciled** across README, landing page FAQ, and
  install row. Mac/Linux ports now described as in-progress with
  POSIX install paths shipped and key-helper / mic-watcher as the
  remaining Windows-only blockers — single truth instead of three
  conflicting answers.
- **README install section** now lists Git as a prerequisite, links
  each prereq to its download page, documents all `install.ps1`
  flags (`-Unattended`, `-HooksYes`, `-StatuslineYes`,
  `-CodexHooksYes`, `-StartupYes`, `-DesktopShortcutYes`), and
  warns about the Windows SmartScreen prompt on first launch.
- **README screenshot galleries removed.** The live UI Kit is now
  the visual reference; static screenshots removed in favour of a
  "Try it live" callout pointing at the GitHub Pages demo.
- **File-length ceiling raised** 2650 → 2725 to accommodate the
  toast + first-run + hotkey-status additions to renderer.js and
  main.js. Long-term ratchet-back-down via planned EX9 lib
  extraction.

### Fixed

- **macOS App Nap suspended the toolbar.** Live audit caught a
  9-minute log silence between heartbeats — App Nap put the renderer
  + main event loop to sleep, queue polling stopped, a footer-clip
  synth fired during the gap and the new clip never got picked up.
  The toolbar resumed only when the user's cursor entered the bar.
  Fix: `powerSaveBlocker.start('prevent-app-suspension')` at
  `app.whenReady()`. macOS-specific; Windows / Linux ignore the
  flag harmlessly.
- **`speech_includes` defaults more permissive on first install.**
  `code_blocks`, `urls`, `bullet_markers`, `inline_code`, `image_alt`
  default to true so a freshly-installed user hears the full response
  including markdown context, instead of having to discover and toggle
  each flag separately. Per-session overrides still win as before.
- **Footer scrape drift band tightened from 0.4-2.5× to 0.85-1.20×.**
  Day-one defensive range, replaced with the field-observed actual
  range (1.00-1.01) plus a small tolerance for tool-use-pause
  variance. Closes a stale-line loophole (e.g. previous turn 60s,
  current turn 35s — old range would accept ratio=1.71 and speak the
  wrong duration).
- **Sidecar disk hygiene.** `pruneOldFiles` now also sweeps `.txt`
  and `.original.txt` transcript-panel sidecars older than 14 days,
  so the queue dir doesn't accumulate without bound (1000+ files
  observed after a day of moderate use). Audio files still prune
  on the much-shorter `staleMs` cycle as before.
- **POSIX session staleness.** The Sessions panel showed every Claude
  Code session as "closed" 10 s after the last hook fired, because
  `get-stale-sessions` only added sidecar PIDs (Windows-only) to
  `livePids` — POSIX `posix_hooks.py` writes `claude_pid` into the
  registry, never the sidecar. Now also vouches for any registry
  `claude_pid` that's still alive.
- **`install.sh --skip-npm-install` deleted `node_modules`.** The
  `rm -rf $app_dir` step ran before the tar copy (which excludes
  `node_modules`), so re-running install.sh to register hooks left
  the toolbar unable to start. Preserves and restores the existing
  `node_modules` across the rebuild.
- **`start-toolbar.sh` did not export `TT_PYTHON_EXE`** when the
  variable came from sourcing `terminal-talk.env`, so `npm start`'s
  child Electron fell back to the system `python3`. Wake-word
  listener crashed with `No module named 'numpy'` until the venv
  interpreter was picked up explicitly. Affects POSIX in general,
  not just macOS.
- **Footer-audio watcher was spawning `powershell.exe` on macOS.**
  Gated by the new `platform.supportsFooterScrape` capability flag;
  the watcher cleanly no-ops on non-Win platforms.
- **`Reset defaults` settings button relabeled to `Reset hotkeys`**
  with a tooltip clarifying scope, after a user mistook it for a
  global "reset every setting on this panel" button.
- **Window rescue + dock-bottom clamp.** Top-edge of the toolbar
  must remain on a connected display's workArea; bottom-dock can
  no longer push the top off-screen when the panel is open.
  Closes the bug where the bar persisted at `y=-190` with only
  2 px visible.
- **Silent `.catch(() => {})` swallow in `app/renderer.js`.** The
  `_finaliseClear` deleteFile loop and the capture-mode auto-open
  `setSettingsOpen` now route failures through
  `api.logRendererError` to the diagnostic log instead of
  disappearing entirely.
- **Internal scaffolding removed from public repo.** `COORDINATION.md`,
  `ASSESSMENTS/` (14 files), 6 `SESSION-HANDOFF-*.md`, 4 `VIDEO_*.md`,
  3 concept/plan docs untracked from git and added to `.gitignore`.
  Files remain on disk locally for internal use.

## [0.6.0] — 2026-04-26

Major changes since v0.5.0: a **Codex CLI integration** lands alongside
Claude Code, the **Transcript expandable panel** ships in the toolbar,
**smart tool narration** gets four iterative phases of richer context,
**markdown tables** get speakable summaries, and a **chronic Ctrl+R
freeze bug** is closed at the architectural level after multiple
symptom-patches. Also: a substantial repo-cleanup pass.

### Added

- **Codex CLI integration.** First-class support for OpenAI Codex CLI
  sessions running alongside Claude Code. Codex sessions appear in
  the Settings panel, get colour-allocated, are mutable / voiceable /
  customisable per-session, and have their `agent_message` events
  synthesised through the existing TTS pipeline.
  - **Watcher** (`app/lib/codex-session-watcher.js`): polls
    `~/.codex/sessions/` every 1s, reads delta bytes from each
    rollout `.jsonl`, extracts `event_msg → agent_message` events
    (phases `commentary` + `final`). Per-file offset tracking;
    signature dedup against rewrite-replays; per-session promise
    tail chain so within-session messages stay ordered while
    different sessions parallelise. Honours the existing
    session-registry contract for per-session overrides. Boot-time
    idempotency: pre-existing files start at `offset = size`.
  - **Launcher** (`app/codex-launch.ps1`,
    `app/codex-terminal.psm1`): launches Codex CLI in a new
    terminal with the TT badge wired so sessions are linked to
    the toolbar from the moment Codex starts.
  - **Registry persistence:** watcher touches
    `session-colours.json` on first sight of a Codex session so
    the entry stays visible with current `last_seen` and isn't
    GC'd by the stale-session sweeper.
  - **Install hint:** post-install banner shows the one-liner to
    launch Codex with TT badge.
  - **UI copy update:** empty-session state now reads
    "assistant / Codex" rather than "Claude" only.
- **Transcript expandable panel.** New collapsible UI surface in
  the toolbar showing recent clip transcripts with copy buttons
  and a Spoken/Original toggle (the latter reading
  `<clip>.original.txt` sidecars written at synth time). Backed by
  `app/lib/transcript-panel.js` + a `read-clip-sidecar` IPC. Filters
  to the currently selected session tab; doesn't cache empty
  sidecar reads so freshly-arriving clips fill in correctly.
- **Smart tool narration — phases 1, 2, 3 + Phase 3 v2.** Tool-call
  narration moves from "Reading foo.py" to genuinely descriptive
  phrases:
  - **Phase 1**: result-aware Glob + Grep counts — narrations
    include "found N matches" / "found N files".
  - **Phase 2**: Edit hunk locality from `structuredPatch` — the
    narration includes which lines changed and how many were
    added/removed.
  - **Phase 3**: enclosing-scope detection from patch context —
    when an Edit lands inside a known function, the narration
    says so ("Edit to render continuation banner in the renderer
    file"). PowerShell Verb-Noun naturalisation included.
  - **Phase 3 v2**: walks the `originalFile` content for
    enclosing scope when the patch context window is too narrow
    to reach the function header. Closes the "Phase 3 barely
    fires" finding from live testing.
- **Markdown table → speakable summary.** Both Python (`synth_turn.py`)
  and JS (`app/lib/text.js`) sanitisers replace GFM table blocks
  with a one-line summary ("Table with 3 rows. Columns: File, Line,
  Today, With Phase 3 v2.") instead of letting the raw `| col | col |`
  pipe through to edge-tts which silently refused (rc=1, size=0)
  and lost the table entirely.
- **Pipe-tail context + inline-source detection (B4 + B5).** Bash
  narration now identifies pipeline endpoints as the user-intent
  command rather than the head, and detects inline-source patterns.

### Changed

- **Tool narration peels echo headers before `;` and `|` separators.**
  `echo "===HEADER===" ; tail -c X | grep ...` now narrates as
  "Looking at the end of the hook log file" instead of "Printing a
  value (in a pipeline)" four times in a row. Previously only `&&`
  separators were peeled.
- **Tool narration deduplicates within a batch.** When an assistant
  turn issues multiple tool calls of the same shape, the listener
  hears the phrase once instead of N times. Cross-batch dedup is
  deliberately skipped.
- **Tool narration captures the path, not the flag.** `ls -lat /path`,
  `tail -c 50000 file`, `head -n 30 file` now narrate the file rather
  than capturing the flag's value. The previous regex captured the
  first whitespace-separated token, which for value-flags was the
  numeric value (e.g. "Looking at the end of 50000").
- **Click-through is now driven by main-side cursor polling.**
  `screen.getCursorScreenPoint()` polls every 80ms and sets
  `setIgnoreMouseEvents` based on cursor-vs-window-bounds.
  Replaces the renderer-driven mousemove → setClickthrough loop
  which had a chronic Windows bug: when in click-through mode,
  Electron's `forward: true` did not reliably forward cursor-entry
  events, so the renderer never saw the cursor return to the bar
  and the toolbar appeared "frozen" indefinitely.

### Fixed

- **Heartbeat fired during Wispr dictation in silent stretches.**
  Renderer's `onMicCapturedElsewhere` callback returned before
  arming `_micCaptured` when no audio was currently playing,
  silently re-introducing the bug `5a26f6f` was supposed to fix.
  Now arms the flag unconditionally — `audio-player.systemAutoPause()`
  guards the actual `pause()` call internally.
- **Ctrl+R froze the toolbar.** Resolved across four iterative fixes:
  pre-reload `setIgnoreMouseEvents(false)` symmetric to the IPC
  handler; 5s reload-grace suppressing renderer `setClickthrough(true)`
  pushes after did-finish-load; and finally the cursor-poll
  architectural change above which closed the underlying root cause.
  Source-inspection regression tests added at every layer; lesson
  recorded that source-inspection isn't enough for UI behaviour
  bugs without runtime verification.
- **`.original.txt` sidecar wired through synth call sites** so the
  Transcript panel's "Original" toggle has content to display.
- **Renderer mic-gate flag arms even during silence.** See above.
- **Stale `*-working.flag` log spam fixed.** Files are now removed
  after detection — stops the once-per-second
  `get-working-sessions: filtered N stale flag(s)` spam that was
  polluting `_toolbar.log`.
- **`.tmp_synth/*.partial` cleanup on startup.** `pruneOldFiles()`
  sweeps these out (>60s old) and rmdirs the empty directory,
  preventing orphan synth-temp files from accumulating across boots.

### Internal

- **Repo cleanup pass.** `Claude Assesments/` and `coord/`
  directories untracked from git (still on disk for active dev use).
  14 dead remote branches archived as `archive/<name>` tags +
  deleted from origin (`stream-*`, abandoned dependabot, `feat/hey-tt`,
  `transcript-panel`, `smart-tool-narration`). Branch count 23 → 9.
  Full audit trail in `.archive-notes.md`; nothing destroyed —
  every move documented and recoverable.
- **CI hygiene.** `knip.json` entry added for the
  HTML-script-loaded `transcript-panel.js` (knip can't see HTML
  script tags). File-length baselines ratcheted on `synth_turn.py`,
  `run-tests.cjs`. CI ceiling raised 2050 → 2200 to cover post-merge
  `main.js` size (TEMP — track in next extraction pass).
- **Test suite grew from ~888 to 1003+ tests.** New coverage
  includes echo-peeling, batch-dedup, flag-aware path capture,
  reload-grace IPC suppression, Ctrl+R click-through ordering
  contract, mic-captured-elsewhere callback ordering contract,
  stale-flag cleanup, Codex registry touch, Codex terminal
  identity helpers, and markdown-table summarisation in both
  sanitisers.
- **Inner `app/package.json`** version aligned `0.4.0` → `0.5.0`
  to match the outer release; outer release now bumped to `0.6.0`.
- **`/tmp/`** added to `.gitignore` for codex-launch e2e test
  artefacts.
- **Memory captured two durable lessons:** runtime-verify UI fixes
  beat source-inspection regex tests; Electron `forward: true` is
  unreliable for cursor-entry events on Windows transparent
  always-on-top windows.

## [0.5.0] — 2026-04-24

Audio-pipeline quality pass (NG / TN / HB initiatives), OpenAI
premium-TTS UI, mic-aware auto-pause, terminal-footer scrape, plus
a 221-test audit programme and assorted UX fixes surfaced by live use.

### Added

- **NG1 — smart sentence grouping.** `app/sentence_group.py` glues
  adjacent short sentences into ~300-char TTS clips respecting
  paragraph boundaries. Goodnight fixture: 3 → 2 clips; long
  explanatory response: 8+ → 4 clips. Eliminates staccato audio
  delivery from per-sentence splitting. Tuned via
  `TT_GROUP_TARGET` / `TT_GROUP_HARD_MAX` env vars.
- **TN1 — tool-call narration.** New `app/tool_narration.py` maps
  tool-use entries to ~50-char spoken phrases ("Reading
  synth_turn.py", "Running npm test --verbose", "Searching for
  class Communicate"). Emitted as ephemeral T-prefixed clips that
  auto-delete on play-end, so long tool chains don't flood the dot
  strip. Gated by `speech_includes.tool_calls` (default on).
- **HB1 + HB2 — heartbeat verb emission.** Fills audible silence
  during active-but-silent working stretches with short spinner
  verbs ("Moonwalking", "Percolating") + longer thinking phrases
  ("Thinking this through", "Just a moment"). State-driven: a new
  `hooks/mark-working.ps1` UserPromptSubmit hook writes a
  per-session working flag; Stop hook clears it; heartbeat timer
  gates strictly on flag presence. Default on; toggle via
  `heartbeat_enabled` in config.json.
- **HB3 — quieter heartbeat mix.** Heartbeat clips carry an `H-`
  filename prefix and play at 0.45× the master volume (body +
  tool-narration clips stay at 1.0×), so ambient filler reads as
  background rather than competing with real content. Ratio is
  preserved across the full master-volume slider range.
- **HB4 — mic-aware auto-pause.** A PowerShell sidecar
  (`app/mic-watcher.ps1`) polls the Windows audio-capture registry
  and pipes `MIC_CAPTURED` / `MIC_RELEASED` events to Electron.
  Terminal Talk pauses whatever's playing when another app
  (Wispr Flow, Windows Voice Access, VoIP) grabs the mic, and
  resumes when released. Clips that arrive during the dictation
  window queue up and drain in order after release — they never
  burst all at once.
- **Phase 2 transcript-watcher.** New `app/lib/transcript-watcher.js`
  polls `~/.terminal-talk/sessions/*-working.flag` every 500 ms and
  spawns `synth_turn.py --mode on-stream` against the matching
  Claude Code JSONL transcript. Audio now starts landing within
  ~2–3 s of Claude producing the first sentence, not waiting for
  the Stop hook.
- **Terminal-footer end-of-reply closer.** The Stop hook scrapes
  the exact verb Claude Code prints to the TTY ("Brewed for 8m 49s",
  "Sautéed for 1m 0s", "Cogitated for 24m 56s") via UI Automation
  against the Windows Terminal buffer and speaks it at end-of-reply.
  A parent-side 4-s `WaitForExit` guards the scrape subprocess so
  slow UIA calls can't starve the Stop hook of its `synth_turn`
  spawn window.
- **Master volume slider.** New Settings › Playback control (0–100%)
  that multiplies into every clip's base volume. Drags live during
  playback. Heartbeat clips keep their 0.45× proportion at any master
  level. Persists to `playback.master_volume` in config.json.
- **OpenAI premium-TTS Settings panel.** Full in-UI flow for entering,
  testing, and managing an OpenAI key. Key is stored encrypted via
  Electron safeStorage (DPAPI on Win, Keychain on Mac) at
  `openai_key.enc` with a user-ACL'd plaintext sidecar at
  `config.secrets.json` for PS hooks that can't reach safeStorage.
  `playback.tts_provider` (`"edge"` | `"openai"`) picks the primary
  provider; the other auto-falls-back on failure. Includes:
  - Password-masked key input row that hides once a valid key is
    saved (compact "Change key / Clear" replacement row saves a
    line of panel height).
  - Collapsible section header with a chevron; auto-collapses once
    a key is saved and the last Test passed.
  - "Prefer OpenAI as primary" pill toggle — needs a saved key to
    engage; flipping back clears gracefully.
  - "Test voice" button that synthesises a short phrase via the
    preferred provider and drops it in the queue — surfaces bad
    keys / rate-limits / network issues end-to-end. On a failed
    test, the input row auto-reveals and the section auto-expands
    so the correction path is one click.
- **On/Off pill toggles** replace the old iOS-slider checkbox
  control for panel toggles (matches the tri-state pills used in
  the per-session speech-includes grid). Consistent visual language
  across the whole settings surface.
- **2-column Playback grid.** The four single-toggle Playback rows
  (auto-continue, colour-blind, heartbeat, reload) share two rows
  instead of four — saves ~30% vertical space. Sliders + auto-prune
  (which has a side seconds input) stay full-width.
- **Mascot session-colour recolour.** The scrubber mascot takes the
  playing session's primary palette colour for the duration of its
  clips; falls back to the Claude-Code homage orange at rest.
- **Per-session tabs.** Row above the dot strip with per-session
  filter pills + unread-count badges. Auto-hides when only one
  session is active; auto-appears when a second session produces
  a clip.
- **Renderer reload via Settings button + Ctrl+R** (EX3 extension).
- **Short identifier-like inline code spoken.** Whitelist heuristic
  preserves 30-char-max tokens without parens / language operators
  (`session_id`, `/clear`, `main.js`, `pid=0`) through the inline-
  code strip — they're prose, not code, and stripping them turned
  explanatory sentences into nonsense.
- **Prose-in-fences heuristic.** Un-tagged ```-fenced blocks are
  evaluated against a syntax-signal regex set; prose-in-fences
  (forward messages, quoted logs) is spoken even with
  `code_blocks=false`. Language-tagged fences + code-signal-heavy
  content still strip.
- **Settings panel heartbeat + tool-call toggles + version readout.**

### Changed

- **Questions-first extraction removed.** The feature extracted
  every `?`-ending sentence and played it ahead of the body;
  caused order mismatches with the terminal, false positives on
  `?` inside inline code, and duplication. Audio now tracks
  terminal prose 1:1. `extract_questions()` stays in the module
  for the test harness / future re-enable.
- **Dot-strip layout — flex-start, tight 3 px gaps.** Was
  `space-evenly` briefly; that spread 4 dots across the full bar
  width. Now packs from the left at constant density, fitting ~39
  visible dots across the 680-px strip. Ordering (oldest left,
  newest right) unchanged.
- **Session-registry `/clear` migration preserves full metadata.**
  When Claude Code's `/clear` rotates session_id but keeps the
  same CLI process, the registry now re-keys the existing entry
  under the new short (matching on `claude_pid` within a 600-s
  freshness window) so colour / label / voice / mute / focus /
  speech-includes all survive the rotation.
- **Ensure-assignments protects user intent from LRU eviction.**
  Entries carrying any customisation (label, voice, muted, focus,
  speech_includes override) can't be evicted even when unpinned.
  Historic unpinned-but-labelled entries no longer get their colour
  stolen the 25th time a new session boots.
- **`uninstall.ps1` process hunt covers the rebrand.** First sweep
  now matches both `terminal-talk` and `electron` names; previously
  only `electron`, which silently missed the running toolbar after
  the commit-17bc677 rebrand.
- **Config schema + validator expanded.** Five new keys land under
  `playback.`: `master_volume`, `auto_prune_sec` (surfaced in JSON),
  `auto_continue_after_click`, `palette_variant`, `tts_provider`.
  `hotkeys.pause_resume` + `hotkeys.pause_only` now in the schema.

### Fixed — TTS sanitiser

- Triple-asterisk `***bold-italic***` no longer leaves stray `*`
  for TTS to read as "asterisk". All three mirrors (Python / JS /
  PowerShell) updated.
- Tilde `~` characters stripped before synth — edge-tts pronounces
  them as "tilda" in all contexts.
- Keyboard shortcuts inside inline code (`` `Ctrl+R` ``) preserved
  through the sanitiser, then translated to spoken form. Previously
  the inline-code strip dropped them entirely.
- All common modifier chords (Ctrl / Cmd / Shift / Alt / Win /
  Super / Meta / Option) translate to spoken form via one regex
  sweep. `Ctrl+Shift+A` now reads "control shift A" end-to-end.
- GFM double-backtick spans (`` `` `code` `` ``) no longer mis-pair
  adjacent unmatched backticks across different code spans,
  preventing paragraphs from being silently eaten between bullets.
- Bullet lists get an implicit `.` per item so stripped bullets
  don't flatten to one 500-char run-on sentence.
- Inline-code strip returns a space (not empty) in Python to match
  JS — prevents `**\`code\`**` collapsing to `****` and misaligning
  with sibling bold markers.
- Emphasis regex `\n`-excluded on every arm so a leftover single
  `*` doesn't cross-line-pair with an unrelated stray (e.g. `app/*`
  glob patterns).

### Fixed — audio pipeline

- **Mid-turn text was silent.** `find_last_user_idx` in
  `synth_turn.py` treated `tool_result` entries (they carry
  `type: 'user'` in the JSONL) as real user prompts — so every
  tool return jumped `turn_boundary` past the text Claude had just
  written, and the transcript-watcher saw "no new assistant text"
  for the rest of a multi-tool-call turn. Only the very first text
  chunk of each turn was ever synthesised. Now filters out
  `tool_result` entries; every intermediate text chunk speaks.
- **Duplicate narration during concurrent synth.** `on-stop` no
  longer re-synthesises the content `on-stream` already emitted —
  slices pending text by `partial_text_offsets` so the same
  sentences don't land twice, 3 seconds apart.
- **Scrape subprocess silent-death.** The Stop hook's
  `& powershell.exe -STA -File scrape-footer.ps1` call had no
  timeout primitive, so a slow UIA traversal (20–30 s worst-case
  under load) was killed by Claude Code's hook timeout BEFORE the
  `Stop: spawned synth_turn.py` line fired — no audio that turn
  (body OR footer). Switched to
  `System.Diagnostics.Process::Start` with a 4-s `WaitForExit`
  and `.Kill()` fall-through. Hook always reaches its synth spawn.
- **UIA apartment mismatch.** Claude Code invokes the Stop hook as
  `powershell.exe -File ...` which defaults to MTA. UIAutomation's
  `RootElement` requires STA — under MTA the process silently
  terminates. Scrape now runs in a fresh `-STA` sub-process so the
  hook's own apartment no longer matters.
- **Heartbeat flag gated on stale `last_seen` proxy.** Heartbeat
  used to keep firing for minutes after a response ended, because
  `last_seen` stayed fresh. Now gates strictly on the presence of
  the working-flag file that `mark-working.ps1` writes and the
  Stop hook clears.
- **`ALLOWED_INCLUDE_KEYS` missed `tool_calls`.** UI exposed the
  tool-call narration tri-pill but the IPC write-gate silently
  rejected it — key never reached disk. Per-session override
  looked like it persisted until the next `queue-updated` event
  re-hydrated from disk. Added to the allow-list + cross-module
  parity test.
- **PowerShell timestamp drift.** `Get-Date -UFormat %s` returns
  LOCAL seconds, not UTC, on Windows PowerShell 5.1. Flags and
  `last_seen` values written by the hooks drifted 1 h under BST
  from the JS readers that use `Date.now() / 1000` (UTC). Replaced
  with `[DateTimeOffset]::Now.ToUnixTimeSeconds()` in all five
  PS sites; cross-language invariant test locked in.
- **Narration duplication under concurrent synth.** Serialised
  concurrent `synth_turn.py` runs via the existing session lock
  so two Python processes can't race on the same session's pending
  text.
- **Palette-alloc NaN leak.** `paletteSize=0` (or any non-finite
  value) made the hash-mod fallback compute `sum % 0 = NaN`.
  Dormant in production but a defensive hardening opportunity —
  clamps to the 24 default now.
- **Mic-gate arming race.** The `_systemAutoPaused` flag must arm
  on `MIC_CAPTURED` regardless of whether audio was currently
  playing; the earlier guard only armed mid-clip, so a clip
  arriving during the dictation window slipped past `playPath`'s
  refusal check.
- **Intermittent stale working-queue flag.** Heartbeat could fire
  briefly on startup against a stale flag left over from a
  previous session kill; the worker-flag scan now treats any flag
  older than 10 min as stale.
- **Corrupt registry recovery.** When `session-colours.json` gets
  corrupted, the pre-existing archive-and-reset path now keeps a
  timestamped backup so forensic inspection is possible.

### Fixed — UX + renderer

- Click-through state starts OFF on renderer load, preventing a
  reload deadlock where the toolbar became visible but uninteractive
  until app restart.
- `setIgnoreMouseEvents` is reset to `false` on every reload so the
  new renderer is clickable even if the previous one left it ON.
- TN1 didn't fire during text-free tool chains — early-exit guard
  bypassed the tool-narration branch when `pending` text was empty.
  Now emits narrations regardless of whether new prose is pending.
- `Ctrl+Shift+A` show/hide was a three-way state machine
  (hidden / force-shown / normal) rather than a simple toggle —
  rewired to respect explicit hide latches so passive arrivals
  can't un-hide a user-initiated close.
- Settings panel `max-height` calc now accounts for the last row so
  the final control isn't clipped below the scroll threshold.

### Tests

- **+221 tests** across the 2026-04-23→24 audit programme
  (Phases 2a, 2b, 3, and 4-modules-1–6), taking the suite from 465
  to 686 unit + 28 E2E. 3 real bugs surfaced + fixed (PS timezone
  drift, schema/validator `master_volume` drift, palette-alloc NaN
  leak). 2 JS↔Python behaviour drifts documented as lock-in tests
  (single-underscore italic emphasis, code-block content shielding).
  Full programme details in `docs/` audit archive.
- **Phase 3 combinatorial matrix** exercises all 128 permutations
  of the 7 speech_includes toggles against the JS canonical
  stripForTTS + a batched-subprocess Python parity check on 16
  sampled combos.
- **Phase 4 adversarial passes** on stripForTTS (29 probes),
  palette-alloc (22), session-registry.psm1 (10), ipc-handlers
  (30), audio-player state transitions (18), clip-paths
  filename parsing (25).

### Refactor

- **EX6f series — IPC handlers factory.** Extracted all 22
  `ipcMain.handle()` registrations from `app/main.js` into
  `app/lib/ipc-handlers.js` factory (read-only → session-edit →
  panel + config-mutation → file + test-only). Main.js lost ~500
  lines of boilerplate; factory is unit-testable without an
  Electron runtime.
- **EX7 series — renderer components.** Extracted four major
  surfaces from `app/renderer.js` into component classes with a
  shared `Component` base (mount / unmount / lifecycle):
  `StaleSessionPoller`, `DotStrip`, `SessionsTable`, `SettingsForm`,
  `AudioPlayer`. Renderer.js is ~48% smaller; components are
  individually unit-testable against a fake DOM.

## [0.4.0] — 2026-04-21

v0.4 execution-tier work after the assessment passes (S1-S7) + the
v0.4 quality tier shipped. Follow-ups surfaced during assessment
triage. All but the full IPC-handler factory in main.js and the
DOM-heavy renderer chunks landed.

### Added

- **EX2 — kit demo reset button.** `↺ Reset demo` in the kit chrome
  bar re-seeds the queue without a page reload. Used while
  iterating on playback states.
- **EX3 — renderer reload.** `Ctrl+R` (window-scoped, not global)
  and a "Reload toolbar" button in Settings > Playback > Troubleshooting
  both trigger `win.webContents.reload()`. Cheap recovery when the
  toolbar gets into a weird visual state.
- **EX4 — undo-clear toast.** Clicking the trash icon now soft-
  deletes: clips disappear from the UI immediately, actual
  `deleteFile()` deferred 10 s while a "N clips cleared — Undo"
  toast is visible. Click Undo to restore; timer expiry commits
  the deletion.
- **EX5 — colour-blind-friendly palette toggle.** Settings >
  Playback adds a toggle that switches the 8-colour session
  palette to Paul Tol's "muted" scheme (proven distinguishable
  under deutan / protan / tritan). Default palette stays for
  everyone else. Closes the H3 carry-over from the v0.3.0
  assessment — both Option 1 (default hex swap in v0.3.9) and
  Option 2 now available.
- **EX9 — doc-drift scans code comments too.** `check-doc-drift.cjs`
  now sweeps `.js/.cjs/.py/.ps1/.psm1` under `app/`, `hooks/`,
  `scripts/` with 5 rules guarding against false-premise
  docstrings like the N4 "main.js has no auto-prune" claim that
  the v0.3.0 assessment caught.

### Changed

- **EX1 — absolute-path spawns for Windows system binaries.**
  `app/main.js` now spawns `C:\Windows\System32\taskkill.exe` and
  the full `WindowsPowerShell\v1.0\powershell.exe` path (via
  `SystemRoot` env) instead of short names. Closes three Sonar
  `S4036` hotspots deferred at S4 triage; Python absolute-path
  resolution stays parked because it's installed in user-space.
- **EX6a-e — main.js big-file refactor (partial).** Five
  extractions into `app/lib/`: `config-store.js`, `window-dock.js`,
  `queue-watcher.js`, `watchdog.js`, `ipc-validate.js`. Every
  module is factory-pattern-injectable so unit tests bypass
  Electron. main.js shrank 1850 → 1755 (-95 lines). 41 new unit
  tests across the five extractions; all `app/lib/` modules
  factory-style now.
- **EX7a — clip-paths helpers extracted from renderer.js.** Pure
  filename/session helpers (`extractSessionShort`,
  `paletteKeyForIndex/Short`, `isClipFile`) moved to
  `app/lib/clip-paths.js` with a UMD-lite wrapper so the same file
  works in both Node (tests) and sandboxed Electron renderer (via
  `<script src>` tag attaching `window.TT_CLIP_PATHS`). renderer.js
  shrank ~30 lines. 10 new unit tests.
- **EX8 — file-length ceiling ratcheted 3000 → 2000.**
  `file-length-baseline.json` gains an `exclusions` list;
  `scripts/run-tests.cjs` opted in (3188-line harness is big by
  design). main.js (1755) and renderer.js (1704) now both sit
  under the new ceiling.

### Tests

- **177 → 224 logic tests.** +47 covering: window-dock geometry
  (7), queue-watcher fs mocking (7), registry-lock contention
  (already landed), ipc-validate (4), clip-paths (10), EX5
  schema parity, EX6 extraction assertions.

### CI

- `pip-audit` moved to `windows-latest`. Inherent Linux
  dependency conflict (onnxruntime 1.24.x requires Py ≥3.13,
  openwakeword → tflite-runtime requires Py <3.13) made
  Ubuntu unresolvable. Windows is the actual target platform.
- `PSScriptAnalyzer` pinned to 1.25.0 + inline `-ExcludeRule`.
  1.26+ broke the `.psd1` settings-file schema.

---

## [0.3.9] — 2026-04-20

Accessibility — the 8-colour palette no longer collapses under red-green colour-blindness.

### Fixed

- **H3-palette (v0.2 carry-over, tracked in v0.3.8).** Palette slot 5 swapped from purple `#c084fc` to magenta `#ee2bbd` in `app/lib/tokens.json`. Under deuteranopia (~6 % of men) the old purple was ~30× below the distinguishability threshold against slot 4 (blue `#60a5fa`) — Δ=0.004 vs. threshold ~0.15. The new magenta measures Δ=0.124, ~30× above where it was. `COLOUR_NAMES[5]` also renamed "Purple" → "Magenta" so the Settings panel's colour picker label matches what the user sees. Regenerated `app/lib/tokens-window.js`, `docs/ui-kit/tokens.mjs`, `docs/colors_and_type.css`, and `app/lib/palette-classes.css` via `scripts/generate-tokens-css.cjs`. Pixel-diff baselines updated; all 24 arrangements within the existing 2 % tolerance.

### Chose Option 1 over Option 2

The v0.3.0 assessment tabled two fixes: Option 1 (hex swap, ~2 min, affects all users) or Option 2 (CB-friendly palette toggle in Settings, ~30 min, opt-in). Picked Option 1 because correct accessibility is the right default — Option 2 puts the discovery burden on the affected user, most of whom will blame their eyes rather than the palette. Magenta is purple's neighbour on the colour wheel so brand impact is minimal. If anyone wants the old purple back, Option 2 (toggle) is still available as a future add-on without undoing this change.

---

## [0.3.8] — 2026-04-20

Independent v0.3.0 assessment follow-up — two concrete items closed, one carry-over tracked in AUDIT-FINAL.

### Fixed

- **N4 — `app/session-registry.psm1` docstring misstated main.js prune policy.** The PS module's `Update-SessionAssignment` block claimed "main.js's no auto-prune policy", but `main.js:ensureAssignmentsForFiles` *does* auto-prune non-pinned sessions past `SESSION_GRACE_SEC = 14400` (4 h). A future contributor could have removed correct logic based on the false premise. Comment now describes the real rules: pinned-never, PID-alive-keep, last-seen-within-4h-keep, otherwise-remove.
- **N5 — `.github/workflows/release.yml` now SHA-pins `actions/checkout`.** Previously `@v4`; every other workflow uses the D2-8 SHA-pinned form. `release.yml` is the only workflow with `permissions: contents: write`, so the most privileged workflow was the only unpinned one. Now `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4.3.1` matches `test.yml`.

### Documented

- **H3-palette (carry-over from v0.2 pass 4) tracked in `Claude Assesments/AUDIT-FINAL.md`.** Purple `#c084fc` ↔ Blue `#60a5fa` collapse to Δ=0.004 under deuteranopia (~6 % of men; threshold for distinguishability ~0.15, so 30× below). Two fix options: swap purple → magenta `#ee2bbd` (Δ=0.124, one hex change + regen) or add a "colour-blind friendly" palette toggle in Settings. Deferred pending product decision. Previously untracked anywhere.

---

## [0.3.7] — 2026-04-20

Kit demo — settings panel bottom was unreachable on short viewports.

### Fixed

- **`docs/ui-kit/kit-chrome.css` now releases the panel's height cap.** `app/styles.css` sets `max-height: calc(100vh - 72px)` + `overflow-y: auto` on `.panel` so it scrolls independently inside the chromeless Electron window (72 px ≈ fixed-position bar above). In the kit the bar is `position: static` (renders in normal flow so mocks-annotated iframes size correctly), which makes the 72 px budget wrong — on short browser viewports the panel capped at roughly viewport height, the "About Terminal Talk" section truncated, and the demo controls below the panel got pushed below the fold because the panel swallowed wheel events. Kit override: `max-height: none` + `overflow-y: visible` so the panel renders at full content height and body handles all scrolling. Browser-native behaviour users already expect.

---

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
- **Two-row layout.** 680 × 144 window: controls on top (play/pause, ±10 s, scrubber, time, clear, settings, close), dots on the bottom strip — ~30 dots fit before any clipping. Dot order flipped to oldest-left, newest-right so the row reads in playback order.
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
