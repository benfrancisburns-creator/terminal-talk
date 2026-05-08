'use strict';

// Session launcher — extracted from app/main.js 2026-05-08 (#26 Phase 0
// of the v0.7 housekeeping pass) to bring main.js back under the 2725-
// line absolute file-length ceiling.
//
// Three async entry points, all driven by the renderer's "Create
// session" button via the launchAssistantSession IPC handler:
//
//   launchAssistantSession(payload, ctx)
//     Top-level dispatch. Routes to the macOS / Windows / Claude
//     Desktop branch by payload.kind.
//
//   launchAssistantSessionMac(opts, ctx)
//     macOS-specific: drives Terminal.app via osascript. Opens a new
//     window in the project dir, sets the tab title, exec's claude /
//     codex. No Windows Terminal tab-colour parity (Terminal.app's
//     per-tab colour is profile-tied, not programmable inline) but
//     the toolbar still colours the session correctly the moment the
//     assistant fires its first hook.
//
//   launchClaudeDesktopCodeSession(opts, ctx)
//     Cross-platform: opens a `claude://code/new` deep link via
//     shell.openExternal. Stamps an identity prompt + a launch-intent
//     record so the toolbar can correlate the new Claude Desktop
//     session back to the toolbar's colour swatch.
//
// Factory pattern (matches app/lib/mic-watcher.js + footer-watcher.js):
// caller injects every dependency so this module is pure JS — no
// implicit Electron / fs / process imports inside the factory body.
// Lets the unit harness drive these against a fake spawn / shell.

