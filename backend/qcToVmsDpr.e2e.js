/* End-to-end test for the QC -> VMS DPR copy (qcToVmsDpr.js): the REAL backend/server.js against a throw-away IN-MEMORY MongoDB
   that holds a QC database ("t") and a pretend VMS database ("vbp"), invented data only.
   ISOLATION: explicit minimal environment (no .env, no inherited credentials), 127.0.0.1 only; the "VMS" here is a database
   inside the same in-memory mongod — nothing real is reachable. Needs the dev-only "mongodb-memory-server" (see
   docs/save-diagnostics-synthetic-test.md). Usage: NODE_PATH=<dir>/node_modules node backend/qcToVmsDpr.e2e.js (exit 0 = all passed) */
let MongoMemoryServer;
try { ({ MongoMemoryServer } = require("mongodb-memory-server")); } catch { console.error("mongodb-memory-server is not installed (dev-only)."); process.exit(2); }
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const net = require("net");
const SECRET = "s".repeat(32);
const tok = (userId, isAdmin) => jwt.sign({ userId, isAdmin: !!isAdmin }, SECRET);
const MEM = tok("U-B");
let fails = 0; const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) fails++; };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function call(port, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const r = http.request({ host: "127.0.0.1", port, method, path: p, agent: false, headers: { "Accept-Encoding": "identity", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, ms: performance.now() - t0 }));
    }); r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const dprRec = (id, over = {}) => ({ id, projectId: "P1", projectName: "Tower One", date: "2026-10-27", vendorCode: "V1", vendorName: "Vendor One", shift: "Day", labourCount: 5, submittedByName: "Dri Person", workEntries: [{ category: "RCC", qty: 3, unit: "m", generalPhotos: [{ url: "https://x/" + id + ".jpg", publicId: "pid-" + id }], beforePhotos: [], afterPhotos: [] }], ...over });
const save = (port, token, rec) => call(port, "POST", "/api/ops", token, { ops: [{ op: "upsert", coll: "dpr", create: true, rec }] });

