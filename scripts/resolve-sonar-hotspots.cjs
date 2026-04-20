#!/usr/bin/env node
// Bulk-mark SonarQube hotspots as reviewed with per-hotspot rationale.
// Called manually after triage; categories + comments match the triage
// section in ASSESSMENTS/S4-sonar/findings.md.
//
// Usage: node scripts/resolve-sonar-hotspots.cjs

const fs = require('node:fs');
const http = require('node:http');

const TOKEN = fs.readFileSync('.sonarqube-token', 'utf8').trim();
const AUTH = 'Basic ' + Buffer.from(TOKEN + ':').toString('base64');

function post(apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const req = http.request(
      {
        host: 'localhost', port: 9000, path: apiPath, method: 'POST',
        headers: {
          Authorization: AUTH,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(b);
          else reject(new Error(`HTTP ${res.statusCode}: ${b}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(apiPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port: 9000, path: apiPath, headers: { Authorization: AUTH } }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${b}`));
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

// Rationale per rule — matches the S4 triage section in findings.md.
const RATIONALE = {
  // 13× regex ReDoS
  'python:S5852': "Triaged 2026-04-20 (see ASSESSMENTS/S4-sonar/findings.md). Markdown parser regex uses non-greedy + negated-class quantifiers — mathematically can't backtrack catastrophically. Additional guard: synth_turn.py wraps every sentence in SYNTH_TIMEOUT_SEC=15s. Input is the user's own Claude Code transcript — same-user trust boundary per D2-4.",
  'javascript:S5852': "Triaged 2026-04-20. Non-greedy markdown regex OR line-anchored ^…$/gm OR build-time script on repo-authored source. No catastrophic-backtracking risk. See ASSESSMENTS/S4-sonar/findings.md.",
  // 4× Math.random
  'javascript:S2245': "Triaged 2026-04-20. Math.random used for cosmetic UI jitter (spinner verb timing) or demo fake-data (mock-ipc.js kit). Zero security context.",
  // 6× PATH-spawn
  'javascript:S4036': "Triaged 2026-04-20. PATH lookup for python/powershell/taskkill. Threat model per D2-4: same-user trust boundary — attacker capable of rewriting PATH has local code exec already. Follow-up task filed for absolute-path resolution of taskkill+powershell (System32 binaries, zero compat risk).",
};

(async () => {
  const { hotspots } = await get('/api/hotspots/search?projectKey=terminal-talk&status=TO_REVIEW&ps=500');
  console.log(`Resolving ${hotspots.length} hotspots…`);

  for (const h of hotspots) {
    const comment = RATIONALE[h.ruleKey];
    if (!comment) {
      console.log(`  SKIP ${h.key}: no rationale for ${h.ruleKey}`);
      continue;
    }
    try {
      // Step 1: add the rationale as a comment.
      await post('/api/hotspots/add_comment', { hotspot: h.key, comment });
      // Step 2: mark as reviewed + safe.
      await post('/api/hotspots/change_status', { hotspot: h.key, status: 'REVIEWED', resolution: 'SAFE' });
      const file = h.component.replace('terminal-talk:', '');
      console.log(`  ✓  ${h.ruleKey.padEnd(24)} ${file}:${h.line || '-'}`);
    } catch (e) {
      console.error(`  ✗  ${h.key}: ${e.message}`);
    }
  }

  // Re-check how many are left unreviewed
  const after = await get('/api/hotspots/search?projectKey=terminal-talk&status=TO_REVIEW&ps=500');
  console.log(`\nRemaining TO_REVIEW: ${after.hotspots.length}`);
})();
