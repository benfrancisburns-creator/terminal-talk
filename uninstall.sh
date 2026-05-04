#!/usr/bin/env sh
set -eu

os_name=$(uname -s)
case "$os_name" in
  Linux*)
    default_tt_home="${XDG_STATE_HOME:-"$HOME/.local/state"}/terminal-talk"
    default_app_root="${XDG_DATA_HOME:-"$HOME/.local/share"}/terminal-talk"
    default_config_dir="${XDG_CONFIG_HOME:-"$HOME/.config"}/terminal-talk"
    ;;
  *)
    default_tt_home="$HOME/.terminal-talk"
    default_app_root="$default_tt_home"
    default_config_dir="$default_tt_home"
    ;;
esac

if [ -n "${TT_INSTALL_DIR:-}" ]; then
  tt_home="$TT_INSTALL_DIR"
  app_root="${TT_APP_ROOT:-"$TT_INSTALL_DIR"}"
  config_dir="${TT_CONFIG_DIR:-"$TT_INSTALL_DIR"}"
else
  tt_home="${TT_HOME:-"$default_tt_home"}"
  app_root="${TT_APP_ROOT:-"${TT_DATA_DIR:-"$default_app_root"}"}"
  config_dir="${TT_CONFIG_DIR:-"$default_config_dir"}"
fi

hooks_dir="$app_root/hooks"
desktop_entry="${XDG_DATA_HOME:-"$HOME/.local/share"}/applications/terminal-talk.desktop"
autostart_entry="$HOME/.config/autostart/terminal-talk.desktop"
launch_agent="$HOME/Library/LaunchAgents/com.terminal-talk.toolbar.plist"
remove_config=0
unattended=0

for arg in "$@"; do
  case "$arg" in
    --unattended) unattended=1 ;;
    --remove-config) remove_config=1 ;;
    --help|-h)
      cat <<'USAGE'
Usage: ./uninstall.sh [--unattended] [--remove-config]

Removes Terminal Talk POSIX hooks, desktop/autostart entries, and installed app
files. User config is preserved by default; pass --remove-config to delete it.
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
step() { printf '\n>> %s\n' "$*"; }

confirm() {
  prompt="$1"
  default="$2"
  if [ "$unattended" -eq 1 ]; then
    [ "$default" = "Y" ] && return 0 || return 1
  fi
  printf '%s ' "$prompt"
  read ans || ans=""
  ans="${ans:-$default}"
  case "$ans" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

backup_path() {
  path="$1"
  if [ -f "$path" ]; then
    cp "$path" "$path.backup-$(date +%Y%m%d%H%M%S)"
  fi
}

remove_json_hooks() {
  mode="$1"
  path="$2"
  python_exe="${TT_PYTHON_EXE:-python3}"
  "$python_exe" - "$mode" "$path" <<'PY'
import json
import sys
from pathlib import Path

mode = sys.argv[1]
path = Path(sys.argv[2]).expanduser()
if not path.exists():
    raise SystemExit(0)
try:
    data = json.loads(path.read_text(encoding='utf-8'))
except Exception as exc:
    raise SystemExit(f'{path} is not valid JSON: {exc}')
if not isinstance(data, dict) or not isinstance(data.get('hooks'), dict):
    raise SystemExit(0)

events = {
    'claude': ['Stop', 'Notification', 'PreToolUse', 'UserPromptSubmit'],
    'codex': ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
}[mode]
changed = False
hooks = data['hooks']
for event in events:
    items = hooks.get(event)
    if not isinstance(items, list):
        continue
    kept = []
    for item in items:
        try:
            blob = json.dumps(item)
        except Exception:
            blob = ''
        if 'terminal-talk' not in blob:
            kept.append(item)
    if kept:
        if len(kept) != len(items):
            hooks[event] = kept
            changed = True
    else:
        hooks.pop(event, None)
        changed = True
if changed:
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
PY
}

remove_codex_toml_keys() {
  path="$HOME/.codex/config.toml"
  [ -f "$path" ] || return 0
  python_exe="${TT_PYTHON_EXE:-python3}"
  "$python_exe" - "$path" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1]).expanduser()
lines = path.read_text(encoding='utf-8').splitlines()
out = []
section = ''
for line in lines:
    stripped = line.strip()
    if stripped.startswith('[') and stripped.endswith(']'):
        section = stripped[1:-1]
    key = stripped.split('=', 1)[0].strip() if '=' in stripped else ''
    if section == 'features' and key == 'codex_hooks':
        continue
    if section == 'tui' and key == 'terminal_title':
        continue
    out.append(line)
path.write_text('\n'.join(out).strip() + '\n', encoding='utf-8')
PY
}

step "Removing Claude Code hooks"
claude_settings="$HOME/.claude/settings.json"
if [ -f "$claude_settings" ]; then
  backup_path "$claude_settings"
  remove_json_hooks claude "$claude_settings"
  say "   OK  Claude hooks removed or already absent"
else
  say "   !!  ~/.claude/settings.json not found"
fi

step "Removing Codex CLI hooks"
codex_hooks="$HOME/.codex/hooks.json"
if [ -f "$codex_hooks" ]; then
  backup_path "$codex_hooks"
  remove_json_hooks codex "$codex_hooks"
  say "   OK  Codex hooks removed or already absent"
else
  say "   !!  ~/.codex/hooks.json not found"
fi
codex_config="$HOME/.codex/config.toml"
if [ -f "$codex_config" ]; then
  backup_path "$codex_config"
  remove_codex_toml_keys
  say "   OK  Codex TOML Terminal Talk keys removed"
fi

step "Removing desktop/startup entries"
for path in "$desktop_entry" "$autostart_entry" "$launch_agent"; do
  if [ -e "$path" ]; then
    rm -f "$path"
    say "   OK  removed $path"
  fi
done

step "Removing installed app files"
rm -rf "$app_root/app" "$hooks_dir" "$app_root/start-toolbar.sh" "$app_root/terminal-talk.env" "$app_root/.venv"
say "   OK  app files removed from $app_root"

if [ "$remove_config" -eq 1 ] || confirm "Delete Terminal Talk state/config too? [y/N]" N; then
  rm -rf "$tt_home" "$config_dir"
  say "   OK  state/config removed"
else
  say "   OK  preserved state at $tt_home"
  say "   OK  preserved config at $config_dir"
fi

say ""
say "Terminal Talk POSIX uninstall complete."
