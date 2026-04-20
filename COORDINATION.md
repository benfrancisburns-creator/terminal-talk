# Terminal Talk — Multi-Terminal Coordination

**Owner of this doc:** whichever terminal is editing it. Update the "Last edited by" line below before pushing.

**Last edited by:** Terminal-1 (Opus 4.7, 1M ctx) — 2026-04-20
**Pinned baseline commit:** `3cc143e` (`feat(R4): accessibility baseline`)

---

## Why this file exists

Two Claude Code terminals are working on this repo in parallel. This file is the single source of truth for **who owns what stream, where the work lives, and how we avoid stepping on each other**. Read it after every `git pull`. Update it when you claim or release a stream.

---

## Where we are vs ULTRAPLAN

`Claude Assesments/ULTRAPLAN.md` defined the work. Status as of `3cc143e`:

| ULTRAPLAN scope | Status | Evidence |
|---|---|---|
| Tier A (A1–A11, ~2.5h) | ✅ shipped | commits `8a95881`, `2109041`, `3904c8c`, `ac7d853`, `545ae54`, `8c98f67` |
| Stream R4 — accessibility | ✅ shipped | `3cc143e` |
| Stream R5 — runtime robustness | ✅ shipped | `8ad3ece`, `5213d10`, `14232f9`, `8da7b6b` |
| Stream R6 — responsiveness | ✅ shipped | `0ee7a1f`, `89d1abb`, `bde9355` |
| Stream R1 — design tokens | 🟡 partial (A10 only) | `ac7d853` wrote `docs/colors_and_type.css`. Still missing: `app/lib/tokens.json`, `scripts/generate-tokens-css.cjs`, renderer.js refactor, kit refactor, R1.7 parity test |
| Stream R2 — kit realignment | ❌ not started | depends on R1.5 |
| Stream R3 — doc-reality sync | ❌ not started | 10 items + CI grep guard |
| Tier C — polish (Z1–Z11) | ❌ not started | 11 items |
| D1/D2/D3 — deferred | out of scope | separate sessions per ULTRAPLAN |

---

## Stream ownership table

| Stream | Branch | Worktree path | Owner | Status |
|---|---|---|---|---|
| R1 — finish tokens single-source | `stream-r1-tokens` | main repo (`C:/Users/Ben/Desktop/terminal-talk`) | **Terminal-1** | claiming now |
| R2 — kit realignment | `stream-r2-kit` | `../terminal-talk-r2/` | unassigned (waits on R1 merge) | blocked |
| R3 — doc-reality sync | `stream-r3-docsync` | `../terminal-talk-r3/` | **available — Terminal-2 please claim** | unassigned |
| Tier C — polish | `stream-c-polish` | `../terminal-talk-c/` | **available — Terminal-2 please claim** | unassigned |

Terminal-2: pick **R3** if you want low-risk doc work (~2h, 100% markdown/HTML edits). Pick **Tier C** if you want surgical code polish (~2h, 11 small fixes across config/scripts/main.js/renderer.js).

---

## File-scope per stream (the no-step-on-each-other contract)

**Stream R1 (Terminal-1) touches and ONLY touches:**
- `app/lib/tokens.json` (new)
- `scripts/generate-tokens-css.cjs` (new)
- `app/renderer.js` — only the `BASE_COLOURS` / `HSPLIT_PARTNER` / `VSPLIT_PARTNER` block (lines ~166–183)
- `app/styles.css` — only the `@import` line at top + opportunistic `var(--tt-*)` substitution where literal hex appears
- `docs/ui-kit/palette.js` — full replacement to import from tokens
- `docs/colors_and_type.css` — regenerate from tokens
- `scripts/run-tests.cjs` — append one new `describe('PALETTE PARITY — kit ↔ product', ...)` block

**Stream R3 touches and ONLY touches:**
- `docs/design-system/architecture.html` (R3.1)
- `docs/design-system/mocks-annotated.html` lines 1030–1051 (R3.2)
- `CHANGELOG.md` (R3.3)
- `docs/DESIGN-AUDIT.md` (R3.4)
- `docs/index.html` (R3.5, R3.6) — pick yellow OR cyan, apply consistently
- `scripts/wallpaper.html` (R3.5, R3.7)
- `docs/README.md` (R3.7, R3.9)
- `screenshots/toolbar-idle.png` — regenerate via `node scripts/render-mocks.cjs` after Z2 lands (R3.8)
- `.github/workflows/test.yml` — append doc-count grep guard step (R3.10)

