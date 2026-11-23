/* Backup creation / listing (Phases A+B of docs/backup-storage-investigation.md).

   Two storage formats, both readable/restorable:
   - format 1 (no `format` field, every pre-existing backup): one `backups`
     document holding every collection, same as always.
   - format 2 (`format: 2`): used automatically ONLY when the assembled board
     would exceed MongoDB's 16 MB document limit. The `backups` doc becomes a
     small manifest ({id, createdAt, createdBy, format:2, status, counts,
     eventCount, sizeBytes, buildMs}); the actual rows live in a separate
     `backupChunks` collection ({backupId, coll, seq, rows[]}), each chunk
     capped around CHUNK_TARGET_BYTES. Write order is manifest(status:"writing")
     -> chunks -> manifest(status:"complete"), so a crash mid-write can never
     leave something that looks valid — loadBackupDoc() refuses a "writing"
     manifest, and a failed chunk write deletes its own manifest + any chunks
     it did get written, so it never appears in a listing at all.
     `progress` and `events` are stored as two more pseudo-collections
     (`__progress` as [key, patch] pairs, `__events` as rows) under the same
     chunk scheme, not duplicated in the manifest.

   Audit events: `events` is not in COLLECTIONS, so older backups never
   contained it. New backups include a copy of the audit log. A RESTORE still
   never replaces the live `events` (it keeps what happened after the backup
   and appends a RESTORE_BACKUP record) — the copy exists so audit history
   survives loss of the live collection; recovering it is a separate, explicit
   step (scripts/recover-events-from-backup.js, documented in
   docs/backup-storage-investigation.md). Retention of `events` is untouched. */

const { BSON } = require("mongodb");

const DOC_LIMIT = 16 * 1024 * 1024;     // MongoDB's hard BSON document limit
const WARN_BYTES = 8 * 1024 * 1024;     // start shouting well before the limit
const HARD_STOP_BYTES = DOC_LIMIT - 512 * 1024;
const CHUNK_TARGET_BYTES = 4 * 1024 * 1024; // target size per backupChunks document

class BackupTooLargeError extends Error {
  constructor(sizeBytes) {
    super(`Backup is ${(sizeBytes / 1048576).toFixed(1)} MB — it would exceed MongoDB's 16 MB document limit, so it was NOT saved. `
      + "A chunked backup format is required (see docs/backup-storage-investigation.md, Phase B). Existing backups are unaffected.");
    this.name = "BackupTooLargeError";
    this.sizeBytes = sizeBytes;
  }
}

/* Splits `rows` into sub-arrays whose BSON size each stay under roughly
   CHUNK_TARGET_BYTES. A single row bigger than that target still gets its own
   (oversized) chunk — correctness over neatness. Always returns at least one
   (possibly empty) chunk, so an empty collection still gets a seq entry and
   round-trips as [] rather than being silently absent. */
function chunkRows(rows) {
  const chunks = [];
  let current = [];
  let currentSize = 0;
  for (const row of rows) {
    const rowSize = BSON.calculateObjectSize(row);
    if (current.length && currentSize + rowSize > CHUNK_TARGET_BYTES) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(row);
    currentSize += rowSize;
  }
  if (current.length || chunks.length === 0) chunks.push(current);
  return chunks;
}

/* Reads the whole board and stores it as one backup — format 1 (single
   document) when it fits under HARD_STOP_BYTES, format 2 (chunked) otherwise.
   `log` receives one line with size and timings (and a warning above
   WARN_BYTES either way). Throws on failure — callers decide how to report it. */
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

  const id = "BK-" + Date.now().toString(36).toUpperCase();
  const createdAt = Date.now();
  const buildMs0 = Date.now() - t0;

  const fullDoc = { id, createdAt, createdBy: createdBy || null, collections, progress, events };
  const sizeBytes = BSON.calculateObjectSize(fullDoc) + 32; // + room for the two numeric fields themselves

  if (sizeBytes > WARN_BYTES) {
    log.warn(`[backup] WARNING: backup is ${(sizeBytes / 1048576).toFixed(2)} MB (limit 16 MB)`
      + (sizeBytes > HARD_STOP_BYTES ? " — storing as chunked format 2" : " — plan the chunked format (docs/backup-storage-investigation.md)"));
  }

  if (sizeBytes <= HARD_STOP_BYTES) {
    fullDoc.buildMs = buildMs0;
    fullDoc.sizeBytes = sizeBytes;
    await db.collection("backups").insertOne(fullDoc);
    log.log(`[backup] ${id} by ${createdBy || "?"}: ${(sizeBytes / 1048576).toFixed(2)} MB (${(sizeBytes / DOC_LIMIT * 100).toFixed(1)}% of limit), `
      + `${events.length} audit events, read ${buildMs0} ms, total ${Date.now() - t0} ms`);
    return fullDoc;
  }

  // Format 2 — chunked. Manifest first (status "writing"), then chunks, then
  // flip to "complete" — see the module doc comment for why this order matters.
  const counts = {};
  for (const c of collectionNames) counts[c] = collections[c].length;
  const manifest = {
    id, createdAt, createdBy: createdBy || null,
    format: 2, status: "writing",
    counts, eventCount: events.length,
    buildMs: buildMs0, sizeBytes
  };
  await db.collection("backups").insertOne(manifest);
  try {
    const chunkDocs = [];
    let seq = 0;
    for (const c of collectionNames) {
      for (const rows of chunkRows(collections[c])) chunkDocs.push({ backupId: id, coll: c, seq: seq++, rows });
    }
    for (const rows of chunkRows(Object.entries(progress))) chunkDocs.push({ backupId: id, coll: "__progress", seq: seq++, rows });
    for (const rows of chunkRows(events)) chunkDocs.push({ backupId: id, coll: "__events", seq: seq++, rows });
    if (chunkDocs.length) await db.collection("backupChunks").insertMany(chunkDocs);
    await db.collection("backups").updateOne({ id }, { $set: { status: "complete" } });
    manifest.status = "complete"; // keep the returned object in sync with what was just written to the DB
  } catch (e) {
    // Never leave a half-written backup looking listable/restorable.
    await db.collection("backupChunks").deleteMany({ backupId: id }).catch(() => {});
    await db.collection("backups").deleteOne({ id }).catch(() => {});
    throw e;
  }
  log.log(`[backup] ${id} by ${createdBy || "?"}: ${(sizeBytes / 1048576).toFixed(2)} MB stored as chunked format 2, `
    + `${events.length} audit events, read ${buildMs0} ms, total ${Date.now() - t0} ms`);
  return manifest;
}

