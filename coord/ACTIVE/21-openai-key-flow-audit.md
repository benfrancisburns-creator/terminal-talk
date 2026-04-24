# ACTIVE #21 — OpenAI key flow systematic audit

- **Status:** audit-done (no BROKEN; 1 narrow race; 1 disk-clutter note)
- **Owner:** TT2
- **Axes in play:** 1 (correctness), 3 (concurrency), 8 (security)
- **Opened:** 2026-04-25T01:15
- **Method:** code inspection across `app/lib/api-key-store.js`, `app/main.js`
  (startOpenaiInvalidWatcher + migrateFromConfig call site), `settings-form.js`
  (UI lifecycle, previously audited in #11).

## Surface

The key flows through 5 paths: user-save, user-clear, 401-auto-unset, hook/synth-read, and
boot-migrate. Survive restarts. Never log the plaintext. Gracefully degrade when safeStorage
is unavailable.

## Invariants verified

- ✓ **I1 — Atomic write order.** `api-key-store.js:47-51` — `.secret` written FIRST, then
  `.enc`. If crash interrupts between, `.secret` has the new key, `.enc` has either old or
  nothing. `.get()` prefers `.enc` when decryptable but falls through to `.secret` on
  decrypt failure (line 68-69). Readers converge on the new key.

- ✓ **I2 — Clear deletes both files.** `api-key-store.js:39-44`. Prevents a stale `.enc`
  from resurrecting a cleared key.

- ✓ **I3 — safeStorage-unavailable path.** `api-key-store.js:53-55` — writes only `.secret`
  and EXPLICITLY deletes `.enc`, so an earlier-boot `.enc` (from when safeStorage was
  available) doesn't linger as a ghost source of truth.

- ✓ **I4 — First-boot plaintext migration.** `api-key-store.js:86-96` — if an old install
  has `openai_api_key` plaintext in `config.json`, migrate to the store + strip from config.
  One-shot at `main.js:142`. Hand-edits added post-boot route through `update-config` IPC
  which calls `apiKeyStore.set()` at line 453 before the merge (the plaintext never hits
  disk via config.json). ✓

- ✓ **I5 — 401 auto-unset polling.** `main.js:1610-1636` — 3-second `fs.existsSync` poll
  on `sessions/openai-invalid.flag`. On hit:
  1. `apiKeyStore.set('')` — clear both files
  2. `CFG.playback.tts_provider = 'edge'` — demote so next synth doesn't re-trigger
  3. Notify renderer via `openai-key-invalid` IPC — settings panel reacts (section expands,
     input row reveals)
  4. `unlinkSync(flagPath)` — consume the flag

- ✓ **I6 — Idempotent failure.** Each step in I5 is wrapped in its own try/catch with
  `diag`. A partial failure (e.g. unlink fails) means the watcher fires again next tick,
  but `set('')` + provider demote are no-ops on already-cleared state. Worst case: log spam
  + redundant renderer IPC every 3s.

- ✓ **I7 — No plaintext in logs.** `redactForLog` at `main.js:1379` includes
  `'openai_api_key'` in its redact list. `update-config IN:` diag line never logs the key.
  `_voice.log` and `_hook.log` don't touch the key either.

- ✓ **I8 — Hook/synth readers get sidecar.** `config.secrets.json` is user-ACL'd by
  `install.ps1` (per D2 follow-up per the module header). PS hooks + synth_turn.py read
  from there without marshalling through safeStorage.

## Findings

### ~ K-1 (narrow race) — 401 auto-unset vs user save

**Window:** ~1-5 ms between `apiKeyStore.set('')` (step 1 of I5) and `unlinkSync(flagPath)`
(step 4). If the user pastes + saves a new key inside that window, sequence is:

1. 401 fires, flag written by synth
2. Watcher tick: detects flag, calls `apiKeyStore.set('')` → key cleared
3. User's save IPC fires, calls `apiKeyStore.set(newKey)` → key written
4. Watcher tick continues: `unlinkSync(flagPath)` → flag consumed

Outcome: user's new key survives; flag is gone. Fine in this ordering.

But reverse order of steps 2 and 3:

1. 401 fires, flag written
2. User's save IPC fires, calls `apiKeyStore.set(newKey)` — key written
3. Watcher tick: detects flag, calls `apiKeyStore.set('')` → USER'S NEW KEY WIPED
4. `unlinkSync(flagPath)`

Outcome: user pastes key → it disappears silently.

**Likelihood:** low. User must save within 3 s of 401 firing, and the tick must fire between
their save and the flag consumption. Observable as "I pasted my key and it vanished" reports
— worth knowing about.

**Fix shape:** reorder watcher to consume the flag FIRST, then clear the key:

```js
// step 1: consume first
try { fs.unlinkSync(flagPath); } catch {}
// step 2: clear key (idempotent if user's save already wrote a new one — but now their
// save came AFTER flag consumption, so the watcher's clear still wipes).
```

Actually re-ordering doesn't fully close the race — a concurrent save/clear is fundamentally
a race. The better fix: check the `_hook.log` sees the 401 entry with a newer timestamp than
the user's last save-api-key diag line, and skip the clear otherwise. Complex. Narrow-window
race, low severity — accept as known risk + document, or implement the fix. Flag for Ben's
call.

### ~ K-2 (disk-clutter) — stale `.enc` after safeStorage becomes unavailable

If `.enc` was written on a boot where safeStorage worked, then next boot has safeStorage
unavailable (keychain unlocked, driver restart, OS update), `.get()` falls back to
`.secret`. The stale `.enc` sits unused. Next `set()` call (user save/clear) cleans it up
(line 54). If the user never calls `set()` again, `.enc` lingers indefinitely.

**Severity:** low — ~200 bytes, not a security issue (decryption still requires the original
keyring session).

**Fix shape (optional):** on every `.get()` that falls through to `.secret`, opportunistically
delete the stale `.enc`. 1-line change. Or, on every `_available()` call that returns false,
sweep `.enc` once per boot. Non-urgent.

## Regression test suggestions

- Test the 3-step atomicity of I5: write a fake `openai-invalid.flag`, run the watcher once,
  assert all 3 of (key cleared, provider demoted, renderer notified) happened + flag was
  consumed.
- Test K-1 race: simulate `set(newKey)` interleaved with watcher's `set('')`; assert the
  user-save semantics wins (either via the reorder-fix above, or document the loss).
- Test I3 + K-2: after a mocked safeStorage-flips-false boot, assert `.enc` is removed on
  next set OR on first get fall-through.

## Close-out

- [x] All 5 flow paths traced
- [x] 8 invariants verified (I1-I8)
- [x] 2 minor findings (K-1 narrow race, K-2 disk-clutter)
- [x] No BROKEN findings
- [ ] Decide on K-1 fix: accept as known risk vs apply flag-consume-first reorder
- [ ] Decide on K-2 cleanup: accept as-is vs opportunistic delete
