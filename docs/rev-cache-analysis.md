# `/api/rev` In-Memory Cache — Investigation and Recommendation

**Recommendation: do NOT implement the in-memory cache now.** The benefit is small and unmeasured; the risks are real. Nothing was changed for this item.

## What I could and could not verify
- **Render configuration is not in the repo** (no `render.yaml`, Dockerfile or Procfile). Instance count, plan and autoscaling are dashboard settings I cannot see. The README says "Render Web Service", and code comments (`server.js` L2061, L2072) say the **free tier sleeps** and cron pingers are used because in-process timers can't be relied on. Please check in the Render dashboard: plan, number of instances, whether autoscaling or "zero-downtime deploys" (two instances overlap during deploys) is on.
- The code is already written to tolerate more than one instance briefly (weekly-report atomic claim, comment at L2279 mentions horizontal scaling), but several things are **per-process**: `roleCache`, `civilLikeRoleCache`, `moduleGrantCache` (10s TTL), `loginAttempts` lockout, `approvalResendAt` cooldown, `stateCache`.

## What the endpoint costs today
`GET /api/rev` = one `findOne({_id:"rev"})` on `meta` (primary-key lookup). With e.g. 100 clients polling every 5s that is ~20 reads/s on an indexed `_id` lookup — trivial for Atlas. The remaining per-poll cost is Render CPU/HTTP and network latency, which an in-memory Mongo cache would not remove. 🔎 (no production numbers were available; I'm reasoning from query shape.)

## Safety analysis of a cache that is updated on `bumpRev` + short TTL
| Concern | Finding |
|---|---|
| Invalidation | Updating the cache on each local `bumpRev()` is correct only for writes made by **this** process. |
| Multiple instances | Instance B's writes are invisible to instance A until TTL expiry → staleness up to TTL (+ the 5s client poll). Clients alternating between instances could see rev values flap (extra refetches, not missed updates, because the client compares with `!==`). |
| Restart / cold start | Safe: empty cache → read DB. |
| Missed updates | Not permanent: the DB value is monotonic and the TTL bounds staleness. **But** existing writers that bypass `bumpRev` (finding S7: IMS webhook, VMS push) and manual scripts already cause invisible changes; a cache would not make that worse but would also mask diagnosing it. |
| Read-your-writes | **Hazard:** `getStateGzip` calls `getRev()` right after a write to build the `/api/ops` reply. A cached/single-flight rev there could serve the writer a body built for the *previous* rev. Any rev cache must be confined to the `/api/rev` handler only. |
| Backward compatibility | Response shape unchanged. |

## Safer alternatives (ranked)
1. **Measure first** (Atlas metrics: `meta` read ops/s; Render CPU). If `/api/rev` is not a hotspot, do nothing.
2. **Fix S7** (make IMS/VMS-push writes call `bumpRev`) — correctness first; otherwise any rev-based optimisation rests on an incomplete signal.
3. If measurements show polling load: **slow the client poll adaptively** (e.g., 5s foreground, 30s when the tab is hidden via `visibilitychange`) — cuts requests 6× for idle tabs with no server-side consistency risk. Needs a client change (approval).
4. If still needed: a cache confined to the `/api/rev` handler, TTL ≤ 1s, updated on local bump — safe for a single instance; document that >1 instance implies up to 1s extra staleness.
5. Delta sync (see `delta-sync-design.md`) keeps all state in Mongo, so it works across any number of instances — the preferred long-term scaling path.

---
## Measured update (local benchmark, 2026-10-27 — loopback + in-memory MongoDB, so RELATIVE numbers only)
`GET /api/rev`: p50 0.4–0.5 ms, p95 ≈ 1.2 ms sequentially; 50 concurrent clients × 20 requests: p95 ≈ 13–16 ms at ≈ 5,000–5,800 requests/s — **identical at 1x and 10x data** (it is a primary-key read on `meta`). Polling load is not the bottleneck; the recommendation **not to add an in-memory rev cache stands**. On Atlas each read adds network round-trip time, so repeat this on staging, but the query shape cannot get worse as data grows.
The real hot spot found by the same benchmark is different: the **state rebuild** (see `performance-baseline.md`).
