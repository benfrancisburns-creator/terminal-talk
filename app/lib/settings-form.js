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
      } = deps;
      this._api = api;
      this._edgeVoices = edgeVoices;
      this._openaiVoices = openaiVoices;
      this._onPlaybackSpeedChange = onPlaybackSpeedChange;
      this._onMasterVolumeChange = onMasterVolumeChange;
      this._onAutoPruneEnabledChange = onAutoPruneEnabledChange;
      this._onAutoPruneSecChange = onAutoPruneSecChange;
      this._onAutoContinueChange = onAutoContinueChange;
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
      this._wireSpeedSlider();
      this._wireVolumeSlider();
      this._wireAutoPrune();
      this._wireAutoContinue();
      this._wireReloadButton();
      this._wirePaletteVariant();
      this._wireHeartbeatToggle();
      this._wireVoiceSelects();
      this._wireIncludeBoxes();
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
    }

    // ---- Wire-up (mount-time, idempotent) --------------------------

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

    // ---- Populate (update-time; listeners already wired) -----------

    _populateSpeed(cfg) {
      const { speedSlider, speedValue } = this._el;
      const speed = (cfg.playback && cfg.playback.speed) || 1.25;
      if (speedSlider) speedSlider.value = Math.round(speed * 100);
      if (speedValue) speedValue.textContent = `${speed.toFixed(2)}x`;
      this._onPlaybackSpeedChange(speed);
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
      if (pruneToggle) pruneToggle.checked = enabled;
      if (pruneSecInput) {
        pruneSecInput.value = String(secs);
        pruneSecInput.disabled = !enabled;
      }
    }

    _populateAutoContinue(cfg) {
      const { continueToggle } = this._el;
      const enabled = cfg.playback && cfg.playback.auto_continue_after_click !== false;
      this._onAutoContinueChange(enabled);
      if (continueToggle) continueToggle.checked = enabled;
    }

    _populatePaletteVariant(cfg) {
      const { paletteToggle } = this._el;
      const variant = (cfg.playback && cfg.playback.palette_variant) || 'default';
      document.body.dataset.paletteVariant = variant;
      if (paletteToggle) paletteToggle.checked = variant === 'cb';
    }

    _populateHeartbeat(cfg) {
      const { heartbeatToggle } = this._el;
      if (!heartbeatToggle) return;
      // Default true — matches DEFAULTS.heartbeat_enabled in main.js.
      const on = cfg.heartbeat_enabled !== false;
      heartbeatToggle.checked = on;
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
