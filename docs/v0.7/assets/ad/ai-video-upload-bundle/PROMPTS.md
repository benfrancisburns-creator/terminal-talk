# Terminal Talk AI Video Prompts

Use this file as the copy-paste source for the external AI video tools.

The goal is not a local slideshow. The goal is real AI-generated motion footage: a cinematic software command center, the Terminal Talk mascot acting as commander, terminal sessions reporting in, and a final polished product advert.

## Upload Assets

Upload these from the bundle first:

- `assets/01-mascot-character-reference.png`
- `assets/02-mascot-transparent.png`
- `assets/03-speech-bubble-transparent.png`
- `assets/04-brand-reference-sheet.png`
- `assets/05-command-center-reference.png`
- `assets/06-terminal-talk-wallpaper.png`

Use `assets/01-mascot-character-reference.png` as the mascot character reference.

Use `assets/04-brand-reference-sheet.png` as the overall brand/style reference.

Use `assets/05-command-center-reference.png` as the environment reference only. The final video should evolve beyond that still image into proper moving footage.

## Cheaper Tool Options

Runway Act-Two is the strongest fit, but it may not be worth paying $35/month just for this video.

Lower-cost routes:

- **Pika / Pikaformance**: best first test for short talking mascot clips. Use the mascot reference image plus the audio clips in `audio/`. Keep clips under 10 seconds if using a free/low-credit tier.
- **Hedra**: good for image plus audio talking-character tests. Try it with the mascot reference and short mascot lines first. It may preserve cartoons better than human-only lip-sync tools.
- **Kling / Luma / Sora**: better for command-center moving environment shots than exact lip-sync mascot performance.
- **Local fallback**: animate the mascot ourselves with a pixel-art rig, mouth shapes, camera moves, and AI-generated background plates. This is cheaper and fully controllable, but it will look like designed motion graphics rather than full generative character footage.

Best low-cost split:

1. Use **Pika or Hedra** only for the mascot talking close-ups.
2. Use **Sora/Kling/Luma/Pika image-to-video** for command-center B-roll.
3. Add exact terminal labels, captions, product UI, and final audio locally.

## Pika / Pikaformance Mascot Prompt

Use this if testing a cheaper talking-character option.

Upload:

- Character image: `assets/01-mascot-character-reference.png`
- Audio: one short file from `audio/`, preferably `001-mascot.mp3`, `012-mascot.mp3`, or `014-mascot.mp3`

Prompt:

```text
Animate this exact orange pixel-art mascot speaking in sync with the uploaded audio.

The character is the Terminal Talk mascot: friendly orange pixel-art body, rectangular head/body, square eyes, simple smile, chunky legs, no arms unless tiny simple pixel gestures are needed. Keep the silhouette and pixel geometry extremely close to the reference image.

Place the mascot inside a futuristic software command center with glowing terminal panels around it. The mascot is a calm workflow commander speaking to frontend, backend, tests, docs, Claude Code, and Codex terminal sessions.

Motion should be expressive but controlled: small head turns, slight bounce, clear lip-sync/mouth movement, subtle gestures toward terminal panels. Keep it premium and professional.

Avoid redesigning the mascot, realistic robot details, human features, fur, animal traits, weapons, soldiers, explosions, military logos, fake brand text, or unreadable captions.
```

Use short clips first:

- `001-mascot.mp3`: opening command
- `012-mascot.mp3`: decision point
- `014-mascot.mp3`: final promise

## Hedra Mascot Prompt

Upload:

- Character image: `assets/01-mascot-character-reference.png`
- Audio: one mascot clip from `audio/`

Prompt:

```text
Create a talking-character video from this exact Terminal Talk mascot image.

Preserve the orange pixel-art mascot design: rectangular body, square eyes, simple smile, chunky legs, pixelated edges, friendly command-center personality. The mascot should speak the uploaded audio clearly and look like a software operations commander.

Scene style: futuristic software command center, dark glass, orange and cyan lighting, terminal panels, project dashboards, workflow map lines. The tone is premium product advert, not comedy meme and not military combat.

The character should move naturally for a pixel mascot: subtle bounce, turns toward terminals, clear mouth movement, calm confident delivery.

Do not transform the mascot into a human, animal, realistic robot, soldier, or different logo. Do not add weapons, explosions, gore, or military imagery.
```

