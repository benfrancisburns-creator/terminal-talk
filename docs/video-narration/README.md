# Terminal-Read Narration Pack

This pack is for the two-screen recording where the terminals provide the narration through Terminal Talk itself.

The preferred production model is now one long-form master capture first, then shorter cuts exported from that master. See:

- `master-demo-outline.md`
- `master-demo-runbook.md`
- `master-demo-prompts.md`
- `master-feature-plan.md`
- `operator-master-prompt-sheet.md`
- `master-session-scripts/`
- `master-demo-chapters.json`
- `scripts/export-video-chapters.ps1`

## Core Idea

Do not record a separate narrator talking over Terminal Talk.

Instead, each assistant terminal reads a role-specific Markdown script and outputs its assigned narration response. Terminal Talk then speaks that assistant response, adds it to the queue, stores it in transcript, and flashes the correct session colour when collapsed.

For the master recording, the four terminals should not repeat each other:

- `Claude TT A` is the launch witness.
- `Codex TT A` is the traffic narrator.
- `Claude TT B` is the working-user narrator.
- `Codex TT B` is the receipts and closing narrator.

That means the video demonstrates the real product:

- real Claude Code and Codex sessions
- real Terminal Talk audio clips
- real session labels, colours, voices, and registry rows
- real shared audio strip with per-terminal queues
- real transcript entries
- real collapsed-toolbar colour flashes

## Screen Layout

Use two screens in one recording span.

Screen A:

- Four terminal windows in quadrants.
- Top-left: `Claude TT A`
- Top-right: `Codex TT A`
- Bottom-left: `Claude TT B`
- Bottom-right: `Codex TT B`

Screen B:

- Terminal Talk toolbar.
- Start collapsed.
- Hover to show the resting toolbar.
- Open settings with the cog.
- Use the Sessions section for Create session and registry proof.
- Later use the transcript panel and collapsed state.

## Master Script Files

- `master-session-scripts/claude-tt-a.md`
- `master-session-scripts/codex-tt-a.md`
- `master-session-scripts/claude-tt-b.md`
- `master-session-scripts/codex-tt-b.md`

Use `operator-master-prompt-sheet.md` for the exact visible prompts to paste into each terminal.

To send the four master prompts quickly during a take, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\send-master-video-prompts.ps1 -UseQuadrantCoordinates
```

## Legacy Cue Files

- `claude-tt-a.md`
- `codex-tt-a.md`
- `claude-tt-b.md`
- `codex-tt-b.md`

Each legacy file contains assistant instructions plus cue lines. Keep these for recovery takes or short targeted clips.

The prompt pattern is:

```text
Read docs/video-narration/claude-tt-a.md and output cue CLAUDE-A-01 only.
```

The assistant should output only the spoken line for that cue.

## Recording Flow

1. Begin with Terminal Talk collapsed on Screen B.
2. Hover to show the compact toolbar.
3. Click the cog to open Settings.
4. Click the Sessions tab and use Create session.
5. Launch `Claude TT A`.
6. Show it registering immediately.
7. Launch `Codex TT A`.
8. Launch `Claude TT B`.
9. Launch `Codex TT B`.
10. Paste all four master prompts from `operator-master-prompt-sheet.md` quickly.
11. Let Terminal Talk speak the role-specific responses while the cursor points to the matching controls.
12. Open transcript and show recent spoken entries.
13. Let the toolbar collapse.
14. Use collapsed-flash recovery prompts only if the master responses do not produce a clear flash.
15. Show Jarvis as a separate J clip.
16. End with Settings or Transcript showing all four sessions.

Legacy cue flow for recovery takes:

1. Prompt Codex with `CODEX-A-01`; this first prompt binds Codex into Terminal Talk.
2. Prompt Codex B with `CODEX-B-01`.
3. Use the queue cues to show clips sharing the same audio strip while remaining separate per terminal.
4. Open transcript and use transcript cues.
5. Let the toolbar collapse.
6. Use collapsed-flash cues from different terminals.
7. End with Settings open to Sessions or Transcript showing all four sessions.

## Important Wording

Use this wording when describing queues:

> The audio clips share the same toolbar strip, but Terminal Talk keeps a separate queue for each terminal session.

Do not say all clips go into "the same queue"; that is inaccurate.

## Pass Criteria

- No external voiceover is needed for the main proof.
- The terminal response itself is what Terminal Talk speaks.
- Every spoken line is short enough for the queue and transcript to remain readable.
- Codex A and Codex B must stay separate even when their native session IDs share the same first 8 characters.
- The toolbar must show session colours in expanded and collapsed states.
