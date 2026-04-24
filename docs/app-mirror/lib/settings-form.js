// EX7d-2 — global settings form extracted from app/renderer.js.
//
// Owns the controls on the left side of the settings panel: playback
// speed slider, auto-prune on/off + seconds, auto-continue-after-
// click, reload-toolbar button, palette-variant (default / CB),
// global voice <select>s (edge response + clip, openai response +
// clip), and the speech-includes checkboxes row.
//
// The component doesn't BUILD any of the settings-panel DOM — those
// elements live in index.html. It queries them by id on mount(),
// wires every change listener once, and then populates every form
// field's value in update({ cfg }). Values that renderer.js consumes
// elsewhere (currentPlaybackSpeed, autoPruneSec, autoContinueAfterClick)
// propagate back via deps callbacks, so the component is fully
// decoupled from renderer module globals.
//
// Why separate from SessionsTable: different lifecycle cadence. The
// table repaints on every queue-updated event; the form loads once
// then only reflects cfg changes when the panel reopens. Mixing them
// would require one update() call to do both, which is slower than
// necessary and muddies the "form listeners wire once" invariant.

(function (root, factory) {
  'use strict';
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./component')
      : { Component: root.TT_COMPONENT }
  );
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TT_SETTINGS_FORM = api.SettingsForm;
  }
}(typeof self !== 'undefined' ? self : this, function (componentModule) {
  'use strict';

  const { Component } = componentModule;

  class SettingsForm extends Component {
    constructor(deps = {}) {
      super(deps);
      const {
        api,                       // window.api
        edgeVoices = [],
        openaiVoices = [],
        // Callbacks that update renderer module state when the form changes.
        onPlaybackSpeedChange = () => {},
        onMasterVolumeChange = () => {},
        onAutoPruneEnabledChange = () => {},
        onAutoPruneSecChange = () => {},
        onAutoContinueChange = () => {},
        // Fired after any settings-form mutation that needs the
        // renderer to repaint state derived from config — specifically
        // the per-session voice dropdown when the "Use OpenAI as
        // primary" toggle flips, so the right voice catalogue appears
        // without requiring a toolbar reload.
        onAfterMutation = () => {},
      } = deps;
      this._api = api;
      this._edgeVoices = edgeVoices;
      this._openaiVoices = openaiVoices;
      this._onPlaybackSpeedChange = onPlaybackSpeedChange;
      this._onMasterVolumeChange = onMasterVolumeChange;
      this._onAutoPruneEnabledChange = onAutoPruneEnabledChange;
      this._onAutoPruneSecChange = onAutoPruneSecChange;
      this._onAutoContinueChange = onAutoContinueChange;
      this._onAfterMutation = onAfterMutation;
    }

    _onMount() {
      // Cache every DOM ref once. None of these are required to exist —
      // the product's current index.html has them all, but the kit and
      // any future variant index may not. Per-query guards below are
      // belt-and-braces.
      this._el = {
        speedSlider:      document.getElementById('speedSlider'),
        speedValue:       document.getElementById('speedValue'),
        volumeSlider:     document.getElementById('volumeSlider'),
        volumeValue:      document.getElementById('volumeValue'),
        pruneToggle:      document.getElementById('autoPruneToggle'),
        pruneSecInput:    document.getElementById('autoPruneSec'),
        continueToggle:   document.getElementById('autoContinueToggle'),
        reloadBtn:        document.getElementById('reloadToolbar'),
        paletteToggle:    document.getElementById('paletteVariantToggle'),
        heartbeatToggle:  document.getElementById('heartbeatToggle'),
        versionLabel:     document.getElementById('versionLabel'),
        voiceEdgeResp:    document.getElementById('voiceEdgeResponse'),
        voiceEdgeClip:    document.getElementById('voiceEdgeClip'),
        voiceOaiResp:     document.getElementById('voiceOpenaiResponse'),
        voiceOaiClip:     document.getElementById('voiceOpenaiClip'),
        // OpenAI (premium) Settings section.
        openaiKeyInput:   document.getElementById('openaiKeyInput'),
        openaiKeySave:    document.getElementById('openaiKeySave'),
        openaiKeyClear:   document.getElementById('openaiKeyClear'),
        openaiKeyStatus:  document.getElementById('openaiKeyStatus'),
        // Key-saved compact row refs (the "hide input when saved" UX).
        openaiKeyInputRow:  document.getElementById('openaiKeyInputRow'),
        openaiKeyChangeRow: document.getElementById('openaiKeyChangeRow'),
        openaiKeyChange:    document.getElementById('openaiKeyChange'),
        openaiKeyClear2:    document.getElementById('openaiKeyClear2'),
        // Section-collapse refs.
        openaiSection:      document.getElementById('openaiSection'),
        openaiSectionToggle: document.getElementById('openaiSectionToggle'),
        openaiPreferToggle: document.getElementById('openaiPreferToggle'),
        openaiPreferPillBox: document.getElementById('openaiPreferPillBox'),
        openaiTestBtn:    document.getElementById('openaiTestBtn'),
        openaiTestResult: document.getElementById('openaiTestResult'),
        // Speech-includes checkboxes follow a consistent naming scheme.
        incBoxes: {
          code_blocks:    document.getElementById('incCodeBlocks'),
          inline_code:    document.getElementById('incInlineCode'),
          urls:           document.getElementById('incUrls'),
          headings:       document.getElementById('incHeadings'),
          bullet_markers: document.getElementById('incBulletMarkers'),
          image_alt:      document.getElementById('incImageAlt'),
        },
      };
      this._wirePillToggles();
      this._wireSpeedSlider();
      this._wireVolumeSlider();
      this._wireAutoPrune();
      this._wireAutoContinue();
      this._wireReloadButton();
      this._wirePaletteVariant();
      this._wireHeartbeatToggle();
      this._wireVoiceSelects();
      this._wireIncludeBoxes();
      this._wireOpenAiSection();
      this._loadVersion();
    }

    // Populate from config. Safe to call multiple times — values
    // overwrite but listeners were wired once at mount.
    _onUpdate() {
      const cfg = this.state && this.state.cfg;
      if (!cfg) return;
      this._populateSpeed(cfg);
      this._populateVolume(cfg);
      this._populateAutoPrune(cfg);
      this._populateAutoContinue(cfg);
      this._populatePaletteVariant(cfg);
      this._populateHeartbeat(cfg);
      this._populateVoiceSelects(cfg);
      this._populateIncludeBoxes(cfg);
      this._populateOpenAi(cfg);
    }

    // ---- Wire-up (mount-time, idempotent) --------------------------

    // Two-button On/Off pill replaces the old iOS-slider checkbox skin
    // for panel toggles. The underlying <input type=checkbox> is still
    // the source of truth so every _wireX() below keeps working without
    // change — clicking a pill button flips input.checked, then fires
    // a 'change' event so the existing handlers run. The 'active' class
    // on the buttons is synced from the input's state.
    //
    // Uses the already-cached input refs rather than a document query
    // so the JSDOM-less test harness (which stubs getElementById but
    // not querySelectorAll) can still exercise mount().
    // Fire the custom 'pill-sync' event on a checkbox input so any pill
    // buttons paired with it refresh their active class. No-op on fake
    // test DOM elements that don't implement dispatchEvent.
    _syncPill(input) {
      if (!input || typeof input.dispatchEvent !== 'function') return;
      try { input.dispatchEvent(new Event('pill-sync')); } catch {}
    }

    _wirePillToggles() {
      const inputs = [
        this._el.pruneToggle,
        this._el.continueToggle,
        this._el.paletteToggle,
        this._el.heartbeatToggle,
        this._el.openaiPreferToggle,
      ];
      for (const input of inputs) {
        if (!input || !input.parentElement) continue;
        const group = input.parentElement;
        if (!group.querySelector) continue;  // test stub: skip pill UI
        const onBtn  = group.querySelector('.tri-btn.on');
        const offBtn = group.querySelector('.tri-btn.off');
        const sync = () => {
          if (onBtn)  onBtn.classList.toggle('active',  input.checked);
          if (offBtn) offBtn.classList.toggle('active', !input.checked);
        };
        if (onBtn) this._on(onBtn, 'click', () => {
          if (input.checked) return;
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
        });
        if (offBtn) this._on(offBtn, 'click', () => {
          if (!input.checked) return;
          input.checked = false;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
        });
        // Keep the pills in sync when code (populate functions) changes
        // the input's .checked directly. 'change' fires only on user
        // interaction; 'pill-sync' is a custom event the populate
        // helpers dispatch after programmatic .checked writes so the
        // pill visuals refresh without re-firing the IPC-writing
        // change handlers.
        this._on(input, 'change', sync);
        this._on(input, 'pill-sync', sync);
        sync();
      }
    }

    _wireSpeedSlider() {
      const { speedSlider, speedValue } = this._el;
      if (!speedSlider) return;
      this._on(speedSlider, 'input', () => {
        const v = Math.max(0.5, Math.min(2.5, Number(speedSlider.value) / 100));
        if (speedValue) speedValue.textContent = `${v.toFixed(2)}x`;
        this._onPlaybackSpeedChange(v);
      });
      this._on(speedSlider, 'change', async () => {
        const v = Math.max(0.5, Math.min(2.5, Number(speedSlider.value) / 100));
        await this._api.updateConfig({ playback: { speed: v } });
      });
    }

    _wireVolumeSlider() {
      // Master volume 0-100 on the slider, stored 0.0-1.0 in config.
      // 'input' event applies live so dragging is audible mid-clip;
      // 'change' persists once released so we don't spam updateConfig
      // for every pixel of drag.
      const { volumeSlider, volumeValue } = this._el;
      if (!volumeSlider) return;
      this._on(volumeSlider, 'input', () => {
        const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
        const v = pct / 100;
        if (volumeValue) volumeValue.textContent = `${Math.round(pct)}%`;
        this._onMasterVolumeChange(v);
      });
      this._on(volumeSlider, 'change', async () => {
        const pct = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
        const v = pct / 100;
        await this._api.updateConfig({ playback: { master_volume: v } });
      });
    }

    _wireAutoPrune() {
      const { pruneToggle, pruneSecInput } = this._el;
      if (pruneToggle) {
        this._on(pruneToggle, 'change', async () => {
          const on = pruneToggle.checked;
          this._onAutoPruneEnabledChange(on);
          if (pruneSecInput) pruneSecInput.disabled = !on;
          await this._api.updateConfig({ playback: { auto_prune: on } });
        });
      }
      if (pruneSecInput) {
        this._on(pruneSecInput, 'change', async () => {
          const n = Math.max(3, Math.min(600, Math.floor(Number(pruneSecInput.value) || 20)));
          pruneSecInput.value = String(n);  // clamp display too
          this._onAutoPruneSecChange(n);
          await this._api.updateConfig({ playback: { auto_prune_sec: n } });
        });
      }
    }

    _wireAutoContinue() {
      const { continueToggle } = this._el;
      if (!continueToggle) return;
      this._on(continueToggle, 'change', async () => {
        const on = continueToggle.checked;
        this._onAutoContinueChange(on);
        await this._api.updateConfig({ playback: { auto_continue_after_click: on } });
      });
    }

    _wireReloadButton() {
      const { reloadBtn } = this._el;
      if (!reloadBtn) return;
      // EX3 — reload-toolbar button. Hits main.js's reload-renderer IPC
      // which calls win.webContents.reload(). Same action as the
      // Ctrl+R keyboard shortcut main registers via before-input-event.
      this._on(reloadBtn, 'click', () => { this._api.reloadRenderer(); });
    }

    _wirePaletteVariant() {
      const { paletteToggle } = this._el;
      if (!paletteToggle) return;
      // EX5 / H3 Option 2 — palette variant toggle writes the chosen
      // variant onto body[data-palette-variant]; the CSS in
      // app/lib/palette-classes.css has a higher-specificity rule block
      // that only applies when the attr === 'cb'.
      this._on(paletteToggle, 'change', async () => {
        const next = paletteToggle.checked ? 'cb' : 'default';
        document.body.dataset.paletteVariant = next;
        await this._api.updateConfig({ playback: { palette_variant: next } });
      });
    }

    _wireHeartbeatToggle() {
      const { heartbeatToggle } = this._el;
      if (!heartbeatToggle) return;
      // HB1/HB2 — ambient narration toggle. Writes top-level
      // `heartbeat_enabled` (not inside speech_includes — it isn't a
      // sanitisation rule, it's a behaviour). Renderer's HB2 poll
      // reads TT_CONFIG_SNAPSHOT.heartbeat_enabled; loadSettings()
      // refreshes the snapshot on every panel open, so the toggle
      // takes effect within one tick without a reload.
      this._on(heartbeatToggle, 'change', async () => {
        const on = !!heartbeatToggle.checked;
        await this._api.updateConfig({ heartbeat_enabled: on });
        if (window.TT_CONFIG_SNAPSHOT) window.TT_CONFIG_SNAPSHOT.heartbeat_enabled = on;
      });
    }

    async _loadVersion() {
      const { versionLabel } = this._el;
      if (!versionLabel || !this._api || !this._api.getVersion) return;
      try {
        const v = await this._api.getVersion();
        if (v) versionLabel.textContent = `v${v}`;
      } catch {}
    }

    _wireVoiceSelects() {
      const pairs = [
        [this._el.voiceEdgeResp, 'edge_response'],
        [this._el.voiceEdgeClip, 'edge_clip'],
        [this._el.voiceOaiResp,  'openai_response'],
        [this._el.voiceOaiClip,  'openai_clip'],
      ];
      for (const [el, key] of pairs) {
        if (!el) continue;
        this._on(el, 'change', async () => {
          await this._api.updateConfig({ voices: { [key]: el.value } });
        });
      }
    }

    _wireIncludeBoxes() {
      for (const [key, el] of Object.entries(this._el.incBoxes)) {
        if (!el) continue;
        this._on(el, 'change', async () => {
          await this._api.updateConfig({ speech_includes: { [key]: el.checked } });
        });
      }
    }

    // OpenAI (premium) — save/clear key + prefer toggle + test button.
    // Key input is password-typed so it never renders plaintext on screen.
    // Save → update-config IPC routes openai_api_key through apiKeyStore
    // (encrypts + sidecar). Clear sends empty string which the store
    // reads as "wipe both files". Prefer toggle sets playback.tts_provider.
    // Test button invokes a one-shot synth through the active provider.
    _wireOpenAiSection() {
      const {
        openaiKeyInput, openaiKeySave, openaiKeyClear,
        openaiPreferToggle, openaiTestBtn,
        openaiSection, openaiSectionToggle,
        openaiKeyChange, openaiKeyClear2,
      } = this._el;

      // In-memory flag: user explicitly clicked "Change key" to rotate
      // a previously-saved key. Overrides the auto-collapse for this
      // panel session so the input stays visible until they Save / Clear.
      this._openaiUserWantsInput = false;
      // Same pattern for last-test-failed: once the Test button comes
      // back !ok, we keep the input visible + the section expanded so
      // the user can rotate the key without hunting for a toggle.
      this._openaiLastTestFailed = false;

      // Runtime 401 auto-unset listener. main.js watches a flag file
      // synth_turn.py drops when openai_tts.py returns HTTP 401 during
      // a real (non-test) synth. By the time we get this event main
      // has already cleared the encrypted key + flipped tts_provider
      // back to 'edge'. We just need to make the UI reflect it:
      // expand the section, reveal the input row, and show a red
      // "key rejected" message so the user knows to re-enter.
      if (this._api && typeof this._api.onOpenaiKeyInvalid === 'function') {
        this._api.onOpenaiKeyInvalid(() => {
          this._openaiLastTestFailed = true;
          this._openaiUserWantsInput = true;
          if (openaiSection && openaiSection.classList.contains('collapsed')) {
            openaiSection.classList.remove('collapsed');
            if (openaiSectionToggle) openaiSectionToggle.setAttribute('aria-expanded', 'true');
          }
          this._setTestResult('OpenAI rejected your key during a synth (HTTP 401). Provider reset to Edge; re-enter a valid key to re-enable OpenAI.', 'err');
          this._refreshOpenAiStatus();
        });
      }

      // Section-collapse toggle on the OpenAI header.
      if (openaiSectionToggle && openaiSection) {
        this._on(openaiSectionToggle, 'click', () => {
          const willCollapse = !openaiSection.classList.contains('collapsed');
          openaiSection.classList.toggle('collapsed', willCollapse);
          openaiSectionToggle.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
        });
      }

      // "Change key" — user wants to rotate the key. Reveal the input
      // row for this panel session.
      if (openaiKeyChange) {
        this._on(openaiKeyChange, 'click', () => {
          this._openaiUserWantsInput = true;
          this._refreshOpenAiStatus();
          if (openaiKeyInput) openaiKeyInput.focus();
        });
      }
      // Second Clear button lives on the compact row.
      if (openaiKeyClear2) {
        this._on(openaiKeyClear2, 'click', async () => {
          this._setTestResult('Clearing…', 'busy');
          await this._api.updateConfig({ openai_api_key: '' });
          if (openaiKeyInput) openaiKeyInput.value = '';
          await this._api.updateConfig({ playback: { tts_provider: 'edge' } });
          this._setTestResult('Key cleared. Provider reset to Edge.', 'ok');
          this._openaiUserWantsInput = false;
          this._openaiLastTestFailed = false;
          await this._refreshOpenAiStatus();
        });
      }

      if (openaiKeySave) {
        this._on(openaiKeySave, 'click', async () => {
          if (!openaiKeyInput) return;
          const key = (openaiKeyInput.value || '').trim();
          if (!key) {
            // Empty save is a user slip, not a clear. Guide, don't act.
            this._setTestResult('Paste a key first (sk-…). Use Clear to wipe a saved key.', 'err');
            return;
          }
          this._setTestResult('Saving…', 'busy');
          await this._api.updateConfig({ openai_api_key: key });
          openaiKeyInput.value = '';
          // Fresh save — reset the UX override flags so the input row
          // collapses back down as "saved / hidden".
          this._openaiUserWantsInput = false;
          this._openaiLastTestFailed = false;
          this._setTestResult('Key saved.', 'ok');
          await this._refreshOpenAiStatus();
        });
      }

      if (openaiKeyClear) {
        this._on(openaiKeyClear, 'click', async () => {
          this._setTestResult('Clearing…', 'busy');
          await this._api.updateConfig({ openai_api_key: '' });
          if (openaiKeyInput) openaiKeyInput.value = '';
          // If Prefer OpenAI was on, flip it off — it would otherwise
          // route the next turn to the now-missing key and fall back
          // silently. Better to make the demotion explicit.
          await this._api.updateConfig({ playback: { tts_provider: 'edge' } });
          this._setTestResult('Key cleared. Provider reset to Edge.', 'ok');
          this._openaiUserWantsInput = false;
          this._openaiLastTestFailed = false;
          await this._refreshOpenAiStatus();
        });
      }

      if (openaiPreferToggle) {
        this._on(openaiPreferToggle, 'change', async () => {
          const prefer = !!openaiPreferToggle.checked;
          const provider = prefer ? 'openai' : 'edge';
          const merged = await this._api.updateConfig({ playback: { tts_provider: provider } });
          // Refresh the live config snapshot so the per-session voice
          // dropdown (which reads tts_provider on every repaint) sees
          // the switch immediately — otherwise it keeps showing the
          // Edge catalogue until the user reloads the toolbar. The
          // update-config IPC returns the merged config on success.
          if (merged) {
            window.TT_CONFIG_SNAPSHOT = merged;
            // Tell any consumer that cares about the provider flip to
            // repaint. renderer.js wires renderSessionsTable() behind
            // the onAfterMutation hook we reuse here.
            if (typeof this._onAfterMutation === 'function') this._onAfterMutation();
          }
          this._setTestResult(prefer
            ? 'Now using OpenAI — response body, tool narrations + heartbeat all run through OpenAI first.'
            : 'Back to Edge (free) as primary. OpenAI stays wired as the fallback.', 'ok');
        });
      }

      if (openaiTestBtn) {
        this._on(openaiTestBtn, 'click', async () => {
          this._setTestResult('Testing…', 'busy');
          try {
            const r = await this._api.testOpenAiVoice();
            if (!r) {
              this._setTestResult('Test rate-limited, try again in a second.', 'err');
            } else if (r.ok) {
              this._setTestResult(`OK — ${r.provider} / ${r.voice}. Listen for "Terminal Talk test…".`, 'ok');
              this._openaiLastTestFailed = false;
              await this._refreshOpenAiStatus();
            } else {
              this._setTestResult(`Failed — ${r.error || 'unknown error'}`, 'err');
              // Test failed → the user needs to re-check / re-save the
              // key. Auto-reveal the input row + ensure the section is
              // expanded so they don't have to hunt.
              this._openaiLastTestFailed = true;
              if (openaiSection && openaiSection.classList.contains('collapsed')) {
                openaiSection.classList.remove('collapsed');
                if (openaiSectionToggle) openaiSectionToggle.setAttribute('aria-expanded', 'true');
              }
              await this._refreshOpenAiStatus();
            }
          } catch (e) {
            this._setTestResult(`Failed — ${e.message}`, 'err');
            this._openaiLastTestFailed = true;
            await this._refreshOpenAiStatus();
          }
        });
      }
    }

    _setTestResult(text, state) {
      const el = this._el.openaiTestResult;
      if (!el) return;
      el.textContent = text;
      if (state) el.setAttribute('data-state', state);
      else el.removeAttribute('data-state');
    }

    async _refreshOpenAiStatus() {
      const {
        openaiKeyStatus, openaiPreferToggle, openaiPreferPillBox,
        openaiKeyInputRow, openaiKeyChangeRow,
        openaiSection, openaiSectionToggle,
      } = this._el;
      if (!openaiKeyStatus && !openaiPreferToggle) return;
      let saved = false;
      try {
        const r = await this._api.getOpenAiKeyStatus();
        saved = !!(r && r.saved);
      } catch {}
      if (openaiKeyStatus) {
        const dot  = openaiKeyStatus.querySelector('.status-dot');
        const text = openaiKeyStatus.querySelector('.status-text');
        if (dot)  dot.setAttribute('data-state', saved ? 'set' : 'unset');
        if (text) text.textContent = saved ? 'Key set' : 'Not set';
      }
      if (openaiPreferPillBox) {
        openaiPreferPillBox.classList.toggle('disabled', !saved);
      }
      if (!saved && openaiPreferToggle && openaiPreferToggle.checked) {
        openaiPreferToggle.checked = false;
        this._syncPill(openaiPreferToggle);
      }

      // Row-swap: key-saved state shows the compact "Change key" row
      // instead of the password input. Two exceptions keep the input
      // visible even when a key IS saved:
      //   - user just clicked "Change key" (wants to rotate)
      //   - last Test came back failed (key might be stale/invalid)
      const forceInputRow = this._openaiUserWantsInput || this._openaiLastTestFailed;
      const hideInputRow = saved && !forceInputRow;
      if (openaiKeyInputRow)  openaiKeyInputRow .classList.toggle('hidden', hideInputRow);
      if (openaiKeyChangeRow) openaiKeyChangeRow.classList.toggle('hidden', !hideInputRow);

      // Auto-collapse the whole section once the key is saved AND the
      // last test (if any) passed. First-time / failing states stay
      // expanded so the controls are visible. This is a one-shot on
      // the first refresh after panel mount — a user who manually
      // expands the section later shouldn't have it snap closed on
      // the next queue-updated tick.
      if (openaiSection && !this._openaiCollapseDecided) {
        this._openaiCollapseDecided = true;
        if (saved && !this._openaiLastTestFailed) {
          openaiSection.classList.add('collapsed');
          if (openaiSectionToggle) openaiSectionToggle.setAttribute('aria-expanded', 'false');
        }
      }
    }

    // ---- Populate (update-time; listeners already wired) -----------

    _populateSpeed(cfg) {
      const { speedSlider, speedValue } = this._el;
      const speed = (cfg.playback && cfg.playback.speed) || 1.25;
      if (speedSlider) speedSlider.value = Math.round(speed * 100);
      if (speedValue) speedValue.textContent = `${speed.toFixed(2)}x`;
      this._onPlaybackSpeedChange(speed);
    }

    _populateOpenAi(cfg) {
      const { openaiPreferToggle } = this._el;
      const provider = String(
        (cfg.playback && cfg.playback.tts_provider) || 'edge'
      ).toLowerCase();
      if (openaiPreferToggle) {
        openaiPreferToggle.checked = (provider === 'openai');
        this._syncPill(openaiPreferToggle);
      }
      // Async status probe doesn't await — populate is called from
      // _onUpdate (sync) and the key-status IPC is ~1 ms anyway. This
      // also auto-handles the "Clear key + provider reset" case so the
      // pill's disabled state catches up on the next re-populate.
      this._refreshOpenAiStatus();
    }

    _populateVolume(cfg) {
      const { volumeSlider, volumeValue } = this._el;
      // Undefined master_volume means "legacy config from before this
      // slider existed" → default to 1.0 (no attenuation). 0 is a valid
      // user choice (fully muted) so we can't use `||`.
      const raw = cfg.playback && cfg.playback.master_volume;
      const v = (typeof raw === 'number' && Number.isFinite(raw))
        ? Math.max(0, Math.min(1, raw))
        : 1.0;
      const pct = Math.round(v * 100);
      if (volumeSlider) volumeSlider.value = pct;
      if (volumeValue) volumeValue.textContent = `${pct}%`;
      this._onMasterVolumeChange(v);
    }

    _populateAutoPrune(cfg) {
      const { pruneToggle, pruneSecInput } = this._el;
      const enabled = cfg.playback && cfg.playback.auto_prune !== false;
      const secs = Math.max(3, Math.min(600, Number(cfg.playback && cfg.playback.auto_prune_sec) || 20));
      this._onAutoPruneSecChange(secs);
      this._onAutoPruneEnabledChange(enabled);
      if (pruneToggle) {
        pruneToggle.checked = enabled;
        this._syncPill(pruneToggle);
      }
      if (pruneSecInput) {
        pruneSecInput.value = String(secs);
        pruneSecInput.disabled = !enabled;
      }
    }

    _populateAutoContinue(cfg) {
      const { continueToggle } = this._el;
      const enabled = cfg.playback && cfg.playback.auto_continue_after_click !== false;
      this._onAutoContinueChange(enabled);
      if (continueToggle) {
        continueToggle.checked = enabled;
        this._syncPill(continueToggle);
      }
    }

    _populatePaletteVariant(cfg) {
      const { paletteToggle } = this._el;
      const variant = (cfg.playback && cfg.playback.palette_variant) || 'default';
      document.body.dataset.paletteVariant = variant;
      if (paletteToggle) {
        paletteToggle.checked = variant === 'cb';
        this._syncPill(paletteToggle);
      }
    }

    _populateHeartbeat(cfg) {
      const { heartbeatToggle } = this._el;
      if (!heartbeatToggle) return;
      // Default true — matches DEFAULTS.heartbeat_enabled in main.js.
      const on = cfg.heartbeat_enabled !== false;
      heartbeatToggle.checked = on;
      this._syncPill(heartbeatToggle);
    }

    _populateVoiceSelects(cfg) {
      // Global voice / include selects may be absent in the shipping DOM
      // (removed in favour of per-session controls in earlier releases).
      // Guards prevent an optional field's absence from crashing the
      // rest of the populate pass.
      const v = cfg.voices || {};
      this._fill(this._el.voiceEdgeResp, this._edgeVoices, v.edge_response);
      this._fill(this._el.voiceEdgeClip, this._edgeVoices, v.edge_clip);
      this._fill(this._el.voiceOaiResp,  this._openaiVoices, v.openai_response);
      this._fill(this._el.voiceOaiClip,  this._openaiVoices, v.openai_clip);
    }

    _fill(el, list, selected) {
      if (!el) return;
      el.innerHTML = '';
      // Include the selected value even if it's not in the curated list
      // — covers the case where a user has set a voice manually via
      // config.json.
      const pool = list.slice();
      if (selected && !pool.find((x) => x.id === selected)) {
        pool.unshift({ id: selected, label: selected });
      }
      for (const item of pool) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.label;
        if (item.id === selected) opt.selected = true;
        el.appendChild(opt);
      }
    }

    _populateIncludeBoxes(cfg) {
      const inc = cfg.speech_includes || {};
      for (const [key, el] of Object.entries(this._el.incBoxes)) {
        if (el) el.checked = !!inc[key];
      }
    }
  }

  return { SettingsForm };
}));
