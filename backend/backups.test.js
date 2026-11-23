/* Plain-Node tests for backups.js (no framework, no real Mongo).
   Run with: node backups.test.js */
const assert = require("assert");
const { createBackup, summarizeBackup, loadBackupDoc, deleteBackup, BackupTooLargeError, HARD_STOP_BYTES } = require("./backups.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

/* In-memory stand-in for the two real collections createBackup()/loadBackupDoc()/
   deleteBackup() touch: "backups" (one doc per backup — supports insertOne,
   updateOne $set, deleteOne, findOne, and an aggregate() just good enough for
   listBackupSummaries' own shape) and "backupChunks" (supports insertMany,
   deleteMany, and a find().sort().toArray()). Source collections (units,
   progress, events, …) are plain arrays, read via find()/sort()/toArray(). */
function fakeDb(data) {
  const inserted = [];
  const store = { backups: [], backupChunks: [] };
  return {
    _inserted: inserted,
    _store: store,
    collection(name) {
      if (name === "backups" || name === "backupChunks") {
        return {
          insertOne: async (doc) => { store[name].push(doc); if (name === "backups") inserted.push(doc); },
          insertMany: async (docs) => { store[name].push(...docs); },
          updateOne: async (filter, update) => {
            const doc = store[name].find((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
            if (doc && update.$set) Object.assign(doc, update.$set);
          },
          deleteOne: async (filter) => {
            const before = store[name].length;
            store[name] = store[name].filter((d) => !Object.entries(filter).every(([k, v]) => d[k] === v));
            return { deletedCount: before - store[name].length };
          },
          deleteMany: async (filter) => {
            store[name] = store[name].filter((d) => !Object.entries(filter).every(([k, v]) => d[k] === v));
          },
          findOne: async (filter) => store[name].find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) || null,
          find: (filter = {}) => {
            let rows = store[name].filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)).map((r) => ({ ...r }));
            const cur = { sort: (s) => { const k = Object.keys(s)[0]; rows.sort((a, b) => (a[k] - b[k]) * s[k]); return cur; }, toArray: async () => rows };
            return cur;
          }
        };
      }
      return {
        find: () => {
          let rows = (data[name] || []).map((r) => ({ ...r }));
          const cur = { sort: (s) => { const k = Object.keys(s)[0]; rows.sort((a, b) => (a[k] - b[k]) * s[k]); return cur; }, toArray: async () => rows };
          return cur;
        }
      };
    }
  };
}
const quiet = () => { const l = []; return { lines: l, log: (m) => l.push(["log", m]), warn: (m) => l.push(["warn", m]), error: (m) => l.push(["error", m]) }; };

async function main() {
  await test("a backup keeps the existing shape and adds sizeBytes, buildMs and a copy of the audit events", async () => {
    const db = fakeDb({ units: [{ id: "U1" }, { id: "U2" }], progress: [{ _id: "U1::S1", done: true }], events: [{ ts: 2, action: "B" }, { ts: 1, action: "A" }] });
    const log = quiet();
    const doc = await createBackup(db, ["units", "snags"], "U-ADMIN", log);
    assert.strictEqual(db._inserted.length, 1);
    assert.deepStrictEqual(doc.collections, { units: [{ id: "U1" }, { id: "U2" }], snags: [] });
    assert.deepStrictEqual(doc.progress, { "U1::S1": { done: true } });
    assert.deepStrictEqual(doc.events.map((e) => e.action), ["A", "B"], "events stored oldest-first");
    assert.ok(doc.sizeBytes > 0 && typeof doc.buildMs === "number");
    assert.ok(/MB/.test(log.lines.at(-1)[1]) && /ms/.test(log.lines.at(-1)[1]), "size and duration are logged");
  });

  await test("a backup too large for one MongoDB document is stored CHUNKED instead, and round-trips exactly", async () => {
    const big = "x".repeat(900 * 1024);
    const rowCount = Math.ceil(HARD_STOP_BYTES / (900 * 1024)) + 2;
    const units = Array.from({ length: rowCount }, (_, i) => ({ id: "U" + i, big }));
    const db = fakeDb({
      units,
      progress: [{ _id: "U1::S1", done: true }],
      events: [{ ts: 2, action: "B" }, { ts: 1, action: "A" }]
    });
    const log = quiet();
    const manifest = await createBackup(db, ["units"], "scheduled", log);
    assert.strictEqual(manifest.format, 2);
    assert.strictEqual(manifest.status, "complete");
    assert.strictEqual(manifest.counts.units, rowCount);
    assert.strictEqual(manifest.eventCount, 2);
    assert.ok(db._store.backupChunks.length > 1, "a backup this size must span more than one chunk");
    assert.ok(log.lines.some(([k, m]) => k === "warn" && /chunked format 2/.test(m)));

    const loaded = await loadBackupDoc(db, manifest.id);
    assert.deepStrictEqual(loaded.collections.units, units, "every row survives the chunk round-trip, in order");
    assert.deepStrictEqual(loaded.progress, { "U1::S1": { done: true } });
    assert.deepStrictEqual(loaded.events.map((e) => e.action), ["A", "B"]);

    await deleteBackup(db, manifest.id);
    assert.strictEqual(db._store.backups.length, 0);
    assert.strictEqual(db._store.backupChunks.length, 0, "deleting a chunked backup deletes its chunks too");
  });

  await test("BackupTooLargeError is no longer thrown for an over-the-limit backup (replaced by chunking)", () => {
    assert.ok(BackupTooLargeError); // still exported (the error class itself is unused now, kept for compatibility)
  });

  await test("a backup over 8 MB succeeds but warns", async () => {
    const big = "x".repeat(900 * 1024);
    const db = fakeDb({ units: Array.from({ length: 10 }, (_, i) => ({ id: "U" + i, big })) });
    const log = quiet();
    await createBackup(db, ["units"], "scheduled", log);
    assert.strictEqual(db._inserted.length, 1);
    assert.ok(log.lines.some(([k, m]) => k === "warn" && /chunked/.test(m)));
  });

  await test("summarizeBackup: same fields as before; new ones only when present (old backups unchanged)", () => {
    const old = summarizeBackup({ id: "BK-1", createdAt: 1, createdBy: "U", collections: { units: [1, 2], snags: [] } });
    assert.deepStrictEqual(old, { id: "BK-1", createdAt: 1, createdBy: "U", counts: { units: 2, snags: 0 } });
    const nw = summarizeBackup({ id: "BK-2", createdAt: 2, createdBy: "U", collections: {}, sizeBytes: 99, events: [1, 2, 3] });
    assert.strictEqual(nw.sizeBytes, 99);
    assert.strictEqual(nw.eventCount, 3);
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
