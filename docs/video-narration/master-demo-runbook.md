# Master Demo Runbook

This is the operator-facing sequence for a long-form Terminal Talk master recording. It is designed for a single continuous capture that can later be split into chapters.

The locked second-by-second production contract is:

- `docs/video-narration/locked-master-video-plan.md`

Use the locked plan for timing, preflight, cursor rules, exact host clips, and rejection criteria. This runbook remains the broader operator guide.

## Recording Style

Use a repeating pattern:

```text
Terminal Talk narration -> deliberate cursor movement -> visible product action -> terminal-generated response -> toolbar proof
```

The long-form video can be 20-30 minutes. That is acceptable because the chapter export step creates the shorter clips afterwards.

The terminal responses should feel like an ensemble, not a chorus. Assign the viewer one new idea at a time:

- Claude TT A: launch witness.
- Codex TT A: traffic and queue proof.
- Claude TT B: working-user controls.
- Codex TT B: receipts, collapsed flash, Jarvis, and close.

## 0. Preflight

- Terminal screen is empty.
- Toolbar screen shows Terminal Talk.
- Notifications are suppressed.
- Recording captures the terminal screen and toolbar screen.
- Existing control terminals stay open but are not part of the recorded terminal screen.
- Use a video runtime home so practice clips and normal user history do not pollute the take.
- Confirm Create session placement:
  - `Claude TT A`: top-left
  - `Codex TT A`: top-right
  - `Claude TT B`: bottom-left
  - `Codex TT B`: bottom-right

## 1. Intro And Chapter Promise

Host narration:

```text
This is Terminal Talk running as the control surface for terminal-heavy AI work. In this master demo we are going to create real Claude Code and Codex terminals, prompt them together, watch Terminal Talk speak and log their responses, collapse the toolbar, use Jarvis to read selected text, and walk through the settings that make it practical.
```

Action:

- Start collapsed.
- Hover the toolbar slowly.
- Point to play controls, session tabs, transcript, settings cog.
- Open Settings.
- Click Sessions.

## 2. Create Four Sessions

Host narration:

```text
The Sessions tab is where Terminal Talk creates assistant terminals. I can choose the assistant, the project folder, the label, the colour, and the launch mode. These windows are launched by Terminal Talk, not by a separate staging script.
```

Action:

- Create `Claude TT A`.
- Create `Codex TT A`.
- Create `Claude TT B`.
- Create `Codex TT B`.
- Keep the pace brisk; the form does not need to linger after the first explanation.
- Show rows appearing in Sessions.

## 3. Batch Prompt

Host narration:

```text
Now all four terminals are on screen. I am going to prompt them as a batch, but not with the same prompt. Each terminal has a different job in the story: launch proof, traffic proof, working controls, and receipts. The replies may finish in a different order, but Terminal Talk keeps the visible dots, colours, voices, transcript rows, and session identity tied to the terminal that produced each response.
```

Action:

- Paste the four prompts from `operator-master-prompt-sheet.md`.
- Send them quickly, one per terminal.
- For the live take, the fastest path is `scripts/send-master-video-prompts.ps1 -UseQuadrantCoordinates`.
- Leave the prompts visible long enough to read the first line.
- Let the terminals respond while the toolbar speaks.
- Do not add extra voiceover that repeats the active terminal's assigned lane.

## 4. Toolbar Controls

Host narration:

```text
The toolbar is not just a player. It is a control surface. While the terminals speak their own lanes, the cursor will show the controls they are talking about: pause, resume, scrub, skip, inspect the transcript, focus one session, mute another, change labels, change colours, and assign voices without leaving the terminal workflow.
```

Action:

- Move slowly across:
  - play/pause
  - scrubber
  - session tabs
  - transcript
  - labels
  - colour dropdowns
  - focus star
  - mute button
  - voice control

## 5. Transcript

Host narration:

```text
Every spoken item becomes reviewable. The transcript lets you check what was spoken, which session it came from, and where the latest clips came from, so Terminal Talk is also a short-term spoken work log.
```

Action:

- Open transcript.
- Show several recent entries.
- Point to session colours/source labels.
- Toggle spoken/original if useful.

## 6. Collapsed Flash

Host narration:

```text
Now the toolbar is going to get out of the way. When a terminal speaks while Terminal Talk is collapsed, the slim bar still flashes the speaking session colour, so you can identify the source without opening Settings.
```

Action:

- Close Settings.
- Let toolbar collapse.
- Send one short collapsed-flash prompt to each terminal.
- Leave the mouse away from the toolbar.
- Capture the colour flash clearly.

## 7. Hey Jarvis

Host narration:

```text
Jarvis is the read-anywhere path. It is separate from Claude and Codex. Select text in another app, trigger read selected text, and Terminal Talk speaks it as a J clip without needing an assistant reply or paid OpenAI voices.
```

Action:

- Open a clean text source.
- Highlight one paragraph.
- Trigger read selected text.
- Show the J clip.
- Open transcript and show the entry.

## 8. Settings Tour

Host narration:

```text
The global settings are grouped into tabs so they are quick to scan: Playback, Sessions, OpenAI, Shortcuts, and About. Edge voices are the free default, OpenAI is optional and paid, and shortcuts make the toolbar usable without reaching for the mouse.
```

Action:

- Playback: speed, volume, auto-collapse, auto-prune, heartbeat/tool narration.
- Sessions: labels, colours, voices, focus, mute, overrides.
- OpenAI: explain optional paid route without exposing a key.
- Shortcuts: show editable commands.
- About: show version.

## 9. Tool Narration And Heartbeat

Host narration:

```text
Terminal Talk can also narrate progress. When an assistant is working, tool narration and heartbeat clips tell you something is still happening before the final answer arrives.
```

Action:

- Send a safe prompt that reads/searches a small local file set.
- Capture tool narration or heartbeat.
- Show final response and transcript entry.

## 10. Closing

Host narration:

```text
That is the core idea: keep the terminal workflow on screen, but make it audible, identifiable, and reviewable. Terminal Talk follows multiple real assistant sessions without turning the workspace into a dashboard.
```

Action:

- End with terminal windows visible and toolbar showing transcript or Sessions.
- Do not end on a blank desktop.

## Chapter Export

After review:

1. Copy or rename the accepted master video to `docs/videos/terminal-talk-master-long-form.mp4`.
2. Adjust `master-demo-chapters.json` start and end times.
3. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-video-chapters.ps1
```

Export one chapter while tuning times:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\export-video-chapters.ps1 -Chapter collapsed-colour-flash -Format mp4
```
