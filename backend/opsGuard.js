/* Abuse protection for POST /api/ops from callers WITHOUT a valid session —
   the public DPR / Drawing Request / Custom Form pages. Signed-in callers
   are NOT limited here: behaviour for them is exactly what it was.

   Unlike photoGuard.js (opt-in via PHOTO_GUARD_ENFORCE, because older
   frontends sent no token and would have looked anonymous), nothing here
   ever misclassifies a signed-in caller — `session` is checked the same way
   server.js already does for every other anonymous-vs-signed-in branch — so
   this enforces by default. Set OPS_GUARD_ENFORCE=0 only to go monitor-only
   while tuning the limits.

   Counters are in-memory and per process (reset on restart; with several
   instances the effective limits multiply) — a cost brake against a script
   hammering the public forms, not an auth boundary. */

const DEFAULTS = {
  perIpLimit: 30, perIpWindowMs: 10 * 60 * 1000,
  globalLimit: 600, globalWindowMs: 60 * 60 * 1000
};

function createOpsGuard(opts = {}, now = () => Date.now()) {
  const c = { ...DEFAULTS, ...opts };
  const perIp = new Map(); // ip -> [timestamps]
  let global = [];

  const prune = (arr, windowMs, t) => { let i = 0; while (i < arr.length && t - arr[i] >= windowMs) i++; return i ? arr.slice(i) : arr; };

  /* -> { ok: true } | { ok: false, status, error, retryAfterSec } */
  function check({ session, ip }) {
    if (session) return { ok: true, anonymous: false };

    const t = now();
    global = prune(global, c.globalWindowMs, t);
    const mine = prune(perIp.get(ip) || [], c.perIpWindowMs, t);
    if (mine.length) perIp.set(ip, mine); else perIp.delete(ip);

    if (mine.length >= c.perIpLimit) {
      return { ok: false, status: 429, error: "Too many submissions from your network — please wait a few minutes", retryAfterSec: Math.max(1, Math.ceil((mine[0] + c.perIpWindowMs - t) / 1000)) };
    }
    if (global.length >= c.globalLimit) {
      return { ok: false, status: 429, error: "Submissions are temporarily unavailable — please try again later", retryAfterSec: Math.max(1, Math.ceil((global[0] + c.globalWindowMs - t) / 1000)) };
    }
    mine.push(t); perIp.set(ip, mine); global.push(t);
    return { ok: true, anonymous: true };
  }
  return { check, config: c, _size: () => ({ ips: perIp.size, global: global.length }) };
}

/* Mirrors photoGuard.js's guardLogLine — no client address in the log (an IP is
   personal data and the decision does not need it to be diagnosed). */
function guardLogLine({ enforce, verdict }) {
  return `[ops] ${enforce ? "REFUSED" : "monitor-only, would refuse"} (${verdict.status}): ${verdict.error}`;
}

module.exports = { createOpsGuard, guardLogLine, DEFAULTS };