## Runway Act-Two Mascot Prompt

Use this when generating the talking mascot performance.

```text
Animate this exact Terminal Talk mascot as a living pixel-art command-center operator.

The mascot is a friendly orange pixel character with a rectangular body, square eyes, simple smile, chunky legs, and a white pixel speech bubble language. Keep the silhouette and pixel-art geometry very close to the reference. Do not turn it into a human, animal, realistic robot, soldier, weapon, or different mascot.

Scene: a futuristic software operations command center, like a developer war room for code projects. This is metaphorical, non-violent, and professional. Multiple terminal sessions and project dashboards surround the mascot: frontend, backend, tests, docs, deploy, Claude Code, and Codex.

Performance: the mascot speaks like a calm technical lead coordinating the room. It turns toward different terminal panels as they report in, nods when checks pass, points or gestures toward the active terminal session, then turns back to camera for decisions.

Motion style: cinematic product advert, premium technology launch, energetic but controlled. The mascot should feel alive and expressive while preserving the pixel-art shape. Mouth movement should match speech without becoming messy or realistic.

Lighting: dark glass command center, warm Terminal Talk orange rim light, cyan terminal glow, green status accents, subtle volumetric beams. Keep the center focused on the mascot.

Avoid: military combat, guns, explosions, soldiers, gore, real-world logos, unreadable fake brand text, mascot redesign, realistic face, extra limbs, or clutter over the mascot.
```

Suggested settings:

- Aspect: `16:9`
- Duration: `25-30 seconds per generated segment`
- Gesture control: start `On`
- Facial expressiveness: start `2` or `3`
- If the body deforms, rerun with gesture control off and lower expressiveness

## Sora / Cinematic B-Roll Master Prompt

Use this to create the command-center moving footage and environment shots.

```text
Create a cinematic animated advert for Terminal Talk, a hands-free voice workflow for Claude Code and Codex.

The setting is a futuristic software command center: a high-end developer operations war room with animated terminal panels, code-flow maps, project dashboards, queue indicators, status lights, and session lines connecting many active terminal windows. This is a metaphorical software battlefield, not actual combat.

Visual references: match the uploaded Terminal Talk brand sheet and wallpaper. Use dark glass, Terminal Talk orange, cyan terminal glow, green status lights, colorful session dots, and white pixel speech-bubble language. The mascot is an orange pixel-art commander, but if the exact mascot cannot be preserved, leave the center clear so the exact mascot can be composited later.

Camera motion: slow cinematic push-in through the command center, parallax across floating terminal panels, close-ups of project maps and queue activity, then a pullback to reveal the entire room connected to the mascot command position.

Show abstract terminal areas for frontend, backend, tests, docs, deployment, Claude Code, and Codex. Do not create exact UI text that needs to be read; leave exact labels and captions for local editing later.

Tone: premium software product launch, clever, energetic, professional, polished.

Audio intent: low cinematic technology pulse, soft terminal beeps, calm spoken command-center dialogue.

Avoid: weapons, soldiers, explosions, real military imagery, game logos, fake brand logos, unreadable text blocks as the focus, mascot redesign, dark muddy footage, or cluttered center frame.
```

## Shot Prompts

Generate these as separate clips if the tool works better in shorter shots.

### 01 Command Center Boot-Up

```text
Cinematic opening shot of a futuristic software command center powering on.

The room is dark glass and charcoal metal with Terminal Talk orange runway lights and cyan terminal glow. Floating terminal panels boot around the edges of the room. The center is empty and reserved for the mascot commander to appear later.

Camera: slow forward dolly from the back of the room toward the central command platform. UI panels wake up with soft light sweeps and status pulses.

No mascot yet. No readable fake text. No people. No weapons. No explosions. Premium software advert style.
```

### 02 Mascot Command Position

