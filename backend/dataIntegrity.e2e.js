/* End-to-end regression test for the data-integrity fixes (docs/data-integrity-fixes.md).
   Starts the REAL backend/server.js against a throw-away IN-MEMORY MongoDB filled with invented data and checks, over
   HTTP, that: a create never overwrites an existing record, concurrent creates cannot clobber each other, appends do
   not lose entries, a conflicting batch writes nothing, a restore/reset first saves the live board and no longer empties
   collections the backup does not contain, deleted VMS records are not re-imported, and old-style ops still behave as
   before. ISOLATION: explicit minimal environment (no .env, no inherited MONGODB_URI, no VMS/Slack/Cloudinary),
   127.0.0.1 only. Needs the dev-only package "mongodb-memory-server" (see docs/save-diagnostics-synthetic-test.md for
   how to provide it) — it is not part of "node *.test.js" and not an app dependency.
   Usage: NODE_PATH=<dir>/node_modules node backend/dataIntegrity.e2e.js        (exit 0 = all checks passed) */
let MongoMemoryServer;
try { ({ MongoMemoryServer } = require("mongodb-memory-server")); } catch { console.error("mongodb-memory-server is not installed (dev-only)."); process.exit(2); }
const { MongoClient } = require("mongodb");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const net = require("net");
const SECRET = "s".repeat(32);
const tok = (userId, isAdmin) => jwt.sign({ userId, isAdmin: !!isAdmin }, SECRET);
const ADMIN = tok("U-ADMIN", true), A = tok("U-A"), B = tok("U-B");
let fails = 0; const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) fails++; };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
let PORT;
function call(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, agent: false, headers: { "Accept-Encoding": "identity", ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(method === "POST" && !body ? { "Content-Length": "0" } : {}) } }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, json: j, text: t }); });
    }); r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const ops = (token, list, batchId) => call("POST", "/api/ops", token, { ops: list, ...(batchId ? { batchId } : {}) });
const login = (email, password) => call("POST", "/api/login", null, { email, password });
const tally = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

