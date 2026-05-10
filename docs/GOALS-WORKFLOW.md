# Terminal Talk Goals Workflow

Status: 2026-05-09.

This workflow is designed for Codex `/goals`: keep one active goal focused on
delivery quality, then use the queue, transcript sidecars, logs, and generated
audio files as the evidence trail.

## Goal Statement

Improve Terminal Talk spoken delivery by continuously auditing generated text
and audio, repairing the highest-impact regressions, and locking each fix with
platform-appropriate tests.

## Reusable `/goal` Prompt

Use this prompt when starting a long-running Codex goal for narration quality:

```text
Improve Terminal Talk's spoken delivery by building and maintaining an
intelligent tracker for transcript-to-audio fidelity.

Terminal Talk is generating transcripts, spoken sidecars, and audio clips, but
real usage shows gaps: highlighted terminal text is sometimes omitted, markdown
or tables can be over-compressed, tool narration can miss important context,
and some text that is visible in the transcript never seems to make it into the
audio. Treat this as an ongoing quality-assurance workflow, not a one-off bug.

Follow docs/GOALS-WORKFLOW.md. On each pass:

1. Capture current evidence from ~/.terminal-talk/queue and related logs.
   - Run npm run synth-audit -- --jsonl ~/.terminal-talk/queue/_audit.jsonl.
   - Inspect recent .original.txt, .txt, .mp3, and .wav artefacts.
   - For the current/live session, compare the transcript source, spoken
     sidecar text, audio clip count, parsed audio duration, and log events.
   - Check whether Codex/Claude response text, highlighted terminal text,
     tool narration, tables, lists, code spans, links, and emphasis each have a
     traceable path from source text to spoken clip.

2. Score delivery quality instead of guessing.
   - Rank turns by shrinkage_ratio, missing_audio_count, missing sidecars,
     category retention, and estimated spoken seconds versus parsed audio
     duration.
   - Separately score prose, lists, tables, code-heavy text, highlighted
     terminal selections, tool-use narration, final answers, and commentary.
   - Identify the highest-impact failure class with concrete artefact examples.
   - Do not assume summarisation is acceptable: decide whether missing content
     is intentional compression, unsafe noise removal, or a real delivery bug.

3. Investigate the provenance chain for the top failure.
   - Start from the original transcript/event/highlighted text.
   - Follow it through sanitisation, sentence splitting, grouping, queue
     sidecar writing, TTS provider invocation, audio file creation, queue
     watching, and playback.
   - Name the exact files/functions responsible for the loss or ambiguity.
   - If the evidence is weak, improve the tracker/audit fields before changing
     delivery behaviour.

4. Repair one high-impact regression at a time.
   - Text-loss fixes usually belong in app/synth_turn.py,
     app/lib/text.js, app/sentence_split.py, or app/narration_ssml.py.
   - Highlight/provenance gaps usually belong in the clipboard/highlight path,
     transcript watcher, Codex/Claude hook path, or queue sidecar writer.
   - Playback/order/duration issues usually belong in audio-player,
     voice-dispatch, queue-watcher, watchdog, or synth daemon code.
   - Keep the fix scoped and preserve existing platform behaviour.

5. Lock the repair with tests and reusable audit coverage.
   - Add fixtures or unit tests that reproduce the exact artefact pattern.
   - On macOS, run npm run test:macos.
   - Run npm test -- --logic-only for cross-platform logic where appropriate.
   - Run npm run synth-audit before and after the repair and record the
     relevant score movement.
   - If full npm test fails due to local Windows/PowerShell/live-install
     prerequisites, report those separately from the repair's test signal.

6. Produce a short audit report at the end of each pass.
   - What evidence was captured?
   - What was the worst current gap?
   - What changed?
   - Which tests or audit commands prove it?
   - What remains the next highest-impact gap?

Do not mark the goal complete until the current pass has:
- captured real queue evidence;
- compared .original.txt, .txt, and audio artefacts where available;
- identified and implemented one high-impact improvement or tracker upgrade;
- added platform-appropriate tests;
- rerun the audit/test commands; and
- documented any remaining blind spots.
```

## Evidence Sources

- `~/.terminal-talk/queue/*.mp3` and `*.wav` are the generated audio clips.
- `~/.terminal-talk/queue/*.txt` is the exact text passed to speech synthesis.
- `~/.terminal-talk/queue/*.original.txt` is the source markdown before TTS
  cleanup when available.
- `~/.terminal-talk/queue/_audit.jsonl` is the rolling synth-audit output.
- `~/.terminal-talk/queue/_hook.log`, `_toolbar.log`, `_watchdog.log`,
  `_voice.log`, and `_synth_daemon.log` show lifecycle and delivery events.
- `~/.terminal-talk/sessions/*-working.flag` shows active sessions watched by
  the transcript stream.

## Loop

1. Capture
   - Run `npm run synth-audit -- --jsonl ~/.terminal-talk/queue/_audit.jsonl`.
   - For live sessions, run `node scripts/synth-audit.cjs --watch=30 --jsonl ~/.terminal-talk/queue/_audit.jsonl`.
   - Keep generated audio and sidecars long enough to compare spoken text,
     original text, byte size, and parsed clip duration.

2. Score
   - Check retention by content category: prose, list, table, code.
   - Prioritise turns with low `shrinkage_ratio`, missing sidecar/audio files,
     or a large mismatch between estimated spoken seconds and parsed audio
     duration.
   - Inspect `missing_backtick`, `missing_table_cell`, `missing_list_marker`,
     `missing_bold`, and `missing_url` before changing sanitisation.

3. Repair
   - Text loss usually belongs in `app/synth_turn.py`, `app/sentence_split.py`,
     or `app/narration_ssml.py`.
   - Streaming/provenance gaps usually belong in `app/lib/transcript-watcher.js`,
     `app/lib/queue-watcher.js`, or the Codex/Claude hook path.
   - Playback/order issues usually belong in `app/lib/audio-player.js`,
     `app/lib/voice-dispatch.js`, or `app/lib/watchdog.js`.

4. Test
   - Use `npm run synth-audit` before and after repairs.
   - Use `npm run test:macos` on macOS.
   - Use targeted `npm test -- --grep ...` style runs only if the local runner
     supports the selected filter; otherwise run `npm test` and separate
     platform-specific failures from regressions.

5. Refine
   - Re-run a real Codex/Claude session and compare:
     - the original response;
     - generated `.txt` spoken sidecars;
     - generated audio count and duration;
     - hook, toolbar, watchdog, and synth daemon logs.
   - Promote repeated failures into fixtures so the next audit pass catches
     them without needing a live session.

## Suggested `/goals` Breakdown

- Map the current provenance chain from transcript event to sidecar to audio.
- Add or repair audit fields until every generated clip has text, audio, size,
  duration, session short ID, and source turn.
- Fix the worst shrinkage categories from `_audit.jsonl`.
- Add macOS-specific tests for any macOS-only watcher, hook, or audio behaviour.
- Keep Windows behaviour covered separately rather than expecting Windows-only
  assertions to pass on macOS.
