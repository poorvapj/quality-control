/* SYNTHETIC end-to-end check of the save diagnostics (docs/save-diagnostics-synthetic-test.md).
   Starts the REAL backend/server.js against a throw-away IN-MEMORY MongoDB filled with invented data, runs 15 scripted
   saves, and checks that every one of the ten server-side transformation rules is observed by the diagnostics, that
   turning diagnostics ON never changes a reply or the database (vs an identical run with them OFF), and that the log is
   valid, bounded and free of private data.

   ISOLATION: it never reads a .env file, never inherits MONGODB_URI / credentials / any production setting (the child
   server gets an explicit, minimal environment) and only talks to 127.0.0.1. Not part of "node *.test.js" and not a
   dependency of the app: it needs the dev-only package "mongodb-memory-server" (which downloads a mongod binary on its
   first use) installed OUTSIDE the project or in a scratch folder, e.g.  NODE_PATH=<dir>/node_modules node backend/diagnosticsSynthetic.e2e.js
   Usage: node backend/diagnosticsSynthetic.e2e.js [--write-coverage <file.json>]
   (the coverage file feeds the log reviewer's --synthetic option). Exit 0 = all checks passed. */
let MongoMemoryServer;
try { ({ MongoMemoryServer } = require("mongodb-memory-server")); } catch { console.error("mongodb-memory-server is not installed (dev-only, see the header of this file / docs/save-diagnostics-synthetic-test.md)."); process.exit(2); }
const { MongoClient } = require("mongodb");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");
const fs = require("fs");
const http = require("http");
const SECRET = "s".repeat(32);
const tok = (userId, isAdmin) => jwt.sign({ userId, isAdmin: !!isAdmin }, SECRET);
const ADMIN = tok("U-ADMIN", true), LEAD = tok("U-LEAD"), MEM = tok("U-MEM");
let fails = 0; const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) fails++; };
const SERVER = path.join(__dirname, "server.js");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const SENTINELS = ["MM-PRIVATE-NOTE", "Sup3r-Secret-PW-4242", "pat.person@private.test", "Pat Person Private", "REC-PRIVATE-TITLE", "PRIVATE-PHONE-98765", "SNG-PLAIN-1", "QI-MEM-1", "USR-NEW-9", "P-CASCADE", "Q-ORIG", "SN-ORIG", "DR-ANON-1", "DPR-ANON-1", "SUB-ANON-1"];

function call(port, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, agent: false, headers: { "Accept-Encoding": "identity", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString() }));
    }); r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const ops = (port, token, list) => call(port, "POST", "/api/ops", token, { ops: list });

async function seed(db) {
  await db.collection("users").insertMany([
    { id: "U-ADMIN", name: "Admin", role: "ADMIN", active: true },
    { id: "U-LEAD", name: "Leader", role: "CIVIL", teamId: "T1", active: true },
    { id: "U-MEM", name: "Member", role: "CIVIL", teamId: "T1", active: true }]);
  await db.collection("teams").insertOne({ id: "T1", name: "Team", leaderId: "U-LEAD", active: true });
  await db.collection("projects").insertMany([{ id: "P1", code: "P1", name: "One", active: true }, { id: "P-CASCADE", code: "PC", name: "Doomed", active: true }]);
  await db.collection("floors").insertMany([{ id: "F-C1", projectId: "P-CASCADE" }, { id: "F-C2", projectId: "P-CASCADE" }, { id: "F-K", projectId: "P1" }]);
  await db.collection("units").insertMany([{ id: "UN-C1", projectId: "P-CASCADE", floorId: "F-C1" }, { id: "UN-K", projectId: "P1", floorId: "F-K" }]);
  await db.collection("snags").insertMany([{ id: "SN-C1", projectId: "P-CASCADE", title: "t", status: "Open" }, { id: "SN-ORIG", projectId: "P1", title: "orig", status: "Open" }]);
  await db.collection("progress").insertMany([{ _id: "UN-C1::S1", done: true }, { _id: "UN-K::S1", done: true }]);
  await db.collection("qualityInspections").insertOne({ id: "Q-ORIG", projectId: "P1", result: "Fail", linkedSnagId: "SN-ORIG" });
  await db.collection("forms").insertOne({ id: "F1", name: "Public", isPublic: true, active: true, fields: [] });
  await db.collection("teamDailyReports").insertOne({ id: "TDR-1", teamId: "T1", date: "2026-10-27", status: "Pending", members: [], totals: {} });
}

