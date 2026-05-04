'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  candidateClaudeRoots,
  syncClaudeDesktopSessionTitles,
} = require('./claude-desktop-title-sync');
const { syncCodexDesktopThreadNames } = require('./codex-desktop-title-sync');

function cleanText(value, maxLen = 180) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function applyDesktopTitleSyncStatus(assignments, results, nowSec = Math.floor(Date.now() / 1000)) {
  if (!assignments || typeof assignments !== 'object' || !Array.isArray(results)) return false;
  let changed = false;
  const applyDesktopSource = (entry, sourceMeta) => {
    if (!entry || typeof entry !== 'object') return false;
    let did = false;
    const setString = (key, value, maxLen = 240) => {
      const clean = String(value || '').slice(0, maxLen);
      if (!clean || entry[key] === clean) return;
      entry[key] = clean;
      did = true;
    };
    setString('source_kind', 'codex-desktop');
    setString('source_label', 'Codex Desktop');
    setString('source_app', 'Codex');
    setString('adapter', 'desktop-rollout');
    if (sourceMeta && typeof sourceMeta === 'object') {
      setString('source_cwd', sourceMeta.cwd || '', 4096);
      setString('source', sourceMeta.source || '');
      setString('source_originator', sourceMeta.originator || '');
    }
    if (entry.pinned !== true) {
      entry.pinned = true;
      did = true;
    }
    const caps = entry.capabilities && typeof entry.capabilities === 'object' ? { ...entry.capabilities } : {};
    const desiredCaps = {
      auto_register: true,
      tool_events: true,
      response_events: true,
      mcp_speak: false,
      manual_speak_selection: true,
    };
    for (const [key, value] of Object.entries(desiredCaps)) {
      if (caps[key] !== value) {
        caps[key] = value;
        did = true;
      }
    }
    entry.capabilities = caps;
    return did;
  };
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const shortId = String(result.shortId || '').toLowerCase();
    if (!/^[a-f0-9]{8}$/.test(shortId)) continue;
    const entry = assignments[shortId];
    if (!entry || typeof entry !== 'object') continue;
    const threadId = String(result.threadId || '').toLowerCase();
    const entryThread = String(entry.session_id || '').toLowerCase();
    if (threadId && entryThread && entryThread !== threadId) continue;

    const title = cleanText(result.desired, 180);
    const existingStatus = String(entry.codex_desktop_title_status || '');
    const existingTitle = cleanText(entry.codex_desktop_title, 180);
    const status = result.status === 'sync_failed'
      ? 'sync_failed'
      : (title && existingTitle === title && ['live_synced', 'live_unavailable'].includes(existingStatus)
        ? existingStatus
        : 'persisted_pending_refresh');
    const error = ['sync_failed', 'live_unavailable'].includes(status)
      ? cleanText(result.error || entry.codex_desktop_title_error, 180)
      : '';
    const sourceChanged = applyDesktopSource(entry, result.sourceMeta || null);
    const needsWrite = entry.codex_desktop_title_status !== status
      || entry.codex_desktop_title !== title
      || (error ? entry.codex_desktop_title_error !== error : !!entry.codex_desktop_title_error)
      || !Number.isFinite(Number(entry.codex_desktop_title_synced_at))
      || sourceChanged;
    if (!needsWrite) continue;

    entry.codex_desktop_title_status = status;
    if (title) entry.codex_desktop_title = title;
    else delete entry.codex_desktop_title;
    entry.codex_desktop_title_synced_at = nowSec;
    if (error) entry.codex_desktop_title_error = error;
    else delete entry.codex_desktop_title_error;
    changed = true;
  }
  return changed;
}

