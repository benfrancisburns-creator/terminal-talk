# Tonight's Video — Hattie Learning Hub Auto-Build

> **For the Claude Code session running in this terminal-talk folder.** When the user opens a Claude Code session here tonight, read this file first to understand what's being recorded.

## What we're showcasing

The video demonstrates **3-terminal automated orchestration** building a real project end-to-end:
- A watchdog terminal pinging an orchestrator
- An orchestrator (Claude Code) reading a tracker file, generating richly-contextual prompts
- A worker terminal (Codex CLI) receiving injected prompts, doing the actual work
- Screen capture running over the whole thing — but the workflow IS the demo

**Crucially**: this is NOT a staged video. It's a real build of a real learning hub for the user's daughter (Year 3/4 UK primary curriculum). The terminal-talk prompt-injection scripts are the glue that makes it work.

## The target project

- **Location:** `C:\Users\Ben\Desktop\Hattie-Learning-Hub\`
- **Mission:** Build ~85 HTML learning packs covering UK Year 3/4 National Curriculum (English, Maths, Science, Computing, History, Geography, Foundation Subjects)
- **Plan status:** Fully planned. 79 tasks itemised in `TRACKER.md`. Quality requirements in `REQUIREMENTS.md`. API contract frozen at v1.0 in `API.md`.
- **First work:** Phase 1 foundation files — `SHA-01 shared.css`, `SHA-02 shared.js`, `SHA-03 TEMPLATE.html`, `IDX-01 00-Index.html`.

Read the Hattie project's `PLAN.md`, `CLAUDE.md`, `WORKFLOW.md`, `REQUIREMENTS.md`, `PROMPTS.md`, `TRACKER.md` and `API.md` for full project context. Read `AUTO-MODE.md` for the specifics of how the 3-terminal automation works.

## The 3 terminals

| Role | Tech | Window Title | Folder | What it does |
|---|---|---|---|---|
| **Watchdog** | PowerShell (or Claude Code with /loop) | `HattieWatchdog` | terminal-talk | Every 15-20 minutes, injects a "check tracker, dispatch next task" prompt into the Orchestrator |
| **Orchestrator** | Claude Code | `HattieOrchestrator` | Hattie-Learning-Hub | Reads CLAUDE.md (auto-loaded), checks TRACKER.md for pending work, generates a brief using PROMPTS.md templates + research/, injects the brief into the Worker terminal via terminal-talk script |
| **Worker** | Codex CLI | `HattieWorker` | (any) | Receives injected briefs, completes the task (creates the HTML file at the path specified), goes idle |

Screen capture covers all three windows simultaneously — viewers see the watchdog ping → orchestrator wake → tracker check → brief generation → injection → worker building.

## The injection scripts to use (already in this folder)

These existed for terminal-talk's own video demos. Reuse them as-is:

### To inject a prompt into the Orchestrator terminal (the Watchdog does this):

```powershell
# From any PowerShell terminal:
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\Ben\Desktop\terminal-talk\scripts\send-video-terminal-prompt.ps1" `
  -Title "HattieOrchestrator" `
  -Prompt "Check the tracker. Dispatch the next available task. If a task is in-flight, check whether it's been submitted yet."
```

### To inject a brief into the Worker terminal (the Orchestrator does this):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "C:\Users\Ben\Desktop\terminal-talk\scripts\send-video-terminal-prompt.ps1" `
  -Title "HattieWorker" `
  -Prompt "<the full task brief text>"
```

Both use the title-matching path (uses Win32 EnumWindows to find a window whose title contains the string). The Orchestrator can invoke this directly via its Bash tool because it has shell access.

For long briefs (multi-KB), the clipboard-paste path is more reliable than the typing path — `send-video-terminal-prompt.ps1` is the right script. Use `type-video-terminal-prompt.ps1` only if clipboard contention is a concern.

## Launch sequence for tonight

1. **Open Windows Terminal**, create 3 tabs/panes:
   - Tab 1: rename title to `HattieWatchdog`, leave at PowerShell prompt in terminal-talk folder
   - Tab 2: rename title to `HattieOrchestrator`, `cd C:\Users\Ben\Desktop\Hattie-Learning-Hub`, run `claude` (this auto-loads CLAUDE.md → orchestrator role)
   - Tab 3: rename title to `HattieWorker`, run `codex` (or `claude` if you prefer)

   **Critical:** the Windows Terminal tab title must match the `-Title` parameter exactly (case-insensitive substring match works). Use `wt -w new nt --title HattieOrchestrator -- ...` if you want to script the open.

