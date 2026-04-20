# Custom wake word: `hey_tt` (training-based)

**Status:** accepted 2026-04-20. Pre-staged on branch `feat/hey-tt`.
Blocked on a 2–4 h Colab training run before the branch can merge.

**Audit source:** user request after diagnosing the
Ctrl+C-interrupting-Claude-Code false-positive problem (see Evidence
section below). Training a custom, less-common phrase reduces
false-positive rate; keeping `hey_jarvis` — a model trained on a
broad voice corpus — is the cheaper path but ships with a known
misfire profile on everyday ambient speech.

---

## The question

Should Terminal Talk's wake phrase be **"hey jarvis"** (pre-trained
openWakeWord model, ships today) or **"hey TT"** (custom-trained,
brand-aligned, no public model exists)?

---

## Evidence that triggered the change

On a real install (2026-04-20 local time 22:43:15), the shipped
`hey_jarvis` model fired at score 0.79 on ambient background speech.
The user wasn't addressing the toolbar. The resulting chain:

```
wake fire -> Ctrl+Shift+S global shortcut
         -> speakClipboard()
         -> captureSelection() sends Ctrl+C via SendInput
         -> Ctrl+C reaches the foreground window
         -> if foreground is Claude Code CLI: SIGINT, mid-response killed
```

Three such misfires appear in `_voice.log` + `_toolbar.log` inside a
90-minute window. This isn't a theoretical problem; it was
observed and reproduced.

S2.3's EMA adaptive gate (shipped in `4db1059`) raises the bar
above a dynamic noise floor and blocks the simplest false-positive
class. But the root cause is upstream: `hey_jarvis` generalises
aggressively because its training corpus was broad. A custom word
trained against a narrower target is naturally less trigger-happy.

---

## Options considered

### Option 1 — Keep `hey_jarvis`, mitigate with threshold tuning

Raise `THRESHOLD` from 0.5 to 0.85 or 0.9. Every score below the
new floor is rejected. Pros: zero training. Cons: real `hey jarvis`
utterances score 0.85–0.97 in the observed log; a 0.9 threshold
would reject ~60 % of genuine fires. Bad UX trade.

Rejected.

### Option 2 — Swap to another openWakeWord stock model

Stock options: `hey_mycroft`, `hey_rhasspy`, `alexa`, `timer`,
`weather`. None are on-brand. `alexa` specifically is actively
harmful: collides with every nearby Echo device.

Rejected.

### Option 3 — Commercial wake-word SDK (Picovoice Porcupine)

Porcupine trains custom words via a web console and ships a
drop-in runtime. Accuracy is excellent. Licensing: enterprise-first
since 2024 (verified in `project_audio_toolbar.md:56-57`). Adds a
hard dependency on a paid service for a Terminal Talk user.

Rejected.

### Option 4 — Train a custom `hey_tt` model via openWakeWord's pipeline

**Accepted.**

openWakeWord ships a training Colab notebook that takes a target
phrase and produces an ONNX model drop-in-compatible with the
existing runtime. Pipeline:

1. **Piper TTS** (free, local, MIT) generates ~20–50 k synthetic
   utterances of "hey TT" using ~100 different voice characters —
   different pitches, speeds, accents, emotional registers. The
   model never sees your voice specifically; it learns the
   phonetic pattern and generalises at inference time.
2. **Negative samples** are mixed in from free speech corpora
   (Common Voice, MUSAN, ACAV100M snippets). Purpose: the model
   must learn what "hey TT" *isn't*, not just what it is.
3. **Training** runs on Google Colab's free T4 GPU. End-to-end
   2–4 hours: ~1 h data synthesis, 2–3 h training, 30 min eval.
4. **Output**: a ~30 MB `.onnx` file. Drop-in replacement for
   `hey_jarvis.onnx` — no runtime code changes needed beyond
   pointing `WAKE_WORDS` at the new model name.

**Cost: £0.** Everything is free-tier. (Optional £10/mo Colab Pro
lets you close the browser tab during training; free tier needs
the tab open.)

**Training reproducibility:** the Colab notebook pins versions and
takes `target_word = "hey TT"` as a one-line parameter. Retraining
with tweaked hyperparameters is a one-click operation.

---

## Why this is the right moment

- The false-positive problem is real and user-observed (not a
  hypothetical from an audit).
- Terminal Talk's brand phrase was already "HEY TT" on the
  wallpaper (pre-R3.7); renaming the runtime aligns the product
  with what the marketing assets always promised.
- `hey_jarvis`'s false-positive tax is paid EVERY DAY the product
  ships. A one-time 4 h training run amortises immediately.
- v0.3 is still in flight; landing the training scaffold now lets
  the `.onnx` drop in as a clean commit later without further
  architectural work.

---

## Deployment & migration

**Shipping shape:**
- The trained `hey_tt.onnx` lives at `app/models/hey_tt.onnx` in
  the repo. Not via HuggingFace auto-download — custom models
  aren't on HF. Model file size (~30 MB) is acceptable as a
  committed binary; if it grows beyond that we reconsider Git LFS.
- `install.ps1` copies the file to `~/.terminal-talk/app/models/`.
  The existing HuggingFace pre-download step is removed — we no
  longer need it.
- `app/wake-word-listener.py` → `WAKE_WORDS = ['hey_tt']` and
  points at the bundled local path.

**Upgrade path for existing users:**
- v0.3.x users with `hey_jarvis` in their live install keep
  working until they re-run `install.ps1`. No silent breakage.
- After reinstall, the listener starts responding to "hey TT"
  instead of "hey jarvis". A CHANGELOG entry flags this clearly
  as a breaking wake-phrase change (technically NOT a breaking
  API change — nothing scripted references the phrase).

**Rollback plan:**
- If the first-trained model's false-positive rate turns out
  WORSE than `hey_jarvis`'s (unlikely but possible), the same
  Colab notebook retrains with a higher negative-sample count.
- If training fails entirely, the commit that flips
  `WAKE_WORDS` is revert-safe and main continues shipping
  `hey_jarvis`.

---

## Files pre-staged on `feat/hey-tt`

(Landed in the commits introducing this ADR; listed so a reviewer
can verify the branch's scope without reading every diff.)

- `docs/architecture/wake-word-training.md` — this file.
- `scripts/train-hey-tt/README.md` — click-through for the Colab run.
- `scripts/train-hey-tt/params.md` — exact openWakeWord training params.
- `scripts/train-hey-tt/verify-model.py` — local sanity test the trained ONNX against 3 known utterances.
- `scripts/train-hey-tt/install-model.ps1` — drops the `.onnx` into the repo + the live install.
- `app/wake-word-listener.py` — `WAKE_WORDS = ['hey_tt']`, bundled-path loader.
- `install.ps1` — ship bundled ONNX instead of HuggingFace pre-download.
- `scripts/wallpaper.html` — speech bubble back to `HEY TT`.
- `README.md`, `CHANGELOG.md`, `docs/LAUNCH.md`, `docs/index.html` — "hey jarvis" → "hey TT".
- `scripts/check-doc-drift.cjs:38` — sentinel flipped: now flags `HEY JARVIS` as stale.
- `docs/v0.2/` — deliberately untouched. That archive shipped with `hey_jarvis`, correctly.

The branch is a clean revert target if training never finishes.

---

## Signed off

- 2026-04-20 — Terminal-2 (branch `feat/hey-tt`). Discussed with
  the user after a diagnosed Ctrl+C interrupt incident. Training
  kit committed; execution (the Colab run itself) deferred to the
  user because it requires their Google account.
