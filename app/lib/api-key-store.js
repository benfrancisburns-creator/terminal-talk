// D2 — safeStorage-backed OpenAI API key store.
//
// Two files on disk:
//   openai_key.enc       — base64 of safeStorage.encryptString(key)
//   config.secrets.json  — { "openai_api_key": "<plaintext>" }, user-ACL'd
//
// Rationale. safeStorage gives us backup/snapshot-leakage protection: the
// .enc file is useless on another machine or to an attacker with disk-read
// but no logged-in user session (DPAPI master keys require logon). The
// .secret sidecar is plaintext at rest, with a user-only ACL set by
// install.ps1 (T-2's D2 follow-up). Its purpose is to let PS hooks and
// synth_turn.py read the key without marshalling through Electron's
// safeStorage API — neither language has a clean binding to it. Threat
// model: same-user read of ~/.terminal-talk/ is already possible today
// against config.json, so sidecar adds no worse exposure there.
//
// On systems where safeStorage isn't available (Linux without
// kwallet/gnome-keyring, CI runners), we skip the .enc file and keep
// the .secret sidecar as the sole source. Users in that configuration
// get the same security posture as the pre-D2 config.json approach.
//
// Module is factory-based so the unit harness can inject a fake
// safeStorage implementation without pulling in Electron.

const fs = require('fs');
const path = require('path');

function createApiKeyStore({ dir, safeStorage, logger = () => {} }) {
  const encPath    = path.join(dir, 'openai_key.enc');
  const secretPath = path.join(dir, 'config.secrets.json');

  function _available() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); }
    catch { return false; }
  }

  function set(key) {
    // null/undefined/'' → clear both files
    if (key === null || key === undefined || key === '') {
      try { fs.unlinkSync(encPath); }    catch {}
      try { fs.unlinkSync(secretPath); } catch {}
      logger('apiKeyStore: cleared');
      return;
    }
    const value = String(key);
    // Always write the sidecar so hooks can find the key.
    fs.writeFileSync(secretPath, JSON.stringify({ openai_api_key: value }, null, 2), 'utf8');
    // Encrypt alongside when we can, so backups/snapshots are safe.
    if (_available()) {
      const enc = safeStorage.encryptString(value);
      fs.writeFileSync(encPath, Buffer.from(enc).toString('base64'), 'utf8');
      logger('apiKeyStore: wrote .enc + .secret');
    } else {
      try { fs.unlinkSync(encPath); } catch {}
      logger('apiKeyStore: wrote .secret (safeStorage unavailable)');
    }
  }

  function get() {
    // Prefer the encrypted file when we can decrypt it — that's the
    // authoritative store. Sidecar is a convenience for hooks.
    if (_available() && fs.existsSync(encPath)) {
      try {
        const raw = fs.readFileSync(encPath, 'utf8').trim();
        const buf = Buffer.from(raw, 'base64');
        return safeStorage.decryptString(buf);
      } catch (e) {
        logger(`apiKeyStore: .enc decrypt failed (${e.message}); falling back to .secret`);
      }
    }
    if (fs.existsSync(secretPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
        const v = parsed && parsed.openai_api_key;
        return typeof v === 'string' && v.length > 0 ? v : null;
      } catch (e) {
        logger(`apiKeyStore: .secret parse failed (${e.message})`);
      }
    }
    return null;
  }

  // Called once per boot. If there's a plaintext openai_api_key in
  // config.json (old install or hand-edited), migrate it into the
  // encrypted store and return the cleaned config back to the caller.
  function migrateFromConfig(config) {
    if (!config || typeof config !== 'object') return config;
    const plaintext = config.openai_api_key;
    if (typeof plaintext === 'string' && plaintext.length > 0) {
      set(plaintext);
      const { openai_api_key: _drop, ...cleaned } = config;
      logger('apiKeyStore: migrated plaintext key from config.json');
      return { ...cleaned, openai_api_key: null };
    }
    return config;
  }

  return { set, get, migrateFromConfig, _encPath: encPath, _secretPath: secretPath };
}

module.exports = { createApiKeyStore };
