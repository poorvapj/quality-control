# Smaller save response — evaluation and design (DESIGN ONLY — minimal replies are NOT implemented)

> **Update:** the log-only diagnostics for the `clean` rule (§4.2) are implemented and OFF by default — see `save-diagnostics.md`. They change no response and no behaviour. The minimal reply itself is still not implemented and still awaits your approval after the logs have been evaluated.

Status: **awaiting your approval.** No code, schema, collection or endpoint behaviour has been changed for this. Default behaviour in every proposal below stays exactly what it is today.

## 1. What happens today (verified in code)
`POST /api/ops` (`server.js` `handleApi`): validate batch → `applyOps` (per-op writes, then `trimEvents`, then `bumpRev`) → `sendStateResponse` → **the whole board** (`{rev, data}`), via the shared builder. Measured locally (`performance-baseline.md`): a save costs ≈ 33 ms at today's size but ≈ 250 ms at 10x and ≈ 0.9–1.1 s at 40x data, because the reply is the full board (59 KB gz today, 530 KB at 10x, 2 MB at 40x). The same `sendStateResponse` also answers: an idempotent replay (`claim === "done"`), `POST /api/reset` and `POST /api/backups/:id/restore` (admin).
Error replies are separate and small (`{error}` with 400/401/403/409/503…); they are not part of this proposal.

## 2. Every caller of the save endpoint, and what it uses from the reply
| Caller | Where | Uses from the reply | Needs the complete board? |
|---|---|---|---|
| Normal in-app saves (≈ 60 call sites of `apply(...)` in 20 files: snags, inspections, assignments, progress, masters, permissions, drawing-request actions, DPR, case studies, user admin…) | `AppContext.tsx` `apply()` (the only place that calls `fetch("/api/ops")` for live saves) | `j.data` and `j.rev`: `setData(j.data)`, `setRev(j.rev)` — replaces the whole local board with server truth; callers themselves only get a boolean (`true` = reached server). Two callers act on the boolean (`QualityInspection.tsx` L328, L1153: "submitted" vs "queued" message) | **Yes, in effect**: the reply is how the writer's local copy picks up everything the server did differently (see §3) |
| Public forms (DPR `/dpr/new`, drawing request, custom form) | same `apply()` | same; with `PUBLIC_STATE_ENFORCE` on this is the public snapshot, today (flag off) it is the full board | The public form re-numbers the next record (`nextId`) from the local list; it needs the *ids*, not the full board |
| Offline-queue replay | `AppContext.tsx` `flushPendingOps` → `flushQueue` | **status code and `error` only**; the body is ignored. Callers then do their own full `fetchBoard()` (initial load, offline recovery) | **No** — already compatible with a small reply |
| Idempotent replay (`batchId` already applied) | server `claim === "done"` | acknowledgement only | No |
| Backup restore (`Backups.tsx` L80) and reset (no frontend caller found) | `sendStateResponse` after restore/reset | restore: only `r.ok`, then `window.location.reload()`; the body is not used | No (and these are rare admin actions — leave unchanged) |
| External callers (n8n, VMS, IMS, scripts) | n/a | They use dedicated endpoints (`/api/automation/...`, `/api/integrations/vms/dpr`, `/api/ims/webhook`); none is known to call `/api/ops`. Cannot be proven from the repo | Unknown → default must stay full |

## 3. Why the full board is currently doing real work (what a small reply must not lose)
The optimistic update (`applyOpsLocal`) is a simplified mirror; the server then changes or adds things the client did not do, and the full reply silently repairs the writer's copy. Verified server-side behaviours:
1. **Records changed by server rules after the client sent them:** approval status/approver derived or removed (`applyApprovalRules`, L918–942); quality-inspection `result` recomputed from the checklist (`enforceResultFromChecklist`, L950); work-measurement link re-derived (`resolveLink`, L1118); anonymous drawing-request/DPR defaults forced (L1007, L1067); form submissions get `submittedAt`/`submittedByUserId`/`isPublic` (L1083–1089); team-report sign-off fields overwritten (L977).
2. **Fields the server strips or hashes:** `users` upsert — plaintext `password` is hashed and removed (L1183–1186). **Note:** `applyOpsLocal` merges the whole `op.rec`, so today the *plaintext password sits in the writer's in-memory board (and possibly its localStorage cache) until the full reply replaces it.* A small reply that keeps the optimistic copy would keep it longer; so a users save must never use the small path (or the client must drop `password` locally).
3. **Side effects on other records:** project delete cascades to floors/units/snags/assignments/dpr/drawingRequests/stagemap/workTargets and progress keys (L1280); `applyOpsLocal` only removes the project row. A passing re-inspection closes the original failed inspection's linked snag (L1250). `trimEvents` removes old audit events (client mirrors the 5,000 cap approximately).
4. **Concurrent changes by other users:** the full reply also brings in everyone else's changes made since the writer's last poll, which is why the writer can safely adopt `j.rev`.
5. **null vs absent:** `splitSetUnset` turns `null` into "unset", `applyOpsLocal` deletes null keys — currently equivalent, but a reason to keep server-authoritative copies for anything non-trivial.

