<!--
Thanks for the PR. The review goes faster if this template is filled in.
If any section doesn't apply, write "n/a" — better than leaving it blank.
-->

## What

A one-or-two-sentence summary of what this PR does and why.

## How to verify

Steps a reviewer can run locally to confirm the change does what it claims.

```powershell
# Example — replace with whatever is relevant
node scripts/run-tests.cjs
npx playwright test
```

## Checklist

- [ ] Unit tests still pass: `node scripts/run-tests.cjs`
- [ ] Playwright E2E still pass: `npx playwright test`
- [ ] No new `console.log` / `TODO` / `FIXME` without a reason
- [ ] If this changes UI behaviour, screenshots / rendered mocks are updated
- [ ] If this changes hotkeys, `app/index.html` shortcuts table, README, and
      `docs/design-system/mocks-annotated.html` are in sync
- [ ] If this changes security surface (CSP, IPC handlers, spawn calls, file-
      system writes), `SECURITY.md` "Hardening already in place" section is
      up to date
- [ ] CI is green (check the Actions tab before requesting review)

## Related issues

Closes #

<!-- /comment -->
