#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
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
  # Back-compat/test mode: one root contains app, hooks, config, queue.
  tt_home="$TT_INSTALL_DIR"
  app_root="${TT_APP_ROOT:-"$TT_INSTALL_DIR"}"
  config_dir="${TT_CONFIG_DIR:-"$TT_INSTALL_DIR"}"
else
  tt_home="${TT_HOME:-"$default_tt_home"}"
  app_root="${TT_APP_ROOT:-"${TT_DATA_DIR:-"$default_app_root"}"}"
  config_dir="${TT_CONFIG_DIR:-"$default_config_dir"}"
fi

install_dir="$tt_home"
app_dir="${TT_APP_DIR:-"$app_root/app"}"
hooks_dir="$app_root/hooks"
queue_dir="$tt_home/queue"
sessions_dir="$tt_home/sessions"
config_path="${TT_CONFIG_PATH:-"$config_dir/config.json"}"
python_exe="${TT_PYTHON_EXE:-python3}"

unattended=0
claude_hooks=1
codex_hooks=1
autostart=0
desktop_entry=0
install_python_deps=1
install_npm_deps=1

for arg in "$@"; do
  case "$arg" in
    --unattended) unattended=1 ;;
    --no-claude-hooks) claude_hooks=0 ;;
    --no-codex-hooks) codex_hooks=0 ;;
    --autostart) autostart=1 ;;
    --desktop-entry) desktop_entry=1 ;;
    --skip-python-deps) install_python_deps=0 ;;
    --skip-npm-install) install_npm_deps=0 ;;
    --help|-h)
      cat <<'USAGE'
Usage: ./install.sh [--unattended] [--no-claude-hooks] [--no-codex-hooks]
                    [--desktop-entry] [--autostart]
                    [--skip-python-deps] [--skip-npm-install]

Installs Terminal Talk with Linux XDG defaults:
  state:  ${XDG_STATE_HOME:-$HOME/.local/state}/terminal-talk
  app:    ${XDG_DATA_HOME:-$HOME/.local/share}/terminal-talk
  config: ${XDG_CONFIG_HOME:-$HOME/.config}/terminal-talk
Set TT_INSTALL_DIR for the legacy single-directory layout.
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
step() { printf '\n>> %s\n' "$*"; }
shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

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

step "Checking prerequisites"
need node
need npm
need "$python_exe"
node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "${node_major:-0}" -lt 18 ]; then
  echo "Node.js 18+ required; found $(node -v)" >&2
  exit 1
fi
"$python_exe" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit(f'Python 3.10+ required; found {sys.version.split()[0]}')
PY
say "   OK  Node $(node -v)"
say "   OK  Python $("${python_exe}" --version 2>&1)"

step "Preparing Terminal Talk directories"
mkdir -p "$tt_home" "$app_root" "$config_dir" "$queue_dir" "$sessions_dir"
say "   OK  state  $tt_home"
say "   OK  app    $app_root"
say "   OK  config $config_dir"

