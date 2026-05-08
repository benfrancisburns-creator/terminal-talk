'use strict';

// Voice-command dispatch — completes the half-built path that's been
// in the codebase since the Phase-1 voice-command work landed on the
// Windows side. The wake-word listener writes voice-command.json, the
// main-process watcher (app/lib/voice-command-watcher.js) consumes it
// and emits the `voice-command-action` IPC, but until this module
// existed the renderer never subscribed. End result was that "hey
// jarvis pause" / "hey jarvis next" produced no audible behaviour
// change despite the watcher logging a successful dispatch.
//
// Action vocabulary mirrors the SAPI grammar in
// app/voice-command-recognize.ps1 (Windows) and the macOS Speech
// equivalent in app/voice_command_recognize_mac.py:
//
//     play | pause | resume | next | back | stop | cancel
//
// Skip / again / previous / silence / "stop talking" / "shut up" are
// handled by the recogniser side as aliases — they map to the verbs
// above before reaching this dispatch table.
//
// Extracted to a separate module 2026-05-08 to keep app/renderer.js
// under the 2725-line file-length ceiling. Pure browser-context JS;
// expects an audio-player exposing the seven public methods above.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TT_VOICE_COMMAND_DISPATCH = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createVoiceCommandDispatch({
    audioPlayer,
    onUnknown = () => {},
    onError = () => {},
  } = {}) {
    if (!audioPlayer) {
      throw new Error('createVoiceCommandDispatch: audioPlayer required');
    }
    const table = Object.freeze({
      play:   () => audioPlayer.resume(),
      pause:  () => audioPlayer.pause(),
      resume: () => audioPlayer.resume(),
      next:   () => audioPlayer.next(),
      back:   () => audioPlayer.back(),
      stop:   () => audioPlayer.stop(),
      cancel: () => audioPlayer.cancel(),
    });
    return function dispatch(action) {
      const fn = table[String(action || '').toLowerCase()];
      if (typeof fn !== 'function') {
        try { onUnknown(action); } catch {}
        return;
      }
      try { fn(); } catch (e) {
        try { onError(action, e); } catch {}
      }
    };
  }

  return { createVoiceCommandDispatch };
}));
