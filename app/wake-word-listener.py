"""openWakeWord listener for Terminal Talk.

Primary role: listen for 'hey jarvis' and send Ctrl+Shift+S to trigger
speakClipboard() in the Electron toolbar. Uses ctypes (no subprocess) for
instant keystroke delivery.

Phase 1 voice commands (2026-04-24): after a wake-word fire we also
capture ~500 ms of audio. If it's below an RMS silence threshold we
send Ctrl+Shift+S straight away (the existing read-highlighted flow).
If the user IS speaking, we keep capturing to ~2 s, write a WAV, and
spawn voice-command-recognize.ps1 (System.Speech.Recognition with a
fixed SRGS grammar). A match writes ~/.terminal-talk/voice-command.json
which main.js picks up and routes to audio-player actions (play, pause,
next, back, stop, resume, cancel). No match → short MessageBeep chime
so the user knows it was heard but not understood.

S2.3: firing is gated by an adaptive noise floor (exponential moving
average of recent scores) rather than the raw THRESHOLD alone. In a noisy
room the effective gate rises; in a quiet room it stays near the static
floor. Also exposes `--selftest` so CI / an install-sanity check can load
the model, open the stream for 3 s and exit without having to say the wake
word out loud on a headless box.
"""
import argparse
import contextlib
import ctypes
import json
import logging
import logging.handlers
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import wave
import winsound
from pathlib import Path

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

LOG_PATH = Path.home() / '.terminal-talk' / 'queue' / '_voice.log'
LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

STATE_FILE = Path.home() / '.terminal-talk' / 'listening.state'

# mic-watcher.ps1 reads this file to learn the exact path of the Python
# interpreter running US, and excludes it from "another app has the mic"
# triggers. Without it, opening the wake-word stream fires MIC_CAPTURED
# on our own listener → renderer pauses its own playback when the user
# toggles listening on. Path varies by Python install (Windows Store
# pythoncore-3.14-64, system Python, Anaconda, etc.) so we broadcast
# the actual value at startup rather than trying to enumerate possible
# install locations in the PS side.
LISTENER_PATH_FILE = Path.home() / '.terminal-talk' / 'listener-python-path.txt'

def is_listening_on():
    """Returns True if the user has the mic toggle enabled.
    Defaults to True if the state file is missing (first run)."""
    try:
        return STATE_FILE.read_text(encoding='utf-8').strip() != 'off'
    except (FileNotFoundError, OSError):
        return True

# #10 — size-capped rotation mirroring _hook.log's pattern. Pre-#10
# the log was append-forever (561 KB after ~2 days → ~10 MB/month).
# RotatingFileHandler at 1 MB with 1 backup matches the PS-side
# convention used by the hook scripts (`Move-Item _hook.log
# _hook.log.1` at > 1048576 bytes). Drops the daily-quiet log to
# bounded ~2 MB on disk worst case.
_voice_log_handler = logging.handlers.RotatingFileHandler(
    LOG_PATH,
    maxBytes=1_048_576,
    backupCount=1,
    encoding='utf-8',
)
_voice_log_handler.setFormatter(
    logging.Formatter('%(asctime)s.%(msecs)03d %(message)s', datefmt='%H:%M:%S')
)
logging.basicConfig(
    level=logging.INFO,
    handlers=[_voice_log_handler],
)
log = logging.getLogger('wake')

WAKE_WORDS = ['hey_jarvis']
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

# Phase 1 voice commands — post-wake audio capture with end-point
# detection (EPD). Fixed-window capture was brittle: too short and
# slow speakers got cut off ("hey jarvis [pause] play" with pause
# > 1s missed the command); too long and fast speakers ate extra
# latency for no benefit.
#
# EPD approach: start capture at wake fire, keep accumulating until
# EITHER we've seen speech AND then ~POST_WAKE_TRAILING_SILENCE_MS
# of silence (= "user stopped talking"), OR we hit the hard cap
# POST_WAKE_CAPTURE_SAMPLES. Minimum-guaranteed capture
# POST_WAKE_MIN_CAPTURE_SAMPLES protects against ultra-short
# single-chunk wake fires.
#
# Per Ben's 2026-04-24 log: "play" failed at RMS=64 across the whole
# 1.5s window because the command word was spoken AFTER the window
# closed. EPD fixes this without punishing fast speakers.
POST_WAKE_CAPTURE_SAMPLES = 48000          # hard cap: ~3 s
POST_WAKE_MIN_CAPTURE_SAMPLES = 12800      # ~800 ms minimum
POST_WAKE_TRAILING_SILENCE_CHUNKS = 5      # 5 chunks * 80ms = 400ms trailing silence
POST_WAKE_VOICE_RMS_THRESHOLD = 150        # per-chunk RMS to count as speech

