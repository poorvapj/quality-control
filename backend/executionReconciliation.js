/* Execution & Measurement Reconciliation (Phase A) — read-only aggregation
   over VMS's own Work Order / Running Bill data, reached via the same
   SOURCE_MONGO_URI connection syncVmsDpr.js already uses (same cluster,
   same "vbp" database, just different collections: "workorders" and
   "runningbills" instead of "dailyprogressreports"). Never writes to VMS —
   every query here is a read.

   Per the read-only audit this session: VMS has no separate "quality
   verification" concept at the scope-item/progress-entry level, and QC's
   own quality system (Stage/Checklist/QParam) is unit/floor-scoped and
   purely binary (done/fail), with zero quantity dimension and zero field
   referencing a VMS Work Order or scope item. So "quality-checked
   quantity/value" and "pending quality verification" are NOT computed
   here at all — the frontend renders those as "Data unavailable" by
   design, not because this module forgot to try. */
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

// VMS's own authoritative quantity formula (progressHelpers.js's
// sumActiveQty, confirmed by this session's audit) — a progress entry
// marked invalidated.done must never count, on either side of this app.
function activeQty(entries) {
  return (entries || [])
    .filter((e) => !(e.invalidated && e.invalidated.done))
    .reduce((sum, e) => sum + (Number(e.qtyAdded) || 0), 0);
}

function distinctLocations(entries) {
  const set = new Set();
  for (const e of entries || []) {
    if (e.invalidated && e.invalidated.done) continue;
    const loc = [e.tower, e.floor, e.flatNo, e.plotNo].filter(Boolean).join(" / ");
    if (loc) set.add(loc);
  }
  return Array.from(set);
}

function itemRow({ projectCode, projectName, wo, item, itemType, parentItemId, billedMap }) {
  const executedQty = activeQty(item.progressEntries);
  const rate = Number(item.rate) || 0;
  const executedValue = executedQty * rate;
  const billed = billedMap.get(String(item._id)) || { qty: 0, value: 0 };
  return {
    projectCode, projectName,
    workOrderNo: wo.workOrderNo || "", workOrderId: String(wo._id),
    itemId: String(item._id), itemType, parentItemId: parentItemId || null,
    description: item.description || "", unit: item.unit || "",
    rate,
    // "Measured" is explicitly the SAME figure as "executed" — VMS has no
    // independent measurement step; a progress entry IS the measurement
    // (it carries its own date + location). Never two different numbers.
    executedQty, executedValue,
    measuredQty: executedQty, measuredValue: executedValue,
    billedQty: billed.qty, billedValue: billed.value,
    mapped: true,
    locations: distinctLocations(item.progressEntries)
  };
}

// Same session shape as the rest of server.js's getSession() —
// {userId, isAdmin}. Extracted as its own pure function (see
// executionReconciliation.test.js) so the authorization rule itself is
// unit-testable without spinning up the whole raw-http server.
function requiresAdmin(session) {
  if (!session) return { status: 401, error: "Sign-in required" };
  if (!session.isAdmin) return { status: 403, error: "Admin access required" };
  return null;
}

// `vmsDbOverride` is test-only dependency injection (same pattern as
// syncVmsDpr.js's sourceDbOverride) — production callers never pass it.
async function getExecutionReconciliation(vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured" };

  const [workOrders, runningBills, vmsProjects] = await Promise.all([
    vmsDb.collection("workorders").find({}).toArray(),
    vmsDb.collection("runningbills").find({}).toArray(),
    vmsDb.collection("projects").find({}, { projection: { code: 1, name: 1 } }).toArray()
  ]);

  const projectCodeById = new Map(vmsProjects.map((p) => [String(p._id), p.code || ""]));

  // Every scope-item/sub-item id a real Work Order actually has — anything
  // a RunningBill line references outside this set is, by definition,
  // unmapped (a stale reference, a data-entry slip, or a deleted item) and
  // must be surfaced as such rather than silently dropped or guessed at.
  const knownItemIds = new Set();
  for (const wo of workOrders) {
    for (const si of wo.scopeItems || []) {
      knownItemIds.add(String(si._id));
      for (const sub of si.subItems || []) knownItemIds.add(String(sub._id));
    }
  }

  const billedMap = new Map(); // itemId string -> { qty, value }
  const unmappedBilled = [];
  for (const bill of runningBills) {
    for (const li of bill.lineItems || []) {
      const qty = Number(li.billedQty) || 0;
      // Use the line item's own stored amount (how VMS actually billed it,
      // GST applied only at the whole-bill level per the audit) rather
      // than recomputing qty*rate, which could disagree with what was
      // actually invoiced if a rate was edited after billing.
      const value = typeof li.amount === "number" ? li.amount : qty * (Number(li.rate) || 0);
      const refId = li.subItemId || li.scopeItemId;
      const refIdStr = refId ? String(refId) : null;
      if (refIdStr && knownItemIds.has(refIdStr)) {
        const cur = billedMap.get(refIdStr) || { qty: 0, value: 0 };
        billedMap.set(refIdStr, { qty: cur.qty + qty, value: cur.value + value });
      } else {
        unmappedBilled.push({
          billNo: bill.billNo || "", workOrderNo: bill.workOrderNo || "",
          qty, value, reason: "line item references no known scope item/sub-item"
        });
      }
    }
  }

  const rows = [];
  for (const wo of workOrders) {
    const projectCode = projectCodeById.get(String(wo.projectId)) || "";
    const projectName = wo.projectName || "";
    for (const si of wo.scopeItems || []) {
      rows.push(itemRow({ projectCode, projectName, wo, item: si, itemType: "scopeItem", billedMap }));
      for (const sub of si.subItems || []) {
        rows.push(itemRow({ projectCode, projectName, wo, item: sub, itemType: "subItem", parentItemId: String(si._id), billedMap }));
      }
    }
  }

  return { available: true, generatedAt: Date.now(), rows, unmappedBilled };
}

module.exports = { getExecutionReconciliation, requiresAdmin, activeQty, distinctLocations };
