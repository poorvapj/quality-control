/* Periodic incremental sync: pulls any VMS daily-progress-report that
   doesn't exist in QC yet (matched by the same "DPR-VMS-<mongo _id>" id
   the original one-time migration used) and inserts it, mapped to QC's
   own DailyProgressReport shape. Never touches/overwrites existing docs —
   additive only. Silently no-ops if SOURCE_MONGO_URI isn't configured, so
   environments without VMS access (e.g. local dev) aren't affected.

   This is now the RECONCILIATION / RETRY safety net, not the primary sync
   path — VMS pushes each DPR into QC live at submission time
   (VENDOR-BILLING-PORTAL-NEW/Backend/src/utils/syncToQc.js, wired from
   dailyProgressReportController.js), using the exact same "DPR-VMS-<id>"
   id and an existing-id check before insert. Both paths are therefore
   safe to run concurrently (idempotent, additive-only) — this one exists
   to catch anything the live push missed (QC was briefly unreachable, a
   project wasn't mapped yet at submission time, etc.), the same role the
   one-time bulk backfill script (scripts/vms-to-qc-migrate.js in the VMS
   repo) already played for historical data. Its field mapping is kept in
   lock-step with syncToQc.js's — do not let the two drift apart again
   (see the beforePhotos/afterPhotos note below, which used to drop real
   photos whenever this path happened to be the one that inserted a
   record, since VMS's `beforeImages`/`afterImages` were never read). */
const { MongoClient } = require("mongodb");

let cachedSourceClient = null;
async function getSourceDb() {
  if (!process.env.SOURCE_MONGO_URI) return null;
  if (!cachedSourceClient) {
    cachedSourceClient = new MongoClient(process.env.SOURCE_MONGO_URI);
    await cachedSourceClient.connect();
  }
  return cachedSourceClient.db("vbp");
}

const norm = (s) => String(s || "").trim().toLowerCase();

// Extracted as its own pure function so it's unit-testable without a real
// Mongo connection (see syncVmsDpr.test.js) — exact same mapping syncToQc.js
// (the VMS-side live push) uses.
function mapWorkEntry(we) {
  return {
    category: we.workType || we.category || "Other",
    generalPhotos: (we.images || []).filter((p) => p && p.url).map((p) => ({ url: p.url, publicId: p.publicId || null })),
    beforePhotos: (we.beforeImages || []).filter((p) => p && p.url).map((p) => ({ url: p.url, publicId: p.publicId || null })),
    afterPhotos: (we.afterImages || []).filter((p) => p && p.url).map((p) => ({ url: p.url, publicId: p.publicId || null })),
    ...(typeof we.qty === "number" ? { qty: we.qty } : {}),
    ...(we.unit ? { unit: we.unit } : {})
  };
}

// `sourceDbOverride` is test-only dependency injection (see
// syncVmsDpr.test.js) so the full matching/dedup pipeline is verifiable
// without a real VMS Mongo connection — production callers never pass it.
async function syncVmsDpr(mongoDb, sourceDbOverride) {
  const sourceDb = sourceDbOverride || await getSourceDb();
  if (!sourceDb) return { skipped: true };

  const [vmsReports, vmsProjects, qcProjects, qcUsers, existingIds] = await Promise.all([
    sourceDb.collection("dailyprogressreports").find({}, {
      projection: { projectId: 1, projectName: 1, date: 1, vendorCode: 1, vendorName: 1, shiftType: 1, labourCount: 1, workEntries: 1, driName: 1, isPublicSubmission: 1 }
    }).toArray(),
    sourceDb.collection("projects").find({}, { projection: { id: 1, code: 1 } }).toArray(),
    mongoDb.collection("projects").find({}, { projection: { id: 1, name: 1, code: 1 } }).toArray(),
    mongoDb.collection("users").find({}, { projection: { id: 1, name: 1 } }).toArray(),
    mongoDb.collection("dpr").find({}, { projection: { id: 1 } }).toArray()
  ]);
  const existing = new Set(existingIds.map((d) => d.id));
  // Projects are matched by `code` (PRJ-xxx) first — the one field VMS and
  // QC's project records reliably share even when a project's display name
  // has diverged between the two apps (e.g. VMS's "Regal Garden Villa -
  // West Gate" vs QC's "West Gate", both code PRJ-011) — name-matching
  // alone silently and permanently dropped every report for any such
  // project. Name match stays as a fallback for anything with no VMS
  // project record or no code set on either side.
  const vmsProjectIdToCode = new Map(vmsProjects.map((p) => [String(p._id), norm(p.code)]));
  const qcProjectByCode = new Map(qcProjects.filter((p) => p.code).map((p) => [norm(p.code), p.id]));
  const projectByName = new Map(qcProjects.map((p) => [norm(p.name), p.id]));
  const userByName = new Map(qcUsers.map((u) => [norm(u.name), u.id]));

  const toInsert = [];
  const unmatchedProjects = new Set();
  for (const r of vmsReports) {
    const id = "DPR-VMS-" + r._id;
    if (existing.has(id)) continue;

    const vmsCode = r.projectId ? vmsProjectIdToCode.get(String(r.projectId)) : null;
    const projectId = (vmsCode && qcProjectByCode.get(vmsCode)) || projectByName.get(norm(r.projectName));
    if (!projectId) { unmatchedProjects.add(r.projectName); continue; }
    const submittedByUserId = userByName.get(norm(r.driName)) || null;

    toInsert.push({
      id,
      projectId,
      projectName: r.projectName || "",
      date: r.date,
      vendorCode: r.vendorCode || "",
      vendorName: r.vendorName || "",
      shift: r.shiftType || "Day",
      labourCount: Number(r.labourCount) || 0,
      workEntries: (r.workEntries || []).map(mapWorkEntry),
      submittedByUserId,
      submittedByName: r.driName || "",
      isPublic: !!r.isPublicSubmission
    });
  }

  let insertedCount = toInsert.length;
  if (toInsert.length > 0) {
    try {
      // unordered: a duplicate-id race against VMS's own live push
      // (syncToQc.js) must not abort the rest of this batch — ordered
      // (the default) stops at the first failing document, silently
      // dropping every record after it in `toInsert` even though they're
      // genuinely new and unrelated to the one that raced.
      await mongoDb.collection("dpr").insertMany(toInsert, { ordered: false });
    } catch (err) {
      // code 11000 = duplicate key — exactly the race this comment
      // describes: the live push inserted the same "DPR-VMS-<id>" between
      // this function's own existing-id check and this insert. Benign:
      // the record is in QC either way. Anything else is a real failure
      // and must still surface.
      if (err.code !== 11000 && !(err.writeErrors || []).every((e) => e.code === 11000)) throw err;
      const duplicates = err.writeErrors ? err.writeErrors.length : toInsert.length;
      insertedCount = toInsert.length - duplicates;
    }
  }
  return {
    inserted: insertedCount,
    skippedUnmatchedProjects: unmatchedProjects.size ? Array.from(unmatchedProjects) : undefined
  };
}

module.exports = { syncVmsDpr, mapWorkEntry };
