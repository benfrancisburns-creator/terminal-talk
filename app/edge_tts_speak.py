"""edge-tts wrapper: reads text from stdin, writes MP3 to out_path.

Usage: python edge_tts_speak.py <voice> <out_path>

Uses WindowsSelectorEventLoop on Windows to avoid a Python 3.14 Proactor
websocket handshake bug that drops the initial TLS handshake.
Retries up to EDGE_TTS_RETRIES times with short backoff; cleans up partial
files on failure. `c.save(tmp)` is bounded by a 30 s wall-clock so a hung
Microsoft server can't wedge the script forever.

Input is plain text. We do NOT pass SSML through `edge_tts.Communicate`:
the library XML-escapes its input and wraps it in its own `<speak>`
envelope, so any caller-supplied SSML markup gets delivered as escaped
text content and read aloud verbatim by the Azure endpoint. The
pronunciation rewrites live in `narration_ssml.py` and produce plain
text.
"""
import asyncio
import os
import sys

import edge_tts

# Extracted constants (audit A2-3). Magic numbers used to live inline and
# weren't tuneable from the environment.
#
# MIN_MP3_BYTES: threshold below which the output is treated as a silent
# failure (edge-tts sometimes returns empty/tiny files without throwing).
# 500 bytes reliably distinguishes real speech from empty responses.
#
# EDGE_TTS_RETRIES: total attempts before giving up. Env override lets a
# CI job or low-bandwidth environment bump it without editing source.
#
# EDGE_TTS_SAVE_TIMEOUT_SEC: hard wall on one `c.save()` call. Edge's
# websocket can hang mid-stream; without this the subprocess sat forever
# and speakClipboard's own 45 s hard timeout (main.js callEdgeTTS) was
# our only line of defence.
MIN_MP3_BYTES = 500
EDGE_TTS_RETRIES = int(os.environ.get('TT_EDGE_TTS_RETRIES', '6'))
EDGE_TTS_SAVE_TIMEOUT_SEC = 30


async def _try_synth_once(payload: str, voice: str, out_path: str) -> int:
    """One attempt at edge-tts. Returns 0 on success, raises on failure
    so the retry loop can decide what to do."""
    tmp = out_path + '.partial'
    c = edge_tts.Communicate(payload, voice)
    await asyncio.wait_for(c.save(tmp), timeout=EDGE_TTS_SAVE_TIMEOUT_SEC)
    size = os.path.getsize(tmp)
    if size < MIN_MP3_BYTES:
        raise RuntimeError(
            f'output too small ({size} bytes, threshold {MIN_MP3_BYTES})'
        )
    os.replace(tmp, out_path)
    return 0


async def synth(text: str, voice: str, out_path: str) -> int:
    """Retry edge-tts up to EDGE_TTS_RETRIES times on transient
    websocket/TLS wobbles. Returns 0 on success, 1 on final failure."""
    last_err = None
    for attempt in range(EDGE_TTS_RETRIES):
        try:
            return await _try_synth_once(text, voice, out_path)
        except asyncio.TimeoutError:
            last_err = RuntimeError(
                f'edge-tts save timed out after {EDGE_TTS_SAVE_TIMEOUT_SEC}s'
            )
        except Exception as e:
            last_err = e
        try:
            if os.path.exists(out_path + '.partial'):
                os.remove(out_path + '.partial')
        except Exception:
            pass  # cleanup best-effort — leftover .partial is handled by startup sweep
        await asyncio.sleep(0.3 + 0.2 * attempt)

    print(
        f'edge-tts failed after {EDGE_TTS_RETRIES} attempts: '
        f'{type(last_err).__name__}: {last_err}',
        file=sys.stderr,
    )
    return 1


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: edge_tts_speak.py <voice> <out_path>', file=sys.stderr)
        return 2
    voice = sys.argv[1]
    out_path = sys.argv[2]
    raw = sys.stdin.buffer.read()
    decoded = raw.decode('utf-8', errors='replace')
    # Log when stdin contained bytes that weren't valid UTF-8 so the
    # renderer's diag trail captures garbled input before it turns into
    # mangled speech. U+FFFD is the replacement char `errors='replace'`
    # inserts; its presence means at least one byte was unrepresentable.
    if '�' in decoded:
        replaced = decoded.count('�')
        print(
            f"edge_tts_speak: stdin had {replaced} non-UTF-8 byte(s) "
            f"replaced with U+FFFD (len={len(raw)})",
            file=sys.stderr,
        )
    text = decoded.strip()
    if not text:
        print('empty text', file=sys.stderr)
        return 2
    loop = asyncio.SelectorEventLoop() if sys.platform == 'win32' else asyncio.new_event_loop()
    try:
        return loop.run_until_complete(synth(text, voice, out_path))
    finally:
        loop.close()


if __name__ == '__main__':
    sys.exit(main())