2. **Start screen capture** (your tool of choice — OBS, Win+G, etc).

3. **In the Watchdog terminal**, kick off the watchdog loop (script will be at `Hattie-Learning-Hub/scripts/watchdog.ps1` — to be created). Or for a quick first ping, just manually run the inject command above.

4. **In the Orchestrator terminal** — Claude greets the user with project status (per CLAUDE.md), waits for direction.

5. **First trigger** (manual or watchdog): "Check tracker, dispatch SHA-01."

6. **From there**, the loop runs itself:
   - Orchestrator picks SHA-01 → generates brief → injects into Worker
   - Worker builds `_shared/shared.css`, saves, reports "done"
   - User says to Orchestrator: "SHA-01 submitted"
   - Orchestrator reviews → passes or kicks back
   - On pass: SHA-02 becomes available → next cycle
   - Watchdog continues nudging every 20 min in case orchestrator goes quiet

## What's already built vs needs creating

**Already complete in `Hattie-Learning-Hub/`:**
- ✅ PLAN.md (master plan, ~50KB)
- ✅ CLAUDE.md (orchestrator role)
- ✅ REQUIREMENTS.md (quality gates incl. illustration accuracy)
- ✅ WORKFLOW.md (process loops)
- ✅ PROMPTS.md (brief templates with built-in QUALITY_REVIEW_CHECKLIST including SVG-specific checks)
- ✅ TRACKER.md (79 tasks ready)
- ✅ API.md (frozen v1.0 shared.js contract)
- ✅ research/ folder (10 reference files: curriculum, audience, sources, MTC spec, spelling word list)

**Needs creating tonight before launch:**
- ⏳ `Hattie-Learning-Hub/AUTO-MODE.md` — auto-orchestration spec
- ⏳ `Hattie-Learning-Hub/scripts/watchdog.ps1` — the PowerShell timer that pings the Orchestrator
- ⏳ `Hattie-Learning-Hub/scripts/inject-to-worker.ps1` — thin wrapper around terminal-talk's send-video-terminal-prompt.ps1 for the Orchestrator to use
- ⏳ `Hattie-Learning-Hub/scripts/launch-3-terminals.ps1` — opens the 3 terminals with correct titles and starts the apps
- ⏳ Updates to `Hattie-Learning-Hub/CLAUDE.md` to include the auto-mode procedure for injecting briefs

## Your role in this terminal-talk session

You (Claude Code, running in this folder tonight) are NOT building the Hattie packs. You are NOT the Orchestrator. Your role is:

1. **Pre-flight check**: verify the terminal-talk scripts referenced above still exist and work
2. **Create the scripts** listed in "Needs creating tonight" — if the user asks
3. **Help start the screen capture** and launch the 3 terminals
4. **Be ready to debug** if the injection scripts misbehave (window not found, prompt truncated, etc)
5. **Stay out of the way** of the Orchestrator session once it's running — your job becomes monitoring

You can run any of the scripts in `C:\Users\Ben\Desktop\terminal-talk\scripts\` for testing. You have shell access via Bash/PowerShell tools.

## Key technique reminder

The Win32 `SetForegroundWindow` requires the target window to be on a screen that's currently focused. If the target window is minimised or on another desktop, the inject will fail. Make sure all 3 terminals are visible on screen before the watchdog fires.

The clipboard restore at the end of `send-video-terminal-prompt.ps1` means the user's clipboard isn't trashed by injection — but if they're actively copying something at the moment of injection, there's a small race window.

## Sources

This document references:
- `C:\Users\Ben\Desktop\terminal-talk\scripts\send-video-terminal-prompt.ps1`
- `C:\Users\Ben\Desktop\terminal-talk\scripts\type-video-terminal-prompt.ps1`
- `C:\Users\Ben\Desktop\terminal-talk\scripts\send-master-video-prompts.ps1`
- `C:\Users\Ben\Desktop\terminal-talk\scripts\open-video-demo-terminals.ps1`
- `C:\Users\Ben\Desktop\Hattie-Learning-Hub\PLAN.md` and siblings
