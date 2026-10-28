/* Pure request-handling logic for POST /api/integrations/vms/dpr (Phase 2's
   API-based VMS->QC DPR push), extracted out of server.js so it's
   unit-testable (see vmsDprApi.test.js) without a running HTTP server or a
   real Mongo connection — the route in server.js does only auth (shared
   secret) then hands off to this with its own `mongoDb`. Same idempotency
   rule as the direct-DB push and the poller: an existing id is a
   successful no-op, never an error, never an overwrite. */
const REQUIRED_FIELDS = ["id", "projectId", "date", "vendorCode", "shift", "labourCount"];

async function isTombstoned(mongoDb, id) {
  try { return !!(await mongoDb.collection("meta").findOne({ _id: "tomb:" + id }, { projection: { _id: 1 } })); } catch { return false; }
}

async function handleVmsDprSync(body, mongoDb) {
  for (const f of REQUIRED_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === "") {
      return { status: 400, body: { error: `"${f}" is required` } };
    }
  }
  if (!String(body.id).startsWith("DPR-VMS-")) {
    return { status: 400, body: { error: 'id must be in the "DPR-VMS-<sourceId>" form' } };
  }

  // VMS already resolved projectId to one of QC's own project ids (same
  // resolveProject() it's always used, see syncToQc.js) — this just
  // confirms that id is real rather than trusting it blindly, since
  // nothing else validates collection shape on this schemaless backend.
  const project = await mongoDb.collection("projects").findOne({ id: body.projectId });
  if (!project) return { status: 400, body: { error: `projectId "${body.projectId}" is not a known QC project` } };

  const existing = await mongoDb.collection("dpr").findOne({ id: body.id }, { projection: { id: 1 } });
  if (existing) return { status: 200, body: { ok: true, id: body.id, created: false } };
  // deleted in QC on purpose (server.js keeps a tombstone): acknowledge, do not bring it back
  if (await isTombstoned(mongoDb, body.id)) return { status: 200, body: { ok: true, id: body.id, created: false } };

  const doc = {
    id: body.id,
    projectId: body.projectId,
    projectName: body.projectName || project.name || "",
    date: body.date,
    vendorCode: body.vendorCode || "",
    vendorName: body.vendorName || "",
    shift: body.shift === "Night" ? "Night" : "Day",
    labourCount: Number(body.labourCount) || 0,
    workEntries: Array.isArray(body.workEntries) ? body.workEntries : [],
    submittedByUserId: body.submittedByUserId || null,
    submittedByName: body.submittedByName || "",
    isPublic: Boolean(body.isPublic)
  };
  try {
    await mongoDb.collection("dpr").insertOne(doc);
  } catch (e) {
    // A duplicate-key race against the live direct-DB push or the poller
    // landing the same id a moment earlier — benign, same tolerance
    // syncVmsDpr.js's own insertMany already applies (Phase 1).
    if (e.code === 11000) return { status: 200, body: { ok: true, id: body.id, created: false } };
    throw e;
  }
  return { status: 200, body: { ok: true, id: body.id, created: true } };
}

// True only when handleVmsDprSync actually inserted a new record (the caller
// bumps the board revision so open clients pick it up).
function vmsSyncWroteRecord(result) {
  return !!result && result.status === 200 && !!result.body && result.body.created === true;
}

module.exports = { handleVmsDprSync, vmsSyncWroteRecord };
