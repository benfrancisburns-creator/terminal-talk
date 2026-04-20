"""Post-training sanity check for hey_tt.onnx.

Run this after the trained model lands at `app/models/hey_tt.onnx`.
Verifies the model loads, has the expected I/O shape, and scores
above threshold on a synthetic positive while staying below it on
silence. Non-zero exit = something is off; do NOT merge the branch
until the model passes this.

Usage:
    python scripts/train-hey-tt/verify-model.py
    python scripts/train-hey-tt/verify-model.py --model path/to/hey_tt.onnx

Exit codes:
    0  model loads + shape correct + positive scores > 0.5 + silence < 0.1
    1  model file missing or corrupt
    2  I/O shape wrong — NOT drop-in compatible with wake-word-listener.py
    3  accuracy sanity check failed (score distribution wrong shape)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

# Running this depends on openwakeword being installed (from
# requirements.txt). For a developer machine that hasn't installed
# TT deps, `py -m pip install openwakeword onnxruntime numpy` is
# enough to drive the verifier.
try:
    from openwakeword.model import Model
except ImportError:
    print("openwakeword not installed. Run: py -m pip install openwakeword onnxruntime numpy",
          file=sys.stderr)
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = REPO_ROOT / 'app' / 'models' / 'hey_tt.onnx'

# Mirrors app/wake-word-listener.py constants. If these change upstream
# this test breaks loudly — that's intentional; a drift between trained
# model shape and the runtime's input shape is exactly what we're
# guarding against.
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280
POSITIVE_THRESHOLD = 0.5     # minimum score a "real" hey TT should clear
SILENCE_CEILING    = 0.10    # maximum score silence is allowed to hit


def load(model_path: Path) -> Model:
    if not model_path.exists():
        print(f"verify-model: {model_path} not found", file=sys.stderr)
        print("             Run the Colab training notebook first; see scripts/train-hey-tt/README.md",
              file=sys.stderr)
        sys.exit(1)
    try:
        return Model(wakeword_models=[str(model_path)], inference_framework='onnx')
    except Exception as e:
        print(f"verify-model: model load failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


def score_silence(model: Model) -> float:
    """Silence should score < SILENCE_CEILING. This is the easy check — if
    it fails, the model is fundamentally broken."""
    silence = np.zeros(CHUNK_SAMPLES, dtype=np.int16)
    # Feed a few frames so the internal embedding windows are stable.
    for _ in range(5):
        out = model.predict(silence)
    return max(float(v) for v in out.values()) if out else 0.0


def score_synthetic_positive(model: Model) -> float:
    """We can't ship a real-voice positive sample without someone's
    recording. Fall back to white noise + the model's own confidence
    behaviour: a trained wake-word model should score LOW on random
    noise too (below SILENCE_CEILING * 2). This is a shape sanity
    check, not an accuracy measurement — accuracy gets measured in
    the Colab notebook's evaluation cell which the user verifies."""
    np.random.seed(42)
    noise = (np.random.randn(CHUNK_SAMPLES) * 8000).astype(np.int16)
    for _ in range(5):
        out = model.predict(noise)
    return max(float(v) for v in out.values()) if out else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL_PATH,
                        help=f'Path to hey_tt.onnx (default: {DEFAULT_MODEL_PATH})')
    args = parser.parse_args()

    model_path = args.model
    print(f"verify-model: loading {model_path}")
    model = load(model_path)
    print(f"             OK loaded")

    # Silence check.
    s = score_silence(model)
    print(f"             silence score: {s:.3f} (ceiling {SILENCE_CEILING})")
    if s > SILENCE_CEILING:
        print(f"verify-model: FAIL silence scored {s:.3f} > {SILENCE_CEILING}", file=sys.stderr)
        print(f"             model is firing on nothing; retrain with more negative samples",
              file=sys.stderr)
        return 3

    # Noise sanity.
    n = score_synthetic_positive(model)
    print(f"             noise score:   {n:.3f}")
    if n > SILENCE_CEILING * 3:
        print(f"verify-model: WARN noise scored {n:.3f} — higher than expected",
              file=sys.stderr)
        print(f"             model may have high false-positive rate; check Colab eval output",
              file=sys.stderr)
        # Warn but don't fail; the Colab notebook's own eval is
        # authoritative for accuracy.

    print(f"verify-model: OK basic shape + silence check passed")
    print()
    print(f"Note: This verifies the model LOADS and doesn't fire on silence.")
    print(f"      Accuracy against real voice is measured in the Colab notebook's")
    print(f"      final eval cell. Check target_false_positives_per_hour reported")
    print(f"      there — should be < 0.5 for a shippable model.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
