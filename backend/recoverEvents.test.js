/* Tests for recover-events-from-backup.js against a tiny in-memory fake (no Mongo).
   Run with: node recoverEvents.test.js */
const assert = require("assert");
const { recoverEvents } = require("./recover-events-from-backup.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
const ev = (ts, action = "A") => ({ ts, userId: "U", action, targetId: "T", stageId: "", detail: "d" + ts });
function fakeDb(backupEvents, live) {
  const writes = [];
  return {
    _live: live, _writes: writes,
    collection(name) {
      if (name === "backups") return { findOne: async () => ({ id: "BK-1", createdAt: 1, events: backupEvents }) };
      return {
        find: () => ({ toArray: async () => live.map((e) => ({ ...e })) }),
        insertMany: async (docs) => { writes.push(...docs); live.push(...docs); return { insertedCount: docs.length }; }
      };
    }
  };
}

async function main() {
  await test("dry run reports what is missing and writes NOTHING", async () => {
    const db = fakeDb([ev(1), ev(2), ev(3)], [ev(2)]);
    const r = await recoverEvents(db, "BK-1");
    assert.strictEqual(r.missing, 2); assert.strictEqual(r.toInsert, 2); assert.strictEqual(r.inserted, 0); assert.strictEqual(r.dryRun, true);
    assert.strictEqual(db._writes.length, 0);
  });
  await test("--apply inserts only the missing events; running it again changes nothing", async () => {
    const db = fakeDb([ev(1), ev(2), ev(3)], [ev(2)]);
    const r = await recoverEvents(db, "BK-1", { apply: true });
    assert.strictEqual(r.inserted, 2);
    assert.deepStrictEqual(db._live.map((e) => e.ts).sort(), [1, 2, 3]);
    const again = await recoverEvents(db, "BK-1", { apply: true });
    assert.strictEqual(again.missing, 0); assert.strictEqual(again.inserted, 0); assert.strictEqual(db._live.length, 3);
  });
  await test("recovering into an EMPTY live collection restores everything (the disaster case)", async () => {
    const db = fakeDb([ev(1), ev(2), ev(3)], []);
    const r = await recoverEvents(db, "BK-1", { apply: true });
    assert.strictEqual(r.inserted, 3);
  });
  await test("never exceeds the retention cap: only the newest events that fit are inserted, nothing is deleted", async () => {
    const live = Array.from({ length: 4998 }, (_, i) => ev(1000 + i, "LIVE"));
    const db = fakeDb([ev(1), ev(2), ev(3), ev(4)], live);
    const r = await recoverEvents(db, "BK-1", { apply: true });
    assert.strictEqual(r.inserted, 2); assert.strictEqual(r.leftInBackup, 2);
    assert.deepStrictEqual(db._writes.map((e) => e.ts), [3, 4]);
    assert.strictEqual(db._live.length, 5000);
  });
  await test("a backup made before events were included is reported, not an error, and nothing is written", async () => {
    const db = fakeDb(undefined, [ev(1)]);
    const r = await recoverEvents(db, "BK-1", { apply: true });
    assert.strictEqual(r.ok, false); assert.strictEqual(db._writes.length, 0);
  });
  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
