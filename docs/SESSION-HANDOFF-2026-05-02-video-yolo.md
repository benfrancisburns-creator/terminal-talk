# Session Handoff: Video Recording, Create Session, YOLO Restart

Date: 2026-05-02
Project: `C:\Users\Ben\Desktop\terminal-talk`
User: Ben

This handoff exists because the current working session has run overnight and contains a lot of important context. The next session is expected to be started in a less restrictive / YOLO mode so it can work without repeated permission prompts.

Start the next Codex session with:

```powershell
codex --dangerously-bypass-approvals-and-sandbox
```

Then give it this prompt:

```text
Read docs/SESSION-HANDOFF-2026-05-02-video-yolo.md in full. Do not launch or close anything until you have verified the current registry and visible Windows Terminal windows. Continue the Terminal Talk video work from there.
```

## Absolute Rules For The Next Session

These are not suggestions. They are here because the current session repeatedly made these mistakes.

1. Do not launch new demo terminals until stale demo windows have been verified closed at the visible-window level.
2. Do not trust the Terminal Talk registry alone. Registry rows can be clean while old Windows Terminal windows are still visible.
3. Do not trust process rows alone. A stale Windows Terminal window can remain after its Claude/Codex child process exits.
4. Before every recording attempt, enumerate visible Windows Terminal windows and their bounds.
5. Never open fresh demo terminals over existing demo terminals.
6. Never assume "wrong monitor" means "wrong tab". Earlier the mistake was separate windows opening on the primary screen, not tabs inside the Codex chat terminal.
7. Do not claim a step is done until all three are checked:
   - registry state
   - live process state
   - visible Windows Terminal window bounds
8. The video product path is Terminal Talk Settings -> Sessions tab -> Create session. Helper scripts can be used for smoke tests, but the video should not make helper scripts look like the product.
9. The main proof video should use terminal-read narration. The assistants' own responses become the spoken Terminal Talk narration.
10. Use exact terms:
    - "Create session", not "creator_session".
    - Audio clips share the same toolbar strip.
    - Each terminal keeps its own queue identity.
    - Do not say all terminals go into "the same queue".

## Why This Handoff Is So Detailed

The video planning work has shifted significantly:

- Earlier videos were synthetic or narrow feature clips.
- Ben rejected the newer videos because several had cursor/silence/audio problems.
- We moved toward a fresh video set rather than patching old files.
- The core proof video is now based around Terminal Talk creating real Claude Code and Codex sessions.
- The narration should come from the terminals themselves, not from a separate voiceover.
- We now have a Create Session feature and deterministic Windows Terminal placement support.
- A real Codex short-ID collision was found during testing and fixed.
- The Settings panel now uses top tabs instead of one long scrolled page.

The next session must not "remember vaguely"; it must follow this handoff operationally.

## Old Video Problems Ben Listed

These files were called out as bad or needing replacement:

- `docs/videos/terminal-talk-transcript-spoken-original.webm`
  - Interrupted by mouse movement.
- `docs/videos/terminal-talk-settings-sessions.webm`
  - Interrupted by mouse movement.
- `docs/videos/terminal-talk-session-sync-controls.webm`
  - Cursor idle on screen.
- `docs/videos/terminal-talk-queue-jarvis.webm`
  - Cuts in mid narration.
- `docs/videos/terminal-talk-overview.webm`
  - About 11 seconds of silence from seconds 19 to 29.
- `docs/videos/terminal-talk-openai-api-key.webm`
  - Connectivity window visible.
- `docs/videos/terminal-talk-local-command-center-ad.webm`
  - Narration doubled in places.

Ben also said the original videos were better than the newer set. The plan is now a new, better set.

## Feature/Story Direction Now

The product story is no longer just "read assistant output". It is:

1. Terminal Talk can launch Claude Code and Codex sessions from Settings.
2. Each launched terminal is tied to a project folder, label, colour, and permission mode.
3. Claude Code registers immediately through its statusline.
4. Codex starts as provisional and binds after its first conversation/hook event.
5. Multiple sessions feed one toolbar strip while keeping separate terminal queue identities.
6. Each terminal has a distinct label, colour, and voice.
7. The transcript shows recent spoken messages; it is not just an audio player.
8. The collapsed toolbar is minimal but flashes the speaking session colour.
9. Jarvis remains separate from Page Harvest and from assistant sessions.
10. Page Harvest is parked, not part of the current video pass.

## Current Planned Main Video

Title in planning docs:

```text
Create Sessions: Four Terminals, One Toolbar
```

Purpose:

```text
Prove Terminal Talk can create and track real Claude Code and real Codex sessions from its own Settings panel, then use those terminals as the narration source for the video.
```

Main message:

```text
Terminal Talk launches Claude Code and Codex into project terminals, then keeps their responses in one toolbar while preserving separate colours, labels, voices, queues, transcript entries, and collapsed-state colour flashes.
```

## Two-Screen Recording Plan

