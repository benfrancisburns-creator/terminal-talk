// EX7a — extracted from app/renderer.js as part of the v0.4
// big-file refactor. Pure helpers that operate on clip filenames +
// session short-IDs. Zero state mutation, zero DOM access.
//
// UMD-lite pattern so the same file works in two contexts:
//   - Node unit tests: require('./lib/clip-paths') → module exports
//   - Electron renderer (sandboxed, no node API): loaded via <script
//     src> tag before renderer.js; attaches to window.TT_CLIP_PATHS.
//
// The renderer still owns the live sessionAssignments map; when it
// needs a palette key it passes the current assignments in via the
// paletteKeyForShort() argument. This keeps the helper decoupled
// from the global.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_CLIP_PATHS = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function paletteKeyForIndex(idx, paletteSize) {
    if (!Number.isInteger(idx)) return 'neutral';
    const i = ((idx % paletteSize) + paletteSize) % paletteSize;
    return String(i).padStart(2, '0');
  }

  function paletteKeyForShort(shortId, assignments, paletteSize) {
    if (!shortId || shortId.length < 4) return 'neutral';
    const entry = assignments && assignments[shortId];
    if (entry && Number.isInteger(entry.index)) {
      return paletteKeyForIndex(entry.index, paletteSize);
    }
    let sum = 0;
    for (let i = 0; i < shortId.length; i++) sum += shortId.charCodeAt(i);
    return paletteKeyForIndex(sum, paletteSize);
  }

  function extractSessionShort(filename) {
    // Try the MORE SPECIFIC clip pattern first. A pathological
    // filename like `deadbeef-clip-12345678.mp3` matches both
    // patterns; the clip pattern's intended parse is `deadbeef`, but
    // the response pattern would return `12345678`. Specificity-first
    // ordering avoids this ambiguity even though the canonical
    // filenames today never collide. Audit G11.
    let m = filename.match(/-clip-([a-f0-9]{8}|neutral)-\d+\.(wav|mp3)$/i);
    if (m) return m[1].toLowerCase() === 'neutral' ? null : m[1].toLowerCase();
    // Response / question / notif: ends with -<8hex>.ext
    m = filename.match(/-([a-f0-9]{8})\.(wav|mp3)$/i);
    if (m) return m[1].toLowerCase();
    return null;
  }

  function isClipFile(filename) {
    return /-clip-/.test(filename);
  }

  return {
    paletteKeyForIndex,
    paletteKeyForShort,
    extractSessionShort,
    isClipFile,
  };
}));
