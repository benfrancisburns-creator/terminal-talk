# Terminal Talk Hero Video Production Pack

This file is the handoff pack for producing a new Terminal Talk hero video on a Windows laptop. It is designed for a Codex-controlled recording session where Codex acts as the **build Worker** inside a 3-terminal orchestration — Terminal Talk narrates the build as it happens, the screen capture records everything, and the resulting footage becomes a 60-90 second hero video proving the product works in a real workflow.

**The video is not staged.** The product proof comes from Terminal Talk doing its real job — speaking parallel coding sessions while a genuine overnight build progresses.

## Final Video Goal

Create a real product hero video proving that Terminal Talk turns Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop into one spoken, colour-coded workflow — by capturing it driving a genuine build.

The viewer should understand:

- Terminal Talk speaks useful assistant replies and tool progress while agents work
- Multiple agent sessions (Claude Code Orchestrator + Codex CLI Worker) operate in parallel with distinct identity
- Sessions keep clear identity through labels, colours, voices, and toolbar rows
- Auto-played and manually replayed audio clips have distinct visual states
- Hey Jarvis can speak highlighted text on demand
- Transcripts let the user compare spoken output with original text
- Focus, mute, and voice controls make parallel sessions manageable

Core message:

> Terminal Talk turns Claude Code, Codex, and desktop coding sessions into one spoken workflow, so you can keep building without reading every terminal.

---

## Tonight's Real Workflow — Hattie Hub Build

The screen capture documents an **overnight unattended build** of Phase 1 of an unrelated real project at `C:\Users\Ben\Desktop\Hattie-Learning-Hub\` (a Year 3/4 UK National Curriculum learning hub for the author's daughter). That project has been planned in detail with its own orchestration system, and tonight's run is the first real execution of it.

The build uses **three coordinated terminals** plus the Terminal Talk toolbar:

| Window title | App | Role |
|---|---|---|
| `HattieWatchdog` | PowerShell loop | Pings the Orchestrator every 20 minutes |
| `HattieOrchestrator` | Claude Code (auto-loads CLAUDE.md from the Hattie folder) | Reads `TRACKER.md`, generates rich briefs from `PROMPTS.md` + `research/` + `REQUIREMENTS.md`, injects briefs into the Worker via terminal-talk's `send-video-terminal-prompt.ps1` |
| `HattieWorker` | Codex CLI (the recording target) | Receives injected briefs, builds the actual HTML/CSS/JS files, saves them, reports done |
| `Terminal Talk` | The toolbar (this product) | Narrates every assistant reply, tool progress, and status update with colour-coded session voices |

### Why this proves Terminal Talk

The product demo emerges naturally from the workflow:

- The **Orchestrator** speaks brief generation and review responses — proves Claude Code support
- The **Worker** speaks build progress, file writes, tool calls — proves Codex CLI support
- Two colour-coded identities run in parallel on the toolbar — proves session identity
- Watchdog pings every 20 min create rhythm — proves auto-played clip flow
- Tool progress narration ("running the tests", "writing to shared.css") happens organically — proves tool narration
- The user does not have to read every terminal to follow progress — proves the core value prop

### Reference files in the Hattie project (read these for orchestration context)

If you need to understand the Hattie build's mechanics (you do — they govern most of what you film):

- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\PLAN.md` — master plan, 79 tasks across 4 phases
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\CLAUDE.md` — Orchestrator's role and process
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\AUTO-MODE.md` — the 3-terminal architecture in detail
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\TRACKER.md` — task state, updated live during the run
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\REQUIREMENTS.md` — quality gates the Orchestrator reviews against
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\PROMPTS.md` — brief templates
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\API.md` — frozen v1.0 shared.js contract
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\research/` — full curriculum reference
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\scripts\launch-3-terminals.ps1` — the launcher

### Phase 1 tasks getting built tonight

Listed in dependency order — only after each one passes does the next unblock:

1. **SHA-01** — `_shared/shared.css` (design tokens + component classes)
2. **SHA-02** — `_shared/shared.js` (the 7 modules per API.md v1.0 — NameManager, AudioEngine, Confetti, MarkEngine, ResultsCollector, ReportGenerator, ProgressTracker)
3. **SHA-03** — `_shared/TEMPLATE.html` (boilerplate using SHA-01 + SHA-02)
4. **IDX-01** — `00-Index.html` (master landing page with name input)