Use one recording region spanning two monitors if possible.

Terminal screen:

- Four Windows Terminal windows in quadrants.
- Top-left: `Claude TT A`
- Top-right: `Codex TT A`
- Bottom-left: `Claude TT B`
- Bottom-right: `Codex TT B`

Toolbar screen:

- Terminal Talk toolbar.
- Start collapsed.
- Hover to show the compact toolbar.
- Click the cog to open Settings.
- Click the Sessions tab at the top of Settings.
- Show Create session and registry rows.
- Later show dot strip, tabs, transcript, and collapsed flashes.

Do not record the terminals on Ben's main conversation screen if it interferes with the current Codex chat.

## Settings Layout Update

Settings is no longer one long scrolled page. It now has top tabs:

- Playback
- Sessions
- OpenAI
- Shortcuts
- About

For video control, "Open Settings -> Sessions" means:

1. Click the cog.
2. Click the `Sessions` tab.
3. Use `Create session` and the session rows on that tab.

Automation and smoke scripts should not assume `#sessionsTable` or the About banner are visible while the Playback tab is selected. In capture/demo mode, `TT_DEMO_SETTINGS_SCROLL_TARGET=sessions` selects the Sessions tab rather than scrolling down the old long panel.

## May 3 Video Reset

Do not change the toolbar styling to make the video easier to see. Ben rejected the temporary capture CSS that made the collapsed toolbar thick. The video must use the original toolbar behaviour:

- collapsed bar stays the normal slim letterbox strip;
- collapsed colour flash uses the real `.collapsed-signal` styling;
- settings must close before proving idle collapse;
- the cursor must move away from the toolbar and wait for the configured idle delay;
- any enlargement belongs in the recording composition, using crop and scale, not app CSS.

The current guided runner crops the real toolbar window from the second display and scales that crop to fill the right side of a 2560x1080 composition. The left side shows the four terminal quadrants. This avoids wasting half the frame on an unreadable second desktop while preserving the actual product UI.

Avoid long fixed pauses. The previous rejected take had a hard wait before the collapse segment and a long silent tail. Use narrated beats while setup, generation, controls, collapse, and flash proof are happening, and trim trailing silence after muxing.

## Terminal-Read Narration Decision

Ben had a better idea than separate narration:

> Give each terminal a markdown file with cue lines. Prompt Claude/Codex to read one cue at a time. The terminal response itself is what Terminal Talk speaks.

This avoids narrator/audio conflict and proves the product.

Update after the first four-terminal proof:

The old one-cue-at-a-time model is now the fallback path. The preferred master-video path is one substantial role prompt per terminal. The four terminals must not repeat the same feature list. They should work as four proof lanes:

- `Claude TT A`: launch witness for Settings -> Sessions -> Create session, project folder, label, colour, launch mode, and first session identity.
- `Codex TT A`: traffic narrator for batch prompts, dot strip, All/per-session tabs, shared visible strip with separate session identity, and Codex binding.
- `Claude TT B`: working-user narrator for focus, mute, voices, heartbeat, tool narration, shortcuts, and settings tabs.
- `Codex TT B`: receipts and closer for transcript, spoken/original review, collapsed colour flash, Jarvis as a separate J clip, and chapterable closing proof.

Use these current files for the master take:

- `docs/video-narration/locked-master-video-plan.md`
- `docs/video-narration/master-feature-plan.md`
- `docs/video-narration/operator-master-prompt-sheet.md`
- `docs/video-narration/master-session-scripts/claude-tt-a.md`
- `docs/video-narration/master-session-scripts/codex-tt-a.md`
- `docs/video-narration/master-session-scripts/claude-tt-b.md`
- `docs/video-narration/master-session-scripts/codex-tt-b.md`
- `scripts/send-master-video-prompts.ps1`

Fast prompt command for the four-quadrant take:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-master-video-prompts.ps1 -UseQuadrantCoordinates
```

The cue files are:

- `docs/video-narration/README.md`
- `docs/video-narration/operator-cue-sheet.md`
- `docs/video-narration/claude-tt-a.md`
- `docs/video-narration/codex-tt-a.md`
- `docs/video-narration/claude-tt-b.md`
- `docs/video-narration/codex-tt-b.md`

Prompt pattern:

```text
Read docs/video-narration/claude-tt-a.md and output cue CLAUDE-A-01 only.
```

Each assistant should output one short sentence only. Terminal Talk speaks that response and logs it.

Cue-control status:

- The low-level sender exists: `scripts/send-video-terminal-prompt.ps1`.
- A cue-aware wrapper exists: `scripts/send-video-cue.ps1`.
- The wrapper maps cue IDs to the correct narration file and default terminal title.
- It does not launch terminals. It only focuses/clicks an already-visible terminal and pastes the cue prompt.

Examples:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CLAUDE-A-01
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CODEX-B-07
```

