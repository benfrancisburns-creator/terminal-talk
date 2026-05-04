#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

HOME="$tmp/home" \
TT_INSTALL_DIR="$tmp/tt" \
  "$repo_root/install.sh" --unattended --skip-python-deps --skip-npm-install >/tmp/tt-install-smoke.log

python3 - "$tmp" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
home = root / 'home'
tt = root / 'tt'

assert (tt / 'app' / 'posix_hooks.py').exists()
assert (tt / 'hooks' / 'speak-response.sh').exists()
assert (tt / 'start-toolbar.sh').exists()
assert (tt / 'terminal-talk.env').exists()

claude = json.loads((home / '.claude' / 'settings.json').read_text(encoding='utf-8'))
codex = json.loads((home / '.codex' / 'hooks.json').read_text(encoding='utf-8'))

for event in ['Stop', 'Notification', 'PreToolUse', 'UserPromptSubmit']:
    assert event in claude.get('hooks', {}), event
for event in ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']:
    assert event in codex.get('hooks', {}), event

config = (home / '.codex' / 'config.toml').read_text(encoding='utf-8')
assert 'codex_hooks = true' in config
assert 'terminal_title = []' in config

print('posix-install-smoke-ok')
PY

HOME="$tmp/home-xdg" \
XDG_STATE_HOME="$tmp/xdg-state" \
XDG_DATA_HOME="$tmp/xdg-data" \
XDG_CONFIG_HOME="$tmp/xdg-config" \
  "$repo_root/install.sh" --unattended --skip-python-deps --skip-npm-install >/tmp/tt-install-xdg-smoke.log

python3 - "$tmp" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
state = root / 'xdg-state' / 'terminal-talk'
data = root / 'xdg-data' / 'terminal-talk'
config = root / 'xdg-config' / 'terminal-talk'

assert (state / 'queue').exists()
assert (state / 'sessions').exists()
assert (data / 'app' / 'posix_hooks.py').exists()
assert (data / 'hooks' / 'speak-response.sh').exists()
assert (data / 'start-toolbar.sh').exists()
env = (data / 'terminal-talk.env').read_text(encoding='utf-8')
assert str(state) in env, env
assert str(config / 'config.json') in env, env
assert (config / 'config.json').exists()

print('posix-xdg-install-smoke-ok')
PY
