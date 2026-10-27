/* Plain-Node tests for vmsDprApiHandler.js (POST /api/integrations/vms/dpr's
   actual logic) — no framework, no real Mongo connection, no running HTTP
   server. Auth (the shared-secret header check) stays inline in server.js
   since it's a two-line reuse of the already-trusted AUTOMATION_SECRET
   pattern — this covers the substantive logic: validation, idempotency,
   project-mapping rejection, and that an existing DPR is never overwritten.
   Run with: node vmsDprApi.test.js */
const assert = require("assert");
const { handleVmsDprSync, vmsSyncWroteRecord } = require("./vmsDprApiHandler.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

function fakeMongoDb({ projects = [], dpr = [] } = {}) {
  const store = { projects, dpr };
  const inserted = [];
  return {
    _inserted: inserted,
    collection(name) {
      return {
        findOne: async (query, opts) => {
          const row = store[name].find((d) => Object.keys(query).every((k) => d[k] === query[k]));
          if (!row) return null;
          if (opts && opts.projection) {
            const out = {};
            for (const k of Object.keys(opts.projection)) out[k] = row[k];
            return out;
          }
          return row;
        },
        insertOne: async (doc) => {
          if (store.dpr.some((d) => d.id === doc.id)) {
            const err = new Error("duplicate key");
            err.code = 11000;
            throw err;
          }
          store.dpr.push(doc);
          inserted.push(doc);
          return { insertedId: doc.id };
        }
      };
    }
  };
}

const VALID_BODY = {
  id: "DPR-VMS-abc123",
  projectId: "PRJ-011",
  projectName: "West Gate",
  date: "2026-10-12",
  vendorCode: "VC-02",
  vendorName: "Beta Contractors",
  shift: "Night",
  labourCount: 7,
  workEntries: [
    { category: "RCC", generalPhotos: [{ url: "https://x/1.jpg", publicId: null }], beforePhotos: [], afterPhotos: [], qty: 10, unit: "sq.ft" }
  ],
  submittedByUserId: "U-01",
  submittedByName: "Dinesh",
  isPublic: false
};
const PROJECTS = [{ id: "PRJ-011", name: "Regal Garden Villa - West Gate" }];

async function main() {
  for (const field of ["id", "projectId", "date", "vendorCode", "shift", "labourCount"]) {
    await test(`rejects a request missing required field "${field}" with 400`, async () => {
      const db = fakeMongoDb({ projects: PROJECTS });
      const body = { ...VALID_BODY };
      delete body[field];
      const res = await handleVmsDprSync(body, db);
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes(field));
      assert.strictEqual(db._inserted.length, 0);
    });
  }

  await test("rejects an id not in the DPR-VMS-<sourceId> form", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    const res = await handleVmsDprSync({ ...VALID_BODY, id: "DPR-0001" }, db);
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes("DPR-VMS-"));
  });

  await test("rejects a projectId that isn't a known QC project (invalid project mapping)", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    const res = await handleVmsDprSync({ ...VALID_BODY, projectId: "PRJ-999" }, db);
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes("PRJ-999"));
    assert.strictEqual(db._inserted.length, 0);
  });

  await test("a valid new request inserts the record and preserves workEntries/photos/qty/unit exactly", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    const res = await handleVmsDprSync(VALID_BODY, db);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true, id: VALID_BODY.id, created: true });
    assert.strictEqual(db._inserted.length, 1);
    assert.deepStrictEqual(db._inserted[0].workEntries, VALID_BODY.workEntries);
    assert.strictEqual(db._inserted[0].projectName, "West Gate");
  });

  await test("a duplicate id (already in QC) is an idempotent no-op, never an overwrite, never an error", async () => {
    const db = fakeMongoDb({ projects: PROJECTS, dpr: [{ id: VALID_BODY.id, labourCount: 999 }] });
    const res = await handleVmsDprSync(VALID_BODY, db);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true, id: VALID_BODY.id, created: false });
    assert.strictEqual(db._inserted.length, 0, "must never call insertOne for an id that already exists");
    // the pre-existing record (with its distinguishing labourCount) is untouched
    const existing = await db.collection("dpr").findOne({ id: VALID_BODY.id });
    assert.strictEqual(existing.labourCount, 999);
  });

  await test("a duplicate-key race (insertOne throws 11000) is treated the same as a pre-existing record, not an error", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    // Simulate another writer (the poller/direct-DB push) landing the same
    // id between our findOne check and our insertOne, by seeding `dpr`
    // only inside insertOne's own duplicate-check — easiest to simulate by
    // calling handleVmsDprSync twice concurrently against the same store.
    const [a, b] = await Promise.all([handleVmsDprSync(VALID_BODY, db), handleVmsDprSync(VALID_BODY, db)]);
    const results = [a.status, b.status];
    assert.deepStrictEqual(results, [200, 200]);
    assert.strictEqual(db._inserted.length, 1, "exactly one of the two concurrent calls actually inserted");
  });

  await test("projectName falls back to the QC project's own name when the request omits it", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    const body = { ...VALID_BODY };
    delete body.projectName;
    const res = await handleVmsDprSync(body, db);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(db._inserted[0].projectName, "Regal Garden Villa - West Gate");
  });

  await test("vmsSyncWroteRecord is true ONLY for a real insert (drives the board-revision bump)", async () => {
    const db = fakeMongoDb({ projects: PROJECTS });
    const created = await handleVmsDprSync(VALID_BODY, db);
    assert.strictEqual(vmsSyncWroteRecord(created), true);
    const dup = await handleVmsDprSync(VALID_BODY, db);
    assert.strictEqual(vmsSyncWroteRecord(dup), false, "duplicate wrote nothing");
    const rejected = await handleVmsDprSync({ ...VALID_BODY, id: "" }, fakeMongoDb({ projects: PROJECTS }));
    assert.strictEqual(vmsSyncWroteRecord(rejected), false, "rejection wrote nothing");
    assert.strictEqual(vmsSyncWroteRecord(null), false);
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
}

main();
