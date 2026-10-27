#!/usr/bin/env node
/* Recover audit events (`events`) from a backup.   DRY-RUN BY DEFAULT.
 *
 *   node recover-events-from-backup.js <backupId>            # report only, writes nothing
 *   node recover-events-from-backup.js <backupId> --apply    # insert the missing events
 *
 * When to use: the live `events` collection was lost or damaged. A normal
 * restore (POST /api/backups/:id/restore) deliberately leaves live events alone,
 * so audit history is recovered with this explicit, separate step.
 *
 * Safe by construction: it ONLY INSERTS events that are not already present
 * (matched on ts+userId+action+targetId+stageId+detail). It never updates or
 * deletes anything, so it cannot reduce audit history, and running it twice
 * changes nothing the second time. Only backups created after audit events were
 * added to backups carry an `events` copy; older backups have none.
 *
 * Retention: the live log is capped at MAX_EVENTS (server.js trimEvents, oldest
 * deleted first). To avoid inserting rows the server would immediately trim, only
 * as many of the NEWEST missing events as fit under the cap are inserted; the rest
 * stay available in the backup document. The cap itself is not changed.
 */
const MAX_EVENTS = 5000; // keep equal to server.js

const keyOf = (e) => [e.ts, e.userId, e.action, e.targetId, e.stageId, e.detail].join("\u0001");

async function recoverEvents(db, backupId, { apply = false } = {}) {
  const backup = await db.collection("backups").findOne({ id: backupId }, { projection: { id: 1, createdAt: 1, events: 1 } });
  if (!backup) throw new Error("Backup not found: " + backupId);
  if (!Array.isArray(backup.events)) {
    return { ok: false, reason: "This backup has no audit events copy (it was created before events were included).", inBackup: 0, missing: 0, toInsert: 0, inserted: 0 };
  }
  const live = await db.collection("events").find({}, { projection: { _id: 0, ts: 1, userId: 1, action: 1, targetId: 1, stageId: 1, detail: 1 } }).toArray();
  const have = new Set(live.map(keyOf));
  const missing = backup.events.filter((e) => !have.has(keyOf(e))).sort((a, b) => a.ts - b.ts);
  const room = Math.max(0, MAX_EVENTS - live.length);
  const toInsert = missing.slice(Math.max(0, missing.length - room)); // newest that fit
  let inserted = 0;
  if (apply && toInsert.length) {
    const r = await db.collection("events").insertMany(toInsert.map((e) => ({ ...e })), { ordered: true });
    inserted = r.insertedCount;
  }
  return {
    ok: true, backupId: backup.id, backupCreatedAt: backup.createdAt, inBackup: backup.events.length, live: live.length,
    missing: missing.length, toInsert: toInsert.length, leftInBackup: missing.length - toInsert.length, inserted, dryRun: !apply
  };
}

module.exports = { recoverEvents };

if (require.main === module) {
  (async () => {
    require("dotenv").config({ path: require("path").join(__dirname, ".env") });
    const { MongoClient } = require("mongodb");
    const id = process.argv[2];
    if (!id || id.startsWith("--")) { console.error("usage: node recover-events-from-backup.js <backupId> [--apply]"); process.exit(2); }
    const client = await new MongoClient(process.env.MONGODB_URI).connect();
    try {
      const res = await recoverEvents(client.db(process.env.MONGODB_DB || undefined), id, { apply: process.argv.includes("--apply") });
      console.log(res);
      if (res.ok && res.dryRun && res.toInsert) console.log("Dry run — nothing was written. Re-run with --apply to insert the events above.");
    } finally { await client.close(); }
  })().catch((e) => { console.error("failed:", e.message); process.exit(1); });
}
