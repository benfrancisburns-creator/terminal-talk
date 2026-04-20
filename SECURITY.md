# Security Policy

Terminal Talk is a desktop app with deep system integration (microphone,
global hotkeys, clipboard, file-system writes inside `~/.terminal-talk/`,
and an embedded Python wake-word listener). Vulnerabilities in an app like
this can matter. If you find one, please disclose it responsibly.

## Supported versions

Only the **latest release on `main`** is supported. Fixes land on `main`
and go out in the next tagged release. There are no long-lived support
branches.

| Version | Supported |
|---------|:---------:|
| latest  |     ✅    |
| older   |     ❌    |

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security report.** Instead,
use GitHub's private [Security Advisories](https://github.com/benfrancisburns-creator/terminal-talk/security/advisories/new)
flow. That page lets you draft a report, attach a proof-of-concept, and
coordinate a fix with me before anything becomes public.

If Security Advisories isn't an option for you, email **benjaminfrancisburns@gmail.com**
with `[terminal-talk security]` in the subject line.

### What to include

- Affected component (main.js, renderer, wake-word-listener.py, hooks/*,
  install.ps1, etc.) and — if you can pin it down — the commit SHA.
- Reproduction steps or a proof-of-concept.
- Impact: what an attacker can do given the vulnerability.
- Whether you'd like credit in the advisory/changelog.

### What to expect back

- **Acknowledgement within 72 hours** of your report landing in the inbox.
- A triage decision (accepted / declined / duplicate) within one week.
- A CVE identifier + public advisory once the fix ships, credited to you
  unless you prefer to stay anonymous.

I run this project solo, so "within the hour" isn't realistic — but I do
take security reports seriously and you'll hear back.

## Scope

In scope:

- **Renderer isolation / sandbox escape** — anything that lets a
  crafted string spoken by Claude execute code in the main process.
- **IPC surface bypass** — calling an `ipcMain.handle(...)` from a path
  the renderer shouldn't have access to.
- **Path traversal** in `delete-file`, session-PID file reads,
  or anywhere else that touches the filesystem with a caller-supplied
  string (see `isPathInside()` in main.js).
- **Command injection** in `hooks/*.ps1`, `install.ps1`, or any
  `child_process.spawn()` call.
- **Microphone / wake-word listener** behaviour that causes audio to
  leave the machine without the user's knowledge.
- **Secret exposure** — API keys, session tokens, or clipboard
  contents leaking into logs, telemetry, or third-party services
  beyond the documented endpoints.
- **Install-time footguns** in `install.ps1` (privilege escalation,
  writes outside `~/.terminal-talk/` / `~/.claude/settings.json`,
  tamperable startup shortcuts).

Out of scope:

- Denial-of-service via spamming the queue (auto-prune + `clear played`
  handle this).
- Social-engineering a user into running a modified fork.
- Findings that require local admin access or physical device access.
- Version-specific CVEs in upstream Electron / openWakeWord /
  edge-tts that we're already patched against in `main`.

## Hardening already in place

A summary of what's shipped so would-be reporters can skip the ground
that's already covered:

- **Electron baseline**: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true`,
  `allowRunningInsecureContent: false`, `preload` via
  `contextBridge` only.
- **CSP**: strict meta-tag policy on the renderer (`default-src 'none'`;
  scripts/styles/media only from `self`; `connect-src 'none'`).
- **Navigation guards**: `will-navigate`, `setWindowOpenHandler`,
  and `will-attach-webview` all block anything outside our local
  `app/index.html`.
- **Single-instance lock**: prevents duplicate processes racing on
  shared files; on duplicate launch the existing window is surfaced
  instead.
- **Path traversal guard**: `isPathInside()` gates every filesystem
  write that takes a caller-provided path.
- **Secret redaction**: `redactForLog()` strips API key patterns
  before anything reaches log files.
- **Orphan sweep + watchdog**: stale Python wake-word listeners from
  crashed sessions are killed on startup and every 30 minutes.
- **No telemetry, no analytics, no phone-home.** The only outbound
  network calls are `speech.platform.bing.com` (Edge TTS) and
  optionally `api.openai.com` (fallback, only if you provide a key).
- **Dependencies**: `npm audit` returns 0 vulnerabilities on every
  CI run (`.github/workflows/test.yml`). Dependabot raises PRs for
  npm, pip, and GitHub Actions updates weekly.
- **Static analysis**: GitHub CodeQL scans JavaScript + Python on
  every push to `main`.
- **Tests**: 128 unit tests + 13 Playwright E2E, including hardening
  cases (secret-redaction, path-traversal, registry BOM tolerance,
  watchdog composition).

## Known limitations

These are things we *could* do but haven't yet, and I don't want you to
spend time reporting them as vulnerabilities:

- **Not code-signed on Windows.** Requires a paid Authenticode EV
  certificate or Azure Trusted Signing (both gated on business
  history). SmartScreen will flag the first launch. On the roadmap
  once the project has a stable funding route.
- **No auto-update mechanism.** Users install/upgrade manually from
  GitHub releases. `electron-updater` support is planned but
  intentionally deferred until there's a signed build to update
  *to* — auto-updating into unsigned binaries is worse than no
  auto-update.
- **No crash reporting.** No Sentry / Crashpad uploads. This is a
  deliberate privacy choice; you'll find `diag()` logs under
  `~/.terminal-talk/queue/_toolbar.log` if you need to debug a
  crash locally.

Thank you for helping keep this safe.
