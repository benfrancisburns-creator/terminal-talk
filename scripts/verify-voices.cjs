#!/usr/bin/env node
// Cross-checks app/lib/voices.json against Microsoft's shipping edge-tts
// catalogue. Runs in a weekly CI job — if Microsoft removes or renames a
// voice, this fails and opens a tracking issue instead of silently
// leaving a broken option in the settings panel.
//
// Requires python with the `edge-tts` package installed.
//
// Exit codes:
//   0 — every shipped voice still exists in edge-tts.list_voices()
//   1 — at least one shipped voice is gone (names listed to stdout)
//   2 — couldn't invoke python / edge-tts at all (soft fail)

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'app', 'lib', 'voices.json');
const shipped = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const shippedIds = new Set(shipped.edge.map(v => v.id));

const result = spawnSync('python', ['-m', 'edge_tts', '--list-voices'], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  console.error('verify-voices: could not invoke `python -m edge_tts --list-voices`:');
  console.error(result.stderr || result.error?.message || 'unknown');
  process.exit(2);
}

const availableIds = new Set();
for (const line of result.stdout.split('\n')) {
  // edge-tts --list-voices output shape:  Name: en-GB-RyanNeural   Gender: Male ...
  const m = line.match(/Name:\s*(\S+)/);
  if (m) availableIds.add(m[1]);
}

const missing = [...shippedIds].filter(id => !availableIds.has(id)).sort();
if (missing.length > 0) {
  console.error(`verify-voices: ${missing.length} voice(s) in voices.json no longer shipping:`);
  for (const id of missing) console.error(`  ${id}`);
  process.exit(1);
}

console.log(`verify-voices: OK (${shippedIds.size} shipped voices all present in edge-tts catalogue)`);