If title matching is unreliable during the recording, pass click coordinates for the terminal input area:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 `
  -Cue CODEX-A-01 `
  -ClickX 420 `
  -ClickY -620
```

## Important Cue Meanings

Registration:

- `CLAUDE-A-01`: Claude Code has registered immediately through Terminal Talk's session registry.
- `CODEX-A-01`: Codex joins Terminal Talk when the first conversation event reaches the hook.
- `CLAUDE-B-01`: A second Claude Code session gets its own colour instead of reusing the first one.
- `CODEX-B-01`: A second Codex session registers separately, even when Codex IDs look similar.

Queue/identity:

- `CLAUDE-A-04`: The audio clips share one toolbar strip, but each terminal keeps its own queue.
- `CODEX-A-04`: Codex clips appear beside Claude clips, but my queue identity stays separate.
- `CLAUDE-B-04`: Per-session voices make it easier to identify the source by ear.
- `CODEX-B-04`: Each terminal can queue audio without losing its own session identity.

Transcript:

- `CLAUDE-A-05`: The transcript keeps the recent spoken messages, so the toolbar is not just audio.
- `CODEX-A-05`: The transcript panel shows what was spoken and which session it came from.

Collapsed toolbar:

- `CLAUDE-A-06`: The collapsed toolbar flashes my session colour while I am speaking.
- `CODEX-A-06`: When the toolbar is collapsed, my colour still shows that Codex is speaking.
- `CLAUDE-B-06`: The collapsed bar stays minimal while still showing which terminal is talking.
- `CODEX-B-06`: When I speak from the collapsed toolbar, my colour identifies this Codex session.

Closing:

- `CODEX-B-07`: Four terminals can talk through one compact Terminal Talk control surface.

## Current Live State After 2026-05-02 Recovery

This supersedes the older four-demo state below. Re-check before recording.

Visible Windows Terminal windows currently preserved:

```text
Title          X     Y   W    H
TerminalTalk   -6    0   652  758
CodexVideos   634    0   652  758
```

Do not close either of these. The green `TerminalTalk` window is the preserved session that brought the work into this session.

Terminal Talk toolbar:

```text
PID    title          X      Y       W    H
33480  Terminal Talk  1840   -2162   960  1032
```

It is running against the real live home and registry:

```text
TT_HOME / install dir: C:\Users\Ben\.terminal-talk
Registry:              C:\Users\Ben\.terminal-talk\session-colours.json
Config:                C:\Users\Ben\.terminal-talk\config.json
```

Live registry rows after recovery:

```text
short     label        index  session_id                              pid
019de274  TerminalTalk 3      019de274-1b9b-7f83-a3e1-e35dfab7615e   34936
019dea8d  CodexVideos  0      019dea8d-1ccd-7e90-a861-9458163fc2fd   6968
```

Important recovery note:

- A temporary smoke-test toolbar was accidentally started against `tmp\tt-video-home\session-colours.json`, which is intentionally empty.
- That made Settings show "No active assistant sessions."
- The installed app also had a stale `lib/platform.js`, so the real toolbar briefly showed `createConfigStore: configPath required`.
- The installed `lib/platform.js` was synced from the repo, the toolbar was restarted against the real home, and Settings -> Sessions showed both live rows again.
- Do not use `tmp\tt-video-home` for the live video control toolbar unless a deliberately isolated smoke test is being run.

## Historical Four-Session State From Original Handoff

This was the state observed before writing this handoff. The next session must re-check because it may change when this session is closed/restarted.

Terminal Talk registry:

```text
short     label          index  session_id                              pid    source
019de274  TerminalTalk   3      019de274-1b9b-7f83-a3e1-e35dfab7615e   34936
e49245d7  Claude TT A    4      e49245d7-dd45-45e3-bc3c-1296671bfe11   47972  toolbar-launch:claudetta1000000
019dea5c  Codex TT A     5      019dea5c-050e-7110-b00f-c3523560289f   46868  toolbar-launch:codextta10000000
ceccd355  Claude TT B    6      ceccd355-0bf4-4023-837f-feed99becb94   53672  toolbar-launch:claudettb2000000
b7a000f0  Codex TT B     7      019dea5c-154f-7f03-bd02-d32670c6c2ca   47204  toolbar-launch:codexttb20000000
```

Important: Codex A and Codex B both had real session IDs starting with `019dea5c`. The collision fix worked: Codex B was assigned stable alternate registry short `b7a000f0`.

Visible Windows Terminal windows observed through UI Automation:

```text
name             left   top    right  bottom  width  height
Claude Code     -1512  -1620    -72    -846   1440   774
Codex TT A        -72  -1620   1368    -846   1440   774
Claude Code     -1512   -846    -72     -72   1440   774
Codex TT B        -72   -846   1368     -72   1440   774
TerminalTalk      -11    -11   1931    1139   1942   1150
```

The actual UIA bounds are DPI-scaled / physical coordinates. The logical launch bounds used were different, but Ben confirmed the placement visually worked.

