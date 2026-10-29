/* QC -> VMS copy of Daily Progress Reports (the reverse of syncVmsDpr.js / VMS's own syncToQc.js).

   WHY: a DPR filed on QC only ever lived in QC's `dpr` collection; VMS's Daily Progress Report page reads its own
   `dailyprogressreports` collection, so it never showed. VMS -> QC already existed; this adds the other direction.

   SAFETY (this writes to the VMS database, so it is built to be unable to hurt a QC submission):
   - OFF unless QC_TO_VMS_DPR=1 (and SOURCE_MONGO_URI set). Nothing here runs otherwise.
   - the live hook is fire-and-forget AFTER the DPR is already saved: it is never awaited by the request, has short
     database timeouts, and every failure is swallowed and logged. A VMS outage can only mean "not copied yet".
   - INSERT-ONLY: never updates or deletes anything in VMS. The VMS document gets a deterministic _id derived from the QC
     id, so a retry / a race with the reconcile pass can only hit a duplicate-key error (= already there), never double-insert.
   - ECHO-PROOF: the copy carries qcId; syncVmsDpr.js skips VMS reports that have one, so it is never imported back into QC.
   - only DPRs that QC made itself (ids not starting with DPR-VMS-) are copied; a QC project with no matching VMS project
     (matched by project code, then by name) is skipped, not guessed.
   - edits/deletes in QC are NOT propagated (a DPR is not editable after submission in either app).
   - the optional reconcile pass copies QC DPRs dated on/after QC_TO_VMS_DPR_SINCE (YYYY-MM-DD) that are missing in VMS;
     without that variable nothing old is ever copied. Dry run is the default of the CLI at the bottom. */
const { MongoClient, ObjectId } = require("mongodb");
const crypto = require("crypto");

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const isEnabled = (env = process.env) => env.QC_TO_VMS_DPR === "1" && !!env.SOURCE_MONGO_URI;

/* Same QC id -> same VMS _id, always (12 bytes of a hash). Makes the insert idempotent without any index on VMS. */
function vmsIdFor(qcId) {
  return new ObjectId(crypto.createHash("sha1").update("qc-dpr:" + String(qcId)).digest().subarray(0, 12));
}

const photo = (p) => ({ name: String((p && (p.publicId || p.name)) || ""), url: String(p.url) });
const photos = (list) => (Array.isArray(list) ? list.filter((p) => p && typeof p.url === "string" && p.url).map(photo) : []);

/* PURE. qcProjects: [{id, code, name}], vmsProjects: [{_id, code, name}]. -> {ok:true, doc} | {ok:false, reason} */
function mapQcDprToVms(dpr, { qcProjects = [], vmsProjects = [] } = {}) {
  if (!dpr || typeof dpr !== "object" || !dpr.id) return { ok: false, reason: "no-id" };
  if (String(dpr.id).startsWith("DPR-VMS-")) return { ok: false, reason: "vms-origin" };
  const qcProject = qcProjects.find((p) => p.id === dpr.projectId);
  const code = qcProject && qcProject.code ? norm(qcProject.code) : "";
  const name = norm(dpr.projectName || (qcProject && qcProject.name));
  const vmsProject = (code && vmsProjects.find((p) => norm(p.code) === code)) || (name && vmsProjects.find((p) => norm(p.name) === name)) || null;
  if (!vmsProject) return { ok: false, reason: "no-matching-vms-project" };
  if (!dpr.vendorCode) return { ok: false, reason: "no-vendor-code" };
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(dpr.date || ""))) return { ok: false, reason: "bad-date" };
  const date = new Date(String(dpr.date).slice(0, 10) + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime())) return { ok: false, reason: "bad-date" };
  const labour = Number(dpr.labourCount);
  if (!Number.isFinite(labour) || labour < 0) return { ok: false, reason: "bad-labour-count" };
  const now = new Date();
  return {
    ok: true,
    doc: {
      _id: vmsIdFor(dpr.id),
      projectId: vmsProject._id,
      projectName: vmsProject.name || dpr.projectName || "",
      driUserId: null,
      driName: String(dpr.submittedByName || "").trim() || "QC user",
      date,
      vendorCode: String(dpr.vendorCode),
      vendorName: String(dpr.vendorName || ""),
      shiftType: dpr.shift === "Night" ? "Night" : "Day",
      labourCount: labour,
      workEntries: (Array.isArray(dpr.workEntries) ? dpr.workEntries : []).map((w) => ({
        workType: String((w && w.category) || "Other"),
        images: photos(w && w.generalPhotos),
        beforeImages: photos(w && w.beforePhotos),
        afterImages: photos(w && w.afterPhotos)
      })),
      submittedBy: null,
      isPublicSubmission: !!dpr.isPublic,
      qcId: String(dpr.id), // marks it as QC-made: the VMS->QC sync skips it (no echo)
      source: "qc",
      createdAt: now,
      updatedAt: now,
      __v: 0
    }
  };
}

