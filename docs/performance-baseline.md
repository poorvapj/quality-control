# Performance Baseline and Delta-Sync Preconditions

Updated 2026-10-27. **Everything below was measured on a developer machine: the real `server.js` + an in-memory MongoDB over loopback.** There is no staging environment, and I did not load-test your Atlas/Render deployment. Treat the numbers as **relative** (variant vs variant, 1x vs 10x vs 40x), not as production latencies: Atlas and Render add network round trips and have different CPU/memory limits. Where a number is a projection it says so.

## 1. Measured: current production-side facts (read-only probes)
| Item | Value |
|---|---|
| MongoDB | replica set `atlas-dbrka5-shard-0`, 3 members, v8.0.34 |
| Multi-document transactions | **supported** (read-only transaction committed; a *write* transaction was run and **aborted** — insert inside the transaction worked, nothing persisted) |
| App's DB user roles | `atlasAdmin@admin` (broader than needed — see security doc) |
| Atlas tier / Cloud Backup | **not verified** (you said you will check) |
| Live board size | ≈ 1.31 MB BSON for the main collections (units 2,640; dpr 823; stagemap 464; floors 290; vendors 164; progress 150; events 397; inspections 10) |
| Backups | 0.65 MB (Oct 7) → 1.22 MB (Oct 24), 7.6 % of the 16 MB document limit |
| Render instance count/plan | **not verifiable from the repo** |

## 2. Methodology (reproducible)
- Variants: **before** = commit `75f574a` (before the fixes); **after, old client** = working tree, request without `batchId`; **after, new client** = working tree, request with `batchId`; **prototype** = working tree + a throwaway single-flight rebuild (not in the repo).
- Data: synthetic documents shaped like production (sizes calibrated from the collStats above), at **1x** (production-sized), **10x**, **40x** (≈ 105k units, ≈ 33k DPRs). Events are capped at 5,000 as in production.
- Per case: `/api/state` cold + 30 cached + 5 after a write; `/api/rev` 300 sequential + 50 clients × 20; 100 sequential `POST /api/ops` snag upserts (admin token); **fan-out**: N clients poll `/api/rev` every 200 ms (scaled down from 5 s), one write is made, time until every client has fetched the new state; server working-set memory via `Get-Process`. Scripts live in the session scratchpad (they need `mongodb-memory-server`, not a repo dependency).
- **Limits:** loopback network (no latency), in-memory mongod (no disk), one machine running client + server + mongod, single run per cell (no confidence intervals — a 1x fan-out cell differed between runs, see §4), client-side parse/merge/render time **not** measured, Render's CPU/RAM not reproduced.

## 3. Results
(ms unless stated; "gz" = gzip bytes on the wire)

| Scale | State raw | State gz | `/api/state` cold | cached p50 / p95 | `/api/rev` p50 / p95 | `/api/rev` 50 clients p95 · req/s |
|---|---|---|---|---|---|---|
| 1x | 856 KB | 59 KB | 58–74 | 0.6–0.8 / 2.1–2.9 | 0.46–0.51 / 1.0–1.4 | 13–15 · 5.0–5.6k |
| 10x | 8.6 MB | 530 KB | 298–351 | 1.5–1.9 / 4–6 | 0.39–0.44 / 1.1–1.3 | 12.5–13.4 · 5.6–5.8k |
| 40x | 32.9 MB | 2.0 MB | 998–1,268 | 4.9–5.5 / 10–14 | 0.45–0.63 / 1.4–1.65 | 14.9–17.9 · 3.6–5.1k |

**Write latency (`POST /api/ops`, one snag upsert; the reply carries the whole board):**
| Scale | before (75f574a) p50 / p95 | after, old client | after, new client (batchId) |
|---|---|---|---|
| 1x | 34.2 / 41.9 | 33.2 / 42.8 | 32.3 / 39.9 |
| 10x | 250 / 279 | 290 / 334 | 246 / 283 |
| 40x | not run | not run | 1,064 / 1,228 (the prototype: 1,144 / 1,397) |
At 40x a save takes **≈ 1.1 s** (the prototype does not change it, because the reply still rebuilds the board).
→ **The revision and offline-queue fixes add no measurable write latency** (differences are within run-to-run noise at 1x and 10x; the 10x "old client" cell is higher than the other two, which is noise, not a trend — the new code path is identical for old clients). **But write latency grows with the size of the board** (≈ 33 ms → ≈ 250 ms from 1x to 10x) because every save rebuilds and returns the entire state.

**Fan-out — one write, N connected clients, every client then fetches `/api/state`:**
| Scale | Clients | before | after, old client | after, new client | **prototype: shared rebuild** |
|---|---|---|---|---|---|
| 1x | 40 | p50 185 ms · max 223 | 1,139 · 1,140 | 1,218 · 1,221 | not run |
| 10x | 40 | **11,660 · 11,685** | 11,615 · 11,633 | 11,095 · 11,127 | **322 · 339** |
| 40x | 15 | not run | not run | **17,897 · 17,926** | **1,345 · 1,365** |

