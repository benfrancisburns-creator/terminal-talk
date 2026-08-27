"""Local Whisper dictation helper for Terminal Talk.

Modes:
  --file PATH   transcribe an existing audio file
  --record      record from the default microphone until trailing silence or
                until a stop-file appears

The script intentionally keeps dependencies light in the repo. If
openai-whisper has been installed into .codex-transcribe-pkgs, that path is
used automatically; otherwise normal Python site-packages are used.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import queue
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from collections import deque
from pathlib import Path


SAMPLE_RATE = 16_000
CHUNK_SAMPLES = 1_280
DEFAULT_MODEL = "base.en"
DEFAULT_CLEANUP_MODEL = "gpt-5.4-mini"
SOFT_GAP_SECONDS = 0.45
PARAGRAPH_GAP_SECONDS = 1.1

OPENAI_CLEANUP_INSTRUCTIONS = """You clean up dictated speech-to-text.

Return only the final text. Keep the user's meaning and wording. Remove filler
sounds and false starts such as um, uh, erm, er, you know, I mean, and repeated
starts. Add natural punctuation, paragraphs, and bullet lists when the speaker
clearly dictated a list. Convert spoken formatting commands such as new line,
new paragraph, bullet point, full stop, comma, colon, question mark, and open or
close quote into written formatting. Convert keyboard phrases like control plus
shift plus space into Ctrl+Shift+Space, and convert plus sign into +. Add quote
marks around short quoted speech after "I said", "he said", "she said", or
"they said" when the intent is clear. Break long dictated blocks into short,
readable paragraphs. Do not answer the text, explain it, or add new facts."""

FILLER_PATTERN = re.compile(
    r"(?i)(?<![\w'])"
    r"(?:um+|uh+|erm+|er+|ah+|hmm+|mm+|you know|i mean|sort of|kind of)"
    r"(?![\w'])"
)

STARTER_PATTERN = re.compile(
    r"(?i)^\s*(?:(?:okay|ok|right|so|well|great|cool|all right|alright)"
    r"[\s,.;:-]+){1,4}"
)

SPEECH_COMMANDS = [
    (re.compile(r"(?i)\b(?:new paragraph|paragraph break|new para)\b"), "\n\n"),
    (re.compile(r"(?i)\b(?:new line|line break)\b"), "\n"),
    (re.compile(r"(?i)\b(?:next bullet|new bullet|bullet point|bullet)\b"), "\n- "),
    (re.compile(r"(?i)\bfull stop\b"), "."),
    (re.compile(r"(?i)\bquestion mark\b"), "?"),
    (re.compile(r"(?i)\bexclamation mark\b"), "!"),
    (re.compile(r"(?i)\bexclamation point\b"), "!"),
    (re.compile(r"(?i)\bcomma\b"), ","),
    (re.compile(r"(?i)\bcolon\b"), ":"),
    (re.compile(r"(?i)\bsemicolon\b"), ";"),
    (re.compile(r"(?i)\bplus sign\b"), "+"),
    (re.compile(r"(?i)\bequals sign\b"), "="),
    (re.compile(r"(?i)\bat sign\b"), "@"),
    (re.compile(r"(?i)\bhash sign\b"), "#"),
    (re.compile(r"(?i)\bopen quote\b"), '"'),
    (re.compile(r"(?i)\bclose quote\b"), '"'),
]

WORD_FIXES = [
    (re.compile(r"(?i)\bthoru\b"), "thorough"),
    (re.compile(r"(?i)\bhockey\b"), "hotkey"),
    (re.compile(r"(?i)\b(?:wave\s*fire|wavefire|wave\s*file|wild\s*file)\b"), "WAV file"),
    (re.compile(r"(?i)\bterminal talk\b"), "Terminal Talk"),
    (re.compile(r"(?i)\btim\s+(?:will\s+)?talk\b"), "Terminal Talk"),
    (re.compile(r"(?i)\bcodex\b"), "Codex"),
    (re.compile(r"(?i)\bwhisper flow\b"), "Wispr Flow"),
    (re.compile(r"(?i)\bwispr flow\b"), "Wispr Flow"),
    (re.compile(r"(?i)\bcontrol alt space\b"), "Control+Alt+Space"),
    (re.compile(r"(?i)\bctrl alt space\b"), "Ctrl+Alt+Space"),
    (re.compile(r"(?i)\bcontrol shift space\b"), "Control+Shift+Space"),
    (re.compile(r"(?i)\bctrl shift space\b"), "Ctrl+Shift+Space"),
]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def add_local_package_path() -> None:
    local_pkgs = repo_root() / ".codex-transcribe-pkgs"
    if local_pkgs.exists():
        sys.path.insert(0, str(local_pkgs))


def import_numpy():
    try:
        import numpy as np
    except ImportError as exc:
        raise SystemExit(
            "Missing numpy. Install Terminal Talk wake-word dependencies or run "
            "`python -m pip install numpy sounddevice`."
        ) from exc
    return np


def import_whisper():
    add_local_package_path()

    # Some Python environments preload an incompatible coverage package. Numba's
    # optional coverage hook is not needed for transcription, so make coverage
    # look absent before importing Whisper.
    sys.modules["coverage"] = None
    try:
        import whisper
    except ImportError as exc:
        raise SystemExit(
            "Missing openai-whisper. Run:\n"
            "  python -m pip install --target .codex-transcribe-pkgs openai-whisper"
        ) from exc
    if not hasattr(whisper, "load_model"):
        raise SystemExit(
            "The `whisper` package was found, but it is not the OpenAI Whisper "
            "package or its files are not readable from this process. Reinstall "
            "with:\n"
            "  python -m pip install --upgrade --target .codex-transcribe-pkgs openai-whisper"
        )
    return whisper


def read_wav(path: Path):
    np = import_numpy()
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())

    if width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise SystemExit(f"Unsupported WAV sample width: {width * 8}-bit")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if rate != SAMPLE_RATE:
        audio = resample_linear(audio, rate, SAMPLE_RATE)

    return audio.astype(np.float32)


def resample_linear(audio, source_rate: int, target_rate: int):
    np = import_numpy()
    if source_rate == target_rate or audio.size == 0:
        return audio
    duration = audio.shape[0] / float(source_rate)
    target_count = max(1, int(round(duration * target_rate)))
    source_x = np.linspace(0.0, duration, num=audio.shape[0], endpoint=False)
    target_x = np.linspace(0.0, duration, num=target_count, endpoint=False)
    return np.interp(target_x, source_x, audio).astype(np.float32)


def load_audio_file(path: Path):
    if not path.exists():
        raise SystemExit(f"Audio file not found: {path}")

    if path.suffix.lower() == ".wav":
        return read_wav(path)

    whisper = import_whisper()
    try:
        return whisper.load_audio(str(path))
    except Exception as exc:
        raise SystemExit(
            f"Could not decode {path.name}. WAV works without extra tools; MP3/M4A "
            "usually needs ffmpeg available on PATH."
        ) from exc


def record_until_silence(
    *,
    max_seconds: float,
    start_threshold: float,
    silence_ms: int,
    idle_timeout: float,
    min_seconds: float,
    pre_roll_ms: int,
    stop_file: Path | None,
    no_silence_stop: bool,
):
    np = import_numpy()
    try:
        import sounddevice as sd
    except ImportError as exc:
        raise SystemExit(
            "Missing sounddevice. Run `python -m pip install sounddevice` or install "
            "Terminal Talk wake-word dependencies."
        ) from exc

    chunks: list = []
    pre_roll = deque(maxlen=max(1, math.ceil(pre_roll_ms / 80)))
    events: queue.Queue = queue.Queue()
    silence_chunks_needed = max(1, math.ceil(silence_ms / 80))
    silence_run = 0
    saw_voice = False
    start_time = time.monotonic()
    voice_start_time = 0.0

    def callback(indata, frames, time_info, status):
        del frames, time_info
        if status:
            print(f"audio status: {status}", file=sys.stderr)
        mono = indata[:, 0].copy()
        events.put(mono)

    if stop_file:
        print("Recording. Speak now; stopping when the hotkey is released.", file=sys.stderr, flush=True)
    else:
        print("Recording. Speak now; stopping after silence.", file=sys.stderr, flush=True)
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=CHUNK_SAMPLES,
        callback=callback,
    ):
        while True:
            now = time.monotonic()
            stop_requested = bool(stop_file and stop_file.exists())
            if stop_requested and saw_voice and (now - voice_start_time) >= min_seconds:
                break
            if stop_requested and not saw_voice and (now - start_time) >= min_seconds:
                break
            if now - start_time >= max_seconds:
                break
            if not saw_voice and now - start_time >= idle_timeout:
                break

            try:
                chunk = events.get(timeout=0.2)
            except queue.Empty:
                continue

            rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
            if not saw_voice:
                pre_roll.append(chunk)
                if rms >= start_threshold:
                    saw_voice = True
                    voice_start_time = now
                    chunks.extend(pre_roll)
                    pre_roll.clear()
                    silence_run = 0
                continue

            chunks.append(chunk)
            if rms >= start_threshold:
                silence_run = 0
            else:
                silence_run += 1

            recorded_after_voice = now - voice_start_time
            if (not no_silence_stop) and recorded_after_voice >= min_seconds and silence_run >= silence_chunks_needed:
                break

    if not chunks:
        raise SystemExit("No speech detected.")

    audio = np.concatenate(chunks).astype(np.float32)
    print(f"Captured {audio.shape[0] / SAMPLE_RATE:.1f}s.", file=sys.stderr, flush=True)
    return audio


def write_wav(path: Path, audio) -> None:
    np = import_numpy()
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())


def transcribe(audio, *, model_name: str, model_dir: Path, language: str):
    whisper = import_whisper()
    model = whisper.load_model(model_name, download_root=str(model_dir))
    kwargs = {
        "language": language,
        "fp16": False,
        "verbose": False,
        "temperature": 0,
    }
    try:
        result = whisper.transcribe(model, audio, word_timestamps=True, **kwargs)
    except TypeError:
        result = whisper.transcribe(model, audio, **kwargs)
    return format_whisper_result(result), result


def format_whisper_result(result: dict) -> str:
    word_text = format_whisper_words(result)
    if word_text:
        return word_text
    segments = result.get("segments") or []
    if not segments:
        return clean_text(result.get("text", ""))
    parts: list[str] = []
    last_end = None
    for segment in segments:
        text = clean_text(segment.get("text", ""))
        if not text:
            continue
        start = float(segment.get("start") or 0.0)
        if last_end is not None:
            gap = start - last_end
            if gap >= PARAGRAPH_GAP_SECONDS:
                parts.append("\n\n")
            elif gap >= SOFT_GAP_SECONDS:
                parts.append(" ")
        parts.append(text)
        last_end = float(segment.get("end") or start)
    return collapse_space_preserving_lines("".join(parts))


def iter_whisper_words(result: dict):
    for segment in result.get("segments") or []:
        for word in segment.get("words") or []:
            text = clean_text(str(word.get("word") or ""))
            if not text:
                continue
            start = float(word.get("start") or segment.get("start") or 0.0)
            end = float(word.get("end") or start)
            yield text, start, end


def format_whisper_words(result: dict) -> str:
    parts: list[str] = []
    last_end = None
    for text, start, end in iter_whisper_words(result):
        if last_end is not None:
            gap = start - last_end
            parts.append("\n\n" if gap >= PARAGRAPH_GAP_SECONDS else " ")
        parts.append(text)
        last_end = end
    return collapse_space_preserving_lines("".join(parts))


def build_timing_metadata(result: dict, formatted_text: str, cleaned_text: str) -> dict:
    segments_out = []
    last_segment_end = None
    for index, segment in enumerate(result.get("segments") or []):
        start = float(segment.get("start") or 0.0)
        end = float(segment.get("end") or start)
        gap = None if last_segment_end is None else round(start - last_segment_end, 3)
        segments_out.append({
            "index": index,
            "start": round(start, 3),
            "end": round(end, 3),
            "gap_before": gap,
            "text": clean_text(segment.get("text", "")),
        })
        last_segment_end = end

    word_pauses = []
    last_word = None
    last_word_end = None
    for text, start, end in iter_whisper_words(result):
        if last_word_end is not None:
            gap = start - last_word_end
            if gap >= SOFT_GAP_SECONDS:
                word_pauses.append({
                    "gap": round(gap, 3),
                    "break": "paragraph" if gap >= PARAGRAPH_GAP_SECONDS else "pause",
                    "after": last_word,
                    "before": text,
                    "time": round(start, 3),
                })
        last_word = text
        last_word_end = end

    return {
        "soft_gap_seconds": SOFT_GAP_SECONDS,
        "paragraph_gap_seconds": PARAGRAPH_GAP_SECONDS,
        "raw_text": clean_text(result.get("text", "")),
        "formatted_text": formatted_text,
        "cleaned_text": cleaned_text,
        "segments": segments_out,
        "word_pauses": word_pauses,
    }


def write_timing_metadata(path: Path, result: dict, formatted_text: str, cleaned_text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_timing_metadata(result, formatted_text, cleaned_text)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def clean_text(text: str) -> str:
    return " ".join(text.replace("\r", "\n").split()).strip()


def apply_backtrack_commands(text: str) -> str:
    command = re.search(r"(?i)\b(?:scratch that|delete that|ignore that|backtrack)\b", text)
    while command:
        prefix = text[: command.start()].rstrip()
        suffix = text[command.end() :].lstrip(" ,.;:-")
        cut_at = max(prefix.rfind("."), prefix.rfind("?"), prefix.rfind("!"), prefix.rfind("\n"))
        if cut_at >= 0:
            text = (prefix[: cut_at + 1] + " " + suffix).strip()
        else:
            text = suffix.strip()
        command = re.search(r"(?i)\b(?:scratch that|delete that|ignore that|backtrack)\b", text)
    return text


def apply_speech_commands(text: str) -> str:
    for pattern, replacement in SPEECH_COMMANDS:
        text = pattern.sub(replacement, text)
    return text


def repair_common_dictation_errors(text: str) -> str:
    repairs = [
        (re.compile(r"(?i)\b(then|now|so|and|but|because|it|this|that|there|here)um\b"), r"\1"),
        (re.compile(r"(?i)\bium\b"), "I"),
        (re.compile(r"(?i)\biti\s+(suppose|think|would|can|should|will)\b"), r"it. I \1"),
        (re.compile(r"(?i)\bpassso\b"), "pass, so"),
        (re.compile(r"(?i)\bnowlooking\b"), "now looking"),
        (re.compile(r"(?i)\bjust one second(?:\s+just one second)+\b"), "just one second"),
    ]
    for pattern, replacement in repairs:
        text = pattern.sub(replacement, text)
    return re.sub(r"(?i)\bi(?='(?:m|ve|ll|d|re|s)\b|\b)", "I", text)


def normalize_key_phrases(text: str) -> str:
    key = r"(?:control|ctrl|shift|alt|option|command|cmd|win|windows|space|enter|return|tab|escape|esc|delete|backspace|f\d{1,2}|[a-z])"
    phrase = re.compile(rf"(?i)\b{key}(?:\s+(?:plus|\+)\s+{key})+\b")
    names = {
        "control": "Ctrl", "ctrl": "Ctrl", "shift": "Shift", "alt": "Alt",
        "option": "Option", "command": "Cmd", "cmd": "Cmd", "win": "Win",
        "windows": "Win", "space": "Space", "enter": "Enter", "return": "Enter",
        "tab": "Tab", "escape": "Esc", "esc": "Esc", "delete": "Delete",
        "backspace": "Backspace",
    }

    def repl(match: re.Match) -> str:
        tokens = re.split(r"\s+(?:plus|\+)\s+", match.group(0), flags=re.I)
        out = []
        for token in tokens:
            t = token.strip().lower()
            out.append(names.get(t, t.upper() if re.fullmatch(r"f\d{1,2}|[a-z]", t) else token.strip()))
        return "+".join(out)

    return phrase.sub(repl, text)


def apply_quote_patterns(text: str) -> str:
    said = re.compile(
        r"(?i)\b(i|he|she|they|you|we)\s+said\s+([a-z][^.!?\n]{1,70}?)"
        r"(?=([.!?])|\s+(?:and\s+then\s+)?(?:i|he|she|they|you|we)\s+said\b|\s+(?:and|but|or|when|because)\b|$)"
    )

    def repl(match: re.Match) -> str:
        prefix = text[max(0, match.start() - 12):match.start()].lower()
        if re.search(r"\b(?:what|as)\s+$", prefix):
            return match.group(0)
        speaker = match.group(1)
        quote = match.group(2).strip(" ,")
        if not quote:
            return match.group(0)
        quote = quote[0].upper() + quote[1:]
        if not re.search(r"[.!?]$", quote):
            quote += "."
        return f'{speaker} said, "{quote}"'

    return said.sub(repl, text)


def split_long_paragraphs(text: str, max_chars: int = 360) -> str:
    paragraphs = text.split("\n\n")
    out: list[str] = []
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if len(paragraph) <= max_chars:
            out.append(paragraph)
            continue
        sentences = re.findall(r"[^.!?\n]+[.!?\"']*|[^.!?\n]+$", paragraph)
        bucket = ""
        for sentence in [s.strip() for s in sentences if s.strip()]:
            if bucket and len(bucket) + len(sentence) > max_chars:
                out.append(bucket.strip())
                bucket = sentence
            else:
                bucket = f"{bucket} {sentence}".strip()
        if bucket:
            out.append(bucket.strip())
    return "\n\n".join(out)


def collapse_space_preserving_lines(text: str) -> str:
    text = text.replace("\ufeff", "").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"\s+([,.;:?!])", r"\1", text)
    text = re.sub(r"([,.;:?!])(?=[A-Za-z0-9])", r"\1 ", text)
    text = re.sub(r"([.!?])\s+([a-z])", lambda m: f"{m.group(1)} {m.group(2).upper()}", text)
    text = re.sub(r"\n-\s*", "\n- ", text)
    return text.strip(" \t\n")


def sentence_case(text: str) -> str:
    chars = list(text)
    should_cap = True
    for i, ch in enumerate(chars):
        if ch.isalpha():
            if should_cap:
                chars[i] = ch.upper()
            should_cap = False
        elif ch in ".!?\n":
            should_cap = True
        elif ch not in " \t\"'([{":
            should_cap = False
    return "".join(chars)


def local_cleanup(text: str) -> str:
    text = collapse_space_preserving_lines(text)
    text = apply_backtrack_commands(text)
    text = apply_speech_commands(text)
    text = repair_common_dictation_errors(text)
    text = FILLER_PATTERN.sub("", text)
    text = STARTER_PATTERN.sub("", text)
    text = re.sub(r"(?i)\b(\w{2,})(?:\s+\1\b){1,2}", r"\1", text)
    text = re.sub(r"(?i)\band\s+but\b", "but", text)
    text = normalize_key_phrases(text)
    for pattern, replacement in WORD_FIXES:
        text = pattern.sub(replacement, text)
    text = apply_quote_patterns(text)
    text = re.sub(r'([.!?])"\s*[.!?]', r'\1"', text)
    text = collapse_space_preserving_lines(text)
    if text and not re.search(r"[.!?\"']$", text) and "\n- " not in text:
        text += "."
    return split_long_paragraphs(sentence_case(collapse_space_preserving_lines(text)))


def extract_openai_output_text(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    chunks: list[str] = []
    for item in payload.get("output", []) or []:
        for content in item.get("content", []) or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text:
                chunks.append(text)
    return "\n".join(chunks).strip()


def openai_cleanup(text: str, *, model: str, timeout: float) -> str:
    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    body = {
        "model": model,
        "instructions": OPENAI_CLEANUP_INSTRUCTIONS,
        "input": text,
        "max_output_tokens": 1200,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        response_body = response.read().decode("utf-8")
    cleaned = extract_openai_output_text(json.loads(response_body))
    if not cleaned:
        raise RuntimeError("OpenAI cleanup returned no text")
    return collapse_space_preserving_lines(cleaned)


def cleanup_transcript(
    text: str,
    *,
    cleanup: str,
    cleanup_provider: str,
    cleanup_model: str,
    cleanup_timeout: float,
) -> str:
    if cleanup == "off":
        return clean_text(text)

    local = local_cleanup(text)
    if cleanup_provider != "openai":
        return local

    try:
        cleaned = openai_cleanup(local, model=cleanup_model, timeout=cleanup_timeout)
        if cleaned and len(cleaned) >= max(3, len(local) * 0.2):
            return cleaned
    except (RuntimeError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"OpenAI dictation cleanup unavailable; using local cleanup: {exc}", file=sys.stderr, flush=True)
    return local


def copy_to_clipboard(text: str) -> None:
    if not text:
        return
    if os.name == "nt":
        subprocess.run("clip", input=text, text=True, check=False)
        return
    if sys.platform == "darwin":
        subprocess.run("pbcopy", input=text, text=True, check=False)
        return
    for cmd in ("wl-copy", "xclip"):
        with contextlib.suppress(FileNotFoundError):
            subprocess.run(cmd, input=text, text=True, check=False)
            return


def paste_into_active_app(*, press_enter: bool) -> None:
    if sys.platform == "darwin":
        subprocess.run(
            ["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'],
            check=False,
        )
        if press_enter:
            time.sleep(0.08)
            subprocess.run(
                ["osascript", "-e", 'tell application "System Events" to key code 36'],
                check=False,
            )
        return
    if os.name == "nt":
        return
    with contextlib.suppress(FileNotFoundError):
        subprocess.run(["xdotool", "key", "ctrl+v"], check=False)
        if press_enter:
            time.sleep(0.08)
            subprocess.run(["xdotool", "key", "Return"], check=False)


def strip_terminal_dictation_commands(text: str) -> tuple[str, bool]:
    press_enter = False
    enter_pattern = re.compile(r"(?is)\s*(?:press\s+enter|send\s+it|submit\s+that)[.!?]*\s*$")
    stop_pattern = re.compile(r"(?is)\s*(?:hey\s+jarvis\s+)?(?:dictation\s+stop|stop\s+dictation|finish\s+dictation)[.!?]*\s*$")
    if enter_pattern.search(text):
        press_enter = True
        text = enter_pattern.sub("", text).strip()
    text = stop_pattern.sub("", text).strip()
    return text, press_enter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local Whisper transcription")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", type=Path, help="Audio file to transcribe")
    source.add_argument("--record", action="store_true", help="Record from the default microphone")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--model-dir", type=Path, default=repo_root() / ".codex-transcribe-cache")
    parser.add_argument("--language", default="en")
    parser.add_argument("--copy", action="store_true", help="Copy transcript to clipboard")
    parser.add_argument("--paste", action="store_true", help="Paste transcript into the active app after copying")
    parser.add_argument("--json", action="store_true", help="Emit a compact JSON status object")
    parser.add_argument("--out", type=Path, help="Write transcript to this file")
    parser.add_argument("--keep-wav", type=Path, help="When recording, save the captured WAV here")
    parser.add_argument("--segments-out", type=Path, help="Write Whisper timing metadata to this JSON file")
    parser.add_argument("--stop-file", type=Path, help="Stop recording when this file appears")
    parser.add_argument("--no-silence-stop", action="store_true", help="Only stop recording on stop-file or max seconds")
    parser.add_argument("--cleanup", choices=("off", "local", "smart"), default="local")
    parser.add_argument("--cleanup-provider", choices=("local", "openai"), default="local")
    parser.add_argument("--cleanup-model", default=DEFAULT_CLEANUP_MODEL)
    parser.add_argument("--cleanup-timeout", type=float, default=20.0)
    parser.add_argument("--max-seconds", type=float, default=180.0)
    parser.add_argument("--idle-timeout", type=float, default=10.0)
    parser.add_argument("--min-seconds", type=float, default=0.8)
    parser.add_argument("--silence-ms", type=int, default=900)
    parser.add_argument("--start-threshold", type=float, default=0.006)
    parser.add_argument("--pre-roll-ms", type=int, default=400)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.file:
        audio = load_audio_file(args.file)
    else:
        audio = record_until_silence(
            max_seconds=args.max_seconds,
            start_threshold=args.start_threshold,
            silence_ms=args.silence_ms,
            idle_timeout=args.idle_timeout,
            min_seconds=args.min_seconds,
            pre_roll_ms=args.pre_roll_ms,
            stop_file=args.stop_file,
            no_silence_stop=args.no_silence_stop,
        )
        if args.keep_wav:
            write_wav(args.keep_wav, audio)

    formatted_transcript, timing_result = transcribe(
        audio,
        model_name=args.model,
        model_dir=args.model_dir,
        language=args.language,
    )
    transcript = cleanup_transcript(
        formatted_transcript,
        cleanup=args.cleanup,
        cleanup_provider=args.cleanup_provider,
        cleanup_model=args.cleanup_model,
        cleanup_timeout=args.cleanup_timeout,
    )
    press_enter = False
    if args.paste or args.json:
        transcript, press_enter = strip_terminal_dictation_commands(transcript)
    if args.segments_out:
        write_timing_metadata(args.segments_out, timing_result, formatted_transcript, transcript)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(transcript + "\n", encoding="utf-8")

    if args.copy or args.paste:
        copy_to_clipboard(transcript)
    if args.paste:
        time.sleep(0.15)
        if transcript:
            paste_into_active_app(press_enter=press_enter)

    if args.json:
        print(json.dumps({
            "ok": True,
            "transcript": transcript,
            "path": str(args.out or ""),
            "audio_path": str(args.keep_wav or ""),
            "timing_path": str(args.segments_out or ""),
            "pasted": bool(args.paste),
            "enter_pressed": bool(args.paste and press_enter),
            "copied": bool(args.copy or args.paste),
        }, separators=(",", ":")))
    else:
        print(transcript)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
