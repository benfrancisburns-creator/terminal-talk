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
  onQueueUpdated:        (cb) => subscribe('queue-updated',          cb, (p) => p),
  onPriorityPlay:        (cb) => subscribe('priority-play',          cb, (p) => p),
  onClipboardStatus:     (cb) => subscribe('clipboard-status',       cb, (m) => m),
  onListeningState:      (cb) => subscribe('listening-state',        cb, (on) => on),
  onForceExpand:         (cb) => subscribe('force-expand',           cb),
  onSetOrientation:      (cb) => subscribe('set-orientation',        cb, (p) => p),
  onTogglePausePlayback: (cb) => subscribe('toggle-pause-playback',  cb),
  onPausePlaybackOnly:   (cb) => subscribe('pause-playback-only',    cb),
});
