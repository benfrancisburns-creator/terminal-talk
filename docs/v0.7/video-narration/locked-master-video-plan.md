# Locked Master Video Plan

Date: 2026-05-03

Working title:

```text
Create Sessions: Four Terminals, One Toolbar
```

This is the production contract for the next master take. Do not start a full recording from memory. Follow this plan, then run the preflight, then record only after the preflight passes.

## Outcome

The video proves that Terminal Talk can create, track, speak, and control multiple real Claude Code and Codex terminals while preserving session identity.

The viewer should leave with one clear idea:

```text
The terminal remains the workspace. Terminal Talk adds voices, queue control, transcript, settings, session identity, and collapsed status without turning the desktop into a dashboard.
```

## Non-Negotiables

- Use the original toolbar styling. Do not make the collapsed strip thicker in CSS.
- Enlarge the toolbar only through video crop/scale.
- No full take until the wake-and-expand preflight passes.
- No silent dead air. More than 3 seconds of silence needs useful on-screen action. More than 8 seconds of silence is a failed take.
- The cursor must always have a job: wake, point, click, highlight, or get out of the way.
- The cursor must not click expanded-toolbar coordinates while the toolbar is collapsed.
- The toolbar must visibly collapse before the collapsed-flash proof.
- The collapsed strip must flash while an assistant terminal is speaking.
- The four terminal prompts must be substantial on screen. Do not paste tiny placeholder prompts such as "Read docs video narration."
- Terminal prompts must not contain private production critique or operator instructions.
- The four terminals must not repeat the same feature list.
- The product path is Settings -> Sessions -> Create session. Helper scripts can automate, but the video must make the product path visible.
- End on a meaningful product state, not an empty desktop or silent tail.

## Recording Layout

Final composition target:

```text
2560x1080
left: four-terminal screen
right: cropped/scaled real toolbar window
```

Left side:

- Top-left: `Claude TT A`
- Top-right: `Codex TT A`
- Bottom-left: `Claude TT B`
- Bottom-right: `Codex TT B`

Right side:

- Cropped real Terminal Talk toolbar window.
- No full second desktop.
- No Terminal Talk landing/background wasted in the frame.
- Toolbar crop fills the right side enough that tabs, queue dots, transcript, and settings controls are readable.

## Preflight Before Recording

This is not optional.

1. Enumerate displays and visible Windows Terminal windows.
2. Confirm only the two control terminals are visible before the demo starts.
3. Start the isolated video toolbar and force it to the expected bounds.
4. Capture a short screen-only frame check of the 2560x1080 composition.
5. Prove collapsed wake:
   - toolbar starts collapsed or is allowed to collapse;
   - cursor moves to the real slim strip, not the expanded cog position;
   - toolbar expands;
   - settings cog opens;
   - Sessions tab opens.
6. Prove one Create session path with a throwaway short test or dry state if possible.
7. Prove one host clip plays through Terminal Talk.
8. Prove one collapsed flash clip while the cursor is away from the toolbar.

If any preflight step fails, do not record the full take.

## Audio Continuity Rules

Use three audio sources:

- Host clips for setup, transitions, and cursor-led explanation.
- Terminal responses for the core proof lanes.
- Short fallback terminal clips for collapsed flash only if the main response timing misses it.

There should always be one of these happening:

- narration is playing;
- text is being pasted or generated visibly;
- cursor is deliberately pointing at a control being discussed;
- the toolbar is visibly changing state.

Do not let the recorder run long after the final audio. Trim trailing silence after muxing.

## Host Clip Script

These are the planned host clips. They cover setup and cursor-led moments so the take does not depend on assistant timing to avoid silence.

### `intro`

```text
This take keeps the original Terminal Talk toolbar intact. The left side is the four-terminal workspace. The right side is a cropped, enlarged view of the real toolbar window, so the queue, tabs, transcript, settings, and collapsed strip stay readable without changing the product UI.
```

### `setup`

```text
First I am opening Settings and moving to Sessions. This is where Terminal Talk can start assistant terminals directly, choose Claude or Codex, name the session, set its colour, and place the new terminal window on the screen.
```

### `registration`

```text
The registration matters because the toolbar is not just playing anonymous audio files. Each terminal gets a session id, a label, a colour, and a voice. Once the four windows are open, the controls on the right are controlling those live sessions.
```

### `batch`

```text
Now the prompts are going into the terminals. I am using full narration prompts, not tiny placeholders, so the viewer can see each terminal being cued and then watch the responses turn into spoken clips.
```

