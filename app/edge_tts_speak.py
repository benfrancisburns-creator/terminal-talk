"""edge-tts wrapper: reads text from stdin, writes MP3 to out_path.

Usage: python edge_tts_speak.py <voice> <out_path>

Uses WindowsSelectorEventLoop on Windows to avoid a Python 3.14 Proactor
websocket handshake bug that drops the initial TLS handshake.
Retries up to 6 times with short backoff; cleans up partial files on failure.
"""
import asyncio
import sys
import os

import edge_tts


async def synth(text: str, voice: str, out_path: str) -> int:
    last_err = None
    for attempt in range(6):
        try:
            tmp = out_path + '.partial'
            c = edge_tts.Communicate(text, voice)
            await c.save(tmp)
            if os.path.getsize(tmp) < 500:
                raise RuntimeError(f'output too small ({os.path.getsize(tmp)} bytes)')
            os.replace(tmp, out_path)
            return 0
        except Exception as e:
            last_err = e
            await asyncio.sleep(0.3 + 0.2 * attempt)
    try:
        tmp = out_path + '.partial'
        if os.path.exists(tmp):
            os.remove(tmp)
    except Exception:
        pass
    print(f'edge-tts failed after 6 attempts: {type(last_err).__name__}: {last_err}', file=sys.stderr)
    return 1


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: edge_tts_speak.py <voice> <out_path>', file=sys.stderr)
        return 2
    voice = sys.argv[1]
    out_path = sys.argv[2]
    text = sys.stdin.buffer.read().decode('utf-8', errors='replace').strip()
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
