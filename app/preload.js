// Terminal Talk preload script — exposes the IPC surface to the renderer
// via contextBridge. The single object below (`window.api` in renderer)
// is the full contract between the renderer and the Electron main process.
//
// External integrators (Claude Desktop, custom MCP clients) talk to
// Terminal Talk via the MCP server (`app/terminal-talk-mcp-server.js`)
// instead — see docs/MCP-API.md. The IPC surface here is renderer-only.

const { contextBridge, ipcRenderer } = require('electron');

/**
 * @typedef {Object} QueueClip
 * @property {string} path        Absolute path to the .mp3 audio file.
 * @property {number} mtime       File mtime as Unix ms — drives ordering.
 * @property {string=} sessionShort  8-char session id parsed from filename.
 * @property {boolean=} isHeartbeat  True for H-prefix ephemeral pings.
 * @property {boolean=} isTool       True for T-prefix tool narration clips.
 */
/**
 * @typedef {Object} StaleSessionEntry
 * @property {string} short              Session short id.
 * @property {boolean} hasClips          Whether queue files still reference it.
 * @property {number} lastSeen           Last activity Unix ms.
 */
/**
 * @typedef {Object} ClipSidecar
 * @property {string} spoken    TTS-cleaned text (.txt sidecar). Empty if missing.
 * @property {string} original  Raw markdown source (.original.txt). Empty if missing.
 */
/**
 * @typedef {Object} OpenAiKeyStatus
 * @property {boolean} hasKey       True if a saved key is on disk.
 * @property {boolean} preferOpenai True if user has opted into OpenAI TTS.
 * @property {boolean} fallback     True if Edge fallback is enabled.
 */
/**
 * @typedef {Object} TestVoiceResult
 * @property {boolean} ok          True if synthesis succeeded.
 * @property {string} provider     'edge' or 'openai' depending on which fired.
 * @property {string=} error       Error message if ok=false.
 */
/**
 * @typedef {Object} InteractiveRegion
 * @property {number} x       Region top-left x in CSS pixels.
 * @property {number} y       Region top-left y in CSS pixels.
 * @property {number} width   Region width in CSS pixels.
 * @property {number} height  Region height in CSS pixels.
 */
/**
 * @typedef {Object} OrientationState
 * @property {'horizontal'|'vertical'} kind  Current bar orientation.
 * @property {'top'|'bottom'|'left'|'right'|null} edge  Snapped screen edge, if any.
 */
/**
 * @typedef {Object} ClipboardStatusMessage
 * @property {string} kind     'success' | 'empty' | 'error'.
 * @property {string=} text    Optional human-readable detail.
 */
/**
 * @typedef {Object} CursorInteractiveState
 * @property {boolean} interactive  True if cursor is over a clickable region.
 */
/**
 * @typedef {Object} LaunchAssistantPayload
 * @property {'claude'|'codex'|'claude-desktop-code'} kind  Assistant binary.
 * @property {string} projectPath  Project folder root.
 * @property {string=} label       Display label.
 * @property {string=} colourIndex Palette index 0–23.
 * @property {string=} permissionMode  Optional launch mode (CLI flag).
 */
/**
 * @typedef {Object} LaunchAssistantResult
 * @property {boolean} ok       True if spawn succeeded.
 * @property {string} shortId   Allocated session short id.
 * @property {string=} error    Error detail if ok=false.
 */
/**
 * @typedef {Object} RendererErrorPayload
 * @property {string} type      'error' | 'unhandledrejection'.
 * @property {string} message   Human-readable error message.
 * @property {string=} stack    Stack trace.
 * @property {string=} source   `file:line:col` if available.
 */

