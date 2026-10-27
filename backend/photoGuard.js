/* Abuse protection for POST /api/photo (upload to the company Cloudinary account).

   Signed-in callers (a valid session) are NOT limited here — behaviour is exactly
   what it was. Anonymous callers exist for one legitimate reason: the public DPR
   form (/dpr/new) attaches site photos (type "dpr"). So anonymous callers may:
     - upload type "dpr" only, images only (never PDFs, never other types)
     - up to MAX_ANON_BYTES per image (decoded size; the app's own watermarked
       JPEGs are <= 1280 px wide, typically a few hundred KB)
     - at most PER_IP_LIMIT uploads per PER_IP_WINDOW per client IP
     - at most GLOBAL_LIMIT anonymous uploads per GLOBAL_WINDOW across everyone
   The global cap is the real cost backstop: a client IP can be spoofed or shared
   (offices behind one NAT), so the per-IP limit alone is never relied on.

   Counters are in-memory and per process (they reset on restart; with several
   instances the effective limits multiply) — a cost brake, not an auth boundary.
   Only ALLOWED uploads are counted, so memory is bounded by GLOBAL_LIMIT entries. */

const MB = 1024 * 1024;
const DEFAULTS = {
  maxAnonBytes: 8 * MB,
  perIpLimit: 20, perIpWindowMs: 10 * 60 * 1000,
  globalLimit: 300, globalWindowMs: 60 * 60 * 1000
};
const ANON_TYPES = ["dpr"];

function decodedBytes(dataUrl) {
  const i = String(dataUrl).indexOf("base64,");
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 7);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/* Client IP behind Render's proxy. X-Forwarded-For is a comma list; the entry a
   trusted proxy appended is `hopsFromRight` from the end (1 = last). When unset
   the leftmost entry is used. That can be spoofed by a client that sends its own
   header — which is why the global cap exists. Set CLIENT_IP_HOPS_FROM_RIGHT once
   you have checked what Render sends for your service. */
function clientIp(req, hopsFromRight) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length) {
    const idx = hopsFromRight ? Math.max(0, xff.length - hopsFromRight) : 0;
    return xff[idx];
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function createPhotoGuard(opts = {}, now = () => Date.now()) {
  const c = { ...DEFAULTS, ...opts };
  const perIp = new Map(); // ip -> [timestamps]
  let global = [];

  const prune = (arr, windowMs, t) => { let i = 0; while (i < arr.length && t - arr[i] >= windowMs) i++; return i ? arr.slice(i) : arr; };

  /* -> { ok: true } | { ok: false, status, error, retryAfterSec? } */
  function check({ session, type, dataUrl, ip }) {
    if (session) return { ok: true, anonymous: false };

    if (!ANON_TYPES.includes(type)) return { ok: false, status: 401, error: "Sign-in required to upload this kind of file" };
    if (!/^data:image\//.test(dataUrl || "")) return { ok: false, status: 400, error: "Only images can be uploaded without signing in" };
    if (decodedBytes(dataUrl) > c.maxAnonBytes) {
      return { ok: false, status: 413, error: `Photo is too large (limit ${Math.round(c.maxAnonBytes / MB)} MB)` };
    }

    const t = now();
    global = prune(global, c.globalWindowMs, t);
    const mine = prune(perIp.get(ip) || [], c.perIpWindowMs, t);
    if (mine.length) perIp.set(ip, mine); else perIp.delete(ip);

    if (mine.length >= c.perIpLimit) {
      return { ok: false, status: 429, error: "Too many photo uploads from your network — please wait a few minutes", retryAfterSec: Math.max(1, Math.ceil((mine[0] + c.perIpWindowMs - t) / 1000)) };
    }
    if (global.length >= c.globalLimit) {
      return { ok: false, status: 429, error: "Photo uploads are temporarily unavailable — please try again later", retryAfterSec: Math.max(1, Math.ceil((global[0] + c.globalWindowMs - t) / 1000)) };
    }
    mine.push(t); perIp.set(ip, mine); global.push(t);
    return { ok: true, anonymous: true };
  }
  return { check, config: c, _size: () => ({ ips: perIp.size, global: global.length }) };
}

module.exports = { createPhotoGuard, clientIp, decodedBytes, DEFAULTS };