# RMS threshold for "post-wake was silent" — used ONLY to decide
# whether to fall through to the existing Ctrl+Shift+S clipboard-read
# flow vs. chime as "heard you but missed the word". Tuned against
# live logs 2026-04-24: Ben's mic shows speech at RMS 170-320,
# ambient around 40-80. 100 is a conservative floor that treats the
# 170+ range as "definitely speech".
#
# Getting this wrong has a specific cost: too high and real
# commands fall through to Ctrl+Shift+S, which synthesises a ghost
# clip from whatever was highlighted — Ben saw that on 2026-04-24
# as "a little circle appears and disappears in the queue".
SILENCE_RMS_THRESHOLD = 100

# SAPI confidence floor. 0.5 was too strict — Ben's live log showed
# a correct "pause" match at 0.21 that we rejected, falling through
# to Ctrl+Shift+S and firing the ghost-clip path described above.
# 0.3 accepts genuine matches while still rejecting random 0.1-ish
# phonetic collisions (a cough happens to hit a grammar word). If a
# false-fire sneaks through, user can say "hey jarvis cancel" within
# 2 s (cancel is a no-op at main.js).
MIN_CONFIDENCE = 0.3

VOICE_COMMAND_PATH = Path.home() / '.terminal-talk' / 'voice-command.json'
RECOGNIZER_SCRIPT = Path(__file__).resolve().parent / 'voice-command-recognize.ps1'

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


def _rms(samples: np.ndarray) -> float:
    """RMS of int16 samples. Used to distinguish silence from speech."""
    if samples.size == 0:
        return 0.0
    # float64 to avoid int16 overflow on the squared sum.
    sq = samples.astype(np.float64)
    return float(np.sqrt(np.mean(sq * sq)))


def _should_finalise_capture(
    fill: int,
    saw_voice: bool,
    silence_run: int,
    hard_cap_samples: int = POST_WAKE_CAPTURE_SAMPLES,
    min_samples: int = POST_WAKE_MIN_CAPTURE_SAMPLES,
    trailing_silence_chunks: int = POST_WAKE_TRAILING_SILENCE_CHUNKS,
) -> bool:
    """Pure end-point-detection decision. Extracted from the audio
    callback so each state is unit-testable:

    - Before minimum capture (fill < min_samples) → keep capturing
      even if we've already detected voice+silence. Protects against
      single-chunk blips ending capture prematurely.
    - After seeing voice + trailing-silence-chunks of quiet →
      finalise (EPD: user stopped talking).
    - Hard cap reached → finalise (user never stopped talking, or
      never started — either way we're done).

    Returns True when capture should end + be dispatched.
    """
    if fill >= hard_cap_samples:
        return True
    if fill < min_samples:
        return False
    # SIM103: collapsed `if cond: return True; return False` to direct return.
    return saw_voice and silence_run >= trailing_silence_chunks


def _write_wav(path: Path, samples: np.ndarray) -> None:
    """Write int16 samples to a 16 kHz mono PCM WAV file. SAPI requires
    mono PCM; 16 kHz matches our capture rate so no resampling."""
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(samples.tobytes())


def _run_recognizer(wav_path: Path) -> dict:
    """Spawn voice-command-recognize.ps1 with the captured WAV, parse
    its single-line JSON output. Returns {} on any failure — caller
    treats that as 'no match'."""
    try:
        proc = subprocess.run(
            ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
             '-File', str(RECOGNIZER_SCRIPT), str(wav_path)],
            capture_output=True, text=True, timeout=8,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
    except subprocess.TimeoutExpired:
        log.warning('recognizer timed out')
        return {}
    except Exception as e:
        log.error(f'recognizer spawn fail: {type(e).__name__}: {e}')
        return {}

    if proc.returncode != 0:
        log.warning(f'recognizer rc={proc.returncode} stderr={proc.stderr[:200]}')
    # Last non-empty line of stdout is our JSON (earlier lines may be
    # PS verbose noise if something went sideways).
    lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        return {}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError as e:
        log.error(f'recognizer JSON parse fail: {e}; stdout={proc.stdout[:200]}')
        return {}


