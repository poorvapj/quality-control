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

---
# Round 3 — security and backup work (COMMITTED as `7495c30` and `d4e21ed`; nothing pushed or deployed)

## Committed already
`8357555 fix(sync): bump rev on IMS/VMS writes; keep and de-duplicate queued offline edits` — 9 files (the two fixes, their tests, this changelog). Your staged `Measurement.tsx` / `Snags.tsx` stayed staged and untouched.

## Files (security -> `7495c30`, backup -> `d4e21ed`)
| File | What |
|---|---|
| `backend/backups.js`, `backups.test.js` (new) | Backup Phase A: cheap listing, size/duration logging, size refusal, audit events copy |
| `backend/recover-events-from-backup.js`, `recoverEvents.test.js` (new) | dry-run-by-default audit-event recovery tool |
| `backend/photoGuard.js`, `photoGuard.test.js` (new) | `/api/photo` abuse protection (monitor-only by default) |
| `backend/publicState.js` (new) | allow-listed public snapshot (off by default) |
| `backend/server.js` | wiring for the four items above, `reportBackupFailure`, `PHOTO_GUARD_ENFORCE`, `PUBLIC_STATE_ENFORCE`, `CLIENT_IP_HOPS_FROM_RIGHT` |
| `frontend/src/context/AppContext.tsx` | token on `/api/state`, `fetchBoard`, expired-session handling, full re-fetch after sign-in, `publicRoute`, no cache overwrite from public pages |
| `frontend/src/shared/stateSync.ts`, `frontend/tests/stateSync.test.mjs` (new) | pure decision logic + 6 tests |
| `frontend/src/shared/uploadPhoto.ts`, `frontend/src/hooks/useActions.ts` | token on `/api/photo` |
| `frontend/src/main.tsx` | `publicRoute` prop |
| `docs/*` | updated investigation/design documents, measurements |
| `backend/scripts/inspect-deployment.js`, `probe-write-txn.js` | read-only / non-persisting production probes (directory is gitignored — stays local) |

## Behavior of the live system if deployed with no env changes
Backups: new fields, failures now HTTP 500 + audit event (+ Slack when configured), cheaper listing. Frontend: token header on state/photo requests (adds a CORS preflight per `/api/state` fetch), one extra full-board fetch at sign-in. **Public snapshot and photo enforcement do nothing until their env flags are set** (photo guard only logs).

## Tests run this round
Backend `node --test`: all files pass (see final summary for the count). New unit tests: backups 4, recoverEvents 5, photoGuard 9. Frontend: `tsc --noEmit`, `vite build` pass; `opQueue` 13 + `stateSync` 6 pass. Real-server integration (in-memory MongoDB): backups (18 checks), photo (21), public state (17). **Real browser (Edge, built frontend + real server):** flags ON 25 checks, flags OFF 5 checks — all pass. Details and limits are in each document.

---
# Round 4 — shared state rebuild (`backend/stateBuilder.js`)
Commits made before this one: `7495c30` (security: 11 files) and `d4e21ed` (backup: 6 files). Nothing pushed or deployed; no environment variable changed; neither enforcement switch is on.

| File | Change |
|---|---|
| `backend/stateBuilder.js` (new) | cache + shared in-flight rebuild; the correctness rules are documented at the top of the file |
| `backend/stateBuilder.test.js` (new) | 14 tests: concurrency, revision change, read-your-writes, stamp ordering, failure handling (revision read / build / serialize), TTL safety net, late-older-build, hung build, repeated bursts; the harness fails if any test never finishes |
| `backend/server.js` | `getStateGzip` delegates to the builder; `getState(knownRev)` reads the revision **before** the data (it used to read it in parallel — a latent race where a snapshot could be stamped newer than its data) |