The old duplicate primary-screen demo windows had been closed by posting `WM_CLOSE` to their positive-coordinate window handles. Do not assume they stay closed; verify again.

## Monitor Layout Observed

From `System.Windows.Forms.Screen.AllScreens`:

```text
Device        Primary   X      Y       Width  Height   WorkX  WorkY   WorkWidth  WorkHeight
DISPLAY1      True      0      0       1280   800      0      0       1280       752
DISPLAY2      False     880   -2162    1920   1080     880   -2162    1920       1032
DISPLAY3      False    -1008  -1080    1920   1080    -1008  -1080    1920       1032
DISPLAY4      False    -1040  -2160    1920   1080    -1040  -2160    1920       1032
```

The placement smoke test used DISPLAY3 logical coordinates and Ben confirmed the test window landed in the top-left quadrant.

Smoke test bounds that worked visually:

```text
TT_CREATE_SESSION_WINDOW_POS=-1008,-1080
TT_CREATE_SESSION_WINDOW_SIZE=96,24
TT_CREATE_SESSION_WINDOW_BOUNDS=-1008,-1080,960,516
```

Four-session launch bounds used in the successful quadrant smoke:

```text
Claude TT A: -1008,-1080,960,516
Codex TT A:    -48,-1080,960,516
Claude TT B: -1008, -564,960,516
Codex TT B:    -48, -564,960,516
```

## Settings UI Placement Status

This is very important.

The successful quadrant placement was first proven by launching `assistant-wt-launch.ps1` with environment variables from the shell.

The Settings UI path now calls `launchAssistantSession(payload)` in `app/main.js`. That function passes these env vars to `assistant-wt-launch.ps1`:

- `TT_CREATE_SESSION_KIND`
- `TT_CREATE_SESSION_PROJECT_DIR`
- `TT_CREATE_SESSION_INITIAL_LABEL`
- `TT_CREATE_SESSION_INITIAL_INDEX`
- `TT_CREATE_SESSION_LAUNCH_TOKEN`
- `TT_CREATE_SESSION_LAUNCH_MODE`
- `TT_CREATE_SESSION_WINDOW_TITLE`
- `TT_CREATE_SESSION_LAUNCHER`
- `TT_CREATE_SESSION_WT_TITLE`
- `TT_CREATE_SESSION_TAB_COLOR`
- `TT_CREATE_SESSION_WINDOW_POS`
- `TT_CREATE_SESSION_WINDOW_SIZE`
- `TT_CREATE_SESSION_WINDOW_BOUNDS`

`app/lib/create-session-placement.js` resolves per-session placement from config/payload, and `app/main.js` passes the resolved bounds through the Settings UI launch path.

The live config was updated with placement presets:

```text
Claude TT A: -1008,-1080,960,516
Codex TT A:    -48,-1080,960,516
Claude TT B: -1008, -564,960,516
Codex TT B:    -48, -564,960,516
```

Before recording, still do a one-session Settings -> Sessions tab -> Create smoke test and verify visible Windows Terminal bounds. The code path is wired, but placement must always be visually confirmed on Ben's current monitor layout before launching all four demo terminals.

## Code Changes Made In This Session

### Codex short-ID collision fix

Files:

- `app/codex-hook-common.psm1`
- `app/codex-identify-live.ps1`
- `scripts/run-tests.cjs`

Problem found:

Codex appears to use time-ordered session IDs. When two Codex sessions start close together, their first eight hex characters can be identical. The registry previously keyed by the first eight characters, so one Codex session overwrote or absorbed the other.

Real observed failure:

```text
Codex TT A real session: 019dea27-d00e-7dc0-bfaf-a3c44508070a
Codex TT B real session: 019dea27-de3c-7433-9564-034d6699e346
Both preferred shorts: 019dea27
```

Later real observed success:

```text
Codex TT A: 019dea5c-050e-7110-b00f-c3523560289f -> registry key 019dea5c
Codex TT B: 019dea5c-154f-7f03-bd02-d32670c6c2ca -> registry key b7a000f0
```

Fix:

- Keep preferred first-8 short when safe.
- If another real session already uses that short, create a stable hash short from the full session ID.
- Reuse an existing registry key if the full `session_id` already exists.
- Log collisions:

```text
resolved short collision preferred=019dea5c resolved=b7a000f0 session=019dea5c-154f-7f03-bd02-d32670c6c2ca
```

Key functions added:

- `Get-CodexSessionHashShort`
- `Resolve-CodexRegistryShort`

Regression test added:

```text
Codex hook keeps simultaneous Codex sessions when native short ids collide
```

Focused simulation passed:

```text
2|5|7|False|1|True|52312|13592
```

Meaning:

- Two real Codex sessions kept.
- A index 5 preserved.
- B index 7 preserved.
- No provisional rows remain.
- One real key is not the preferred colliding key.
- A and B keys differ.
- PIDs preserved.

