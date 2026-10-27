# Optimization / Fix Changelog

**Nothing is committed or pushed.** Staged-by-you files (`frontend/src/pages/Measurement.tsx`, `Snags.tsx`) and `.kiro/` were not touched. No production writes were made; the only production-pointing access was one **read-only** inspection (`backend/scripts/inspect-deployment.js`, `backend/scripts/` is gitignored so the script stays local).

## Files changed
| File | Change |
|---|---|
| `backend/server.js` | `bumpRev` atomic; `trimEvents` fast-path; IMS + VMS-push rev bumps; `/api/ops` optional `batchId` idempotency; TTL index on `meta.expireAt` |
| `backend/opsBatch.js` (new) | idempotency store for retried `/api/ops` batches |
| `backend/opsBatch.test.js` (new) | 8 unit tests |
| `backend/vmsDprApiHandler.js` | `vmsSyncWroteRecord()` helper |
| `backend/vmsDprApi.test.js` | +1 test (13 total) |
| `frontend/src/shared/opQueue.ts` (new) | pure queue rules (classification, ordering, ownership, legacy upgrade) |
| `frontend/src/context/AppContext.tsx` | uses `opQueue`; batch ids; 5xx/429 queued instead of dropped; guarded resync |
| `frontend/tests/opQueue.test.mjs` (new) | 13 tests (Node ≥ 22.18: `node --test tests/opQueue.test.mjs`) |
| `docs/*` | audit, baseline, roadmap, design and investigation documents |

## Fix 1 — missing revision bumps (IMS webhook, VMS DPR push)
- **Bug (confirmed):** both paths wrote data without `bumpRev()`, so open boards never refetched; the data showed only after some unrelated write.
- **Fix:** IMS webhook bumps after a real upsert (stale/ignored/rejected updates still write nothing and don't bump). VMS push bumps only when `created:true` (duplicates and rejections don't).
- **Verified end-to-end** with the real `server.js` against an in-memory MongoDB (cwd without `.env`, so no production/Slack/VMS access): **HEAD:** new PO and new DPR left rev at 0 ("NOT BUMPED"). **Fixed:** rev 0→1 (PO) →2 (DPR); rejected IMS event, duplicate DPR and bad secret leave rev unchanged; a second client's `/api/state` shows both records at the latest rev. Unit test covers the helper.
- **Behavior change to be aware of:** clients now refetch after these writes (slightly more state downloads).

## Fix 2 — offline queue: never silently discard, never duplicate
- **Bug (confirmed):** `flushPendingOps` dropped a queued batch on *any* non-OK response (401, 429, 5xx…), contradicting `apply()`'s own "kept until you sign in" promise; `apply()` also dropped 5xx instead of queueing; and a replay of a request the server had already applied would duplicate audit events / repeat Slack notifications (HEAD test: replay → 2 events, 6-way race → 6 events).
- **Queue format (before):** `Op[][]` in `localStorage["neoteric_pending_ops"]`. **After:** `{id, ops, by, at}[]`; legacy entries are read and upgraded with deterministic ids (no data lost). Caveat: a browser tab still running the *old* JS that re-reads a new-format queue would mis-send it; it only affects tabs open across the deploy.
- **Rules (shared/opQueue.ts):** 2xx removes; **401 / 408 / 425 / 429 / 5xx / network error keep the batch and stop the flush (order preserved)**; other 4xx (a definitive refusal) drops that batch only — now with a visible toast instead of silently. A 401 for a batch made signed-out (public forms) is final, so it can't block the queue forever. A batch made by user A is never replayed under user B's token (left queued).
- **Idempotency:** every `/api/ops` request now carries a `batchId` (one per user action, reused by every retry). Server stores `meta` marker `opb:<id>` (pending → done; released on failure; stale pending taken over after 60 s; TTL 30 days via `meta.expireAt` index). A repeat of an applied batch returns 200 without re-applying and without bumping rev; a concurrent duplicate gets 503 (client retries). Old clients (no `batchId`) behave exactly as before.
- **Verified:** 13 frontend rule tests; 8 backend store tests; end-to-end on the real server (16 checks, all pass): replay → 1 event; 6 concurrent duplicates → 1 event (statuses 200 + 503s, no 4xx); a 403-refused batch id is released and applies after authorisation; a 401'd id applies after re-login; no-`batchId` requests unchanged; TTL index exists and other `meta` docs are untouched; replay leaves rev unchanged. Same script on HEAD fails the duplicate checks.
- **Not tested:** real browser (offline toggling, two tabs, localStorage quota) — no browser automation here; manual QA needed.
- **Cost (unmeasured):** +2 small `meta` writes per `/api/ops` request from new clients.
- **Remaining risks:** (1) a *poison* batch that always 5xxs blocks later batches (data is safe but the badge stays); a user-facing "discard / export queued changes" control would need your approval; (2) another user's leftover batches stay queued on a shared device until that user signs in; (3) two tabs still race on the queue, but duplicates are now harmless.
- **Rollback:** revert `AppContext.tsx`/`opQueue.ts` (queue format reverts; any new-format queue in a browser would then need clearing) and the `/api/ops` hunk; the `meta` TTL index and `opb:*` markers are inert and can be dropped.

## Earlier changes (unchanged from previous report)
- `bumpRev()` → single atomic `findOneAndUpdate` (**measured:** old code returned 15 distinct revs for 200 concurrent bumps; new 200/200).
- `trimEvents()` → `estimatedDocumentCount()` is only a fast-path gate; deletions always use an exact count, so audit-event retention is identical (verified: 5000 skipped, 5007 → exactly 7 removed).

## Test results
Backend `node --test`: 15 files, 15 pass (+ `opsBatch.test.js` 8/8, `vmsDprApi.test.js` 13/13). Frontend: `tsc --noEmit` OK; `npm run build` OK (main bundle 692.99 → 694.99 kB, 184.45 → 185.24 kB gz); `opQueue.test.mjs` 13/13. Real-server integration scripts live in the session scratchpad (they need `mongodb-memory-server`, not a repo dependency).

## Deployment notes
Deploy **backend first** (new clients send `batchId`; the server accepts it optionally, so either order won't break, but only a new backend dedupes). No env changes. First start creates one index (`meta.expireAt` TTL). Smoke test on staging: save a snag, submit an inspection, approve a measurement; toggle offline and save; confirm IMS/VMS pushes appear on an open board.