```text
The exact Terminal Talk orange pixel mascot appears in the center of the software command center as the commander of the workflow.

Use the uploaded mascot reference. Preserve the rectangular orange pixel body, square eyes, simple smile, chunky legs, and friendly pixel-art look. The mascot looks around the room as terminal panels connect to it with colored session lines.

Camera: medium hero shot, slight low angle, soft orange rim light behind the mascot, cyan panels orbiting in depth.

Motion: the mascot comes alive, nods, speaks, and gestures to the left and right terminal sessions. Keep movement clean and readable.

Avoid changing the mascot design, adding realistic limbs, turning it human, or adding weapons/military imagery.
```

### 03 Frontend And Backend Report

```text
Two sides of the command center light up: frontend panels on the left and backend panels on the right.

The Terminal Talk mascot stands in the center, turns left for the frontend report, then turns right for backend. Colored session lines connect the mascot to each terminal cluster.

Frontend side: UI wireframes, settings controls, voice picker shapes, color swatches, polish indicators.
Backend side: hooks, queue flow, session registry, deployment pipeline shapes, service topology.

Camera: smooth lateral move from left panels through mascot to right panels, with parallax and animated data flow.

Keep text abstract. Exact labels will be added locally later.
```

### 04 Tests Docs Claude Codex Overview

```text
Wide battlefield-overview shot of the software command center.

Multiple terminal sessions report at once: tests, docs, Claude Code, Codex, deployment. The mascot remains calm at the center, receiving all signals and turning them into a clear workflow decision.

Visuals: green check signals for tests, documentation panels, assistant-stream panels, code review queue, deployment readiness line. Color-coded session dots pulse around the mascot.

Camera: crane-like pullback to show the full command center map, then slow push toward the mascot.

No real combat. This is a software operations metaphor.
```

### 05 Decision Point

```text
Cinematic close-up on the mascot in the command center as all terminal session lines converge.

The room pauses for a decision. Orange and cyan light focus on the mascot. A clean decision signal travels from Codex and Claude panels back to the central command position.

The mascot confidently relays the decision: merge after review, then deploy.

Camera: dramatic but professional close-up, shallow depth, terminal panels blurred in background, crisp mascot foreground.

Avoid fake readable text. Exact decision caption will be added locally.
```

### 06 Hey Jarvis Priority Clip

```text
Show the Hey Jarvis feature as a cinematic priority signal.

A highlighted text clip becomes a glowing audio packet and travels across the command center into the Terminal Talk queue. The mascot turns toward it and the white pixel speech bubble appears.

The priority clip jumps ahead of other queue items. The scene should make it clear that selected text can be spoken immediately without leaving the workflow.

Camera: fast but smooth tracking shot following the priority packet into the mascot command position, then a quick hero pause on the speech bubble.

Keep the speech bubble style consistent with the uploaded reference.
```

### 07 End Card Pullback

```text
Final hero pullback of the full Terminal Talk command center.

The mascot stands in the center with all terminal sessions connected and stable. The room feels calm, organized, and powerful. Terminal panels continue moving subtly in the background.

Camera: slow pullback, then settle on a clean center composition with room for the Terminal Talk logo and final caption to be added locally.

Tone: premium, confident, polished product advert. No combat imagery. No fake logos.
```

## Dialogue For Mascot Performance

Use this as the spoken performance script:

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

## Terminal Replies

Use these for secondary voices:

```text
Frontend: Settings panel is clean. Voice controls are ready.
Backend: Hooks are live. Queue handling is stable.
Tests: Checks green. No blockers.
Docs: Landing page assets updated.
Codex: Review queue clear.
Claude Code: Implementation notes captured.
Deploy: Release candidate is ready.
```

## Export Names

Download generated clips into:

`docs/assets/ad/external/`

Use these names:

- `01-command-center-boot.mp4`
- `02-mascot-command.mp4`
- `03-frontend-backend.mp4`
- `04-status-overview.mp4`
- `05-decision-point.mp4`
- `06-hey-jarvis-priority.mp4`
- `07-end-card-pullback.mp4`

Once these files exist, the final local pass should add exact labels, captions, product UI, audio timing, and final WebM/MP4 exports.
