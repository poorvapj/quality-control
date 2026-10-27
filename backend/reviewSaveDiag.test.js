/* Tests for reviewSaveDiag.js (the log reviewer) fed with logs produced by the REAL saveDiagnostics.js on invented data.
   No database, no network, no production data. Run with: node reviewSaveDiag.test.js */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { createSaveDiagnostics, MAX_LINE } = require("./saveDiagnostics.js");

let passed = 0, started = 0;
process.on("exit", (code) => { if (code === 0 && passed !== started) { console.error(`FAIL - ${started - passed} test(s) failed or never finished`); process.exitCode = 1; } });
function test(name, fn) {
  started++;
  return Promise.resolve().then(fn).then(() => { passed++; console.log("  ok -", name); }).catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

const COLLS = ["snags", "users", "qualityInspections", "workMeasurements", "materialMeasurements", "drawingRequests", "dpr", "formSubmissions", "teamDailyReports", "projects"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reviewdiag-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

/* One process "boot": runs the batches through the real diagnostics and returns its log lines. */
function boot(batches, opts = {}) {
  const lines = ["  save diagnostics: ON (log-only, bounded; see docs/save-diagnostics.md)"];
  const out = (m) => lines.push(m);
  const d = createSaveDiagnostics({ collections: COLLS, log: { log: out, warn: out }, summaryEvery: 1, examplesPerKey: 1, ...opts });
  for (const b of batches) { const p = d.begin(b.ops, { anonymous: !!b.anonymous }); if (b.server) b.server(b.ops, p.trace); p.finish(); }
  return lines;
}
const clean = (n) => Array.from({ length: n }, (_, i) => ({ ops: [{ op: "upsert", coll: "snags", rec: { id: "s" + i } }] }));
// one batch for each of the ten rules, as the server would transform it
const ruleBatches = () => [
  { ops: [{ op: "upsert", coll: "qualityInspections", rec: { id: "q" } }], server: (o) => { o[0].rec.approval = 1; } },
  { ops: [{ op: "upsert", coll: "workMeasurements", rec: { id: "w" } }], server: (o) => { o[0].rec.linkStatus = "x"; } },
  { ops: [{ op: "upsert", coll: "materialMeasurements", rec: { id: "m" } }], server: (o) => { o[0].rec.approval = 1; } },
  { ops: [{ op: "upsert", coll: "users", rec: { id: "u", password: "pw" } }] },
  { ops: [{ op: "delete", coll: "projects", id: "p" }], server: (o, t) => { t.cascade = { floors: 1 }; } },
  { ops: [{ op: "upsert", coll: "qualityInspections", rec: { id: "r" } }], server: (o, t) => { o[0].rec.approval = 1; t.snagClosed = 1; } },
  { anonymous: true, ops: [{ op: "upsert", coll: "drawingRequests", rec: { id: "d" } }], server: (o) => { o[0].rec.reviewStatus = "x"; } },
  { anonymous: true, ops: [{ op: "upsert", coll: "dpr", rec: { id: "p" } }], server: (o) => { o[0].rec.isPublic = true; } },
  { anonymous: true, ops: [{ op: "upsert", coll: "formSubmissions", rec: { id: "f" } }], server: (o) => { o[0].rec.submittedAt = 1; } },
  { ops: [{ op: "upsert", coll: "teamDailyReports", rec: { id: "t" } }], server: (o) => { o[0].rec.status = "Approved"; } }
];
const RULES = ["server-modified:qualityInspections", "server-modified:workMeasurements", "server-modified:materialMeasurements", "users-password", "project-delete-cascade", "re-inspection-closed-record", "server-modified:drawingRequests", "server-modified:dpr", "server-modified:formSubmissions", "server-modified:teamDailyReports"];

let n = 0;
function review(lines, extra = []) {
  const f = path.join(tmp, "log" + n++ + ".txt");
  fs.writeFileSync(f, lines.map((l) => "2026-10-27T10:00:00Z " + l).join("\n"));
  const r = spawnSync(process.execPath, [path.join(__dirname, "reviewSaveDiag.js"), f, "--json", ...extra], { encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout), raw: r.stdout };
}
const synthFile = (rules) => { const f = path.join(tmp, "syn" + n++ + ".json"); fs.writeFileSync(f, JSON.stringify(rules)); return f; };

async function main() {
  await test("every log line from the real diagnostics is valid JSON and within the 700-character limit (worst case included)", () => {
    const wide = { ops: Array.from({ length: 80 }, (_, i) => ({ op: "upsert", coll: "qualityInspections", rec: { id: "q" + i } })), server: (o) => { for (const x of o) for (const f of ["approval", "result", "linkStatus", "reviewHistory", "files", "assignedTo", "priority", "status", "members"]) x.rec[f] = 2; } };
    const lines = boot([...clean(3), ...ruleBatches(), wide]);
    const r = review(lines);
    for (const l of lines.filter((x) => x.startsWith("[save-diag]"))) { assert.ok(l.length <= MAX_LINE, "len " + l.length); JSON.parse(l.slice(12)); }
    assert.strictEqual(r.out.invalid, 0); assert.strictEqual(r.out.tooLong, 0);
  });

  await test("multipart summaries: the reviewer reassembles all parts and totals match the diagnostics' own counters", () => {
    const lines = boot([...clean(5), ...ruleBatches()]);
    const parts = lines.filter((l) => /"summary":true/.test(l)).map((l) => JSON.parse(l.slice(12)));
    assert.ok(parts.some((p) => p.parts > 1), "summaries are multipart");
    const r = review(lines);
    assert.strictEqual(r.out.totals.batches, 15);
    assert.strictEqual(r.out.totals.batchOutcomes["agree-clean"], 5);
    assert.strictEqual(r.out.totals.batchOutcomes["agree-not-clean"], 10);
    for (const rule of RULES) assert.ok(r.out.totals.reasons[rule] >= 1, rule);
  });

  await test("batch outcome reconciliation: outcomes add up to batches; a tampered total is a hard FAIL (gate 3)", () => {
    const lines = boot(clean(4));
    const ok = review(lines); assert.strictEqual(ok.out.hardFailures.filter((h) => /GATE 3/.test(h)).length, 0);
    const bad = lines.map((l) => (/"part":1/.test(l) && /"batches":4/.test(l) ? l.replace('"agree-clean":4', '"agree-clean":3') : l));
    const r = review(bad); assert.strictEqual(r.code, 2); assert.ok(r.out.hardFailures.some((h) => /GATE 3/.test(h)));
  });

  await test("unsafe mismatch detection: a batch the rule called clean but the server changed -> FAIL, exit 2 (gate 1)", () => {
    const lines = boot([...clean(3), { ops: [{ op: "upsert", coll: "snags", rec: { id: "x" } }], server: (o) => { o[0].rec.status = "changed-by-server"; } }]);
    const r = review(lines); assert.strictEqual(r.code, 2); assert.strictEqual(r.out.verdict, "FAIL");
    assert.ok(r.out.hardFailures.some((h) => /GATE 1/.test(h)) && r.out.unsafeLines.length >= 1);
    assert.strictEqual(r.out.totals.batchOutcomes["MISMATCH-unsafe"], 1);
  });

  await test("a truncated/invalid line or an incomplete only-summary is a hard FAIL (gate 2)", () => {
    const lines = boot(clean(3));
    const cut = lines.slice(); cut[cut.length - 1] = cut[cut.length - 1].slice(0, -15);
    const r = review(cut); assert.strictEqual(r.code, 2); assert.ok(r.out.hardFailures.some((h) => /GATE 2/.test(h)));
    const longLine = review([...lines, "[save-diag] " + JSON.stringify({ outcome: "agree-clean", pad: "x".repeat(800) })]);
    assert.strictEqual(longLine.code, 2); assert.strictEqual(longLine.out.tooLong, 1);
  });

  await test("an incomplete LATEST summary falls back to the previous complete one (nothing double counted)", () => {
    const lines = boot(clean(6));
    const lastSeq = Math.max(...lines.filter((l) => /"summary":true/.test(l)).map((l) => JSON.parse(l.slice(12)).seq));
    const dropped = lines.filter((l) => !(l.includes('"seq":' + lastSeq + ",") && /"part":[2-9]/.test(l)));
    const r = review(dropped); assert.strictEqual(r.out.totals.batches, 5, "uses seq " + (lastSeq - 1));
  });

  await test("process restarts: boots are summed; the shutdown summary adds the final batches without duplicating", () => {
    const a = boot(clean(30), { summaryEvery: 1e9 }), b = boot(clean(40), { summaryEvery: 1e9 });
    // no periodic summary at all -> only a shutdown summary exists for each boot
    const withFinal = (lines, k) => { const out = []; const d = createSaveDiagnostics({ collections: COLLS, log: { log: (m) => out.push(m), warn: (m) => out.push(m) }, summaryEvery: 1e9, examplesPerKey: 0 }); for (const x of clean(k)) d.begin(x.ops, {}).finish(); d.summary({ final: true }); d.summary({ final: true }); return ["  save diagnostics: ON", ...out]; };
    const r = review([...withFinal(a, 30), ...withFinal(b, 40)], ["--min-batches", "10"]);
    assert.strictEqual(r.out.bootsUsed, 2); assert.strictEqual(r.out.totals.batches, 70);
  });

  await test("insufficient evidence: too few batches -> verdict INSUFFICIENT EVIDENCE, exit 3 (never PASS)", () => {
    const r = review(boot([...clean(10), ...ruleBatches()]), ["--synthetic", synthFile([])]);
    assert.strictEqual(r.code, 3); assert.strictEqual(r.out.verdict, "INSUFFICIENT EVIDENCE");
    assert.ok(r.out.insufficient.some((s) => /GATE 4/.test(s)) && r.out.hardFailures.length === 0);
  });

  await test("insufficient evidence: enough batches but rules never seen -> INSUFFICIENT EVIDENCE (gate 5); synthetic file covers them", () => {
    const lines = boot(clean(150));
    const r = review(lines); assert.strictEqual(r.code, 3); assert.strictEqual(r.out.rules.missing.length, 10);
    const part = review(lines, ["--synthetic", synthFile(RULES.slice(0, 9))]); assert.strictEqual(part.code, 3); assert.deepStrictEqual(part.out.rules.missing, [RULES[9]]);
    const full = review(lines, ["--synthetic", synthFile(RULES)]); assert.strictEqual(full.code, 0); assert.strictEqual(full.out.verdict, "PASS");
    assert.strictEqual(full.out.rules.synthetic.length, 10);
  });

  await test("PASS only when all gates hold with real traffic: >=100 batches, all ten rules seen, zero unsafe, valid summaries", () => {
    const r = review(boot([...clean(100), ...ruleBatches()]));
    assert.strictEqual(r.code, 0); assert.strictEqual(r.out.verdict, "PASS"); assert.strictEqual(r.out.rules.missing.length, 0); assert.strictEqual(r.out.rules.synthetic.length, 0);
    assert.strictEqual(r.out.cleanSharePct, Math.round(100 / 110 * 1000) / 10);
  });

  await test("no diagnostics lines at all -> INSUFFICIENT EVIDENCE, not PASS", () => {
    const r = review(["nothing relevant here"]); assert.strictEqual(r.code, 3); assert.strictEqual(r.out.totals.batches, 0);
  });

  await test("privacy: the reviewer's output contains no planted private value", () => {
    const lines = boot([{ ops: [{ op: "upsert", coll: "users", rec: { id: "USR-SECRET", password: "hunter2-SECRET", email: "a@SECRET.example" } }] }, ...clean(2)]);
    const r = review(lines); assert.ok(!/SECRET|hunter2/.test(r.raw));
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
