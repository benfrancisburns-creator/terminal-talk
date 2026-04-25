'use strict';

// Voice-command action dispatcher. Extracted from renderer.js so every
// state branch (paused-mid-clip, ended-clip-still-loaded, idle with
// unplayed, idle with all-played, muted/stale filtering) can be unit
// tested with mock audio + queue fixtures instead of a live DOM.
//
// Factory pattern with injected deps matches other lib modules
// (heartbeat, clip-paths, etc.). Callers pass the same audio element,
// audioPlayer component, and queue accessors the renderer already owns.
//
// Why state-machine style instead of "just call audio.play()":
//
//   Ben reported 2026-04-24 that saying "play" on a dot strip full of
//   already-played clips did nothing. The old renderer handler called
//   playNextPending(), which filters out playedPaths at every stage
//   of its priority chain — so with all clips played, no candidate,
//   no-op. Music-player intuition: "play" button always plays
//   something. The fallback below picks the most-recent non-muted clip
//   and replays it, matching that intuition.

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_VOICE_DISPATCH = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Picks the "play something, anything" fallback — the clip a user
  // would most likely want if they say "play" on a dot strip where
  // everything's already been played. Most recent by mtime, skipping
  // muted + stale sessions. Returns null if nothing playable exists.
  function pickFallbackClip(queue, isMuted, isStale) {
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const m = typeof isMuted === 'function' ? isMuted : () => false;
    const s = typeof isStale === 'function' ? isStale : () => false;
    const candidates = queue.filter(f => !m(f.path) && !s(f.path));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return candidates[0];
  }

  // Factory. Deps:
  //   audio          — the <audio> element (reads src, paused, ended,
  //                    duration, writes currentTime, calls play/pause).
  //   audioPlayer    — the AudioPlayer component (for playPath / abort).
  //   getQueue       — () => queue array of {path, mtime}.
  //   isMuted        — (path) => boolean.
  //   isStale        — (path) => boolean.
  //   playNextPending— () => void — tries priority → focus → pending →
  //                    fallback-unplayed. Same function the ended-
  //                    handler calls.
  //
  // Returns { dispatch(action) } — the single exposed operation.
  function createVoiceDispatcher(deps) {
    const {
      audio,
      audioPlayer,
      getQueue = () => [],
      isMuted = () => false,
      isStale = () => false,
      playNextPending = () => {},
    } = deps || {};

    function playSafely() {
      try { audio.play().catch(() => {}); } catch {}
    }

    function dispatch(action) {
      switch (action) {

        // ---- play ------------------------------------------------------
        // Music-player semantics. Always plays SOMETHING if the queue
        // has anything playable; idempotent when already playing.
        case 'play': {
          // Paused mid-clip → resume.
          if (audio.src && audio.paused && !audio.ended) {
            playSafely();
            return;
          }
          // Currently playing → idempotent.
          if (audio.src && !audio.paused && !audio.ended) return;
          // Ended clip still loaded → replay it.
          if (audio.src && audio.ended) {
            try { audio.currentTime = 0; } catch {}
            playSafely();
            return;
          }
          // Nothing loaded. Try the normal next-unplayed chain first.
          const srcBefore = audio.src;
          try { playNextPending(); } catch {}
          if (audio.src && audio.src !== srcBefore) return;
          // Still nothing (queue is all-played, or muted, or empty).
          // Fallback: most recent playable clip.
          const fb = pickFallbackClip(getQueue(), isMuted, isStale);
          if (fb && audioPlayer && typeof audioPlayer.playPath === 'function') {
            audioPlayer.playPath(fb.path, true, false);
          }
          return;
        }

        // ---- pause -----------------------------------------------------
        case 'pause': {
          if (audio.src && !audio.ended && !audio.paused) {
            try { audio.pause(); } catch {}
          }
          return;
        }

        // ---- resume ----------------------------------------------------
        // Like 'play' but stricter — only resumes a paused clip, never
        // starts fresh playback. Useful distinction if the user wants
        // a fail-safe "resume whatever I was listening to".
        case 'resume': {
          if (audio.src && audio.paused && !audio.ended) playSafely();
          return;
        }

        // ---- next ------------------------------------------------------
        // Skip current clip, play the next one via the same pick chain
        // the natural 'ended' handler uses. Seeking to duration is the
        // cleanest trigger — no duplicated selector logic here.
        case 'next': {
          if (audio.src && !audio.ended && isFinite(audio.duration) && audio.duration > 0) {
            try { audio.currentTime = audio.duration; } catch {}
          } else {
            try { playNextPending(); } catch {}
          }
          return;
        }

        // ---- back ------------------------------------------------------
        // Replay the loaded clip from 0. If nothing's loaded, replay the
        // most recent clip on the strip — matches the user intuition of
        // "go back to what I was just hearing".
        case 'back': {
          if (audio.src) {
            try { audio.currentTime = 0; } catch {}
            if (audio.paused || audio.ended) playSafely();
            return;
          }
          const fb = pickFallbackClip(getQueue(), isMuted, isStale);
          if (fb && audioPlayer && typeof audioPlayer.playPath === 'function') {
            audioPlayer.playPath(fb.path, true, false);
          }
          return;
        }

        // ---- stop ------------------------------------------------------
        case 'stop': {
          if (audioPlayer && typeof audioPlayer.abort === 'function') {
            audioPlayer.abort();
          } else {
            // Fallback if audioPlayer isn't wired: pause + clear src
            // via the element directly.
            try { audio.pause(); } catch {}
            try { audio.src = ''; } catch {}
          }
          return;
        }

        // ---- cancel ----------------------------------------------------
        // Intentional no-op (user said "cancel" to abort the command
        // window). main.js already filters these but we accept them
        // here for defence-in-depth.
        case 'cancel':
          return;

        // ---- unknown ---------------------------------------------------
        default:
          return;
      }
    }

    return { dispatch };
  }

  return {
    createVoiceDispatcher,
    pickFallbackClip,
  };
}));
