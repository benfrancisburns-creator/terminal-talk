# ESLint findings — baseline + triage + fix

**Scanned:** 2026-04-20
**Tool:** ESLint 9.39 (flat config, `eslint.config.js`)
**Scope:** `app/**/*.js`, `scripts/**/*.{js,cjs}`, `docs/ui-kit/**/*.js`, `eslint.config.js`
**Rules:** `@eslint/js` recommended + custom (see `eslint.config.js`)

## Initial baseline

**95 problems total** (89 errors, 6 warnings)

| Rule | Count | Kind | Fix |
|---|---|---|---|
| `no-empty` | 70 | error | Rule-tuning (`allowEmptyCatch: true`) — all 70 were `catch {}` which is idiomatic for best-effort FS swallows |
| `no-unused-vars` | 18 | error | Hand-fix (delete dead code / rename to `_prefix`) |
| `no-control-regex` | 1 | error | `// eslint-disable-next-line` with cross-reference to sentinel write |
| `prefer-const` | 6 | warning | Auto-fix (`eslint --fix`) |

## Actions taken

### Rule tuning (-70 findings)

`no-empty` → `["error", { allowEmptyCatch: true }]` in `eslint.config.js`. Every empty block in the codebase was an intentional `try { best-effort-fs-op } catch {}` pattern — deleting a file that may not exist, reading a registry that may not parse, etc. Marking these as errors would be noise, not signal. Empty `if`/`while`/`for` bodies are still flagged (those are usually real bugs).

### Auto-fix (-6 warnings)

`npm run lint:fix` converted 6 `let` → `const`:
- `app/main.js:430` savedDock, `:846` liveSessions
- `app/renderer.js:231` priorityQueue
- `scripts/run-tests.cjs:2253, 2271` both `t`
- `scripts/sync-app-mirror.cjs:41` drift

### Dead code deleted (-cascade)

The initial 18 `no-unused-vars` cascaded as delete chains — removing one dead function exposed its helpers as dead too:

1. `app/renderer.js::backgroundForArrangement` — 10-line function with no callers. Deleted.
2. `app/renderer.js::dotColour` — 4-line helper, only called by... nothing. Deleted.
3. `app/renderer.js::renderDotsNow` — 1-line wrapper whose comment claimed "exposed for Playwright" but zero tests/files actually invoked it. Deleted (the private `_renderDotsNow` stays — it's what `renderDots` schedules).
4. `app/renderer.js::sessionColourFromShort` — only called by the now-deleted `dotColour`. Deleted.
5. `app/renderer.js::primaryColourForArrangement` — only called by now-deleted `sessionColourFromShort`. Deleted.
6. `app/renderer.js::arrangementForShort` — only called by now-deleted `sessionColourFromShort`. Deleted.
7. `app/renderer.js::arrangementForIndex` — only called by now-deleted `arrangementForShort`. Deleted.
8. `app/renderer.js::NEUTRAL_COLOUR` + `BASE_COLOURS` destructure entries — only needed by the now-deleted functions. Removed from destructure.
9. `scripts/run-tests.cjs::COLOUR_NAMES, NEUTRAL_COLOUR` — destructured but never referenced. Removed.
10. `scripts/run-tests.cjs::spawn` — imported but unused (only `spawnSync` is). Removed.
11. `scripts/generate-tokens-css.cjs::HSPLIT_PARTNER, VSPLIT_PARTNER` — destructured locals, unused. Removed.
12. `docs/ui-kit/mock-ipc.js::hexShort` — defined but never called. Deleted.
13. `app/main.js::findDockedEdge(dX, dY)` — args unused, one call site passed them, another didn't. Dropped the args entirely; updated the single caller.
14. `app/main.js::findDockedEdge` destructure — dropped `dispX, dispW, x` from the screen workArea destructure.

### Unused-arg renaming

2 unused arguments kept for callback-signature compatibility, prefixed `_`:
- `app/renderer.js::scheduleAutoDelete(_wasManual)` — caller passes the heard-flag but the function no longer distinguishes manual from auto for delete delay (unified in an earlier release).
- `app/renderer.js::armStallRecovery(_reason)` — caller passes "stalled"/"waiting" label but function doesn't currently log it.

### 1 no-control-regex disable

`app/lib/text.js:101` regex uses `\u0000` null bytes as sentinels for preserved code-block placeholders (paired with write at line 45). Not a bug — deliberate design to guarantee no real markdown content collides with the placeholder. Added `// eslint-disable-next-line no-control-regex -- paired with sentinel write at line 45` directly above the line (already had NOSONAR comment for Sonar).

### 1 destructure cleanup in loop

`app/renderer.js::for (const [p, t] of deleteTimers)` → `for (const [, t] of deleteTimers)` — we don't use the path key, only the timer value.

## Final state

**0 errors, 0 warnings.** `npm run lint` passes with `--max-warnings=0`. CI wired as a blocking job in `.github/workflows/test.yml` under `jobs.lint`.

## What this surfaced that Sonar didn't

Sonar's "code smells" are all MINOR-grade modernization nudges (prefer optional chaining, etc.). ESLint caught **7 genuinely dead functions in `app/renderer.js`** plus several dead destructure imports across tests + scripts — that's real line-count reduction that SonarQube's default rule set didn't flag. File shrank by ~40 lines of clearly-dead code across the two big files.

Knip (S1) would find a fourth category — unused files + unused exports crossing module boundaries. That's the next lane.