def _write_voice_command(action: str) -> None:
    """Emit a voice-command intent for main.js to pick up. Timestamp in
    ms epoch so main.js can reject stale files (> 5 s old) as a safety
    net against race conditions."""
    try:
        payload = {
            'timestamp': int(time.time() * 1000),
            'action': action,
        }
        VOICE_COMMAND_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = VOICE_COMMAND_PATH.with_suffix('.json.tmp')
        tmp_path.write_text(json.dumps(payload), encoding='utf-8')
        os.replace(tmp_path, VOICE_COMMAND_PATH)
        log.info(f'voice-command: action={action}')
    except Exception as e:
        log.error(f'write voice-command fail: {type(e).__name__}: {e}')


def _play_success_chime() -> None:
    """Short rising two-note chime — distinct from the
    unrecognised MB_ICONEXCLAMATION so the user can hear which path
    fired without waiting for the command to take effect. Windows
    winsound is synchronous but fast (~60 ms) and runs on the
    dispatcher thread, not the audio-callback thread."""
    try:
        # winsound.Beep is blocking but short. Two quick ascending
        # tones = "got it". Failure path uses Windows' built-in
        # MB_ICONEXCLAMATION which is a single descending note —
        # audibly distinct.
        winsound.Beep(880, 60)
        winsound.Beep(1175, 80)
    except Exception as e:
        log.warning(f'success chime fail: {type(e).__name__}: {e}')


def _keep_debug_wav(buf: np.ndarray, reason: str) -> None:
    """Keep the captured WAV under ~/.terminal-talk/queue/_voice-debug/
    when a command didn't fire cleanly. Gives a post-mortem asset we
    can feed to SAPI manually / listen to. Rolling cap at 20 WAVs so
    the directory doesn't balloon."""
    try:
        debug_dir = LOG_PATH.parent / '_voice-debug'
        debug_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime('%Y%m%dT%H%M%S')
        out = debug_dir / f'{ts}-{reason}.wav'
        _write_wav(out, buf)
        # Roll oldest when > 20 files.
        wavs = sorted(debug_dir.glob('*.wav'))
        for old in wavs[:-20]:
            with contextlib.suppress(Exception):
                old.unlink()
    except Exception as e:
        log.warning(f'debug-wav save fail: {type(e).__name__}: {e}')


