// Token-bucket rate limiter keyed by string name. One bucket per handler
// name; all sessions share a single bucket for that name (not per-session)
// because the threat model is "a compromised renderer thrashes a handler"
// rather than "legitimate user is rate-limiting themselves".
//
// Used by main.js to protect mutating IPC handlers (update-config, set-
// session-*, remove-session). Over-limit calls are rejected and logged.
//
// Defaults: 20 calls/sec per handler, burst capacity 30.

const DEFAULT_RATE = 20;     // tokens added per second
const DEFAULT_BURST = 30;    // max tokens in the bucket

function createRateLimit({ rate = DEFAULT_RATE, burst = DEFAULT_BURST, now = () => Date.now() } = {}) {
  const buckets = new Map();  // name → { tokens, updatedMs }

  function allow(name) {
    const t = now();
    let b = buckets.get(name);
    if (!b) {
      b = { tokens: burst, updatedMs: t };
      buckets.set(name, b);
    } else {
      const elapsedMs = t - b.updatedMs;
      if (elapsedMs > 0) {
        b.tokens = Math.min(burst, b.tokens + (elapsedMs / 1000) * rate);
        b.updatedMs = t;
      }
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  return { allow, _buckets: buckets };
}

module.exports = { createRateLimit };