### `while-generating`

```text
While the assistants generate, the cursor stays on the features being discussed: queue dots, session tabs, transcript, focus and mute controls, and per-session voices. If there is a thinking gap, the screen still shows what Terminal Talk is managing.
```

### `controls`

```text
This section is about control. The toolbar can filter by session, mute noisy terminals, focus one voice, keep a transcript of spoken clips, and split settings into focused tabs instead of one long scrolling panel.
```

### `collapse`

```text
For the collapse proof, the settings panel closes and the cursor moves away. After the idle delay, the original slim letterbox strip appears. It should stay thin because that is the real toolbar behaviour, not a special video skin.
```

### `flash`

```text
Now the terminals speak while the toolbar is collapsed. The full panel is out of the way, but the strip flashes the active session colour, so the viewer can still tell which terminal is talking.
```

### `jarvis`

```text
Jarvis is the read-anywhere path. It is separate from Claude and Codex sessions. Selected text becomes a J clip, while assistant responses keep the mascot identity because they came from terminals.
```

### `progress`

```text
Terminal Talk can also cover the waiting time while an assistant is working. Heartbeat and tool narration are there so the user hears progress before the final response arrives.
```

### `outro`

```text
That is the product story: terminals stay as the workspace, Terminal Talk adds session identity, voices, transcript, settings, queue control, and a collapsed status strip that keeps speaking context visible.
```

## Cursor Rules

- Wake collapsed toolbar at the actual strip: center of the slim letterbox strip.
- Wait for expansion before clicking cog, Sessions tab, transcript, or form controls.
- Use 600-900 ms movement for explanatory cursor motion.
- Do not park the cursor over important text.
- During collapsed flash proof, move the cursor away from the toolbar and keep it away.
- If narration mentions a feature, the cursor should be on or near that feature within the same sentence.

## Terminal Roles

| Terminal | Role | Owns | Must Avoid |
| --- | --- | --- | --- |
| `Claude TT A` | Launch witness | Create session, real launch, project folder, label, colour, launch mode, session identity | Queue mechanics, transcript, Jarvis |
| `Codex TT A` | Traffic narrator | Four prompts, mixed replies, dot strip, All tab, per-session tabs, source identity | Create-form explanation, mute/focus, Jarvis |
| `Claude TT B` | Working-user controls | Focus, mute, voices, tabbed settings, shortcuts, heartbeat/tool narration | Launch proof, transcript receipts |
| `Codex TT B` | Receipts and closer | Transcript, spoken/original, collapsed flash, Jarvis separation, final recap | Repeating launch or queue proof |

## Locked Timeline

Target length: 15-18 minutes. The exact assistant response order can drift, but the cursor follows the currently speaking lane.