def _handle_post_wake(buf: np.ndarray) -> None:
    """Runs in the command-dispatch thread. Decision tree:

      1. SAPI matched a grammar phrase with conf >= MIN_CONFIDENCE →
         write voice-command.json + play success chime.
      2. SAPI returned something below MIN_CONFIDENCE → unrecognised
         chime. Keep WAV for debug.
      3. SAPI returned nothing AND buffer is truly silent (all RMS
         windows low) → fall through to Ctrl+Shift+S.
      4. SAPI returned nothing AND buffer has speech → unrecognised
         chime + keep WAV for debug.

    Earlier revisions had two distinct failure modes (both shipped
    before live testing):
      - 2 s capture was too long (1.5s feels responsive),
      - silence probe ran BEFORE SAPI and misfired on natural pauses,
      - SILENCE_RMS=400 was too high for Ben's mic — real speech at
        170-320 RMS got routed to Ctrl+Shift+S ghost-clip path,
      - MIN_CONFIDENCE=0.5 rejected a correct "pause" at 0.21.
    All four fixed in the 2026-04-24 log-driven retune.
    """
    with tempfile.NamedTemporaryFile(
        suffix='.wav', prefix='tt-voice-', delete=False,
    ) as tf:
        wav_path = Path(tf.name)
    try:
        _write_wav(wav_path, buf)
        result = _run_recognizer(wav_path)
        action = result.get('action')
        confidence = float(result.get('confidence', 0.0))
        full_rms = _rms(buf)

        duration_ms = int(1000 * buf.shape[0] / SAMPLE_RATE) if buf.shape[0] else 0
        # 1) Clean match.
        if action and confidence >= MIN_CONFIDENCE:
            log.info(
                f'command matched: action={action} '
                f'confidence={confidence:.2f} rms={full_rms:.0f} '
                f'dur={duration_ms}ms'
            )
            _write_voice_command(action)
            _play_success_chime()
            return

        # 2) SAPI matched but below confidence floor.
        if action:
            log.info(
                f'post-wake low-confidence (action={action}, '
                f'confidence={confidence:.2f}, rms={full_rms:.0f}, '
                f'dur={duration_ms}ms); chiming unrecognised'
            )
            _keep_debug_wav(buf, f'lowconf-{action}-{int(confidence * 100):02d}')
            try:
                winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
            except Exception as e:
                log.warning(f'chime fail: {type(e).__name__}: {e}')
            return

        # 3) SAPI returned nothing. Distinguish silence from unrecognised
        # speech via RMS.
        if full_rms < SILENCE_RMS_THRESHOLD:
            log.info(
                f'post-wake silent (rms={full_rms:.0f}, '
                f'confidence={confidence:.2f}, dur={duration_ms}ms); '
                f'falling through to Ctrl+Shift+S'
            )
            send_hotkey()
        else:
            # 4) Speech-level audio, no grammar match. Chime.
            log.info(
                f'post-wake unrecognised speech (rms={full_rms:.0f}, '
                f'confidence={confidence:.2f}, dur={duration_ms}ms)'
            )
            _keep_debug_wav(buf, 'nomatch-speech')
            try:
                winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
            except Exception as e:
                log.warning(f'chime fail: {type(e).__name__}: {e}')
    finally:
        with contextlib.suppress(Exception):
            wav_path.unlink()

