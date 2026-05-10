# Operator Master Prompt Sheet

Use these prompts for the long-form master recording.

The point is to prompt each terminal once, then let Terminal Talk speak and queue the resulting responses.

The on-screen prompt must be substantial. The viewer should see a real paragraph-level assignment, not a tiny placeholder like `Read docs video narration`. The helper script builds the prompt by pasting the narration text itself after a short neutral instruction.

Prompt order:

1. Claude TT A
2. Codex TT A
3. Claude TT B
4. Codex TT B

Send them quickly. If the responses complete in a different order, that is acceptable; the role split still works because each response owns a different proof lane.

## Claude TT A

```text
Output only the Terminal Talk narration below. Do not add a preface.

This is Claude TT A. This terminal was launched from Terminal Talk's Sessions tab during the recording. It was not pre-staged, and it is not a mock window.

The form on the right chose the assistant, label, colour, project folder, and screen position before the window opened. Once the terminal appeared, Terminal Talk registered it as a live session and gave it a stable identity.

That is the core proof: the terminal stays where developers already work, while Terminal Talk adds the missing layer around it. You get a readable name, a session colour, a voice, and a toolbar entry that follows the session.
```

## Codex TT A

```text
Output only the Terminal Talk narration below. Do not add a preface.

This is Codex TT A. The useful part here is not just that one terminal can talk. It is that several assistant terminals can produce work at the same time and the audio still stays organised.

Watch the queue and the session tabs on the toolbar. Clips arrive from different windows, but the colour, label, and voice keep the source obvious. The user does not have to search four terminal panes to know who just finished.

That matters during real work. Replies do not arrive in a perfect order, and some sessions are noisier than others. Terminal Talk turns that mess into a queue you can listen through without losing the connection back to the terminal that produced each clip.
```

## Claude TT B

```text
Output only the Terminal Talk narration below. Do not add a preface.

This is Claude TT B. Once the desktop has multiple assistant sessions, the quiet controls become the valuable controls: focus one session, mute another, change a voice, and keep the terminal windows themselves untouched.

The Settings panel is split into tabs for that reason. Playback holds speed, volume, auto-collapse, and pruning. Sessions holds labels, colours, voices, mute, focus, and launch controls. Shortcuts and OpenAI are separate, so the panel is no longer one long wall of scrolling settings.

The point is control without turning the desktop into a separate dashboard. Terminal Talk stays small, but the session identity is strong enough that a user can listen while still looking at code, logs, diffs, or another terminal.
```

## Codex TT B

```text
Output only the Terminal Talk narration below. Do not add a preface.

This is Codex TT B. Spoken output should leave a trace, so the Transcript panel keeps recent clips tied to the session that produced them. The viewer can hear the clip, see the source, and still copy or inspect the spoken text.

Now watch the collapse behaviour. The full toolbar gets out of the way and returns to the original slim letterbox strip. When a terminal speaks from the background, that strip flashes the active session colour instead of opening the whole panel again.

Jarvis is kept separate from assistant responses. Assistant clips use the mascot because they come from terminals. Selected text and quick reading use the J clip, so manual screen reading does not get confused with Claude or Codex session output.
```

## Fallback Collapsed Flash Prompts

Use these only if the main response timing does not produce a clear collapsed-toolbar flash.

### Claude TT A

```text
Say: This is Claude TT A. The collapsed strip is flashing blue while I speak.
```

### Codex TT A

```text
Say: This is Codex TT A. The collapsed strip is flashing magenta while I speak.
```

### Claude TT B

```text
Say: This is Claude TT B. The collapsed strip is flashing brown while I speak.
```

### Codex TT B

```text
Say: This is Codex TT B. The collapsed strip is flashing white while I speak.
```