function applyClaudeDesktopTitleSyncStatus(assignments, results, nowSec = Math.floor(Date.now() / 1000)) {
  if (!assignments || typeof assignments !== 'object' || !Array.isArray(results)) return false;
  let changed = false;
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const shortId = String(result.shortId || '').toLowerCase();
    if (!/^[a-f0-9]{8}$/.test(shortId)) continue;
    const entry = assignments[shortId];
    if (!entry || typeof entry !== 'object') continue;
    const sessionId = String(result.sessionId || '').toLowerCase();
    const entrySession = String(entry.session_id || '').toLowerCase();
    if (sessionId && entrySession && entrySession !== sessionId) continue;

    const title = cleanText(result.desired, 180);
    const existingStatus = String(entry.claude_desktop_title_status || '');
    const existingTitle = cleanText(entry.claude_desktop_title, 180);
    const existingError = cleanText(entry.claude_desktop_title_error, 180);
    const preserveLiveStatus = title && existingTitle === title && ['live_synced', 'live_unavailable'].includes(existingStatus);
    const preserveLiveUnavailableError = title && existingTitle === title && existingError && existingStatus === 'persisted_pending_refresh';
    const status = result.status === 'sync_failed'
      ? 'sync_failed'
      : (preserveLiveStatus ? existingStatus : (preserveLiveUnavailableError ? 'live_unavailable' : 'persisted_pending_refresh'));
    const error = ['sync_failed', 'live_unavailable'].includes(status)
      ? cleanText(result.error || existingError, 180)
      : '';
    const filePath = cleanText(result.filePath, 4096);
    const needsWrite = entry.claude_desktop_title_status !== status
      || entry.claude_desktop_title !== title
      || (filePath && entry.claude_desktop_session_file !== filePath)
      || (error ? entry.claude_desktop_title_error !== error : !!entry.claude_desktop_title_error)
      || !Number.isFinite(Number(entry.claude_desktop_title_synced_at));
    if (!needsWrite) continue;

    entry.claude_desktop_title_status = status;
    if (title) entry.claude_desktop_title = title;
    else delete entry.claude_desktop_title;
    if (filePath) entry.claude_desktop_session_file = filePath;
    entry.claude_desktop_title_synced_at = nowSec;
    if (error) entry.claude_desktop_title_error = error;
    else delete entry.claude_desktop_title_error;
    changed = true;
  }
  return changed;
}

