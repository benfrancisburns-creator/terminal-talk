#!/usr/bin/env bash
# Run SonarQube analysis against the local Community Edition container.
#
# Pre-reqs (one-time):
#   1. Docker Desktop running
#   2. sonarqube container up:
#        docker start sonarqube
#      or first-time:
#        docker run -d -p 9000:9000 --name sonarqube sonarqube:community
#   3. Token generated in SonarQube UI (My Account > Security > Generate)
#      and saved to .sonarqube-token at the repo root (gitignored)
#
# Every invocation:
#   - Checks the server is UP at localhost:9000
#   - Optionally regenerates coverage (pass --coverage flag)
#   - Runs sonar-scanner in its Docker image
#   - Scanner reaches the server via host.docker.internal (Windows/Mac
#     Docker Desktop DNS name for the host from inside a container)
#
# Output: findings appear in the SonarQube UI at http://localhost:9000.
# To export to markdown findings.md for the ASSESSMENTS folder, run:
#   node scripts/fetch-sonar-findings.cjs   (written separately)

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# --- Pre-flight checks -----------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker not on PATH. Install Docker Desktop." >&2
  exit 1
fi

if [ ! -f ".sonarqube-token" ]; then
  echo "❌ .sonarqube-token missing at repo root." >&2
  echo "   Generate in SonarQube UI:" >&2
  echo "   http://localhost:9000 → My Account → Security → Generate Tokens" >&2
  echo "   Then: echo '<paste token>' > .sonarqube-token" >&2
  exit 1
fi

SONAR_TOKEN="$(tr -d '[:space:]' < .sonarqube-token)"
if [ -z "$SONAR_TOKEN" ]; then
  echo "❌ .sonarqube-token is empty." >&2
  exit 1
fi

STATUS=$(curl -s --max-time 5 http://localhost:9000/api/system/status 2>/dev/null || echo "")
if ! echo "$STATUS" | grep -q '"status":"UP"'; then
  echo "❌ SonarQube not UP at localhost:9000." >&2
  echo "   Response: ${STATUS:-no response}" >&2
  echo "   Try:  docker start sonarqube" >&2
  exit 1
fi
echo "✓ SonarQube UP."

# --- Optional coverage regen ----------------------------------------------

if [ "${1:-}" = "--coverage" ]; then
  echo "→ Regenerating coverage/lcov.info…"
  npm run test:coverage >/dev/null
  echo "✓ Coverage written."
fi

# --- Run the scanner -------------------------------------------------------

echo "→ Running sonar-scanner…"
# Git Bash on Windows otherwise rewrites /usr/src -> C:/Program Files/Git/usr/src
# (its mingw mount-point translation), so the container sees the wrong mount
# path and can't find sonar-project.properties. MSYS_NO_PATHCONV=1 disables it.
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${ROOT}:/usr/src" \
  -e SONAR_HOST_URL=http://host.docker.internal:9000 \
  -e SONAR_TOKEN="${SONAR_TOKEN}" \
  sonarsource/sonar-scanner-cli

echo ""
echo "✓ Scan complete. View findings: http://localhost:9000/dashboard?id=terminal-talk"
