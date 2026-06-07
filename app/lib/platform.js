'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveWindowsPythonExe({ env, homedir, pathMod, fsMod = fs }) {
  const localAppData = env.LOCALAPPDATA || pathMod.join(homedir, 'AppData', 'Local');
  const root = pathMod.join(localAppData, 'Python');
  try {
    const versioned = (entry) => {
      const match = entry.isDirectory && entry.isDirectory() && /^pythoncore-(\d+)\.(\d+)-(\d+)$/i.exec(entry.name);
      const exe = match && pathMod.join(root, entry.name, 'python.exe');
      return exe && fsMod.existsSync(exe) ? { exe, version: match.slice(1).map(Number) } : null;
    };
    const candidates = fsMod.readdirSync(root, { withFileTypes: true })
      .map(versioned)
      .filter(Boolean)
      .sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2]);
    if (candidates.length) return candidates[0].exe;
  } catch {}
  return 'python';
}

function createPlatform(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const homedir = opts.homedir || os.homedir();
  const pathMod = opts.path || path;
  const fsMod = opts.fs || fs;

  const isWindows = platform === 'win32';
  const isMac = platform === 'darwin';
  const isLinux = platform === 'linux';

  const legacyHome = pathMod.join(homedir, '.terminal-talk');
  const xdgConfigHome = env.XDG_CONFIG_HOME || pathMod.join(homedir, '.config');
  const xdgStateHome = env.XDG_STATE_HOME || pathMod.join(homedir, '.local', 'state');
  const xdgDataHome = env.XDG_DATA_HOME || pathMod.join(homedir, '.local', 'share');

  const hasExplicitHome = !!(env.TT_HOME || env.TT_INSTALL_DIR);
  const installDir = env.TT_HOME || env.TT_INSTALL_DIR || (
    isLinux ? pathMod.join(xdgStateHome, 'terminal-talk') : legacyHome
  );
  const configDir = env.TT_CONFIG_DIR || (
    isLinux && !hasExplicitHome ? pathMod.join(xdgConfigHome, 'terminal-talk') : installDir
  );
  const dataDir = env.TT_DATA_DIR || (
    isLinux && !hasExplicitHome ? pathMod.join(xdgDataHome, 'terminal-talk') : installDir
  );
  const appDir = env.TT_APP_DIR || pathMod.join(dataDir, 'app');
  const configPath = env.TT_CONFIG_PATH || pathMod.join(configDir, 'config.json');
  const systemRoot = env.SystemRoot || 'C:\\Windows';
  const system32 = isWindows ? pathMod.join(systemRoot, 'System32') : '';

  const pythonExe = env.TT_PYTHON_EXE || env.PYTHON || (
    isWindows ? resolveWindowsPythonExe({ env, homedir, pathMod, fsMod }) : 'python3'
  );
  const powershellExe = env.TT_POWERSHELL_EXE || (
    isWindows
      ? pathMod.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'pwsh'
  );
  const taskkillExe = isWindows ? pathMod.join(system32, 'taskkill.exe') : '';

  return {
    platform,
    isWindows,
    isMac,
    isLinux,
    installDir,
    configDir,
    dataDir,
    appDir,
    configPath,
    pythonExe,
    powershellExe,
    taskkillExe,
    hookShell: isWindows ? 'powershell' : 'posix',
    supportsWindowsMicWatcher: isWindows,
    supportsMacMicWatcher: isMac,
    supportsCodexRolloutWatcher: true,
    supportsCodexIdentitySync: isWindows,
    supportsWindowsTerminalTabColor: isWindows,
    supportsWindowsFooterWatcher: isWindows,
    supportsPosixFooterClip: !isWindows,
    supportsMacTerminalFooterScrape: isMac,
    // Main-process footer watcher is Windows-only because it scrapes
    // Windows Terminal via UIA. POSIX footer clips are generated inside
    // synth_turn.py; macOS can also scrape Terminal.app/iTerm2 there.
    supportsFooterScrape: isWindows,
  };
}

module.exports = {
  ...createPlatform(),
  createPlatform,
  resolveWindowsPythonExe,
};
