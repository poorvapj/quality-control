/* Tests for saveDiagnostics.js (log-only comparison of the proposed "clean save" rule vs what the server does).
   Run with: node saveDiagnostics.test.js */
const assert = require("assert");
const { createSaveDiagnostics, isEnabled, predictClean } = require("./saveDiagnostics.js");

let passed = 0, started = 0;
process.on("exit", (code) => { if (code === 0 && passed !== started) { console.error(`FAIL - ${started - passed} test(s) failed or never finished`); process.exitCode = 1; } });
function test(name, fn) {
  started++;
  return Promise.resolve().then(fn).then(() => { passed++; console.log("  ok -", name); }).catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
const COLLS = ["users", "snags", "qualityInspections", "materialMeasurements", "workMeasurements", "drawingRequests", "dpr", "formSubmissions", "teamDailyReports", "projects", "assignments"];
const mk = (opts = {}) => { const lines = []; const log = { log: (m) => lines.push(["log", m]), warn: (m) => lines.push(["warn", m]), error: (m) => lines.push(["error", m]) }; return { d: createSaveDiagnostics({ collections: COLLS, log, ...opts }), lines }; };
/* Simulates the server: begin() -> server mutates the ops in place / records trace -> finish(). */
function run(d, ops, serverDoes, opts) {
  const probe = d.begin(ops, opts || {});
  if (serverDoes) serverDoes(ops, probe && probe.trace);
  probe.finish();
  return d._stats();
}
const outcomes = (stats) => stats.counts;

async function main() {
  await test("isEnabled is OFF unless SAVE_DIAGNOSTICS=1 exactly", () => {
    for (const env of [{}, { SAVE_DIAGNOSTICS: "" }, { SAVE_DIAGNOSTICS: "0" }, { SAVE_DIAGNOSTICS: "true" }, { SAVE_DIAGNOSTICS: "yes" }]) assert.strictEqual(isEnabled(env), false, JSON.stringify(env));
    assert.strictEqual(isEnabled({ SAVE_DIAGNOSTICS: "1" }), true);
  });

  await test("plain save (snag upsert, event, progress): predicted clean, observed clean -> agree-clean", () => {
    const { d } = mk();
    const s = run(d, [{ op: "upsert", coll: "snags", rec: { id: "S1", title: "x" } }, { op: "event", ev: { ts: 1 } }, { op: "progress", key: "U::S", patch: { done: true } }]);
    assert.ok(outcomes(s)["agree-clean|snags"] === 1 && !Object.keys(outcomes(s)).some((k) => k.startsWith("MISMATCH")));
  });

  await test("APPROVAL derived by the server (approval field added) -> agree-not-clean, field name logged", () => {
    const { d, lines } = mk();
    const ops = [{ op: "upsert", coll: "qualityInspections", rec: { id: "Q1", result: "Pass" } }];
    run(d, ops, (o) => { o[0].rec.approval = { status: "pending", approverUserId: "U-LEAD" }; });
    assert.ok(d._stats().counts["agree-not-clean|qualityInspections"] === 1);
    assert.ok(lines.some(([, m]) => /server-modified:qualityInspections/.test(m) && /"approval"/.test(m)));
  });

  await test("APPROVAL removed by the server (a client-sent approval stripped) is also observed", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "materialMeasurements", rec: { id: "M1", approval: { status: "approved" } } }], (o) => { delete o[0].rec.approval; });
    assert.ok(d._stats().counts["agree-not-clean|materialMeasurements"] === 1);
  });

  await test("INSPECTION RESULT recomputed from the checklist (Pass -> Fail) -> observed", () => {
    const { d, lines } = mk();
    run(d, [{ op: "upsert", coll: "qualityInspections", rec: { id: "Q1", result: "Pass", checklistItems: [{ status: "Not OK" }] } }], (o) => { o[0].rec.result = "Fail"; });
    assert.ok(lines.some(([, m]) => /"result"/.test(m)));
    assert.strictEqual(d._stats().reasons["server-modified:qualityInspections"], 1);
  });

  await test("WORK-MEASUREMENT link re-derived by the server (link fields added) -> observed", () => {
    const { d, lines } = mk();
    run(d, [{ op: "upsert", coll: "workMeasurements", rec: { id: "W1", projectCode: "P" } }], (o) => { Object.assign(o[0].rec, { linkStatus: "unmatched", linkedItemId: null, linkNote: "VMS data unavailable" }); });
    assert.ok(d._stats().counts["agree-not-clean|workMeasurements"] === 1);
    assert.ok(lines.some(([, m]) => /linkStatus/.test(m) && /linkNote/.test(m)));
  });

  await test("PUBLIC FORM defaults (anonymous drawing request / DPR / form submission) -> observed, predicted not clean", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "drawingRequests", rec: { id: "DR-1", description: "d" } }], (o) => { Object.assign(o[0].rec, { reviewStatus: "stage-1-screen", reviewHistory: [{ stage: "x" }], files: [], priority: "", isPublic: true }); }, { anonymous: true });
    run(d, [{ op: "upsert", coll: "dpr", rec: { id: "DPR-1" } }], (o) => { o[0].rec.submittedByUserId = null; o[0].rec.isPublic = true; }, { anonymous: true });
    run(d, [{ op: "upsert", coll: "formSubmissions", rec: { id: "SUB-1", formId: "F" } }], (o) => { o[0].rec.submittedAt = 5; o[0].rec.isPublic = true; }, { anonymous: true });
    const c = d._stats().counts;
    assert.ok(c["agree-not-clean|drawingRequests"] === 1 && c["agree-not-clean|dpr"] === 1 && c["agree-not-clean|formSubmissions"] === 1, JSON.stringify(c));
  });

  await test("a SIGNED-IN drawing-request/DPR save is predicted clean, and agrees when the server changes nothing", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "drawingRequests", rec: { id: "DR-1" } }], null, { anonymous: false });
    assert.strictEqual(d._stats().counts["agree-clean|drawingRequests"], 1);
  });

  await test("USER save with a password -> reason users-password (the password itself never appears)", () => {
    const { d, lines } = mk();
    run(d, [{ op: "upsert", coll: "users", rec: { id: "USR-0009", name: "Pat Person", email: "pat@secret.test", password: "Sup3r-Secret-PW" } }]);
    assert.strictEqual(d._stats().reasons["users-password"], 1);
    const all = lines.map(([, m]) => m).join("\n");
    for (const s of ["Sup3r-Secret-PW", "pat@secret.test", "Pat Person", "USR-0009"]) assert.ok(!all.includes(s), "leaked " + s);
  });

  await test("PROJECT DELETE cascade -> observed from the server's own deletion counts", () => {
    const { d, lines } = mk();
    run(d, [{ op: "delete", coll: "projects", id: "P-1" }], (o, trace) => { trace.cascade = { floors: 4, units: 40, snags: 3, progress: 120 }; });
    assert.strictEqual(d._stats().reasons["project-delete-cascade"], 1);
    assert.ok(d._stats().counts["agree-not-clean|projects"] === 1);
    assert.ok(lines.some(([, m]) => /"units":40/.test(m)));
  });

  await test("PASSING RE-INSPECTION that closes the original's snag -> observed from the server's update count", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "qualityInspections", rec: { id: "Q2", result: "Pass", reInspectionOf: "Q1" } }], (o, trace) => { trace.snagClosed = 1; });
    assert.strictEqual(d._stats().reasons["re-inspection-closed-record"], 1);
  });

  await test("a re-inspection that closed nothing (no linked snag) adds no such reason", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "qualityInspections", rec: { id: "Q2", result: "Pass", reInspectionOf: "Q1" } }], (o, trace) => { trace.snagClosed = 0; });
    assert.strictEqual(d._stats().reasons["re-inspection-closed-record"], undefined);
  });

  await test("MISMATCH-unsafe: a collection predicted CLEAN that the server changed anyway is flagged loudly (warn level)", () => {
    const { d, lines } = mk();
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "S1", status: "Open" } }], (o) => { o[0].rec.status = "Closed"; o[0].rec.approval = { status: "x" }; });
    assert.strictEqual(d._stats().counts["MISMATCH-unsafe|snags"], 1);
    assert.ok(lines.some(([lvl, m]) => lvl === "warn" && /MISMATCH-unsafe/.test(m)), "logged at warn");
  });

  await test("MISMATCH-unsafe also catches a side effect the static rule did not foresee (an unexpected snag closure on a snag save)", () => {
    const { d } = mk();
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "S1" } }], (o, trace) => { trace.snagClosed = 1; });
    assert.strictEqual(d._stats().counts["MISMATCH-unsafe|snags"], 1);
  });

  await test("mismatch-conservative: predicted not clean but nothing changed (e.g. an admin saving an inspection) is only informational", () => {
    const { d, lines } = mk();
    run(d, [{ op: "upsert", coll: "qualityInspections", rec: { id: "Q1", result: "Pass" } }]);
    assert.strictEqual(d._stats().counts["mismatch-conservative|qualityInspections"], 1);
    assert.ok(lines.every(([lvl]) => lvl !== "warn"));
  });

  await test("PRIVACY: ids, emails, record values, tokens and hostile field names never reach the log", () => {
    const { d, lines } = mk();
    const SECRETS = ["TOKEN-abc.def.ghi", "victim@example.test", "9876543210", "Title With Personal Data", "REC-SECRET-ID-77", "Rahul Gupta", "my_secret_field_name_Rahul"];
    const ops = [
      { op: "upsert", coll: "qualityInspections", rec: { id: "REC-SECRET-ID-77", title: "Title With Personal Data", email: "victim@example.test", phone: "9876543210", authToken: "TOKEN-abc.def.ghi", [SECRETS[6]]: "x", inspectorName: "Rahul Gupta" } },
      { op: "upsert", coll: "not_a_real_collection_Rahul", rec: { id: "x" } },
      { op: "event", ev: { ts: 1, detail: "Rahul Gupta did X", targetId: "REC-SECRET-ID-77" } }
    ];
    run(d, ops, (o) => { o[0].rec.approval = { status: "pending", approverName: "Rahul Gupta" }; o[0][SECRETS[6]] = 1; delete o[0].rec[SECRETS[6]]; o[0].rec.title = "changed"; });
    d.summary();
    const all = lines.map(([, m]) => m).join("\n");
    for (const s of SECRETS) assert.ok(!all.includes(s), "leaked: " + s);
    assert.ok(/"<other>"/.test(all) || /approval/.test(all), "unknown field names are bucketed, known server-written ones named");
    assert.ok(/<unknown>/.test(all), "an unknown collection name is not echoed");
  });

  await test("BOUNDED: examples per outcome+reason are capped, a summary is printed every N batches, long batches are truncated", () => {
    const { d, lines } = mk({ examplesPerKey: 2, summaryEvery: 50 });
    for (let i = 0; i < 120; i++) run(d, [{ op: "upsert", coll: "snags", rec: { id: "S" + i } }]);
    const exampleLines = lines.filter(([, m]) => !/"summary"/.test(m));
    assert.strictEqual(exampleLines.length, 2, "only 2 example lines for 120 identical batches, got " + exampleLines.length);
    assert.deepStrictEqual([...new Set(lines.filter(([, m]) => /"summary"/.test(m)).map(([, m]) => JSON.parse(m.slice(12)).seq))], [1, 2], "summary at 50 and 100");
    const big = Array.from({ length: 500 }, (_, i) => ({ op: "upsert", coll: "snags", rec: { id: "S" + i } }));
    const before = lines.length; run(d, big, (o) => { o[0].rec.status = "x"; });
    assert.ok(lines.slice(before).every(([, m]) => m.length <= 700), "line cap");
    assert.ok(lines.slice(before).every(([, m]) => { JSON.parse(m.slice(12)); return true; }), "every line is complete JSON");
  });

  await test("BOUNDED: MISMATCH-unsafe lines are rate-limited per window and the rest only counted", () => {
    let t = 0; const { d, lines } = mk({ unsafePerWindow: 5, windowMs: 60000, now: () => t });
    for (let i = 0; i < 40; i++) run(d, [{ op: "upsert", coll: "snags", rec: { id: "S" + i } }], (o) => { o[0].rec.status = "x" + i; });
    assert.strictEqual(lines.filter(([l]) => l === "warn").length, 5);
    assert.strictEqual(d._stats().suppressedUnsafe, 35);
    assert.strictEqual(d._stats().counts["MISMATCH-unsafe|snags"], 40, "still counted");
    t += 61000; run(d, [{ op: "upsert", coll: "snags", rec: { id: "again" } }], (o) => { o[0].rec.status = "y"; });
    assert.strictEqual(lines.filter(([l]) => l === "warn").length, 6, "a new window logs again");
  });

  await test("ISOLATION: begin/finish/abort never throw, whatever the input (circular, throwing getters, non-arrays, null ops)", () => {
    const { d } = mk();
    const circ = { id: "c" }; circ.self = circ;
    const evil = { id: "e" }; Object.defineProperty(evil, "boom", { enumerable: true, get() { throw new Error("getter"); } });
    for (const input of [null, undefined, "str", 5, {}, [null, undefined, 5, "x"], [{ op: "upsert", coll: "snags", rec: circ }], [{ op: "upsert", coll: "snags", rec: evil }], [{ op: "upsert", coll: "snags", rec: { n: 10n } }], [{ op: "upsert", coll: "users", rec: null }]]) {
      const probe = d.begin(input, { anonymous: true });
      if (probe) { probe.trace.cascade = { x: "not a number" }; probe.finish(); probe.finish(); probe.abort(); }
    }
    d.summary();
  });

  await test("ISOLATION: a logger that throws cannot break finish()", () => {
    const d = createSaveDiagnostics({ collections: COLLS, log: { log() { throw new Error("log down"); }, warn() { throw new Error("log down"); } } });
    const probe = d.begin([{ op: "upsert", coll: "snags", rec: { id: "S" } }]);
    probe.finish();   // must not throw
  });

  await test("DIAGNOSTICS DO NOT MUTATE THE OPS: begin() leaves the batch byte-identical", () => {
    const { d } = mk();
    const ops = [{ op: "upsert", coll: "users", rec: { id: "U", password: "pw", n: null, nested: { a: [1, 2] } } }, { op: "delete", coll: "projects", id: "P" }];
    const snapshot = JSON.stringify(ops);
    const probe = d.begin(ops, { anonymous: false }); probe.finish();
    assert.strictEqual(JSON.stringify(ops), snapshot);
  });

  await test("predictClean: the static rule, by collection and by session", () => {
    assert.strictEqual(predictClean([{ op: "upsert", coll: "snags" }, { op: "progress" }, { op: "event" }], { anonymous: false }).clean, true);
    for (const coll of ["users", "qualityInspections", "materialMeasurements", "workMeasurements", "teamDailyReports", "formSubmissions"]) assert.strictEqual(predictClean([{ op: "upsert", coll }], { anonymous: false }).clean, false, coll);
    assert.strictEqual(predictClean([{ op: "upsert", coll: "dpr" }], { anonymous: false }).clean, true);
    assert.strictEqual(predictClean([{ op: "upsert", coll: "dpr" }], { anonymous: true }).clean, false);
    assert.strictEqual(predictClean([{ op: "delete", coll: "projects", id: "p" }], { anonymous: false }).clean, false);
    assert.strictEqual(predictClean([{ op: "delete", coll: "snags", id: "s" }], { anonymous: false }).clean, true);
  });

  const parse = (m) => JSON.parse(m.replace(/^\[save-diag\] /, ""));
  const { KNOWN_SERVER_FIELDS } = require("./saveDiagnostics.js");
  const ALLCOLLS = ["projects", "floors", "units", "stages", "qparams", "checklists", "stagemap", "users", "snags", "assignments", "dpr", "drawingRequests", "permissions", "workTargets", "moduleGrants", "teams", "vendors", "roles", "forms", "formSubmissions", "qualityInspections", "materialMeasurements", "purchaseOrders", "workMeasurements", "teamDailyReports", "customSlabNames", "customAreaNames", "columnMaster", "slabMaster", "caseStudies"];

  await test("B2: worst-case summary (every collection x outcome, many reasons) is split into parts that are ALL valid JSON <= 700 chars", () => {
    const lines = []; const d = createSaveDiagnostics({ collections: ALLCOLLS, log: { log: (m) => lines.push(m), warn: (m) => lines.push(m) }, summaryEvery: 1e9, examplesPerKey: 0 });
    for (const c of ALLCOLLS) for (const change of [false, true]) for (const anon of [false, true]) {
      const ops = [{ op: "upsert", coll: c, rec: { id: "1", password: c === "users" ? "pw" : undefined } }];
      const p = d.begin(ops, { anonymous: anon }); if (change) ops[0].rec.status = "x"; p.finish();
    }
    d.summary();
    const parts = lines.map(parse).filter((p) => p.summary); assert.ok(parts.length > 1, "multi-part, got " + parts.length);
    for (const l of lines) { assert.ok(l.length <= 700, "len " + l.length); parse(l); }
    assert.strictEqual(new Set(parts.map((p) => p.seq)).size, 1);
    assert.deepStrictEqual(parts.map((p) => p.part), parts.map((_, i) => i + 1));
    assert.ok(parts.every((p) => p.parts === parts.length && p.summary === true && p.boot === d.bootId));
    const st = d._stats();
    assert.deepStrictEqual(Object.assign({}, ...parts.map((p) => p.perCollection || {})), st.counts, "no per-collection entry lost across parts");
    assert.deepStrictEqual(Object.assign({}, ...parts.map((p) => p.reasons || {})), st.reasons);
  });

  await test("B2: an oversized EXAMPLE line is shrunk (still valid JSON, flagged truncated), not cut", () => {
    const { d, lines } = mk();
    const ops = Array.from({ length: 60 }, (_, i) => ({ op: "upsert", coll: "qualityInspections", rec: { id: "Q" + i } }));
    run(d, ops, (o) => { for (const x of o) for (const f of KNOWN_SERVER_FIELDS) x.rec[f] = 2; });
    const l = lines.filter(([, m]) => !/"summary"/.test(m)); assert.ok(l.length >= 1);
    for (const [, m] of l) { assert.ok(m.length <= 700, "len " + m.length); parse(m); }
    assert.strictEqual(parse(l[0][1]).truncated, true);
  });

  await test("B3: batchOutcomes counts each batch ONCE (sums to batches) even when a batch touches several collections", () => {
    const lines = []; const d = createSaveDiagnostics({ collections: COLLS, log: { log: (m) => lines.push(m), warn: (m) => lines.push(m) }, summaryEvery: 1e9, examplesPerKey: 0 });
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "a" } }, { op: "upsert", coll: "assignments", rec: { id: "b" } }, { op: "upsert", coll: "projects", rec: { id: "c" } }]);   // clean, 3 collections
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "a" } }, { op: "upsert", coll: "qualityInspections", rec: { id: "q" } }], (o) => { o[1].rec.result = "Fail"; }); // not clean
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "a" } }], (o) => { o[0].rec.status = "x"; });                                                                  // UNSAFE
    run(d, [{ op: "upsert", coll: "qualityInspections", rec: { id: "q" } }]);                                                                                          // conservative
    run(d, [{ op: "event", ev: {} }]);                                                                                                                                 // no collection
    const st = d._stats();
    assert.strictEqual(st.batches, 5);
    assert.deepStrictEqual(st.batchOutcomes, { "agree-clean": 2, "agree-not-clean": 1, "MISMATCH-unsafe": 1, "mismatch-conservative": 1 });
    assert.strictEqual(Object.values(st.batchOutcomes).reduce((a, b) => a + b, 0), st.batches);
    assert.ok(Object.values(st.counts).reduce((a, b) => a + b, 0) > st.batches, "perCollection is deliberately NOT a batch total");
    d.summary(); const head = lines.map(parse).filter((p) => p.summary && p.part === 1)[0];
    assert.strictEqual(head.batches, 5); assert.deepStrictEqual(head.batchOutcomes, st.batchOutcomes);
  });

  await test("shutdown summary: final=true, only when something is new, never a duplicate of the last summary", () => {
    const lines = []; const d = createSaveDiagnostics({ collections: COLLS, log: { log: (m) => lines.push(parse(m)), warn: (m) => lines.push(parse(m)) }, summaryEvery: 2, examplesPerKey: 0 });
    d.summary({ final: true }); assert.strictEqual(lines.length, 0, "nothing to report -> nothing logged");
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "1" } }]); run(d, [{ op: "upsert", coll: "snags", rec: { id: "2" } }]);   // periodic summary at 2
    const n = lines.length; assert.ok(n >= 1);
    d.summary({ final: true }); assert.strictEqual(lines.length, n, "nothing new since the periodic summary -> no duplicate");
    run(d, [{ op: "upsert", coll: "snags", rec: { id: "3" } }]);
    d.summary({ final: true });
    const fin = lines.filter((p) => p.final && p.part === 1); assert.strictEqual(fin.length, 1);
    assert.ok(fin[0].batches === 3 && fin[0].seq === 2, "final carries cumulative totals");
    d.summary({ final: true }); assert.strictEqual(lines.filter((p) => p.final && p.part === 1).length, 1, "a second shutdown call adds nothing");
  });

  await test("shutdown/periodic summary never throws, even with a throwing logger", () => {
    const d = createSaveDiagnostics({ collections: COLLS, log: { log() { throw new Error("boom"); }, warn() { throw new Error("boom"); } }, summaryEvery: 1e9 });
    d.begin([{ op: "upsert", coll: "snags", rec: {} }]).finish(); d.summary({ final: true }); d.summary();
  });

  await test("PRIVACY: summary lines contain only vocabulary tokens and the boot id (no ids, names, values)", () => {
    const lines = []; const d = createSaveDiagnostics({ collections: COLLS, log: { log: (m) => lines.push(m), warn: (m) => lines.push(m) }, summaryEvery: 1 });
    run(d, [{ op: "upsert", coll: "users", rec: { id: "USR-SECRET-1", password: "hunter2-SECRET", name: "Alice SECRET" } }, { op: "upsert", coll: "alice@SECRET.example", rec: { id: "x" } }]);
    d.summary({ final: true });
    assert.ok(lines.length > 0 && lines.every((l) => !/SECRET|hunter2|alice/i.test(l)));
    for (const l of lines) for (const m of l.slice(12).matchAll(/"([^"]*)"/g)) assert.ok(/^[A-Za-z|<>:_\-]+$/.test(m[1]) || m[1] === d.bootId, "unexpected token " + m[1]);
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
