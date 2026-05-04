#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: _posix-hook-runner.sh <event>" >&2
  exit 2
fi

event="$1"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$script_dir/../terminal-talk.env"
if [ -f "$env_file" ]; then
  # shellcheck disable=SC1090
  . "$env_file"
fi
explicit_home_source="${TT_HOME:-}${TT_INSTALL_DIR:-}"
case "$(uname -s)" in
  Linux*) default_tt_home="${XDG_STATE_HOME:-"$HOME/.local/state"}/terminal-talk" ;;
  *) default_tt_home="$HOME/.terminal-talk" ;;
esac
tt_home="${TT_HOME:-"${TT_INSTALL_DIR:-"$default_tt_home"}"}"
default_app_dir="$script_dir/../app"
if [ ! -d "$default_app_dir" ]; then
  default_app_dir="${XDG_DATA_HOME:-"$HOME/.local/share"}/terminal-talk/app"
fi
app_dir="${TT_APP_DIR:-"$default_app_dir"}"

if [ ! -f "$app_dir/posix_hooks.py" ]; then
  candidate_app_dir=$(CDPATH= cd -- "$script_dir/../app" 2>/dev/null && pwd || true)
  if [ -n "$candidate_app_dir" ] && [ -f "$candidate_app_dir/posix_hooks.py" ]; then
    app_dir="$candidate_app_dir"
  fi
fi

if [ -n "${TT_PYTHON_EXE:-}" ]; then
  python_exe="$TT_PYTHON_EXE"
elif [ -x "$script_dir/../.venv/bin/python" ]; then
  python_exe="$script_dir/../.venv/bin/python"
elif [ -x "$tt_home/.venv/bin/python" ]; then
  python_exe="$tt_home/.venv/bin/python"
else
  python_exe="python3"
fi
export TT_HOME="$tt_home"
export TT_APP_DIR="$app_dir"
if [ -z "${TT_CONFIG_PATH:-}" ]; then
  if [ -n "$explicit_home_source" ]; then
    export TT_CONFIG_PATH="$tt_home/config.json"
  elif [ "$(uname -s)" = "Linux" ]; then
    export TT_CONFIG_PATH="${XDG_CONFIG_HOME:-"$HOME/.config"}/terminal-talk/config.json"
  fi
fi

exec "$python_exe" "$app_dir/posix_hooks.py" "$event"
