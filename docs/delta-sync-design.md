# Delta Sync Design (DESIGN ONLY — nothing here is implemented)

Status: **proposal awaiting approval.** No schema, API, or client sync code has been changed.

## 0. Transaction support — verified, not assumed (2026-10-27)
Read-only probe against the cluster `backend/.env` points to (`backend/scripts/inspect-deployment.js`; no writes):
- **Verified:** replica set `atlas-dbrka5-shard-0`, **3 members**, MongoDB **8.0.34**, wire version 25, session timeout 30 min, connected node is the writable primary, and a **read-only multi-document transaction started and committed**. So replica-set transactions are supported by this deployment.
- **Not verified (needs your confirmation):** (a) the Atlas **cluster tier** (M0/M2/M5 shared tiers have throughput throttling; it cannot be read through the driver), (b) that the app's database user may run **write** transactions (I deliberately did not run one against your cluster; the existing `restoreBackup`/project-delete code already uses `withOptionalTransaction`, but a silent non-atomic fallback is possible — check Render logs for the warning "Mongo transactions unsupported"), (c) real-world latency of the extra transaction round trips.
- **Mechanism validated on an in-memory replica set (design test, not an Atlas result):** 150 concurrent "increment rev + insert log rows" transactions produced 150 unique, gap-free revs with all 300 rows; a reader that reads the counter first and then rows ≤ counter never saw a rev without its full set of rows (76 checks, 0 violations); an aborted transaction burned no rev and left no orphan rows. Local cost: plain `$inc` 2.78 ms vs. transaction 3.20 ms per call on loopback — **not representative of Atlas**, so the real overhead must be measured on staging.

**If transactions turn out to be unavailable or throttled — safe alternative (no transaction):** allocate `R` via `$inc`, write the log rows with `rev:R, committed:false`, then flip them to `committed:true`; the delta endpoint only serves up to `safeRev = (lowest uncommitted rev) − 1`, and a sweeper commits/cleans rows stuck >60 s. Same client contract; costs one extra write and a small reader-side rule. Because clients only ever advance to `safeRev`, nothing is skipped.

## 1. Problem (verified in code)
`GET /api/state` (`server.js` `getState`) returns every collection, `progress` and `events`. The client (`AppContext.tsx` poll loop) refetches all of it whenever `/api/rev` changes, and `POST /api/ops` also replies with the full state. Cost per change = (board size) × (connected clients). Server-side gzip + the per-`rev` cache (`getStateGzip`) reduce CPU but not bytes or client parse/merge work.

## 2. Key finding that shapes the design: why naive per-record stamps are unsafe
Today a write is applied to its collection **first** and `bumpRev()` runs **after** (`applyOps`, end). Under concurrency, if each record were stamped with a rev and clients advanced their cursor to "max rev seen", a slower writer whose lower-numbered rev commits *after* a faster writer's higher one would be **skipped forever** by clients that already advanced. (The `bumpRev` test showed the old code even returned duplicate revs under concurrency; fixed separately.) So revision allocation and change publication must be atomic.

