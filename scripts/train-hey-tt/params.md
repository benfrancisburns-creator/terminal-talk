# openWakeWord `automatic_model_training.ipynb` — parameter reference

The upstream notebook (`dscripka/openWakeWord`,
`notebooks/automatic_model_training.ipynb`) has a dozen+ tunables.
For Terminal Talk v1, only **`target_word`** needs changing. The
rest of this file documents defaults so a reviewer / future-you can
tell which parameters matter if a retrain is needed.

> If you're running the notebook for the first time: only set
> `target_word = "hey TT"` and leave everything else alone. Come
> back to this file only if v1's false-positive rate is too high.

---

## Required change

| Param | Default | Set to | Why |
|---|---|---|---|
| `target_word` | `"alexa"` | `"hey TT"` | The phrase Piper TTS synthesises and the model learns to fire on. Casing + spacing determine Piper's pronunciation — don't swap to `"hey tt"` or `"heytt"`, Piper will say something different. |

That's the v1 change.

---

## Defaults to keep as-is for v1

| Param | Default | Notes |
|---|---|---|
| `n_samples` | 20,000–50,000 (notebook picks) | Synthetic positive utterance count. More = better accuracy + more training time. Leave auto. |
| `n_samples_val` | ~2,000 | Validation set. Leave auto. |
| `false_positive_validation_data` | bundled ambient clips | Negative examples used to measure false-positive rate. Notebook downloads a default set. |
| `steps` | 50,000 | Training steps. 2–3 h on T4. |
| `batch_size` | 128 | Fits in T4 VRAM. |
| `target_false_positives_per_hour` | 0.5 | Model is trained until this rate OR `steps` exceeded. |
| `piper_voice_count` | all available | More voice variety = better generalisation to real speakers. |
| `output_dir` | `/content/drive/MyDrive/openwakeword/hey TT` | Where the trained `.onnx` lands. Notebook uses Google Drive by default so the file survives Colab disconnects. |

---

## If v1 fires too often (false positives)

Retrain with any of:

- `target_false_positives_per_hour`: lower from 0.5 → 0.1. Model
  trains longer against harder negatives.
- `false_positive_validation_data`: add your own clips of things
  that falsely trip v1 (recordings of the ambient speech from the
  logs that fired `hey_jarvis` at 0.79 would be ideal).
- `n_samples`: raise to 50,000+ so the model generalises harder
  to the true phrase and tolerates less pattern-similar noise.

## If v1 misses real utterances (false negatives)

Retrain with:

- `n_samples`: raise to 50,000+ (more voice variety helps).
- `piper_voice_count`: ensure it's using the full 100+ voice set,
  not a reduced sample.
- Post-training, in `app/wake-word-listener.py` lower `THRESHOLD`
  from 0.5 to 0.3. The EMA adaptive gate (S2.3) keeps the effective
  floor reasonable even with a softer static threshold.

---

## What NOT to change

- **Model architecture fields** (`embedding_model`, `classifier`
  etc.) — drop-in compatibility with our runtime depends on these
  matching the stock openWakeWord shape. The exported ONNX must
  feed 1280 int16 samples per frame at 16 kHz. That's fixed.
- **`target_word` language** — Piper supports many languages but
  Terminal Talk's TTS + hook layer assumes English. Keep the
  phrase English for v1.

---

## After training: what the model file looks like

- Filename: `hey_tt.onnx` (notebook derives the filename from
  `target_word`; the slugify step converts the space to underscore,
  so `"hey TT"` becomes `hey_tt.onnx`).
- Size: ~30 MB.
- Input: float32 tensor of shape `[1, 1280]` representing 80 ms
  of audio at 16 kHz, normalised to [-1.0, 1.0].
- Output: scalar score in [0, 1].

All matches the stock `hey_jarvis.onnx` shape — drop-in.