### Codex toolbar launch migration fix

Files:

- `app/codex-hook-common.psm1`
- `app/codex-launch.ps1`

Problem:

Toolbar-launched Codex sessions start as provisional rows, then need to migrate to the real Codex session ID after the hook event.

Fix:

- Use `TT_LAUNCH_TOKEN`.
- Hook migrates launch intent row to the real Codex short.
- `codex-launch.ps1` waits for hook token binding instead of guessing from rollout files when a launch token exists.

Existing targeted test:

```text
Codex hook migrates toolbar launch identity from provisional to real session short
```

### Windows Terminal placement support

File:

- `app/assistant-wt-launch.ps1`

Added params/env:

- `WindowPosition`
- `WindowSize`
- `WindowBounds`
- `TT_CREATE_SESSION_WINDOW_POS`
- `TT_CREATE_SESSION_WINDOW_SIZE`
- `TT_CREATE_SESSION_WINDOW_BOUNDS`

Placement uses two layers:

1. `wt.exe --pos X,Y --size COLUMNS,ROWS`
2. Fallback Win32 `MoveWindow` by matching the launched Windows Terminal title.

PowerShell argument-array bug fixed:

Bad dry run originally nested `--pos` / `--size` as arrays:

```text
"--pos -1008,-1080" "--size 96,24"
```

Fixed dry run:

```text
wt.exe -w new --pos -1008,-1080 --size 96,24 nt --title TerminalTalkSession ...
```

The installed app copy was synced to:

```text
C:\Users\Ben\.terminal-talk\app\assistant-wt-launch.ps1
```

### Create Session feature

Files involved:

- `app/index.html`
- `app/renderer.js`
- `app/main.js`
- `app/preload.js`
- `app/lib/ipc-handlers.js`
- `app/assistant-session-launch.ps1`
- `app/assistant-wt-launch.ps1`
- `app/codex-launch.ps1`

Feature:

Settings -> Sessions -> Create session can launch:

- Claude Code
- Codex

Inputs:

- assistant kind
- project folder
- label
- colour/index
- launch permissions
- save default profile

Permission modes:

- Claude:
  - `default`
  - `dangerous` -> `--dangerously-skip-permissions`
- Codex:
  - `default`
  - `dangerous` -> `--dangerously-bypass-approvals-and-sandbox`

Important wording correction from Ben:

Use "Dangerously skip permissions", not "dangerously set ignore permissions".

The permissions dropdown should not show stale/irrelevant values like:

- `Plan`
- `Auto`
- `Accept edits`

Those are in-session concepts or old UI mistakes, not critical launch modes.

### Settings tabbed layout

Files:

- `app/index.html`
- `app/styles.css`
- `app/renderer.js`
- `docs/app-mirror/index.html`
- `docs/app-mirror/styles.css`
- `docs/app-mirror/renderer.js`

Change:

- Settings now has top tabs: Playback, Sessions, OpenAI, Shortcuts, About.
- Only one settings page is visible at a time.
- `settingsScrollTarget=sessions` now selects the Sessions tab.
- The demo cursor helpers switch tabs before pointing at controls inside hidden pages.
- Settings tab row is sticky inside the panel.

Tests updated:

- `tests/e2e/helpers.ts`
- `tests/e2e/settings.spec.ts`
- `tests/e2e/sessions.spec.ts`
- `tests/e2e/production.spec.ts`

### Window/capture toolbar fixes

Files:

- `app/main.js`
- `app/styles.css`

Changes:

- Window/capture mode is frameless and shadowless by default, so the toolbar no longer shows a native top tab labelled `Audio`.
- Window/capture mode uses wider panel sizing and hides horizontal overflow.
- Capture/window mode no longer runs normal edge snap docking. That snap path was shrinking the capture toolbar back to 680 px and pushing it half off screen.

Current aligned toolbar bounds:

```text
Terminal Talk: x=1840 y=-2162 w=960 h=1032
```

### Cue-control wrapper

File:

- `scripts/send-video-cue.ps1`

Purpose:

- Send a cue prompt to the right existing terminal without retyping the full operator prompt.
- Maps `CLAUDE-A-*`, `CODEX-A-*`, `CLAUDE-B-*`, `CODEX-B-*` to the correct narration file and default terminal title.
- Delegates to `scripts/send-video-terminal-prompt.ps1`.

