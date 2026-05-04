#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

if ! HOME="$tmp/home" \
  XDG_STATE_HOME="$tmp/state" \
  XDG_DATA_HOME="$tmp/data" \
  XDG_CONFIG_HOME="$tmp/config" \
    "$repo_root/install.sh" --unattended > "$tmp/install.log" 2>&1; then
  tail -120 "$tmp/install.log" >&2 || true
  exit 1
fi

python3 - "$tmp" <<'PY'
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
state = root / 'state' / 'terminal-talk'
data = root / 'data' / 'terminal-talk'
config = root / 'config' / 'terminal-talk'

assert (state / 'queue').exists()
assert (state / 'sessions').exists()
assert (data / 'app' / 'node_modules' / 'electron').exists()
assert (data / 'app' / 'posix_hooks.py').exists()
assert (data / 'hooks' / 'speak-response.sh').exists()
assert (data / '.venv' / 'bin' / 'python').exists()
assert (config / 'config.json').exists()
flag = state / 'wake-word-unavailable.flag'
if not flag.exists():
    py = data / '.venv' / 'bin' / 'python'
    subprocess.run(
        [str(py), '-c', 'import openwakeword.model, sounddevice, numpy'],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

print('posix-full-install-smoke-ok')
PY