| Scale | Server working set after the run (before / after old / after new / prototype) | Data pushed per write to N clients (gz × N) |
|---|---|---|
| 1x | 326 / 545 / 506 MB (start ≈ 110–134 MB) | 2.3 MB (40 clients) |
| 10x | 2,332 / 2,412 / 1,930 MB · prototype **440 MB** | 20.7 MB (40 clients) |
| 40x | **2,879 MB** (current code) · prototype **656 MB** | 29.6 MB (15 clients) |
Working set is the process's peak-ish resident memory, not live heap, so it overstates what Node would hold after garbage collection; it is still the number an out-of-memory kill is judged on. Render's free tier has 512 MB.

## 4. What the measurements say
1. **`/api/rev` polling is not a problem** (sub-millisecond, ~5k req/s, same at every scale). The in-memory rev cache stays not recommended.
2. **The revision / queue fixes cost nothing measurable** on write latency, state size or polling.
3. **Biggest finding — a thundering herd on state rebuild.** After a write, every connected client sees the new revision and requests `/api/state` within the same 5-second window; each request that misses the cache rebuilds (JSON.stringify + gzip) the *whole board independently* on the single Node thread. 40 clients at 10x ⇒ 40 serial 250 ms rebuilds ≈ **11 s** before the last client has data, and ≈ **2 GB** of memory — which would exceed a 512 MB instance. A prototype that lets concurrent requests for the same revision share one rebuild: **11.1 s → 0.32 s and ≈ 2.3 GB → 440 MB** at 10x, with the same payloads. This is cheap, contract-neutral and does not need delta sync.
   At **40x (≈ 105k units, 33 MB raw / 2 MB gz)** the herd takes **≈ 18 s** for 15 clients and the server reaches **≈ 2.9 GB**; the prototype: **≈ 1.35 s and ≈ 660 MB**. (A first 40x attempt failed because my test client reused idle keep-alive connections that the server's 5 s idle timeout had closed — a test-harness artefact, fixed; no server crash occurred.)
4. **Write latency scales with data** (≈ 33 → 250 → 1,060 ms at 1x → 10x → 40x) because the reply is the full board. An opt-in small reply would remove that without touching the stored data.
5. (Superseded by Round 4 below — the apparent 1x difference did not reproduce.) The 1x fan-out cell moved from 185 ms ("before") to ≈ 1.2 s ("after") between runs. At 10x/40x the variants are indistinguishable, and the code paths on the state endpoint are identical between "before" and "after", so I attribute it to run-to-run variance in a single-run herd (it is dominated by whichever 40 requests collide with the rebuild), **not** to the fixes — but because I measured each cell once, I cannot prove that; a repeated staging run is needed (see §6).
6. At today's size (0.86 MB raw / 59 KB gz) none of this is a user-visible problem. Costs become real somewhere between 10x and 40x of today's data **or** with many simultaneous users.

## 5. Projected comparison: full-state sync vs. the proposed delta sync
Projection only — delta sync is **not implemented**, so none of the delta figures is measured. Inputs are measured sizes above plus the design in `delta-sync-design.md`.
| Aspect | Full state (today) | Delta sync (design) |
|---|---|---|
| Bytes per client per change | 59 KB (1x) · 530 KB (10x) · 2.0 MB (40x) gz | the changed records only: typically 0.5–3 KB (a snag/inspection/progress patch); a bulk import or restore falls back to full |
| Server work per change | one JSON+gzip of the whole board per revision (now once per client in a herd) | one indexed read of the log rows + a handful of document reads per client; no whole-board serialization |
| Write path | + whole-board rebuild in the reply (33 → 250 ms at 10x) | + 1 short transaction (counter + log rows). Local loopback measurement of the mechanism: 3.2 ms vs 2.8 ms; **on Atlas this is ≈ 3 extra round trips per write batch — unmeasured**, likely tens of ms |
| Storage | none | log row ≈ 100–150 B per changed record; 30-day TTL ⇒ e.g. 5,000 changed records/day × 30 × 130 B ≈ 20 MB (**an assumption about volume, not a measurement**) |
| Complexity | none | new collection + TTL index, epoch handling, a delta endpoint, client merge logic, replay checker, periodic full reconcile, every writer must publish to the log (and the maintenance scripts too) |
| Risk | known | client merge bugs / missed-update bugs are the failure mode; mitigated by checksums + full-resync fallbacks, but still new code on the most critical path |

**Reading of the evidence:** the two measured pain points (herd, write reply) are removable with two small, contract-neutral changes. Delta sync's remaining benefit is bandwidth/CPU per change once the board is several MB gzipped and/or user count is high. With today's 59 KB payload that is not yet justified; the case strengthens if inspections with large checklists/photos grow the board (they were ~20 KB each).

## 6. What still has to be measured on a real staging environment (not done)
Atlas round-trip latency for `/api/rev`, `/api/state` build time with the real documents, write latency with and without a transaction; Render CPU/RAM under N real clients; repeat the fan-out several times for variance; client parse/merge/render cost at 10x; memory/CPU of `mergeStableCollections` (it `JSON.stringify`s every collection on every revision change — measured nowhere yet). Suggested staging load: 50/200 simulated clients polling every 5 s with writes every 2 s for 10 minutes at 1x/10x data; record p50/p95/p99, error rate, RSS, Atlas ops/s.

## 7. Proposed performance targets (to validate on staging)
`/api/rev` p95 < 100 ms; `/api/state` (cache hit) p95 < 300 ms; time from a write until 50 clients are current < 2 s at 10x data; `POST /api/ops` p95 < 300 ms at 10x data; server memory < 400 MB at 10x data with 50 clients.

---
# Round 4 — shared state rebuild IMPLEMENTED (committed as `6265776`, not deployed) — before/after on the same harness
**Local benchmark only** (real `server.js` + in-memory MongoDB over loopback, one developer machine, single run per 10x/40x cell, three runs at 1x). These are **not production measurements**; Atlas latency, Render CPU/RAM and real client counts were not tested.
BEFORE = commit `d4e21ed`; AFTER = working tree with `backend/stateBuilder.js` (concurrent requests for the same revision share one rebuild; the revision is read first on every call; the snapshot is stamped with the revision read before its data).

| Scale | Catch-up time after one write, N clients (p50 / slowest) BEFORE → AFTER | Server working set BEFORE → AFTER | Save (`POST /api/ops`) p50 / p95 BEFORE → AFTER | `/api/state` cold BEFORE → AFTER | cached p50 / p95 BEFORE → AFTER |
|---|---|---|---|---|---|
| 1x (run 1) | 40 clients: 69 / 74 ms → 90 / 92 ms | 299 → 322 MB | 35.2 / 48.2 → 33.9 / 42.1 ms | 77 → 63 ms | 0.96 / 2.33 → 0.92 / 2.32 |
| 1x (run 2) | 81 / 84 → 104 / 106 ms | 321 → 307 MB | 34.5 / 42.7 → 32.6 / 38.3 | 72 → 50 | 0.97 / 2.02 → 0.90 / 3.87 |
| 1x (run 3) | 75 / 78 → 97 / 99 ms | 306 → 334 MB | 34.3 / 42.2 → 32.3 / 37.7 | 69 → 58 | 1.04 / 2.74 → 0.92 / 1.74 |
| 10x | 40 clients: **11,806 / 11,826 ms → 286 / 304 ms** | **2,208 → 480 MB** | 283 / 302 → 244 / 275 | 364 → 299 | 1.6 / 6.0 → 2.3 / 7.5 |
| 40x | 15 clients: **19,366 / 19,388 ms → 925 / 951 ms** | **2,742 → 629 MB** | 1,081 / 1,427 → 904 / 951 | 1,309 → 996 | 5.5 / 19.4 → 4.6 / 11.5 |

**Reading it honestly**
- At 10x and 40x data the catch-up time falls ~40x and ~20x and memory ~4–5x; every client still received the correct state (`fanoutAllUpdated` true in every cell).
- **At today's size (1x) AFTER is consistently ~20 ms slower to catch up (3 of 3 runs: +21, +23, +22 ms) with 40 clients** — the extra database read that puts the revision first on every request. Both are ~0.1 s, i.e. imperceptible against the 5 s poll interval, but it is a real, small cost, not noise. (The earlier "185 ms vs 1.2 s" 1x difference I reported did **not** reproduce — all three 1x runs of both builds are 70–105 ms — so that was run-to-run noise.)
- Saves are not slower (33–35 ms either way at 1x). At 10x/40x they look somewhat faster in AFTER but a single run per cell cannot prove that; the reply still rebuilds the board, so saves still scale with data (≈ 0.25 s at 10x, ≈ 0.9–1.1 s at 40x) — that is the next item (an opt-in small reply), not addressed here.
- `/api/rev` unchanged (p95 for 50 clients 17–26 ms at 1x/10x; the 124 ms at 40x BEFORE is the herd starving the event loop, 19 ms AFTER).
- Correctness evidence: 12 unit tests incl. two mutation checks (a build joinable across revisions, and a cache served without re-checking the revision, both make tests fail); a real-server stress test (60 concurrent writers + 12 concurrent readers, 349 reader checks: 0 own-write misses, 0 "stale served as current", all clients converge on the same final revision) on both BEFORE and AFTER; browser regression runs.
