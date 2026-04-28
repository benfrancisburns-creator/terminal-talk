# Terminal Talk Command-Center Video Production Pack

Goal: create a polished animated advert where the Terminal Talk mascot acts as the command-center operator for multiple terminal sessions: frontend, backend, tests, docs, deployments, Claude Code, and Codex.

## Recommended Route

Use **Runway Act-Two** for the talking mascot performance, then finish locally in Terminal Talk's existing video pipeline.

Why: Act-Two is designed for a driving performance video plus a character image. That means we can feed it the exact Terminal Talk mascot reference and drive the mascot with real speech, expression timing, and gestures. Use Sora for cinematic command-center B-roll or alternate generated shots, but use Runway when the mascot needs to speak and feel directed.

Current tool notes checked on 2026-04-27:

- Runway Act-Two accepts a driving performance video plus character image/video, supports up to 30 seconds, 16:9 at 1280x720, 24fps, gesture control for character images, and facial expressiveness controls.
- Sora supports image uploads, storyboards, stitching, and generated video with sound/dialogue, but should be treated as B-roll/storyboard generation for this project because exact pixel mascot consistency may drift.
- HeyGen Photo Avatars can animate a still image with lip sync, but their own guidance says photo avatars work best with human-like faces. Use it as a fallback only.
- ElevenLabs is the best external voice option if we want more expressive mascot/terminal voices than Edge TTS.

## Files To Upload

Use these files as the core reference pack:

- `docs/assets/ad/production-pack/terminal-talk-mascot-character-reference.png`
- `docs/assets/ad/production-pack/terminal-talk-mascot-transparent.png`
- `docs/assets/ad/production-pack/terminal-talk-speech-bubble-transparent.png`
- `docs/assets/ad/production-pack/terminal-talk-brand-reference-sheet.png`
- `docs/assets/ad/terminal-talk-command-center.png`
- `docs/assets/wallpaper/terminal-talk-wallpaper.png`

Use the first mascot reference as the character image for Act-Two. Use the brand sheet and command-center plate as visual references for Sora or Runway Gen-4 References.

## Best Production Pipeline

1. **Voice and performance**
   - Record a 25-30 second performance video of one person facing camera.
   - Speak the mascot lines with clear timing and small command gestures.
   - Keep it waist-up, well lit, with hands visible if gestures are wanted.
   - Keep movement deliberate, not frantic.

2. **Mascot animation**
   - In Runway, select Gen-4 Video, then Act-Two.
   - Driving performance: upload the recorded performance video.
   - Character input: upload `terminal-talk-mascot-character-reference.png`.
   - Gesture control: on for a more animated commander, off if the mascot shape drifts.
   - Facial expressiveness: start at `3`; reduce if the pixel face distorts.

3. **Command-center environment**
   - Generate or use `terminal-talk-command-center.png` as the base war-room environment.
   - Add local terminal panels and session labels in our compositor so text stays readable and accurate.

4. **Final edit**
   - Composite the Act-Two mascot output over the command center.
   - Add terminal session panels for: Frontend, Backend, Tests, Docs, Deploy, Claude Code, Codex.
   - Add short radio-style terminal replies as separate voices.
   - Finish with Terminal Talk logo, speech bubble, and the saved product video snippets if needed.

## Storyboard

**0-4s: Command Center Wakes**

Dark software command center. Orange runway lights come on. Terminal panels boot around the room.

Caption: `Every terminal becomes a command center.`

**4-10s: Mascot Takes Command**

Mascot steps/glides into center frame. Speech bubble appears. Audio scrubber-style light trail moves behind him.

Mascot: “Terminal Talk online. Bring every session into view.”

**10-18s: Terminal Reports**

Frontend and backend terminals light up left and right. Each report is spoken.

Mascot: “Frontend, report.”

Frontend terminal: “Settings panel is clean. Voice controls are ready.”

Mascot: “Backend?”

Backend terminal: “Hooks are live. Queue handling is stable.”

**18-27s: Battlefield Overview**

Tests, docs, deployments, Claude Code, and Codex panels connect to the mascot with coloured session lines.

Tests terminal: “Checks green.”

Docs terminal: “Landing page assets updated.”

Codex terminal: “Review queue clear.”

Mascot: “Decision point: merge after review, then deploy.”

**27-36s: Hey Jarvis**

A highlighted text clip flies into the spoken queue. The mascot turns toward the speech bubble.

Mascot: “Hey Jarvis clip received. Priority audio goes first.”

Narrator: “Read any selected text aloud without leaving your workflow.”

**36-45s: Product Promise**

