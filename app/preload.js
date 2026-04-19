const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getQueue: () => ipcRenderer.invoke('get-queue'),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
  setSessionLabel: (shortId, label) => ipcRenderer.invoke('set-session-label', shortId, label),
  setSessionIndex: (shortId, index) => ipcRenderer.invoke('set-session-index', shortId, index),
  setSessionInclude: (shortId, key, value) => ipcRenderer.invoke('set-session-include', shortId, key, value),
  setSessionVoice: (shortId, voiceId) => ipcRenderer.invoke('set-session-voice', shortId, voiceId),
  setSessionMuted: (shortId, muted) => ipcRenderer.invoke('set-session-muted', shortId, muted),
  setClickthrough: (on) => ipcRenderer.invoke('set-clickthrough', on),
  setPanelOpen: (open) => ipcRenderer.invoke('set-panel-open', open),
  onQueueUpdated: (cb) => {
    ipcRenderer.on('queue-updated', (_e, payload) => cb(payload));
  },
  onPriorityPlay: (cb) => {
    ipcRenderer.on('priority-play', (_e, paths) => cb(paths));
  },
  onClipboardStatus: (cb) => {
    ipcRenderer.on('clipboard-status', (_e, msg) => cb(msg));
  },
  onListeningState: (cb) => {
    ipcRenderer.on('listening-state', (_e, on) => cb(on));
  },
  onForceExpand: (cb) => {
    ipcRenderer.on('force-expand', () => cb());
  }
});
