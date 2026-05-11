"""macOS voice-command recogniser — mirrors voice-command-recognize.ps1.

Called by app/wake-word-listener.py's _run_recognizer after ~2.5 s of
post-wake audio capture has been written to a WAV file. Returns one
line of JSON on stdout:

    {"action": "play", "confidence": 0.87}   — grammar matched
    {}                                        — no recognition / OOV

Exit code is 0 on every outcome (caller parses JSON).

Why a Mac equivalent of the Windows path: System.Speech.Recognition
is .NET / Windows-only. macOS has SFSpeechRecognizer in the Speech
framework, accessed here via PyObjC. The contract (WAV in, JSON out,
fixed action vocabulary) is identical so the listener doesn't care
which platform's recogniser sits behind it.

Privacy posture matches Windows SAPI: `requiresOnDeviceRecognition`
is True so audio never leaves the machine. macOS prompts the user
once for the Speech Recognition permission (System Settings →
Privacy & Security → Speech Recognition) on first invocation; if
denied or not yet granted, we return `{}` so the caller falls
through to the clipboard-read path the same way it does on Windows
when no recogniser is available.

Action vocabulary stays in lock-step with
voice-command-recognize.ps1 + main.js VOICE_COMMAND_ALLOWED. If you
add a new verb, update all three.
"""
from __future__ import annotations

import json
import sys
import time

# Map each recognised phrase to its canonical action verb. Synonyms
# collapse: "skip" → "next"; "again" / "previous" → "back".
# "stop talking" / "shut up" / "silence" map to "stop" so the user
# can verbally mute the queue ("hey jarvis stop talking").
PHRASE_TO_ACTION = {
    'play': 'play',
    'pause': 'pause',
    'resume': 'resume',
    'next': 'next',
    'skip': 'next',
    'back': 'back',
    'again': 'back',
    'previous': 'back',
    'stop': 'stop',
    'cancel': 'cancel',
    'stop talking': 'stop',
    'shut up': 'stop',
    'silence': 'stop',
    'dictate': 'dictation_start',
    'start dictation': 'dictation_start',
    'begin dictation': 'dictation_start',
    'stop dictation': 'dictation_stop',
    'dictation stop': 'dictation_stop',
    'finish dictation': 'dictation_stop',
}

# Confidence floor matches the Windows path's MIN_CONFIDENCE in
# wake-word-listener.py (0.8 — strict). Wake-word tail noise
# routinely SAPI-recognises as "pause" at ~0.76, which is why the
# floor is set high. Same threshold applies on Mac so the cross-
# platform UX is consistent.
MIN_CONFIDENCE = 0.8

# Bound the recognition wait. The caller already trims the audio
# capture to ~3 s; we don't need longer than 4 s to know whether the
# recogniser found something.
RECOGNITION_TIMEOUT_SEC = 4.0

# Timeout for the authorization-status request. Permission UI fires
# the first time; subsequent runs hit a cached state and return
# instantly.
AUTH_TIMEOUT_SEC = 30.0


def _emit_empty_and_exit(reason: str = '') -> None:
    """Print {} to stdout and exit 0. Single source of truth for the
    "could not recognise" path so every error branch yields the same
    parseable output. `reason` (if given) is sent to stderr for
    diagnostic purposes — the caller logs stderr to _voice.log."""
    if reason:
        sys.stderr.write(f'voice_command_recognize_mac: {reason}\n')
    sys.stdout.write('{}\n')
    sys.exit(0)


def _import_speech_framework():
    """Late-bind PyObjC frameworks. Returns the modules tuple or None
    if any framework fails to import (PyObjC not installed, framework
    missing on this macOS version, etc.)."""
    try:
        import Speech
        from Foundation import NSURL, NSDate, NSRunLoop
        return Speech, NSURL, NSRunLoop, NSDate
    except ImportError:
        return None