/**
 * The complete IPC surface exposed to the renderer as `window.api`.
 *
 * Naming convention:
 * - `getX()` — read-only fetch.
 * - `setX(...)` — single-field mutation, returns Promise that resolves
 *   when persisted to ~/.terminal-talk/session-colours.json.
 * - `onX(cb)` — event subscriber. Returns an unsubscribe function.
 *
 * Validation:
 * - `shortId` parameters must match `/^[a-f0-9]{8}$/`. Bad ids reject.
 * - File-path parameters are validated main-side against the install
 *   directory; path traversal attempts reject.
 *
 * Error model:
 * - Most calls return Promises that reject with a JS Error on failure.
 * - Callers should `.catch()` and route to `logRendererError` so
 *   diagnostic detail reaches `~/.terminal-talk/queue/_toolbar.log`.
 *
 * @typedef {Object} TerminalTalkApi
 *
 * Queue + clips
 * @property {() => Promise<QueueClip[]>} getQueue                 Current queue contents, mtime-sorted oldest-first.
 * @property {(audioPath: string) => Promise<ClipSidecar>} readClipSidecar  Reads .txt + .original.txt next to a clip.
 * @property {(p: string) => Promise<{ok: boolean, error?: string}>} deleteFile  Deletes a queue file (with main-side path validation).
 *
 * Window control
 * @property {() => Promise<void>} hideWindow                      Hide the toolbar (recover via Ctrl+Shift+A).
 * @property {(on: boolean) => Promise<void>} setClickthrough      Toggle whole-window mouse-event passthrough.
 * @property {(region: InteractiveRegion|null) => Promise<void>} setInteractiveRegion  Set the rect that should remain interactive while clickthrough is on.
 * @property {(open: boolean) => Promise<void>} setPanelOpen       Mark settings panel open/closed (also fires `terminal-talk-panel-open` postMessage to parent if iframed).
 * @property {() => Promise<void>} reloadRenderer                  Force-reload the toolbar webContents.
 *
 * Config + sessions
 * @property {() => Promise<object>} getConfig                     Whole config.json.
 * @property {(partial: object) => Promise<object>} updateConfig   Shallow-merge update; returns new state.
 * @property {() => Promise<StaleSessionEntry[]>} getStaleSessions Sessions whose PIDs aren't alive but still have queue clips.
 * @property {() => Promise<string[]>} getWorkingSessions          Sessions with UserPromptSubmit fired but not yet Stop.
 * @property {(shortId: string, label: string) => Promise<void>} setSessionLabel
 * @property {(shortId: string, index: number) => Promise<void>} setSessionIndex   Palette index 0-23.
 * @property {(shortId: string, key: string, value: boolean|null) => Promise<void>} setSessionInclude  Tri-state speech-include override.
 * @property {(shortId: string, value: boolean|null) => Promise<void>} setSessionHeartbeat  Tri-state heartbeat override.
 * @property {(shortId: string, voiceId: string) => Promise<void>} setSessionVoice  Edge voice id (validated regex).
 * @property {(shortId: string, muted: boolean) => Promise<void>} setSessionMuted
 * @property {(shortId: string, focus: boolean) => Promise<void>} setSessionFocus
 * @property {(shortId: string) => Promise<{ok: boolean, error?: string}>} removeSession
 *
 * Identity sync
 * @property {(shortId: string) => Promise<{ok: boolean, error?: string}>} syncCodexDesktopTitle
 * @property {(shortId: string) => Promise<{ok: boolean, error?: string}>} syncClaudeDesktopTitle
 *
 * Session creation
 * @property {(startPath?: string) => Promise<{path: string|null}>} chooseSessionProjectDir  Folder picker dialog.
 * @property {(payload: LaunchAssistantPayload) => Promise<LaunchAssistantResult>} launchAssistantSession  Spawns the chosen assistant CLI in a new terminal tab.
 *
 * OpenAI TTS
 * @property {() => Promise<OpenAiKeyStatus>} getOpenAiKeyStatus
 * @property {() => Promise<TestVoiceResult>} testOpenAiVoice  Synth a short test phrase through current preference.
 *
 * Heartbeat
 * @property {(verb: string, sessionShort: string) => Promise<void>} speakHeartbeat  Render a single H-prefix verb clip.
 *
 * About / version
 * @property {() => Promise<{version: string}>} getVersion
 * @property {() => Promise<void>} demoStartReady  Signal landing-page demo iframe that renderer is ready.
 *
 * Diagnostics
 * @property {(payload: RendererErrorPayload) => Promise<void>} logRendererError  Forwards renderer-side errors to main's diag log (rate-limited to 1/distinct-stack/s).
 *
 * Subscriptions (each returns an unsubscribe function)
 * @property {(cb: (clips: QueueClip[]) => void) => () => void} onQueueUpdated  Fires whenever the queue dir changes.
 * @property {(cb: (path: string) => void) => () => void} onPriorityPlay      A J-clip / priority queue entry should play next.
 * @property {(cb: (msg: ClipboardStatusMessage) => void) => () => void} onClipboardStatus  Highlight-to-speak result toast.
 * @property {(cb: (listening: boolean) => void) => () => void} onListeningState  Wake-word listener on/off.
 * @property {(cb: () => void) => () => void} onForceExpand                 Renderer should leave collapsed mode now.
 * @property {(cb: (state: OrientationState) => void) => () => void} onSetOrientation  Bar dock/orientation changed.
 * @property {(cb: (state: CursorInteractiveState) => void) => () => void} onCursorInteractiveState  Cursor crossed in/out of an interactive region.
 * @property {(cb: () => void) => () => void} onTogglePausePlayback         Global pause/resume hotkey fired.
 * @property {(cb: () => void) => () => void} onPausePlaybackOnly           Pause-only hotkey fired (never resumes).
 * @property {(cb: () => void) => () => void} onMicCapturedElsewhere        Another app started using the mic — renderer should pause.
 * @property {(cb: () => void) => () => void} onMicReleased                 Mic free again — renderer can resume.
 * @property {(cb: () => void) => () => void} onOpenaiKeyInvalid            Saved OpenAI key was just auto-cleared because it returned HTTP 401.
 */

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

