# `app/models/`

Wake-word ONNX models bundled with Terminal Talk.

## `hey_tt.onnx`

Custom-trained openWakeWord model for the phrase "hey TT". See
`docs/architecture/wake-word-training.md` for the full decision and
`scripts/train-hey-tt/README.md` for the training pipeline.

**Status on `feat/hey-tt` branch:** directory exists but `.onnx`
file not yet committed. The branch is pre-staged to switch to
`hey_tt` as soon as the file lands. The training Colab run
produces it; drop the file here as `hey_tt.onnx` when training
completes.

**Size:** ~30 MB.
**Input:** float32 `[1, 1280]` at 16 kHz, normalised [-1.0, 1.0].
**Output:** scalar score in [0, 1].

## Why this directory exists

openWakeWord's stock models (`hey_jarvis`, `alexa`, `hey_mycroft`,
`hey_rhasspy`, `timer`, `weather`) auto-download from HuggingFace
via `openwakeword.model.Model(wakeword_models=['hey_jarvis'])`.
Custom models aren't on HuggingFace, so we bundle the file in the
repo and `install.ps1` copies it into the live install dir on
first install.
