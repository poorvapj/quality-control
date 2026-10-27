# Backups and the 16 MB MongoDB document limit — investigation

## Status update — Phase A implemented (uncommitted; storage format unchanged)
Implemented in `backend/backups.js` (+ wiring in `server.js`), tested, **not deployed**:
1. **Cheap listing:** `GET /api/backups` now computes counts/size inside MongoDB (`$objectToArray`/`$size`/`$bsonSize`) instead of loading every full backup into memory. Same response shape plus optional `sizeBytes` and `eventCount`.
2. **Size and duration logging:** each backup logs `[backup] BK-… by …: 1.22 MB (7.6% of limit), N audit events, read X ms, total Y ms`; a warning above 8 MB; stored as additive `sizeBytes` / `buildMs` fields.
3. **Explicit failure reporting:** a backup that would exceed the 16 MB limit is **refused before the insert** with a clear message (`BackupTooLargeError`), nothing partial is stored. Scheduled route returns **HTTP 500** `{ok:false,error}` (an external cron pinger can alert on any non-200); every failure is logged, recorded as an audit event `BACKUP_FAILED` (visible in the Audit Log), and — if `SLACK_BOT_TOKEN` is set — DM'd to `BACKUP_ALERT_EMAILS` (default: the existing QC-report owner address). Manual `POST /api/backups` also returns 500 with the message instead of a generic 400.
4. **Audit events are now included in each new backup** (additive `events` array, ≤ the 5,000-event cap, oldest-first). Retention of the live `events` collection is **unchanged**; nothing is deleted anywhere.

### Audit history: what a restore does and how to recover events
- `restoreBackup` is unchanged: it replaces the board collections and `progress`, and **never touches live `events`** (so what happened after the backup stays recorded, and a `RESTORE_BACKUP` event is appended). Old backups (no `events` key) restore exactly as before — verified.
- **Recovery procedure (live `events` lost or damaged):**
  1. Pick the newest backup that has events: `GET /api/backups` shows `eventCount` (absent for pre-change backups).
  2. Dry run (writes nothing): `cd backend && node recover-events-from-backup.js <BK-id>`
  3. Review the counts (`inBackup`, `live`, `missing`, `toInsert`, `leftInBackup`).
  4. Apply: `node recover-events-from-backup.js <BK-id> --apply`. It **only inserts** events that are not already present (matched on ts+userId+action+targetId+stageId+detail), never updates or deletes, is idempotent, and inserts at most as many of the newest missing events as fit under the 5,000 cap (so the server does not immediately trim them); the rest remain in the backup document.
  5. Verify in the Audit Log page. Events after the newest backup are not recoverable from backups — only Atlas Cloud Backup / point-in-time restore (if enabled — **to be confirmed by you**) covers that window.
- Limits to be aware of: a backup only holds the *retained* events (cap 5,000), so events already trimmed before the first backup are gone; this change only prevents *future* loss of whatever the log holds at backup time.

### Backward compatibility, restore testing, storage, rollback (Phase A)
- **Compatibility:** all new fields are additive and optional; old backups list and restore unchanged (tested with a pre-existing old-format document); the `GET /api/backups/:id` shape is unchanged plus `events`. The Backups page needs no change.
- **Tested (real server, in-memory replica set):** list (old + new docs, counts identical to the old computation), admin-only access, password hashes stripped from downloads, restore of new- and old-format backups (restore happens inside a transaction and preserves live audit events + appends `RESTORE_BACKUP`), over-limit scheduled and manual backups → HTTP 500, nothing stored, `BACKUP_FAILED` event written, rev bumped. Unit tests: `backups.test.js` (4), `recoverEvents.test.js` (5).
- **Not tested:** Slack delivery of the alert (no Slack in the test environment — the code path is the same helper the weekly report uses); a restore of a >8 MB board; memory on Render.
- **Storage:** +≤ ~1 MB per backup at the 5,000-event cap (today the audit log is ~0.06 MB). No retention policy added — backups still accumulate until an admin deletes them (please decide a policy).
- **Rollback:** revert `backups.js` and the three route edits; backups already written keep their extra fields, which every reader ignores. `recover-events-from-backup.js` is standalone and can simply be deleted.
- **Still open — Phase B (chunked format) is NOT implemented.** At the observed ~1 MB/month growth the warning (8 MB) is expected in roughly 6 months and the hard stop (~15.5 MB) in roughly 14; those are projections from two data points.

---
## Original investigation (kept for reference)
**Status when written: investigation + proposal. No storage change, migration or deletion was made.** Measurements below came from a **read-only** script (`backend/scripts/inspect-deployment.js`: `hello`, `collStats`, `$bsonSize` aggregations; no writes; connection string never printed) run against the cluster that `backend/.env` points to, on 2026-10-27.

