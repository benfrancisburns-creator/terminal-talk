# Terminal Talk Hero Video Production Pack

This file is a handoff pack for creating a new Terminal Talk hero video on a Windows laptop. It is designed for a Codex-controlled recording session where Codex can operate the screen, start sessions from the toolbar, prompt terminals, verify the UI, and collect footage for editing.

The goal is not a single perfect live take. The goal is to record real proof footage, then edit the strongest sections into a polished 60-90 second hero video.

## Final Video Goal

Create a real product hero video proving that Terminal Talk turns Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop into one spoken, colour-coded workflow.

The viewer should understand:

- Terminal Talk speaks useful assistant replies and progress while agents work.
- Claude Code and Codex CLI sessions can be started from the toolbar.
- Claude Desktop Code and Codex Desktop can join the same workflow.
- Sessions keep clear identity through labels, colours, voices, and toolbar rows.
- Auto-played and manually replayed audio clips have distinct visual states.
- Hey Jarvis can speak highlighted text on demand.
- Transcripts let the user compare spoken output with original text.
- Focus, mute, and voice controls make parallel sessions manageable.

Core message:

> Terminal Talk turns Claude Code, Codex, and desktop coding sessions into one spoken workflow, so you can keep building without reading every terminal.

## How To Give This To Codex On The Windows Laptop

Recommended options:

1. Commit this file to GitHub and pull/open it on the Windows laptop.
2. Send this Markdown file to the Windows laptop through email, iCloud Drive, OneDrive, Google Drive, or USB.
3. Open the file on the Windows laptop, then paste the "Prolonged `/goal` Prompt" into Codex `/goal`.
4. Keep the full file open as the operating manual for the session.

Best option:

Use the exact same repository on the Windows laptop, then ask Codex to open:

```text
docs/HERO-VIDEO-PRODUCTION-PACK.md
```

Codex should follow the `/goal` prompt below and use the full production pack as the operating manual.

## Prolonged `/goal` Workflow

Use `/goal` for this job rather than a normal short prompt. The work is expected to run for a long time, potentially overnight. The goal should not end just because one scene fails, one app is slow, or one click misses. Codex should adapt, capture evidence, use pickup shots, and keep driving toward the finished deliverable.

The right structure is:

1. Establish the goal.
2. Pre-flight the environment.
3. Rehearse and learn the UI.
4. Record a master pass.
5. Capture pickup shots for gaps.
6. Build or prepare a rough cut.
7. Produce a final production report.
8. Continue iterating until the acceptance criteria are either proven or clearly blocked by missing credentials, missing apps, unavailable hardware, or a broken Terminal Talk feature that needs repair.

Avoid a brittle stop/start mindset. Use "hold points" only for issues where continuing would waste the whole overnight run or produce misleading footage.

### Prolonged `/goal` Prompt

This prompt is intentionally short enough to paste into `/goal`.

```text
Follow docs/HERO-VIDEO-PRODUCTION-PACK.md as a prolonged Terminal Talk hero-video production goal.

Objective: create real proof footage, and if possible a rough 60-90s MP4 edit, showing Terminal Talk working with Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop. Prove toolbar-created sessions, colour-coded identities, spoken replies/progress, queue clip states, Hey Jarvis, transcript Spoken/Original, and focus/mute/voice controls.

Work as a long-running overnight loop, not a one-shot task. Do not stop after the first issue. Adapt around problems, capture issue clips, take pickup shots, and keep progressing toward the goal.

Loop:
1. Pre-flight: verify screen recording, Terminal Talk stability, audio playback, toolbar visibility, Claude Code, Codex CLI, desktop sessions, session identity, queue dots, Hey Jarvis, transcripts, and controls.
2. Rehearse: arrange windows, use prepared prompts, test clicks/shortcuts, record a rehearsal, review readability, and write notes.
3. Capture: record a long master session covering scenes 1-10 in the pack. Cut waiting later; do not rush proof.
4. Recover: if a scene fails, try a safer path: keyboard shortcuts, window search, app relaunch, smaller prompt, manual setup, close-up pickup, or issue clip. Continue with other scenes.
5. Pickup: capture close-ups for any unclear proof point.
6. Edit/export if tools allow: remove dead time, add short captions, prioritize real UI proof, export MP4 1080p+.
7. Report: list captured files, export path, proven criteria, failed/missing criteria, issue clips, and next actions.

Hard holds: pause final capture only if recording is not running, Terminal Talk repeatedly closes, audio cannot play, both toolbar session creation paths fail, or session identity/queue states are impossible to show. If held, capture evidence and continue with salvage footage/reporting rather than abandoning the goal.

Do not mark complete until either the rough video/export exists or a complete evidence-backed production report explains exactly what blocked export and what footage was captured.
```

