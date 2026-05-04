#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

mkdir -p "$tmp/queue" "$tmp/sessions"
transcript="$tmp/019ddabc-a111-2222-3333-444444444444.jsonl"
printf '%s\n' '{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}' > "$transcript"
payload=$(printf '{"transcript_path":"%s"}' "$transcript")

printf '%s' "$payload" |
  TT_HOME="$tmp" TT_APP_DIR="$repo_root/app" "$repo_root/hooks/mark-working.sh"
test -f "$tmp/sessions/019ddabc-working.flag"

printf '%s' "$payload" |
  TT_HOME="$tmp" TT_APP_DIR="$repo_root/app" "$repo_root/hooks/speak-on-tool.sh"
sleep 1

python3 - "$tmp" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
reg = json.loads((root / 'session-colours.json').read_text(encoding='utf-8'))
entry = reg['assignments']['019ddabc']
assert entry['session_id'].startswith('019ddabc'), entry
assert entry['index'] == 0, entry
assert (root / 'sessions' / '019ddabc-working.flag').exists()
print('posix-hook-smoke-ok')
PY
