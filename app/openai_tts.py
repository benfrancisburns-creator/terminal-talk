"""OpenAI TTS subprocess wrapper.

Called by two sites:
  - synth_turn._run_openai_fallback (for real response / tool / heartbeat synth)
  - ipc-handlers.js `test-openai-voice` (the Settings panel "Test" button)

Both sites spawn it as:
    OPENAI_API_KEY=<key> python openai_tts.py <VOICE> <OUT_PATH>
with the text to synthesise piped on stdin, and expect an mp3 written
to OUT_PATH on exit 0. stdlib-only so there's no pip install step at
runtime — urllib is enough for a single POST.

The key is passed via the OPENAI_API_KEY env var (NOT argv) so it
never appears in a subprocess.run TimeoutExpired exception string,
which includes the full command and would leak the key to the hook
log. Leaked once on 2026-04-23 before this wrapper routed the key
off argv.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = 'https://api.openai.com/v1/audio/speech'
MODEL    = 'gpt-4o-mini-tts'
INSTRUCTIONS = 'Speak in a calm, clear, conversational tone.'
TIMEOUT_SEC = 60
# Mirrors the PS helper's > 100-byte sanity check on the response. A
# shorter body means OpenAI returned an error page, not audio. The
# synth-turn caller also checks > 500, so set this floor conservatively.
MIN_RESPONSE_BYTES = 500


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 2:
        sys.stderr.write('usage: OPENAI_API_KEY=<key> openai_tts.py VOICE OUT_PATH\n')
        return 2
    voice, out_path = args

    api_key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not api_key:
        sys.stderr.write('OPENAI_API_KEY env var not set\n')
        return 2

    text = sys.stdin.read() or ''
    if not text.strip():
        sys.stderr.write('empty stdin (no text to synthesise)\n')
        return 2

    body = json.dumps({
        'model': MODEL,
        'voice': voice,
        'input': text,
        'instructions': INSTRUCTIONS,
        # synth_turn + Settings-panel Test both write the output path
        # with an .mp3 extension, so request mp3 from OpenAI. The PS
        # fallback path asks for wav; this Python path asks for mp3
        # because the caller's filename already commits to that.
        'response_format': 'mp3',
    }).encode('utf-8')

    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type':  'application/json',
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
            audio = resp.read()
    except urllib.error.HTTPError as e:
        # Surface the OpenAI error body to stderr so the parent can log
        # it. Common failure modes: 401 invalid key, 429 rate-limit,
        # 400 unknown voice.
        try:
            detail = e.read().decode('utf-8', 'replace')
        except Exception:
            detail = ''
        sys.stderr.write(f'HTTP {e.code}: {detail[:400]}\n')
        # Exit code 2 specifically signals "the key was rejected" so the
        # parent (synth_turn.py) can write an auto-unset flag that
        # main.js picks up and clears the key + flips provider back to
        # edge. 1 stays "generic failure" (transient 429, 5xx, timeout).
        if e.code == 401:
            return 2
        return 1
    except urllib.error.URLError as e:
        sys.stderr.write(f'URLError: {e.reason}\n')
        return 1
    except Exception as e:
        sys.stderr.write(f'{type(e).__name__}: {e}\n')
        return 1

    if len(audio) < MIN_RESPONSE_BYTES:
        sys.stderr.write(f'response too small: {len(audio)} bytes (expected audio)\n')
        return 1

    try:
        with open(out_path, 'wb') as f:
            f.write(audio)
    except Exception as e:
        sys.stderr.write(f'write fail: {type(e).__name__}: {e}\n')
        return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