**Consequence — the central design rule:** a client may only adopt a new revision number if its local board really equals the server's board at that revision. A small reply that says "saved, rev = 57" must never make the client believe it is at rev 57 when its copy is missing (a) other users' writes or (b) server-side changes. Otherwise the 5-second poll sees `rev == revRef` and **never refetches** — a silent, permanent divergence. This is the main hazard of the whole idea.

## 4. Proposed backward-compatible, opt-in design
### 4.1 Request (additive; absent = today's behaviour)
`POST /api/ops` body gains an optional field `reply: "minimal"` (default / any other value = full board, exactly as now). Old frontends never send it; an old server ignores the unknown field, so **either deploy order is safe** and a new frontend must accept both shapes.

### 4.2 Minimal reply
```json
{ "rev": 57, "applied": true, "clean": true }          // normal
{ "rev": 57, "applied": true, "replayed": true }        // idempotent replay (batchId already applied)
```
`rev` = the revision produced by this request (the value `applyOps` already returns; one read fewer, no whole-board rebuild in the request path). **`clean`** is computed by the server and is `true` only when all of the following hold, otherwise `false` (or the field is omitted and the client treats it as `false`):
- every op was a plain `upsert`/`delete`/`progress`/`event` whose record was **not modified by any server rule** (the server compares a serialized snapshot of each `op.rec` before and after `assertOpAllowed`/`applyApprovalRules`);
- the batch touched no `users` record (password handling), no project delete (cascade), no quality-inspection re-inspection that closes another record, no `teamDailyReports`, `workMeasurements`, `formSubmissions`, or public drawing-request/DPR create (these rules rewrite fields);
- no error was swallowed.
The allow-list is deliberately conservative: anything not proven "clean" falls back to the safe path below. It can be widened later with evidence.

### 4.3 How the frontend updates local state and revision (the safe rule)
```
reply = { rev, applied, clean }
if the reply has `data`            -> today's path (full board) — unchanged
else if applied && clean && reply.rev === revRef + 1
                                   -> keep the optimistic local copy (it is provably what the server has) and set revRef = reply.rev
else                               -> keep the optimistic copy for now, do NOT adopt reply.rev, and trigger an immediate full fetch
                                      (or simply let the next 5 s poll do it — revRef is still old, so it WILL see a difference)
```
- `reply.rev === revRef + 1` is the proof that nobody else wrote in between (revisions are a gap-free counter). If another user wrote, the revision jumps by more than one → the client does **not** adopt it, the poll fetches the full board (which includes both writes). This preserves today's guarantee that a client never claims a revision it has not fully applied.
- The pure decision function (`decideSaveReply`) is unit-testable like `opQueue`/`stateSync`.
- Public pages: same rule; they keep their optimistic record (the new DPR id is already in the local list, so `nextId` stays correct), other people's new records arrive via the poll as today.
- The `QualityInspection` callers that read the boolean are unaffected (still `true` when the server accepted).

### 4.4 Expected effect (projection, not measured)
The request path no longer waits for a whole-board rebuild. At 1x the whole save is ≈ 33 ms, of which the rebuild+serialization is a small part; at 10x/40x almost all of the measured 250 ms / ~1 s is the rebuild, so a save would approach the 1x figure (tens of ms) and the reply shrinks from 59 KB / 530 KB / 2 MB (gz) to ~60 bytes. **The rebuild is not removed — it moves to the next poll after each revision, where the shared builder does it once for all clients.** Total server CPU per write is therefore about the same; what improves is the writer's latency, the writer's download, and exposure of data to anonymous callers.