/* The copier. getQcProjects()/getVmsDb() are injected so it can be tested; every method resolves, none throws. */
function createPusher({ getQcProjects, getVmsDb, log = console, projectCacheMs = 10 * 60 * 1000, now = () => Date.now() }) {
  let cache = null; // { at, vmsProjects }
  async function vmsProjectsOf(db) {
    if (cache && now() - cache.at < projectCacheMs) return cache.vmsProjects;
    const rows = await db.collection("projects").find({}, { projection: { code: 1, name: 1 } }).toArray();
    cache = { at: now(), vmsProjects: rows };
    return rows;
  }
  /* -> "pushed" | "exists" | "skipped:<reason>" | "error:<message>" | "disabled" */
  async function push(dpr, { dryRun = false } = {}) {
    try {
      const vmsDb = await getVmsDb();
      if (!vmsDb) return "disabled";
      const mapped = mapQcDprToVms(dpr, { qcProjects: await getQcProjects(), vmsProjects: await vmsProjectsOf(vmsDb) });
      if (!mapped.ok) return "skipped:" + mapped.reason;
      const col = vmsDb.collection("dailyprogressreports");
      if (await col.findOne({ _id: mapped.doc._id }, { projection: { _id: 1 } })) return "exists"; // _id is derived from the QC id: indexed, and the only identity needed
      if (dryRun) return "pushed"; // "would push"
      try { await col.insertOne(mapped.doc); }
      catch (e) { if (e && e.code === 11000) return "exists"; throw e; }
      return "pushed";
    } catch (e) {
      return "error:" + String((e && e.message) || e).slice(0, 200);
    }
  }
  /* Copies QC DPRs dated >= since that VMS does not have yet. -> counts only (never content). */
  async function reconcile(qcDb, { since, limit = 300, dryRun = false } = {}) {
    const out = { checked: 0, pushed: 0, exists: 0, skipped: 0, errors: 0 };
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since || ""))) return { ...out, note: "QC_TO_VMS_DPR_SINCE not set — nothing old is copied" };
      const vmsDb = await getVmsDb();
      if (!vmsDb) return { ...out, note: "disabled" };
      const rows = await qcDb.collection("dpr").find({ date: { $gte: since }, id: { $not: /^DPR-VMS-/ } }, { projection: { _id: 0 } }).sort({ date: 1 }).limit(limit).toArray();
      out.checked = rows.length;
      const have = new Set((await vmsDb.collection("dailyprogressreports").find({ _id: { $in: rows.map((r) => vmsIdFor(r.id)) } }, { projection: { qcId: 1 } }).toArray()).map((r) => r.qcId));
      for (const dpr of rows) {
        if (have.has(dpr.id)) { out.exists++; continue; }
        const r = await push(dpr, { dryRun });
        if (r === "pushed") out.pushed++; else if (r === "exists") out.exists++; else if (r.startsWith("skipped")) out.skipped++; else out.errors++;
      }
    } catch (e) { out.errors++; out.note = "error: " + String((e && e.message) || e).slice(0, 160); }
    return out;
  }
  return { push, reconcile };
}

/* The real VMS connection: its own small client with SHORT timeouts, so a slow/unreachable VMS can never pile up work. */
let vmsClient = null, vmsConnecting = null;
async function getVmsDb(env = process.env) {
  if (!env.SOURCE_MONGO_URI) return null;
  if (!vmsClient) {
    vmsClient = new MongoClient(env.SOURCE_MONGO_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 15000, maxPoolSize: 3 });
    vmsConnecting = vmsClient.connect();
    vmsConnecting.catch(() => { vmsClient = null; vmsConnecting = null; }); // try again next time
  }
  await vmsConnecting;
  return vmsClient.db("vbp");
}

module.exports = { isEnabled, mapQcDprToVms, vmsIdFor, createPusher, getVmsDb };

/* CLI:  node qcToVmsDpr.js --since 2026-10-01 [--apply]
   Default is a DRY RUN: prints how many QC DPRs would be copied (counts only, no content) and writes nothing. Needs
   MONGODB_URI (+MONGODB_DB) for QC and SOURCE_MONGO_URI for VMS in the environment (.env is loaded if present). */
if (require.main === module) {
  (async () => {
    try { require("dotenv").config(); } catch {}
    const args = process.argv.slice(2);
    const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : process.env.QC_TO_VMS_DPR_SINCE;
    const apply = args.includes("--apply");
    if (!process.env.MONGODB_URI || !process.env.SOURCE_MONGO_URI) { console.error("MONGODB_URI and SOURCE_MONGO_URI must be set"); process.exit(2); }
    const qc = await new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }).connect();
    const qcDb = qc.db(process.env.MONGODB_DB || undefined);
    const pusher = createPusher({ getQcProjects: () => qcDb.collection("projects").find({}, { projection: { _id: 0, id: 1, code: 1, name: 1 } }).toArray(), getVmsDb: () => getVmsDb() });
    const res = await pusher.reconcile(qcDb, { since, limit: 5000, dryRun: !apply });
    console.log((apply ? "APPLIED" : "DRY RUN (nothing written)") + " " + JSON.stringify(res));
    await qc.close(); process.exit(0);
  })().catch((e) => { console.error(e && e.message); process.exit(1); });
}
