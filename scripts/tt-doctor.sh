#!/usr/bin/env bash
# tt-doctor — Terminal Talk install + permission + audio + hook triage.
#
# One-shot pass/fail report so a user (or support) can paste the output
# and quickly see which subsystem is broken. Cross-platform-ish: most
# checks work on macOS + Linux; macOS-specific checks are gated by
# uname so a Linux run skips them cleanly.
#
# Usage:
#   bash scripts/tt-doctor.sh           # full report
#   bash scripts/tt-doctor.sh --no-net  # skip network / edge-tts probe (for CI)
#
# Exit code: 0 if all checks pass, 1 if any FAIL marked, 0 if only WARN.
# (CI can branch on exit code; humans read the colourised report.)

set -u  # NOT -e — we want every check to run regardless of prior fails.

NO_NET=0
for arg in "$@"; do
  case "$arg" in
    --no-net|--no-network) NO_NET=1 ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# Colour codes (auto-disable when stdout is not a TTY).
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'
  C_YEL=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_BOLD=$'\033[1m'
else
  C_RESET=""; C_GREEN=""; C_RED=""; C_YEL=""; C_BLUE=""; C_BOLD=""
fi

PASS=0
FAIL=0
WARN=0

ok()    { printf '  %s✓%s %s\n'        "$C_GREEN" "$C_RESET" "$1"; PASS=$((PASS+1)); }
fail()  { printf '  %s✗%s %s\n'        "$C_RED"   "$C_RESET" "$1"; FAIL=$((FAIL+1)); [ $# -ge 2 ] && printf '      → %s\n' "$2"; }
warn()  { printf '  %s!%s %s\n'        "$C_YEL"   "$C_RESET" "$1"; WARN=$((WARN+1)); [ $# -ge 2 ] && printf '      → %s\n' "$2"; }
hdr()   { printf '\n%s%s%s\n'          "$C_BOLD"  "$1"      "$C_RESET"; }

UNAME="$(uname -s)"
IS_MAC=0
[ "$UNAME" = "Darwin" ] && IS_MAC=1

TT_HOME="${TT_HOME:-$HOME/.terminal-talk}"
VENV_PY="$TT_HOME/.venv/bin/python"
QUEUE_DIR="$TT_HOME/queue"

printf '%stt-doctor%s — Terminal Talk install + permission triage\n' "$C_BOLD" "$C_RESET"
printf 'platform: %s · home: %s\n' "$UNAME" "$TT_HOME"

# ------------------------------------------------------------------
hdr "1. Environment"
# ------------------------------------------------------------------
for cmd in node python3 git; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ver="$("$cmd" --version 2>&1 | head -1)"
    ok "$cmd present ($ver)"
  else
    fail "$cmd not found in PATH" "install via Homebrew (mac) or your distro pkg manager"
  fi
done
if command -v brew >/dev/null 2>&1; then
  ok "brew present ($(brew --version | head -1))"
else
  [ $IS_MAC -eq 1 ] && warn "brew not found — Mac install path expects Homebrew" \
                        "see https://brew.sh"
fi

# ------------------------------------------------------------------
hdr "2. Terminal Talk venv + Python deps"
# ------------------------------------------------------------------
if [ -x "$VENV_PY" ]; then
  ok "venv python at $VENV_PY"
  if "$VENV_PY" --version >/dev/null 2>&1; then
    ok "venv python runs ($("$VENV_PY" --version 2>&1))"
  else
    fail "venv python won't execute" "venv may be corrupt — re-run install.sh"
  fi
  for mod in edge_tts sounddevice openwakeword numpy; do
    if "$VENV_PY" -c "import $mod" >/dev/null 2>&1; then
      ok "import $mod"
    else
      fail "import $mod failed" "re-run install.sh to re-install requirements*.txt"
    fi
  done
  if [ $IS_MAC -eq 1 ]; then
    for mod in CoreAudio Speech Quartz; do
      if "$VENV_PY" -c "import $mod" >/dev/null 2>&1; then
        ok "import $mod (macOS framework)"
      else
        warn "import $mod failed (macOS framework)" \
             "pip install pyobjc-framework-${mod#Core} (or run install.sh)"
      fi
    done
  fi
else
  fail "venv python missing at $VENV_PY" "run install.sh to create the venv"
fi

# ------------------------------------------------------------------
hdr "3. Hooks"
# ------------------------------------------------------------------
for hook in speak-response.sh speak-notification.sh codex-mark-working.sh codex-on-tool.sh codex-session-start.sh; do
  hpath="$TT_HOME/hooks/$hook"
  if [ -f "$hpath" ]; then
    if [ -x "$hpath" ]; then
      ok "hook $hook (executable)"
    else
      warn "hook $hook present but not executable" "chmod +x $hpath"
    fi
  else
    warn "hook $hook missing" "re-run install.sh to redeploy hooks"
  fi
done

CC_SETTINGS="$HOME/.claude/settings.json"
if [ -f "$CC_SETTINGS" ]; then
  if grep -q "$TT_HOME/hooks" "$CC_SETTINGS"; then
    ok "Claude Code hooks registered (~/.claude/settings.json)"
  else
    warn "~/.claude/settings.json present but no Terminal Talk hooks" \
         "re-run install.sh, or merge hook entries manually"
  fi
else
  warn "~/.claude/settings.json missing" "Claude Code hooks won't fire — install Claude Code first or run install.sh"
fi

CODEX_HOOKS="$HOME/.codex/hooks.json"
if [ -f "$CODEX_HOOKS" ]; then
  if grep -q "$TT_HOME/hooks" "$CODEX_HOOKS"; then
    ok "Codex hooks registered (~/.codex/hooks.json)"
  else
    warn "~/.codex/hooks.json present but no Terminal Talk hooks"
  fi
else
  warn "~/.codex/hooks.json missing" "Codex hooks won't fire — install Codex CLI or skip if you don't use it"
fi

# ------------------------------------------------------------------
hdr "4. Audio synthesis"
# ------------------------------------------------------------------
TMP_TTS_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t tt-doctor)"
cleanup_tmp() { rm -rf "$TMP_TTS_DIR" 2>/dev/null || true; }
trap cleanup_tmp EXIT

if [ $IS_MAC -eq 1 ] && command -v say >/dev/null 2>&1; then
  if say -o "$TMP_TTS_DIR/test.aiff" "test" 2>/dev/null && [ -s "$TMP_TTS_DIR/test.aiff" ]; then
    sz=$(wc -c < "$TMP_TTS_DIR/test.aiff" 2>/dev/null | tr -d ' ')
    ok "say(1) local TTS works (${sz} bytes)"
  else
    warn "say(1) ran but produced no audio file"
  fi
fi

if [ "$NO_NET" -eq 1 ]; then
  warn "edge-tts probe skipped (--no-net)"
elif [ -x "$VENV_PY" ]; then
  if "$VENV_PY" -c "
import asyncio, edge_tts, sys
async def go():
    com = edge_tts.Communicate('test', 'en-GB-SoniaNeural')
    await com.save('$TMP_TTS_DIR/edge.mp3')
asyncio.run(go())
" >/dev/null 2>&1 && [ -s "$TMP_TTS_DIR/edge.mp3" ]; then
    sz=$(wc -c < "$TMP_TTS_DIR/edge.mp3" 2>/dev/null | tr -d ' ')
    ok "edge-tts cloud synthesis (${sz} bytes)"
  else
    warn "edge-tts synthesis failed" "could be offline / DNS / firewalled"
  fi
fi

# ------------------------------------------------------------------
hdr "5. macOS permissions (TCC)"
# ------------------------------------------------------------------
if [ $IS_MAC -eq 1 ]; then
  TCC_USER_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
  if [ -r "$TCC_USER_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
    for service_pretty in "Accessibility:kTCCServiceAccessibility" \
                          "Microphone:kTCCServiceMicrophone" \
                          "Speech Recognition:kTCCServiceSpeechRecognition"; do
      label="${service_pretty%%:*}"
      service="${service_pretty##*:}"
      hits="$(sqlite3 "$TCC_USER_DB" "SELECT COUNT(*) FROM access WHERE service='$service' AND auth_value=2;" 2>/dev/null || echo "0")"
      if [ "${hits:-0}" -gt 0 ]; then
        ok "$label permission: at least one app granted"
      else
        warn "$label permission: nothing granted yet" \
             "open System Settings → Privacy & Security → $label and grant Terminal / Electron"
      fi
    done
  else
    warn "TCC.db not readable from this account — can't introspect permissions" \
         "Full Disk Access is needed to read TCC.db; this is normal in restricted shells"
  fi
fi

# ------------------------------------------------------------------
hdr "6. Toolbar process"
# ------------------------------------------------------------------
TOOLBAR_PIDS="$(pgrep -fl 'Electron.*terminal-talk\|Terminal Talk' 2>/dev/null | grep -v grep || true)"
if [ -n "$TOOLBAR_PIDS" ]; then
  count=$(echo "$TOOLBAR_PIDS" | wc -l | tr -d ' ')
  ok "toolbar running ($count process(es))"
else
  warn "toolbar not running" "start with: bash $TT_HOME/scripts/start-toolbar.sh"
fi

LISTENER_PIDS="$(pgrep -fl 'wake-word-listener.py' 2>/dev/null | grep -v grep || true)"
if [ -n "$LISTENER_PIDS" ]; then
  ok "wake-word listener running"
else
  warn "wake-word listener not running" "toolbar should auto-start it; check listening toggle"
fi

# ------------------------------------------------------------------
hdr "7. Recent errors (last 10 lines per log)"
# ------------------------------------------------------------------
for log in "$QUEUE_DIR/_hook.log" "$QUEUE_DIR/_voice.log" "$QUEUE_DIR/_toolbar.log"; do
  if [ -f "$log" ]; then
    err_lines="$(grep -iE '\b(error|fatal|failed|traceback)\b' "$log" 2>/dev/null | tail -5 || true)"
    if [ -n "$err_lines" ]; then
      printf '  %s!%s recent errors in %s:\n' "$C_YEL" "$C_RESET" "$(basename "$log")"
      WARN=$((WARN+1))
      printf '%s\n' "$err_lines" | sed 's/^/      /'
    else
      ok "no recent errors in $(basename "$log")"
    fi
  else
    warn "$(basename "$log") missing — toolbar may have never run"
  fi
done

# ------------------------------------------------------------------
hdr "Summary"
# ------------------------------------------------------------------
printf '  %s%d passed%s, %s%d warnings%s, %s%d failures%s\n' \
  "$C_GREEN" "$PASS" "$C_RESET" \
  "$C_YEL"   "$WARN" "$C_RESET" \
  "$C_RED"   "$FAIL" "$C_RESET"

if [ "$FAIL" -gt 0 ]; then
  printf '\n%sExit 1 — %d failure(s) above need attention.%s\n' "$C_RED" "$FAIL" "$C_RESET"
  exit 1
fi
exit 0