**Rules (each covered by a test, and by a mutation check that makes the suite fail if the rule is broken):** the revision is read from the database on every call before anything is served from cache or an in-flight build; a request joins only a build started for the *same* revision and younger than 30 s; a snapshot is stamped with the revision read before its data; a failed build is never cached and its in-flight slot is always cleared; an older build can never replace newer cache data (including the same revision); the 3 s TTL safety net for out-of-band writes is unchanged.
**Behavior change:** none to any API shape or business logic. Internally one rebuild per revision instead of one per request, and one extra sequential revision read on cache-miss paths (≈ +20 ms catch-up at today's data size, measured locally; see `docs/performance-baseline.md`). A failed rebuild still returns the existing generic API error (HTTP 400 with the message) to the requests that were waiting on it.
**Verified:** backend suite (19 files), stateBuilder 14/14, real-server stress (60 concurrent writers + 12 readers: 0 own-write misses, 0 stale-as-current, convergence), fault injection (the first gzip fails: waiting requests get an error, server stays up, next request recovers, `/api/rev` unaffected), ops/rev/backup/photo/public-state integration, real-browser runs with the switches on and off, `tsc`, frontend tests, `vite build`. **Local benchmark only** (real server + in-memory MongoDB, loopback): 40-client catch-up after one write 11.8 s → 0.29 s at 10x data and 19.4 s → 0.93 s (15 clients) at 40x; server working set 2.2 → 0.48 GB and 2.7 → 0.63 GB; at today's size catch-up is ~20 ms *slower* (3/3 runs). Not measured: Atlas, Render, real clients.
**Not changed:** delta sync, transactions, schema, collections, retention, flag defaults, the save reply (still the full board).
**Rollback:** revert this commit (restores the previous in-line cache in `server.js`; `stateBuilder.js` and its test are removed with it).

---
# Round 5 — plaintext password no longer kept in the writer's browser (frontend only)
**Finding (verified in a real browser):** a user save (Masters ▸ Add New User / Role-User edit) sends a plaintext `password` that the server hashes and discards, but the optimistic local update merged the whole record into the local board, so the password sat in memory and — whenever the board snapshot was cached to `localStorage["neoteric_board_v5"]` (offline/queued saves) — **stayed in localStorage even after the queued request had been delivered**. Online saves were cleaned up by the server's full-board reply; a future minimal reply would not have cleaned them.
**Fix:** `frontend/src/shared/applyOpsLocal.ts` (new; `applyOpsLocal` moved out of `AppContext.tsx` unchanged) leaves `password` out of the LOCAL copy of a `users` record only. The ops themselves are not modified, so the server request and an offline-queued batch still carry the password until delivered (necessary — it is the message). `scrubLocalBoard` also removes a password an older version may have cached when the snapshot is loaded.
**Unchanged:** authentication, permissions, hashing, the request body, the queue format, every other collection and field, all other optimistic-update behaviour (proved by a randomized parity test against the original function).
| File | Change |
|---|---|
| `frontend/src/shared/applyOpsLocal.ts` (new) | moved function + password rule + `scrubLocalBoard` |
| `frontend/src/context/AppContext.tsx` | imports it; scrubs the cached snapshot on load (−22 net lines) |
| `frontend/tests/applyOpsLocal.test.mjs` (new) | 8 tests incl. 500-batch parity with the original implementation |
**Tests:** applyOpsLocal 8, opQueue 13, stateSync 6 (27 total), `tsc`, `vite build`; real browser (Edge): Add User online and offline — the server stores a hash only, the new user can sign in, the queue holds the password only until delivery and then nothing does, the cached snapshot never contains it; with the fix disabled that browser test fails (3 checks), so it detects the bug. Existing browser suites (flags on/off) still pass.
**Not covered:** the password typed into the form is held in that form's own React state until the page unmounts (it unmounts right after saving); an offline queue that can never be delivered keeps the password in `neoteric_pending_ops` (inherent; see the poison-batch risk).
**Rollback:** revert the commit.

---
# Round 6 — log-only save diagnostics (`SAVE_DIAGNOSTICS`, default OFF)
Observation only; **no response body, write, frontend or default changes**. Compares the proposed "clean save" rule against what the server actually does to each applied `/api/ops` batch. Full guide: `docs/save-diagnostics.md`.
| File | Change |
|---|---|
| `backend/saveDiagnostics.js` (new) | predictor + generic before/after fingerprint comparison + bounded, privacy-safe logging; every entry point swallows its own errors |
| `backend/saveDiagnostics.test.js` (new) | 22 tests (every transformation, privacy, bounds, rate limit, isolation, no mutation) |
| `backend/server.js` | `SAVE_DIAGNOSTICS` switch read once at startup; `/api/ops` calls `begin/finish/abort` only when on; `applyOps(ops, session, trace)` — the optional `trace` records the project-delete cascade counts and the re-inspection snag-closure count from results the code already received (null-safe, undefined in normal operation) |
| `docs/save-diagnostics.md` (new), `docs/save-response-design.md` | how to enable, read and evaluate the logs; go/no-go gates |
**Verified:** unit 22/22 plus three mutation checks; real-server end-to-end (14 scenarios: plain, member inspection with a Not OK item, work measurement, leader approval, admin inspection, user with password, three anonymous public creates, team-report sign-off, project cascade, passing re-inspection, a refused save, event batch) — every transformation observed correctly, **0 MISMATCH-unsafe**, ON and OFF produced identical statuses and final database state, no private value in the log, 15 log lines for 14 scenarios; fault injection (diagnostics throwing inside the live server: saves still 200, same writes, server up); backend suite and earlier integration suites unchanged. Overhead (local): ≈ 12 µs per small save, ≈ 0.14 ms per 16 KB inspection.
**Not enabled, not deployed.** Enabling is setting `SAVE_DIAGNOSTICS=1` on Render (your decision).
**Rollback:** revert the commit (or leave the variable unset — the code is inert).

---
# Round 7 — save-diagnostics blockers fixed; no client IP in the photo-guard log
Still **log-only and default OFF**; no response, write, frontend, default-flag or enforcement change.
| File | Change |
|---|---|
| `backend/saveDiagnostics.js` | **B2:** every line is a complete JSON object ≤ 700 chars (examples shrink by dropping detail, flagged `truncated`; summaries are split into numbered parts sharing `boot`+`seq`). **B3:** new `batchOutcomes` counts each batch once (sums to `batches`); the old per-collection counters are renamed `perCollection` and documented as not a batch total. Shutdown summary (`final:true`, skipped when nothing is new). Default summary interval 200 → 25 |
| `backend/server.js` | the existing SIGINT/SIGTERM handler first calls `saveDiag.summary({final:true})` (only when diagnostics are on; swallows its own errors); default interval 25; the photo-guard log line is built by `guardLogLine()` |
| `backend/photoGuard.js` | `guardLogLine()`: the monitor-only/REFUSED log line **no longer contains the client IP** (decision and enforcement logic untouched); `type` is printed only if it is a known upload type |
| `backend/saveDiagnostics.test.js` (22 → 28), `backend/photoGuard.test.js` (9 → 10) | worst-case summary size/validity, batch totals, shutdown summary, summary privacy; photo log line has no address and the verdict is unchanged |
| `docs/save-diagnostics.md` | new log format, batch-total formula, and the five gates for the observation window |
**Rollback:** revert the commit.