## Production Strategy

Use a long-running `/goal` loop with three main passes:

1. Pre-flight pass: verify tools, apps, audio, sessions, and UI state.
2. Rehearsal pass: record a rough version to test screen layout and cursor reliability.
3. Final capture pass: record a long master session, then capture pickup shots for anything unclear.

Do not rely on blind clicking. Codex should confirm the correct window, toolbar tab, button, or control is visible before interacting with it.

If a feature fails, Codex should first attempt recovery and then route around the issue. For example: restart the app, use keyboard navigation, manually open the session if toolbar creation fails once, use a close-up pickup shot, or capture an issue clip. The goal should only enter a hard hold when continuing would destroy the value of the whole overnight run.

## Recommended Tools

Screen recording:

- OBS Studio preferred.
- Windows Game Bar acceptable for quick rehearsal.
- Clipchamp acceptable if OBS is not installed.

Editing:

- DaVinci Resolve, CapCut, Clipchamp, Premiere, or ffmpeg.
- If automated editing is attempted, keep the first edit simple: cut dead time, add captions, export MP4.

Automation:

- Prefer keyboard shortcuts, named windows, and launch scripts over coordinate clicks.
- Use coordinate clicks only after visual confirmation.
- Use prepared prompts copied from this file instead of typing long text manually.

## Screen Layout

Use a fixed layout before recording:

- Main screen left/top: Claude Code terminal.
- Main screen left/bottom: Codex CLI terminal.
- Main screen right: Terminal Talk toolbar.
- Second screen, if available: Claude Desktop Code and Codex Desktop.
- Keep the toolbar large enough that session labels, colours, queue dots, and controls are readable.
- Use a clean desktop background and close unrelated apps.

Window names, where possible:

- `Claude Code - Blue`
- `Codex CLI - Green`
- `Claude Desktop - Red`
- `Codex Desktop - Purple`
- `Terminal Talk Toolbar`

## Prepared Prompts

Use short prompts so responses are predictable and footage is easy to edit.

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

Background workflow:

```text
Check the README and summarise the install flow in two bullet points.
```

Tool/progress narration:

```text
Inspect the package scripts and tell me which command runs tests.
```

Hey Jarvis highlight text:

```text
Terminal Talk lets you keep working while your coding agents report back through spoken updates.
```

## Pre-Flight Checklist

Do not start final recording until these are verified:

- Terminal Talk opens and stays open for at least 2 minutes.
- Toolbar is visible and readable.
- Audio playback works.
- Claude Code can be started from the toolbar.
- Codex CLI can be started from the toolbar.
- Claude Desktop Code is available.
- Codex Desktop is available.
- Session identity appears in terminal sessions.
- Session colours and labels appear correctly in the toolbar.
- Auto-played audio clips get the small white dot.
- Manual replay changes the clip to the larger white dot.
- Hey Jarvis works with highlighted text.
- Transcript panel opens.
- Spoken / Original transcript toggle works.
- Focus, mute, and voice/session controls are visible.

If any critical item fails, document it and capture a short issue clip. Do not pretend it worked.

## Rehearsal Pass

Run one rehearsal recording before final capture.

Rehearsal goals:

