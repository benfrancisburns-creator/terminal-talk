# Page Harvest Concept

Date: 2026-05-01

Status: parked for later product design. This is not part of the current video recording pass.

## Core Idea

Page Harvest should be a project-bound research inbox, not just "send highlighted text to whatever terminal is open".

The useful workflow is:

1. The user is researching on the web.
2. They highlight useful text from pages, docs, blogs, issues, or posts.
3. Terminal Talk captures the selected content and saves it against a chosen project folder.
4. Claude Code or Codex can later read that project harvest folder and turn the gathered material into a plan, summary, implementation notes, or tasks.

This keeps Page Harvest useful even when no Claude Code or Codex terminal is currently open.

## Proposed Storage Shape

Each project gets its own harvest inbox inside the project folder:

```text
<project>\
  .terminal-talk\
    page-harvest\
      2026-05-01\
        index.jsonl
        001-source-title.md
        002-source-title.md
        daily-brief.md
```

The project `.terminal-talk/` folder should be added to local git exclude or otherwise kept out of commits by default.

Each harvest item should preserve:

- source title
- source URL
- captured timestamp
- target project path
- selected text or cleaned page text
- optional user note
- optional tags

## Target Project Selection

Use layered inference:

1. If the foreground app is a tracked Claude Code or Codex terminal, infer the project from that session.
2. Otherwise use the current pinned Harvest target project.
3. Let the user switch target project from a small overlay, tray menu, settings row, or hotkey flow.
4. Populate recent projects from known Claude/Codex sessions and manual pins.

## Assistant Interaction

Page Harvest should have two modes:

- Save to project: no assistant terminal needed.
- Ask assistant: requires an open matching Claude Code/Codex session, or explicit permission to launch one.

Best first implementation:

1. Capture selected text.
2. Save it to the project harvest folder.
3. Offer:
   - Read aloud with Jarvis.
   - Copy assistant prompt.
   - Send to active Claude Code.
   - Send to active Codex.
4. If no matching assistant session is open, show the saved project inbox and let the user ask later.

## Why Not Background Assistant First

Running `claude -p` or `codex exec` in the background is technically possible, but it changes the product shape. Terminal Talk would start feeling like an assistant button rather than a voice/queue layer for terminal assistants.

The safer product line is:

- Terminal Talk captures and organises context.
- Claude Code/Codex remain the assistants.
- Terminal Talk speaks their responses through the existing toolbar, queue, sessions, and transcript surfaces.

## Future Video Idea

If Page Harvest ships, record a dedicated video:

1. Browser research page open.
2. User highlights useful text.
3. Page Harvest saves it to a chosen project.
4. Repeat with two or three sources.
5. Open Claude Code or Codex in that project.
6. Send a prompt referencing today's harvest folder.
7. Assistant replies with a plan.
8. Terminal Talk speaks the response and logs it in the transcript.
