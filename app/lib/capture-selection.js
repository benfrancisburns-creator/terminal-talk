'use strict';

// Highlight-to-speak selection capture — extracted from app/main.js
// (2026-10-05) to bring main.js back under the 2725-line file-length
// ceiling.
//
// Mechanism: park a unique marker on the clipboard, ask the key helper to
// send a synthetic Ctrl+C to the foreground app, then poll the clipboard
// (20 ms cadence, 3 s deadline) until it changes away from the marker.
// Whatever lands is the user's selection. The pre-capture clipboard is
// restored after a short grace — but only if the board still holds the
// text we captured, so a Ctrl+C the user pressed on something else in
// that gap is never clobbered (audit R11).
//
// Factory-injected deps (Electron `clipboard`, the helper's sendCtrlC,
// diag, and timer fns) keep the module Electron-free for unit tests.

function createSelectionCapture({
  clipboard,
  sendCtrlC,
  diag = () => {},
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  restoreDelayMs = 300,
  deadlineMs = 3000,
} = {}) {
  if (!clipboard || typeof clipboard.readText !== 'function' || typeof clipboard.writeText !== 'function') {
    throw new Error('createSelectionCapture: clipboard with readText/writeText required');
  }
  if (typeof sendCtrlC !== 'function') throw new Error('createSelectionCapture: sendCtrlC required');

  async function captureSelection() {
    const original = clipboard.readText();
    const marker = '___TT_CLIP_MARKER___' + now();
    clipboard.writeText(marker);
    diag(`captureSelection: marker written (original len=${original.length})`);
    await sendCtrlC();
    let captured = '';
    const start = now();
    const deadline = start + deadlineMs;
    let polls = 0;
    while (now() < deadline) {
      await sleep(20);
      polls++;
      const after = clipboard.readText();
      if (after && after !== marker) { captured = after; break; }
    }
    diag(`captureSelection: polls=${polls} elapsed=${now() - start}ms captured.len=${captured.length}`);
    // Restore the user's pre-capture clipboard after a short grace, BUT
    // only if the clipboard still holds the text we captured. If the user
    // pressed Ctrl+C on something else in the 300 ms gap, their new copy
    // is on the board and we must not clobber it. Audit R11.
    // Also restore when the board still holds OUR MARKER — the empty-capture
    // path used to leave marker junk as the user's clipboard (captured=''
    // never equals the marker, so restore was skipped; found 2026-08-13).
    setTimeout(() => {
      try {
        const current = clipboard.readText();
        if (current === captured || current === marker) {
          clipboard.writeText(original);
        } else {
          diag('captureSelection: clipboard changed mid-gap -- skipping restore');
        }
      } catch (e) {
        diag(`captureSelection restore fail: ${e && e.message}`);
      }
    }, restoreDelayMs);
    return { captured, original };
  }

  return { captureSelection };
}

module.exports = { createSelectionCapture };