- Confirm the screen layout is readable.
- Confirm Codex can move between windows reliably.
- Confirm the toolbar is not hidden or cropped.
- Confirm queue dots are visible.
- Confirm transcript text is readable.
- Confirm session creation works from the toolbar.
- Confirm prompts can be pasted into the correct sessions.
- Identify any sections needing close-up pickup shots.

After rehearsal, write brief notes:

- What worked.
- What was unclear.
- Which clicks were unreliable.
- Which windows need resizing.
- Which UI needs zoom/crop in edit.
- Which prompts took too long.

## Final Master Recording Sequence

Record one long session. Waiting time is acceptable because it can be cut later.

### Scene 1: Problem Setup

Goal: show why Terminal Talk exists.

Actions:

- Show multiple coding environments open or ready.
- Open Terminal Talk toolbar.
- Make the toolbar readable.

Capture:

- Multiple sessions or app surfaces.
- Toolbar opening cleanly.

Caption:

```text
Stop watching every terminal.
```

### Scene 2: Start Claude Code From Toolbar

Goal: prove toolbar-created Claude Code sessions.

Actions:

- Open the toolbar Create/New Session area.
- Start Claude Code from the toolbar.
- Show the Claude terminal opening.
- Show session identity in the terminal.
- Show matching colour/label in the toolbar.
- Paste the Claude Code prepared prompt.
- Wait for response.
- Capture Terminal Talk auto-playing the response.

Capture:

- Toolbar create action.
- Claude Code terminal.
- Matching session identity.
- Audio queue item with auto-play state.

Caption:

```text
Start Claude Code from the toolbar.
```

### Scene 3: Start Codex CLI From Toolbar

Goal: prove Codex CLI joins the same workflow.

Actions:

- Return to toolbar.
- Start a Codex CLI session from the toolbar.
- Show Codex terminal opening.
- Show matching identity in terminal and toolbar.
- Paste the Codex CLI prepared prompt.
- Wait for response.
- Capture Terminal Talk speaking the Codex response.

Capture:

- Codex create action.
- Codex terminal.
- Codex queue item.
- Separate colour from Claude Code.

Caption:

```text
Codex joins the same spoken workflow.
```

### Scene 4: Desktop Sessions

Goal: prove desktop integrations.

Actions:

- Open Claude Desktop Code.
- Trigger or show a short response.
- Show Terminal Talk syncing/detecting the desktop session.
- Repeat with Codex Desktop if practical.
- Show desktop sessions in the toolbar.

Capture:

- Desktop app visible.
- Toolbar session identity visible.
- Audio queue receiving desktop output.

Caption:

```text
Terminal and desktop sessions stay connected.
```

### Scene 5: Audio Clip State Proof

Goal: prove clip state clarity.

Actions:

- Let at least two clips auto-play.
- Show auto-played clips keeping the small white dot.
- Manually replay one clip.
- Show that clip changing to the larger white dot.

Capture:

- Small dot before manual replay.
- Manual replay action.
- Large dot after manual replay.

Caption:

```text
Auto-played and replayed clips stay distinct.
```

### Scene 6: Background Workflow

Goal: show hands-free value.

Actions:

- Have Claude Code and Codex both working.
- Move focus away from the terminals.
- Let Terminal Talk speak useful progress.
- Show the user does not need to inspect every line.

Capture:

- Multiple active sessions.
- Queue updating.
- Spoken progress.
- User focus away from raw terminal text.

Caption:

```text
Keep building while agents report back.
```

### Scene 7: Hey Jarvis

Goal: prove highlight-to-speak.

Actions:

- Highlight useful text in a terminal or transcript.
- Trigger Hey Jarvis.
- Show priority audio clip appearing.
- Capture it playing.

Capture:

- Highlighted text.
- Hey Jarvis trigger.
- Priority queue/playback.

Caption:

```text
Highlight text. Say Hey Jarvis. Hear it instantly.
```

### Scene 8: Transcript Audit

Goal: show trust and review.

Actions:

