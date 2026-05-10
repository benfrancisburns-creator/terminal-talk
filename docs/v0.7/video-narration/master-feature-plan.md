# Terminal Talk Master Feature Plan

This is the detailed source of truth for the long-form master video.

The locked production contract is:

- `docs/video-narration/locked-master-video-plan.md`

Use that file for the exact timeline, preflight, cursor rules, and rejection criteria. This feature plan remains the broader coverage map.

The production goal is one continuous capture where Terminal Talk explains itself, creates real assistant sessions, prompts those sessions once, and then lets the queued responses demonstrate the product.

## Core Recording Principle

Prompt each assistant session once with a Markdown script file.

The terminals then produce long, structured responses. Terminal Talk speaks those responses as queued clips, giving the viewer the product proof:

- multiple sessions talking through one toolbar
- distinct session colours and tabs
- queue ordering visible in the dot strip
- transcript entries building up
- collapsed toolbar colour flashes

The operator should not keep feeding tiny cue prompts unless a section needs a recovery take.

## Creative Delivery Model

The four terminals are not four copies of the same narrator. They are four proof lanes.

| Terminal | Creative Role | Owns | Avoids Repeating |
| --- | --- | --- | --- |
| `Claude TT A` | Launch witness | Settings -> Sessions -> Create session, real terminal launch, project folder, label, colour, launch mode, first session identity | Queue mechanics, controls, transcript, collapsed flash, Jarvis |
| `Codex TT A` | Traffic narrator | Batch prompts, mixed completion order, dot strip, All tab, per-session tabs, shared strip with separate session identity, Codex binding | Create form, focus, mute, voice settings, Jarvis |
| `Claude TT B` | Working-user narrator | Why multiple terminals need focus, mute, voices, heartbeat, tool narration, shortcuts, and tabbed settings | Launch proof, queue proof, transcript receipts, collapsed flash |
| `Codex TT B` | Receipts and closer | Transcript, spoken/original review, collapsed colour flash, Jarvis as a separate J clip, chapterable master capture | Launch proof, queue proof, session control tour |

If a feature has already been explained by one terminal, the later terminals should treat it as known context. The viewer should see the same product surface repeatedly, but the narration should not spend four responses saying the same thing.

The handoff should feel like:

```text
Claude TT A creates the proof.
Codex TT A shows the traffic.
Claude TT B explains why the controls matter.
Codex TT B shows the receipts and closes the loop.
```

## Master Beat Sheet

This is the concrete recording rhythm. The order of assistant responses can drift because the prompts are sent as a batch. If that happens, follow the currently speaking role with the cursor instead of forcing a strict sequence.

| Beat | Screen Action | Spoken Owner | Viewer Learns | Notes |
| --- | --- | --- | --- | --- |
| 0 | Start collapsed, hover to reveal toolbar | Host clip | Terminal Talk is a compact control surface, not a full-screen dashboard | Keep the cursor slow and deliberate. |
| 1 | Open Settings, click Sessions tab | Host clip | Settings are tabbed now, and Sessions owns assistant creation | Do not scroll through old long settings. |
| 2 | Create `Claude TT A` slowly | Host + Claude TT A | The first terminal is created by Terminal Talk | Show assistant kind, project folder, label, colour, launch mode, Create. |
| 3 | Create `Codex TT A`, `Claude TT B`, `Codex TT B` briskly | Host action | The create path is repeatable | The first create explains the form; the rest prove speed. |
| 4 | Four terminals visible in quadrants | Host clip | The recording is now real multi-terminal work | Pause long enough for labels and layout to read. |
| 5 | Send all four master prompts | Operator action, then Codex TT A likely speaks | The prompts are different assignments | Prefer `scripts/send-master-video-prompts.ps1 -UseQuadrantCoordinates`. |
| 6 | While Claude TT A speaks, point at session rows and terminal title | Claude TT A | Launch and identity are tied together | Do not point at transcript yet unless it has already opened. |
| 7 | While Codex TT A speaks, point at dots, All tab, per-session tabs, colours | Codex TT A | Shared visible strip, separate session identity | Use this beat to correct any "same queue" confusion visually. |
| 8 | While Claude TT B speaks, point at focus, mute, voice, Playback, Shortcuts | Claude TT B | Busy workflows need practical controls | Use tabs at the top; do not hunt through a long panel. |
| 9 | While Codex TT B speaks, open transcript | Codex TT B | Spoken items become reviewable receipts | Show recent rows and source colours. |
| 10 | Close Settings and let toolbar collapse | Codex TT B or host clip | The toolbar gets out of the way | Leave cursor away from the toolbar after collapse. |
| 11 | Trigger collapsed flash recovery only if needed | Short terminal prompts | The slim bar still identifies the speaking session | Use the fallback prompts only if the main response timing misses the flash. |
| 12 | Select text outside an assistant terminal and trigger Jarvis | Host action + Codex TT B context | Jarvis is read-anywhere and separate from assistant clips | Show J identity once, cleanly. |
| 13 | Run a small safe assistant task | Claude TT B context | Heartbeat and tool narration cover progress, not just final answers | Use a local read/search task that cannot break the repo. |
| 14 | End with four terminals plus toolbar/transcript visible | Codex TT B or host clip | Audible, identifiable, reviewable | Do not end on an empty desktop. |

## Master Prompt Files

Use these files for the one-prompt-per-session section:

- `docs/video-narration/master-session-scripts/claude-tt-a.md`
- `docs/video-narration/master-session-scripts/codex-tt-a.md`
- `docs/video-narration/master-session-scripts/claude-tt-b.md`
- `docs/video-narration/master-session-scripts/codex-tt-b.md`

Exact operator prompts are in:

- `docs/video-narration/operator-master-prompt-sheet.md`

## Feature Coverage Matrix

| Chapter | Feature/Section | On-Screen Proof | Narration Owner | Pass Criteria |
| --- | --- | --- | --- | --- |
| 1 | Cold open | Toolbar collapsed, then hover reveal | Host clip | Viewer understands the premise before any terminal appears. |
| 2 | Create session | Settings -> Sessions -> Create session | Host + Claude TT A | The Create button visibly opens a real Claude terminal. |
| 2 | Assistant type | Assistant dropdown shows Claude Code and Codex | Host + Claude TT A | Viewer sees Terminal Talk can choose the CLI once, then the later creates move faster. |
| 2 | Project folder | Project folder field points at repo | Claude TT A | Launch context is visible. |
| 2 | Labels | Labels entered as Claude TT A / Codex TT A / Claude TT B / Codex TT B | Claude TT A | Session rows and terminal titles become readable. |
| 2 | Colours | Colour dropdown set per session | Claude TT A | Dots/tabs/rows can later inherit distinct colours. |
| 2 | Permissions | Launch mode dropdown visible | Claude TT A | No stale Plan/Auto/Accept edits values. |
| 3 | Four terminals | Four Windows Terminal windows in quadrants | Host action | Viewer sees real Claude and Codex terminals together. |
| 3 | Batch prompts | Four substantial role prompts pasted quickly | Codex TT A | Prompts visibly assign different jobs, not one repeated sentence. |
| 3 | Queue sorting | Dots build up and play | Codex A | Clips share strip but preserve session identity. |
| 4 | Playback controls | Play/pause, scrubber, skip controls | Host action + Claude TT B context | Controls are pointed at deliberately. |
| 4 | Mascot vs J | Assistant responses use mascot | Codex TT B | Assistant clips do not show J; Jarvis is saved for its own beat. |
| 4 | Session tabs | All tab plus per-session tabs visible | Codex TT A | Session counts/colours are visible. |
| 4 | Focus | Focus star visible | Claude TT B | Focus is described as priority control. |
| 4 | Mute | Mute icon visible | Claude TT B | Mute is described as suppressing a session without deleting it. |
| 4 | Voice per session | Voice control visible | Claude TT B | Viewer understands sessions can sound different. |
| 5 | Transcript | Transcript expanded | Codex TT B | Recent spoken entries are visible. |
| 5 | Spoken/original | Spoken/original toggle shown if available | Codex TT B | Viewer understands logs are reviewable. |
| 6 | Collapse | Settings closed and toolbar collapses | Codex TT B | Toolbar gets out of the way. |
| 6 | Colour flash | New clips arrive while collapsed | Codex TT B + short recovery prompts if needed | Collapsed bar flashes correct speaking session colour. |
| 7 | Hey Jarvis | Selected text read as J clip | Codex TT B + host action | J is visually distinct from assistant clips. |
| 7 | Read anywhere | Text source outside assistant terminal | Codex TT B + host action | Viewer sees no Claude/Codex dependency. |
| 8 | Playback settings | Playback tab | Claude TT B + host action | Speed, volume, auto-collapse, auto-prune are visible. |
| 8 | Speech settings | Heartbeat/tool narration toggles | Claude TT B | Viewer understands progress narration. |
| 8 | Shortcuts | Shortcuts tab | Claude TT B + host action | Hotkeys are user-editable. |
| 8 | OpenAI | OpenAI tab | Claude TT B + host action | Optional paid route is explained without exposing keys. |
| 8 | About | About tab | Host action | Version/about surface is visible. |
| 9 | Tool narration | Assistant performs safe tool work | Claude TT B | Terminal Talk speaks progress, not only final replies. |
| 10 | Closing | Four sessions + toolbar/transcript visible | Codex TT B | Recap ties together audible, identifiable, reviewable workflow. |

## Long-Form Flow

### 1. Cold Open

Host clip explains the premise while the cursor reveals:

- collapsed toolbar
- play controls
- session tabs
- transcript
- settings cog

### 2. Create Sessions

Use Terminal Talk's Settings -> Sessions tab.

Create the four sessions from the form. Move quickly after the first one; the first creation demonstrates the form, the rest prove repeatability.

### 3. One Prompt Per Terminal

Paste all four role prompts from `operator-master-prompt-sheet.md` as quickly as possible.

Each terminal reads its own Markdown script and outputs a full response. This is where the viewer sees messages arrive and queue up naturally. The prompts should be long enough on screen that the viewer understands the different assignments.

### 4. Let The Queue Work

Do not keep prompting.

Let Terminal Talk speak the backlog while the cursor points to the controls and rows. The visible proof is the queue itself: dots, tabs, colours, transcript, and mascot. Avoid adding extra spoken narration that restates what the active terminal is already covering.

### 5. Collapsed Proof

Close Settings, let the toolbar collapse, then trigger only the collapsed flash section if needed.

Preferred version: one of the main scripted terminal responses already includes a final short collapsed-flash paragraph. If timing is wrong, use the fallback collapsed prompts in `master-demo-prompts.md`.

### 6. Chapter Cuts

After the master is accepted, adjust `master-demo-chapters.json` and run `scripts/export-video-chapters.ps1`.

The long video is the asset of record. Short videos are derived from it.

## Rejection Criteria

- The prompts are tiny cue commands instead of meaningful demo prompts.
- The operator has to continuously feed cue IDs to keep narration going.
- The toolbar never collapses.
- The collapsed colour flash is not visible.
- The transcript is not shown.
- Terminal sessions are created outside Terminal Talk for the main proof.
- Any assistant response appears as a Jarvis/J clip.
- The viewer cannot tell which terminal is speaking.
