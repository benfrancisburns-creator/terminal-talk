#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

HOME="$tmp/home" \
TT_INSTALL_DIR="$tmp/tt" \
  "$repo_root/install.sh" --unattended --desktop-entry --autostart --skip-python-deps --skip-npm-install >/tmp/tt-install-uninstall-smoke.log

HOME="$tmp/home" \
TT_INSTALL_DIR="$tmp/tt" \
  "$repo_root/uninstall.sh" --unattended >/tmp/tt-uninstall-smoke.log

python3 - "$tmp" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
home = root / 'home'
tt = root / 'tt'

assert not (tt / 'app').exists()
assert not (tt / 'hooks').exists()
assert not (tt / 'start-toolbar.sh').exists()
assert not (tt / 'terminal-talk.env').exists()
assert (tt / 'config.json').exists(), 'config should be preserved by default'

claude = json.loads((home / '.claude' / 'settings.json').read_text(encoding='utf-8'))
codex = json.loads((home / '.codex' / 'hooks.json').read_text(encoding='utf-8'))
for root_obj in (claude, codex):
    assert 'terminal-talk' not in json.dumps(root_obj), root_obj
toml = (home / '.codex' / 'config.toml').read_text(encoding='utf-8')
assert 'codex_hooks' not in toml
assert 'terminal_title' not in toml

print('posix-uninstall-smoke-ok')
PY

HOME="$tmp/home-xdg" \
XDG_STATE_HOME="$tmp/state" \
XDG_DATA_HOME="$tmp/data" \
XDG_CONFIG_HOME="$tmp/config" \
  "$repo_root/install.sh" --unattended --desktop-entry --autostart --skip-python-deps --skip-npm-install >/tmp/tt-install-xdg-uninstall-smoke.log

HOME="$tmp/home-xdg" \
XDG_STATE_HOME="$tmp/state" \
XDG_DATA_HOME="$tmp/data" \
XDG_CONFIG_HOME="$tmp/config" \
  "$repo_root/uninstall.sh" --unattended --remove-config >/tmp/tt-uninstall-xdg-smoke.log

python3 - "$tmp" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
state = root / 'state' / 'terminal-talk'
data = root / 'data' / 'terminal-talk'
config = root / 'config' / 'terminal-talk'
home = root / 'home-xdg'

assert not state.exists()
assert not config.exists()
assert not (data / 'app').exists()
assert not (data / 'hooks').exists()
assert not (data / 'start-toolbar.sh').exists()
assert not (data / 'terminal-talk.env').exists()
assert not (root / 'data' / 'applications' / 'terminal-talk.desktop').exists()
assert not (home / '.config' / 'autostart' / 'terminal-talk.desktop').exists()

print('posix-xdg-uninstall-smoke-ok')
PY