## 5. Risks and how each is handled
| Risk | Handling |
|---|---|
| **Divergent local copy** (adopting a revision without the data) | the contiguous-revision + `clean` rule above; default for any doubt is "don't adopt, refetch" |
| **Concurrent writers** | revision jump ⇒ not adopted ⇒ full fetch; covered by a stress test (below) |
| **Retries / idempotency** | the `batchId` flow is unchanged; a replay answers `{replayed:true, rev}` (no adoption unless contiguous); a 503 "busy" is unchanged; the offline queue already ignores bodies |
| **Partial failure** | `applyOps` is still non-atomic (pre-existing); on any error the reply is today's error (4xx → client re-syncs with a full fetch, 5xx → queued); no minimal-reply path is taken |
| **Stale state** | the client never adopts a revision unless contiguous and clean; the `acceptState`/`stateSync` expiry handling is untouched |
| **Public forms** | no private data in the reply (strictly better than today with the flag off); `nextId` uses the optimistic local record; verify with the browser DPR test |
| **Older frontends** | never send `reply`, so they keep receiving the full board — **default unchanged**; an old server answers a new client with the full board, which the client already handles (`j.data` present) |
| **Plaintext password in memory** (§3.2) | `users` upserts are never `clean`; additionally recommended (separate small fix, needs approval): drop `password` from the local copy in `applyOpsLocal` |
| **Cascade/side-effect records** | `clean:false` ⇒ full refetch (project delete, re-inspection closure, …) |
| **Revision read race** | the minimal reply uses the revision `applyOps` itself got from the atomic `findOneAndUpdate` (unique per bump, verified earlier), not a fresh read |
| **Server-rule detection bugs** (a rule changes a record but `clean` says true) | this is the dangerous one → the "snapshot before/after" comparison is generic (not per-rule), plus a test per known rule, plus a debug mode that compares the writer's optimistic copy to the server copy in staging and logs mismatches before the client switch is turned on |

## 6. Rollout (if approved)
1. Server: add the optional `reply:"minimal"` path (default off, no client sends it) → tests, benchmark.
2. Client: add `decideSaveReply`, but keep sending nothing → tests.
3. Client sends `reply:"minimal"` behind a feature flag (e.g. `localStorage`/build-time), canary on staging, compare optimistic vs server copies in a log-only mode.
4. Enable by default; keep the full-reply fallback permanently. **Rollback:** stop sending the field (client) — the server path becomes dead code, nothing else changes.
No schema, collection, migration or environment change is involved.

## 7. Test plan
- **Unit:** `decideSaveReply` (full/minimal/replay/non-contiguous/not-clean/malformed); server `clean` classifier with one case per rule in §3 plus plain upserts; reply-shape tests (flag absent ⇒ byte-identical to today's full reply; flag present ⇒ only `{rev,applied,clean|replayed}`); idempotent replay + busy + error paths with the flag.
- **Server integration (real server, in-memory MongoDB):** every §3 rule round-trips: client optimistic copy vs a fresh `/api/state` must be equal after the minimal flow (or `clean:false` forces the refetch); anonymous/public submit; users upsert never clean.
- **Consistency stress:** N concurrent writers + readers using the *client algorithm* (optimistic copy + adopt rule): after quiescence every client's local board equals the server board; at no time does a client hold revision r with data missing a write ≤ r (checked against server truth).
- **Mixed versions:** old frontend vs new server (full reply, unchanged); new frontend vs old server (HEAD build) ⇒ falls back to the full path.
- **Real browser (Edge):** save a snag, submit an inspection (approval derived), create a user (password), delete a project (cascade), public DPR with photo, offline→online replay, mid-session expiry, two tabs.
- **Regression:** the existing suites (backend 19 files, opQueue/stateSync, the e2e and browser scripts).

## 8. Benchmark plan (same harness as `performance-baseline.md`; local until staging exists)
For 1x / 10x / 40x data, 100 sequential saves and 20 concurrent saves, BEFORE (full reply) vs AFTER (`reply:"minimal"`): save latency p50/p95/p99; reply bytes (raw/gz); time until the writer's local board equals server truth (own + others' changes); fan-out catch-up and server working set (must not regress); correctness counters (divergences = 0, extra full refetches rate = how often `clean:false`/non-contiguous forces one). Report as **local results**; repeat on staging (Atlas + Render) before relying on them.

## 9. What is NOT proposed
Delta sync, a change-log collection, transactions, schema changes, changing the default reply, changing idempotency or the offline queue, touching approval/permission logic, or changing restore/reset responses.

## 10. Decisions needed
1. Approve the design in principle (opt-in `reply:"minimal"`, conservative `clean`, contiguous-revision adoption rule)?
2. Approve the separate small hardening of dropping plaintext `password` from the local optimistic copy (independent of this feature)?
3. Staging: do you want me to prepare the log-only "optimistic vs server" comparison mode first, so the rule can be validated against real traffic before any client switches over?