Examples:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CLAUDE-A-01
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CODEX-B-07
```

## Docs Added Or Updated

Added:

- `docs/video-narration/README.md`
- `docs/video-narration/operator-cue-sheet.md`
- `docs/video-narration/claude-tt-a.md`
- `docs/video-narration/codex-tt-a.md`
- `docs/video-narration/claude-tt-b.md`
- `docs/video-narration/codex-tt-b.md`

Updated:

- `docs/VIDEO_SESSION_PLAN.md`
  - Main Video 1 is now "Create Sessions: Four Terminals, One Toolbar".
  - Uses two-screen layout.
  - Uses terminal-read narration.
  - Includes four sessions and quadrant layout.
  - Includes reject criteria for duplicate old windows.

- `docs/VIDEO_PRODUCTION_PLAN.md`
  - Non-negotiables now include Create Session from Settings.
  - Feature map includes session launcher, project folder, permission mode, placement, Codex provisional bind, collision-safe identity.
  - Behaviours now say clips share toolbar strip but keep separate per-terminal queues.
  - Video set starts with Create Sessions: four terminals, one toolbar.

- `docs/TERMINAL_SESSION_LAUNCHER_CONCEPT.md`
  - Changed from parked concept to implemented Windows recording path.
  - Video status now says include in recording.

## Commands/Checks To Run At Start Of Next Session

### 1. Check registry

```powershell
$p = Join-Path $env:USERPROFILE '.terminal-talk\session-colours.json'
$json = Get-Content -LiteralPath $p -Raw -Encoding utf8 | ConvertFrom-Json
$json.assignments.PSObject.Properties |
  ForEach-Object {
    [pscustomobject]@{
      short = $_.Name
      label = $_.Value.label
      index = $_.Value.index
      session_id = $_.Value.session_id
      pid = $_.Value.claude_pid
      source = $_.Value.source_originator
    }
  } |
  Sort-Object index,label |
  Format-Table -AutoSize
```

### 2. Check monitor layout

```powershell
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens |
  ForEach-Object {
    [pscustomobject]@{
      DeviceName = $_.DeviceName
      Primary = $_.Primary
      X = $_.Bounds.X
      Y = $_.Bounds.Y
      Width = $_.Bounds.Width
      Height = $_.Bounds.Height
      WorkX = $_.WorkingArea.X
      WorkY = $_.WorkingArea.Y
      WorkWidth = $_.WorkingArea.Width
      WorkHeight = $_.WorkingArea.Height
    }
  } |
  Format-Table -AutoSize
```

### 3. Check visible Windows Terminal windows

Use UI Automation. This is mandatory before launching anything.

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TTRectNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
Add-Type -AssemblyName UIAutomationClient
$root=[System.Windows.Automation.AutomationElement]::RootElement
$children=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$rows=@()
foreach($c in $children){
  if($c.Current.ClassName -ne 'CASCADIA_HOSTING_WINDOW_CLASS'){ continue }
  $hwnd=[IntPtr]$c.Current.NativeWindowHandle
  $rect=New-Object TTRectNative+RECT
  [void][TTRectNative]::GetWindowRect($hwnd,[ref]$rect)
  $rows += [pscustomobject]@{
    pid=$c.Current.ProcessId
    hwnd=('0x{0:X}' -f $hwnd.ToInt64())
    name=$c.Current.Name
    left=$rect.Left
    top=$rect.Top
    right=$rect.Right
    bottom=$rect.Bottom
    width=($rect.Right-$rect.Left)
    height=($rect.Bottom-$rect.Top)
  }
}
$rows | Sort-Object top,left,name | Format-Table -AutoSize
```

### 4. Check live assistant/process state

```powershell
Get-Process |
  Where-Object { $_.ProcessName -in @('WindowsTerminal','pwsh','powershell','codex','claude') } |
  Select-Object Id,ProcessName,StartTime,MainWindowTitle |
  Sort-Object StartTime |
  Format-Table -AutoSize
```

If command line details are needed:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @('pwsh.exe','powershell.exe','codex.exe','claude.exe','WindowsTerminal.exe') } |
  Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine |
  Sort-Object CreationDate |
  Format-List
```

## Safe Window Cleanup Pattern

Do not close the whole Windows Terminal process. It may contain the active TerminalTalk/Codex chat.

Instead:

1. Enumerate visible windows and bounds.
2. Identify stale demo windows by title and coordinate.
3. Post `WM_CLOSE` only to those window handles.
4. Re-enumerate windows and verify.

Example close by handles:

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TTCloseWindowNative {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
$wmClose = 0x0010
$handles = @('0xD50A60','0x18C0874','0x45D0040','0x35F048C')
foreach ($h in $handles) {
  $ptr = [IntPtr]([Convert]::ToInt64($h,16))
  [void][TTCloseWindowNative]::PostMessage($ptr, $wmClose, [IntPtr]::Zero, [IntPtr]::Zero)
}
```

Do not reuse those exact handles unless they are re-enumerated in the new session. Handles change.

## Successful Smoke Launch Script

This was used to launch four sessions into quadrants via the launcher path, not by clicking the UI.

It is useful for smoke tests, but the video should still show Create Session from the UI if possible.