function createCodexIdentitySync(opts = {}) {
  const {
    appDir,
    enabled = true,
    powershellExe,
    testMode = false,
    diag = () => {},
    intervalMs = 60000,
    claudeIntervalMs = 1000,
    loadAssignments = null,
    saveAssignments = null,
    notifyQueue = null,
  } = opts;

  let timer = null;
  let claudeTimer = null;
  let claudeWatchers = [];
  let claudeDebounce = null;
  let running = false;
  let desktopRunning = false;
  let claudeDesktopRunning = false;

  function recordDesktopTitleStatus(result) {
    if (!result || !Array.isArray(result.results) || typeof loadAssignments !== 'function' || typeof saveAssignments !== 'function') return;
    let assignments = {};
    try { assignments = loadAssignments() || {}; } catch { return; }
    if (!applyDesktopTitleSyncStatus(assignments, result.results)) return;
    try {
      const ok = saveAssignments(assignments, 'codex-desktop-title-status');
      if (ok && typeof notifyQueue === 'function') notifyQueue();
    } catch (e) {
      diag(`codex desktop title status save failed: ${e && e.message ? e.message : e}`);
    }
  }

  function recordClaudeDesktopTitleStatus(result) {
    if (!result || !Array.isArray(result.results) || typeof loadAssignments !== 'function' || typeof saveAssignments !== 'function') return;
    let assignments = {};
    try { assignments = loadAssignments() || {}; } catch { return; }
    if (!applyClaudeDesktopTitleSyncStatus(assignments, result.results)) return;
    try {
      const ok = saveAssignments(assignments, 'claude-desktop-title-status');
      if (ok && typeof notifyQueue === 'function') notifyQueue();
    } catch (e) {
      diag(`claude desktop title status save failed: ${e && e.message ? e.message : e}`);
    }
  }

  function syncClaudeDesktopTitles() {
    if (testMode || claudeDesktopRunning || typeof loadAssignments !== 'function') return;
    claudeDesktopRunning = true;
    try {
      const assignments = loadAssignments() || {};
      const result = syncClaudeDesktopSessionTitles({ assignments, autoRegister: true, diag });
      // Auto-fire live UIA rename was removed when CDP was retired —
      // driving Claude Desktop's rename UI on every file change pops a
      // menu in the user's face. Live update now requires the user to
      // click Sync in Settings (sync-claude-desktop-title IPC). The
      // file write below still happens on every change so cold-start
      // (relaunch Claude Desktop) keeps showing the right titles.
      const statusChanged = applyClaudeDesktopTitleSyncStatus(assignments, result.results);
      const changed = result.assignmentsChanged || statusChanged;
      if (changed && typeof saveAssignments === 'function') {
        const ok = saveAssignments(assignments, 'claude-desktop-session-files');
        if (ok && typeof notifyQueue === 'function') notifyQueue();
      }
    } catch (e) {
      diag(`claude desktop title sync failed: ${e && e.message ? e.message : e}`);
    } finally {
      claudeDesktopRunning = false;
    }
  }

  function queueClaudeDesktopSync(delayMs = 75) {
    if (testMode) return;
    if (claudeDebounce) clearTimeout(claudeDebounce);
    claudeDebounce = setTimeout(() => {
      claudeDebounce = null;
      syncClaudeDesktopTitles();
    }, Math.max(0, Number(delayMs) || 0));
    if (typeof claudeDebounce.unref === 'function') claudeDebounce.unref();
  }

  function scheduleClaudeDesktopBurst() {
    // Claude Desktop can create the session JSON first, then write the
    // generated title shortly after. A small burst catches both phases so
    // Terminal Talk can stamp the sidebar identity before the row settles.
    queueClaudeDesktopSync(50);
    for (const delay of [350, 1000, 2500]) {
      const t = setTimeout(syncClaudeDesktopTitles, delay);
      if (typeof t.unref === 'function') t.unref();
    }
  }

  function startClaudeDesktopWatchers() {
    if (testMode || claudeWatchers.length > 0) return;
    let roots = [];
    try { roots = candidateClaudeRoots(); } catch { roots = []; }
    for (const root of roots) {
      const sessionsRoot = path.join(String(root || ''), 'claude-code-sessions');
      if (!sessionsRoot || !fs.existsSync(sessionsRoot)) continue;
      try {
        const watcher = fs.watch(sessionsRoot, { recursive: true }, (_eventType, filename) => {
          if (filename && !/local_[^\\/]+\.json$/i.test(String(filename))) return;
          scheduleClaudeDesktopBurst();
        });
        watcher.on('error', (e) => {
          diag(`claude desktop session watcher error: ${e && e.message ? e.message : e}`);
        });
        claudeWatchers.push(watcher);
        diag(`claude desktop session watcher started: ${sessionsRoot}`);
      } catch (e) {
        diag(`claude desktop session watcher unavailable for ${sessionsRoot}: ${e && e.message ? e.message : e}`);
      }
    }
  }

  function stopClaudeDesktopWatchers() {
    for (const watcher of claudeWatchers) {
      try { watcher.close(); } catch {}
    }
    claudeWatchers = [];
    if (claudeDebounce) clearTimeout(claudeDebounce);
    claudeDebounce = null;
  }

  function syncDesktopNames() {
    syncClaudeDesktopTitles();
    if (!testMode && !desktopRunning && typeof loadAssignments === 'function') {
      desktopRunning = true;
      let assignments = {};
      try { assignments = loadAssignments() || {}; } catch {}
      syncCodexDesktopThreadNames({ assignments, diag })
        .then(recordDesktopTitleStatus)
        .catch((e) => {
          diag(`codex desktop title sync failed: ${e && e.message ? e.message : e}`);
        })
        .finally(() => {
          desktopRunning = false;
        });
    }
  }

  function sync() {
    if (!enabled) return;
    syncDesktopNames();
    if (testMode || running) return;
    const script = path.join(appDir, 'codex-identify-live.ps1');
    if (!fs.existsSync(script)) {
      diag('codex identity sync skipped: codex-identify-live.ps1 missing');
      return;
    }

    running = true;
    const finish = () => { running = false; };
    try {
      const child = spawn(powershellExe, [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', script,
      ], { windowsHide: true, stdio: 'ignore' });
      child.once('exit', finish);
      child.once('error', (e) => {
        diag(`codex identity sync failed: ${e.message}`);
        finish();
      });
      if (typeof child.unref === 'function') child.unref();
    } catch (e) {
      diag(`codex identity sync spawn failed: ${e.message}`);
      finish();
    }
  }

  function start() {
    if (!enabled) {
      diag('codex identity sync disabled on this platform');
      return;
    }
    if (testMode || timer) return;
    sync();
    timer = setInterval(sync, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    startClaudeDesktopWatchers();
    claudeTimer = setInterval(syncClaudeDesktopTitles, Math.max(250, Math.min(Number(intervalMs) || 60000, Number(claudeIntervalMs) || 1000)));
    if (typeof claudeTimer.unref === 'function') claudeTimer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (claudeTimer) clearInterval(claudeTimer);
    stopClaudeDesktopWatchers();
    timer = null;
    claudeTimer = null;
  }

  return { start, stop, sync };
}

module.exports = {
  applyClaudeDesktopTitleSyncStatus,
  applyDesktopTitleSyncStatus,
  createCodexIdentitySync,
};