function createSessionLauncher({
  spawn,
  crypto,
  path,
  fs,
  shell,
  URL: URLCtor,
  diag = () => {},
  powershellExe,
  sanitiseLabel,
  paletteHexForSessionIndex,
  colourNameForIndex,
  colourMarkerForIndex,
  resolveCreateSessionWindowPlacement,
  addClaudeDesktopLaunchIntent,
  getCFG = () => ({}),
  appDir,
} = {}) {
  if (typeof spawn !== 'function') throw new Error('createSessionLauncher: spawn required');
  if (!crypto) throw new Error('createSessionLauncher: crypto required');
  if (!path) throw new Error('createSessionLauncher: path required');
  if (!fs) throw new Error('createSessionLauncher: fs required');
  if (!shell) throw new Error('createSessionLauncher: electron.shell required');
  if (typeof sanitiseLabel !== 'function') throw new Error('createSessionLauncher: sanitiseLabel required');
  if (typeof paletteHexForSessionIndex !== 'function') throw new Error('createSessionLauncher: paletteHexForSessionIndex required');
  if (typeof colourNameForIndex !== 'function') throw new Error('createSessionLauncher: colourNameForIndex required');
  if (typeof colourMarkerForIndex !== 'function') throw new Error('createSessionLauncher: colourMarkerForIndex required');
  if (typeof resolveCreateSessionWindowPlacement !== 'function') throw new Error('createSessionLauncher: resolveCreateSessionWindowPlacement required');
  if (typeof addClaudeDesktopLaunchIntent !== 'function') throw new Error('createSessionLauncher: addClaudeDesktopLaunchIntent required');
  if (!appDir) throw new Error('createSessionLauncher: appDir required');
  const URLImpl = URLCtor || URL;

  // macOS implementation of launchAssistantSession. Drives Terminal.app
  // via osascript: open a new window, cd into the project, set the tab
  // title via the OSC 0 escape sequence, then exec the assistant CLI.
  // We don't try to match Windows Terminal's tab-colour behaviour here
  // — Terminal.app's per-tab colour is tied to profiles, not programm-
  // able inline. The toolbar will still colour the session correctly
  // the moment the assistant fires its first hook (UserPromptSubmit /
  // SessionStart), so the visual identity surfaces in the toolbar
  // even if the terminal tab itself stays default.
  async function launchAssistantSessionMac({ kind, projectDir, title, launchMode, index }) {
    const cmd = kind === 'codex'
      ? 'codex'
      : (launchMode === 'dangerous' ? 'claude --dangerously-skip-permissions' : 'claude');
    // sh-quote: wrap in single quotes, escape any embedded single quote.
    const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    // AppleScript double-quoted string escape: backslash and double quote.
    const apl = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const titleEsc = `printf '\\033]0;%s\\007' ${sh(title)}`;
    const inner = `cd ${sh(projectDir)} && ${titleEsc} && ${cmd}`;
    const ascript = [
      'tell application "Terminal"',
      '  activate',
      `  do script "${apl(inner)}"`,
      'end tell',
    ].join('\n');

    diag(`launch-assistant-session mac: kind=${kind} project=${projectDir} title="${title}" mode=${launchMode}`);

    return await new Promise((resolve, reject) => {
      const child = spawn('osascript', ['-e', ascript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += String(d); });
      child.stderr.on('data', (d) => { stderr += String(d); });
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        reject(new Error('osascript timed out launching Terminal.app'));
      }, 8000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`osascript spawn failed: ${e && e.message}`));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
          diag(`launch-assistant-session mac osascript failed: ${detail}`);
          reject(new Error(`Terminal.app launch failed: ${detail}`));
          return;
        }
        diag(`launch-assistant-session mac: launched ${kind} in ${projectDir}`);
        resolve({ ok: true, kind, title, projectDir, index, pid: child.pid });
      });
    });
  }

  async function launchAssistantSession(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const rawKind = String(p.kind || '').toLowerCase();
    const kind = rawKind === 'claude-desktop' || rawKind === 'claude-desktop-code' ? 'claude-desktop'
      : rawKind === 'claude' || rawKind === 'claude-code' ? 'claude'
      : rawKind === 'codex' ? 'codex'
      : '';
    if (!kind) throw new Error('Choose Codex, Claude Code, or Claude Desktop Code.');

    const projectDir = path.resolve(String(p.projectDir || '').trim());
    if (!projectDir || !fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      throw new Error('Choose an existing project folder.');
    }

    const label = sanitiseLabel(p.label || '');
    const launchMode = String(p.launchMode || 'default').toLowerCase();
    const validLaunchModes = new Set([
      'default',
      'dangerous',
    ]);
    if (!validLaunchModes.has(launchMode)) throw new Error('Choose a valid permission preset.');
    const indexRaw = Number(p.index);
    const index = Number.isFinite(indexRaw) ? Math.max(0, Math.min(23, Math.floor(indexRaw))) : 0;
    if (kind === 'claude-desktop') {
      return await launchClaudeDesktopCodeSession({ projectDir, label, index });
    }

    const launchKind = kind === 'codex' ? 'Codex' : 'Claude';
    const titleBase = kind === 'codex' ? 'Codex TT' : 'Claude TT';
    const title = label ? `${titleBase} - ${label}` : titleBase;

    if (process.platform === 'darwin') {
      return await launchAssistantSessionMac({ kind, projectDir, title, launchMode, index });
    }
    if (process.platform !== 'win32') {
      throw new Error('Toolbar session launch is currently supported on Windows and macOS only.');
    }

    const launcherScript = path.join(appDir, 'assistant-session-launch.ps1');
    if (!fs.existsSync(launcherScript)) throw new Error('Session launcher script is missing.');
    const wtBridgeScript = path.join(appDir, 'assistant-wt-launch.ps1');
    if (!fs.existsSync(wtBridgeScript)) throw new Error('Windows Terminal bridge script is missing.');

    const launchToken = crypto.randomBytes(8).toString('hex');
    // Windows Terminal's parser is fragile when Electron launches a nested
    // command directly. Use the same PowerShell argument-array bridge as the
    // demo launcher that proved reliable on Ben's machine.
    const wtTitle = `${launchKind}TT${launchToken.slice(0, 8)}`;
    const tabColor = `#${paletteHexForSessionIndex(index)}`;
    const cfg = getCFG() || {};
    const windowPlacement = resolveCreateSessionWindowPlacement({
      payload: p,
      panels: cfg.panels,
      kind,
      label,
      index,
    });

    diag(`launch-assistant-session bridge start: kind=${kind} project=${projectDir} title=${wtTitle} tabColor=${tabColor} bounds=${windowPlacement.windowBounds || ''}`);
    const child = spawn(powershellExe, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', wtBridgeScript,
    ], {
      cwd: projectDir,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        TT_CREATE_SESSION_KIND: launchKind,
        TT_CREATE_SESSION_PROJECT_DIR: projectDir,
        TT_CREATE_SESSION_INITIAL_LABEL: label,
        TT_CREATE_SESSION_INITIAL_INDEX: String(index),
        TT_CREATE_SESSION_LAUNCH_TOKEN: launchToken,
        TT_CREATE_SESSION_LAUNCH_MODE: launchMode,
        TT_CREATE_SESSION_WINDOW_TITLE: title,
        TT_CREATE_SESSION_LAUNCHER: launcherScript,
        TT_CREATE_SESSION_WT_TITLE: wtTitle,
        TT_CREATE_SESSION_TAB_COLOR: tabColor,
        ...(windowPlacement.windowPosition ? { TT_CREATE_SESSION_WINDOW_POS: windowPlacement.windowPosition } : {}),
        ...(windowPlacement.windowSize ? { TT_CREATE_SESSION_WINDOW_SIZE: windowPlacement.windowSize } : {}),
        ...(windowPlacement.windowBounds ? { TT_CREATE_SESSION_WINDOW_BOUNDS: windowPlacement.windowBounds } : {}),
      },
    });

    const bridgeResult = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      timer = setTimeout(() => {
        finish({ timedOut: true, stdout, stderr });
      }, 3500);
      child.stdout.on('data', (buf) => { stdout += String(buf); });
      child.stderr.on('data', (buf) => { stderr += String(buf); });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code, signal) => {
        finish({ code, signal, stdout, stderr });
      });
    });

    const stdout = String(bridgeResult.stdout || '').trim();
    const stderr = String(bridgeResult.stderr || '').trim();
    if (stdout) diag(`launch-assistant-session bridge stdout: ${stdout.slice(0, 1000)}`);
    if (stderr) diag(`launch-assistant-session bridge stderr: ${stderr.slice(0, 1000)}`);
    if (!bridgeResult.timedOut && bridgeResult.code !== 0) {
      const detail = stderr || stdout || `bridge exited with code ${bridgeResult.code}`;
      throw new Error(`Windows Terminal launch failed: ${detail}`);
    }
    if (bridgeResult.timedOut) {
      diag('launch-assistant-session bridge still running after 3500ms; assuming Windows Terminal is starting');
    } else {
      diag(`launch-assistant-session bridge exit code=${bridgeResult.code} signal=${bridgeResult.signal || ''}`);
    }
    return { ok: true, kind, title, projectDir, index, pid: child.pid, windowPlacement };
  }

  async function launchClaudeDesktopCodeSession({ projectDir, label, index }) {
    const launchToken = crypto.randomBytes(8).toString('hex');
    const colour = colourNameForIndex(index);
    const marker = colourMarkerForIndex(index);
    const titleLabel = label || path.basename(projectDir) || 'Claude Desktop';
    const identity = `${marker} TT ${colour} · ${titleLabel}`;
    const prompt = [
      `Terminal Talk session identity: ${identity}`,
      '',
      'Use this label as the visible session identity for this Claude Code workspace.',
    ].join('\n');
    const intentResult = addClaudeDesktopLaunchIntent({
      token: launchToken,
      label: titleLabel,
      index,
      projectDir,
      createdAt: Date.now(),
    });
    if (!intentResult.ok) {
      diag(`claude-desktop-code launch intent save failed: ${intentResult.filePath || ''}`);
    }

    const url = new URLImpl('claude://code/new');
    url.searchParams.set('q', prompt);
    url.searchParams.append('folder', projectDir);
    diag(`claude-desktop-code deep link start: project=${projectDir} identity=${identity}`);
    await shell.openExternal(url.toString());
    return {
      ok: true,
      kind: 'claude-desktop',
      title: identity,
      projectDir,
      index,
      launchToken,
      url: url.toString(),
      pendingIntent: intentResult.ok === true,
    };
  }

  return {
    launchAssistantSession,
    launchAssistantSessionMac,
    launchClaudeDesktopCodeSession,
  };
}

module.exports = { createSessionLauncher };