(async () => {
  const mms = await MongoMemoryServer.create();
  const uri = mms.getUri(); if (!uri.startsWith("mongodb://127.0.0.1")) throw new Error("refusing to run: not the local in-memory database");
  const client = await new MongoClient(uri).connect(); const qc = client.db("t"), vms = client.db("vbp");
  await qc.collection("users").insertMany([{ id: "U-B", name: "Member", role: "CIVIL", active: true }]);
  await qc.collection("projects").insertMany([{ id: "P1", code: "PRJ-1", name: "Tower One", active: true }, { id: "PX", code: "PRJ-X", name: "Not In VMS", active: true }]);
  const VMS_P = new ObjectId();
  await vms.collection("projects").insertOne({ _id: VMS_P, code: "PRJ-1", name: "Tower One (VMS)" });
  const base = (port, extra) => ({ PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: uri, MONGODB_DB: "t", JWT_SECRET: SECRET, PORT: String(port), DISABLE_VMS_DPR_POLL: "1", ...extra });
  async function start(extra) {
    const port = await freePort();
    const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], { cwd: __dirname, env: base(port, extra), stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 100; i++) { try { await call(port, "GET", "/api/rev"); break; } catch { await sleep(250); } }
    return { port, srv, log: () => log };
  }
  const vmsCount = () => vms.collection("dailyprogressreports").countDocuments();

  console.log("--- flag OFF (the default): nothing is ever written to VMS");
  const off = await start({ SOURCE_MONGO_URI: uri });      // a VMS connection exists, but QC_TO_VMS_DPR is not set
  let r = await save(off.port, MEM, dprRec("DPR-OFF-1")); await sleep(1500);
  check("1. a DPR saved on QC is accepted exactly as before (200) and stored in QC", r.status === 200 && (await qc.collection("dpr").countDocuments({ id: "DPR-OFF-1" })) === 1);
  check("2. and NOTHING was written to VMS", (await vmsCount()) === 0);
  off.srv.kill();

  console.log("--- flag ON");
  const on = await start({ SOURCE_MONGO_URI: uri, QC_TO_VMS_DPR: "1" });
  r = await save(on.port, MEM, dprRec("DPR-ON-1"));
  check("3. saving a DPR still answers 200", r.status === 200, r.ms.toFixed(0) + " ms");
  await sleep(1500);
  const v1 = await vms.collection("dailyprogressreports").findOne({ qcId: "DPR-ON-1" });
  check("4. the DPR now exists in VMS's dailyprogressreports, mapped to VMS's own project", !!v1 && String(v1.projectId) === String(VMS_P) && v1.projectName === "Tower One (VMS)" && v1.source === "qc");
  check("5. its fields are the VMS shape (Date, shiftType, workType, images {name,url}, labour, vendor, DRI name)", v1 && v1.date instanceof Date && v1.date.toISOString().startsWith("2026-10-27") && v1.shiftType === "Day" && v1.labourCount === 5 && v1.vendorCode === "V1" && v1.driName === "Dri Person" && v1.workEntries[0].workType === "RCC" && v1.workEntries[0].images[0].url === "https://x/DPR-ON-1.jpg" && v1.isPublicSubmission === false);
  r = await save(on.port, null, dprRec("DPR-PUB-1", { isPublic: true, submittedByName: "Site DRI" })); await sleep(1500);
  const v2 = await vms.collection("dailyprogressreports").findOne({ qcId: "DPR-PUB-1" });
  check("6. a public (no-login) DPR is copied too, flagged as a public submission", r.status === 200 && !!v2 && v2.isPublicSubmission === true);
  r = await call(on.port, "POST", "/api/ops", MEM, { ops: [{ op: "upsert", coll: "dpr", rec: { id: "DPR-ON-1", labourCount: 99 } }] }); await sleep(1000);
  check("7. editing the DPR in QC does not touch the VMS copy (insert-only, nothing is updated or deleted there)", r.status === 200 && (await vms.collection("dailyprogressreports").findOne({ qcId: "DPR-ON-1" })).labourCount === 5 && (await vmsCount()) === 2);
  r = await save(on.port, MEM, dprRec("DPR-NOPROJ-1", { projectId: "PX", projectName: "Not In VMS" })); await sleep(1200);
  check("8. a QC project VMS does not know: the QC save is fine (200) and nothing is guessed into VMS", r.status === 200 && (await qc.collection("dpr").countDocuments({ id: "DPR-NOPROJ-1" })) === 1 && (await vms.collection("dailyprogressreports").countDocuments({ qcId: "DPR-NOPROJ-1" })) === 0);
  check("9. the server logged the skip (no secrets/content), and is still healthy", /\[qc->vms\] DPR DPR-NOPROJ-1: skipped:no-matching-vms-project/.test(on.log()) && (await call(on.port, "GET", "/api/rev")).status === 200);

  console.log("--- no echo back into QC");
  const { syncVmsDpr } = require("./syncVmsDpr.js");
  const before = await qc.collection("dpr").countDocuments();
  const sync = await syncVmsDpr(qc, vms);
  check("10. the VMS -> QC sync does NOT import the copies back (no DPR-VMS-<copy> duplicates in QC)", sync.inserted === 0 && (await qc.collection("dpr").countDocuments()) === before && (await qc.collection("dpr").countDocuments({ id: /^DPR-VMS-/ })) === 0, JSON.stringify(sync));
  await vms.collection("dailyprogressreports").insertOne({ projectName: "Tower One (VMS)", projectId: VMS_P, date: new Date("2026-10-26"), vendorCode: "V1", vendorName: "V", shiftType: "Day", labourCount: 2, workEntries: [], driName: "Native VMS DRI" });
  const sync2 = await syncVmsDpr(qc, vms);
  check("11. a DPR made natively in VMS is still imported into QC as before", sync2.inserted === 1 && (await qc.collection("dpr").countDocuments({ id: /^DPR-VMS-/ })) === 1);

  console.log("--- a retry cannot duplicate");
  const { createPusher } = require("./qcToVmsDpr.js");
  const pusher = createPusher({ getQcProjects: () => qc.collection("projects").find({}, { projection: { _id: 0 } }).toArray(), getVmsDb: async () => vms });
  const again = await pusher.push(await qc.collection("dpr").findOne({ id: "DPR-ON-1" }, { projection: { _id: 0 } }));
  const races = await Promise.all(Array.from({ length: 10 }, () => pusher.push(dprRec("DPR-RACE-1"))));
  check("12. pushing an already-copied DPR again answers 'exists'; 10 concurrent pushes of a new one make exactly one VMS record", again === "exists" && races.filter((x) => x === "pushed").length === 1 && (await vms.collection("dailyprogressreports").countDocuments({ qcId: "DPR-RACE-1" })) === 1, JSON.stringify(races.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})));

  console.log("--- reconcile / backfill (only when asked, from a date)");
  await qc.collection("dpr").insertMany([dprRec("DPR-OLD-A", { date: "2026-09-01" }), dprRec("DPR-OLD-B", { date: "2026-10-20" }), dprRec("DPR-OLD-C", { date: "2026-10-21" })].map((d) => ({ ...d })));
  const noSince = await pusher.reconcile(qc, {});
  const dry = await pusher.reconcile(qc, { since: "2026-10-01", dryRun: true });
  check("13. without a SINCE date nothing old is copied; a dry run reports counts and writes nothing", // (DPR-OFF-1 was saved while the flag was OFF, so it too is missing in VMS and dated after SINCE: 3 candidates)
  noSince.pushed === 0 && dry.pushed === 3 && dry.skipped === 1 && (await vms.collection("dailyprogressreports").countDocuments({ qcId: { $in: ["DPR-OFF-1", "DPR-OLD-A", "DPR-OLD-B", "DPR-OLD-C"] } })) === 0, JSON.stringify(dry));
  const real = await pusher.reconcile(qc, { since: "2026-10-01" });
  check("14. the real pass copies only DPRs dated from SINCE (the September one stays out) and a second pass copies nothing", real.pushed === 3 && (await vms.collection("dailyprogressreports").countDocuments({ qcId: { $in: ["DPR-OFF-1", "DPR-OLD-B", "DPR-OLD-C"] } })) === 3 && (await vms.collection("dailyprogressreports").countDocuments({ qcId: "DPR-OLD-A" })) === 0 && (await pusher.reconcile(qc, { since: "2026-10-01" })).pushed === 0, JSON.stringify(real));
  on.srv.kill();

  console.log("--- VMS unreachable: QC submissions are unaffected");
  const dead = await start({ SOURCE_MONGO_URI: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=2000", QC_TO_VMS_DPR: "1" });
  const times = []; const statuses = [];
  for (let i = 0; i < 4; i++) { const x = await save(dead.port, MEM, dprRec("DPR-DEAD-" + i)); times.push(x.ms); statuses.push(x.status); }
  await sleep(6500);
  check("15. with the VMS database unreachable every QC save is still 200 and the DPRs are in QC", statuses.every((s) => s === 200) && (await qc.collection("dpr").countDocuments({ id: /^DPR-DEAD-/ })) === 4, "statuses=" + statuses.join(","));
  check("16. and the saves are not slowed down by it (nobody waits for the VMS copy)", Math.max(...times) < 1500, "max " + Math.max(...times).toFixed(0) + " ms");
  check("17. the server is still up, answers requests, and did not crash", (await call(dead.port, "GET", "/api/rev")).status === 200 && (await save(dead.port, MEM, dprRec("DPR-DEAD-AFTER"))).status === 200);
  dead.srv.kill();

  await client.close(); await mms.stop();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