/* Reconstructs a backup's full {collections, progress, events} shape
   regardless of format — the single source every reader (GET /api/backups/:id,
   restoreBackup) goes through. Returns null if the id doesn't exist; throws a
   409 if a format-2 backup is still mid-write (should only ever be seen if the
   server crashed between the manifest insert and the chunk writes finishing —
   normal createBackup() callers await the whole thing). */
async function loadBackupDoc(db, id) {
  const manifest = await db.collection("backups").findOne({ id });
  if (!manifest) return null;
  if (manifest.format !== 2) return manifest; // format 1: already everything
  if (manifest.status !== "complete") {
    const e = new Error("This backup is still being written — try again in a moment.");
    e.status = 409;
    throw e;
  }
  const chunkDocs = await db.collection("backupChunks").find({ backupId: id }).sort({ seq: 1 }).toArray();
  const collections = {};
  const progress = {};
  let events = [];
  for (const chunk of chunkDocs) {
    if (chunk.coll === "__progress") { for (const [key, patch] of chunk.rows) progress[key] = patch; }
    else if (chunk.coll === "__events") { events = events.concat(chunk.rows); }
    else { collections[chunk.coll] = (collections[chunk.coll] || []).concat(chunk.rows); }
  }
  return Object.assign({}, manifest, { collections, progress, events });
}

/* Deletes a backup's chunk rows along with its own `backups` document —
   format 1 has no chunks, so this is a harmless no-op delete for those. */
async function deleteBackup(db, id) {
  await db.collection("backupChunks").deleteMany({ backupId: id });
  return db.collection("backups").deleteOne({ id });
}

function summarizeBackup(doc) {
  const out = { id: doc.id, createdAt: doc.createdAt, createdBy: doc.createdBy };
  if (doc.format === 2) {
    out.counts = doc.counts || {};
    if (typeof doc.eventCount === "number") out.eventCount = doc.eventCount;
  } else {
    const counts = {};
    for (const c of Object.keys(doc.collections || {})) counts[c] = doc.collections[c].length;
    out.counts = counts;
    if (Array.isArray(doc.events)) out.eventCount = doc.events.length;
  }
  if (typeof doc.sizeBytes === "number") out.sizeBytes = doc.sizeBytes;
  return out;
}

/* Same summaries as `find({}).toArray().map(summarizeBackup)`, but computed inside
   MongoDB so the full backup documents are never loaded into server memory.
   A format-2 backup still mid-write ("writing") is excluded entirely — it
   isn't restorable yet, and should normally never be seen (only possible if
   the server crashed between the manifest insert and the chunks finishing). */
async function listBackupSummaries(db) {
  const rows = await db.collection("backups").aggregate([
    { $match: { status: { $ne: "writing" } } },
    { $sort: { createdAt: -1 } },
    { $project: {
        _id: 0, id: 1, createdAt: 1, createdBy: 1,
        sizeBytes: { $ifNull: ["$sizeBytes", { $bsonSize: "$$ROOT" }] },
        // format 2's manifest stores counts/eventCount directly (there are no
        // `collections`/`events` arrays on it to size); format 1 (no `counts`
        // field) falls back to sizing the embedded arrays, same as before.
        eventCount: { $ifNull: ["$eventCount", { $cond: [{ $isArray: "$events" }, { $size: "$events" }, "$$REMOVE"] }] },
        counts: { $ifNull: ["$counts", { $arrayToObject: { $map: {
          input: { $objectToArray: { $ifNull: ["$collections", {}] } },
          as: "c",
          in: { k: "$$c.k", v: { $size: { $ifNull: ["$$c.v", []] } } }
        } } }] }
    } }
  ]).toArray();
  return rows;
}

module.exports = {
  createBackup, summarizeBackup, listBackupSummaries, loadBackupDoc, deleteBackup,
  BackupTooLargeError, DOC_LIMIT, WARN_BYTES, HARD_STOP_BYTES, CHUNK_TARGET_BYTES
};
