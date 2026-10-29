/* Unit tests for qcToVmsDpr.js (no database). Run with: node qcToVmsDpr.test.js */
const assert = require("assert");
const { ObjectId } = require("mongodb");
const { isEnabled, mapQcDprToVms, vmsIdFor, createPusher } = require("./qcToVmsDpr.js");

let passed = 0, started = 0;
process.on("exit", (code) => { if (code === 0 && passed !== started) { console.error(`FAIL - ${started - passed} test(s) failed or never finished`); process.exitCode = 1; } });
function test(name, fn) {
  started++;
  return Promise.resolve().then(fn).then(() => { passed++; console.log("  ok -", name); }).catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

const P1 = new ObjectId("64b000000000000000000001"), P2 = new ObjectId("64b000000000000000000002");
const qcProjects = [{ id: "P-A", code: "PRJ-011", name: "West Gate" }, { id: "P-B", code: "", name: "Garden Villa" }];
const vmsProjects = [{ _id: P1, code: "PRJ-011", name: "Regal Garden Villa - West Gate" }, { _id: P2, code: "PRJ-099", name: "Garden Villa" }];
const dpr = (over = {}) => ({
  id: "DPR-ABC-1", projectId: "P-A", projectName: "West Gate", submittedByUserId: "U1", submittedByName: "Dinesh", date: "2026-10-27", vendorCode: "VC1", vendorName: "Vendor One",
  shift: "Night", labourCount: 12, isPublic: false,
  workEntries: [{ category: "RCC", qty: 5, unit: "sq.ft", generalPhotos: [{ url: "https://c/x.jpg", publicId: "pid-1" }, { url: "" }, null], beforePhotos: [{ url: "https://c/b.jpg" }], afterPhotos: [] }], ...over
});

async function main() {
  await test("isEnabled: only QC_TO_VMS_DPR=1 AND a VMS connection string", () => {
    assert.strictEqual(isEnabled({}), false);
    assert.strictEqual(isEnabled({ QC_TO_VMS_DPR: "1" }), false);
    assert.strictEqual(isEnabled({ SOURCE_MONGO_URI: "mongodb://x" }), false);
    assert.strictEqual(isEnabled({ QC_TO_VMS_DPR: "true", SOURCE_MONGO_URI: "mongodb://x" }), false);
    assert.strictEqual(isEnabled({ QC_TO_VMS_DPR: "1", SOURCE_MONGO_URI: "mongodb://x" }), true);
  });

  await test("vmsIdFor: the same QC id always gives the same ObjectId; different ids differ", () => {
    assert.strictEqual(String(vmsIdFor("DPR-ABC-1")), String(vmsIdFor("DPR-ABC-1")));
    assert.notStrictEqual(String(vmsIdFor("DPR-ABC-1")), String(vmsIdFor("DPR-ABC-2")));
    assert.ok(vmsIdFor("x") instanceof ObjectId);
  });

  await test("mapping: fields land where the VMS schema expects them (project by CODE, Date, shiftType, workType, image shape, qcId marker)", () => {
    const r = mapQcDprToVms(dpr(), { qcProjects, vmsProjects });
    assert.ok(r.ok, r.reason); const d = r.doc;
    assert.strictEqual(String(d.projectId), String(P1)); assert.strictEqual(d.projectName, "Regal Garden Villa - West Gate");
    assert.ok(d.date instanceof Date && d.date.toISOString() === "2026-10-27T00:00:00.000Z");
    assert.strictEqual(d.shiftType, "Night"); assert.strictEqual(d.labourCount, 12);
    assert.strictEqual(d.vendorCode, "VC1"); assert.strictEqual(d.vendorName, "Vendor One");
    assert.strictEqual(d.driName, "Dinesh"); assert.strictEqual(d.driUserId, null); assert.strictEqual(d.submittedBy, null);
    assert.deepStrictEqual(d.workEntries, [{ workType: "RCC", images: [{ name: "pid-1", url: "https://c/x.jpg" }], beforeImages: [{ name: "", url: "https://c/b.jpg" }], afterImages: [] }]);
    assert.strictEqual(d.qcId, "DPR-ABC-1"); assert.strictEqual(d.source, "qc"); assert.strictEqual(d.isPublicSubmission, false);
    assert.strictEqual(String(d._id), String(vmsIdFor("DPR-ABC-1")));
    assert.ok(!("qty" in d.workEntries[0]) && !("unit" in d.workEntries[0]), "QC-only fields are not invented into VMS entries");
  });

  await test("mapping: project falls back to NAME when QC has no code; public flag carried; defaults are safe", () => {
    const r = mapQcDprToVms(dpr({ projectId: "P-B", projectName: "Garden Villa", isPublic: true, shift: "Day", submittedByName: "  ", workEntries: undefined }), { qcProjects, vmsProjects });
    assert.ok(r.ok); assert.strictEqual(String(r.doc.projectId), String(P2));
    assert.strictEqual(r.doc.isPublicSubmission, true); assert.strictEqual(r.doc.driName, "QC user"); assert.deepStrictEqual(r.doc.workEntries, []);
  });

  await test("mapping: a shift that is neither Day nor Night becomes Day; entry with no category becomes Other", () => {
    const r = mapQcDprToVms(dpr({ shift: "Weird", workEntries: [{}] }), { qcProjects, vmsProjects });
    assert.strictEqual(r.doc.shiftType, "Day"); assert.strictEqual(r.doc.workEntries[0].workType, "Other");
  });

  await test("mapping: refuses (with a reason) rather than guessing", () => {
    const m = (o, p = { qcProjects, vmsProjects }) => mapQcDprToVms(o, p);
    assert.strictEqual(m(dpr({ id: "DPR-VMS-abc" })).reason, "vms-origin");
    assert.strictEqual(m(dpr({ id: "" })).reason, "no-id");
    assert.strictEqual(m(null).reason, "no-id");
    assert.strictEqual(m(dpr({ projectId: "P-X", projectName: "Nowhere" })).reason, "no-matching-vms-project");
    assert.strictEqual(m(dpr(), { qcProjects, vmsProjects: [] }).reason, "no-matching-vms-project");
    assert.strictEqual(m(dpr({ vendorCode: "" })).reason, "no-vendor-code");
    assert.strictEqual(m(dpr({ date: "27/10/2026" })).reason, "bad-date");
    assert.strictEqual(m(dpr({ date: "2026-13-45" })).reason, "bad-date");
    assert.strictEqual(m(dpr({ labourCount: "x" })).reason, "bad-labour-count");
    assert.strictEqual(m(dpr({ labourCount: -1 })).reason, "bad-labour-count");
  });

  // ---- the pusher, against a tiny in-memory fake of the VMS database
  const fakeVms = () => {
    const docs = [], inserts = [];
    return {
      docs, inserts,
      collection(name) {
        if (name === "projects") return { find: () => ({ toArray: async () => vmsProjects }) };
        if (name === "dailyprogressreports") return {
          findOne: async (f) => docs.find((d) => String(d._id) === String(f._id)) || null,
          insertOne: async (d) => { if (docs.some((x) => String(x._id) === String(d._id))) { const e = new Error("dup"); e.code = 11000; throw e; } docs.push(d); inserts.push(d); },
          find: (f) => ({ toArray: async () => docs.filter((d) => (f._id.$in || []).some((i) => String(i) === String(d._id))) })
        };
        throw new Error("unexpected VMS collection " + name);
      }
    };
  };

  await test("pusher: pushes once; a second push (retry / race) answers 'exists' and writes nothing", async () => {
    const v = fakeVms(); const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => v });
    assert.strictEqual(await p.push(dpr()), "pushed"); assert.strictEqual(await p.push(dpr()), "exists");
    assert.strictEqual(v.inserts.length, 1);
  });

  await test("pusher: a duplicate-key error from a concurrent insert is 'exists', not an error", async () => {
    const v = fakeVms(); const col = v.collection("dailyprogressreports"); const real = col.findOne;
    const db = { collection: (n) => (n === "dailyprogressreports" ? { findOne: async () => null, insertOne: async () => { const e = new Error("dup"); e.code = 11000; throw e; } } : v.collection(n)) };
    const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => db });
    assert.strictEqual(await p.push(dpr()), "exists");
  });

  await test("pusher: dry run writes nothing but reports what it would do", async () => {
    const v = fakeVms(); const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => v });
    assert.strictEqual(await p.push(dpr(), { dryRun: true }), "pushed"); assert.strictEqual(v.inserts.length, 0);
  });

  await test("pusher: NEVER throws — unreachable VMS, failing writes, failing QC lookup and a missing connection are all just strings", async () => {
    const boom = () => { throw new Error("connection reset by peer"); };
    assert.ok((await createPusher({ getQcProjects: async () => qcProjects, getVmsDb: boom }).push(dpr())).startsWith("error:"));
    assert.ok((await createPusher({ getQcProjects: async () => { throw new Error("qc down"); }, getVmsDb: async () => fakeVms() }).push(dpr())).startsWith("error:"));
    const failing = { collection: (n) => (n === "projects" ? { find: () => ({ toArray: async () => vmsProjects }) } : { findOne: async () => null, insertOne: async () => { throw new Error("not authorized on vbp to execute command insert"); } }) };
    assert.ok((await createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => failing }).push(dpr())).startsWith("error:"));
    assert.strictEqual(await createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => null }).push(dpr()), "disabled");
    assert.strictEqual(await createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => fakeVms() }).push(dpr({ id: "DPR-VMS-x" })), "skipped:vms-origin");
  });

  await test("pusher: the VMS project list is cached (one read for many pushes)", async () => {
    let reads = 0; const v = fakeVms(); const orig = v.collection.bind(v);
    v.collection = (n) => { if (n === "projects") { reads++; } return orig(n); };
    let t = 0; const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => v, now: () => t });
    await p.push(dpr({ id: "DPR-1" })); await p.push(dpr({ id: "DPR-2" })); await p.push(dpr({ id: "DPR-3" }));
    assert.strictEqual(reads, 1); t += 11 * 60 * 1000; await p.push(dpr({ id: "DPR-4" })); assert.strictEqual(reads, 2);
  });

  // ---- reconcile against a fake QC db
  const fakeQc = (rows) => ({ collection: () => ({ find: (f) => ({ sort: () => ({ limit: (n) => ({ toArray: async () => rows.filter((r) => r.date >= f.date.$gte && !String(r.id).startsWith("DPR-VMS-")).slice(0, n) }) }) }) }) });

  await test("reconcile: without a SINCE date nothing old is ever copied", async () => {
    const v = fakeVms(); const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => v });
    const r = await p.reconcile(fakeQc([dpr()]), {}); assert.strictEqual(v.inserts.length, 0); assert.match(r.note, /not set/);
    const r2 = await p.reconcile(fakeQc([dpr()]), { since: "yesterday" }); assert.strictEqual(v.inserts.length, 0);
  });

  await test("reconcile: copies only what is missing, dated on/after SINCE, never VMS-origin; counts only; dry run writes nothing", async () => {
    const v = fakeVms(); const p = createPusher({ getQcProjects: async () => qcProjects, getVmsDb: async () => v });
    const rows = [dpr({ id: "OLD-1", date: "2026-09-01" }), dpr({ id: "A-1", date: "2026-10-27" }), dpr({ id: "A-2", date: "2026-10-28" }), dpr({ id: "DPR-VMS-q", date: "2026-10-28" }), dpr({ id: "A-3", date: "2026-10-28", projectId: "P-X", projectName: "Nowhere" })];
    const dry = await p.reconcile(fakeQc(rows), { since: "2026-10-01", dryRun: true });
    assert.deepStrictEqual([dry.checked, dry.pushed, dry.skipped, v.inserts.length], [3, 2, 1, 0]);
    const real = await p.reconcile(fakeQc(rows), { since: "2026-10-01" });
    assert.deepStrictEqual([real.pushed, real.exists, real.skipped, real.errors, v.inserts.length], [2, 0, 1, 0, 2]);
    const again = await p.reconcile(fakeQc(rows), { since: "2026-10-01" });
    assert.deepStrictEqual([again.pushed, again.exists, v.inserts.length], [0, 2, 2], "a second pass copies nothing new");
    assert.ok(!JSON.stringify(real).includes("Dinesh"), "the summary carries counts, never record content");
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