If Phase 1 finishes early in the night, Phase 2 (subject Info Packs) can begin in parallel.

---

## Codex's Role on the Windows Laptop

You (Codex on the Windows laptop) are NOT directing the recording or running the show. You are the **Worker** in the build. The Orchestrator drives, the Watchdog keeps pulse, the human (Ben) starts the screen capture and monitors.

Your job:

1. Sit in the `HattieWorker` terminal
2. Wait for briefs to be injected by the Orchestrator
3. Read every brief carefully — they reference the full curriculum spec, requirements, and acceptance criteria
4. Build exactly what the brief asks, at the specified file path, satisfying every requirement
5. Save the file
6. Tell the user when done (they relay "submitted" to the Orchestrator)
7. If kicked back, apply the refinement brief and re-save

**Do not modify files outside the brief's scope.** Do not invent new modules, files, or behaviours. The API contract in `API.md` is frozen at v1.0 — if you need something not in it, request the orchestrator add it.

The full task brief contains everything you need (curriculum, requirements, deliverable spec, acceptance criteria, common pitfalls). If anything is unclear, ASK before building — a kick-back wastes more time than a clarifying question.

### Paste-ready `/goal` Prompt for the Worker (under 2KB)

```text
You are the build Worker in a 3-terminal automated build of a learning hub project. Briefs will be injected into this terminal by the Orchestrator (Claude Code) running in another window. Your only job is to build what each brief asks for.

For each injected brief:
1. Read every section carefully — curriculum scope, requirements, acceptance criteria.
2. Reference C:\Users\Ben\Desktop\Hattie-Learning-Hub\ planning files (CLAUDE.md, REQUIREMENTS.md, API.md, AUTO-MODE.md, research/) only if you need extra context the brief doesn't provide.
3. Build the file at the EXACT path specified in the brief.
4. Use the shared.css and shared.js APIs documented in API.md v1.0 — do not invent new modules, methods, or storage keys.
5. Satisfy EVERY universal + pack-type + subject requirement in REQUIREMENTS.md.
6. Save the file.
7. Tell the user "TASK-ID complete" (e.g. "SHA-01 complete").

Hard rules:
- No "Claude" or AI references in user-facing output.
- No hardcoded child names — use [Name] placeholder.
- British English throughout.
- All SVG diagrams must visually match their labelled values (see REQUIREMENTS.md §1.11).
- All questions must be logically answerable from given information.
- Audio packs must use Web Speech API with a fallback for unsupported browsers.

If a brief is unclear, ASK before building. A kick-back wastes more time than a clarifying question.

If the Orchestrator kicks back the work with a refinement brief, address every specific issue listed, keep the rest unchanged, re-save, and report done again. Iteration count is recorded — pass on iteration 1 or 2 is the target.

Do not stop building until the Orchestrator marks the task passed in TRACKER.md, or the user explicitly tells you to pause.
```

---

## Production Strategy

This is a **prolonged overnight run**, not a one-shot take. The screen capture rolls for hours; useful footage gets cut from the master afterwards.

Three passes:

1. **Pre-flight pass** (5-15 min) — verify all 3 terminals are live, Terminal Talk is healthy, screen recorder is running, first brief reaches the Worker
2. **Live build pass** (overnight, several hours) — the auto-loop runs, you sleep, the recorder captures everything
3. **Pickup pass** (next morning, 15-30 min) — capture the toolbar-specific features that didn't naturally occur in the build (Hey Jarvis, transcript Spoken/Original toggle, focus/mute/voice controls)

The build provides genuine evidence for most acceptance criteria. The pickup pass covers what's left.

**Do not over-engineer the live capture.** Once the loop is running and the recording is rolling, leave it alone. Resist the urge to "fix" things at 2am — wake-up troubleshooting is more disruptive than a few wasted minutes of footage.

---

## Pre-Flight Checklist

Do not start final recording until ALL of the following are true.

