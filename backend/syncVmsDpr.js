/* Periodic incremental sync: pulls any VMS daily-progress-report that
   doesn't exist in QC yet (matched by the same "DPR-VMS-<mongo _id>" id
   the original one-time migration used) and inserts it, mapped to QC's
   own DailyProgressReport shape. Never touches/overwrites existing docs —
   additive only. Silently no-ops if SOURCE_MONGO_URI isn't configured, so
   environments without VMS access (e.g. local dev) aren't affected. */
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

async function syncVmsDpr(mongoDb) {
  const sourceDb = await getSourceDb();
  if (!sourceDb) return { skipped: true };

  const [vmsReports, qcProjects, qcUsers, existingIds] = await Promise.all([
    sourceDb.collection("dailyprogressreports").find({}, {
      projection: { projectName: 1, date: 1, vendorCode: 1, vendorName: 1, shiftType: 1, labourCount: 1, workEntries: 1, driName: 1, isPublicSubmission: 1 }
    }).toArray(),
    mongoDb.collection("projects").find({}, { projection: { id: 1, name: 1 } }).toArray(),
    mongoDb.collection("users").find({}, { projection: { id: 1, name: 1 } }).toArray(),
    mongoDb.collection("dpr").find({}, { projection: { id: 1 } }).toArray()
  ]);
  const existing = new Set(existingIds.map((d) => d.id));
  const projectByName = new Map(qcProjects.map((p) => [norm(p.name), p.id]));
  const userByName = new Map(qcUsers.map((u) => [norm(u.name), u.id]));

  const toInsert = [];
  const unmatchedProjects = new Set();
  for (const r of vmsReports) {
    const id = "DPR-VMS-" + r._id;
    if (existing.has(id)) continue;

    const projectId = projectByName.get(norm(r.projectName));
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
      workEntries: (r.workEntries || []).map((we) => ({
        category: we.workType,
        generalPhotos: (we.images || []).map((img) => ({ url: img.url, publicId: null })),
        beforePhotos: [],
        afterPhotos: []
      })),
      submittedByUserId,
      submittedByName: r.driName || "",
      isPublic: !!r.isPublicSubmission
    });
  }

  if (toInsert.length > 0) {
    await mongoDb.collection("dpr").insertMany(toInsert);
  }
  return {
    inserted: toInsert.length,
    skippedUnmatchedProjects: unmatchedProjects.size ? Array.from(unmatchedProjects) : undefined
  };
}

module.exports = { syncVmsDpr };
