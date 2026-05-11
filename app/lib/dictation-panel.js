/* global window, document */
'use strict';

function createDictationPanel(deps = {}) {
  const {
    api,
    recordBtn,
    listEl,
    showStatus = () => {},
    clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
  } = deps;

  let entries = [];
  let busy = false;
  let transcribing = false;

  function setBusy(on, label = 'Dictate') {
    busy = !!on;
    if (!recordBtn) return;
    recordBtn.disabled = transcribing;
    recordBtn.textContent = label;
    recordBtn.setAttribute('aria-pressed', busy ? 'true' : 'false');
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    for (const entry of entries.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'dictation-row';

      const body = document.createElement('div');
      body.className = 'dictation-body';
      body.textContent = entry.text || '';
      row.appendChild(body);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'dictation-action';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          if (clipboard && entry.text) await clipboard.writeText(entry.text);
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        } catch {}
      });
      row.appendChild(copyBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'dictation-action danger';
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        if (!api || !api.deleteDictation) return;
        const result = await api.deleteDictation(entry.path);
        if (result && result.ok) {
          entries = entries.filter((item) => item.path !== entry.path);
          render();
        }
      });
      row.appendChild(deleteBtn);

      listEl.appendChild(row);
    }
  }

  async function refresh() {
    if (!api || !api.getDictations) return;
    try {
      const next = await api.getDictations(20);
      entries = Array.isArray(next) ? next : [];
      render();
    } catch {}
  }

  function handleStatus(msg = {}) {
    const state = msg && msg.state;
    if (state === 'recording') {
      transcribing = false;
      setBusy(true, 'Recording');
      showStatus(
        msg.externalStop
          ? 'Recording dictation. Press Ctrl+Shift+Space again, say "hey jarvis stop dictation", or use the transcript Stop button.'
          : 'Recording dictation. Pause when you finish and Terminal Talk will transcribe it.',
        120000,
        'info',
      );
      if (recordBtn) recordBtn.textContent = 'Stop';
      return;
    }
    if (state === 'transcribing') {
      transcribing = true;
      setBusy(true, 'Transcribing');
      showStatus('Transcribing dictation...', 120000, 'info');
      return;
    }
    if (state === 'busy') {
      showStatus('Dictation is already running.', 4000, 'warning');
      return;
    }
    if (state === 'done') {
      transcribing = false;
      setBusy(false, 'Dictate');
      if (msg.text) {
        entries = [
          { path: msg.path || `memory-${Date.now()}`, text: msg.text, mtime: Date.now() },
          ...entries.filter((entry) => entry.path !== msg.path),
        ].slice(0, 20);
        render();
      } else {
        refresh();
      }
      showStatus(msg.pasted ? 'Dictation pasted.' : 'Dictation captured.', 3500, 'info');
      return;
    }
    if (state === 'error') {
      transcribing = false;
      setBusy(false, 'Dictate');
      showStatus(msg.error || 'Dictation failed.', 7000, 'warning');
    }
  }

  function mount() {
    if (recordBtn && api && api.startDictation) {
      recordBtn.addEventListener('click', async () => {
        if (busy) {
          if (api.stopDictation) await api.stopDictation('panel-button');
          return;
        }
        const result = await api.startDictation({ paste: false, manualStop: true, source: 'panel-button' });
        if (result && result.ok === false) {
          showStatus(result.error || 'Dictation could not start.', 5000, 'warning');
        }
      });
    }
    if (api && api.onDictationStatus) api.onDictationStatus(handleStatus);
    refresh();
  }

  return { mount, refresh, render, handleStatus };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { createDictationPanel };
} else {
  window.TT_DICTATION_PANEL = { createDictationPanel };
}