Camera pulls back. All terminals remain connected, but the mascot is calm in the center.

Narrator: “Terminal Talk gives Claude Code and Codex a voice, so you can keep building while the work speaks back.”

End card: `TERMINAL TALK` / `Hands-free workflow for Claude Code and Codex`

## Runway Act-Two Prompt

Upload:

- Driving performance video: the recorded mascot dialogue performance.
- Character image: `terminal-talk-mascot-character-reference.png`.

Prompt:

```text
Animate this exact pixel-art Terminal Talk mascot as a confident software command-center operator.
Keep the mascot orange, rectangular, pixelated, friendly, and brand-consistent.
The mascot is standing in a futuristic software operations command center, communicating with multiple terminal sessions.
Preserve the square eyes, smile, chunky legs, simple body shape, and pixel-art edges.
The mascot should speak clearly, look engaged, and make small command gestures toward holographic terminal panels.
Tone: professional, energetic, clever, premium software advert.
Avoid changing the mascot into a human, animal, robot with arms, military soldier, weapon, or different logo.
Avoid adding unreadable fake brand text.
```

Settings:

- Aspect ratio: `16:9`
- Duration: `25-30 seconds`
- Gesture control: start `On`; retry `Off` if the body drifts.
- Facial expressiveness: start `3`; retry `2` if the mouth becomes messy.

## Sora B-Roll Prompt

Use this for establishing shots, scene extensions, or alternate cinematic plates.

Upload:

- `terminal-talk-brand-reference-sheet.png`
- `terminal-talk-command-center.png`
- optionally `terminal-talk-wallpaper.png`

Prompt:

```text
Create a cinematic software command-center advert shot for Terminal Talk.
The scene is a futuristic developer war room, but metaphorical and non-violent: no weapons, no soldiers, no explosions.
Multiple terminal sessions and project panels orbit a central mascot-command position.
Visual language must match the reference images: dark glass, Terminal Talk orange, cyan terminal glow, pixel-art brand style, white pixel speech bubble, colourful session dots.
Camera motion: slow push-in, subtle parallax, premium product-launch feel.
Show terminal panels for frontend, backend, tests, docs, deployment, Claude Code, and Codex as abstract readable-looking panels, but avoid fake brand logos.
Leave center space for the exact Terminal Talk mascot to be composited later.
Sound: low cinematic technology pulse, soft terminal beeps, no aggressive battle sounds.
```

## Voice Direction

Mascot voice:

```text
Male or neutral British tech lead, calm under pressure, warm confidence, quick but clear.
Sounds like a command-center operator for software teams, not a military commander.
```

Terminal voices:

```text
Short radio-check style confirmations, each slightly different voice, clean and professional.
Frontend: brighter voice.
Backend: lower, steady voice.
Tests: concise, neutral voice.
Docs: warm voice.
Codex/Claude: assistant-like, calm voice.
```

## Mascot Dialogue Script

```text
Terminal Talk online. Bring every session into view.
Frontend, report.
Backend?
Tests and docs, status.
Codex, give me the review queue.
Decision point: merge after review, then deploy.
Hey Jarvis clip received. Priority audio goes first.
Every terminal has a voice now. Keep building. I will keep watch.
```

## Terminal Session Replies

```text
Frontend: Settings panel is clean. Voice controls are ready.
Backend: Hooks are live. Queue handling is stable.
Tests: Checks green. No blockers.
Docs: Landing page assets updated.
Codex: Review queue clear.
Claude Code: Implementation notes captured.
Deploy: Release candidate is ready.
```

## Local Finishing Notes

After external clips are generated:

1. Put downloaded clips into `docs/assets/ad/external/`.
2. Keep raw exports as `*-raw.mp4`.
3. Composite and encode final outputs into `docs/videos/`.
4. Preserve any approved version with a timestamped `*-saved-YYYYMMDD-HHMMSS` filename before iterating.

Do not rely on the AI video tool for exact UI text. Generate the cinematic motion there, then add terminal labels, session names, captions, and final product UI locally.

## Reference Links

- Runway Act-Two: https://help.runwayml.com/hc/en-us/articles/42311337895827
- Runway multi-character Act-Two workflow: https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two
- Sora video generation and storyboard docs: https://help.openai.com/en/articles/9957612-generating-videos-on-sora
- Sora app creation docs: https://help.openai.com/en/articles/12460853-creating-videos-on-the-sora-app
- HeyGen Photo Avatars: https://help.heygen.com/en/articles/10034438-our-new-photo-avatars
- ElevenLabs Text to Speech: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