## 1. How backups work today (verified in `server.js`)
- `createBackup()` reads **every collection in `COLLECTIONS` plus `progress` into memory** and stores them as **one document** in `backups`: `{id, createdAt, createdBy, collections:{…all rows…}, progress:{…}}`.
- Triggers: admin `POST /api/backups`, and `GET /api/backup/scheduled` (external cron + `BACKUP_CRON_SECRET`).
- `restoreBackup()` runs a transaction: per collection `deleteMany({})` + `insertMany(rows)`, replaces `progress`, sets rev = rev+1, and appends a `RESTORE_BACKUP` event. **`events` is not in `COLLECTIONS`, so it is neither backed up nor touched by a restore** (the audit trail survives a restore but is *not recoverable* if the database is lost).
- `GET /api/backups` does `find({}).toArray()` — it **loads every full backup document into server memory** just to print counts.
- No retention: backups accumulate until an admin deletes them.

## 2. Measured (production-pointing cluster, read-only)
| Item | Value |
|---|---|
| Topology | replica set `atlas-dbrka5-shard-0`, 3 members, MongoDB 8.0.34 |
| Stored backups | 2: `BK-MUXNBMCP` 2026-10-07 = **0.65 MB (4.0% of 16 MB)**; `BK-MVLWS3GE` 2026-10-24 = **1.22 MB (7.6%)** |
| Live board (lower bound of one backup) | units 0.45 MB (2,640 docs), dpr 0.52 MB (823), qualityInspections 0.20 MB (10 docs ≈ 20 KB each), progress 0.07 MB (150), events 0.06 MB (397)… ≈ 1.31 MB |
| Largest collections | dpr, units, stagemap (464), qualityInspections |

## 3. Growth and when it fails (estimate, **not** a measurement)
- Only two data points: +0.57 MB in 17 days ≈ **1 MB/month** if linear → ~14 months to reach 16 MB.
- Not linear in practice: `dpr` grows with every VMS push, and a quality inspection is ~20 KB each (photo metadata/checklists). Heavier QC use (hundreds of inspections) could add several MB quickly. Treat "months, not years" as the planning horizon and re-measure monthly with the script.
- **Failure mode:** `insertOne` throws a BSON-size error → `POST /api/backups` returns an error and the **scheduled backup silently fails** (only the cron pinger sees it). Existing backups stay restorable, but no new ones are created — the safety net quietly stops.
- Also affected sooner than 16 MB: server memory (`createBackup` + `GET /api/backups` hold whole boards in RAM; Render free tier is 512 MB) and the Backups page latency.

## 4. Requirements for any new design
Existing backups stay readable/restorable unchanged; restore stays one atomic operation (today's guarantee); same `GET /api/backups/:id` shape `{collections, progress}` and same admin-only access; password hashes still excluded from API output but included for restore; audit history and offline queue unaffected; no destructive migration.

## 5. Proposed path (smallest change first)
**Phase A — no storage change (low risk, do first):**
1. `GET /api/backups`: list with an aggregation projecting `counts` via `$size`/`$objectToArray` instead of loading full documents (same response shape).
2. Record `sizeBytes` on new backups and **log a warning above ~8 MB**; make the scheduled endpoint return a non-200 and log loudly on failure.
3. Run `inspect-deployment.js` monthly (it is read-only).
4. Decide on retention (e.g., keep last 14 daily + 12 monthly) — deletion only by explicit admin action or an approved policy; **no automatic deletion without your approval**.
5. Decide whether `events` (audit history) should be included in backups.

**Phase B — chunked format (needed before ~8 MB; backward compatible):**
- `backups` doc becomes a small manifest `{id, createdAt, createdBy, counts, format:2, status}`; rows go to a new `backupChunks` collection `{backupId, coll, seq, rows[]}`, each chunk ≤ ~4 MB.
- Write order: manifest `status:"writing"` → chunks → manifest `status:"complete"`. A backup is only listed/restorable when `complete`, so a crash mid-write can never look valid.
- Reader supports **both** formats: `format` absent = today's embedded document (never rewritten). `GET /api/backups/:id` reassembles to the same `{collections, progress}` shape.
- Restore reads chunks into the same transaction as today (MongoDB 8 transactions are not limited to one 16 MB oplog entry). Verify memory and the 60 s transaction lifetime at 10× current data on staging.
- **Format 2 is used automatically only when the board exceeds a threshold** (e.g., 8 MB), so nothing changes for today's data volume.
- Rollback: stop writing format 2 (flag); format-1 and format-2 backups both remain readable.

**Phase C (alternative/complement):** Atlas native backup (cloud backup / point-in-time restore). Availability depends on the cluster **tier, which I cannot see** (shared M0/M2/M5 tiers don't offer it). Please check the tier in the Atlas console; if it's M10+ confirm Cloud Backup is enabled — it would make in-app backups a convenience copy rather than the only safety net.

## 6. Tests required before implementing Phase B
Round-trip (backup → restore → compare every collection and `progress` byte-for-byte); crash mid-write; restore of a pre-existing format-1 backup after the change; backup larger than 16 MB total; concurrent backup + live writes; admin-only access; password hashes excluded from API output but restored.

## 7. Decisions needed
Approve Phase A items 1–2; retention policy; include `events` in backups?; Atlas tier/Cloud Backup status; approve Phase B design in principle.
