'use strict';

// Phase 6 (#30) first-run permission wizard for macOS.
//
// On a fresh Mac install the user otherwise hits three permission
// prompts at random moments — Accessibility (the first time
// Ctrl+Shift+S synthesises Cmd+C), Microphone (the first time the
// wake-word listener captures audio), Speech Recognition (the first
// time a "hey jarvis play" voice command fires), and Dictation setup
// (needed for the start-dictation hotkey). A guided modal walks them
// through each item before any of those subsystems fire for real, so
// prompts arrive in a predictable order with context.
//
// Skippable: each step has "Skip — I'll grant later" so power users
// can dismiss; the wizard is re-runnable from Settings via
// `wireFirstRunWizard().show()`.
//
// Architecture: UMD-style factory matching app/lib/voice-command-
// dispatch.js + update-badge.js so it can run in renderer + ui-kit
// fixture pages without bundler magic. Caller injects window.api so
// tests can swap in a mock IPC.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TT_FIRST_RUN_WIZARD = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Step definitions — keep in lock-step with the index.html modal
  // body. Each step is a {key, label, blurb, settingsURL} record.
  // settingsURL is an `x-apple.systempreferences:` deep link that
  // jumps to the right pane in System Settings; main-side allowlists
  // these prefixes.
  const STEPS = [
    {
      key: 'accessibility',
      label: 'Accessibility',
      blurb:
        'Lets Terminal Talk send the Cmd+C keystroke that copies your highlighted text when you press Ctrl+Shift+S or fire the wake word. Without this, highlight-to-speak silently does nothing.',
      settingsURL: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    },
    {
      key: 'microphone',
      label: 'Microphone',
      blurb:
        'Lets the openWakeWord listener detect "hey jarvis" near your mic. All processing is local — audio never leaves your machine.',
      settingsURL: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    },
    {
      key: 'speech',
      label: 'Speech Recognition',
      blurb:
        'Lets voice commands ("hey jarvis play / pause / next / back / stop") work after wake-word detection. Uses macOS’s on-device recognizer; audio stays local.',
      settingsURL: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
    },
    {
      key: 'dictation',
      label: 'Dictation',
      blurb:
        'Turn on Apple Dictation so Ctrl+Shift+D can pause Terminal Talk and put your spoken prompt into the focused app. This uses macOS Dictation, not Terminal Talk recording your words.',
      settingsURL: 'x-apple.systempreferences:com.apple.preference.keyboard',
    },
  ];

  function wireFirstRunWizard({ api, modalEl, onComplete = () => {} } = {}) {
    if (!modalEl) {
      // No modal in DOM — graceful no-op (e.g., demo / window mode).
      return { show: () => {}, hide: () => {}, isShowing: () => false };
    }
    let stepIdx = 0;

    const titleEl = modalEl.querySelector('[data-frw-title]');
    const blurbEl = modalEl.querySelector('[data-frw-blurb]');
    const stepDotsEl = modalEl.querySelector('[data-frw-stepdots]');
    const openBtn = modalEl.querySelector('[data-frw-open]');
    const grantedBtn = modalEl.querySelector('[data-frw-granted]');
    const skipBtn = modalEl.querySelector('[data-frw-skip]');
    const closeBtn = modalEl.querySelector('[data-frw-close]');

    function render() {
      const step = STEPS[stepIdx];
      if (titleEl) titleEl.textContent = `Step ${stepIdx + 1} of ${STEPS.length}: ${step.label}`;
      if (blurbEl) blurbEl.textContent = step.blurb;
      if (stepDotsEl) {
        stepDotsEl.innerHTML = '';
        for (let i = 0; i < STEPS.length; i++) {
          const d = document.createElement('span');
          d.className = 'frw-step-dot' + (i === stepIdx ? ' active' : i < stepIdx ? ' done' : '');
          stepDotsEl.appendChild(d);
        }
      }
      if (closeBtn) closeBtn.classList[stepIdx === STEPS.length - 1 ? 'remove' : 'add']('frw-hidden');
    }

    function show() {
      stepIdx = 0;
      modalEl.classList.add('open');
      modalEl.setAttribute('aria-hidden', 'false');
      render();
    }

    function hide() {
      modalEl.classList.remove('open');
      modalEl.setAttribute('aria-hidden', 'true');
    }

    function isShowing() {
      return modalEl.classList.contains('open');
    }

    function next() {
      if (stepIdx < STEPS.length - 1) {
        stepIdx += 1;
        render();
      } else {
        hide();
        try { onComplete(); } catch {}
      }
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const url = STEPS[stepIdx].settingsURL;
        try {
          if (api && typeof api.openExternal === 'function') {
            api.openExternal(url);
          }
        } catch {}
      });
    }
    if (grantedBtn) grantedBtn.addEventListener('click', () => next());
    if (skipBtn) skipBtn.addEventListener('click', () => next());
    if (closeBtn) closeBtn.addEventListener('click', () => { hide(); try { onComplete(); } catch {} });

    return { show, hide, isShowing, _STEPS: STEPS };
  }

  // Helper that decides whether to fire on a first launch + handles
  // platform-specific UX (Mac wizard vs Win/Linux welcome toast).
  // Lives in this module so renderer.js doesn't carry the trigger
  // logic + stays under its file-length ceiling.
  function triggerOnFirstRun({ cfg, api, modalEl, showStatusToast } = {}) {
    if (!cfg || cfg.first_run_completed !== false) return;
    const isMac = api && api.platform === 'darwin';
    if (isMac && modalEl) {
      const w = wireFirstRunWizard({ api, modalEl });
      try { w.show(); } catch {}
    } else if (typeof showStatusToast === 'function') {
      const speakKey = (cfg.hotkeys && cfg.hotkeys.speak_clipboard) || 'Ctrl+Shift+S';
      const showHideKey = (cfg.hotkeys && cfg.hotkeys.toggle_window) || 'Ctrl+Shift+A';
      showStatusToast(
        `Welcome to Terminal Talk. The toolbar is here, top of your screen — drag it anywhere. Highlight any text and press ${speakKey} to hear it read aloud. Press ${showHideKey} to show or hide the toolbar. Click the gear for Settings.`,
        15000,
        'info'
      );
    }
    if (api && typeof api.updateConfig === 'function') {
      try {
        const p = api.updateConfig({ first_run_completed: true });
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            try {
              if (api.logRendererError) {
                api.logRendererError({
                  type: 'unhandledrejection',
                  message: `failed to persist first_run_completed: ${err && err.message ? err.message : String(err)}`,
                  stack: err && err.stack ? err.stack : '',
                });
              }
            } catch {}
          });
        }
      } catch {}
    }
  }

  return { wireFirstRunWizard, triggerOnFirstRun, STEPS };
}));