## 3. Proposed mechanism: an append-only change log published atomically with the revision
- New collection `changes`: one small row per touched record: `{ rev, coll, id, at }` (`coll:"progress"` uses the progress key as `id`; `coll:"events"` for new events). **No operation type and no payload is stored.**
- After an op batch finishes its data writes (unchanged code), a *short* transaction does: `meta.rev += 1` → `R`, then `changes.insertMany(rows with rev=R)`. Atomic: nobody can observe rev `R` without its rows. Concurrent batches serialize on the single counter document (Mongo write-conflict + driver's built-in transaction retry), so **committed revs are gap-free and ordered**. Data writes themselves stay outside the transaction, so **batch semantics are unchanged** (today a batch is not atomic; that is preserved, not "improved" silently).
- Because the delta endpoint returns the record's **current** state at fetch time (not a snapshot from log time), a record modified after its log row simply has a later row too. Data is written before its log row commits, so a client can never be told "rev R" while missing a change ≤ R. Convergent and never skips.

## 4. API contract (additive; existing endpoints unchanged)
`GET /api/changes?since=<rev>&epoch=<epoch>` (requires a valid session, see §7)

Success:
```json
{ "rev": 1043, "epoch": "e1", "upserts": { "snags": [ {…full record…} ], "progress": { "U1::S2": {…} } },
  "deletes": { "snags": ["SNG-9"], "progress": ["U1::S3"] }, "events": [ {…new events…} ] }
```
Server logic: read `rev` first; select distinct `(coll,id)` from `changes` where `since < rev ≤ currentRev`; for each, load the current doc: exists → `upserts`, missing → `deletes`. Apply the same sanitization as `getState` (strip `passwordHash/passwordSalt/legacyPasswordHash` — to be extracted into one shared function used by both endpoints so they can never diverge).

Full-sync fallback: `{ "full": true, "reason": "stale|epoch|too-large|unsupported" }` — client then calls `GET /api/state` exactly as today. Returned when: `since` is older than the oldest retained log row; `epoch` differs; more than ~2,000 distinct records changed; or transactions are unavailable.
- `/api/rev` response gains an optional `epoch` field (old clients ignore it). `/api/state` gains optional `epoch`. `/api/ops` unchanged in phase 1–3.

## 5. Epoch (handles wholesale replacement)
`resetDb`, `restoreBackup` (and any maintenance script that rewrites collections) change a `meta.epoch` value in the same transaction that already updates `rev`. Any client holding an old epoch gets `full:true`. This also covers deployments mixing old/new data.

## 6. Offline clients, reconnection, stale revisions
- Client persists `{rev, epoch}` with its local copy (already stores rev/data in localStorage).
- On reconnect: first flush `pendingOps` (unchanged), then `changes?since=<last rev>`. Too stale / epoch mismatch → full state (today's behavior).
- Log retention: TTL index on `at` (proposed 30 days) plus the row-count guard. Retention only bounds how long a client can be offline before a full resync; it never affects correctness.
- Safety nets: (a) full resync on tab focus after >N minutes and every ~10 min; (b) optional per-collection `count` checksum in the response, client compares to local counts and falls back to full on mismatch. This also covers writes that bypass the log (§8).
- Local optimistic edits: current behavior (replace with server truth after flush) is preserved; delta is applied through the same `mergeStableCollections` path so unchanged records keep referential identity (fewer re-renders — a performance gain of its own).

## 7. Permissions and authorization
Today any signed-in user already receives every collection, so delta exposes **nothing new**. Delta requires a valid session. **Separately-found issue:** `GET /api/state` currently requires no session at all (see audit F-?); public pages (`/dpr/new`, drawing-request and custom-form public pages) presumably depend on it. Recommend a follow-up to give anonymous callers a minimal public snapshot — needs your decision, and is intentionally *not* bundled into delta sync.

## 8. Writers that must publish to the log (inventory, verified)
Through `bumpRev`: `applyOps`, `decideApprovalFromSlack`, `performDrawingRequestDecision`, Slack snag-close and team-report approve, `/api/team-reports/generate`, `syncVmsDpr` poller, `resetDb`, `restoreBackup`, and — **since the Phase 0 fix (done, commit `8357555`)** — the IMS webhook (`purchaseOrders`) and the VMS DPR push. Phase 0 is therefore complete; the same call sites are where the change-log write would be added.
Client-side prerequisite noted in the frontend audit: `data.events` and `data.progress` are assumed complete by `AuditLog`, `Drawer` and ~25 `prog()` callers; a delta client must merge into full collections (never hold partial ones). Direct scripts (`backend/fix-*.js`, `migrate-roles.js`, `scripts/*`) write outside the server: they must call the shared helper or bump `epoch`; otherwise periodic full reconcile (§6) is the backstop.
Cascade: project delete removes many records in one transaction → one log row per removed record (floors/units/snags/progress keys…), written in the same flow.
Ordinary-user path writes `users.passwordHash` on first legacy login: not client-visible, needs no log row.

## 9. Schema, migration, rollback
- New: `changes` collection (index `{rev:1}`, TTL index on `at`), `meta` doc `epoch`. **No existing document is modified; no backfill.** Empty log + fresh epoch simply forces the first full sync.
- Rollback: set `DELTA_SYNC=off` → server stops writing the log and `/api/changes` returns `{full:true,reason:"unsupported"}`; clients fall back to `/api/state`. Dropping `changes` is then safe.
- Backups: `changes` is not part of `COLLECTIONS`, so backups/restores ignore it; restore bumps epoch.

## 10. Deployment sequencing / phases
0. Fix the two rev-bypassing writers (small, separately reviewable, behavior = clients see PO/DPR sooner). Inventory test: every write path covered.
1. Server: dual-write log behind flag (default off in prod, on in staging). No consumers. Verify with a **replay checker** (apply log to an old snapshot → must equal full state) on staging under concurrent load.
2. Server: `/api/changes` + epoch (read-only, unused by clients). Load-test it.
3. Client: delta apply behind a flag/per-user toggle, with full-sync fallback; ship to staging, then a few users.
4. Default on; keep fallbacks permanently.
5. Optional: `/api/ops` replies with delta (`Accept`/query flag) instead of full state. Old clients unaffected.
Old/new coexistence: old clients never call `/api/changes`; new clients degrade to `/api/state`. Server must deploy before client (frontend on Vercel, backend on Render — deploy order = Render first).

## 11. Costs and risks
- +1 short transaction and +N tiny inserts per write batch (extra latency on the Save path — **must be measured**, not assumed).
- Writers serialize on one counter document (same as today's `$inc`); write rate here is low but should be load-tested.
- Requires a replica set (Atlas is; code comments say so but I could not verify the actual cluster). Standalone dev DBs fall back to full-sync.
- Large burst writes (e.g., bulk import, reset) intentionally produce `too-large` → full sync.
- Client merge bugs are the main correctness risk → mitigated by checksums, periodic full reconcile, and the replay checker.

## 12. Test plan
Unit: log/row generation per op type incl. cascades; sanitize parity between `/api/state` and `/api/changes`. Integration (in-memory replica-set Mongo, as used for the `bumpRev` check): concurrent batches never skip or duplicate revs; replay(log) == full state; epoch change forces full; stale since → full; delete-then-recreate returns upsert. Client: offline → queue → reconnect → delta; mid-merge failure → full fallback; two tabs. Load: staging at 1x/10x/100x data, compare bytes/request and p95 versus `/api/state`.

## 13. Decisions needed from you
1. OK to add the `changes` collection and `meta.epoch` (additive, no migration)? *(not started; schema untouched)*
2. Transactions: replica set **verified**; please confirm the Atlas **tier** and that write transactions work for the app's DB user (or approve the no-transaction alternative in §0).
3. Retention: 30 days of log acceptable? (A TTL index on `at`; 30 days only bounds how long a client can be offline before a full resync.)
4. ~~Phase 0 rev-bump fix~~ — done and committed (`8357555`), not deployed.
5. Public (anonymous) access to `/api/state`: see `security-public-flows.md` — the delta endpoint should land **after** the public-snapshot split so the new endpoint is born authenticated.
6. Note: the board is currently only ~1.3 MB (2,640 units, 823 DPRs), so the full-state fetch is not yet a measured problem; delta sync is a scale-readiness investment. It should be justified by staging numbers (bytes/request, p95) before the transaction cost is accepted.

## 14. Measured evidence and recommendation (2026-10-27) — implementation still NOT started
Full numbers, method and limits: `performance-baseline.md`. Summary relevant to the decision:
- Today the full board is 0.86 MB raw / **59 KB gzip**; at 10x it is 8.6 MB / 530 KB. Local relative measurements show that what hurts as data grows is **not the polling** (`/api/rev` ≈ 0.5 ms, flat) but (a) a **thundering herd**: every client that sees the new revision triggers its own whole-board rebuild (40 clients at 10x ⇒ ≈ 11 s and ≈ 2 GB server memory), and (b) the **write reply carries the whole board** (33 → 250 ms per save, 1x → 10x).
- A throwaway prototype of (a) (concurrent requests share one rebuild) turned 11.1 s into 0.32 s and ≈ 2.3 GB into ≈ 440 MB at 10x, with no contract change. (b) can be removed by an opt-in small reply. Both are far smaller and safer than delta sync.
- Delta sync's *additional* benefit after those two: bytes and CPU per change (59 KB → ~1–3 KB today; 530 KB → ~1–3 KB at 10x) and scaling to very large boards. Its *costs*: +1 transaction and N log inserts on every write batch (≈ 3 extra Atlas round trips — **unmeasured on Atlas**), a TTL'd log collection, epoch handling, every writer (and maintenance script) publishing to the log, a client merge path, and the failure mode "client silently misses a change".
- **Preconditions you asked for:** replica set verified; write-transaction permission verified (aborted-insert probe succeeded; the user holds `atlasAdmin@admin`); **still unverified:** Atlas tier, Atlas-side latency, real Render capacity.
- **Recommendation:** (1) approve the shared-rebuild + revision-first fix (≈ 15 lines in `getStateGzip`/`getState`); (2) optionally approve an opt-in small `/api/ops` reply; (3) re-measure on staging with the load in `performance-baseline.md` §6; (4) revisit delta sync when the gzip state exceeds a few MB or the herd/reply fixes no longer hold the targets. This design stays on file, unchanged and unimplemented, so it can be picked up without redesign.
