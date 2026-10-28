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
| 11 | Approval decisions and measurement-link confirmations rewrote the whole record | send only `{id, approval}` / `{id, linkedItemId}`; the server validates against the **stored** record (`recordForValidation`) | `approvalOp.ts`, `Measurement.tsx`, `server.js` |
| 12 | Item-based stage checklists: two people on different items overwrote each other's cells | **`PROGRESS_CELL_MERGE=1`** (default OFF): one atomic pipeline update merges cells by `itemId` (fields of the same cell are unioned); checklists without `itemId` are replaced as before | `server.js` (`progressUpdate`) |
| 13 | A failure in the middle of a batch left earlier ops written (and a retry then hit 409 on its own creates) | **`OPS_ATOMIC=1`** (default OFF): the write phase of a batch runs in ONE transaction (all or nothing); Slack follow-ups are sent after the commit; falls back to the old behaviour if transactions are unavailable | `server.js` (`sessionDb`, `writeAll`) |
| 14 | Permission matrix: the last admin to save overwrote every module another admin changed | saves only the modules/flags this admin changed since the user/role was loaded (dotted keys `grants.<module>`); also fixes the role editor writing the stored (old) `grants` back over the edited ones | `PermissionMatrix.tsx`, `recordDiff.ts`, `applyOpsLocal.ts` |
| 15 | A refused change had no UI | "N change(s) refused — view" badge: list, copy details, dismiss | `RejectedChangesBadge.tsx` |

## Flags (both default OFF; set to exactly `1` on Render, then restart)
| Variable | Effect | Roll back |
|---|---|---|
| `OPS_ATOMIC` | each `/api/ops` batch is written in one database transaction | unset + restart |
| `PROGRESS_CELL_MERGE` | item-based checklist cells are merged by `itemId` | unset + restart |
Verified locally on a one-node replica set (`backend/dataIntegrity2.e2e.js`, 17 checks, mutation-checked: with both flags off the same checks fail — partial batch written, 1 of 10 cells survives). **Not verified on Atlas/Render.** Without `OPS_ATOMIC` a mid-batch failure can still leave earlier ops written, and a retry of such a batch can then answer 409 for its own creates.

## Compatibility (zero breaking change)
- Old browser + new backend: ops without `create`/`push` behave **exactly as before**.
- New browser + old backend: `create` is ignored (old behaviour); **`push` is ignored, so a snag photo added in that window would not be saved.** Therefore **deploy the backend first, wait until it is live, then the frontend** (two separate pushes: the backend commit, then the frontend commit).
- No schema change, no migration. New `meta` documents: `tomb:<id>` (per deleted VMS-origin record) and `vms-dpr-unmatched`. Restore/reset add one extra `backups` document each.
- New response codes (409/503) are non-OK for older browsers, which already treat them as "re-sync and show the error".

## Still open (honest list)
- **Item-stage `status`** (`wip`/`done`) is still computed in the browser from its own view of the cells. If two people complete the last two items at the same moment, both may compute `wip`; the next action on that stage corrects it. (Computing it on the server needs the stage's item list.)
- **Atomic batches and the cell merge are flag-gated** (see above): until the flags are turned on in production, those two risks remain.
- **The 5000-event audit cap and admin hard-deletes** are unchanged (by design); `/api/reset` still clears the audit log (its safety backup now carries a copy).
- A form that closes after a refused save still loses what was on screen; the content is in the refused-changes list (badge).
- Production data was **not** inspected; whether and how much data was lost in production is unknown.

## Tests
`backend/errorMap.test.js` (6) · `backend/dataIntegrity.e2e.js` (39 checks, real server + in-memory MongoDB, mutation-checked) · `backend/dataIntegrity2.e2e.js` (17 checks, replica set, flags ON) · `frontend/tests/dataIntegrity.test.mjs` (13) · `frontend/tests/browser-integrity.check.cjs` (real Edge: two admins create the same user id through the real Add User screen, the refused-changes badge — 14 checks). The e2e/browser scripts need the dev-only `mongodb-memory-server` (and `puppeteer-core` for the browser one) outside the project; see `docs/save-diagnostics-synthetic-test.md`.