def _ensure_authorisation(Speech, NSRunLoop, NSDate) -> bool:
    """Return True iff the Speech permission is currently granted.

    SFSpeechRecognizer has four authorization states:
        notDetermined / denied / restricted / authorized

    On notDetermined we request, which triggers the system prompt.
    The request is asynchronous; we pump the run loop until either
    the callback fires or the timeout expires. Subsequent runs after
    a grant return immediately because the status is cached.
    """
    status_authorized = Speech.SFSpeechRecognizerAuthorizationStatusAuthorized
    status_not_determined = Speech.SFSpeechRecognizerAuthorizationStatusNotDetermined

    current = Speech.SFSpeechRecognizer.authorizationStatus()
    if current == status_authorized:
        return True
    if current != status_not_determined:
        # denied or restricted — no prompt available, the user must
        # grant via System Settings.
        return False

    # notDetermined — request and pump the runloop until callback.
    state = {'final': None}

    def cb(status):
        state['final'] = status

    Speech.SFSpeechRecognizer.requestAuthorization_(cb)
    deadline = time.monotonic() + AUTH_TIMEOUT_SEC
    while state['final'] is None and time.monotonic() < deadline:
        NSRunLoop.currentRunLoop().runUntilDate_(
            NSDate.dateWithTimeIntervalSinceNow_(0.1),
        )
    return state['final'] == status_authorized


def _recognise_wav(Speech, NSURL, NSRunLoop, NSDate, wav_path: str) -> tuple[str, float]:
    """Synchronously recognise a WAV file via SFSpeechRecognizer.
    Returns (text, confidence). Empty text on any failure.

    SFSpeechRecognizer's API is asynchronous — recognitionTask fires
    its result handler on a private queue. We pump the main runloop
    until we get a final result or hit the timeout; then return what
    we have.
    """
    recognizer = Speech.SFSpeechRecognizer.alloc().init()
    if not recognizer or not recognizer.isAvailable():
        return '', 0.0

    url = NSURL.fileURLWithPath_(wav_path)
    req = Speech.SFSpeechURLRecognitionRequest.alloc().initWithURL_(url)
    if hasattr(req, 'setRequiresOnDeviceRecognition_'):
        req.setRequiresOnDeviceRecognition_(True)

    state = {'text': '', 'confidence': 0.0, 'done': False}

    def handler(result, error):
        if error is not None:
            state['done'] = True
            return
        if result is None:
            return
        # result is SFSpeechRecognitionResult. bestTranscription has
        # `formattedString` and per-segment `confidence` entries.
        try:
            transcription = result.bestTranscription()
            if transcription is not None:
                state['text'] = str(transcription.formattedString() or '')
                segs = list(transcription.segments() or [])
                if segs:
                    confs = [float(s.confidence()) for s in segs if s.confidence() > 0]
                    if confs:
                        state['confidence'] = sum(confs) / len(confs)
        except Exception:
            pass
        if result.isFinal():
            state['done'] = True

    recognizer.recognitionTaskWithRequest_resultHandler_(req, handler)
    deadline = time.monotonic() + RECOGNITION_TIMEOUT_SEC
    while not state['done'] and time.monotonic() < deadline:
        NSRunLoop.currentRunLoop().runUntilDate_(
            NSDate.dateWithTimeIntervalSinceNow_(0.05),
        )
    return state['text'], state['confidence']


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        _emit_empty_and_exit('usage: voice_command_recognize_mac.py <wav_path>')

    wav_path = argv[1]

    frameworks = _import_speech_framework()
    if frameworks is None:
        _emit_empty_and_exit('Speech framework not importable (pyobjc-framework-Speech missing?)')
    Speech, NSURL, NSRunLoop, NSDate = frameworks

    if not _ensure_authorisation(Speech, NSRunLoop, NSDate):
        _emit_empty_and_exit('Speech recognition permission not granted')

    text, confidence = _recognise_wav(Speech, NSURL, NSRunLoop, NSDate, wav_path)
    if not text:
        _emit_empty_and_exit('no recognition result')

    heard = text.strip().lower()
    action = PHRASE_TO_ACTION.get(heard)
    if not action:
        # Try a loose match — strip trailing punctuation, look up
        # individual words. Phase-1 grammar is simple enough that
        # a single-word match covers the realistic vocab.
        for phrase, mapped in PHRASE_TO_ACTION.items():
            if heard == phrase or heard.startswith(phrase + ' ') or heard.endswith(' ' + phrase):
                action = mapped
                break
    if not action:
        _emit_empty_and_exit(f'unrecognised phrase: {heard!r}')

    if confidence < MIN_CONFIDENCE:
        # Below floor — same fall-through behaviour as Windows: caller
        # treats `{}` as "no recognised command", falls back to the
        # speakClipboard path. Don't lie about confidence.
        _emit_empty_and_exit(
            f'confidence {confidence:.2f} below floor {MIN_CONFIDENCE} for {heard!r}'
        )

    sys.stdout.write(json.dumps({
        'action': action,
        'confidence': round(float(confidence), 3),
    }) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