### Terminal Talk
- [ ] Toolbar opens and stays open for at least 2 minutes
- [ ] Toolbar is visible, readable, and large enough that session labels, colours, queue dots, and controls are legible on the recording
- [ ] Audio playback works (system audio captured by recorder)
- [ ] Hey Jarvis wake-word responds to a quick test

### Hattie auto-build prerequisites
- [ ] `C:\Users\Ben\Desktop\terminal-talk\scripts\send-video-terminal-prompt.ps1` exists
- [ ] `C:\Users\Ben\Desktop\Hattie-Learning-Hub\` contains the full planning set (PLAN.md, CLAUDE.md, REQUIREMENTS.md, AUTO-MODE.md, TRACKER.md, PROMPTS.md, API.md)
- [ ] `Hattie-Learning-Hub\research\` folder has all 10 reference files
- [ ] `Hattie-Learning-Hub\scripts\` contains launch-3-terminals.ps1, watchdog.ps1, inject-to-worker.ps1, inject-to-orchestrator.ps1
- [ ] `Hattie-Learning-Hub\TRACKER.md` shows SHA-01 status as `pending` (not `briefed` from a prior run)

### Apps
- [ ] `claude` (Claude Code CLI) available on PATH
- [ ] `codex` (Codex CLI) available on PATH and signed in
- [ ] Windows Terminal (`wt.exe`) available

### Screen capture (Codex chooses the tool)
- [ ] Recorder is configured to capture the full screen including all 3 terminals + Terminal Talk toolbar
- [ ] Recorder captures **system audio** (so Terminal Talk's voices are in the video — this is the product proof)
- [ ] Output folder has 80+ GB free
- [ ] Recorder split or chunked at sensible intervals (so one crash doesn't lose the whole night)
- [ ] Hardware encoder enabled if available (NVENC / AMD VCE / QuickSync) so recording doesn't fight Terminal Talk for CPU
- [ ] A `WARN_RECORDING_STALE.txt` file does NOT exist at `Hattie-Learning-Hub\` (the watchdog would have written one if a previous run died)

### Optional but useful
- [ ] Watchdog will be launched with `-RecordingsDir <path>` pointing to the recorder's output folder so it can warn if recording dies overnight
- [ ] Phone or second screen positioned for occasional glance at toolbar health

If any item fails, document it and either fix it now or capture a short issue clip in the morning. Do not begin the overnight run with critical items unresolved.

---

## Launch Sequence

In order:

1. **Start the screen recorder.** Confirm the red dot or equivalent.

2. **Open a PowerShell terminal** at the Hattie hub root:
   ```powershell
   cd C:\Users\Ben\Desktop\Hattie-Learning-Hub
   ```

3. **Run the launcher.** This opens 3 Windows Terminal tabs with correct titles, starts `claude` in the Orchestrator tab and `codex` in the Worker tab:
   ```powershell
   powershell -ExecutionPolicy Bypass -File ".\scripts\launch-3-terminals.ps1" -RecordingsDir "<path-to-recordings>"
   ```

4. **Arrange windows** so they're all visible on the recording:
   - Top-left: `HattieOrchestrator` (Claude Code)
   - Top-right: `HattieWorker` (Codex CLI, this is where you, Codex on the laptop, are sitting)
   - Bottom-left: `HattieWatchdog` (PowerShell)
   - Right column or second screen: Terminal Talk toolbar
   - Adjust window sizes so labels, queue dots, and transcript text are readable

5. **Wait 10-15 seconds.** Claude Code in the Orchestrator tab boots and auto-loads `CLAUDE.md`. It will greet with a status summary.

6. **Paste the Worker `/goal` prompt** into the `HattieWorker` Codex terminal (the prompt above, under 2KB).

7. **First trigger.** Either:
   - Wait for the first watchdog ping (~30 seconds after launch by default), OR
   - Type into the Orchestrator: "Check tracker. Dispatch SHA-01."

8. **Confirm the loop is running.** Within ~60 seconds you should see:
   - Orchestrator output "Brief sent to Worker for SHA-01"
   - The brief text appearing in the Worker terminal
   - Worker starting to build
   - Terminal Talk speaking the brief and the Worker's first response

9. **Walk away.** Let the loop run.

---

## What to Film — Live Build Moments

Most acceptance criteria are proven organically by the build. Keep the recorder rolling and let these moments happen naturally. After the run, edit to highlight them.

### Organic moments (no intervention needed)

| Moment | Acceptance criterion it proves |
|---|---|
| Two terminals visible with distinct toolbar colours | Session identity, colour-coded labels |
| Orchestrator speaks "Brief sent to Worker" | Claude Code support, auto-played clip |
| Worker speaks "Building shared.css" | Codex CLI support, parallel session |
| Toolbar queue shows clips from different sessions | Audio queue with multiple sessions |
| Tool progress narration during a file write | Tool narration |
| Watchdog pings at 20-min intervals | Periodic rhythm, queue updates |
| User absent — terminals progressing alone | The core value prop: build without watching |
| First task passes review, second task unblocked | The workflow loop completing |

Don't try to "stage" these. They will happen on their own as the loop runs. Just make sure the recording is rolling.

### Pickup shots — capture in the morning (15-30 min)

These features don't occur naturally in the auto-build. Capture them separately after the overnight run. Each is a short 5-10 second clip. Use a quiet moment, the toolbar already configured with the previous night's session colours and queue history.

1. **Toolbar Create Session area** — open the toolbar Create/New Session button visibly. Hover, briefly explore. 5-8s.

2. **Audio clip auto-play vs replay state** — find an auto-played clip in the queue with the small white dot. Click to replay. Show it switching to the larger white dot. 5-8s.

3. **Hey Jarvis** — open the transcript or a terminal. Highlight a sentence. Say "Hey Jarvis". Show the priority queue item appear and play. 8-12s.

4. **Transcript Spoken / Original toggle** — open transcript panel. Show Spoken view. Click the toggle. Show Original view. 5-8s.

5. **Focus control** — toolbar settings or session row. Click Focus on one session. Show it muting the others. 5-8s.

6. **Mute control** — click a session's mute button. Visual state change. 3-5s.

7. **Voice / identity controls** — open voice picker for one session. Brief view of the option set. 5-8s.

8. **Four sessions visible together** — if practical, open Claude Desktop Code and/or Codex Desktop briefly and show them in the toolbar alongside the live Hattie session. 5-8s.

9. **Closing product shot** — toolbar with overnight session history showing the Hattie build progress. Identity, colours, queue depth all visible. 5-10s.

Pickup shots can use any of the prepared prompts further down in this file if you need to trigger fresh audio for capture.

### Hard hold rules (when to actually stop)

Stop the overnight run ONLY for these:

- Screen recorder is not actually recording (verify the file is growing — the Watchdog will warn via `WARN_RECORDING_STALE.txt` if the `-RecordingsDir` parameter was set)
- Terminal Talk has crashed and won't restart
- Auto-injection is failing repeatedly (the `send-video-terminal-prompt.ps1` script can't find the Worker window — likely cause: window minimised, title changed, or another window is matching first)
- Session identity is completely missing from the toolbar
- Audio playback is dead and won't recover after one restart

For everything else — flaky clicks, slow responses, a single failed brief, a single dead clip — keep rolling. Edit it out later.

---

## Known Issue: Codex Temp Session IDs

When a fresh Codex session spawns, Terminal Talk assigns it a temp session ID with whichever colour you pick. After the first user prompt, Codex registers itself properly and gets a different permanent session ID, but the colour stays on the old temp.

**Symptom:** the toolbar shows an empty row in your chosen colour AND a new uncoloured row that is actually the live Codex session.

**Recovery (one-time, ~20 seconds):**
1. In the Sessions panel, find the temp session in your chosen colour
2. Delete it
3. Reassign the colour to the new (real) session
4. Update the label to the intended name

Prompt injection itself is unaffected — it uses the Windows window title, not Terminal Talk's session ID. The fix is purely so the toolbar voice + identity match the actual session that's working.

Mention this in the production report as a known Terminal Talk usability issue worth fixing.

---

## Recovery Without Stopping the Recording

If something looks off, try these in order BEFORE considering a hard hold:

1. **Failed injection**: Run `inject-to-worker.ps1` manually with a short test prompt. If still failing, check window title with PowerShell `Get-Process | Where-Object MainWindowTitle -match Hattie`. Re-title if needed (Windows Terminal `Ctrl+Shift+,`).
2. **Worker stuck**: Tell the Orchestrator "the Worker isn't responding". It can issue a follow-up brief or fall back to manual relay (you copy/paste).
3. **Orchestrator quiet**: Type anything in the Orchestrator terminal to wake it. If completely unresponsive, restart with `claude` in the same folder.
4. **Watchdog stopped**: Just restart the watchdog tab — manual relay still works in the gap.
5. **Recorder dying**: Stop the recorder, start a new one, leave the rest running. You lose continuity but not the build.

All of these are short interruptions, well under the threshold for a hard hold. The Watchdog's `WARN_RECORDING_STALE.txt` is your morning canary — if it's there, you know the recording died and roughly when.

---

## Editing Plan

After the overnight run, you'll have hours of footage. Cut to 60-90 seconds.

Suggested final structure:

- 0-5s: Problem setup (multiple terminals + toolbar, you can't watch them all)
- 5-15s: The Orchestrator dispatching SHA-01 + Terminal Talk speaking the brief
- 15-25s: Worker building, Terminal Talk narrating progress
- 25-35s: Two sessions live, two voices, queue dots ticking
- 35-45s: Watchdog ping cuts through, build continues
- 45-55s: Pickup — Hey Jarvis on highlighted text
- 55-65s: Pickup — Transcript Spoken/Original toggle
- 65-75s: Pickup — Focus/Mute controls
- 75-90s: Closing — multiple sessions, queue, identity. Final logo / CTA.

Editing rules:

- Cut all waiting time
- Keep each shot 5-8 seconds
- Use zoom/crop for toolbar details (queue dots, transcript toggles, controls)
- Short captions, not chatty
- Video must make sense without audio
- Add narration over the cut, not during the screen recording
- Export MP4 1080p or higher
- Keep a compressed web version for the landing page

---

## Narration Script

Draft narration:

```text
Terminal Talk turns Claude Code, Codex, Claude Desktop, and Codex Desktop into one spoken workflow.

