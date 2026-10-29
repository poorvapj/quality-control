# QC → VMS copy of Daily Progress Reports

**Problem:** a DPR filed on QC only lived in QC's `dpr` collection; VMS's Daily Progress Report page reads its own `dailyprogressreports` collection, so QC-made DPRs never showed there. VMS → QC already existed (VMS's `syncToQc.js` live push + QC's 30-minute poller `syncVmsDpr.js`). This adds QC → VMS.

**Status: code only. OFF by default. Nothing is written to VMS until you enable it.**

## How it works (`backend/qcToVmsDpr.js`)
- When a DPR is **created** on QC (signed-in or the public form), after it is saved, it is copied into VMS's `dailyprogressreports` as one **insert**. Never an update or delete, so editing/deleting in QC does not change VMS.
- **Cannot hurt a QC submission:** fire-and-forget (the request never waits for it), short database timeouts (5 s connect), every failure is swallowed and logged as a one-line warning (no record content). If VMS is down, the DPR is simply "not copied yet".
- **No duplicates:** the VMS `_id` is derived from the QC id, so a retry or a race can only hit a duplicate-key error (= already there). No index is created on VMS.
- **No echo:** the VMS copy carries `qcId` and `source:"qc"`; `syncVmsDpr.js` skips VMS reports that have a `qcId`, so they are never imported back into QC as `DPR-VMS-…`. Only DPRs QC made itself (id not `DPR-VMS-…`) are copied.
- **Mapping:** QC project → VMS project **by project code** (then by exact name), else skipped (never guessed); `category` → `workType`; photos `{url, publicId}` → `{name, url}` in `images` / `beforeImages` / `afterImages`; `shift` → `shiftType`; date → UTC midnight `Date`; DRI name from `submittedByName` (VMS requires one; falls back to "QC user"); `driUserId`/`submittedBy` stay null.
- **Not copied:** QC's `qty`/`unit` per work entry (VMS's DPR schema has no place for them); edits and deletes.

## Enabling (when you decide to)
1. The `SOURCE_MONGO_URI` user must have **write** permission on the VMS database `vbp` (today it is only used to read; if it is read-only the copy just logs `error:` and nothing is written).
2. Render env: `QC_TO_VMS_DPR=1` and restart. From then on every **new** QC DPR is copied.
3. Optional backfill of older QC DPRs: first a **dry run** (writes nothing, prints counts only):
   `cd backend && node qcToVmsDpr.js --since 2026-10-01` — then, if the numbers look right, `node qcToVmsDpr.js --since 2026-10-01 --apply`. Setting `QC_TO_VMS_DPR_SINCE=2026-10-01` on Render additionally lets the existing 30-minute pass copy missing ones dated from that day (without it, nothing old is ever copied).
4. **Roll back:** unset `QC_TO_VMS_DPR`, restart. Copies already made stay in VMS (they are normal VMS DPR documents; delete them there by `qcId` if you ever want them gone).

## One thing to check on the VMS side
VMS's own bulk script `scripts/vms-to-qc-migrate.js` imports every VMS DPR into QC. It does not know about `qcId`, so running it after this is enabled would re-import the copies into QC as `DPR-VMS-<new id>` duplicates. It should skip documents with a `qcId` (the live VMS push `syncToQc.js` is not affected: it only fires for DPRs created through VMS's own controller).

## Tests
`backend/qcToVmsDpr.test.js` (13, no database) · `backend/qcToVmsDpr.e2e.js` (17 checks: real server + in-memory MongoDB with a pretend VMS database — flag OFF writes nothing, mapping, public DPR, edit does not touch VMS, unknown project skipped, no echo (mutation-checked), no duplicate under 10 concurrent pushes, dated backfill with dry run, **VMS unreachable: every QC save still 200 and not slowed**). Needs the dev-only `mongodb-memory-server` (see `docs/save-diagnostics-synthetic-test.md`). Not run against a real VMS database.