step "Copying files"
rm -rf "$app_dir" "$hooks_dir"
mkdir -p "$app_dir"
(
  cd "$repo_root/app"
  tar --exclude='./node_modules' --exclude='./__pycache__' --exclude='./*.pyc' -cf - .
) | (
  cd "$app_dir"
  tar -xf -
)
cp -R "$repo_root/hooks" "$hooks_dir"
cp "$repo_root/scripts/start-toolbar.sh" "$app_root/start-toolbar.sh"
chmod +x "$app_root/start-toolbar.sh" "$hooks_dir"/*.sh
if [ ! -f "$config_path" ]; then
  cp "$repo_root/config.example.json" "$config_path"
  say "   OK  config.json created"
else
  say "   OK  config.json already exists, left untouched"
fi

env_path="$app_root/terminal-talk.env"
{
  printf 'TT_HOME=%s\n' "$(shell_quote "$tt_home")"
  printf 'TT_APP_DIR=%s\n' "$(shell_quote "$app_dir")"
  printf 'TT_CONFIG_PATH=%s\n' "$(shell_quote "$config_path")"
} > "$env_path"
chmod 600 "$env_path"
say "   OK  environment file written"

if [ "$install_python_deps" -eq 1 ]; then
  step "Python environment"
  "$python_exe" -m venv "$app_root/.venv"
  "$app_root/.venv/bin/python" -m pip install --upgrade pip
  "$app_root/.venv/bin/python" -m pip install -r "$repo_root/requirements-core.txt"
  if "$app_root/.venv/bin/python" -m pip install -r "$repo_root/requirements-wakeword.txt"; then
    rm -f "$tt_home/wake-word-unavailable.flag"
    say "   OK  wake-word deps installed"
  else
    printf '%s\n' "Optional wake-word dependencies could not be installed for this Python/OS." \
      > "$tt_home/wake-word-unavailable.flag"
    say "   !!  Wake-word deps unavailable; toolbar/TTS install will continue"
  fi
  export TT_PYTHON_EXE="$app_root/.venv/bin/python"
  printf 'TT_PYTHON_EXE=%s\n' "$(shell_quote "$TT_PYTHON_EXE")" >> "$env_path"
  say "   OK  Python core deps installed in $app_root/.venv"
else
  export TT_PYTHON_EXE="$python_exe"
  say "   !!  Skipped Python dependency install"
fi

step "Electron dependencies"
if [ "$install_npm_deps" -eq 1 ]; then
  (cd "$app_dir" && npm install)
  say "   OK  npm install complete"
else
  say "   !!  Skipped npm install"
fi

update_json_hooks() {
  "$TT_PYTHON_EXE" - "$@" <<'PY'
import json, sys
from pathlib import Path

mode = sys.argv[1]
path = Path(sys.argv[2]).expanduser()
hooks_dir = Path(sys.argv[3]).expanduser()
path.parent.mkdir(parents=True, exist_ok=True)
try:
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
except Exception as exc:
    raise SystemExit(f'{path} is not valid JSON: {exc}')
if not isinstance(data, dict):
    data = {}
hooks = data.setdefault('hooks', {})

def group(script, timeout, matcher=''):
    return {'matcher': matcher, 'hooks': [{'type': 'command', 'command': str(hooks_dir / script), 'timeout': timeout}]}

def keep_non_tt(items):
    kept = []
    for item in items if isinstance(items, list) else []:
        try:
            blob = json.dumps(item)
        except Exception:
            blob = ''
        if 'terminal-talk' not in blob:
            kept.append(item)
    return kept

if mode == 'claude':
    mapping = {
        'Stop': group('speak-response.sh', 120),
        'Notification': group('speak-notification.sh', 60),
        'PreToolUse': group('speak-on-tool.sh', 10),
        'UserPromptSubmit': group('mark-working.sh', 10),
    }
elif mode == 'codex':
    mapping = {
        'SessionStart': group('codex-session-start.sh', 10),
        'UserPromptSubmit': group('codex-mark-working.sh', 10),
        'PreToolUse': group('codex-on-tool.sh', 10),
        'PostToolUse': group('codex-post-tool.sh', 10),
        'Stop': group('codex-stop.sh', 10),
    }
else:
    raise SystemExit('unknown hook mode')

for event, entry in mapping.items():
    hooks[event] = keep_non_tt(hooks.get(event, [])) + [entry]
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
PY
}

update_codex_toml() {
  "$TT_PYTHON_EXE" - "$HOME/.codex/config.toml" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1]).expanduser()
path.parent.mkdir(parents=True, exist_ok=True)
lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []

def set_key(lines, section, key, value):
    header = f'[{section}]'
    start = next((i for i, line in enumerate(lines) if line.strip() == header), -1)
    if start < 0:
        lines.extend(['', header, f'{key} = {value}'])
        return lines
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].strip().startswith('[') and lines[i].strip().endswith(']'):
            end = i
            break
    for i in range(start + 1, end):
        if lines[i].split('=', 1)[0].strip() == key:
            lines[i] = f'{key} = {value}'
            return lines
    lines.insert(end, f'{key} = {value}')
    return lines

lines = set_key(lines, 'features', 'codex_hooks', 'true')
lines = set_key(lines, 'tui', 'terminal_title', '[]')
path.write_text('\n'.join(lines).strip() + '\n', encoding='utf-8')
PY
}

write_linux_desktop_entry() {
  desktop_path="$1"
  mkdir -p "$(dirname "$desktop_path")"
  cat > "$desktop_path" <<EOF
[Desktop Entry]
Type=Application
Name=Terminal Talk
Comment=Hands-free voice workflow for Claude Code and Codex
Exec="$app_root/start-toolbar.sh"
Terminal=false
Categories=Utility;Accessibility;
StartupNotify=false
EOF
}

if [ "$claude_hooks" -eq 1 ] && confirm "Register Claude Code hooks? [Y/n]" Y; then
  step "Claude Code hooks"
  update_json_hooks claude "$HOME/.claude/settings.json" "$hooks_dir"
  say "   OK  Claude hooks registered"
fi

if [ "$codex_hooks" -eq 1 ] && confirm "Register Codex CLI hooks? [Y/n]" Y; then
  step "Codex CLI hooks"
  update_json_hooks codex "$HOME/.codex/hooks.json" "$hooks_dir"
  update_codex_toml
  say "   OK  Codex hooks registered"
fi

if [ "$desktop_entry" -eq 1 ]; then
  step "Desktop launcher"
  case "$os_name" in
    Linux*)
      write_linux_desktop_entry "${XDG_DATA_HOME:-"$HOME/.local/share"}/applications/terminal-talk.desktop"
      say "   OK  Linux desktop entry installed"
      ;;
    *) say "   !!  Desktop entry is Linux-only; skipped" ;;
  esac
fi

if [ "$autostart" -eq 1 ]; then
  step "Autostart"
  case "$os_name" in
    Linux*)
      mkdir -p "$HOME/.config/autostart"
      write_linux_desktop_entry "$HOME/.config/autostart/terminal-talk.desktop"
      printf 'X-GNOME-Autostart-enabled=true\n' >> "$HOME/.config/autostart/terminal-talk.desktop"
      say "   OK  Linux autostart entry installed"
      ;;
    Darwin*)
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$HOME/Library/LaunchAgents/com.terminal-talk.toolbar.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.terminal-talk.toolbar</string>
  <key>ProgramArguments</key><array><string>$app_root/start-toolbar.sh</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
      say "   OK  macOS LaunchAgent installed"
      ;;
    *) say "   !!  Unknown OS; skipped autostart" ;;
  esac
fi

say ""
say "Terminal Talk installed."
say "Start it with: $app_root/start-toolbar.sh"
