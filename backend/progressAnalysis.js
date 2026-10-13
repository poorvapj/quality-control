/* Read-only VMS progress analysis — project-wise/work-order-wise planned vs
   completed quantity, variance/sign-off status, and billing-link status per
   location, drawn directly from VMS's own stored fields (confirmed against
   VMS's actual source this session — Backend/src/models/WorkOrder.js and
   workOrderController.js/billRequestController.js — never guessed):
     - scopeItem/subItem.plannedQty, .completedQty — real stored Numbers,
       written by VMS's own controllers via sumActiveQty(progressEntries)
       each time progress changes. We read them as-is rather than
       re-deriving, since VMS is the system of record for this number.
     - scopeItem/subItem.varianceApproved/.varianceApprovedBy/
       .varianceApprovedAt/.varianceApprovedAtQty — the AGM/GM sign-off
       VMS requires before an over-planned item can be billed.
     - progressEntry.billedInRequestId — set once an entry is pulled into a
       BillRequest; null/absent means that entry's qty is still unbilled.
   Deliberately non-financial — no rate/amount is read or exposed here
   (that stays in executionReconciliation.js, which is admin-gated); any
   signed-in session may read this, same level as vmsWorkItems.js. */
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

function activeEntries(entries) {
  return (entries || []).filter((e) => !(e.invalidated && e.invalidated.done));
}

function locationKey(e) {
  return [e.tower, e.floor, e.flatNo, e.plotNo].filter(Boolean).join(" / ") || "Unspecified";
}

// Splits an item's active progress entries into a location-wise breakdown,
// each location further split into billed vs unbilled qty via the entry's
// own billedInRequestId — never a guess, that field is VMS's own billing
// link, set exactly once a RunningBill/BillRequest actually includes it.
function locationBreakdown(entries) {
  const active = activeEntries(entries);
  const byLocation = new Map();
  for (const e of active) {
    const key = locationKey(e);
    // tower/floor/flatNo/plotNo are VMS's own separate fields on the entry —
    // returned alongside the joined `location` label (additive; the label is
    // unchanged) so the frontend can filter by tower/floor/unit exactly
    // instead of parsing the joined string.
    if (!byLocation.has(key)) byLocation.set(key, {
      location: key, qty: 0, billedQty: 0, unbilledQty: 0,
      tower: e.tower || "", floor: e.floor || "", flatNo: e.flatNo || "", plotNo: e.plotNo || ""
    });
    const row = byLocation.get(key);
    const qty = Number(e.qtyAdded) || 0;
    row.qty += qty;
    if (e.billedInRequestId) row.billedQty += qty;
    else row.unbilledQty += qty;
  }
  return Array.from(byLocation.values());
}

function itemSummary(item, itemType, parentItemId, usersById) {
  const plannedQty = Number(item.plannedQty) || 0;
  const completedQty = Number(item.completedQty) || 0;
  const locations = locationBreakdown(item.progressEntries);
  const totalBilledQty = locations.reduce((s, l) => s + l.billedQty, 0);
  const totalUnbilledQty = locations.reduce((s, l) => s + l.unbilledQty, 0);
  const approver = item.varianceApprovedBy ? usersById.get(String(item.varianceApprovedBy)) : null;
  return {
    itemId: String(item._id),
    itemType,
    parentItemId: parentItemId || null,
    description: item.description || "",
    unit: item.unit || "",
    plannedQty,
    completedQty,
    // null (not 0) when plannedQty is 0 — a 0-planned item has no
    // meaningful "% of plan", and showing 0% would read as "no progress"
    // when it may really mean "not estimated yet". Frontend renders this
    // as "Data unavailable" rather than fabricating a percentage.
    percentOfPlan: plannedQty > 0 ? Math.round((completedQty / plannedQty) * 1000) / 10 : null,
    varianceFlag: plannedQty > 0 && completedQty > plannedQty,
    varianceApproved: !!item.varianceApproved,
    varianceApprovedByName: approver ? approver.name || approver.email || String(item.varianceApprovedBy) : (item.varianceApprovedBy ? String(item.varianceApprovedBy) : null),
    varianceApprovedAt: item.varianceApprovedAt || null,
    varianceApprovedAtQty: typeof item.varianceApprovedAtQty === "number" ? item.varianceApprovedAtQty : null,
    locations,
    totalBilledQty,
    totalUnbilledQty
  };
}

async function getProgressAnalysis(vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured" };

  const [workOrders, vmsProjects, vmsUsers] = await Promise.all([
    vmsDb.collection("workorders").find({}, {
      projection: {
        workOrderNo: 1, projectId: 1, projectName: 1, scopeItems: 1
      }
    }).toArray(),
    vmsDb.collection("projects").find({}, { projection: { code: 1, name: 1 } }).toArray(),
    vmsDb.collection("users").find({}, { projection: { name: 1, email: 1 } }).toArray()
  ]);
  const projectCodeById = new Map(vmsProjects.map((p) => [String(p._id), p.code || ""]));
  const usersById = new Map(vmsUsers.map((u) => [String(u._id), u]));

  const byProject = new Map();
  for (const wo of workOrders) {
    const projectCode = projectCodeById.get(String(wo.projectId)) || "";
    if (!projectCode) continue;
    if (!byProject.has(projectCode)) byProject.set(projectCode, { projectCode, projectName: wo.projectName || "", workOrders: [] });

    const items = [];
    for (const si of wo.scopeItems || []) {
      items.push(itemSummary(si, "scopeItem", null, usersById));
      for (const sub of si.subItems || []) items.push(itemSummary(sub, "subItem", String(si._id), usersById));
    }
    byProject.get(projectCode).workOrders.push({ workOrderNo: wo.workOrderNo || "", items });
  }

  return { available: true, projects: Array.from(byProject.values()) };
}

module.exports = { getProgressAnalysis, activeEntries, locationKey, locationBreakdown, itemSummary };