def main():
    log.info('===== wake-word listener starting (openWakeWord) =====')
    log.info(f'PID: {os.getpid()}')
    log.info(f'wake words: {WAKE_WORDS}')

    # Advertise our Python path so mic-watcher.ps1 can exclude us from
    # the "another app has the mic" detector. Write atomically to avoid
    # the watcher reading a half-written file. Best-effort — if this
    # fails, mic-watcher falls back to its static fragment list.
    try:
        LISTENER_PATH_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = LISTENER_PATH_FILE.with_suffix('.txt.tmp')
        tmp.write_text(sys.executable, encoding='utf-8')
        os.replace(tmp, LISTENER_PATH_FILE)
        log.info(f'listener-python-path: {sys.executable}')
    except Exception as e:
        log.warning(f'listener-python-path write fail: {type(e).__name__}: {e}')

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

    # Phase 1 voice-command post-wake capture state. Buffer + counters
    # filled by the audio callback; when EPD decides we're done, the
    # populated slice is pushed onto cmd_queue for the dispatcher
    # thread (WAV write + PS SAPI spawn runs off the audio thread).
    post_wake_buf = np.zeros(POST_WAKE_CAPTURE_SAMPLES, dtype=np.int16)
    post_wake_fill = [0]                     # samples captured so far
    post_wake_active = [False]
    # EPD counters: per-chunk (80 ms) rolling state.
    post_wake_saw_voice = [False]            # have we seen ANY voice yet?
    post_wake_silence_run = [0]              # chunks of silence since last voice
    cmd_queue: queue.Queue[np.ndarray] = queue.Queue()

    def dispatcher():
        """Consumes post-wake buffers off cmd_queue on a plain Python
        thread, not the realtime audio thread — writing the WAV and
        spawning PS SAPI can take 300-1500 ms which would stall audio
        capture if done inline."""
        while True:
            buf = cmd_queue.get()
            if buf is None:  # sentinel, shutdown
                break
            try:
                _handle_post_wake(buf)
            except Exception as e:
                log.error(f'dispatcher fail: {type(e).__name__}: {e}')
                # Best-effort fallback — preserve the old behaviour.
                send_hotkey()

    threading.Thread(target=dispatcher, daemon=True, name='voice-cmd').start()

    def callback(indata, frames, time_info, status):
        nonlocal last_fire, last_score, last_heartbeat
        if status:
            log.warning(f'audio status: {status}')

        chunk = (indata[:, 0] * 32767).astype(np.int16)
        n = chunk.shape[0]

        # Phase 1: if a wake fired recently, tee the chunk into the
        # post-wake capture buffer + run end-point detection. EPD
        # finalises the capture as soon as we've seen speech then
        # trailing silence (user finished the command word), giving
        # a snappier dispatch than waiting the full 3 s hard cap.
        if post_wake_active[0]:
            pf = post_wake_fill[0]
            remaining = POST_WAKE_CAPTURE_SAMPLES - pf
            take = min(n, remaining)
            if take > 0:
                post_wake_buf[pf:pf + take] = chunk[:take]
                post_wake_fill[0] = pf + take

            # Per-chunk RMS drives voice/silence classification. int16
            # math in float64 avoids the squared-sum overflow.
            chunk_rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))) if n > 0 else 0.0
            is_voice = chunk_rms >= POST_WAKE_VOICE_RMS_THRESHOLD
            if is_voice:
                post_wake_saw_voice[0] = True
                post_wake_silence_run[0] = 0
            elif post_wake_saw_voice[0]:
                post_wake_silence_run[0] += 1

            fill = post_wake_fill[0]
            should_finalise = _should_finalise_capture(
                fill,
                post_wake_saw_voice[0],
                post_wake_silence_run[0],
            )

            if should_finalise:
                # Trim to exactly what we captured; SAPI does better on
                # a tight sample than on a 3-second buffer of mostly
                # silence.
                try:
                    cmd_queue.put_nowait(post_wake_buf[:fill].copy())
                except queue.Full:
                    log.warning('cmd_queue full; dropping capture')
                post_wake_active[0] = False
                post_wake_fill[0] = 0
                post_wake_saw_voice[0] = False
                post_wake_silence_run[0] = 0

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
                        # Phase 1 voice-command capture. DON'T send the
                        # Ctrl+Shift+S hotkey yet — _handle_post_wake will
                        # send it on a silent probe (user wants highlighted
                        # text read), OR dispatch a command on a grammar
                        # match, OR chime on unrecognised speech.
                        # Double-fire guard: if already capturing, ignore
                        # the second wake (cooldown usually covers this
                        # but belt-and-braces). Always reset EPD state
                        # so a rapid re-fire starts with a clean slate.
                        if not post_wake_active[0]:
                            post_wake_fill[0] = 0
                            post_wake_saw_voice[0] = False
                            post_wake_silence_run[0] = 0
                            post_wake_active[0] = True
                        last_fire = now
                last_score = max(last_score, score)

        ring_fill[0] = fill

        now = time.time()
        if now - last_heartbeat >= heartbeat_interval:
            log.info(f'heartbeat: top score in last {heartbeat_interval}s = {last_score:.2f}')
            last_score = 0.0
            last_heartbeat = now

    return _run_stream_loop(callback)


def _open_stream(callback):
    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='float32',
        blocksize=CHUNK_SAMPLES,
        callback=callback,
    )
    stream.start()
    log.info('stream opened; listening (say "hey jarvis")...')
    return stream


def _close_stream(stream):
    with contextlib.suppress(Exception):
        stream.stop()
        stream.close()


def _run_stream_loop(callback) -> int:
    """Defense-in-depth mute: open/close the InputStream in response to the
    _listening.state flag. When 'off', the stream is torn down so the OS
    actually releases the microphone at the driver level — no "hot mic"
    even if another instance of this listener is somehow lingering.
    Extracted from main() to keep main's complexity readable."""
    stream = None
    try:
        while True:
            wanted = is_listening_on()
            if wanted and stream is None:
                try:
                    stream = _open_stream(callback)
                except Exception as e:
                    log.error(f'stream open fail: {type(e).__name__}: {e}')
                    time.sleep(2)
                    continue
            elif not wanted and stream is not None:
                _close_stream(stream)
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
            _close_stream(stream)

def selftest() -> int:
    """S2.3: load the model, open the input stream for 3 s, exit 0.
    Used by install-sanity / CI smoke to confirm the listener can get
    past model load + audio device open WITHOUT having to actually say
    the wake word. Exits non-zero on any failure so the caller knows to
    surface an install problem."""
    log.info('===== wake-word listener --selftest =====')
    try:
        Model(wakeword_models=WAKE_WORDS, inference_framework='onnx')
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
