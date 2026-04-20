# Training `hey_tt.onnx`

A 4-step click-through that produces a custom openWakeWord model for
the phrase **"hey TT"**. Output replaces `hey_jarvis` as Terminal
Talk's shipping wake phrase.

**Time budget**: ~2–4 hours wall-clock on Google Colab free tier.
**Cost**: £0 (free Colab T4 GPU).
**Your active time**: ~5 minutes, spread across a few hours.

> If you can't keep a browser tab open for 2–4 hours: £10 for one
> month of Colab Pro removes the tab-open requirement. One month
> covers training + any retrain if the first model's accuracy needs
> tweaking.

---

## Step 1 — open the official openWakeWord training notebook in Colab

<https://colab.research.google.com/github/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb>

The notebook lives in openWakeWord's official repo
(`dscripka/openWakeWord`, Apache-2.0) — this kit does not fork or
modify it. We just parameterise it and hand-assemble the output.

## Step 2 — set the target phrase

Early in the notebook there's a `target_word` parameter. Set it to:

```python
target_word = "hey TT"
```

That's the phrase Piper TTS synthesises thousands of times across
~100 voice characters. Case + spacing matter — Piper's pronunciation
depends on them. `"hey TT"` (lowercase `hey`, uppercase `TT`) is the
shipping phrase.

See `params.md` in this directory for the full parameter reference
if you want to adjust other defaults (don't need to for v1).

## Step 3 — Runtime → Run all

Colab menu: **Runtime → Run all**.

Expect:
1. First cell asks to mount Google Drive. Allow it — the trained
   model writes to Drive.
2. Roughly an hour generating ~20–50k Piper TTS synthetic
   utterances of "hey TT".
3. Roughly 2–3 hours training on the T4 GPU.
4. ~30 minutes evaluation + export to ONNX.

Free-tier Colab idle-timeout is ~90 min with the tab unfocused. If
you want to close the browser, upgrade to Colab Pro.

## Step 4 — download the `.onnx` + place it

Final cell of the notebook shows a download button for the trained
`hey_tt.onnx`. File should be ~30 MB.

Drop it at:

```
C:\Users\Ben\Desktop\terminal-talk-repo\app\models\hey_tt.onnx
```

(Or wherever this repo lives on your machine; the path is
`app/models/hey_tt.onnx` relative to the repo root.)

Tell me (Claude, next session) that the file is in place. I'll run
the verification and flip-the-switch commits.

---

## What happens after the model lands

These scripts run automatically once I have the `.onnx`:

### `verify-model.py`

Loads the freshly-trained model and runs a sanity pass:
- Confirms it's a valid ONNX file openWakeWord can load.
- Confirms the input tensor shape matches what
  `wake-word-listener.py` feeds (1280 int16 samples per frame).
- Reports the model's baseline false-positive rate against a short
  fixture of ambient-noise clips (shipped inside the kit).

If any check fails we retrain with bumped negative-sample count
instead of shipping a bad model.

### `install-model.ps1`

- Copies `app/models/hey_tt.onnx` into `~/.terminal-talk/app/models/`
  on the live install.
- Nothing more — the rest of the switch is already pre-staged on
  the `feat/hey-tt` branch and gets merged in the same PR.

### What's already pre-staged on `feat/hey-tt`

So the merge is atomic with the model landing:

- `app/wake-word-listener.py` — `WAKE_WORDS = ['hey_tt']`, loads
  from the bundled local path.
- `install.ps1` — copies the bundled ONNX instead of pre-downloading
  `hey_jarvis` from HuggingFace.
- `scripts/wallpaper.html` — speech bubble regenerated as `HEY TT`.
- `README.md`, `CHANGELOG.md`, `docs/LAUNCH.md`, `docs/index.html`
  — every "hey jarvis" / "Hey Jarvis" → "hey TT" / "Hey TT".
- `scripts/check-doc-drift.cjs:38` — sentinel flipped. Now flags
  `HEY JARVIS` as stale on any new doc.
- `docs/v0.2/` — deliberately untouched; that archive shipped with
  `hey_jarvis` and should keep saying so.

---

## If training fails entirely

The `feat/hey-tt` branch is a clean revert target. `main` keeps
shipping `hey_jarvis` unchanged until we succeed.

See `docs/architecture/wake-word-training.md` for the full decision
trail and rollback plan.
