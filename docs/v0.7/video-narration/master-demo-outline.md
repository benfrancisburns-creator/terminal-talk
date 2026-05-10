# Terminal Talk Long-Form Master Demo

This is the master recording plan. The goal is one continuous screen capture that can stand alone as the full product video and also be cut into shorter videos after review.

## Production Model

Record one long "Terminal Talk in action" session.

- The toolbar is real.
- Assistant terminals are real.
- Sessions are created through Terminal Talk.
- Terminal prompts are visible and substantial.
- Terminal Talk speaks the assistant outputs.
- Host narration is delivered through Terminal Talk clips where useful.
- Short videos are exported from the master using chapter ranges.

The rhythm should be:

```text
Terminal Talk explanation -> visible action -> terminal response -> toolbar proof
```

Do not rush the UI. Cursor movement should be deliberate enough that viewers can follow the control being discussed.

The four terminals must not repeat the same explanation. Treat them as four different proof lanes:

- Claude TT A proves Terminal Talk created a real Claude Code terminal.
- Codex TT A proves mixed assistant traffic can share one visible strip while keeping session identity.
- Claude TT B explains the controls a working user needs once several sessions are active.
- Codex TT B shows the receipts: transcript, collapsed colour flash, Jarvis, and chapterable closing proof.

## Master Chapters

### 1. Cold Open And Promise

Show Terminal Talk collapsed, then hover to reveal the toolbar. Explain the premise:

Terminal Talk turns real Claude Code and Codex terminal output into spoken, logged, session-aware audio. The demo will create four assistant terminals, prompt them together, and show how the toolbar keeps everything identifiable.

### 2. Create Sessions From Terminal Talk

Open Settings, click the Sessions tab, and show Create session.

Create:

- `Claude TT A`
- `Codex TT A`
- `Claude TT B`
- `Codex TT B`

Use the form controls visibly: assistant, permissions, project folder, label, colour, Create.

### 3. Batch Prompt Four Terminals

Paste large, meaningful prompts into all four terminals in quick succession. The prompt text should be visible enough to read the intent.

The prompts should ask each assistant to explain a different part of the product:

- Claude TT A: real creation and session identity.
- Codex TT A: shared strip, dot traffic, and separate session identity.
- Claude TT B: working-user controls, voices, focus, mute, heartbeat, shortcuts.
- Codex TT B: transcript receipts, collapsed colour flash, Jarvis, and closing proof.

Do not make the four terminals say the same feature in different words. The viewer only needs to hear each idea once, then see that same idea remain true for the rest of the capture.

### 4. Toolbar As Control Surface

While replies are arriving, move across:

- play/pause
- rewind/forward
- scrubber mascot
- session tabs/dots
- transcript header
- settings cog
- per-session labels
- colour dropdowns
- focus star
- mute button
- voice control

Narration should explain the controls while the terminals continue doing the proof.

### 5. Transcript And Spoken Record

Open transcript. Show recent entries, session colours, and the spoken/original distinction if available.

This should sell Terminal Talk as more than an audio player: it is also a recent spoken-message record.

### 6. Collapsed Toolbar Flash

Close Settings or let the toolbar collapse. Trigger short lines from different terminals.

The point is explicit:

Even fully collapsed, Terminal Talk still flashes the speaking session colour, so the user can identify the active terminal without reopening the toolbar.

### 7. Hey Jarvis

Show read-anywhere:

- select text in a visible source
- trigger read selected text
- show J clip identity
- show transcript/log entry

Make clear that Jarvis is not Claude or Codex and does not require OpenAI.

### 8. Playback And Settings

Open Playback, Shortcuts, OpenAI, Sessions, and About tabs.

Explain only what the viewer can see:

- speed
- master volume
- auto-collapse
- auto-prune
- heartbeat/tool narration
- editable shortcuts
- optional paid OpenAI voices
- free Edge route remains default

Do not expose API keys.

### 9. Tool Narration And Heartbeat

Run a safe assistant task that reads/searches files. Show tool narration or heartbeat while work is in progress.

The product point:

Terminal Talk can speak progress, not only final answers.

### 10. Closing Recap

End with all important proof visible:

- four terminal sessions
- Terminal Talk toolbar
- transcript entries
- collapsed flash if possible

Closing message:

Terminal Talk keeps terminal-heavy AI workflows audible, identifiable, and reviewable without taking over the screen.

## Short Clip Targets

After the master is accepted, export:

- `create-four-terminals`
- `batch-prompts`
- `collapsed-colour-flash`
- `hey-jarvis`
- `sessions-controls`
- `transcript`
- `settings`
- `heartbeat-tool-narration`

Use `scripts/export-video-chapters.ps1` with `docs/video-narration/master-demo-chapters.json`, then adjust chapter times after watching the master.
