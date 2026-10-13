/* Read-only list of VMS's own Drawing Requests — used by the generated Daily
   Progress Report so its "Drawing Request Status" table shows exactly what VMS
   shows. QC keeps its OWN copy of these tickets (collection `drawingRequests`)
   with its own review workflow, and nothing syncs the two, so they drift: a
   ticket can sit at "screening" in QC while VMS already has it with the
   architect, and tickets raised in VMS never appear in QC at all. For a report
   that has to match VMS, VMS is the source.

   Same SOURCE_MONGO_URI connection / "vbp" database as the other VMS readers;
   never writes. */
const { MongoClient } = require("mongodb");

let cachedClient = null;
async function getVmsDb() {
  if (!process.env.SOURCE_MONGO_URI) return null;
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.SOURCE_MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("vbp");
}

const toMs = (d) => {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Pure: raw VMS drawing-request docs + VMS projects -> the report's rows. */
function shapeRequests(docs, vmsProjects) {
  const codeById = new Map((vmsProjects || []).map((p) => [String(p._id), p.code || ""]));
  return (docs || [])
    .map((d) => ({
      ticketNo: d.ticketNo || "",
      description: d.description || "",
      projectCode: codeById.get(String(d.projectId)) || "",
      projectName: d.projectName || "",
      driName: d.driName || "",
      reviewStatus: d.reviewStatus || "",
      status: d.status || "",
      createdAt: toMs(d.createdAt)
    }))
    .sort((a, b) => b.createdAt - a.createdAt || b.ticketNo.localeCompare(a.ticketNo));
}

// `vmsDbOverride` is test-only dependency injection — production callers never pass it.
async function getVmsDrawingRequests(vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured", requests: [] };
  const [docs, projects] = await Promise.all([
    vmsDb.collection("drawingrequests").find({}, {
      projection: { ticketNo: 1, projectId: 1, projectName: 1, description: 1, driName: 1, reviewStatus: 1, status: 1, createdAt: 1 }
    }).toArray(),
    vmsDb.collection("projects").find({}, { projection: { code: 1 } }).toArray()
  ]);
  return { available: true, requests: shapeRequests(docs, projects) };
}

module.exports = { getVmsDrawingRequests, shapeRequests };