/** @type {TerminalTalkApi} */
const api = {
  getQueue: () => ipcRenderer.invoke('get-queue'),
  // Transcript panel: read the .txt + .original.txt sidecars next to a
  // queued audio clip. Path is validated main-side against QUEUE_DIR.
  // Returns { spoken: string, original: string } — both empty if the
  // sidecars don't exist (older clips, ephemerals, etc.).
  readClipSidecar: (audioPath) => ipcRenderer.invoke('read-clip-sidecar', audioPath),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStaleSessions: () => ipcRenderer.invoke('get-stale-sessions'),
  updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
  chooseSessionProjectDir: (startPath) => ipcRenderer.invoke('choose-session-project-dir', startPath),
  launchAssistantSession: (payload) => ipcRenderer.invoke('launch-assistant-session', payload),
  setSessionLabel: (shortId, label) => ipcRenderer.invoke('set-session-label', shortId, label),
  setSessionIndex: (shortId, index) => ipcRenderer.invoke('set-session-index', shortId, index),
  setSessionInclude: (shortId, key, value) => ipcRenderer.invoke('set-session-include', shortId, key, value),
  setSessionHeartbeat: (shortId, value) => ipcRenderer.invoke('set-session-heartbeat', shortId, value),
  setSessionVoice: (shortId, voiceId) => ipcRenderer.invoke('set-session-voice', shortId, voiceId),
  setSessionMuted: (shortId, muted) => ipcRenderer.invoke('set-session-muted', shortId, muted),
  setSessionFocus: (shortId, focus) => ipcRenderer.invoke('set-session-focus', shortId, focus),
  syncCodexDesktopTitle: (shortId) => ipcRenderer.invoke('sync-codex-desktop-title', shortId),
  syncClaudeDesktopTitle: (shortId) => ipcRenderer.invoke('sync-claude-desktop-title', shortId),
  removeSession: (shortId) => ipcRenderer.invoke('remove-session', shortId),
  // Settings panel "OpenAI (premium)" section.
  // - getOpenAiKeyStatus: drives the "● Key set / ○ Not set" dot + the
  //   "Prefer OpenAI" toggle enable state. Never returns the key itself.
  // - testOpenAiVoice: "Test voice" button — synths a short known phrase
  //   through whichever provider is currently preferred and drops the
  //   clip into the queue, so the user hears which path fired.
  getOpenAiKeyStatus: () => ipcRenderer.invoke('get-openai-key-status'),
  testOpenAiVoice:    () => ipcRenderer.invoke('test-openai-voice'),
  setClickthrough: (on) => ipcRenderer.invoke('set-clickthrough', on),
  setInteractiveRegion: (region) => ipcRenderer.invoke('set-interactive-region', region),
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
  // Returns { failed: [{name, accel}], at: <unix-ms> } so the Shortcuts
  // panel can show a banner per failed registration. Pulled (not pushed)
  // so the renderer can read it on demand even if it loaded after the
  // initial push fired.
  getHotkeyRegistration: () => ipcRenderer.invoke('get-hotkey-registration'),
  demoStartReady: () => ipcRenderer.invoke('demo-start-ready'),
  onQueueUpdated:        (cb) => subscribe('queue-updated',          cb, (p) => p),
  onPriorityPlay:        (cb) => subscribe('priority-play',          cb, (p) => p),
  onClipboardStatus:     (cb) => subscribe('clipboard-status',       cb, (m) => m),
  onListeningState:      (cb) => subscribe('listening-state',        cb, (on) => on),
  onForceExpand:         (cb) => subscribe('force-expand',           cb),
  onSetOrientation:      (cb) => subscribe('set-orientation',        cb, (p) => p),
  onCursorInteractiveState: (cb) => subscribe('cursor-interactive-state', cb, (p) => p),
  onTogglePausePlayback: (cb) => subscribe('toggle-pause-playback',  cb),
  onPausePlaybackOnly:   (cb) => subscribe('pause-playback-only',    cb),
  // Mic-watcher transitions from app/mic-watcher.ps1. Fire when any
  // non-self app starts / stops using the microphone — renderer
  // auto-pauses + auto-resumes TTS so the user never plays over their
  // dictation and never misses content while they talk.
  onMicCapturedElsewhere: (cb) => subscribe('mic-captured-elsewhere', cb),
  onMicReleased:          (cb) => subscribe('mic-released',           cb),
  // Pushed once at startup if any global shortcut failed to register
  // (e.g. another app already has the chord). Renderer also has the
  // pull path via getHotkeyRegistration.
  onHotkeyRegistration:   (cb) => subscribe('hotkey-registration',    cb, (p) => p),
  // Fires when main detects the auto-unset flag dropped by synth_turn
  // after openai_tts.py returned HTTP 401 during a real synth. main
  // has already cleared the key + demoted OpenAI TTS routes to 'edge' by
  // then; settings-form uses this to reveal the OpenAI section + show
  // the key-input row so the user can re-enter their key.
  onOpenaiKeyInvalid:     (cb) => subscribe('openai-key-invalid',     cb),
};

contextBridge.exposeInMainWorld('api', api);