While your coding agents work in parallel — building, testing, reviewing — Terminal Talk speaks every reply, every tool call, and every status update through one local toolbar.

Each session gets its own colour and voice. Auto-played clips and replayed clips stay distinct. Transcripts let you audit what was spoken. Hey Jarvis turns highlighted text into priority audio.

You keep building. Your agents report back.
```

---

## Caption List

```text
Stop watching every terminal.
One toolbar. Multiple sessions. Distinct voices.
Auto-played and replayed clips stay distinct.
Hey Jarvis turns highlighted text into priority audio.
Compare spoken output with the original transcript.
Focus what matters. Quiet the rest.
Claude Code. Codex. Desktop sessions. One spoken workflow.
```

---

## Acceptance Criteria

The final video is acceptable only if it clearly proves:

- Claude Code support (the Orchestrator session — Hattie build narration)
- Codex CLI support (the Worker session — build progress narration)
- Sessions colour-coded and readable
- Audio queue receives clips from different sessions
- Auto-played and manually replayed clips have distinct states
- Hey Jarvis works (pickup shot)
- Transcript Spoken / Original comparison works (pickup shot)
- Focus / mute / session controls are visible (pickup shot)
- The workflow benefit is obvious: parallel sessions stay manageable through audio + identity

If a criterion isn't proven by live footage, the pickup pass next morning covers it.

Optional / nice-to-have if time permits:

- Claude Desktop Code joining the workflow (live or pickup)
- Codex Desktop joining the workflow (live or pickup)

---

## Fallback: Staged Scenes if Auto-Build Can't Run

If the Hattie auto-build is blocked tonight (planning gap, missing dependency, terminal-talk script broken, etc.), fall back to the original 10-scene staged shoot with prepared prompts. This was the prior plan and is preserved below verbatim.

### Prepared Prompts (used in fallback only)

Claude Code:
```text
In two short sentences, explain what this project does for a developer.
```

Codex CLI:
```text
Review this workflow in two short sentences and suggest the next practical action.
```

Claude Desktop Code:
```text
Summarise this coding task in one short paragraph.
```

Codex Desktop:
```text
Give a concise status update for this task in two sentences.
```

Hey Jarvis highlight text:
```text
Terminal Talk lets you keep working while your coding agents report back through spoken updates.
```

### Original 10-Scene Staged Sequence (fallback)

If you need to fall back, record these as discrete scenes:

1. **Problem Setup** — multiple terminals open, toolbar visible — "Stop watching every terminal."
2. **Start Claude Code From Toolbar** — toolbar Create → Claude → prepared prompt → response → audio clip — "Start Claude Code from the toolbar."
3. **Start Codex CLI From Toolbar** — toolbar Create → Codex → prepared prompt → response — "Codex joins the same spoken workflow."
4. **Desktop Sessions** — open Claude Desktop / Codex Desktop, show toolbar detecting them — "Terminal and desktop sessions stay connected."
5. **Audio Clip State Proof** — auto-play vs manual replay dots — "Auto-played and replayed clips stay distinct."
6. **Background Workflow** — both sessions working, focus away from terminals — "Keep building while agents report back."
7. **Hey Jarvis** — highlight text, trigger, priority playback — "Highlight text. Say Hey Jarvis. Hear it instantly."
8. **Transcript Audit** — open transcript, toggle Spoken/Original — "Compare spoken output with the original."
9. **Session Controls** — focus, mute, voice controls — "Focus what matters. Quiet the rest."
10. **Closing Product Shot** — all sessions visible, final logo — "Claude Code. Codex. Desktop sessions. One spoken workflow."

### Autonomous Codex Operator Prompt (fallback, when /goal can't be used)

If the live auto-build is fully off the table and you need Codex on the laptop to drive the entire shoot autonomously:

```text
You are operating a Windows laptop to produce a Terminal Talk hero video.

