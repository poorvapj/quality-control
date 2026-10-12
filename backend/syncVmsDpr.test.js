/* Plain-Node regression tests for syncVmsDpr.js — no test framework, no
   real Mongo connection. Run with: node syncVmsDpr.test.js
   Covers exactly the Phase 1 concerns: field-mapping parity (the
   before/after-photo bug just fixed), project-code-then-name matching,
   duplicate-id skipping (idempotency), unmatched-project reporting, and
   the "VMS unreachable/unconfigured" safe no-op path. */
const assert = require("assert");
const { mapWorkEntry, syncVmsDpr, POLLER_FAILURE_TYPE, POLLER_FAILURE_SOURCE_ID } = require("./syncVmsDpr.js");

// Minimal in-memory fake of the one Mongo op logPollerFailure/clearPollerFailure
// actually use (updateOne with $set/$inc/$setOnInsert/upsert) — enough to
// verify upsert-not-duplicate and resolvedAt-clearing behavior without a
// real Mongo connection.
function makeFakePollerFailuresCollection() {
  const docs = [];
  return {
    _docs: docs,
    updateOne: async (filter, update, opts) => {
      let doc = docs.find((d) => Object.keys(filter).every((k) => d[k] === filter[k]));
      if (!doc && opts && opts.upsert) {
        doc = { ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) for (const k of Object.keys(update.$inc)) doc[k] = (doc[k] || 0) + update.$inc[k];
        return { matchedCount: 1 };
      }
      return { matchedCount: 0 };
    }
  };
}

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

