'use strict';

// HB1 / HB2 / HB3 — ambient-narration decision logic extracted into a
// pure module so the renderer's setInterval ticker can stay a thin
// wrapper and the behaviour is exhaustively unit-testable.
//
// Two pure functions + two constant lists:
//
//   pickHeartbeatVerb(rng?)
//     Returns a single verb ("Moonwalking") or a longer thinking
//     phrase ("Thinking this through") for the current tick.
//     40% phrases / 60% single verbs so long silent stretches don't
//     sound like a robot word-of-the-day machine.
//
//   decideHeartbeatAction(state)
//     Evaluates the tick's conditions and returns one of:
//       { type: 'reset-silent', newSilentSince }  (queue just went active)
//       { type: 'skip' }                          (conditions not met)
//       { type: 'emit', sessionShort, newLastHeartbeatAt }
//                                                 (fire a heartbeat now)
//     Callers apply the state mutation themselves — this function is
//     pure so tests can drive it with synthetic time and state.
//
// The renderer's setInterval reads its live state, calls
// decideHeartbeatAction, applies the returned mutation, and on 'emit'
// kicks off the speak-heartbeat IPC. No branching logic lives in the
// setInterval callback — all decisions happen here.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_HEARTBEAT = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Claude Code's real tengu_spinner_words list (90 entries, sourced
  // from levindixon/tengu_spinner_words). Originally rendered as a
  // visual trail behind the walking mascot; now ALSO spoken as the
  // ambient heartbeat track. Moonwalking, Pontificating,
  // Flibbertigibbeting etc. — matches what the listener sees.
  const SPINNER_VERBS = [
    'Accomplishing','Actioning','Actualizing','Baking','Booping','Brewing',
    'Calculating','Cerebrating','Channelling','Churning','Clauding','Coalescing',
    'Cogitating','Combobulating','Computing','Concocting','Conjuring','Considering',
    'Contemplating','Cooking','Crafting','Creating','Crunching','Deciphering',
    'Deliberating','Determining','Discombobulating','Divining','Doing','Effecting',
    'Elucidating','Enchanting','Envisioning','Finagling','Flibbertigibbeting',
    'Forging','Forming','Frolicking','Generating','Germinating','Hatching','Herding',
    'Honking','Hustling','Ideating','Imagining','Incubating','Inferring','Jiving',
    'Manifesting','Marinating','Meandering','Moonwalking','Moseying','Mulling',
    'Mustering','Musing','Noodling','Percolating','Perusing','Philosophising',
    'Pontificating','Pondering','Processing','Puttering','Puzzling','Reticulating',
    'Ruminating','Scheming','Schlepping','Shimmying','Shucking','Simmering',
    'Smooshing','Spelunking','Spinning','Stewing','Sussing','Synthesizing','Thinking',
    'Tinkering','Transmuting','Unfurling','Unravelling','Vibing','Wandering',
    'Whirring','Wibbling','Wizarding','Working','Wrangling'
  ];

  // Longer context phrases mixed with single SPINNER_VERBS so silent
  // stretches get some variety. User-reported: a single word felt too
  // terse; a phrase like "Thinking this through" conveys actual
  // progress intent while still being a short clip.
  const THINKING_PHRASES = [
    'Thinking this through',
    'Working through it',
    'Let me think about this',
    'Considering your message',
    'Processing your request',
    'Composing a response',
    'Still working on it',
    'Getting my head around this',
    'Piecing it together',
    'Just a moment',
    'Nearly there',
    'Just crunching the details',
    'Sussing this out',
    'Giving it a proper think',
  ];

  // Phrase mix ratio — 40% phrase / 60% single verb. Tuned so the
  // single-verb Claude-Code-homage vocabulary stays primary but long
  // silent stretches hear occasional contextual phrases rather than
  // five random words in a row.
  const PHRASE_MIX_RATIO = 0.4;

  function pickHeartbeatVerb(rng) {
    const r = (typeof rng === 'function') ? rng : Math.random;
    if (r() < PHRASE_MIX_RATIO) {
      return THINKING_PHRASES[Math.floor(r() * THINKING_PHRASES.length)];
    }
    return SPINNER_VERBS[Math.floor(r() * SPINNER_VERBS.length)];
  }

  // Decide what the current tick should do. Pure — all state comes
  // in via args, all state mutations come back via the return value.
  //
  // `state` fields (all required unless defaulted):
  //   now                    ms timestamp (Date.now() on real ticks)
  //   heartbeatEnabled       config toggle (true means we're allowed to emit)
  //   isQueueActive          renderer's isQueueActive() snapshot —
  //                          if true, reset the silent timer
  //   heartbeatSilentSince   ms timestamp of when silence began
  //   lastHeartbeatAt        ms timestamp of last successful emit
  //   workingSessionsCache   array of session shorts from get-working-sessions IPC
  //   initialMs              delay before first heartbeat in a silent stretch
  //   intervalMs             min gap between consecutive heartbeats
  //
  // Returns:
  //   { type: 'reset-silent', newSilentSince }
  //     Queue went active this tick — caller should set
  //     heartbeatSilentSince = newSilentSince (usually = now).
  //   { type: 'skip' }
  //     No action this tick. Do nothing.
  //   { type: 'emit', sessionShort, newLastHeartbeatAt }
  //     Fire speakHeartbeat IPC with this session's colour, then set
  //     lastHeartbeatAt = newLastHeartbeatAt.
  function decideHeartbeatAction(state) {
    const {
      now,
      heartbeatEnabled,
      isQueueActive,
      // HB4 — external app (Wispr Flow / Voice Access / VoIP) is using
      // the mic. User is dictating or on a call; suppress heartbeat
      // emission entirely so their speaking isn't talked over AND no
      // clips accumulate in the queue to burst-play on mic release.
      isSystemAutoPaused = false,
      heartbeatSilentSince,
      lastHeartbeatAt,
      workingSessionsCache,
      initialMs = 5000,
      intervalMs = 8000,
    } = state || {};

    if (!heartbeatEnabled) return { type: 'skip' };
    if (isSystemAutoPaused) return { type: 'skip' };
    if (isQueueActive) return { type: 'reset-silent', newSilentSince: now };

    const silentFor = now - heartbeatSilentSince;
    if (silentFor < initialMs) return { type: 'skip' };
    if (now - lastHeartbeatAt < intervalMs) return { type: 'skip' };

    const list = Array.isArray(workingSessionsCache) ? workingSessionsCache : [];
    if (list.length === 0) return { type: 'skip' };

    return {
      type: 'emit',
      sessionShort: list[0],
      newLastHeartbeatAt: now,
    };
  }

  return {
    SPINNER_VERBS,
    THINKING_PHRASES,
    PHRASE_MIX_RATIO,
    pickHeartbeatVerb,
    decideHeartbeatAction,
  };
}));
