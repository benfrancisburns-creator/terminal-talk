"""openWakeWord listener for Terminal Talk.

Listens for 'hey jarvis' and sends Ctrl+Shift+S to trigger speakClipboard()
in the Electron toolbar. Uses ctypes (no subprocess) for instant keystroke delivery.
"""
import os
import sys
import time
import ctypes
import logging
from pathlib import Path

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

LOG_PATH = Path.home() / '.terminal-talk' / 'queue' / '_voice.log'
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format='%(asctime)s.%(msecs)03d %(message)s',
    datefmt='%H:%M:%S',
    encoding='utf-8',
)
log = logging.getLogger('wake')

WAKE_WORDS = ['hey_jarvis']
THRESHOLD = 0.5
COOLDOWN_SEC = 2.0

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

    try:
        model = Model(wakeword_models=WAKE_WORDS, inference_framework='onnx')
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
    buffer = np.array([], dtype=np.int16)
    last_score = 0.0
    heartbeat_interval = 30
    last_heartbeat = time.time()

    def callback(indata, frames, time_info, status):
        nonlocal buffer, last_fire, last_score, last_heartbeat
        if status:
            log.warning(f'audio status: {status}')

        chunk = (indata[:, 0] * 32767).astype(np.int16)
        buffer = np.concatenate([buffer, chunk])

        while len(buffer) >= CHUNK_SAMPLES:
            window = buffer[:CHUNK_SAMPLES]
            buffer = buffer[CHUNK_SAMPLES:]

            try:
                prediction = model.predict(window)
            except Exception as e:
                log.error(f'predict fail: {e}')
                continue

            for name, score in prediction.items():
                if score > 0.3:
                    log.info(f'hypothesis: {name} score={score:.2f}')
                if score >= THRESHOLD:
                    now = time.time()
                    if now - last_fire >= COOLDOWN_SEC:
                        log.info(f'FIRE: {name} score={score:.2f}')
                        send_hotkey()
                        last_fire = now
                last_score = max(last_score, score)

        now = time.time()
        if now - last_heartbeat >= heartbeat_interval:
            log.info(f'heartbeat: top score in last {heartbeat_interval}s = {last_score:.2f}')
            last_score = 0.0
            last_heartbeat = now

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=CHUNK_SAMPLES,
            callback=callback,
        ):
            log.info('listening (say "hey jarvis")...')
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        log.info('interrupted')
        return 0
    except Exception as e:
        log.error(f'FATAL stream: {type(e).__name__}: {e}')
        return 1

if __name__ == '__main__':
    sys.exit(main() or 0)