- Open transcript panel.
- Show spoken transcript.
- Toggle Spoken / Original.
- Show the original text comparison.

Capture:

- Transcript panel.
- Spoken view.
- Original view.

Caption:

```text
Compare spoken output with the original.
```

### Scene 9: Session Controls

Goal: show control over noisy parallel work.

Actions:

- Open session controls/settings.
- Focus one session.
- Mute another session.
- Show voice/session identity controls.

Capture:

- Focus control.
- Mute control.
- Voice or identity controls.

Caption:

```text
Focus what matters. Quiet the rest.
```

### Scene 10: Closing Product Shot

Goal: show complete product surface.

Actions:

- Show toolbar with multiple active sessions:
  - Claude Code
  - Codex CLI
  - Claude Desktop Code
  - Codex Desktop
- Show colour-coded identities.
- Show queue and transcript access.
- End on Terminal Talk name/logo or landing page CTA.

Caption:

```text
Claude Code. Codex. Desktop sessions. One spoken workflow.
```

## Pickup Shots

After the master recording, capture separate close-ups for anything unclear:

- Toolbar Create/New Session area.
- Claude Code start button.
- Codex start button.
- Queue dot state before and after manual replay.
- Hey Jarvis highlighted text and queue item.
- Transcript Spoken / Original toggle.
- Focus, mute, and voice controls.
- Four active sessions visible together.
- Landing page CTA shot.

## Editing Plan

Cut the raw recording into a 60-90 second hero video.

Suggested final structure:

- 0-5s: Problem.
- 5-15s: Claude Code from toolbar.
- 15-25s: Codex from toolbar.
- 25-35s: Desktop session support.
- 35-45s: Audio queue and clip states.
- 45-55s: Background workflow.
- 55-63s: Hey Jarvis.
- 63-72s: Transcript and controls.
- 72-90s: Final product shot and CTA.

Editing rules:

- Cut all waiting time.
- Keep each feature shot around 5-8 seconds.
- Use zoom/crop for toolbar details, queue dots, transcript toggles, and session controls.
- Use short captions.
- Do not overload the viewer with tiny text.
- The video must make sense without audio.
- Add narration after the cut, not during the screen recording.
- Export as MP4, 1080p or higher.
- Keep a compressed web version for the landing page.

## Narration Script

Draft narration:

```text
Terminal Talk turns Claude Code, Codex, Claude Desktop, and Codex Desktop into one spoken workflow.

Start sessions from the toolbar, keep each one colour-coded, and hear replies, progress, and selected text without watching every terminal.

Auto-played and replayed clips stay clear, transcripts let you audit what was spoken, and Hey Jarvis turns highlighted text into priority audio.

You keep building while your agents report back.
```

## Caption List

Use these captions:

```text
Stop watching every terminal.
Start Claude Code from the toolbar.
Codex joins the same spoken workflow.
Terminal and desktop sessions stay connected.
Auto-played and replayed clips stay distinct.
Keep building while agents report back.
Highlight text. Say Hey Jarvis. Hear it instantly.
Compare spoken output with the original.
Focus what matters. Quiet the rest.
Claude Code. Codex. Desktop sessions. One spoken workflow.
```

## Acceptance Criteria

The final video is acceptable only if it clearly proves:

- Claude Code support.
- Codex CLI support.
- Claude Desktop Code support.
- Codex Desktop support.
- Sessions can be started from the toolbar.
- Session identities are colour-coded and readable.
- Audio queue receives clips from different sessions.
- Auto-played and manually replayed clips have distinct states.
- Hey Jarvis works.
- Transcript Spoken / Original comparison works.
- Focus/mute/session controls are visible.
- The workflow benefit is obvious: less reading, more hands-free awareness.

If a criterion is missing, record a pickup shot.

## Autonomous Codex Operator Prompt

Prefer the "Prolonged `/goal` Prompt" above for the overnight run. Use this longer prompt only if `/goal` is unavailable or if Codex needs extra operating detail in a normal session.

