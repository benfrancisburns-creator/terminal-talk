"""openWakeWord listener for Terminal Talk.

Listens for 'hey jarvis' and sends Ctrl+Shift+S to trigger speakClipboard()
in the Electron toolbar. Uses ctypes (no subprocess) for instant keystroke delivery.

S2.3: firing is now gated by an adaptive noise floor (exponential moving
average of recent scores) rather than the raw THRESHOLD alone. In a noisy
room the effective gate rises; in a quiet room it stays near the static
floor. Also exposes `--selftest` so CI / an install-sanity check can load
the model, open the stream for 3 s and exit without having to say the wake
word out loud on a headless box.
"""
import argparse
import ctypes
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

LOG_PATH = Path.home() / '.terminal-talk' / 'queue' / '_voice.log'
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

STATE_FILE = Path.home() / '.terminal-talk' / 'listening.state'

def is_listening_on():
    """Returns True if the user has the mic toggle enabled.
    Defaults to True if the state file is missing (first run)."""
    try:
        return STATE_FILE.read_text(encoding='utf-8').strip() != 'off'
    except (FileNotFoundError, OSError):
        return True

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format='%(asctime)s.%(msecs)03d %(message)s',
    datefmt='%H:%M:%S',
    encoding='utf-8',
)
log = logging.getLogger('wake')

# Wake-word model. Custom-trained ONNX bundled in app/models/ (not
# via HuggingFace auto-download — custom models aren't on HF). See
# docs/architecture/wake-word-training.md for the why, and
# scripts/train-hey-tt/README.md for how the model gets produced.
#
# WAKE_WORDS is the list of MODEL KEYS (the names openwakeword
# reports in its `prediction` dict). WAKE_MODEL_PATHS is the actual
# .onnx files to load, each keyed to the name its filename would
# produce after openWakeWord's slugify step.
WAKE_WORDS = ['hey_tt']
WAKE_MODEL_PATHS = [
    str(Path(__file__).resolve().parent / 'models' / 'hey_tt.onnx')
]
THRESHOLD = 0.5
COOLDOWN_SEC = 2.0

# S2.3 adaptive noise floor. `NOISE_ALPHA` is the EMA smoothing factor --
# 0.05 means each frame contributes 5% of the running mean, so the EMA
# follows roughly the last ~20 frames of audio (≈1.6 s at 80 ms/frame).
# `NOISE_MARGIN` is how far ABOVE the noise floor a score must sit before
# we fire. 0.3 is wide enough that speech-shaped noise (TV chatter, music)
# doesn't repeatedly trip the detector even if individual frames briefly
# hit THRESHOLD, and narrow enough that a real wake-word (score ~0.85-0.95)
# still fires instantly in a quiet room where noise_ema ~= 0.
NOISE_ALPHA = 0.05
NOISE_MARGIN = 0.3

SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280

_user32 = ctypes.windll.user32
_VK_CONTROL = 0x11
_VK_SHIFT = 0x10
_VK_S = 0x53
_KEYUP = 0x0002

def send_hotkey():
    try:
        _user32.keybd_event(_VK_CONTROL, 0, 0, 0)
        _user32.keybd_event(_VK_SHIFT, 0, 0, 0)
        _user32.keybd_event(_VK_S, 0, 0, 0)
        _user32.keybd_event(_VK_S, 0, _KEYUP, 0)
        _user32.keybd_event(_VK_SHIFT, 0, _KEYUP, 0)
        _user32.keybd_event(_VK_CONTROL, 0, _KEYUP, 0)
    except Exception as e:
        log.error(f'sendkeys fail: {e}')