async function main() {
  // --- mapWorkEntry: the exact bug fixed this phase ---------------------
  await test("mapWorkEntry carries before/after photos through (previously hardcoded to [])", () => {
    const out = mapWorkEntry({
      workType: "Electrical",
      images: [{ url: "https://x/1.jpg" }],
      beforeImages: [{ url: "https://x/before.jpg", publicId: "p1" }],
      afterImages: [{ url: "https://x/after.jpg" }],
      qty: 42,
      unit: "sq.ft"
    });
    assert.strictEqual(out.category, "Electrical");
    assert.deepStrictEqual(out.generalPhotos, [{ url: "https://x/1.jpg", publicId: null }]);
    assert.deepStrictEqual(out.beforePhotos, [{ url: "https://x/before.jpg", publicId: "p1" }]);
    assert.deepStrictEqual(out.afterPhotos, [{ url: "https://x/after.jpg", publicId: null }]);
    assert.strictEqual(out.qty, 42);
    assert.strictEqual(out.unit, "sq.ft");
  });

  await test("mapWorkEntry drops photo entries with no url, and omits qty/unit when absent", () => {
    const out = mapWorkEntry({ workType: "Civil", images: [{ caption: "no url" }, null] });
    assert.deepStrictEqual(out.generalPhotos, []);
    assert.deepStrictEqual(out.beforePhotos, []);
    assert.deepStrictEqual(out.afterPhotos, []);
    assert.ok(!("qty" in out));
    assert.ok(!("unit" in out));
  });

  // --- syncVmsDpr: safe no-op when VMS isn't configured/reachable -------
  await test("syncVmsDpr returns {skipped:true} and never touches mongoDb when SOURCE_MONGO_URI is unset", async () => {
    delete process.env.SOURCE_MONGO_URI;
    const fakeMongoDb = { collection() { throw new Error("mongoDb should never be touched"); } };
    const result = await syncVmsDpr(fakeMongoDb);
    assert.deepStrictEqual(result, { skipped: true });
  });

  // --- full pipeline against an in-memory fake Mongo --------------------
  // Uses syncVmsDpr's test-only sourceDbOverride param — no real Mongo
  // connection, no network, no module mutation.
  const vmsReports = [
    // already synced by the live VMS push (same id) — must be skipped, not duplicated
    { _id: "r1", projectId: "vp1", projectName: "Zen Garden", vendorCode: "VC-01", vendorName: "Acme", shiftType: "Day", labourCount: 5, workEntries: [], driName: "Dinesh" },
    // new report, project matches by code (name differs, like the Regal/West Gate case)
    { _id: "r2", projectId: "vp2", projectName: "Regal Garden Villa - West Gate", vendorCode: "VC-02", vendorName: "Beta", shiftType: "Night", labourCount: 3, workEntries: [{ workType: "RCC", images: [] }], driName: "Dinesh" },
    // new report, project only matches by name (no VMS project doc / no code)
    { _id: "r3", projectId: null, projectName: "Hyde park", vendorCode: "VC-03", vendorName: "Gamma", shiftType: "Day", labourCount: 2, workEntries: [], driName: "Unknown Person" },
    // new report, project matches nothing at all — must be reported, not inserted
    { _id: "r4", projectId: "vp-missing", projectName: "Nonexistent Project", vendorCode: "VC-04", vendorName: "Delta", shiftType: "Day", labourCount: 1, workEntries: [], driName: "Dinesh" }
  ];
  const vmsProjects = [
    { _id: "vp1", code: "PRJ-013" },
    { _id: "vp2", code: "PRJ-011" }
  ];
  const qcProjects = [
    { id: "PRJ-013", name: "Zen Garden", code: "PRJ-013" },
    { id: "PRJ-011", name: "Regal Garden Villa - West Gate", code: "PRJ-011" },
    { id: "PRJ-012", name: "Hyde park", code: "PRJ-012" }
  ];
  const qcUsers = [{ id: "U-01", name: "Dinesh" }];
  const existingDprIds = [{ id: "DPR-VMS-r1" }];
  const insertedDocs = [];
  const pollerFailures = makeFakePollerFailuresCollection();

  function arr(rows) { return { find: () => ({ toArray: async () => rows }) }; }
  const fakeSourceDb = {
    collection(name) {
      if (name === "dailyprogressreports") return arr(vmsReports);
      if (name === "projects") return arr(vmsProjects);
      throw new Error("unexpected VMS collection: " + name);
    }
  };
  const fakeMongoDb = {
    collection(name) {
      if (name === "projects") return arr(qcProjects);
      if (name === "users") return arr(qcUsers);
      if (name === "dpr") return { find: () => ({ toArray: async () => existingDprIds }), insertMany: async (docs) => { insertedDocs.push(...docs); } };
      if (name === "pollerSyncFailures") return pollerFailures;
      throw new Error("unexpected QC collection: " + name);
    }
  };

  await test("full pipeline: skips already-synced id, matches by code and by name, reports unmatched, never duplicates", async () => {
    const result = await syncVmsDpr(fakeMongoDb, fakeSourceDb);
    const ids = insertedDocs.map((d) => d.id).sort();
    assert.deepStrictEqual(ids, ["DPR-VMS-r2", "DPR-VMS-r3"], "r1 already existed (skip), r4's project is unmatched (skip)");
    const r2 = insertedDocs.find((d) => d.id === "DPR-VMS-r2");
    assert.strictEqual(r2.projectId, "PRJ-011", "matched by code despite VMS/QC name difference");
    const r3 = insertedDocs.find((d) => d.id === "DPR-VMS-r3");
    assert.strictEqual(r3.projectId, "PRJ-012", "matched by name fallback (no VMS projectId/code)");
    assert.strictEqual(result.inserted, 2);
    assert.deepStrictEqual(result.skippedUnmatchedProjects, ["Nonexistent Project"]);
  });

  await test("re-running the sync against the same (now-updated) existing-id set inserts nothing new (idempotent)", async () => {
    insertedDocs.length = 0;
    existingDprIds.push({ id: "DPR-VMS-r2" }, { id: "DPR-VMS-r3" });
    const result = await syncVmsDpr(fakeMongoDb, fakeSourceDb);
    assert.strictEqual(insertedDocs.length, 0);
    assert.strictEqual(result.inserted, 0);
  });

  await test("a successful cycle with nothing to do never writes a poller-failure record (no needless write)", () => {
    assert.strictEqual(pollerFailures._docs.length, 0, "no prior failure existed, so clearPollerFailure must be a no-op, not a write");
  });

  // --- Phase 3: persistent poller-failure tracking -----------------------
  await test("a thrown cycle error is recorded as a poller failure (category, timestamp, safe message)", async () => {
    const brokenMongoDb = {
      collection(name) {
        if (name === "projects") return arr(qcProjects);
        if (name === "users") return arr(qcUsers);
        if (name === "dpr") return { find: () => { throw new Error("connection reset by peer"); } };
        if (name === "pollerSyncFailures") return pollerFailures;
        throw new Error("unexpected QC collection: " + name);
      }
    };
    await assert.rejects(() => syncVmsDpr(brokenMongoDb, fakeSourceDb), /connection reset by peer/);
    const doc = pollerFailures._docs.find((d) => d.type === POLLER_FAILURE_TYPE && d.sourceId === POLLER_FAILURE_SOURCE_ID);
    assert.ok(doc, "a failure record must exist");
    assert.strictEqual(doc.attempts, 1);
    assert.ok(doc.lastAttemptAt instanceof Date);
    assert.strictEqual(doc.resolvedAt, null);
    assert.ok(doc.reason.includes("connection reset by peer"));
    // never a credential/connection-string leak into the stored reason
    assert.ok(!doc.reason.includes("mongodb+srv://") && !doc.reason.includes("mongodb://"));
  });

  await test("a second consecutive failure updates the same record (attempts increments), never a duplicate", async () => {
    const brokenMongoDb = {
      collection(name) {
        if (name === "projects") return arr(qcProjects);
        if (name === "users") return arr(qcUsers);
        if (name === "dpr") return { find: () => { throw new Error("connection reset by peer"); } };
        if (name === "pollerSyncFailures") return pollerFailures;
        throw new Error("unexpected QC collection: " + name);
      }
    };
    await assert.rejects(() => syncVmsDpr(brokenMongoDb, fakeSourceDb));
    const matching = pollerFailures._docs.filter((d) => d.type === POLLER_FAILURE_TYPE && d.sourceId === POLLER_FAILURE_SOURCE_ID);
    assert.strictEqual(matching.length, 1, "still exactly one record, not a second row");
    assert.strictEqual(matching[0].attempts, 2, "attempts incremented, not reset");
  });

  await test("a later successful cycle clears the previously-logged poller failure (recovery)", async () => {
    const result = await syncVmsDpr(fakeMongoDb, fakeSourceDb);
    assert.ok(!result.skipped);
    const doc = pollerFailures._docs.find((d) => d.type === POLLER_FAILURE_TYPE && d.sourceId === POLLER_FAILURE_SOURCE_ID);
    assert.ok(doc.resolvedAt instanceof Date, "the earlier failure is now marked resolved");
  });

  // --- race against VMS's own live push (syncToQc.js) inserting the same
  //     id between this function's existing-id check and its own insert ---
  await test("a duplicate-key race with the live push doesn't abort the rest of the batch or throw", async () => {
    const raceReports = [
      { _id: "r5", projectId: "vp1", projectName: "Zen Garden", vendorCode: "VC-05", vendorName: "Epsilon", shiftType: "Day", labourCount: 1, workEntries: [], driName: "Dinesh" },
      { _id: "r6", projectId: "vp1", projectName: "Zen Garden", vendorCode: "VC-06", vendorName: "Zeta", shiftType: "Day", labourCount: 1, workEntries: [], driName: "Dinesh" }
    ];
    const raceSourceDb = {
      collection(name) {
        if (name === "dailyprogressreports") return arr(raceReports);
        if (name === "projects") return arr(vmsProjects);
        throw new Error("unexpected VMS collection: " + name);
      }
    };
    let insertManyCalls = 0;
    const raceMongoDb = {
      collection(name) {
        if (name === "projects") return arr(qcProjects);
        if (name === "users") return arr(qcUsers);
        if (name === "dpr") {
          return {
            find: () => ({ toArray: async () => [] }), // neither r5 nor r6 existed when this function checked
            insertMany: async (docs, opts) => {
              insertManyCalls++;
              assert.strictEqual(opts && opts.ordered, false, "must insert unordered so one duplicate can't drop the rest of the batch");
              // Simulate r5 having been inserted by the live push a moment ago
              const err = new Error("E11000 duplicate key");
              err.code = 11000;
              err.writeErrors = [{ code: 11000, index: 0 }];
              throw err;
            }
          };
        }
        if (name === "pollerSyncFailures") return makeFakePollerFailuresCollection();
        throw new Error("unexpected QC collection: " + name);
      }
    };
    const result = await syncVmsDpr(raceMongoDb, raceSourceDb);
    assert.strictEqual(insertManyCalls, 1);
    assert.strictEqual(result.inserted, 1, "r6 still counted as inserted even though r5's insert raced and lost");
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
}

main();