```text
You are operating a Windows laptop to produce a Terminal Talk hero video as a prolonged workflow.

Your objective is to create real proof footage for a 60-90 second landing-page hero video. The final video must show that Terminal Talk works with Claude Code, Codex CLI, Claude Desktop Code, and Codex Desktop, and that users can start sessions from the toolbar, hear replies/progress, see colour-coded identities, use Hey Jarvis, inspect transcripts, and control focus/mute/voice.

Important operating rule:
Do not work blindly. Before every UI action, confirm the correct window, toolbar tab, button, or control is visible. Prefer keyboard shortcuts, named windows, and prepared prompts over coordinate-only clicks. Coordinate clicks are allowed only after visual confirmation.

Persistence rule:
This is a long-running production goal. Do not stop after one failed click, one slow response, one failed scene, or one missing optional feature. Recover, route around, capture issue evidence, take pickup shots, and continue building the deliverable.

Work in this order:

1. Read docs/HERO-VIDEO-PRODUCTION-PACK.md fully.
2. Verify the pre-flight checklist.
3. If a critical feature is broken, attempt recovery first. If it still blocks the final capture, record a short issue clip plus notes, then continue with salvage footage and all other scenes that can be proven.
4. Arrange the screen layout:
   - Claude Code terminal top-left.
   - Codex CLI terminal bottom-left.
   - Terminal Talk toolbar on the right.
   - Claude Desktop Code and Codex Desktop on the second screen if available.
5. Start a rehearsal screen recording.
6. Run through the full recording sequence once.
7. Stop rehearsal and review whether the toolbar, dots, captions areas, transcript, and controls are readable.
8. Write brief rehearsal notes.
9. Adjust layout or approach based on the notes.
10. Start the final master recording.
11. Capture scenes 1-10 from the production pack.
12. Stop the master recording.
13. Capture pickup shots for anything unclear.
14. Save all raw recordings in a clearly named folder.
15. If editing tools are available, create a first rough cut:
    - 60-90 seconds.
    - Dead time removed.
    - Short captions added.
    - Product proof shots prioritized over mascot/brand shots.
16. Export MP4 at 1080p or higher.
17. Write a final production report with:
    - What was captured.
    - What worked.
    - What failed or was missing.
    - Where the raw recordings are saved.
    - Where the exported draft video is saved.
    - Which acceptance criteria are fully proven.

Prepared prompts:

Claude Code:
In two short sentences, explain what this project does for a developer.

Codex CLI:
Review this workflow in two short sentences and suggest the next practical action.

Claude Desktop Code:
Summarise this coding task in one short paragraph.

Codex Desktop:
Give a concise status update for this task in two sentences.

Background workflow:
Check the README and summarise the install flow in two bullet points.

Tool/progress narration:
Inspect the package scripts and tell me which command runs tests.

Hey Jarvis highlight text:
Terminal Talk lets you keep working while your coding agents report back through spoken updates.

Hard hold rules:

- Pause final capture only if Terminal Talk repeatedly closes.
- Pause final capture only if audio playback does not work after recovery attempts.
- Pause final capture only if toolbar session creation does not work for both Claude Code and Codex CLI after recovery attempts.
- Pause final capture only if session identity is missing or unreadable after recovery attempts.
- Pause final capture only if queue clip states cannot be shown after recovery attempts.
- Pause final capture only if screen capture is not actually recording.

If a non-critical feature fails, continue capturing the working proof points, then record the failure in the production report and capture a pickup/issue clip.

Recovery options before a hard hold:
- Restart Terminal Talk once.
- Restart the affected terminal/app once.
- Use keyboard shortcuts instead of the mouse.
- Use a smaller prepared prompt.
- Manually open a session, then still capture the toolbar/session state if toolbar creation is unreliable.
- Capture a close-up pickup shot later.
- Capture an issue clip and continue with other proof points.

Final video priority:
Real UI proof matters more than a perfect advert. Show the toolbar, sessions, queue dots, Hey Jarvis, transcript, and controls clearly.
```