(async () => {
  PORT = await freePort();
  const mms = await MongoMemoryServer.create();
  const uri = mms.getUri(); if (!uri.startsWith("mongodb://127.0.0.1")) throw new Error("refusing to run: not the local in-memory database");
  const client = await new MongoClient(uri).connect(); const db = client.db("t");
  await db.collection("users").insertMany([
    { id: "U-ADMIN", name: "Admin", role: "ADMIN", active: true }, { id: "U-A", name: "User A", role: "CIVIL", teamId: "T1", active: true },
    { id: "U-B", name: "User B", role: "CIVIL", teamId: "T1", active: true }, { id: "U-C", name: "User C", role: "CIVIL", active: true }]);
  await db.collection("teams").insertOne({ id: "T1", name: "Team", leaderId: "U-A", active: true });
  await db.collection("projects").insertOne({ id: "P1", code: "P1", name: "Tower One", active: true });
  const env = { PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: uri, MONGODB_DB: "t", JWT_SECRET: SECRET, PORT: String(PORT), DISABLE_VMS_DPR_POLL: "1", TEAM_REPORT_CRON_SECRET: "cron-secret-synthetic", EVENTS_ARCHIVE_DAYS: "7" };
  const srv = spawn(process.execPath, [path.join(__dirname, "server.js")], { cwd: __dirname, env, stdio: ["ignore", "pipe", "pipe"] });
  let slog = ""; srv.stdout.on("data", (d) => (slog += d)); srv.stderr.on("data", (d) => (slog += d));
  for (let i = 0; i < 80; i++) { try { await call("GET", "/api/rev"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

  console.log("--- creates never overwrite");
  let r = await ops(A, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0001", projectId: "P1", title: "A's snag", status: "Open" } }]);
  check("1. a create with a free id succeeds", r.status === 200);
  r = await ops(B, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0001", projectId: "P1", title: "B's snag", status: "Open" } }]);
  let doc = await db.collection("snags").findOne({ id: "SNG-0001" });
  check("2. a create on an existing id is refused with 409 and a clear message", r.status === 409 && /already exists/.test(r.json.error), r.status + " " + (r.json && r.json.error));
  check("3. the existing record is untouched", doc.title === "A's snag" && (await db.collection("snags").countDocuments({ id: "SNG-0001" })) === 1);
  r = await ops(B, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0001", projectId: "P1", title: "B edits it (legacy op, no create flag)", status: "Open" } }]);
  doc = await db.collection("snags").findOne({ id: "SNG-0001" });
  check("4. an op WITHOUT the flag behaves exactly as before (merge/update) — older browsers are unaffected", r.status === 200 && doc.title.startsWith("B edits"));

  const par = await Promise.all(Array.from({ length: 12 }, (_, i) => ops(i % 2 ? A : B, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0500", projectId: "P1", title: "racer " + i, status: "Open" } }])));
  const t = tally(par);
  check("5. 12 concurrent creates of the same id: exactly one wins, the other 11 get 409 (none silently overwritten)", t[200] === 1 && t[409] === 11 && (await db.collection("snags").countDocuments({ id: "SNG-0500" })) === 1, JSON.stringify(t));

  await ops(ADMIN, [{ op: "upsert", coll: "users", create: true, rec: { id: "USR-0007", name: "Alice", email: "alice@x.test", password: "alice-pw-1", role: "CIVIL", active: true } }]);
  r = await ops(ADMIN, [{ op: "upsert", coll: "users", create: true, rec: { id: "USR-0007", name: "Bob", email: "bob@x.test", password: "bob-pw-1", role: "CIVIL", active: true } }]);
  check("6. a second user create on the same id is refused (409)", r.status === 409);
  check("7. the first user's account and password are intact; the second never got in", (await login("alice@x.test", "alice-pw-1")).status === 200 && (await login("bob@x.test", "bob-pw-1")).status === 401);
  const u = await db.collection("users").findOne({ id: "USR-0007" });
  check("8. the password is still hashed, never stored in plaintext", !!u.passwordHash && !("password" in u));

  console.log("--- a conflicting batch writes nothing");
  r = await ops(ADMIN, [
    { op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0300", projectId: "P1", title: "first op of the batch", status: "Open" } },
    { op: "upsert", coll: "users", rec: { id: "USR-0021", name: "Dup", email: "alice@x.test", role: "CIVIL", active: true } }]);
  check("9. an e-mail already used by another user -> 409 (not a 400/500)", r.status === 409 && /e-mail/i.test(r.json.error), r.status + " " + (r.json && r.json.error));
  check("10. and the OTHER op in the batch was not written (no partial save)", (await db.collection("snags").countDocuments({ id: "SNG-0300" })) === 0 && (await db.collection("users").countDocuments({ id: "USR-0021" })) === 0);
  r = await ops(ADMIN, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0310", title: "twice" } }, { op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0310", title: "twice again" } }]);
  check("11. the same new id twice inside one batch -> 409, nothing written", r.status === 409 && (await db.collection("snags").countDocuments({ id: "SNG-0310" })) === 0);
  const same = [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0320", projectId: "P1", title: "idempotent create", status: "Open" } }];
  const f1 = await ops(A, same, "batch-create-0001"), f2 = await ops(A, same, "batch-create-0001");
  check("12. a retried batch (same batchId) after a successful create is acknowledged, not a 409", f1.status === 200 && f2.status === 200 && (await db.collection("snags").countDocuments({ id: "SNG-0320" })) === 1, f1.status + "/" + f2.status);

  console.log("--- appends do not lose entries");
  await db.collection("snags").insertOne({ id: "SNG-0100", projectId: "P1", title: "shared", status: "Open", assignedTo: "U-A", photos: [] });
  const pushes = await Promise.all(Array.from({ length: 8 }, (_, i) => ops(i % 2 ? A : B, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0100" }, push: { photos: { url: "photo-" + i } } }])));
  const s100 = await db.collection("snags").findOne({ id: "SNG-0100" });
  check("13. 8 concurrent photo appends: all 8 photos are present", pushes.every((p) => p.status === 200) && s100.photos.length === 8 && new Set(s100.photos.map((p) => p.url)).size === 8, "photos=" + s100.photos.length);
  check("14. appending touched nothing else on the record", s100.title === "shared" && s100.assignedTo === "U-A" && s100.status === "Open");
  await ops(A, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0100", assignedTo: "U-C" } }]);
  await ops(B, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0100", status: "Closed", closedBy: "U-B" } }]);
  const s100b = await db.collection("snags").findOne({ id: "SNG-0100" });
  check("15. field-level patches from two users keep BOTH changes (A's reassignment and B's close)", s100b.assignedTo === "U-C" && s100b.status === "Closed" && s100b.photos.length === 8);
  r = await ops(A, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0100" }, push: { title: { x: 1 } } }]);
  check("16. a push to a field that may not be appended to is refused (400)", r.status === 400);
  r = await ops(A, [{ op: "upsert", coll: "snags", rec: { id: "SNG-0100", photos: [] }, push: { photos: { url: "x" } } }]);
  check("17. setting and pushing the same field in one op is refused (400)", r.status === 400);
  r = await ops(ADMIN, [{ op: "upsert", coll: "users", rec: { id: "U-A" }, push: { photos: { url: "x" } } }]);
  check("18. push on any other collection is refused (400)", r.status === 400);
  r = await ops(A, [{ op: "upsert", coll: "snags", create: true, rec: { id: "SNG-0330", projectId: "P1", title: "created with a first photo" }, push: { photos: { url: "first" } } }]);
  check("19. a create can carry its first photo", r.status === 200 && (await db.collection("snags").findOne({ id: "SNG-0330" })).photos.length === 1);

  console.log("--- restore and reset");
  await db.collection("caseStudies").insertOne({ id: "CS-0001", title: "newer data", createdAt: Date.now() });
  await db.collection("columnMaster").insertOne({ id: "COL-0001", projectId: "P1", name: "Column 1" });
  await db.collection("backups").insertOne({ id: "BK-OLD", createdAt: 1, createdBy: "x", collections: { projects: [{ id: "P1", code: "P1", name: "Tower One", active: true }], users: [{ id: "U-ADMIN", name: "Admin", role: "ADMIN", active: true }] }, progress: {} });
  const usersBefore = await db.collection("users").countDocuments();
  r = await call("POST", "/api/backups/BK-OLD/restore", ADMIN);
  check("20. restoring an OLD backup succeeds", r.status === 200, String(r.status));
  check("21. collections the old backup does not contain are KEPT (caseStudies, columnMaster)", (await db.collection("caseStudies").countDocuments()) === 1 && (await db.collection("columnMaster").countDocuments()) === 1);
  check("22. collections it does contain are restored as before (users replaced by the backup's)", (await db.collection("users").countDocuments()) === 1 && usersBefore > 1);
  const safety = await db.collection("backups").find({ createdBy: /^pre-restore:/ }).toArray();
  check("23. the live board was saved first as a pre-restore backup (so the restore can be undone)", safety.length === 1 && (safety[0].collections.users || []).length === usersBefore && (safety[0].collections.snags || []).length > 0);
  const ev = await db.collection("events").find({ action: "RESTORE_BACKUP" }).toArray();
  check("24. the audit event names the safety backup and the collections that were kept", ev.length === 1 && ev[0].detail.includes(safety[0].id) && /caseStudies/.test(ev[0].detail), ev[0] && ev[0].detail.slice(0, 120));
  // undo the restore from the safety backup
  r = await call("POST", "/api/backups/" + safety[0].id + "/restore", ADMIN);
  check("25. restoring the safety backup brings the earlier board back (undo works)", r.status === 200 && (await db.collection("users").countDocuments()) === usersBefore && (await db.collection("snags").countDocuments({ id: "SNG-0500" })) === 1);
  // a FULL backup restores exactly as before: an emptied collection stays emptied
  await call("POST", "/api/backups", ADMIN);   // may not be the route; the next line creates one directly if needed
  const full = await db.collection("backups").find({ createdBy: "U-ADMIN" }).toArray();
  let fullId = full.length ? full[0].id : null;
  if (!fullId) { const { createBackup } = require("./backups.js"); const { COLLECTIONS } = require("./seed.js"); fullId = (await createBackup(db, COLLECTIONS, "synthetic")).id; }
  await db.collection("caseStudies").deleteMany({});
  r = await call("POST", "/api/backups/" + fullId + "/restore", ADMIN, { skipSafetyBackup: true });
  const preCount = await db.collection("backups").countDocuments({ createdBy: /^pre-restore:/ });
  check("26. a complete backup restores as before (the case study deleted after it is back)", r.status === 200 && (await db.collection("caseStudies").countDocuments()) === 1);
  check("27. skipSafetyBackup:true takes no extra backup", preCount === 2, "pre-restore backups: " + preCount);
  r = await call("POST", "/api/reset", ADMIN, { mode: "blank" });
  check("28. a reset first saves the live board as a pre-reset backup", r.status === 200 && (await db.collection("backups").countDocuments({ createdBy: /^pre-reset:/ })) === 1);
  const resetBackup = await db.collection("backups").findOne({ createdBy: /^pre-reset:/ });
  check("29. that backup contains the data the reset wiped", (resetBackup.collections.snags || []).length > 0);

  console.log("--- VMS records deleted in QC stay deleted");
  const { syncVmsDpr } = require("./syncVmsDpr.js");
  const { handleVmsDprSync } = require("./vmsDprApiHandler.js");
  await db.collection("projects").insertOne({ id: "P1", code: "P1", name: "Tower One", active: true });
  const src = client.db("vbp");
  await src.collection("projects").insertOne({ code: "P1" });
  await src.collection("dailyprogressreports").insertMany([
    { projectName: "Tower One", date: "2026-10-27", vendorCode: "V1", vendorName: "Vendor", shiftType: "Day", labourCount: 5, workEntries: [], driName: "x" },
    { projectName: "Renamed In VMS", date: "2026-10-27", vendorCode: "V2", vendorName: "Vendor 2", shiftType: "Day", labourCount: 3, workEntries: [], driName: "y" }]);
  const run1 = await syncVmsDpr(db, src);
  const vmsId = (await db.collection("dpr").findOne({}, { projection: { id: 1 } })).id;
  check("30. first sync imports the matching report and names the unmatched project", run1.inserted === 1 && run1.skippedUnmatchedProjects[0] === "Renamed In VMS");
  const unmatchedRec = await db.collection("meta").findOne({ _id: "vms-dpr-unmatched" });
  check("31. the unmatched project is recorded (meta vms-dpr-unmatched) instead of only a console line", !!unmatchedRec && unmatchedRec.projects[0] === "Renamed In VMS" && unmatchedRec.skippedReports === 1);
  r = await ops(ADMIN, [{ op: "delete", coll: "dpr", id: vmsId }]);
  const run2 = await syncVmsDpr(db, src);
  check("32. an admin deletes the imported report; the next sync does NOT bring it back", r.status === 200 && run2.inserted === 0 && (await db.collection("dpr").countDocuments({ id: vmsId })) === 0);
  const push = await handleVmsDprSync({ id: vmsId, projectId: "P1", date: "2026-10-27", vendorCode: "V1", shift: "Day", labourCount: 5 }, db);
  check("33. VMS's live push of the same deleted report is acknowledged but not re-created", push.status === 200 && push.body.created === false && (await db.collection("dpr").countDocuments({ id: vmsId })) === 0);
  const fresh = await handleVmsDprSync({ id: "DPR-VMS-brandnew1", projectId: "P1", date: "2026-10-28", vendorCode: "V1", shift: "Day", labourCount: 2 }, db);
  check("34. a different, new VMS report is still imported normally", fresh.body.created === true);
  await db.collection("dpr").insertOne({ id: "DPR-LOCAL-1", projectId: "P1" });
  r = await ops(ADMIN, [{ op: "delete", coll: "dpr", id: "DPR-LOCAL-1" }]);
  check("35. deleting a QC-made record leaves no tombstone", r.status === 200 && (await db.collection("meta").countDocuments({ _id: "tomb:DPR-LOCAL-1" })) === 0);

  console.log("--- team report generation cannot overwrite a sign-off");
  await db.collection("users").insertMany([{ id: "U-A", name: "User A", role: "CIVIL", teamId: "T1", active: true }, { id: "U-B", name: "User B", role: "CIVIL", teamId: "T1", active: true }]);
  await db.collection("teams").insertOne({ id: "T1", name: "Team", leaderId: "U-A", active: true });
  const gens = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const q = http.request({ host: "127.0.0.1", port: PORT, method: "GET", path: "/api/team-reports/generate", agent: false, headers: { "x-cron-secret": "cron-secret-synthetic" } }, (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString() })); });
    q.on("error", reject); q.end();
  })));
  check("36. 6 concurrent report-generation calls all succeed and produce exactly one report per team/day", gens.every((g) => g.status === 200) && (await db.collection("teamDailyReports").countDocuments({ teamId: "T1" })) === 1, JSON.stringify(tally(gens)));

  await db.collection("events").deleteMany({}); await db.collection("eventsArchive").deleteMany({});
  await db.collection("events").insertMany(Array.from({ length: 4990 }, (_, i) => ({ ts: 100 + i, userId: "U", action: "A", targetId: "", stageId: "", detail: "d" })));
  await Promise.all(Array.from({ length: 40 }, (_, i) => ops(ADMIN, [{ op: "event", ev: { ts: 100000 + i, userId: "U-ADMIN", action: "L" + i, targetId: "", stageId: "", detail: "d" } }])));
  const live2 = await db.collection("events").countDocuments(), arch2 = await db.collection("eventsArchive").countDocuments();
  check("50. 40 parallel saves at the cap leave EXACTLY 5000 live events (no over-trim) and archive exactly the 30 beyond it", live2 === 5000 && arch2 === 30, "live=" + live2 + " archived=" + arch2);
  check("51. the newest events are the ones kept", (await db.collection("events").countDocuments({ ts: { $gte: 100000 } })) === 40 && (await db.collection("events").find({}).sort({ ts: 1 }).limit(1).toArray())[0].ts === 130);

  console.log("--- permission grants are saved per module");
  await ops(ADMIN, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", userId: "U1", grants: { masters: { view: true }, dpr: { view: true }, snags: { view: true } } } }]);
  const gp = await Promise.all([
    ops(ADMIN, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", "grants.masters": { view: true, edit: true } } }]),
    ops(ADMIN, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", "grants.dpr": { view: false } } }]),
    ops(ADMIN, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", "grants.snags": null } }]),
    ops(ADMIN, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", "grants.work": { view: true } } }])]);
  const mg = await db.collection("moduleGrants").findOne({ id: "MG-U1" });
  check("37. four admins change four DIFFERENT modules of one user at once: all four changes are kept", gp.every((g) => g.status === 200) && mg.grants.masters.edit === true && mg.grants.dpr.view === false && !("snags" in mg.grants) && mg.grants.work.view === true, JSON.stringify(mg.grants));
  check("38. no literal dotted field was stored; the record keeps its other fields", !Object.keys(mg).some((k) => k.includes(".")) && mg.userId === "U1");
  r = await ops(A, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U1", "grants.masters": { view: true, edit: true, delete: true } } }]);
  check("39. changing grants still requires an admin (403 for anyone else)", r.status === 403, String(r.status));

  console.log("--- deleted records are archived (main's trash) and an admin can list/restore them; audit archive (EVENTS_ARCHIVE_DAYS on)");
  await db.collection("snags").insertOne({ id: "SNG-DEL1", projectId: "P1", title: "to be deleted", status: "Open" });
  r = await ops(ADMIN, [{ op: "delete", coll: "snags", id: "SNG-DEL1" }]);
  const kept = await db.collection("trash").findOne({ originalColl: "snags", "doc.id": "SNG-DEL1" });
  check("40. an admin delete archives the record in trash first, with who/when", r.status === 200 && kept && kept.doc.title === "to be deleted" && kept.deletedBy === "U-ADMIN" && kept.deletedAt > 0);
  const lst = await call("GET", "/api/deleted", ADMIN);
  check("41. the admin can list it", lst.status === 200 && lst.json.deleted.some((d) => d.originalColl === "snags" && d.doc.id === "SNG-DEL1" && d.doc.title === "to be deleted"));
  check("42. a non-admin cannot list or restore", (await call("GET", "/api/deleted", A)).status === 403 && (await call("POST", "/api/deleted/restore", A, { coll: "snags", id: "SNG-DEL1" })).status === 403);
  r = await call("POST", "/api/deleted/restore", ADMIN, { coll: "snags", id: "SNG-DEL1" });
  check("43. restore puts the record back exactly and removes it from trash", r.status === 200 && (await db.collection("snags").findOne({ id: "SNG-DEL1" })).title === "to be deleted" && !(await db.collection("trash").findOne({ "doc.id": "SNG-DEL1" })));
  await ops(ADMIN, [{ op: "delete", coll: "snags", id: "SNG-DEL1" }]); await db.collection("snags").insertOne({ id: "SNG-DEL1", title: "re-created" });
  r = await call("POST", "/api/deleted/restore", ADMIN, { coll: "snags", id: "SNG-DEL1" });
  check("44. restore never overwrites: 409 if the id exists again", r.status === 409 && (await db.collection("snags").findOne({ id: "SNG-DEL1" })).title === "re-created");
  await db.collection("users").insertOne({ id: "USR-DEL", name: "Gone", email: "gone@x.test", passwordHash: "h", passwordSalt: "s" });
  await ops(ADMIN, [{ op: "delete", coll: "users", id: "USR-DEL" }]);
  r = await call("POST", "/api/deleted/restore", ADMIN, { coll: "users", id: "USR-DEL" });
  check("45. a deleted user can be restored from trash (the archived copy is the whole record)", r.status === 200 && (await db.collection("users").countDocuments({ id: "USR-DEL" })) === 1);
  await db.collection("projects").insertOne({ id: "PD", code: "PD", name: "Doomed" });
  await db.collection("floors").insertOne({ id: "FD1", projectId: "PD" }); await db.collection("units").insertOne({ id: "UD1", projectId: "PD", floorId: "FD1" });
  r = await ops(ADMIN, [{ op: "delete", coll: "projects", id: "PD" }]);
  check("46. deleting a PROJECT archives it and its cascade (floors, units) in trash", r.status === 200 && (await db.collection("trash").countDocuments({ originalColl: "projects", "doc.id": "PD" })) === 1 && (await db.collection("trash").countDocuments({ originalColl: "floors", "doc.id": "FD1" })) === 1 && (await db.collection("trash").countDocuments({ originalColl: "units", "doc.id": "UD1" })) === 1 && (await db.collection("floors").countDocuments({ projectId: "PD" })) === 0);
  await db.collection("events").deleteMany({}); await db.collection("eventsArchive").deleteMany({});
  await db.collection("events").insertMany(Array.from({ length: 5012 }, (_, i) => ({ ts: 1000 + i, userId: "U", action: "A" + i, targetId: "", stageId: "", detail: "d" })));
  r = await ops(ADMIN, [{ op: "event", ev: { ts: 9999999, userId: "U-ADMIN", action: "NEWEST", targetId: "", stageId: "", detail: "d" } }]);
  const live = await db.collection("events").countDocuments(), arch = await db.collection("eventsArchive").find({}).sort({ ts: 1 }).toArray();
  check("47. the live audit log is still trimmed to its 5000 newest (retention of the live log unchanged)", r.status === 200 && live === 5000, "live=" + live);
  check("48. the 13 trimmed events are MOVED to eventsArchive (oldest first), not deleted, each with an expiry", arch.length === 13 && arch[0].ts === 1000 && arch[12].ts === 1012 && arch.every((e) => e.expireAt > new Date()), "archived=" + arch.length);
  check("49. none of the archived events is still in the live log", (await db.collection("events").countDocuments({ ts: { $lte: 1012 } })) === 0);

  srv.kill(); await client.close(); await mms.stop();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  if (fails) console.log(slog.split("\n").slice(-15).join("\n"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
