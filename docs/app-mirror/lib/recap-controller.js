// Session recap controller (2026-10-05) — glue between a tab's recap
// control, the chooser popover (recap-menu.js), the stage-recap IPC and
// the audio player's recap playlist.
//
// Flow: tab control click -> open(short) asks main for the session's recap
// summary (live + archived body clips) and shows the chooser -> the user
// picks "last 10 clips" / "last 5 min" -> start() asks main to stage the
// clips (archived ones are copied back into the queue under `-R-` names,
// live ones are referenced as-is) -> the controller pre-marks every staged
// path as played / heard / recap (so the queue-updated event that follows
// never auto-queues them) and inserts them into the renderer's local queue
// array so the dots appear immediately -> audioPlayer.startRecap(paths).
//
// Ordering note: main's stage-recap handler copies the files synchronously
// and returns before its debounced fs.watch -> queue-updated fires, so the
// IPC reply (and the pre-marking below) always lands first. Pre-marking is
// still belt-and-braces: renderer.js also skips recapPaths in its
// new-arrival scan.
//
// UMD-lite: unit tests require() it, index.html loads it before renderer.js.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_RECAP_CONTROLLER = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function createRecapController({
    api,                       // window.api (getRecapSummary / stageRecap)
    audioPlayer,               // AudioPlayer instance (startRecap)
    menu = null,               // RecapMenu instance (optional in tests)
    getQueue = () => [],       // renderer's live queue array
    addToQueue = () => {},     // ({ path, mtime }) => void — insert newest-first
    markStaged = () => {},     // (path, { live }) => void — recap set (+ played/heard for staged copies)
    renderDots = () => {},
    showToast = () => {},      // (text, ms, variant) => void
    getSessionLabel = (short) => short,
    bumpActivity = () => {},
    fmtDuration = fmtClock,
    logError = () => {},
    // Runs before staging — the renderer finalises any pending undo-clear
    // so the archive and the queue agree on what exists before we pick.
    beforeStart = async () => {},
    // True while the stage-recap round trip is in flight: the renderer's
    // 1.5 s autoplay drain must not start a pending clip that startRecap
    // would then cut off (and lose, since playPath marks it played).
    setStaging = () => {},
    // A non-manual clip that the recap cut off is un-marked so the normal
    // pending fallback replays it once the recap is done — same courtesy
    // the priority J-clip path extends.
    unmarkPlayed = () => {},
  } = {}) {
    if (!api) throw new Error('createRecapController: api required');
    if (!audioPlayer) throw new Error('createRecapController: audioPlayer required');

    let inFlight = false;

    function labelFor(short) {
      if (short === 'all') return 'all sessions';
      try { return getSessionLabel(short) || short; } catch { return short; }
    }

    function available() {
      return typeof api.getRecapSummary === 'function' && typeof api.stageRecap === 'function';
    }

    // Open the chooser for a session tab. `anchorEl` is the tab element.
    function open(short, anchorEl) {
      if (!menu) return false;
      if (!available()) {
        showToast('Recap needs the updated Terminal Talk main process — restart the toolbar.', 5000, 'warning');
        return false;
      }
      bumpActivity();
      let summary;
      try { summary = api.getRecapSummary(short); } catch (e) { summary = Promise.reject(e); }
      return menu.open({ short, label: labelFor(short), anchorEl, summary });
    }

    // Stage + play. Returns the number of clips queued for replay.
    async function start({ short, mode, value } = {}) {
      if (!available()) return 0;
      if (inFlight) return 0;
      inFlight = true;
      bumpActivity();
      try { setStaging(true); } catch {}
      try {
        try { await beforeStart(); } catch (e) { logError(`recap beforeStart failed: ${e && e.message ? e.message : String(e)}`); }
        let res;
        try {
          res = await api.stageRecap({ short, mode, value });
        } catch (e) {
          logError(`stageRecap failed: ${e && e.message ? e.message : String(e)}`);
          showToast('Could not stage the recap — see logs.', 5000, 'warning');
          return 0;
        }
        if (!res || !res.ok) {
          const why = res && res.error;
          if (why === 'busy') showToast('Too many requests — try the recap again in a second.', 4000, 'warning');
          else if (why === 'muted') showToast(`${labelFor(short)} is muted — unmute it in Settings › Sessions to catch up.`, 5000, 'warning');
          else if (why === 'unavailable') showToast('Recap history is off (Settings › Playback › Keep recap history).', 5000, 'warning');
          else showToast('Could not stage the recap — see logs.', 5000, 'warning');
          return 0;
        }
        const clips = Array.isArray(res.clips) ? res.clips.filter((c) => c && typeof c.path === 'string') : [];
        if (clips.length === 0) {
          showToast(`Nothing to catch up on for ${labelFor(short)} yet.`, 4000, 'info');
          return 0;
        }
        // Newest-first insertion so the local queue array matches main's
        // newest-first order until queue-updated replaces it.
        const queue = getQueue();
        for (const clip of clips) {
          if (!queue.some((f) => f.path === clip.path)) {
            addToQueue({ path: clip.path, mtime: Number(clip.mtime) || Date.now() });
          }
          // Live clips keep their own played/heard state: if the recap ends
          // early an unplayed one must still auto-play later.
          markStaged(clip.path, { live: !!clip.live });
        }
        renderDots();
        const paths = clips.map((c) => c.path);
        const cutOff = typeof audioPlayer.getCurrentPath === 'function' ? audioPlayer.getCurrentPath() : null;
        const cutOffManual = typeof audioPlayer.isCurrentManual === 'function' ? audioPlayer.isCurrentManual() : true;
        const cutOffWasRecap = typeof audioPlayer.isRecapActive === 'function' ? audioPlayer.isRecapActive() : false;
        // Lift the drain gate right before starting so a priority clip that
        // arrived during the round trip can be played first by startRecap.
        try { setStaging(false); } catch {}
        const started = audioPlayer.startRecap(paths);
        if (!started) {
          showToast('Recap clips are queued but playback could not start.', 5000, 'warning');
          return 0;
        }
        // Only a plain auto-played clip is re-queued; a recap clip that was
        // cut off belongs to the replaced playlist and is pruned instead.
        if (cutOff && !cutOffManual && !cutOffWasRecap && !paths.includes(cutOff)) {
          try { unmarkPlayed(cutOff); } catch {}
        }
        let totalSec = 0;
        for (const c of clips) totalSec += Number(c.durationSec) || 0;
        const what = mode === 'minutes' ? `last ${value} min` : `last ${clips.length} clip${clips.length === 1 ? '' : 's'}`;
        // Short-lived: the toast sits over the dot strip, and the dashed-ring
        // replay dots + the active halo already show what is happening.
        showToast(`Catching up on ${labelFor(short)} — ${what}, ≈ ${fmtDuration(totalSec)}.`, 2500, 'info');
        return clips.length;
      } finally {
        inFlight = false;
        try { setStaging(false); } catch {}
      }
    }

    function closeMenu() { if (menu) menu.close(); }

    return { open, start, closeMenu, isAvailable: available };
  }

  return { createRecapController, fmtClock };
}));