| Time | Audio Owner | Screen And Cursor | Purpose | Pass Criteria |
| --- | --- | --- | --- | --- |
| 00:00-00:15 | Host `intro` | Start on composed frame: terminals area empty, original toolbar visible on right. | Establish this is the real product UI. | No thick custom toolbar. |
| 00:15-00:35 | Host `intro` | Cursor wakes toolbar from the real collapsed strip, then points across play, scrubber, tabs, transcript, settings. | Show compact control surface. | Toolbar expands before any click. |
| 00:35-00:55 | Host `setup` | Click cog, click Sessions tab. | Establish tabbed settings and the product path. | Sessions tab is visibly active. |
| 00:55-01:25 | Host `setup` | Cursor walks the Create session form: assistant, project, label, colour, launch mode, Create. | Teach the form once. | Viewer can see each field. |
| 01:25-02:25 | Host `setup` | Create `Claude TT A`, then create the other three faster. Cursor rests on status/session rows while windows launch. | Prove Terminal Talk creates real terminals. | Four terminal windows appear in the target quadrants. |
| 02:25-02:45 | Host `registration` | Cursor points at session rows, labels, colours, voice rows. | Confirm registry/identity before prompting. | Toolbar shows the demo sessions, not "no active sessions." |
| 02:45-03:25 | Host `batch` | Paste substantial prompts into all four terminals. | Show the terminals are being assigned different jobs. | Prompts are visible and distinct. |
| 03:25-03:45 | Host `while-generating` | Cursor returns to toolbar queue/tabs while terminals begin responding. | Prepare viewer for queued audio. | No dead air while waiting. |
| 03:45-04:55 | `Claude TT A` | Cursor follows the launch proof: terminal title, session row, label, colour, tab. | Tie created terminal to spoken session identity. | Viewer understands this terminal was launched by Terminal Talk. |
| 04:55-06:05 | `Codex TT A` | Cursor follows dots, All tab, per-session tabs, queue strip. | Explain traffic and source identity. | Viewer can tell clips share a visible strip but keep separate identity. |
| 06:05-07:25 | `Claude TT B` | Cursor follows focus, mute, voice, Playback tab, Shortcuts tab. | Explain controls for busy multi-terminal work. | Focus/mute/voice are visible when described. |
| 07:25-08:35 | `Codex TT B` | Open transcript. Cursor points to recent entries, session colour/source, spoken/original toggle if available. | Show receipts. | Transcript has real spoken entries. |
| 08:35-09:35 | Host `controls` | Quick tab pass: Playback, Sessions, OpenAI, Shortcuts, About. | Show settings are not one long scrollbar anymore. | Each tab is clicked deliberately, no scrolling hunt. |
| 09:35-10:15 | Host `collapse` | Close settings, move cursor away from toolbar, wait for idle collapse while explaining exactly what should happen. | Prove real auto-collapse. | Original slim strip appears. |
| 10:15-11:25 | Host `flash` + short terminal clips | Send one short clip per terminal while cursor stays away. | Prove collapsed colour flash by source. | Strip flashes during each spoken clip. |
| 11:25-12:45 | Host `jarvis` + `Codex TT B` context | Show Jarvis read-anywhere path with selected text and J clip. | Separate Jarvis from assistant sessions. | J clip appears and is not confused with Claude/Codex. |
| 12:45-14:05 | Host `progress` + `Claude TT B` context | Trigger a safe small assistant task that reads/searches local files. Cursor points at tool narration/heartbeat controls and queue. | Show progress narration, not only final answers. | At least one progress clip or visible working indicator appears. |
| 14:05-15:15 | Host `outro` | Return to transcript and session rows. Cursor points to final proof: four terminals, queue, tabs, transcript. | Tie all features together. | No blank desktop, no silent ending. |
| 15:15-18:00 | Optional extension | If the queue is still speaking, follow the active speaker with the cursor and show relevant UI. If audio is done, stop. | Let natural terminal responses finish without padding. | Never leave a long silent tail. |

## What To Do If Timing Drifts

Assistant responses will not always finish in order. That is acceptable.

Rules:

- If `Claude TT A` speaks first, show create/session identity.
- If `Codex TT A` speaks first, show queue dots and tabs.
- If `Claude TT B` speaks first, show session controls/settings tabs.
- If `Codex TT B` speaks first, open transcript once entries exist.
- If no assistant response is ready after 8 seconds, play the next host transition and show the next planned UI action.
- Do not stare at a blank or idle terminal waiting for the perfect order.

## Prompt Policy

The on-screen prompt should be substantial. It should contain the actual narration content, not just a tiny command.

Acceptable prompt shape:

```text
Output only the Terminal Talk narration below. Do not add a preface.

This is Claude TT A. This terminal was launched from Terminal Talk's Sessions tab during the recording...
```

Rejected prompt shape:

```text
Read docs video narration.
```

Rejected prompt shape:

```text
Do not repeat the same sentence four times.
```

## Fallbacks

Use fallbacks only to recover proof, not to replace the main story.

- If collapsed flash is missed, use four short collapsed flash prompts.
- If transcript has too few entries, wait for one more spoken clip or use a short terminal clip.
- If Jarvis selection is unreliable in the long take, cut Jarvis from this master and record it as a separate chapter after the main proof is accepted.
- If heartbeat/tool narration is unreliable, show the settings controls in the master and record a separate progress-narration chapter later.

## Rejection Criteria

Reject the take if any of these happen:

- Toolbar is collapsed while the script clicks expanded controls.
- Toolbar never visibly collapses.
- Collapsed flash is not visible.
- Last 20 seconds are silent or visually dead.
- More than one terminal says the same feature explanation.
- Prompts expose operator critique or planning language.
- The right side wastes space on an unreadable second desktop.
- Settings are shown as a long scrolling wall instead of tabs.
- The viewer cannot tell which terminal is speaking.
- Control terminals appear as part of the demo.
- Demo terminals are launched outside the visible Settings -> Sessions path.

## Next Work After Screens Are Reconnected

1. Re-enumerate display bounds.
2. Update toolbar crop and terminal quadrant coordinates if the monitor layout changed.
3. Run the collapsed wake preflight.
4. Run a 20-30 second composition proof.
5. Run a one-session Create proof.
6. Only then start the full master recording.
