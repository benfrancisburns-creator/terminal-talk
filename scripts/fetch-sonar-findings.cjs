#!/usr/bin/env node
// Fetch SonarQube findings via the Web API and format them into the
// ASSESSMENTS/ standard schema (see Claude Assesments/v0.4-QUALITY-ULTRAPLAN.md).
//
// Usage:
//   node scripts/fetch-sonar-findings.cjs            # writes baseline.md
//   node scripts/fetch-sonar-findings.cjs summary    # just prints totals
//
// Requires .sonarqube-token at repo root and SonarQube server running at
// localhost:9000 with a completed scan for project key "terminal-talk".

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = fs.readFileSync(path.join(ROOT, '.sonarqube-token'), 'utf8').trim();
const HOST = 'localhost';
const PORT = 9000;
const PROJECT = 'terminal-talk';

function api(apiPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: HOST,
      port: PORT,
      path: apiPath,
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(TOKEN + ':').toString('base64'),
      },
    };
    https.get(opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getAllIssues(type) {
  const all = [];
  let page = 1;
  while (true) {
    const qs = `componentKeys=${PROJECT}&resolved=false&types=${type}&ps=500&p=${page}`;
    const data = await api('/api/issues/search?' + qs);
    all.push(...data.issues);
    if (all.length >= data.total) break;
    page++;
    if (page > 20) break; // safety
  }
  return all;
}

async function getHotspots() {
  const all = [];
  let page = 1;
  while (true) {
    const qs = `projectKey=${PROJECT}&status=TO_REVIEW&ps=500&p=${page}`;
    const data = await api('/api/hotspots/search?' + qs);
    all.push(...data.hotspots);
    if (all.length >= (data.paging?.total ?? 0)) break;
    page++;
    if (page > 20) break;
  }
  return all;
}

function prefix(component) {
  return component.replace(PROJECT + ':', '');
}

function sevWord(sev) {
  return { BLOCKER: 'blocker', CRITICAL: 'critical', MAJOR: 'major', MINOR: 'minor', INFO: 'info' }[sev] || sev.toLowerCase();
}

function formatFinding(issue, id, kind) {
  const file = prefix(issue.component);
  const line = issue.line || issue.textRange?.startLine || '-';
  const sev = sevWord(issue.severity);
  const rule = issue.rule;
  const msg = issue.message.replace(/\n/g, ' ');
  const effort = issue.effort || '-';
  const key = issue.key;
  return `### F${String(id).padStart(3, '0')} — ${msg.length > 90 ? msg.slice(0, 87) + '…' : msg}
- **File:** \`${file}:${line}\`
- **Tool:** SonarQube (${kind})
- **Severity:** ${sev}
- **Rule:** \`${rule}\`
- **Effort:** ${effort}
- **Evidence:** ${msg}
- **Sonar key:** \`${key}\`
- **Why it matters:** [fill during triage]
- **Proposed fix:** [fill during triage]
- **Disposition:** [ ] fix  [ ] defer  [ ] accept

`;
}

(async () => {
  const mode = process.argv[2] || 'full';

  const [bugs, smells, hotspots] = await Promise.all([
    getAllIssues('BUG'),
    getAllIssues('CODE_SMELL'),
    getHotspots(),
  ]);

  const sevOrder = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, INFO: 4 };
  const bySev = (a, b) => (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5);
  bugs.sort(bySev);
  smells.sort(bySev);

  const countBy = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});

  console.log(`SonarQube findings summary for ${PROJECT}:`);
  console.log(`  Bugs:             ${bugs.length}  (by severity: ${JSON.stringify(countBy(bugs, 'severity'))})`);
  console.log(`  Code smells:      ${smells.length}  (by severity: ${JSON.stringify(countBy(smells, 'severity'))})`);
  console.log(`  Security hotspots: ${hotspots.length}`);

  const topRules = (arr) => {
    const c = countBy(arr, 'rule');
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  console.log(`\nTop bug rules:`);
  topRules(bugs).forEach(([r, n]) => console.log(`  ${n}×  ${r}`));
  console.log(`\nTop smell rules:`);
  topRules(smells).forEach(([r, n]) => console.log(`  ${n}×  ${r}`));

  if (mode === 'summary') return;

  const outDir = path.join(ROOT, 'ASSESSMENTS', 'S4-sonar');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'findings.md');

  let md = `# SonarQube findings — baseline scan\n\n`;
  md += `**Scanned:** ${new Date().toISOString()}\n`;
  md += `**Server:** http://localhost:9000 (Community Edition)\n`;
  md += `**Project key:** ${PROJECT}\n`;
  md += `**Totals:** ${bugs.length} bugs · ${smells.length} code smells · ${hotspots.length} security hotspots\n\n`;
  md += `---\n\n## Bugs (${bugs.length})\n\n`;
  bugs.forEach((b, i) => { md += formatFinding(b, i + 1, 'bug'); });
  md += `---\n\n## Code smells (${smells.length})\n\n`;
  smells.forEach((s, i) => { md += formatFinding(s, bugs.length + i + 1, 'code-smell'); });
  md += `---\n\n## Security hotspots (${hotspots.length})\n\n`;
  hotspots.forEach((h, i) => {
    const file = prefix(h.component);
    const line = h.line || '-';
    md += `### H${String(i + 1).padStart(3, '0')} — ${h.message}\n`;
    md += `- **File:** \`${file}:${line}\`\n`;
    md += `- **Rule:** \`${h.ruleKey}\`\n`;
    md += `- **Vulnerability probability:** ${h.vulnerabilityProbability}\n`;
    md += `- **Security category:** ${h.securityCategory}\n`;
    md += `- **Sonar key:** \`${h.key}\`\n`;
    md += `- **Disposition:** [ ] resolve-as-reviewed  [ ] fix  [ ] accept\n\n`;
  });

  fs.writeFileSync(out, md, 'utf8');
  console.log(`\n✓ Written: ${path.relative(ROOT, out)}`);
})();
