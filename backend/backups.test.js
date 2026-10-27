/* Plain-Node tests for backups.js (no framework, no real Mongo).
   Run with: node backups.test.js */
const assert = require("assert");
const { createBackup, summarizeBackup, BackupTooLargeError, HARD_STOP_BYTES } = require("./backups.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

function fakeDb(data) {
  const inserted = [];
  return {
    _inserted: inserted,
    collection(name) {
      return {
        find: () => {
          let rows = (data[name] || []).map((r) => ({ ...r }));
          const cur = { sort: (s) => { const k = Object.keys(s)[0]; rows.sort((a, b) => (a[k] - b[k]) * s[k]); return cur; }, toArray: async () => rows };
          return cur;
        },
        insertOne: async (doc) => { inserted.push(doc); }
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

  await test("a backup too large for one MongoDB document is REFUSED loudly and nothing is stored", async () => {
    const big = "x".repeat(900 * 1024);
    const db = fakeDb({ units: Array.from({ length: Math.ceil(HARD_STOP_BYTES / (900 * 1024)) + 2 }, (_, i) => ({ id: "U" + i, big })) });
    const log = quiet();
    await assert.rejects(() => createBackup(db, ["units"], "scheduled", log), (e) => e instanceof BackupTooLargeError && /16 MB/.test(e.message));
    assert.strictEqual(db._inserted.length, 0);
    assert.ok(log.lines.some(([k]) => k === "error"));
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