/* The scripted scenarios — identical for both servers. */
const scenarios = (port) => [
  ["plain snag save (admin)", () => ops(port, ADMIN, [{ op: "upsert", coll: "snags", rec: { id: "SNG-PLAIN-1", title: "REC-PRIVATE-TITLE", status: "Open", projectId: "P1" } }])],
  ["member saves an inspection with a Not OK item", () => ops(port, MEM, [{ op: "upsert", coll: "qualityInspections", rec: { id: "QI-MEM-1", projectId: "P1", result: "Pass", checklistItems: [{ status: "Not OK" }], inspectorUserId: "U-MEM" } }])],
  ["member saves a work measurement", () => ops(port, MEM, [{ op: "upsert", coll: "workMeasurements", rec: { id: "WM-MEM-1", projectCode: "P1", category: "RCC", location: { tower: "A" }, measurementDate: "2026-10-27", measuredQty: 5, measuredUnit: "sq.ft", recordedByUserId: "U-MEM" } }])],
  ["leader approves the member's inspection", () => ops(port, LEAD, [{ op: "upsert", coll: "qualityInspections", rec: { id: "QI-MEM-1", approval: { status: "approved" } } }])],
  ["admin saves an inspection (no approval applies)", () => ops(port, ADMIN, [{ op: "upsert", coll: "qualityInspections", rec: { id: "QI-ADM-1", projectId: "P1", result: "Pass" } }])],
  ["admin creates a user with a password", () => ops(port, ADMIN, [{ op: "upsert", coll: "users", rec: { id: "USR-NEW-9", name: "Pat Person Private", email: "pat.person@private.test", phone: "PRIVATE-PHONE-98765", password: "Sup3r-Secret-PW-4242", role: "CIVIL", active: true } }])],
  ["anonymous public drawing request", () => ops(port, null, [{ op: "upsert", coll: "drawingRequests", rec: { id: "DR-ANON-1", projectId: "P1", description: "d", requesterName: "r" } }])],
  ["anonymous public DPR", () => ops(port, null, [{ op: "upsert", coll: "dpr", rec: { id: "DPR-ANON-1", projectId: "P1", date: "2026-10-27", vendorCode: "V", vendorName: "V", shift: "Day", labourCount: 1, workEntries: [] } }])],
  ["anonymous public form submission", () => ops(port, null, [{ op: "upsert", coll: "formSubmissions", rec: { id: "SUB-ANON-1", formId: "F1", values: { a: "x" } } }])],
  ["member saves a material measurement", () => ops(port, MEM, [{ op: "upsert", coll: "materialMeasurements", rec: { id: "MM-MEM-1", projectId: "P1", measuredQty: 4, materialConsumedQty: 3, unusedBalanceQty: 1, wastageQty: 0, measuredUnit: "sq.ft", materialUnit: "kg", note: "MM-PRIVATE-NOTE", recordedByUserId: "U-MEM" } }])],
  ["leader signs off the team daily report", () => ops(port, LEAD, [{ op: "upsert", coll: "teamDailyReports", rec: { id: "TDR-1", status: "Approved" } }])],
  ["admin deletes a project (cascade)", () => ops(port, ADMIN, [{ op: "delete", coll: "projects", id: "P-CASCADE" }])],
  ["passing re-inspection closes the original's snag", () => ops(port, ADMIN, [{ op: "upsert", coll: "qualityInspections", rec: { id: "QI-REINSP", projectId: "P1", result: "Pass", reInspectionOf: "Q-ORIG" } }])],
  ["refused save (member cannot delete)", () => ops(port, MEM, [{ op: "delete", coll: "snags", id: "SNG-PLAIN-1" }])],
  ["batch with an event + progress", () => ops(port, ADMIN, [{ op: "event", ev: { ts: 1, userId: "U-ADMIN", action: "X", targetId: "T", stageId: "", detail: "d" } }])]
];