def main():
    log.info('===== wake-word listener starting (openWakeWord) =====')
    log.info(f'PID: {os.getpid()}')
    log.info(f'wake words: {WAKE_WORDS}')
    log.info(f'model paths: {WAKE_MODEL_PATHS}')

    for p in WAKE_MODEL_PATHS:
        if not Path(p).exists():
            log.error(
                f'FATAL: wake-word model missing at {p} -- '
                f'run install.ps1 to copy the bundled hey_tt.onnx into place'
            )
            return 1

    try:
        # Pass absolute paths to the bundled ONNX files. openWakeWord
        # treats a path arg as "load this file" rather than "fetch the
        # stock model with this key from HuggingFace", which is what
        # lets us ship a custom-trained model.
        model = Model(wakeword_models=WAKE_MODEL_PATHS, inference_framework='onnx')
        log.info('model loaded')
    except Exception as e:
        log.error(f'FATAL: model load failed: {e}')
        return 1

    try:
        devices = sd.query_devices()
        default_input = sd.default.device[0]
        input_name = devices[default_input]['name'] if default_input is not None else 'unknown'
        log.info(f'default input: {input_name}')
    except Exception as e:
        log.error(f'FATAL: audio device query failed: {e}')
        return 1

    last_fire = 0.0
    # Preallocated ring so the audio callback doesn't allocate a fresh
    # ndarray every ~80 ms (blocksize=1280 @ 16 kHz). The old code did
    # np.concatenate + slice-drop on every block -- on a busy box those
    # allocations are enough to push the realtime audio thread over its
    # budget and drop samples. RING_CAPACITY = 4 × CHUNK_SAMPLES leaves
    # headroom for odd-sized chunks around stream start/stop.
    RING_CAPACITY = CHUNK_SAMPLES * 4
    ring = np.zeros(RING_CAPACITY, dtype=np.int16)
    ring_fill = [0]   # one-element list so nested callback can mutate
    last_score = 0.0
    # S2.3: per-wake-word EMA of recent scores. Keyed by name so the model
    # can add wake words later without rework. One-element dict start.
    noise_ema = {name: 0.0 for name in WAKE_WORDS}
    heartbeat_interval = 30
    last_heartbeat = time.time()

    def callback(indata, frames, time_info, status):
        nonlocal last_fire, last_score, last_heartbeat
        if status:
            log.warning(f'audio status: {status}')

        chunk = (indata[:, 0] * 32767).astype(np.int16)
        n = chunk.shape[0]
        fill = ring_fill[0]
        # Overflow guard: audio thread can briefly deliver bursts if the
        # predict() loop below was slow for a beat. Drop the oldest samples
        # rather than grow unbounded -- the user's next utterance is what
        # matters, not the last half second of background noise.
        if fill + n > RING_CAPACITY:
            drop = (fill + n) - RING_CAPACITY
            ring[:fill - drop] = ring[drop:fill]
            fill -= drop
            log.warning(f'ring overflow, dropped {drop} samples')
        ring[fill:fill + n] = chunk
        fill += n

        while fill >= CHUNK_SAMPLES:
            # openWakeWord copies internally, so a view is fine here.
            window = ring[:CHUNK_SAMPLES]
            try:
                prediction = model.predict(window)
            except Exception as e:
                log.error(f'predict fail: {e}')
                # Still consume the window so we don't loop forever on
                # a persistent predict failure.
                prediction = {}
            # Shift remaining samples down in place. Amortised O(1) in
            # steady state because blocksize == CHUNK_SAMPLES means fill
            # returns to ~0 after every emit.
            ring[:fill - CHUNK_SAMPLES] = ring[CHUNK_SAMPLES:fill]
            fill -= CHUNK_SAMPLES

            for name, score in prediction.items():
                # Update the noise floor BEFORE the fire gate so the EMA
                # tracks steady-state background -- including the instant
                # itself. Using the frame score before the gate means a
                # genuine hit nudges the EMA upward too, which is fine:
                # the next frame won't re-fire because of cooldown, and
                # the EMA decays back inside a second or two.
                prev = noise_ema.get(name, 0.0)
                noise_ema[name] = NOISE_ALPHA * score + (1 - NOISE_ALPHA) * prev
                if score > 0.3:
                    log.info(
                        f'hypothesis: {name} score={score:.2f} '
                        f'noise_ema={noise_ema[name]:.2f}'
                    )
                # S2.3 gate: absolute floor AND relative to noise_ema.
                # Firing requires both conditions so speech-shaped noise
                # that briefly crosses THRESHOLD on one frame doesn't
                # repeatedly trigger the hotkey.
                if (
                    score >= THRESHOLD
                    and score > noise_ema[name] + NOISE_MARGIN
                ):
                    now = time.time()
                    if now - last_fire >= COOLDOWN_SEC:
                        log.info(
                            f'FIRE: {name} score={score:.2f} '
                            f'(noise_ema={noise_ema[name]:.2f})'
                        )
                        send_hotkey()
                        last_fire = now
                last_score = max(last_score, score)

        ring_fill[0] = fill

        now = time.time()
        if now - last_heartbeat >= heartbeat_interval:
            log.info(f'heartbeat: top score in last {heartbeat_interval}s = {last_score:.2f}')
            last_score = 0.0
            last_heartbeat = now

    # Defense-in-depth mute: open/close the InputStream in response to the
    # _listening.state flag. When 'off', the stream is torn down so the OS
    # actually releases the microphone at the driver level — no "hot mic"
    # even if another instance of this listener is somehow lingering.
    stream = None
    try:
        while True:
            wanted = is_listening_on()
            if wanted and stream is None:
                try:
                    stream = sd.InputStream(
                        samplerate=SAMPLE_RATE,
                        channels=1,
                        dtype='float32',
                        blocksize=CHUNK_SAMPLES,
                        callback=callback,
                    )
                    stream.start()
                    log.info('stream opened; listening (say "hey jarvis")...')
                except Exception as e:
                    log.error(f'stream open fail: {type(e).__name__}: {e}')
                    time.sleep(2)
                    continue
            elif not wanted and stream is not None:
                try:
                    stream.stop()
                    stream.close()
                except Exception as e:
                    log.error(f'stream close fail: {type(e).__name__}: {e}')
                finally:
                    stream = None
                    log.info('listening toggled off; mic released')
            time.sleep(0.25)
    except KeyboardInterrupt:
        log.info('interrupted')
        return 0
    except Exception as e:
        log.error(f'FATAL stream: {type(e).__name__}: {e}')
        return 1
    finally:
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

def selftest() -> int:
    """S2.3: load the model, open the input stream for 3 s, exit 0.
    Used by install-sanity / CI smoke to confirm the listener can get
    past model load + audio device open WITHOUT having to actually say
    the wake word. Exits non-zero on any failure so the caller knows to
    surface an install problem."""
    log.info('===== wake-word listener --selftest =====')
    for p in WAKE_MODEL_PATHS:
        if not Path(p).exists():
            log.error(f'selftest: wake-word model missing at {p}')
            return 1
    try:
        Model(wakeword_models=WAKE_MODEL_PATHS, inference_framework='onnx')
    except Exception as e:
        log.error(f'selftest: model load failed: {e}')
        return 1
    try:
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=1, dtype='float32',
            blocksize=CHUNK_SAMPLES,
            callback=lambda *_args, **_kw: None,  # discard frames
        )
        stream.start()
        time.sleep(3.0)
        stream.stop()
        stream.close()
    except Exception as e:
        log.error(f'selftest: stream fail: {type(e).__name__}: {e}')
        return 2
    log.info('selftest: OK')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Terminal Talk wake-word listener')
    parser.add_argument(
        '--selftest', action='store_true',
        help='Load model + open stream for 3 s, exit 0 on success',
    )
    args = parser.parse_args()
    if args.selftest:
        sys.exit(selftest())
    sys.exit(main() or 0)
