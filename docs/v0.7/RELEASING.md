# Cutting a release

Tag-driven, automated. Pushing a `v*` tag triggers
[`.github/workflows/build-release.yml`](../.github/workflows/build-release.yml)
which builds the Mac DMGs, Windows installers, and attaches everything
to a GitHub Release with auto-generated notes.

## Steps

1. **Land all release-bound work on `main`** with all CI gates green.
   Don't tag a branch that has open PRs against it.

2. **Bump version numbers** in:
   - `package.json` (repo root) — top-level `"version"`
   - `app/package.json` — top-level `"version"` (this is what
     electron-builder reads to stamp the DMG / Setup.exe filenames)
   - `CHANGELOG.md` — convert `## [Unreleased]` into
     `## [X.Y.Z] — YYYY-MM-DD` and add a fresh `## [Unreleased]`
     stub above it.

3. **Commit the bump** with a message like:
   ```
   chore(release): v0.7.0
   ```

4. **Tag + push**:
   ```sh
   git tag v0.7.0
   git push origin main --tags
   ```

5. **Watch the workflow** at
   <https://github.com/benfrancisburns-creator/terminal-talk/actions>.
   Two jobs run in parallel (`build-macos` ~10 min, `build-windows`
   ~5 min); a third (`create-release`) gathers their artefacts and
   creates the Release. Total wall clock is the longest of the
   build jobs plus ~30 s.

6. **Verify the release** at
   <https://github.com/benfrancisburns-creator/terminal-talk/releases>.
   You should see:
   - `Terminal Talk-0.7.0-arm64.dmg` (~ 200 MB)
   - `Terminal Talk-0.7.0-x64.dmg` (~ 200 MB)
   - `Terminal Talk-0.7.0-arm64.zip`
   - `Terminal Talk-0.7.0-x64.zip`
   - `Terminal Talk-Setup-0.7.0.exe` (~ 100 MB)
   - `Terminal Talk-Portable-0.7.0.exe`

   Plus auto-generated release notes containing the merged commits
   since the previous tag.

## Pre-releases

Tags matching `v*-rc*`, `v*-beta*`, `v*-alpha*`, or `v*-dev*` are
automatically marked as pre-releases on GitHub. Use these for
release candidates so dot-releases don't accidentally surface
unstable artefacts as "latest":

```sh
git tag v0.7.0-rc1
git push origin main --tags
```

## Dry-running the build pipeline

Cut artefacts without creating a Release:

1. Open <https://github.com/benfrancisburns-creator/terminal-talk/actions/workflows/build-release.yml>
2. Click **Run workflow**, leave the synthetic tag alone (`v0.0.0-dryrun`).
3. The two build jobs run end-to-end; the `create-release` job is
   skipped (its `if: github.event_name == 'push'` filter holds).
4. Artefacts download from the run's **Artefacts** sidebar — useful
   for verifying a build before tagging.

## After cutting

- Check the docs archive job (`release.yml`) committed a
  `docs/vX.Y/` snapshot back to `main`. This is automatic and
  shouldn't need intervention.
- If you maintain the Homebrew tap, bump
  [`Formula/terminal-talk.rb`](https://github.com/benfrancisburns-creator/homebrew-tap/blob/main/Formula/terminal-talk.rb)
  to point at the new tag. (Phase 9 of the v0.7 plan.)
- Announce in the relevant channel(s) — typically a tweet / blog
  post / Slack ping with the headline features.

## Troubleshooting

**A job failed mid-build** — usually a transient pip / npm flake.
Re-run from failure via the **Re-run failed jobs** button. The
download-artefacts step in `create-release` requires both build
jobs to have succeeded once for the same workflow run, so a
re-run-failed-jobs is preferable to re-running everything.

**The tag exists but the workflow didn't fire** — confirm the tag
push reached origin (`git ls-remote --tags origin v0.7.0`). If
the workflow YAML was edited in the same commit that introduced
it, push the YAML to `main` first, *then* tag.

**Want to delete a botched release** — delete the GitHub Release
via the web UI, then `git push origin :v0.7.0` to delete the
remote tag. Re-tagging from the same commit will re-trigger the
workflow.
