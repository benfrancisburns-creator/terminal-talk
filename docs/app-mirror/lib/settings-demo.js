// Settings-demo timelines — extracted from app/renderer.js (2026-10-05) to
// bring the renderer back under the 2725-line file-length ceiling.
//
// Only runs in capture mode (`?windowMode=1&demoSettings=1`): the video /
// screenshot recorders (scripts/record-real-toolbar-videos.ps1,
// scripts/preview-settings-demo.cjs) launch the toolbar with those URL params
// and this module drives a fake cursor through the Settings panel, the
// Sessions table, the OpenAI section or the transcript panel on a fixed
// timeline. Production boots never reach any of this code.
//
// renderer.js passes every DOM ref / closure the timelines touch via `deps`
// so this file stays decoupled from renderer module globals (same pattern as
// the other app/lib/*.js UMD-lite components).

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_SETTINGS_DEMO = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function runSettingsDemo(deps = {}) {
    const {
      isSettingsDemoMode,
      settingsDemoVariant,
      settingsDemoUseStartFlag,
      settingsDemoFallbackMs,
      settingsDemoVisualDurationMs,
      settingsDemoStartPromise,
      setDynamicStyle,
      fmt,
      audioPlayer,
      transcriptPanel,
      setSettingsOpen,
      ensureSettingsTabForElement,
      scrubber,
      scrubberWrap,
      timeEl,
      playIcon,
      pauseIcon,
      tabsEl,
      sessionsTableEl,
      transcriptListEl,
    } = deps;
    if (!isSettingsDemoMode) return;

    function scrollSettingsPanelForDemo(top) {
      if (!isSettingsDemoMode) return;
      const panel = document.getElementById('panel');
      if (!panel) return;
      panel.scrollTo({ top, behavior: 'smooth' });
    }

    function expandFirstSessionForDemo() {
      if (!isSettingsDemoMode || !sessionsTableEl) return;
      const btn = sessionsTableEl.querySelector('.session-row .chevron');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') {
        btn.click();
      }
    }

    function demoWait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const demoCursor = document.createElement('div');
    demoCursor.className = 'demo-cursor';
    demoCursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(demoCursor);
    let demoCursorPos = { x: 42, y: 42 };

    function setDemoCursor(x, y) {
      const pad = 10;
      demoCursorPos = {
        x: Math.max(pad, Math.min(window.innerWidth - 36, x)),
        y: Math.max(pad, Math.min(window.innerHeight - 36, y)),
      };
      demoCursor.style.transform = `translate3d(${demoCursorPos.x}px, ${demoCursorPos.y}px, 0)`;
    }

    function elementCenter(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function demoElement(selectorOrFn) {
      if (typeof selectorOrFn === 'function') return selectorOrFn();
      return document.querySelector(selectorOrFn);
    }

    function moveDemoCursorTo(point, duration = 700) {
      if (!point) return Promise.resolve();
      const start = { ...demoCursorPos };
      const startedAt = performance.now();
      return new Promise((resolve) => {
        function tick(now) {
          const t = Math.min(1, (now - startedAt) / Math.max(1, duration));
          const eased = 1 - Math.pow(1 - t, 3);
          setDemoCursor(
            start.x + (point.x - start.x) * eased,
            start.y + (point.y - start.y) * eased
          );
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
    }

    async function pointDemoCursorAt(selectorOrFn, duration = 700) {
      const el = demoElement(selectorOrFn);
      ensureSettingsTabForElement(el);
      await moveDemoCursorTo(elementCenter(el), duration);
      return el;
    }

    async function pointDemoCursorAtPart(selectorOrFn, xRatio = 0.5, yRatio = 0.5, duration = 700) {
      const el = demoElement(selectorOrFn);
      if (!el) return null;
      ensureSettingsTabForElement(el);
      const rect = el.getBoundingClientRect();
      await moveDemoCursorTo({
        x: rect.left + (rect.width * xRatio),
        y: rect.top + (rect.height * yRatio),
      }, duration);
      return el;
    }

    function flashDemoClick() {
      demoCursor.classList.add('clicking');
      setTimeout(() => demoCursor.classList.remove('clicking'), 260);
    }

    let demoSelectPopup = null;

    function closeDemoSelectPopup() {
      setDynamicStyle('#demoSelectPopover', null);
      if (demoSelectPopup && demoSelectPopup.select) {
        try { demoSelectPopup.select.blur(); } catch {}
      }
      if (demoSelectPopup && demoSelectPopup.popover) {
        demoSelectPopup.popover.remove();
      }
      document.querySelectorAll('.demo-select-active').forEach((el) => {
        el.classList.remove('demo-select-active');
      });
      demoSelectPopup = null;
    }

    function demoSelectWindow(select, desiredValue, maxRows) {
      const options = Array.from(select.options || []);
      if (options.length <= maxRows) return options;
      const currentIndex = Math.max(0, select.selectedIndex || 0);
      const desiredIndex = Math.max(0, options.findIndex((opt) => opt.value === String(desiredValue)));
      const anchor = Math.min(currentIndex, desiredIndex);
      const start = Math.max(0, Math.min(options.length - maxRows, anchor - 1));
      return options.slice(start, start + maxRows);
    }

    function openDemoSelectPopup(select, desiredValue, maxRows = 7) {
      closeDemoSelectPopup();
      if (!select) return null;
      try { select.focus({ preventScroll: true }); } catch {}
      select.classList.add('demo-select-active');

      const rect = select.getBoundingClientRect();
      const options = demoSelectWindow(select, desiredValue, maxRows);
      const rowHeight = 28;
      const popoverHeight = Math.min(options.length, maxRows) * rowHeight + 8;
      const popover = document.createElement('div');
      popover.id = 'demoSelectPopover'; popover.className = 'demo-select-popover';

      for (const opt of options) {
        const item = document.createElement('div');
        item.className = 'demo-select-option';
        if (opt.selected) item.classList.add('selected');
        if (opt.value === String(desiredValue)) item.classList.add('target');
        item.dataset.value = opt.value;
        item.textContent = opt.textContent || opt.label || opt.value;
        popover.appendChild(item);
      }

      const placement = select.dataset.demoPlacement || '';
      if (placement === 'inline') {
        const row = select.closest('.expanded-row');
        popover.classList.add('demo-select-inline');
        if (row && row.parentElement) row.insertAdjacentElement('afterend', popover);
        else document.body.appendChild(popover);
      } else {
        const belowTop = rect.bottom + 4;
        const aboveTop = rect.top - popoverHeight - 4;
        const top = placement === 'below'
          ? Math.min(belowTop, Math.max(10, window.innerHeight - popoverHeight - 10))
          : belowTop + popoverHeight <= window.innerHeight - 10
          ? belowTop
          : Math.max(10, aboveTop);
        const popupCss = `left: ${Math.max(8, rect.left)}px; width: ${Math.max(190, rect.width)}px; top: ${top}px;`;
        setDynamicStyle('#demoSelectPopover', popupCss);
        document.body.appendChild(popover);
      }
      demoSelectPopup = { popover, select };
      return popover;
    }

    function demoSelectOption(value) {
      if (!demoSelectPopup || !demoSelectPopup.popover) return null;
      return Array.from(demoSelectPopup.popover.querySelectorAll('.demo-select-option'))
        .find((el) => el.dataset.value === String(value)) || null;
    }

    async function chooseDemoSelectOption(selectorOrFn, desiredValue, options = {}) {
      const {
        maxRows = 7,
        openHold = 1200,
        afterPickHold = 700,
        placement = '',
      } = options;
      const select = await pointDemoCursorAt(selectorOrFn, 700);
      if (!select) return null;
      if (placement) select.dataset.demoPlacement = placement;
      await demoWait(140);
      flashDemoClick();
      await demoWait(120);
      openDemoSelectPopup(select, desiredValue, maxRows);
      await demoWait(openHold);
      const optionEl = demoSelectOption(desiredValue);
      if (optionEl) {
        await pointDemoCursorAt(() => optionEl, 560);
        await demoWait(140);
        flashDemoClick();
        select.value = String(desiredValue);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        demoSelectPopup.popover.querySelectorAll('.demo-select-option').forEach((el) => {
          el.classList.toggle('selected', el.dataset.value === String(desiredValue));
        });
        await demoWait(afterPickHold);
      }
      closeDemoSelectPopup();
      if (placement) delete select.dataset.demoPlacement;
      await demoWait(220);
      return select;
    }

    async function clickDemoElement(selectorOrFn, action) {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch {}
      }
      const el = await pointDemoCursorAt(selectorOrFn, 620);
      await demoWait(120);
      flashDemoClick();
      if (typeof action === 'function') {
        setTimeout(action, 110);
      } else if (el && typeof el.click === 'function') {
        setTimeout(() => el.click(), 110);
      }
      await demoWait(360);
      return el;
    }

    function firstSessionBlock() {
      return sessionsTableEl && sessionsTableEl.querySelector('.session-block');
    }

    function firstSessionRowControl(selector) {
      const block = firstSessionBlock();
      return block ? block.querySelector(selector) : null;
    }

    function _scrollDemoElementIntoView(selectorOrFn, topPadding = 80) {
      const panel = document.getElementById('panel');
      const el = demoElement(selectorOrFn);
      if (!panel || !el) return;
      ensureSettingsTabForElement(el);
      const panelRect = panel.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const top = panel.scrollTop + (elRect.top - panelRect.top) - topPadding;
      panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    async function waitForSettingsDemoStart() {
      if (settingsDemoUseStartFlag && window.api && typeof window.api.demoStartReady === 'function') {
        while (true) {
          try {
            if (await window.api.demoStartReady()) return;
          } catch {}
          await demoWait(50);
        }
      }
      const fallback = settingsDemoFallbackMs > 0
        ? new Promise((resolve) => setTimeout(resolve, settingsDemoFallbackMs))
        : new Promise(() => {});
      await Promise.race([settingsDemoStartPromise, fallback]);
    }

    function startSettingsDemoPlaybackChrome(startedAt) {
      if (!settingsDemoVisualDurationMs || !scrubber || !timeEl) return;
      const durationSec = settingsDemoVisualDurationMs / 1000;
      if (playIcon) playIcon.classList.add('hidden');
      if (pauseIcon) pauseIcon.classList.remove('hidden');
      if (scrubberWrap) {
        scrubberWrap.classList.remove('jarvis-mode', 'scrubbing', 'scrubbing-forward', 'scrubbing-backward');
        scrubberWrap.classList.add('walking');
      }
      const heartbeatInitialMs = window.TT_HEARTBEAT.HEARTBEAT_INITIAL_MS || 5000;
      const heartbeatIntervalMs = window.TT_HEARTBEAT.HEARTBEAT_INTERVAL_MS || 8000;
      let nextDemoHeartbeatVerbAt = startedAt + heartbeatInitialMs;
      const tick = () => {
        const now = performance.now();
        const elapsedSec = Math.min(durationSec, Math.max(0, (now - startedAt) / 1000));
        scrubber.value = String(Math.round((elapsedSec / Math.max(0.001, durationSec)) * 1000));
        timeEl.textContent = `${fmt(elapsedSec)} / ${fmt(durationSec)}`;
        if (audioPlayer && typeof audioPlayer.positionScrubberMascot === 'function') {
          audioPlayer.positionScrubberMascot();
        }
        if (
          audioPlayer &&
          typeof audioPlayer.emitDemoSpinnerVerbCloud === 'function' &&
          (window.TT_CONFIG_SNAPSHOT || {}).heartbeat_enabled !== false &&
          now >= nextDemoHeartbeatVerbAt
        ) {
          audioPlayer.emitDemoSpinnerVerbCloud(now, { intervalMs: heartbeatIntervalMs });
          do {
            nextDemoHeartbeatVerbAt += heartbeatIntervalMs;
          } while (nextDemoHeartbeatVerbAt <= now);
        }
        if (elapsedSec < durationSec) {
          requestAnimationFrame(tick);
        } else if (scrubberWrap) {
          scrubberWrap.classList.remove('walking');
        }
      };
      requestAnimationFrame(tick);
    }

    function openAiSectionRow(selector) {
      const el = document.querySelector(selector);
      return el ? el.closest('.row') || el : null;
    }

    async function ensureOpenAiSectionReadyForDemo() {
      const section = document.getElementById('openaiSection');
      if (section && typeof section.scrollIntoView === 'function') {
        section.scrollIntoView({ block: 'start' });
        await demoWait(80);
      }
    }

    async function runOpenAiDemoTimeline() {
      setDemoCursor(window.innerWidth - 90, 62);
      await waitForSettingsDemoStart();
      const startedAt = performance.now();
      startSettingsDemoPlaybackChrome(startedAt);
      async function waitUntil(ms) {
        const remaining = startedAt + ms - performance.now();
        if (remaining > 0) await demoWait(remaining);
      }

      await waitUntil(250);
      await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));
      await waitUntil(1500);
      await clickDemoElement('[data-settings-tab="openai"]');
      await waitUntil(2400);
      await pointDemoCursorAt('#openaiSection header', 700);
      await waitUntil(4200);
      await ensureOpenAiSectionReadyForDemo();
      await waitUntil(6500);
      await pointDemoCursorAt('#openaiSection .panel-hint', 820);
      await waitUntil(11800);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiKeyInput') || openAiSectionRow('#openaiKeyChange'), 760);
      await waitUntil(17800);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiKeyStatus'), 720);
      await waitUntil(23000);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiPreferToggle'), 720);
      await waitUntil(27200);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiFallbackToggle'), 720);
      await waitUntil(31500);
      await clickDemoElement(() => openAiSectionRow('#openaiPreferToggle')?.querySelector('.tri-btn.on'));
      await waitUntil(36500);
      await clickDemoElement(() => openAiSectionRow('#openaiFallbackToggle')?.querySelector('.tri-btn.on'));
      await waitUntil(40500);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiTestBtn'), 760);
      await waitUntil(45200);
      await clickDemoElement(() => openAiSectionRow('#openaiFallbackToggle')?.querySelector('.tri-btn.off'));
      await waitUntil(49200);
      await clickDemoElement(() => openAiSectionRow('#openaiPreferToggle')?.querySelector('.tri-btn.off'));
      await waitUntil(51200);
      await pointDemoCursorAt('#openaiSection header', 700);
    }

    async function runSessionsSyncDemoTimeline() {
      setDemoCursor(window.innerWidth - 90, 62);
      await waitForSettingsDemoStart();
      const startedAt = performance.now();
      startSettingsDemoPlaybackChrome(startedAt);
      async function waitUntil(ms) {
        const remaining = startedAt + ms - performance.now();
        if (remaining > 0) await demoWait(remaining);
      }

      await waitUntil(350);
      await pointDemoCursorAt(() => tabsEl, 700);
      await waitUntil(3000);
      await pointDemoCursorAt('#dots', 700);
      await waitUntil(6000);
      await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));
      await waitUntil(7800);
      await clickDemoElement('[data-settings-tab="sessions"]');
      await waitUntil(9300);
      await pointDemoCursorAt(() => sessionsTableEl, 700);
      await waitUntil(13200);
      await pointDemoCursorAt(() => firstSessionRowControl('input[type="text"]'), 700);
      await waitUntil(17600);
      await chooseDemoSelectOption(() => firstSessionRowControl('.session-row select'), '17', {
        maxRows: 7,
        openHold: 1500,
        afterPickHold: 800,
      });
      await waitUntil(24400);
      await pointDemoCursorAt(() => firstSessionRowControl('.focus-btn'), 680);
      await waitUntil(29000);
      await pointDemoCursorAt(() => firstSessionRowControl('.mute-btn'), 680);
      await waitUntil(33400);
      await clickDemoElement(() => firstSessionRowControl('.chevron'), expandFirstSessionForDemo);
      await waitUntil(35400);
      scrollSettingsPanelForDemo(320);
      await waitUntil(37200);
      await chooseDemoSelectOption(() => firstSessionRowControl('.session-expanded select'), 'en-GB-SoniaNeural', {
        maxRows: 6,
        openHold: 2100,
        afterPickHold: 900,
        placement: 'inline',
      });
      await waitUntil(45200);
      await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type'), 740);
      await waitUntil(49200);
      await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type .tri-btn.off'));
      await waitUntil(53200);
      await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type'), 740);
      await waitUntil(57000);
      await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type .tri-cell:nth-child(7) .tri-btn.on'));
      await waitUntil(61000);
      await clickDemoElement('[data-settings-tab="about"]');
      await waitUntil(62600);
      await pointDemoCursorAt('.panel-section.about .panel-hint:last-of-type', 760);
    }

    async function runTranscriptDemoTimeline() {
      setDemoCursor(window.innerWidth - 90, 62);
      await waitForSettingsDemoStart();
      const startedAt = performance.now();
      startSettingsDemoPlaybackChrome(startedAt);
      async function waitUntil(ms) {
        const remaining = startedAt + ms - performance.now();
        if (remaining > 0) await demoWait(remaining);
      }

      await waitUntil(450);
      await pointDemoCursorAt('#dots', 740);
      await waitUntil(4300);
      await clickDemoElement('#transcriptToggle', () => {
        if (transcriptPanel && typeof transcriptPanel.setExpanded === 'function') {
          transcriptPanel.setExpanded(true);
        }
      });
      await waitUntil(7600);
      await pointDemoCursorAt('#transcriptList', 780);
      await waitUntil(13500);
      await pointDemoCursorAt('#transcriptViewToggle', 700);
      await waitUntil(17500);
      await clickDemoElement('#transcriptViewToggle');
      await waitUntil(22500);
      await pointDemoCursorAt(() => transcriptListEl && transcriptListEl.querySelector('.transcript-copy'), 700);
      await waitUntil(28500);
      await pointDemoCursorAt(() => tabsEl, 740);
      await waitUntil(34000);
      await clickDemoElement(() => tabsEl && tabsEl.querySelector('[role="tab"]:not([data-tab-id="all"])'));
      await waitUntil(40500);
      await clickDemoElement(() => tabsEl && tabsEl.querySelector('[data-tab-id="all"]'));
      await waitUntil(46800);
      await pointDemoCursorAt('#transcriptList', 700);
    }

    async function runSettingsDemoTimeline() {
      setDemoCursor(window.innerWidth - 90, 62);
      await waitForSettingsDemoStart();
      const startedAt = performance.now();
      startSettingsDemoPlaybackChrome(startedAt);
      async function waitUntil(ms) {
        const remaining = startedAt + ms - performance.now();
        if (remaining > 0) await demoWait(remaining);
      }

      await waitUntil(250);
      await clickDemoElement('#settingsBtn', () => setSettingsOpen(true).catch(() => {}));

      await waitUntil(1700);
      scrollSettingsPanelForDemo(0);
      await pointDemoCursorAt('#speedSlider', 780);
      await waitUntil(3300);
      await pointDemoCursorAt('#volumeSlider', 720);
      await waitUntil(4700);
      await pointDemoCursorAt('#collapseDelaySec', 720);
      await waitUntil(6200);
      await pointDemoCursorAtPart(() => document.querySelector('label[for="autoPruneToggle"]')?.closest('.row'), 0.36, 0.5, 800);
      await waitUntil(8300);
      await pointDemoCursorAt('#autoPruneSec', 720);
      await waitUntil(10100);
      await pointDemoCursorAt(() => document.querySelector('#heartbeatToggle')?.closest('.row'), 700);
      await waitUntil(11800);
      await pointDemoCursorAt(() => document.querySelector('#incToolCalls')?.closest('.row'), 700);

      await waitUntil(14000);
      await pointDemoCursorAtPart(() => document.querySelector('label[for="autoPruneToggle"]')?.closest('.row'), 0.36, 0.5, 450);
      await waitUntil(19000);
      await pointDemoCursorAt(() => document.querySelector('#heartbeatToggle')?.closest('.row'), 650);
      await waitUntil(22500);
      await pointDemoCursorAt(() => document.querySelector('#incToolCalls')?.closest('.row'), 650);

      await waitUntil(25000);
      await clickDemoElement('[data-settings-tab="openai"]');
      await waitUntil(26000);
      await ensureOpenAiSectionReadyForDemo();
      await waitUntil(27000);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiPreferToggle'), 680);
      await waitUntil(30000);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiFallbackToggle'), 680);
      await waitUntil(33500);
      await pointDemoCursorAt(() => openAiSectionRow('#openaiTestBtn'), 680);

      await waitUntil(36500);
      await clickDemoElement('[data-settings-tab="shortcuts"]');
      await waitUntil(38200);
      await pointDemoCursorAt('#hotkeyToggleWindow', 700);
      await waitUntil(41000);
      await clickDemoElement('#hotkeyToggleWindow');
      await waitUntil(43800);
      await pointDemoCursorAt('#hotkeyResetDefaults', 650);

      await waitUntil(47000);
      await clickDemoElement('[data-settings-tab="sessions"]');
      await waitUntil(48800);
      await pointDemoCursorAt(() => sessionsTableEl, 650);
      await waitUntil(50600);
      await pointDemoCursorAt(() => firstSessionRowControl('input[type="text"]'), 740);
      await waitUntil(52600);
      await pointDemoCursorAt(() => firstSessionRowControl('.focus-btn'), 620);
      await waitUntil(54400);
      await pointDemoCursorAt(() => firstSessionRowControl('.mute-btn'), 620);
      await waitUntil(56200);
      await chooseDemoSelectOption(() => firstSessionRowControl('.session-row select'), '1', {
        maxRows: 6,
        openHold: 1500,
        afterPickHold: 900,
      });

      await waitUntil(60000);
      await clickDemoElement(() => firstSessionRowControl('.chevron'), expandFirstSessionForDemo);
      await waitUntil(61200);
      scrollSettingsPanelForDemo(300);
      await waitUntil(62500);
      await chooseDemoSelectOption(() => firstSessionRowControl('.session-expanded select'), 'en-GB-RyanNeural', {
        maxRows: 5,
        openHold: 2300,
        afterPickHold: 950,
        placement: 'inline',
      });

      await waitUntil(67500);
      scrollSettingsPanelForDemo(350);
      await waitUntil(68600);
      await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type'), 720);
      await waitUntil(70400);
      await clickDemoElement(() => firstSessionRowControl('.session-expanded .tri-grid:first-of-type .tri-btn.off'));
      await waitUntil(72400);
      await pointDemoCursorAt(() => firstSessionRowControl('.session-expanded .tri-grid:last-of-type'), 620);

      await waitUntil(74200);
      await clickDemoElement('[data-settings-tab="about"]');
      await waitUntil(75800);
      await pointDemoCursorAt('.about-wallpaper-card', 900);
    }

    const timeline = settingsDemoVariant === 'openai'
      ? runOpenAiDemoTimeline
      : settingsDemoVariant === 'sessions'
      ? runSessionsSyncDemoTimeline
      : settingsDemoVariant === 'transcript'
      ? runTranscriptDemoTimeline
      : runSettingsDemoTimeline;
    timeline().catch(() => {});
  }

  return { runSettingsDemo };
}));
