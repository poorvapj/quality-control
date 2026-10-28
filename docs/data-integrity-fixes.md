# Data-integrity fixes (branch `fix/data-integrity`)

Follow-up to the data-loss audit. **What was wrong, what changed, what is still open.** Verified locally on invented data only (in-memory MongoDB); nothing here has been deployed or run against production.

## The root cause
An `upsert` op is a field-level merge (`updateOne({id}, {$set…}, {upsert:true})`). The server could not tell "create a new record" from "update this one", and ids for new records are generated **in the browser** (`nextId`: highest number + 1 over the browser's possibly stale copy of the board). Two people creating at about the same time therefore got the same id, and the second **silently overwrote** the first (HTTP 200, no error). Related: edits sent the *whole record as it was on screen*, so a colleague's newer change to another field was written back with an old value, and photo lists were replaced instead of appended.

## What changed
| # | Problem | Fix | Where |
|---|---|---|---|
| 1 | Same-id create overwrites | Creating ops carry `create:true` → server **inserts**; an existing id is **409** (raised before any write of the batch). Same new id twice in a batch, and an e-mail already used by another user, are 409 too | `server.js` (`assertCreatesAndUniques`, `writeRecord`), all `nextId` call sites in the frontend |
| 2 | Stale whole-record writes revert colleagues' changes | Snag status / reassignment and assignment status send **only the fields they change**; Masters edits send only **changed fields** (`diffRecord`) | `useActions.ts`, `RecordModal.tsx`, `shared/recordDiff.ts` |
| 3 | Photo list replaced → a photo lost | New op field `push:{photos|comments: obj}` (snags) → `$push` | `server.js`, `useActions.ts`, `applyOpsLocal.ts` |
| 4 | Every unexpected error → HTTP 400 → browser drops the edit | duplicate key → **409**; transient database/network problem → **503** (browser keeps and retries; safe because batches are idempotent); everything else 400 as before | `errorMap.js`, top-level handler |
| 5 | Failed save followed by a "Saved!" toast | the toast pages get stays silent for 2 s after a save that did not reach the server; failure toasts last longer; offline-queued saves now say so | `AppContext.tsx` |
| 6 | A refused change vanished with its typed-in data | kept in `localStorage["neoteric_rejected_ops"]` (max 25, **never a plaintext password**) | `shared/rejected.ts` |
| 7 | Restoring an old backup emptied collections it does not contain; no way back | restore and reset first save the live board as `pre-restore:` / `pre-reset:` backup; a collection missing from the backup is **kept**; `skipSafetyBackup:true` opts out | `server.js` |
| 8 | Deleted VMS-origin DPR comes back at the next poll | delete leaves `meta` tombstone `tomb:<id>`; the poller and the live push skip it | `server.js`, `syncVmsDpr.js`, `vmsDprApiHandler.js` |
| 9 | VMS reports with an unmatched project skipped forever, only a console line | one record `meta` `vms-dpr-unmatched` (names + count) while any exist | `syncVmsDpr.js` |
| 10 | Two concurrent team-report runs could overwrite a sign-off | insert-only | `server.js` |

## Compatibility (zero breaking change)
- Old browser + new backend: ops without `create`/`push` behave **exactly as before**.
- New browser + old backend: `create` is ignored (old behaviour); **`push` is ignored, so a snag photo added in that window would not be saved.** Therefore **deploy the backend first, wait until it is live, then the frontend** (two separate pushes: the backend commit, then the frontend commit).
- No schema change, no migration. New `meta` documents: `tomb:<id>` (per deleted VMS-origin record) and `vms-dpr-unmatched`. Restore/reset add one extra `backups` document each.
- New response codes (409/503) are non-OK for older browsers, which already treat them as "re-sync and show the error".

## NOT fixed (still open)
- **Stage-progress checklists** (`progress` ops): the `checklist` array is replaced as a whole — two inspectors on different items of the same unit/stage can overwrite each other.
- **Approvals** (`approval.ts`) and **measurement link confirmation** still send the whole record (the server's validation needs the full record).
- **Permission matrix** per-user grants: last writer wins for the whole grants object.
- **Atomic batches:** a failure in the middle of a batch (other than the conflicts now pre-checked) can still leave the earlier ops written.
- **The 5000-event audit cap** and admin hard-deletes are unchanged (by design); `/api/reset` still clears the audit log (the safety backup now carries a copy).
- **Callers** that close their modal after a refused save still lose the form's contents on screen (they are kept in `neoteric_rejected_ops`, there is no UI to view them yet).
- Production data was **not** inspected; whether and how much data was lost in production is unknown.

## Tests
`backend/errorMap.test.js` (6) · `backend/dataIntegrity.e2e.js` (36 checks, real server + in-memory MongoDB, mutation-checked) · `frontend/tests/dataIntegrity.test.mjs` (10) · `frontend/tests/browser-integrity.check.cjs` (real Edge: two admins create the same user id through the real Add User screen — 11 checks). The two e2e/browser scripts need the dev-only `mongodb-memory-server` (and `puppeteer-core` for the browser one) outside the project; see `docs/save-diagnostics-synthetic-test.md`.
