/* End-to-end regression test, part 2 of the data-integrity fixes (docs/data-integrity-fixes.md): the two flag-gated
   behaviours (OPS_ATOMIC=1 and PROGRESS_CELL_MERGE=1, both default OFF) and partial approval updates.
   Needs a REPLICA SET for transactions, so it uses mongodb-memory-server's MongoMemoryReplSet (dev-only tool, throw-away,
   in-memory, 127.0.0.1 only; explicit minimal environment, no .env, no inherited credentials, invented data).
   Usage: NODE_PATH=<dir>/node_modules node backend/dataIntegrity2.e2e.js     (exit 0 = all checks passed) */
let MongoMemoryReplSet;
try { ({ MongoMemoryReplSet } = require("mongodb-memory-server")); } catch { console.error("mongodb-memory-server is not installed (dev-only)."); process.exit(2); }
const { MongoClient } = require("mongodb");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const net = require("net");
const SECRET = "s".repeat(32);
const tok = (userId, isAdmin) => jwt.sign({ userId, isAdmin: !!isAdmin }, SECRET);
const ADMIN = tok("U-ADMIN", true), LEAD = tok("U-A"), MEM = tok("U-B");
let fails = 0; const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) fails++; };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
let PORT;
function call(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, agent: false, headers: { "Accept-Encoding": "identity", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, json: j }); });
    }); r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const ops = (token, list, batchId) => call("POST", "/api/ops", token, { ops: list, ...(batchId ? { batchId } : {}) });
const tally = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

