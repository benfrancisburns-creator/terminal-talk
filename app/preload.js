const { contextBridge, ipcRenderer } = require('electron');

// Subscribe helpers return a disposer so the renderer can unsubscribe. Today
// the renderer is a single window that lives for the app's lifetime, so leaks
// are theoretical. But if we ever add a second renderer (popout, preference
// pane, test harness iframe) without a disposer the `on` handlers stack up —
// fixing that here is zero cost and closes the door. Callers that don't need
// to unsubscribe can ignore the return value.
function subscribe(channel, cb, unwrap) {
  const handler = unwrap
    ? (_e, ...args) => cb(unwrap(...args))
    : (_e) => cb();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getQueue: () => ipcRenderer.invoke('get-queue'),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStaleSessions: () => ipcRenderer.invoke('get-stale-sessions'),
  updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
  setSessionLabel: (shortId, label) => ipcRenderer.invoke('set-session-label', shortId, label),
  setSessionIndex: (shortId, index) => ipcRenderer.invoke('set-session-index', shortId, index),
  setSessionInclude: (shortId, key, value) => ipcRenderer.invoke('set-session-include', shortId, key, value),
  setSessionVoice: (shortId, voiceId) => ipcRenderer.invoke('set-session-voice', shortId, voiceId),
  setSessionMuted: (shortId, muted) => ipcRenderer.invoke('set-session-muted', shortId, muted),
  setSessionFocus: (shortId, focus) => ipcRenderer.invoke('set-session-focus', shortId, focus),
  removeSession: (shortId) => ipcRenderer.invoke('remove-session', shortId),
  setClickthrough: (on) => ipcRenderer.invoke('set-clickthrough', on),
  setPanelOpen: (open) => ipcRenderer.invoke('set-panel-open', open),
  // S1.1 — renderer-side error/rejection forwarding lives in main so the
  // existing _toolbar.log is the single sink for diagnostics. Main rate-
  // limits to 1 per distinct stack per second; see S1.2 in main.js.
  logRendererError: (payload) => ipcRenderer.invoke('log-renderer-error', payload),
  // EX3 — renderer-reload trigger from the Settings panel button.
  // Main-side handler calls win.webContents.reload(); the keyboard
  // shortcut (Ctrl+R) bypasses IPC via before-input-event at window
  // creation. Both paths end in the same reload().
  reloadRenderer: () => ipcRenderer.invoke('reload-renderer'),
  // HB1 — renderer asks main to synthesise a single ephemeral spinner
  // verb ("Moonwalking", "Pontificating") when Claude is actively
  // working but the queue has been silent. Main writes a T-prefixed mp3
  // to the queue; renderer picks it up via the existing fs.watch.
  speakHeartbeat: (verb, sessionShort) => ipcRenderer.invoke('speak-heartbeat', verb, sessionShort),
  // HB2 — list sessions currently marked working (UserPromptSubmit
  // fired, Stop hasn't yet). Heartbeat timer gates on this.
  getWorkingSessions: () => ipcRenderer.invoke('get-working-sessions'),
  // About panel: expose the installed Electron/app version so users can
  // sanity-check they're on the latest release without diffing
  // package.json. Reads app.getVersion() on the main side.
  getVersion: () => ipcRenderer.invoke('get-version'),
  onQueueUpdated:        (cb) => subscribe('queue-updated',          cb, (p) => p),
  onPriorityPlay:        (cb) => subscribe('priority-play',          cb, (p) => p),
  onClipboardStatus:     (cb) => subscribe('clipboard-status',       cb, (m) => m),
  onListeningState:      (cb) => subscribe('listening-state',        cb, (on) => on),
  onForceExpand:         (cb) => subscribe('force-expand',           cb),
  onSetOrientation:      (cb) => subscribe('set-orientation',        cb, (p) => p),
  onTogglePausePlayback: (cb) => subscribe('toggle-pause-playback',  cb),
  onPausePlaybackOnly:   (cb) => subscribe('pause-playback-only',    cb),
  // Mic-watcher transitions from app/mic-watcher.ps1. Fire when any
  // non-self app starts / stops using the microphone — renderer
  // auto-pauses + auto-resumes TTS so the user never plays over their
  // dictation and never misses content while they talk.
  onMicCapturedElsewhere: (cb) => subscribe('mic-captured-elsewhere', cb),
  onMicReleased:          (cb) => subscribe('mic-released',           cb),
});