Your objective is to create real proof footage for a 60-90 second landing-page hero video showing Terminal Talk works with Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop, with toolbar-started sessions, colour-coded identities, spoken replies and progress, Hey Jarvis, transcripts, and focus/mute/voice controls.

Confirm the correct window, toolbar tab, button, or control is visible before every UI action. Prefer keyboard shortcuts, named windows, and prepared prompts over coordinate clicks. Coordinate clicks are allowed only after visual confirmation.

This is a prolonged production goal. Do not stop after one failed click or one slow response. Recover, route around, capture issue evidence, take pickup shots, and continue building the deliverable.

Work in this order:
1. Read docs/HERO-VIDEO-PRODUCTION-PACK.md fully.
2. Verify the pre-flight checklist.
3. Arrange screen layout (Claude Code top-left, Codex CLI bottom-left, Terminal Talk right, desktop apps on second screen if available).
4. Run a rehearsal screen recording covering the 10 staged scenes.
5. Adjust layout based on rehearsal notes.
6. Start the final master recording.
7. Capture scenes 1-10 from the production pack.
8. Capture pickup shots for anything unclear.
9. Save all raw recordings in a clearly named folder.
10. If editing tools allow, create a first rough cut: 60-90s, dead time removed, short captions, MP4 1080p+.
11. Write a final production report (captured files, working/failed criteria, raw + export paths).

Hard holds: pause final capture only if Terminal Talk repeatedly closes, audio doesn't work after recovery, toolbar session creation fails for both Claude Code and Codex CLI, session identity is missing, queue states are unprovable, or screen capture is not actually recording.

Recovery before a hard hold: restart Terminal Talk once, restart the affected app once, keyboard shortcuts, smaller prompt, manual session open, close-up pickup, issue clip.

Real UI proof matters more than a perfect advert.
```

---

## Sources & References

- Terminal Talk scripts used for prompt injection: `scripts/send-video-terminal-prompt.ps1`, `scripts/type-video-terminal-prompt.ps1`
- Hattie Learning Hub project: `C:\Users\Ben\Desktop\Hattie-Learning-Hub\`
- Hattie auto-mode spec: `Hattie-Learning-Hub\AUTO-MODE.md`
- Hattie launcher: `Hattie-Learning-Hub\scripts\launch-3-terminals.ps1`
