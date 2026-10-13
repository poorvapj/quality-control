/* Lightweight, non-financial VMS Work Order structure — project/work order/
   work item descriptions only (no rate, no amount, no billing), for the
   Work Quality Inspection form's Project -> Work Order -> Item pickers.
   Deliberately a SEPARATE, less-sensitive read than
   executionReconciliation.js's getExecutionReconciliation() (which is
   admin-only because it exposes rate/billed-value data) — any signed-in
   user authorized to log an inspection should be able to pick a real
   work item without needing admin/financial access. Same SOURCE_MONGO_URI
   connection, same "vbp" database, read-only. */
const { MongoClient } = require("mongodb");
// Reused, not re-derived — "executed quantity" must mean exactly the same
// thing here (Unit Execution Workflow's picker) as it does in Execution
// Reconciliation, or the two pages would silently disagree with each other.
const { activeQty, distinctLocations } = require("./executionReconciliation.js");

let cachedClient = null;
async function getVmsDb() {
  if (!process.env.SOURCE_MONGO_URI) return null;
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.SOURCE_MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("vbp");
}

function itemSummary(item, itemType, parentItemId) {
  return {
    itemId: String(item._id), itemType, parentItemId: parentItemId || null,
    description: item.description || "", unit: item.unit || "",
    // Quantity only — no rate/amount here, this endpoint stays non-financial.
    plannedQty: Number(item.plannedQty) || 0,
    executedQty: activeQty(item.progressEntries),
    locations: distinctLocations(item.progressEntries)
  };
}

// `vmsDbOverride` is test-only dependency injection (same pattern used by
// syncVmsDpr.js/executionReconciliation.js) — production callers never pass it.
async function getVmsWorkItems(vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured" };

  const [workOrders, vmsProjects] = await Promise.all([
    vmsDb.collection("workorders").find({}, { projection: { workOrderNo: 1, projectId: 1, projectName: 1, scopeItems: 1 } }).toArray(),
    vmsDb.collection("projects").find({}, { projection: { code: 1, name: 1 } }).toArray()
  ]);
  const projectCodeById = new Map(vmsProjects.map((p) => [String(p._id), p.code || ""]));

  const byProject = new Map(); // projectCode -> { projectCode, projectName, workOrders: Map<workOrderNo, items[]> }
  for (const wo of workOrders) {
    const projectCode = projectCodeById.get(String(wo.projectId)) || "";
    if (!projectCode) continue; // unmapped VMS project — nothing reliable to key this work order to on QC's side
    if (!byProject.has(projectCode)) byProject.set(projectCode, { projectCode, projectName: wo.projectName || "", workOrders: [] });
    const items = [];
    for (const si of wo.scopeItems || []) {
      items.push(itemSummary(si, "scopeItem"));
      for (const sub of si.subItems || []) items.push(itemSummary(sub, "subItem", String(si._id)));
    }
    byProject.get(projectCode).workOrders.push({ workOrderNo: wo.workOrderNo || "", items });
  }

  return { available: true, projects: Array.from(byProject.values()) };
}

module.exports = { getVmsWorkItems };