```powershell
$app = Join-Path $env:USERPROFILE '.terminal-talk\app\assistant-wt-launch.ps1'
$project = 'C:\Users\Ben\Desktop\terminal-talk'

function Launch-TTDemoSession(
  [string]$Kind,
  [string]$Label,
  [int]$Index,
  [string]$Token,
  [string]$Title,
  [string]$TabColor,
  [string]$Bounds,
  [string]$Mode = 'default'
) {
  $parts = $Bounds -split ','
  $env:TT_CREATE_SESSION_KIND = $Kind
  $env:TT_CREATE_SESSION_PROJECT_DIR = $project
  $env:TT_CREATE_SESSION_INITIAL_LABEL = $Label
  $env:TT_CREATE_SESSION_INITIAL_INDEX = [string]$Index
  $env:TT_CREATE_SESSION_LAUNCH_TOKEN = $Token
  $env:TT_CREATE_SESSION_LAUNCH_MODE = $Mode
  $env:TT_CREATE_SESSION_WT_TITLE = $Title
  $env:TT_CREATE_SESSION_TAB_COLOR = $TabColor
  $env:TT_CREATE_SESSION_WINDOW_POS = "$($parts[0]),$($parts[1])"
  $env:TT_CREATE_SESSION_WINDOW_SIZE = '96,24'
  $env:TT_CREATE_SESSION_WINDOW_BOUNDS = $Bounds
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File $app | Out-Null
  Start-Sleep -Milliseconds 900
}

Launch-TTDemoSession 'Claude' 'Claude TT A' 4 'claudetta1000000' 'ClaudeTTA' '#5b8def' '-1008,-1080,960,516'
Launch-TTDemoSession 'Codex' 'Codex TT A' 5 'codextta10000000' 'CodexTTA' '#c084fc' '-48,-1080,960,516'
Launch-TTDemoSession 'Claude' 'Claude TT B' 6 'claudettb2000000' 'ClaudeTTB' '#9b6b4a' '-1008,-564,960,516'
Launch-TTDemoSession 'Codex' 'Codex TT B' 7 'codexttb20000000' 'CodexTTB' '#f3f4f6' '-48,-564,960,516'
```

## Prompt-Sending Notes

The helper script:

```text
scripts/send-video-terminal-prompt.ps1
```

Can send by window title or by click coordinates.

For cue IDs, prefer the wrapper:

```text
scripts/send-video-cue.ps1
```

Examples:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CLAUDE-A-01
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-cue.ps1 -Cue CODEX-A-01
```

Use `send-video-terminal-prompt.ps1` directly only when sending a non-cue prompt or when overriding exact title/click behavior.

Earlier mistake:

Passing fallback titles wrongly caused PowerShell to treat string fragments as `ClickX`.

Wrong:

```powershell
-FallbackTitles 'CodexTTA','Codex TT','Codex'
```

Correct if using `-Command`:

```powershell
-FallbackTitles @('CodexTTA','Codex TT','Codex')
```

Coordinate prompt example used successfully:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-video-terminal-prompt.ps1 `
  -Title 'Codex TT A' `
  -Prompt 'Reply with exactly: Codex TT A registered.' `
  -ClickX 420 `
  -ClickY -620
```

But for the actual terminal-read narration, use prompts from:

```text
docs/video-narration/operator-cue-sheet.md
```

## Installed App Sync Done

These repo files were copied into the installed app folder during the session:

```text
C:\Users\Ben\.terminal-talk\app\codex-hook-common.psm1
C:\Users\Ben\.terminal-talk\app\codex-identify-live.ps1
C:\Users\Ben\.terminal-talk\app\assistant-wt-launch.ps1
```

Earlier session work also synced launcher-related files:

```text
C:\Users\Ben\.terminal-talk\app\codex-launch.ps1
C:\Users\Ben\.terminal-talk\app\assistant-session-launch.ps1
C:\Users\Ben\.terminal-talk\app\assistant-wt-launch.ps1
C:\Users\Ben\.terminal-talk\app\main.js
```

Additional sync required after the tabbed-settings/capture recovery:

```text
C:\Users\Ben\.terminal-talk\app\index.html
C:\Users\Ben\.terminal-talk\app\styles.css
C:\Users\Ben\.terminal-talk\app\renderer.js
C:\Users\Ben\.terminal-talk\app\main.js
C:\Users\Ben\.terminal-talk\app\lib\platform.js
C:\Users\Ben\.terminal-talk\app\lib\config-validate.js
C:\Users\Ben\.terminal-talk\app\lib\create-session-placement.js
```

`lib\platform.js` is critical. If it is stale, the installed toolbar can fail on startup with:

```text
createConfigStore: configPath required
```

The next session should verify installed app files if changing anything.

## Tests/Checks Already Run

Passing:

- PowerShell parser check for:
  - `app/codex-hook-common.psm1`
  - `app/codex-identify-live.ps1`
  - `app/assistant-wt-launch.ps1`
- `node --check scripts/run-tests.cjs`
- Focused Codex short-collision simulation.
- Live four-session registry test with real collision:
  - Codex A real key `019dea5c`
  - Codex B alternate key `b7a000f0`

Not completed:

- Full `node scripts/run-tests.cjs` timed out after about 124 seconds. It was too broad for the live debugging pass.
- Full video recording has not been done.
- UI-click Create Session path has not yet been proven to pass deterministic bounds.

## Current Worktree Warning

The worktree is very dirty and was dirty before this handoff. Do not revert unrelated changes.

Important changed or untracked areas include:

- app code
- hooks
- scripts
- docs
- videos
- installer/uninstaller
- tests

This handoff does not authorize `git reset`, `git checkout --`, or deleting files.

Use `git status --short` to inspect. Assume unrelated dirty files belong to the user or earlier work.

## Big Mistakes Made In The Current Session

These must not be repeated.

### Mistake 1: Opening terminals the old broken way

Early launcher attempts used wrong command construction and produced errors like:

```text
error 2147942402 (0x80070002)
The system cannot find the file specified.
```

This came from incorrect command/path handling around `codex`, `claude`, or PowerShell launch.

Correct modern path:

- Use `assistant-wt-launch.ps1`.
- Use `assistant-session-launch.ps1`.
- Use `codex-launch.ps1` for Codex.
- Use real executable resolution for `claude`.

### Mistake 2: Not understanding Codex registration timing

Claude registers immediately through statusline.

Codex does not fully register until a conversation event/hook happens. It starts as a provisional row.

For Codex in a video:

1. Create Codex session.
2. Show provisional row if useful.
3. Send first cue prompt.
4. Watch Codex bind to real session ID.

### Mistake 3: Confusing primary-screen placement with tabs

Ben pointed out the issue was not that the sessions were opening as tabs inside the current Codex chat. They were separate Windows Terminal windows, but Windows placed them on the wrong monitor.

The fix is window placement, not tab behavior.

### Mistake 4: Trusting registry/process cleanup

Old demo windows were still visible even after registry and child process cleanup looked clean.

The correct cleanup requires UI Automation visible-window enumeration and, if needed, WM_CLOSE by handle.

### Mistake 5: Opening a second set of demo terminals

At one point four old demo windows were still open on the primary screen, then four more were opened on the left screen. That made eight demo windows visible:

- two `Codex TT A`
- two `Codex TT B`
- two `Claude TT A`
- two `Claude TT B`

Before launching, always verify visible windows.

### Mistake 6: Saying "done" too early

Do not say the setup is done just because one check passes.

Need:

- registry OK
- processes OK
- visible windows OK
- toolbar UI OK
- screen placement OK

## What Ben Wants Next

Ben wants to continue the video setup from the current recovered state.

The operator/next session should:

1. Read this handoff.
2. Verify current registry.
3. Verify visible Windows Terminal windows and bounds.
4. Verify the toolbar is using the real `C:\Users\Ben\.terminal-talk` registry, not `tmp\tt-video-home`.
5. Report the state before launching anything.
6. Verify no duplicate/stale demo windows are visible on the recording monitors.
7. Use Settings -> Sessions tab -> Create session for the product path.
8. Do a one-session UI Create placement smoke test.
9. Use `scripts/send-video-cue.ps1` or `scripts/send-video-terminal-prompt.ps1` to feed cue prompts to each terminal.
10. Only after that, prepare the real recording pass.

## Recommended First Response In The New Session

After reading this file, the next Codex should say something like:

```text
I have read the handoff. I will not launch anything yet. First I will verify the registry, visible Windows Terminal windows, and monitor bounds, then report whether the current demo state is clean enough to continue.
```

Then it should run the verification commands above.

## Final Checklist Before Recording

- [ ] Terminal Talk visible and working.
- [ ] Toolbar on intended toolbar screen.
- [ ] Toolbar is using real `C:\Users\Ben\.terminal-talk`, not `tmp\tt-video-home`.
- [ ] Terminal screen empty before session creation.
- [ ] No stale demo windows visible.
- [ ] Visible Windows Terminal windows enumerated.
- [ ] Monitor coordinates confirmed.
- [ ] Settings -> Sessions tab -> Create session visible.
- [ ] Settings tabs visible: Playback, Sessions, OpenAI, Shortcuts, About.
- [ ] Create Session permissions show only valid launch modes.
- [ ] Project folder is `C:\Users\Ben\Desktop\terminal-talk`.
- [ ] Cue files exist.
- [ ] `scripts/send-video-cue.ps1` parser check passes.
- [ ] Operator cue sheet open.
- [ ] Recording region spans terminal screen and toolbar screen.
- [ ] Claude A placement tested.
- [ ] Codex A placement tested.
- [ ] Claude B placement tested.
- [ ] Codex B placement tested.
- [ ] Codex first cue binds real session ID.
- [ ] Codex A/B collision-safe identity verified if same native prefix appears.
- [ ] Transcript panel shows recent spoken entries.
- [ ] Collapsed toolbar colour flash visible.
- [ ] No external connectivity/auth pop-up visible.
- [ ] No accidental mouse movement.