**Tier C touches and ONLY touches:**
- `config.example.json` (Z1)
- `scripts/render-mocks.cjs` (Z2)
- `app/wake-word-listener.py` (Z3)
- `app/main.js` — clipboardBusy timeout (Z4), clipboard restore (Z5), helperRequest orphan timers (Z7), MAX_FILES doc/bump (Z9)
- `hooks/speak-response.ps1` — clipboard restore guard (Z5)
- `app/renderer.js` — stalled/waiting handlers (Z6), devicechange listener (Z8), dropdown-rebuild fix (Z11)
- `app/preload.js` — devicechange wiring (Z8)
- `docs/ui-kit/index.html` — load-order comment (Z10)

**Conflict zones to watch:**
- R1 and Tier C both touch `app/renderer.js`. R1 only touches the palette constants block (~lines 166–183). Tier C only touches event handlers and dropdown rebuild logic. **No line overlap if both stay in scope** — but pull and resolve at commit time.
- R3 (R3.8 regenerate `toolbar-idle.png`) **depends on Tier C Z2** (Chrome path fallback in `render-mocks.cjs`). R3 should land Z2 first or wait for Tier C to ship Z2.
- R2 cannot start until R1's `app/lib/tokens.json` exists on `main`.

---

## Workflow

**For each terminal, every session:**

```bash
# 1. Pull main first — ALWAYS
cd C:/Users/Ben/Desktop/terminal-talk
git fetch --all
git checkout main
git pull --ff-only

# 2. Re-read this file
cat COORDINATION.md

# 3. Claim or resume your stream — edit the table above, commit COORDINATION.md, push
git add COORDINATION.md
git commit -m "coord: claim stream-rX (Terminal-N)"
git push

# 4. Set up your worktree (skip if already done)
git worktree add ../terminal-talk-rX -b stream-rX-name
cd ../terminal-talk-rX

# 5. Work in tight commits, run tests after each
node scripts/run-tests.cjs --logic-only --verbose

# 6. Push your branch as you go (so the other terminal can see progress)
git push -u origin stream-rX-name

# 7. When stream is done: open PR or fast-forward main yourself
#    (For solo-repo with two assistants, fast-forward is fine if tests are green.)
git checkout main
git pull --ff-only
git merge --no-ff stream-rX-name -m "merge: stream-rX complete"
git push

# 8. Update COORDINATION.md to mark stream done, commit, push.
```

**Stop-on-conflict protocol:**
If `git pull` produces a merge conflict in a file you don't own per the scope table above:
1. **Don't auto-resolve.** Stop.
2. Update COORDINATION.md with a `### Blocked` section naming the conflicting files and the other terminal's commit hash.
3. Commit + push COORDINATION.md.
4. Wait for the other terminal to coordinate, OR human (Ben) to arbitrate.

---

## Merge order (when ready to land)

1. **R1** lands first (creates `tokens.json`, unblocks R2)
2. **R3** and **Tier C** land in any order (independent of each other and of R1/R2)
3. **R2** lands last (depends on R1's tokens.json being on main)

---

## Tests required before merge

For every stream, on the stream's worktree before pushing:

```bash
node scripts/run-tests.cjs --logic-only --verbose
```

Stream-specific extras:
- **R1**: must add new test `PALETTE PARITY — kit ↔ product` and it must pass (R1.7).
- **R2**: kit must render at `docs/ui-kit/index.html` in a browser without console errors. No automated check yet.
- **R3**: CI grep-guard step must succeed (CI workflow change is part of the stream).
- **Tier C**: Z6 audio handlers should be smoke-tested by playing one clip through Electron.

E2E (`npm run test:e2e`) is Windows-host only. Run on this machine before merging R1 or R2 since they touch product code.

---

## Out of scope for this push

- D1 — Electron 32 → 41 upgrade (separate session per ULTRAPLAN)
- D2 — `safeStorage` for `openai_api_key` (needs design review)
- D3 — Pixel-diff palette regression rig (v0.3 infra)

---

## Communication log

> Append entries here so we both have shared context across sessions. Use `## YYYY-MM-DD HH:MM Terminal-N` headers. Keep entries short.

### 2026-04-20 Terminal-1
- Pulled to `3cc143e`. Read all six assessment docs. Built this coordination plan.
- **Claimed Stream R1.** Will start with `app/lib/tokens.json` extraction from `app/renderer.js:166-183`, then write the generator, then refactor renderer.js to require it.
- Stream R2 reserved for me too once R1 lands.
- Terminal-2: please pick R3 or Tier C and update the ownership table above on your next push.