async function runServer(label, diag, port) {
  const mms = await MongoMemoryServer.create(); const client = await new MongoClient(mms.getUri()).connect(); const db = client.db("t"); await seed(db);
  const uri = mms.getUri(); if (!uri.startsWith("mongodb://127.0.0.1")) throw new Error("refusing to run: database is not the local in-memory one");
  const env = { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: uri, MONGODB_DB: "t", JWT_SECRET: SECRET, PORT: String(port), DISABLE_VMS_DPR_POLL: "1", ...(diag ? { SAVE_DIAGNOSTICS: "1", SAVE_DIAGNOSTICS_EXAMPLES: "20", SAVE_DIAGNOSTICS_SUMMARY_EVERY: "1" } : {}) };
  const srv = spawn(process.execPath, [SERVER], { cwd: path.join(__dirname, ".."), env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) { try { await call(port, "GET", "/api/rev"); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const replies = []; for (const [name, fn] of scenarios(port)) { const r = await fn(); replies.push({ name, status: r.status, err: r.status !== 200 ? JSON.parse(r.text).error : null }); }
  await new Promise((r) => setTimeout(r, 300));
  const stateRaw = JSON.parse((await call(port, "GET", "/api/state", ADMIN)).text);
  const strip = (v) => { if (typeof v === "string") return v.replace(/-[0-9A-Z]{6,10}-[0-9A-Z]{3,5}/g, "-<random>"); /* snag/QI ids now carry a timestamp+random part (they differ run to run) */ if (Array.isArray(v)) return v.map(strip); if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (!/(At|ts|date|Date|time)$/.test(k) && k !== "_id") o[k] = strip(v[k]); return o; } return v; };
  const final = JSON.stringify(strip({ rev: stateRaw.rev, data: stateRaw.data }));
  const users = await db.collection("users").find({}).toArray();
  srv.kill(); await client.close(); await mms.stop();
  return { label, replies, final, log, hashOk: users.some((u) => u.id === "USR-NEW-9" && u.passwordHash && !u.password) };
}

(async () => {
  const ON = await runServer("diag ON", true, await freePort());
  const OFF = await runServer("diag OFF", false, await freePort());
  const diagLines = ON.log.split("\n").filter((l) => l.includes("[save-diag]"));
  const parsed = diagLines.map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return null; } });
  const findLine = (re) => diagLines.find((l) => re.test(l));
  const has = (outcome, re) => diagLines.some((l) => l.includes('"outcome":"' + outcome + '"') && re.test(l));

  console.log("--- observations (diagnostics ON)");
  check("1. plain snag save -> agree-clean", has("agree-clean", /"coll":"snags"/));
  check("2. member's inspection: approval derived + result forced -> agree-not-clean, field names logged", has("agree-not-clean", /qualityInspections/) && findLine(/"approval"/) && findLine(/"result"/));
  check("3. member's work measurement: approval + link fields -> observed", diagLines.some((l) => /workMeasurements/.test(l) && /linkStatus/.test(l) && /approval/.test(l)));
  check("4. leader's approval decision -> approval field changed -> observed", diagLines.some((l) => /"agree-not-clean"/.test(l) && /qualityInspections/.test(l) && /approval/.test(l)) && ON.replies[3].status === 200);
  check("5. admin inspection (nothing rewritten) -> mismatch-conservative (informational only)", has("mismatch-conservative", /qualityInspections/));
  check("6. user with password -> users-password", findLine(/users-password/) && /"coll":"users"/.test(findLine(/users-password/)));
  check("7a. anonymous drawing request defaults -> observed", diagLines.some((l) => /drawingRequests/.test(l) && /reviewStatus/.test(l) && /"anonymous":true/.test(l)));
  check("7b. anonymous DPR defaults -> observed", diagLines.some((l) => /"coll":"dpr"/.test(l) && /"anonymous":true/.test(l) && /(isPublic|submittedByUserId)/.test(l)));
  check("7c. anonymous form submission -> submittedAt observed", diagLines.some((l) => /formSubmissions/.test(l) && /submittedAt/.test(l)));
  check("8. team-report sign-off rewritten by the server -> observed", diagLines.some((l) => /teamDailyReports/.test(l) && /approvedAt/.test(l) && /approvedByName/.test(l)));
  const casc = diagLines.find((l) => /project-delete-cascade/.test(l));
  check("9. project delete cascade -> reason + real deletion counts (2 floors, 1 unit, 1 snag, 1 progress)", !!casc && /"floors":2/.test(casc) && /"units":1/.test(casc) && /"snags":1/.test(casc) && /"progress":1/.test(casc), casc && casc.slice(casc.indexOf("cascadeCounts"), casc.indexOf("cascadeCounts") + 70));
  check("10. passing re-inspection that closed a snag -> re-inspection-closed-record", !!findLine(/re-inspection-closed-record/));
  check("11. a REFUSED save (403) produced NO comparison line (it never applied, so there is nothing to compare)", !diagLines.some((l) => /"kind":"delete","coll":"snags"/.test(l)) && ON.replies.find((r) => r.name.startsWith("refused")).status === 403);
  const unsafeHits = diagLines.filter((l) => { try { const o = JSON.parse(l.slice(l.indexOf("{"))); return o.outcome === "MISMATCH-unsafe" || (o.batchOutcomes && o.batchOutcomes["MISMATCH-unsafe"] > 0) || o.suppressedUnsafe > 0; } catch { return true; } });
  check("12. no MISMATCH-unsafe in any scenario; every diag line parses (summary zero-counters are not hits)", unsafeHits.length === 0, unsafeHits.slice(0, 2).join(" || "));
  check("13. periodic summary line printed", diagLines.some((l) => /"summary":true/.test(l)));

  console.log("--- diagnostics cannot change behaviour (ON vs OFF, same scenarios, fresh databases)");
  check("14. identical HTTP status and error text for every scenario", JSON.stringify(ON.replies) === JSON.stringify(OFF.replies), ON.replies.map((r) => r.status).join(",") + " vs " + OFF.replies.map((r) => r.status).join(","));
  check("15. identical final database state (all collections, revision, events), timestamps excluded", ON.final === OFF.final, ON.final === OFF.final ? "" : "differs");
  check("16. the user's password was still hashed and never stored in plaintext (ON)", ON.hashOk);
  check("17. diagnostics OFF logs nothing at all", !OFF.log.includes("[save-diag]") && !OFF.log.includes("save diagnostics: ON"));

  console.log("--- log hygiene and bounds");
  const allDiag = diagLines.join("\n");
  const leaked = SENTINELS.filter((s) => allDiag.includes(s));
  check("18. no password, email, name, phone, title, token or record id appears in any diagnostic line", leaked.length === 0, "leaked=" + leaked.join("|"));
  check("19. every diagnostic line is a single bounded line", diagLines.every((l) => l.length <= 700), "max=" + Math.max(...diagLines.map((l) => l.length)));
  check("20. log volume is bounded (15 scenarios, a summary after EVERY batch -> under 100 lines)", diagLines.length < 100, "lines=" + diagLines.length);
  console.log("--- the ten transformation rules (from the server's own summary counters)");
  const sums = parsed.filter((o) => o && o.summary); const lastSeq = Math.max(...sums.map((o) => o.seq));
  const lastParts = sums.filter((o) => o.seq === lastSeq); const head = lastParts.find((o) => o.part === 1);
  const reasons = Object.assign({}, ...lastParts.map((o) => o.reasons || {}));
  check("21. last summary is complete (all parts present, same boot)", !!head && lastParts.length === head.parts && new Set(lastParts.map((o) => o.boot)).size === 1);
  const applied = ON.replies.filter((r) => r.status === 200).length;
  check("22. batches == applied saves (" + applied + "); refused save not counted; batchOutcomes add up to batches", !!head && head.batches === applied && Object.values(head.batchOutcomes).reduce((a, b) => a + b, 0) === head.batches, head && JSON.stringify(head.batchOutcomes));
  const RULES = ["server-modified:qualityInspections", "server-modified:workMeasurements", "server-modified:materialMeasurements", "users-password", "project-delete-cascade", "re-inspection-closed-record", "server-modified:drawingRequests", "server-modified:dpr", "server-modified:formSubmissions", "server-modified:teamDailyReports"];
  const verified = RULES.filter((r) => reasons[r] > 0);
  for (const r of RULES) check("23. rule observed: " + r, reasons[r] > 0, "count=" + (reasons[r] || 0));
  const wi = process.argv.indexOf("--write-coverage"); if (wi > 0 && fails === 0) { fs.writeFileSync(process.argv[wi + 1], JSON.stringify(verified, null, 1)); console.log("coverage written: " + process.argv[wi + 1]); }
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  if (fails) console.log(diagLines.slice(0, 20).join("\n"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
