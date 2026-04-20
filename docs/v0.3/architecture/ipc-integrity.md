# PS → synth_turn IPC integrity

**Status:** accepted — no authentication layer is added between hooks and
`synth_turn.py`. This doc records the three options considered and the
reasoning behind the decision so future contributors don't re-open the
question without new information.

**Audit source:** ULTRAPLAN-ADDENDUM D2-4 (originally `full-review §7`
IPC integrity concern).

---

## The surface

Three PowerShell hooks registered in `~/.claude/settings.json` spawn
`synth_turn.py` whenever Claude Code emits a turn:

```
~/.claude/settings.json  →  hooks/speak-response.ps1
                         →  hooks/speak-on-tool.ps1
                         →  hooks/speak-notification.ps1
                                 │
                                 ▼
                         Start-Process python synth_turn.py
                           --session <id>
                           --transcript <path>
                           --mode on-stop|on-tool|on-notification
```

`synth_turn.py` reads the transcript, synthesises clips via `edge-tts`
(or OpenAI fallback), writes them into `~/.terminal-talk/queue/`. The
electron toolbar's file watcher picks them up and plays them.

`Start-Process` is a fire-and-forget call. Nothing on the Python side
verifies which process invoked it, and nothing on the PowerShell side
verifies the transcript path points at a legitimate Claude Code session.

---

## The audit concern

A separate process running **as the same Windows user** could spawn
`synth_turn.py` with arbitrary `--session`, `--transcript`, `--mode`
arguments. The result: attacker-chosen text synthesised and played
through the user's speakers, or spurious clips injected into the
queue directory to be spoken next time the toolbar is focused.

---

## Options considered

### Option 1 — HMAC-signed argv

Generate a user-scoped secret on install (`~/.terminal-talk/hook-secret.bin`,
DPAPI-protected on Windows, 0600 on POSIX). Hooks compute
`HMAC-SHA256(secret, argv ++ timestamp)` and pass it as an extra
argument. Python verifies before reading the transcript.

Pros: cryptographically sound; replay protection via timestamp.

Cons:
- Adds a secret lifecycle: generation on install, rotation policy,
  uninstall cleanup, DPAPI wrapper on Windows, fallback on macOS /
  Linux (when we get there).
- Python gains a dependency on `hmac` + timestamp validation code.
- Signature verification in PS 5.1 using `[System.Security.Cryptography.HMACSHA256]`
  is straightforward but not idiomatic and adds testing surface.
- Doesn't prevent an attacker with same-user privileges from reading
  the secret file. The secret is only meaningful if the attacker
  *can* spawn `synth_turn.py` but *can't* read files owned by the
  user — which isn't the threat model we actually have.

### Option 2 — Named-pipe IPC

Replace `Start-Process` with a named pipe. Electron main owns
`\\.\pipe\terminal-talk-synth`, ACL'd to the current user. PS hooks
write a JSON request; Python (spawned by main, not by hooks) reads
the pipe.

Pros: no shared secret; pipe ACL is the authority.

Cons:
- Restructures the spawn topology. Main now manages the Python
  child's lifecycle rather than PS hooks; a crash recovery path is
  required.
- PowerShell named-pipe clients work but are awkward
  (`[System.IO.Pipes.NamedPipeClientStream]` — class plumbing, not
  cmdlet-native).
- Defeats the fire-and-forget pattern the hooks are optimised for
  (hooks return immediately so Claude Code's prompt doesn't block
  waiting for TTS).
- ACL restriction still doesn't stop a same-user attacker: any
  process running as the current user can open the pipe.

### Option 3 — Accept the current threat model

Document that same-user local processes are trusted. Add a comment
in `synth_turn.py`'s arg parser acknowledging the trust boundary.

Pros: zero new code, zero new maintenance, matches the app's actual
deployment reality.

Cons: future contributors will re-open the question unless the
decision is durable.

---

## Decision

**Option 3 accepted.** Terminal Talk is a single-user desktop
application. The threat model assumes the user controls every
process running as their own account. Any same-user attacker
scenario ends before reaching this boundary — they would already
have direct access to:

- `~/.terminal-talk/config.json` (voice preferences + at one point
  `openai_api_key`; v0.3 D2 encrypts the key via `safeStorage`
  separately but that's a different property)
- `~/.terminal-talk/session-colours.json` (session labels, PIDs)
- `~/.claude/` (entire Claude Code history, API key, settings)
- The microphone (via `sd.InputStream` or any Win32 audio API)
- The keyboard (via `SendInput` — the same API the wake-word
  listener uses)

A defence that stops attacker-controlled argv while leaving the
microphone and keyboard wide open is defence theatre.

### What *would* change the decision

Three scenarios would re-open this:

1. **Multi-user install**: if Terminal Talk ever supports a
   machine-wide install (`Program Files` + service-account daemon),
   cross-user hook spawning becomes a real concern. Option 2 (named
   pipe with strict ACL) would likely win at that point.
2. **Browser-extension source**: if a browser-extension companion
   ever writes to the transcript directory, and the browser itself
   runs under a sandbox separate from the user's main process, HMAC
   (Option 1) would bound the trust surface.
3. **Packaged as a signed appx / msi with least-privilege execution**:
   same answer as scenario 1 — named pipe with ACL.

None of those are on the current roadmap. D1/D2/D3 are deferred.

### Consequence for the code

`synth_turn.py` carries a top-of-file comment explaining the
boundary. No runtime check is added. If the comment is ever deleted
by a refactor, this document remains the durable record.

---

## Signed off

- 2026-04-20 — Terminal-2 (stream-v3-py-docs), D2-4 of the
  ULTRAPLAN-ADDENDUM v0.3 lane. Discussed with Terminal-1 via
  COORDINATION.md; brief explicitly allowed the deferral option.
