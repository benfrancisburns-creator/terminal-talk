# Knip findings — baseline + triage + fix

**Scanned:** 2026-04-20 (after S2 ESLint completed)
**Tool:** Knip 6.5 (JS/TS unused file + export + dependency detector)
**Config:** `knip.json` at repo root

## Initial baseline

**2 unlisted dependencies + 5 unused exports + 21 configuration hints.**

### Unlisted dependencies (2)

- `electron` in `app/main.js:1` and `app/preload.js:1` — Knip found `require('electron')` but didn't see electron in root `package.json`'s deps. Correct — it's declared in `app/package.json` (the Electron child manifest), which Knip doesn't cross-walk by default. **Fix:** added `electron` to `knip.json::ignoreDependencies`.

### Unused exports (5)

All five are constants re-exported next to factory functions but never imported by callers. The constants ARE used internally as defaults; just nobody imports them as part of a public API. Safe to stop re-exporting:

| Export | File | Why unused |
|---|---|---|
| `DEFAULT_RATE` | `app/lib/rate-limit.js:40` | Only used as default arg to `createRateLimit({ rate = DEFAULT_RATE })`. Internal. |
| `DEFAULT_BURST` | `app/lib/rate-limit.js:40` | Same pattern. |
| `RENDERER_ERROR_DEDUPE_MS` | `app/lib/renderer-error-dedupe.js:35` | Default for `createDedupe({ windowMs = RENDERER_ERROR_DEDUPE_MS })`. Internal. |
| `MAX_ENTRIES` | `app/lib/renderer-error-dedupe.js:35` | Same pattern. |
| `DEFAULTS` | `app/lib/text.js:108` | Used internally as `{ ...DEFAULTS, ...(includes || {}) }` in `stripForTTS`. Nobody else touches it (main.js has its own separate `DEFAULTS` for the whole config shape). |

**Fix:** dropped all 5 from their respective `module.exports` — consts remain file-local. Zero runtime impact (no caller imported them).

### Configuration hints (21)

Knip warned my initial `knip.json` had over-broad `ignore` patterns (`node_modules/**`, `.scannerwork/**`, `coverage/**`, etc.) that Knip already excludes by default. Also redundant `entry` patterns for paths Knip auto-detects (scripts referenced from `package.json::scripts`, `playwright.config.ts`, `eslint.config.js`). Tightened the config; down to 0 hints.

## Final state

`npm run knip` → exit 0, zero findings. CI wired as blocking job in `.github/workflows/test.yml` under `jobs.knip`.

## What Knip caught that ESLint + Sonar didn't

Cross-module unused exports. ESLint's `no-unused-vars` only scans within a file; if a module `module.exports` something and no other file imports it, ESLint stays quiet. Knip walks the import graph and knows. Caught 5 such orphans in the `app/lib/` modules.

ESLint's big win (stream S2) was catching the dead-code cascade within `app/renderer.js` (7 functions chained). Knip would've found those too if they'd had `module.exports` — they didn't, so they were ESLint's to flag.

Complementary tools. Both worth running.

## What Knip didn't find that maybe should have

Zero unused files. That's mildly surprising given the codebase age; means the extract-to-`lib/` pattern from the audit passes kept things tight. No abandoned helper modules.

Zero unused devDependencies. `c8`, `@playwright/test`, `eslint`, `knip`, `globals` all actively used.