(async () => {
  PORT = await freePort();
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = rs.getUri(); if (!/^mongodb:\/\/127\.0\.0\.1/.test(uri)) throw new Error("refusing to run: not the local in-memory database");
  const client = await new MongoClient(uri).connect(); const db = client.db("t");
  await db.collection("users").insertMany([
    { id: "U-ADMIN", name: "Admin", role: "ADMIN", active: true }, { id: "U-A", name: "Leader", role: "CIVIL", teamId: "T1", active: true }, { id: "U-B", name: "Member", role: "CIVIL", teamId: "T1", active: true }]);
  await db.collection("teams").insertOne({ id: "T1", name: "Team", leaderId: "U-A", active: true });
  await db.collection("projects").insertOne({ id: "P1", code: "P1", name: "Tower One", active: true });
  await db.collection("stages").insertOne({ id: "STG-RCC", name: "RCC", role: "CIVIL" });
  const env = { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: uri, MONGODB_DB: "t", JWT_SECRET: SECRET, PORT: String(PORT), DISABLE_VMS_DPR_POLL: "1", OPS_ATOMIC: "1", PROGRESS_CELL_MERGE: "1" };
  const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], { cwd: __dirname, env, stdio: ["ignore", "pipe", "pipe"] });
  let slog = ""; srv.stdout.on("data", (d) => (slog += d)); srv.stderr.on("data", (d) => (slog += d));
  for (let i = 0; i < 100; i++) { try { await call("GET", "/api/rev"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  console.log("--- OPS_ATOMIC=1: a batch is all or nothing");
  await db.collection("snags").insertOne({ id: "SNG-BAD", projectId: "P1", title: "has a non-array photos field", photos: "oops" });
  const batch = [
    { op: "upsert", coll: "snags", create: true, rec: { id: "SNG-A1", projectId: "P1", title: "first op", status: "Open" } },
    { op: "upsert", coll: "snags", create: true, rec: { id: "SNG-A2", projectId: "P1", title: "second op", status: "Open" } },
    { op: "upsert", coll: "snags", rec: { id: "SNG-BAD" }, push: { photos: { url: "x" } } },        // fails at WRITE time (cannot push onto a string)
    { op: "event", ev: { ts: 1, userId: "U-ADMIN", action: "X", targetId: "T", stageId: "", detail: "d" } }
  ];
  let r = await ops(ADMIN, batch, "atomic-batch-1");
  check("1. a batch that fails in the middle is refused (4xx, not a success)", r.status >= 400 && r.status < 500, String(r.status));
  check("2. NOTHING of it was written: earlier creates rolled back, no event", (await db.collection("snags").countDocuments({ id: { $in: ["SNG-A1", "SNG-A2"] } })) === 0 && (await db.collection("events").countDocuments({ action: "X" })) === 0);
  await db.collection("snags").updateOne({ id: "SNG-BAD" }, { $set: { photos: [] } });
  r = await ops(ADMIN, batch, "atomic-batch-1");
  check("3. after the problem is fixed, the SAME batch id is applied completely (no 409 on its own earlier creates)", r.status === 200 && (await db.collection("snags").countDocuments({ id: { $in: ["SNG-A1", "SNG-A2"] } })) === 2 && (await db.collection("snags").findOne({ id: "SNG-BAD" })).photos.length === 1, String(r.status));
  r = await ops(ADMIN, batch, "atomic-batch-1");
  check("4. and a further retry of it is just acknowledged (idempotent)", r.status === 200 && (await db.collection("snags").findOne({ id: "SNG-BAD" })).photos.length === 1);

  console.log("--- atomic path keeps the existing features working");
  const par = await Promise.all(Array.from({ length: 8 }, (_, i) => ops(ADMIN, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-RACE", projectId: "P1", title: "racer " + i } }])));
  const tl = tally(par);
  check("5. concurrent creates of one id under transactions: exactly one wins, the rest are 409 (or a retryable 503), none overwritten", tl[200] === 1 && (tl[409] || 0) + (tl[503] || 0) === 7 && (await db.collection("snags").countDocuments({ id: "SNG-RACE" })) === 1, JSON.stringify(tl));
  await db.collection("floors").insertMany([{ id: "F1", projectId: "PX" }, { id: "F2", projectId: "PX" }]);
  await db.collection("units").insertOne({ id: "UN1", projectId: "PX", floorId: "F1" });
  await db.collection("progress").insertOne({ _id: "UN1::S1", done: true });
  await db.collection("projects").insertOne({ id: "PX", code: "PX", name: "To delete", active: true });
  r = await ops(ADMIN, [{ op: "delete", coll: "projects", id: "PX" }]);
  check("6. project delete (cascade) works inside the batch transaction", r.status === 200 && (await db.collection("projects").countDocuments({ id: "PX" })) === 0 && (await db.collection("floors").countDocuments({ projectId: "PX" })) === 0 && (await db.collection("units").countDocuments({ projectId: "PX" })) === 0 && (await db.collection("progress").countDocuments({ _id: "UN1::S1" })) === 0, String(r.status));
  check("6b. under OPS_ATOMIC the same delete archived the project and its floors/units in trash (inside the transaction)", (await db.collection("trash").countDocuments({ originalColl: "projects", "doc.id": "PX" })) === 1 && (await db.collection("trash").countDocuments({ originalColl: "floors", "doc.projectId": "PX" })) === 2 && (await db.collection("trash").countDocuments({ originalColl: "units", "doc.projectId": "PX" })) === 1);
  r = await ops(MEM, [{ op: "upsert", coll: "workMeasurements", create: true, rec: { id: "WM-1", projectCode: "P1", category: "RCC", location: { tower: "A" }, measurementDate: "2026-10-27", measuredQty: 5, measuredUnit: "sq.ft", recordedByUserId: "U-B" } }]);
  check("7. a member's measurement is saved with its derived approval under transactions", r.status === 200 && (await db.collection("workMeasurements").findOne({ id: "WM-1" })).approval.status === "pending");

  console.log("--- partial approval updates");
  r = await ops(LEAD, [{ op: "upsert", coll: "workMeasurements", rec: { id: "WM-1", approval: { status: "approved" } } }]);
  const wm = await db.collection("workMeasurements").findOne({ id: "WM-1" });
  check("8. the leader's decision can be sent as just {id, approval}: accepted and recorded", r.status === 200 && wm.approval.status === "approved" && wm.approval.decidedAt > 0, r.status + " " + (r.json && r.json.error));
  check("9. every other field of the measurement is untouched by it", wm.measuredQty === 5 && wm.category === "RCC" && wm.recordedByUserId === "U-B" && wm.projectCode === "P1");
  r = await ops(MEM, [{ op: "upsert", coll: "workMeasurements", rec: { id: "WM-1", approval: { status: "rejected", remark: "x" } } }]);
  check("10. a partial decision is still checked by the rules (a member cannot decide; approved is final)", r.status === 403, String(r.status));
  r = await ops(MEM, [{ op: "upsert", coll: "workMeasurements", rec: { id: "WM-1", measuredQty: -3 } }]);
  check("11. a partial update that makes the stored record invalid is refused (validated against the full record)", r.status === 400 && (await db.collection("workMeasurements").findOne({ id: "WM-1" })).measuredQty === 5, String(r.status));

  console.log("--- PROGRESS_CELL_MERGE=1: item cells are merged, not replaced");
  const cellOps = (n) => Array.from({ length: n }, (_, i) => ops(ADMIN, [{ op: "progress", key: "UNX::STG-RCC", patch: { checklist: [{ itemId: "IT-" + i, status: "done", by: "U-ADMIN", note: i === 0 ? "$100 and $note stay text" : null }] } }]));
  const cs = await Promise.all(cellOps(10));
  const pdoc = await db.collection("progress").findOne({ _id: "UNX::STG-RCC" });
  check("12. 10 concurrent writes of 10 different items: all 10 cells are present", cs.every((x) => x.status === 200) && pdoc.checklist.length === 10 && new Set(pdoc.checklist.map((c) => c.itemId)).size === 10, "cells=" + pdoc.checklist.length);
  check("13. a note that starts with $ is stored as text, not interpreted", pdoc.checklist.find((c) => c.itemId === "IT-0").note === "$100 and $note stay text");
  await ops(ADMIN, [{ op: "progress", key: "UNX::STG-RCC", patch: { checklist: [{ itemId: "IT-3", meas: 111, photo: { url: "p" } }] } }]);
  await ops(ADMIN, [{ op: "progress", key: "UNX::STG-RCC", patch: { checklist: [{ itemId: "IT-3", status: "fail", note: "late" }] } }]);
  const c3 = (await db.collection("progress").findOne({ _id: "UNX::STG-RCC" })).checklist.find((c) => c.itemId === "IT-3");
  check("14. two edits of the SAME cell keep the union of their fields (photo/measurement + status)", c3.meas === 111 && c3.photo.url === "p" && c3.status === "fail" && c3.note === "late");
  await ops(ADMIN, [{ op: "progress", key: "UNX::STG-RCC", patch: { status: "wip", checklistId: "CL-1", checklist: [{ itemId: "IT-9", status: "ack" }] } }]);
  const pd2 = await db.collection("progress").findOne({ _id: "UNX::STG-RCC" });
  check("15. the other progress fields (status, checklistId) are set alongside, and the other 9 cells stay", pd2.status === "wip" && pd2.checklistId === "CL-1" && pd2.checklist.length === 10 && pd2.checklist.find((c) => c.itemId === "IT-9").status === "ack");
  await ops(ADMIN, [{ op: "progress", key: "UNY::STG-X", patch: { status: "done", checklist: [{ paramId: "QP-1", ok: true }, { paramId: "QP-2", ok: false }] } }]);
  await ops(ADMIN, [{ op: "progress", key: "UNY::STG-X", patch: { checklist: [{ paramId: "QP-1", ok: false }] } }]);
  const pd3 = await db.collection("progress").findOne({ _id: "UNY::STG-X" });
  check("16. a checklist WITHOUT itemId (a stage inspection's results) is still replaced as a whole, as before", pd3.checklist.length === 1 && pd3.checklist[0].ok === false && pd3.status === "done");
  await ops(ADMIN, [{ op: "progress", key: "UNY::STG-X", patch: { status: null } }]);
  check("17. a null patch field still removes the field", !("status" in (await db.collection("progress").findOne({ _id: "UNY::STG-X" }))));

  console.log("--- stage status is decided on the server");
  const both = (key, items) => Promise.all(["IT-A", "IT-B"].map((id) => ops(ADMIN, [{ op: "progress", items, key, patch: { status: "wip", checklist: [{ itemId: id, status: "done" }] } }])));
  await both("UNS::STG-RCC", ["IT-A", "IT-B"]);
  check("18. two people finish the LAST TWO items at the same moment (each browser computes 'wip'): the stage ends 'done'", (await db.collection("progress").findOne({ _id: "UNS::STG-RCC" })).status === "done");
  await both("UNT::STG-RCC", ["IT-A", "IT-B", "IT-C"]);
  check("19. with a third item still open it stays 'wip'", (await db.collection("progress").findOne({ _id: "UNT::STG-RCC" })).status === "wip");
  await ops(ADMIN, [{ op: "progress", items: ["IT-A", "IT-B", "IT-C"], key: "UNT::STG-RCC", patch: { status: "wip", checklist: [{ itemId: "IT-C", status: "done" }] } }]);
  check("20. and becomes 'done' when the last one is completed (judged on the merged cells)", (await db.collection("progress").findOne({ _id: "UNT::STG-RCC" })).status === "done");
  await ops(ADMIN, [{ op: "progress", items: ["IT-A", "IT-B", "IT-C"], key: "UNT::STG-RCC", patch: { checklist: [{ itemId: "IT-C", status: "fail" }] } }]);
  check("21. a write that does not set the status leaves it alone, even with an item list", (await db.collection("progress").findOne({ _id: "UNT::STG-RCC" })).status === "done");
  await ops(ADMIN, [{ op: "progress", key: "UNW::STG-RCC", patch: { status: "wip", checklist: [{ itemId: "IT-A", status: "done" }] } }]);
  check("22. without an item list the status is exactly what was sent (older browsers)", (await db.collection("progress").findOne({ _id: "UNW::STG-RCC" })).status === "wip");
  await ops(ADMIN, [{ op: "progress", items: ["IT-A", "IT-B"], key: "UNV::STG-RCC", patch: { status: "wip", checklist: [{ itemId: "IT-A", status: "$ne" }] } }]);
  check("23. an item list with odd content cannot change what is stored in a cell", (await db.collection("progress").findOne({ _id: "UNV::STG-RCC" })).checklist[0].status === "$ne");
  check("24. the startup check reported that transactions are available (read-only probe)", /OPS_ATOMIC=1: database transactions are available/.test(slog));

  srv.kill(); await client.close(); await rs.stop();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  if (fails) console.log(slog.split("\n").slice(-20).join("\n"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
