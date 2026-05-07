# Telemetry Policy

**Terminal Talk does not collect telemetry. Of any kind. From anyone. Ever.**

This is a deliberate, durable commitment, not a v0.6 default we'll quietly walk back when the project grows. This document is the durable record of that commitment so any future deviation requires an explicit policy change you can vote against by forking.

## What we don't do

- **No analytics.** No Google Analytics, Plausible, PostHog, Mixpanel, Sentry-style usage tracking, Segment, anything.
- **No phone-home.** The app does not contact any Terminal Talk-controlled server on launch, on idle, on shutdown, on update, or on error. There is no Terminal Talk-controlled server.
- **No crash reports.** Crashes are written to your local `~/.terminal-talk/queue/_toolbar.log` and stay there. We never see them unless you copy-paste into a GitHub issue.
- **No feature usage stats.** We don't count which buttons you click, which voices you pick, which sessions you create, or how long you keep the app open.
- **No A/B testing.** Every install gets identical code paths.
- **No anonymous IDs.** No install UUID, no session hash, no fingerprint.
- **No update pings.** The app never silently checks "what version am I running, what's the latest." Update awareness is via GitHub's release page when you visit it.

## What does leave your machine

The only outbound network activity is **the work you explicitly asked for**. Both endpoints are documented in [README.md → Privacy & Security](README.md#privacy--security) and [SECURITY.md](SECURITY.md):

| Endpoint | When | What's sent | Why |
|---|---|---|---|
| `speech.platform.bing.com` | When a clip is synthesized using Edge TTS (the default voice provider) | The text being spoken | Microsoft Edge TTS is the only way to get the free voices that ship by default. Same endpoint Microsoft Edge browser uses for "Read aloud." |
| `api.openai.com/v1/audio/speech` | Only if you have explicitly saved an OpenAI API key and chosen to prefer it | The text being spoken + your key | OpenAI is the optional premium voice provider. Off by default. The key never leaves your machine except in the request to OpenAI. |
| `huggingface.co/<openWakeWord-model>` | Once at install (and never again) | Model file request | The "hey jarvis" wake-word model is downloaded once during `install.ps1` (~30 MB). After install, wake-word detection runs entirely locally — your microphone audio never leaves your machine. |

That's the entire list. There is nothing else.

## How you can verify

1. **Read the source.** Grep `app/` for `fetch(`, `axios`, `https.request`, `XMLHttpRequest`. You will find exactly the endpoints above.
2. **Watch the wire.** Run Wireshark, mitmproxy, Pi-hole, or `netstat -ano` while using Terminal Talk. The only outbound connections you'll see are to Microsoft Edge TTS (when synthesising) and OpenAI (only if you've configured it).
3. **Disconnect the network.** Terminal Talk continues to work for everything except actual voice synthesis. The toolbar UI, queue management, session identity, transcripts, hotkeys, mic-watcher, wake-word detection, settings — all run locally and don't care that you're offline.

## Why this matters

Most "free, open-source dev tools" eventually add opt-in telemetry "to understand how the tool is used." Each one starts with the same defence: opt-in only, anonymous, transparent, deletable on request. Each one then gradually loosens as the maintainer rationalises what they need to know to "ship the right features." Each one ends up shipping data home that the user never knowingly agreed to.

Terminal Talk treats the absence of telemetry as a feature. Not a future opt-in. Not a default-off knob. Not present at all.

The trade-off is real: we will never know which features get used. That's accepted as the cost of being trustworthy by default. If you want a feature changed or fixed, the right channel is an issue, a discussion, or a PR — not a usage funnel watching what you do.

## How a future version could change this

If a future maintainer wants to add any kind of telemetry to Terminal Talk, the rule is:

1. **A separate, explicit feature, not a default.** Off out of the box. Off after every update. Off without a UI prompt the user actively dismissed.
2. **Open source the collector.** If we collect anything, the schema, the endpoint, and the storage policy must be public and auditable.
3. **Documented in this file.** This file is the contract. A change here is the change. If TELEMETRY.md still says "no telemetry of any kind" but the binary phones home, that's a vulnerability — file a private Security Advisory at https://github.com/benfrancisburns-creator/terminal-talk/security/advisories/new.
4. **Rejected by default if controversial.** A maintainer who cannot get community consensus on a telemetry change should not ship the change.

## TL;DR

The only data that leaves your machine when using Terminal Talk is the text you asked it to speak, going to the TTS provider you chose. Everything else stays local. There is no Terminal Talk server. There is no sign-up. There is no account. There is no usage tracking. There is no plan to add any.
