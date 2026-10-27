/* Backup creation / listing (Phase 1 of docs/backup-storage-investigation.md).

   Storage format is UNCHANGED: one `backups` document per backup holding every
   collection (so every existing backup stays readable and restorable). Additive,
   optional fields only:
     sizeBytes   BSON size of the document
     buildMs     time to read + assemble the board
     events      the audit log at backup time (see below)

   Audit events: `events` is not in COLLECTIONS, so older backups never contained
   it. New backups include a copy of the audit log. A RESTORE still never
   replaces the live `events` (it keeps what happened after the backup and appends
   a RESTORE_BACKUP record) — the copy exists so audit history survives loss of
   the live collection; recovering it is a separate, explicit step
   (scripts/recover-events-from-backup.js, documented in
   docs/backup-storage-investigation.md). Retention of `events` is untouched. */

const { BSON } = require("mongodb");

const DOC_LIMIT = 16 * 1024 * 1024;     // MongoDB's hard BSON document limit
const WARN_BYTES = 8 * 1024 * 1024;     // start shouting well before the limit
const HARD_STOP_BYTES = DOC_LIMIT - 512 * 1024;

class BackupTooLargeError extends Error {
  constructor(sizeBytes) {
    super(`Backup is ${(sizeBytes / 1048576).toFixed(1)} MB — it would exceed MongoDB's 16 MB document limit, so it was NOT saved. `
      + "A chunked backup format is required (see docs/backup-storage-investigation.md, Phase B). Existing backups are unaffected.");
    this.name = "BackupTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

/* Reads the whole board and stores one backup document. `log` receives one line
   with size and timings (and a warning above WARN_BYTES). Throws on failure —
   callers decide how to report it. */
async function createBackup(db, collectionNames, createdBy, log = console) {
  const t0 = Date.now();
  const collections = {};
  for (const c of collectionNames) {
    collections[c] = await db.collection(c).find({}, { projection: { _id: 0 } }).toArray();
  }
  const progressDocs = await db.collection("progress").find({}).toArray();
  const progress = {};
  for (const p of progressDocs) { const { _id, ...rest } = p; progress[_id] = rest; }
  const events = await db.collection("events").find({}, { projection: { _id: 0 } }).sort({ ts: 1 }).toArray();

  const doc = {
    id: "BK-" + Date.now().toString(36).toUpperCase(),
    createdAt: Date.now(),
    createdBy: createdBy || null,
    collections,
    progress,
    events
  };
  doc.buildMs = Date.now() - t0;
  doc.sizeBytes = BSON.calculateObjectSize(doc) + 32; // + room for the two numeric fields themselves

  if (doc.sizeBytes > HARD_STOP_BYTES) {
    log.error(`[backup] ${doc.id} FAILED: ${(doc.sizeBytes / 1048576).toFixed(2)} MB exceeds the 16 MB document limit`);
    throw new BackupTooLargeError(doc.sizeBytes);
  }
  if (doc.sizeBytes > WARN_BYTES) {
    log.warn(`[backup] WARNING: backup is ${(doc.sizeBytes / 1048576).toFixed(2)} MB (limit 16 MB) — plan the chunked format (docs/backup-storage-investigation.md)`);
  }
  await db.collection("backups").insertOne(doc);
  log.log(`[backup] ${doc.id} by ${createdBy || "?"}: ${(doc.sizeBytes / 1048576).toFixed(2)} MB (${(doc.sizeBytes / DOC_LIMIT * 100).toFixed(1)}% of limit), `
    + `${events.length} audit events, read ${doc.buildMs} ms, total ${Date.now() - t0} ms`);
  return doc;
}

function summarizeBackup(doc) {
  const counts = {};
  for (const c of Object.keys(doc.collections || {})) counts[c] = doc.collections[c].length;
  const out = { id: doc.id, createdAt: doc.createdAt, createdBy: doc.createdBy, counts };
  if (typeof doc.sizeBytes === "number") out.sizeBytes = doc.sizeBytes;
  if (Array.isArray(doc.events)) out.eventCount = doc.events.length;
  return out;
}

/* Same summaries as `find({}).toArray().map(summarizeBackup)`, but computed inside
   MongoDB so the full backup documents are never loaded into server memory. */
async function listBackupSummaries(db) {
  const rows = await db.collection("backups").aggregate([
    { $sort: { createdAt: -1 } },
    { $project: {
        _id: 0, id: 1, createdAt: 1, createdBy: 1,
        sizeBytes: { $ifNull: ["$sizeBytes", { $bsonSize: "$$ROOT" }] },
        eventCount: { $cond: [{ $isArray: "$events" }, { $size: "$events" }, "$$REMOVE"] },
        counts: { $arrayToObject: { $map: {
          input: { $objectToArray: { $ifNull: ["$collections", {}] } },
          as: "c",
          in: { k: "$$c.k", v: { $size: { $ifNull: ["$$c.v", []] } } }
        } } }
    } }
  ]).toArray();
  return rows;
}

module.exports = { createBackup, summarizeBackup, listBackupSummaries, BackupTooLargeError, DOC_LIMIT, WARN_BYTES, HARD_STOP_BYTES };
