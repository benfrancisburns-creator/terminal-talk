# Terminal Talk Platform Parity

Status: 2026-05-10. Windows is the reference implementation because it shipped
first; macOS should match user-facing behaviour wherever the OS allows it.

## Behaviour Matrix

| Area | Windows reference | macOS current | Parity status |
|---|---|---|---|
| Toolbar playback queue | Electron toolbar, dot strip, transcript panel, focus/mute/voice overrides | Same shared Electron renderer and queue | Equivalent |
| Assistant audio | Claude hooks/transcript watcher; Codex hooks plus rollout watcher | POSIX Claude/Codex hooks; shared Codex rollout watcher; POSIX synth daemon | Equivalent, different hook shell |
| Highlight-to-speak | PowerShell/Windows clipboard helper | Quartz Cmd+C helper with Accessibility permission | Equivalent |
| Wake word | openWakeWord plus local command recognition | openWakeWord plus SFSpeechRecognizer command recognition | Equivalent, different recognizer |
| Voice commands | SAPI recognizer | macOS Speech recognizer, on-device required | Equivalent grammar |
| Mic auto-pause | Windows mic watcher | CoreAudio process-input watcher on macOS 14+ | Equivalent on supported macOS |
| End-of-reply footer | Windows Terminal UIA scrape via main-process watcher | `synth_turn.py` POSIX footer clip; Terminal.app/iTerm2 AppleScript scrape, JSONL fallback | Equivalent UX in supported terminals |
| Create session | Windows Terminal bridge, title, tab colour, provisional-to-real binding | Terminal.app `osascript`, title only, registry binds after hooks/rollout | Partial: tab colour is Windows-only |
| Codex terminal identity surface | Windows Terminal title sync plus registry | Terminal.app launch title plus registry/rollout identity | Partial: no tab colour/title resync API |
| Doctor/installer | PowerShell installer and diagnostics | `install.sh`, LaunchAgent, `tt-doctor.sh`, permission checks | Equivalent intent |
| Tests | Full unit harness contains many Windows-specific PowerShell/SAPI assertions | `npm run test:macos` validates macOS packaging, hooks, helpers, and doctor | Partial: suites are platform-specific |

## Known Gaps To Close

1. **Codex title/colour surface on macOS.** Windows can set Windows Terminal
   title and tab colour. macOS Terminal.app launch can set a title, but there is
   no equivalent per-tab colour API. Keep toolbar/session registry as the source
   of truth and only chase title refresh if it is reliable.
2. **Footer scrape coverage.** Windows covers Windows Terminal. macOS covers
   Terminal.app and iTerm2. Other macOS terminals fall back to JSONL-duration
   phrasing, which is acceptable but not exact.
3. **Mic watcher OS floor.** Windows auto-pause is broad. macOS depends on
   CoreAudio process-input properties available on newer macOS releases.
4. **Test split.** The historic `npm test` runner still contains Windows-only
   PowerShell/SAPI expectations. macOS parity work should use `npm run
   test:macos` plus targeted platform-neutral unit tests instead of forcing
   Windows-only assertions through on macOS.

## Parity Rule

When adding a Windows feature, add the macOS behaviour contract at the same time:
platform flag, docs, install/doctor checks, and a macOS test if the behaviour is
implemented differently. When a behaviour cannot be identical because the OS
surface differs, document the user-visible substitute and keep the toolbar,
queue, transcript, and registry semantics identical.

