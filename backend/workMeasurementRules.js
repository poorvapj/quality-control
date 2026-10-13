/* Work Measurement — an independently measured quantity, recorded per
   Project → Tower/Floor/Flat/Area → Work Category, and (where it can be done
   without guessing) linked to the VMS scope item it measures.

   REFERENCE-ONLY. Nothing in this module writes to VMS or to any existing
   QC record. A measurement never changes billing, approvals, quality
   statuses or production (progress) records — the link it stores is just a
   pointer plus a few denormalised labels.

   WHAT THE REAL VMS SCHEMA ALLOWS (read-only inspection of the live "vbp"
   database, not assumed):
     - workorders: projectId, workOrderNo, category (coarse — "Civil / RCC",
       "Painting"…), subCategory (always empty), scopeItems[].
     - scopeItem / subItem: description (free text — this is where the
       fine-grained name like "Plinth Beam" / "Column work" lives), unit,
       plannedQty, progressEntries[]. There is NO category id, and `stage`
       is set on <1% of items for unrelated purposes.
     - progressEntry: date, qtyAdded, tower, floor, flatNo, plotNo,
       locationNote, invalidated{done}. All location fields are free text
       and mostly EMPTY (≈5% of entries have any; `tower` is never set).
     - No `area` field exists — plotNo / locationNote are the closest.
   So category alone can never identify a Work Order (one category spans many
   WOs/vendors, and many items share a description), and location is the
   only thing that can narrow it further. The matcher therefore:
     1. restricts to the project's own work orders,
     2. matches category against the scope-item description first (exact,
        after format-only normalisation); only if nothing matches there does
        it fall back to the work order's coarse category,
     3. keeps an item only if at least one ACTIVE progress entry carries
        every location field the measurement specified, with an equal value,
     4. reports: exactly one item → "unique" (safe to auto-link);
        several → "ambiguous" (a person must choose); none → "none"
        (stays unlinked, with the reason).
   Normalisation is deliberately format-only (case, punctuation, ordinal
   suffixes, the words floor/flat/tower, "first"→1). It is never fuzzy: a
   typo such as "Masonary" does not match "Masonry", because a wrong auto-link
   is worse than no link. */
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

const ORDINAL_WORDS = {
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10"
};
const LOCATION_NOISE = new Set(["floor", "flat", "tower", "unit", "no", "number"]);

function words(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Location value → comparison key: "6th Floor" / "6" / "Sixth floor" → "6". */
function normLocation(s) {
  return words(s)
    .map((w) => ORDINAL_WORDS[w] || w.replace(/^(\d+)(st|nd|rd|th)$/, "$1"))
    .filter((w) => !LOCATION_NOISE.has(w))
    .join(" ");
}

/** Category / description → comparison key (case, punctuation, a trailing
 *  "work"/"works" word). Exact-equality key only — never a fuzzy score. */
function normCategory(s) {
  const w = words(s);
  if (w.length > 1 && (w[w.length - 1] === "work" || w[w.length - 1] === "works")) w.pop();
  return w.join(" ");
}

function normUnit(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const isActive = (e) => !(e && e.invalidated && e.invalidated.done);

/** Whether a progress entry carries every location field the measurement
 *  specified, with an equal value. A field the entry leaves blank is NOT
 *  verified, so the entry doesn't match — blank is never treated as "any". */
function entryMatchesLocation(entry, location) {
  const want = {
    tower: normLocation(location.tower),
    floor: normLocation(location.floor),
    flat: normLocation(location.flat),
    area: normLocation(location.area)
  };
  if (!want.tower && !want.floor && !want.flat && !want.area) return false;
  if (want.tower && normLocation(entry.tower) !== want.tower) return false;
  if (want.floor && normLocation(entry.floor) !== want.floor) return false;
  if (want.flat && normLocation(entry.flatNo) !== want.flat) return false;
  if (want.area && normLocation(entry.plotNo) !== want.area && normLocation(entry.locationNote) !== want.area) return false;
  return true;
}

/** Every scope item / sub-item of the given work orders as a flat candidate
 *  list. Pure — takes raw VMS documents. */
function flattenItems(workOrders) {
  const items = [];
  for (const wo of workOrders) {
    const base = { workOrderNo: wo.workOrderNo || "", workOrderCategory: wo.category || "" };
    for (const si of wo.scopeItems || []) {
      items.push({ ...base, itemId: String(si._id), itemType: "scopeItem", parentItemId: null, description: si.description || "", unit: si.unit || "", plannedQty: Number(si.plannedQty) || 0, entries: si.progressEntries || [] });
      for (const sub of si.subItems || []) {
        items.push({ ...base, itemId: String(sub._id), itemType: "subItem", parentItemId: String(si._id), description: sub.description || "", unit: sub.unit || "", plannedQty: Number(sub.plannedQty) || 0, entries: sub.progressEntries || [] });
      }
    }
  }
  return items;
}

function candidateOf(item, matchedOn, location) {
  const matching = item.entries.filter((e) => isActive(e) && entryMatchesLocation(e, location));
  return {
    workOrderNo: item.workOrderNo,
    workOrderCategory: item.workOrderCategory,
    itemId: item.itemId,
    itemType: item.itemType,
    description: item.description,
    unit: item.unit,
    // The item's full planned quantity (not location-scoped — VMS doesn't
    // break a plan down by location, only progress entries carry a
    // location), shown alongside the executed figure so the person
    // measuring can see the target before filling in the actual value.
    plannedQty: item.plannedQty || 0,
    matchedOn,
    matchedEntryCount: matching.length,
    // Executed quantity VMS recorded AT THIS LOCATION only (VMS's own
    // active-entry rule: invalidated entries never count).
    executedQtyAtLocation: matching.reduce((s, e) => s + (Number(e.qtyAdded) || 0), 0)
  };
}

/** Pure matcher. `items` = flattenItems() of ONE project's work orders.
 *  Returns { status: "unique" | "ambiguous" | "none", candidates, reason? }. */
function matchMeasurement(draft, items) {
  const location = draft.location || {};
  const key = normCategory(draft.category);
  if (!key) return { status: "none", candidates: [], reason: "NO_CATEGORY" };
  if (!normLocation(location.tower) && !normLocation(location.floor) && !normLocation(location.flat) && !normLocation(location.area)) {
    return { status: "none", candidates: [], reason: "NO_LOCATION" };
  }

  let pool = items.filter((i) => normCategory(i.description) === key).map((i) => ({ i, on: "item" }));
  if (pool.length === 0) pool = items.filter((i) => normCategory(i.workOrderCategory) === key).map((x) => ({ i: x, on: "workOrderCategory" }));
  if (pool.length === 0) return { status: "none", candidates: [], reason: "NO_CATEGORY_MATCH" };

  const candidates = pool
    .map(({ i, on }) => candidateOf(i, on === "item" ? "itemDescription" : "workOrderCategory", location))
    .filter((c) => c.matchedEntryCount > 0);
  if (candidates.length === 0) return { status: "none", candidates: [], reason: "NO_LOCATION_MATCH" };
  return { status: candidates.length === 1 ? "unique" : "ambiguous", candidates };
}

/** Executed (VMS) vs measured. Only produces a variance when both sides are
 *  in the same unit — otherwise both numbers are shown and no difference is
 *  computed, rather than comparing sq.ft to R.ft. */
function compareQuantities(measuredQty, measuredUnit, executedQty, executedUnit) {
  const comparable = normUnit(measuredUnit) !== "" && normUnit(measuredUnit) === normUnit(executedUnit);
  const variance = comparable ? Math.round((measuredQty - executedQty) * 100) / 100 : null;
  return {
    comparable,
    variance,
    variancePct: comparable && executedQty > 0 ? Math.round((variance / executedQty) * 1000) / 10 : null
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nonNeg = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Pure validation of a workMeasurements write. Returns an error string or null. */
function validateWorkMeasurement(rec) {
  if (!rec.projectCode || !String(rec.projectCode).trim()) return '"projectCode" is required';
  if (!rec.category || !String(rec.category).trim()) return '"category" is required';
  const loc = rec.location || {};
  if (!["tower", "floor", "flat", "area"].some((k) => loc[k] && String(loc[k]).trim())) {
    return "At least one of tower / floor / flat / area is required";
  }
  if (!DATE_RE.test(String(rec.measurementDate || ""))) return '"measurementDate" must be YYYY-MM-DD';
  if (!nonNeg(rec.measuredQty)) return '"measuredQty" must be a non-negative number';
  if (!rec.measuredUnit || !String(rec.measuredUnit).trim()) return '"measuredUnit" is required';
  const dim = rec.dimensions;
  if (dim != null) {
    for (const k of ["length", "width", "height", "thickness"]) {
      if (dim[k] != null && !nonNeg(dim[k])) return `Dimension "${k}" must be a non-negative number`;
    }
  }
  if (rec.photos != null && !Array.isArray(rec.photos)) return '"photos" must be a list';
  return null;
}

/* ------------------------------------------------------------ VMS reads */

async function projectWorkOrders(vmsDb, projectCode) {
  const projects = await vmsDb.collection("projects").find({ code: projectCode }, { projection: { code: 1 } }).toArray();
  const ids = new Set(projects.filter((p) => p.code === projectCode).map((p) => String(p._id)));
  if (ids.size === 0) return { projectFound: false, workOrders: [] };
  const all = await vmsDb.collection("workorders").find(
    { projectId: { $in: projects.map((p) => p._id) } },
    { projection: { workOrderNo: 1, projectId: 1, category: 1, scopeItems: 1 } }
  ).toArray();
  return { projectFound: true, workOrders: all.filter((w) => ids.has(String(w.projectId))) };
}

/** Match a draft measurement against the live VMS data. `vmsDbOverride` is
 *  test-only dependency injection, same pattern as the other VMS modules. */
async function findMatches(draft, vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured", status: "none", candidates: [] };
  const { projectFound, workOrders } = await projectWorkOrders(vmsDb, draft.projectCode);
  if (!projectFound) return { available: true, status: "none", candidates: [], reason: "PROJECT_NOT_IN_VMS" };
  return { available: true, ...matchMeasurement(draft, flattenItems(workOrders)) };
}

/** Decide what link a record is allowed to be saved with. The client may
 *  PROPOSE a linkedItemId (its user's confirmation), but the stored link
 *  is only ever one the matcher independently verifies — so a stale or
 *  forged id degrades to "unlinked" instead of being trusted. */
async function resolveLink(rec, vmsDbOverride) {
  const m = await findMatches(rec, vmsDbOverride);
  const base = { linkedWorkOrderNo: null, linkedItemId: null, linkedItemType: null, linkedItemDescription: null, linkedItemUnit: null };
  if (!m.available) return { linkStatus: "unmatched", ...base, linkNote: "VMS data unavailable — left unlinked" };
  if (m.status === "unique") {
    const c = m.candidates[0];
    return { linkStatus: "auto", linkedWorkOrderNo: c.workOrderNo, linkedItemId: c.itemId, linkedItemType: c.itemType, linkedItemDescription: c.description, linkedItemUnit: c.unit, linkNote: null };
  }
  if (m.status === "ambiguous") {
    const chosen = rec.linkedItemId ? m.candidates.find((c) => c.itemId === rec.linkedItemId) : null;
    if (chosen) {
      return { linkStatus: "confirmed", linkedWorkOrderNo: chosen.workOrderNo, linkedItemId: chosen.itemId, linkedItemType: chosen.itemType, linkedItemDescription: chosen.description, linkedItemUnit: chosen.unit, linkNote: null };
    }
    return { linkStatus: "ambiguous", ...base, linkNote: `${m.candidates.length} possible VMS items — needs confirmation` };
  }
  return { linkStatus: "unmatched", ...base, linkNote: m.reason || null };
}

/** For every saved measurement that has a link, the live VMS executed
 *  quantity at that measurement's location. One VMS read for all of them. */
async function getComparisons(measurements, vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured", byId: {} };
  const linked = measurements.filter((m) => m.linkedItemId);
  const byProject = new Map();
  for (const m of linked) {
    if (!byProject.has(m.projectCode)) byProject.set(m.projectCode, await projectWorkOrders(vmsDb, m.projectCode));
  }
  const byId = {};
  for (const m of linked) {
    const { workOrders } = byProject.get(m.projectCode);
    const item = flattenItems(workOrders).find((i) => i.itemId === m.linkedItemId);
    if (!item) { byId[m.id] = { found: false }; continue; }
    const c = candidateOf(item, "linked", m.location || {});
    byId[m.id] = {
      found: true,
      executedQty: c.executedQtyAtLocation,
      executedUnit: item.unit,
      plannedQty: item.plannedQty || 0,
      matchedEntryCount: c.matchedEntryCount,
      ...compareQuantities(m.measuredQty, m.measuredUnit, c.executedQtyAtLocation, item.unit)
    };
  }
  return { available: true, byId };
}

/** Fine-grained work category names, straight from VMS's own `categories`
 *  collection (read-only) — the same vocabulary scope-item descriptions use. */
async function getCategories(vmsDbOverride) {
  const vmsDb = vmsDbOverride || await getVmsDb();
  if (!vmsDb) return { available: false, reason: "SOURCE_MONGO_URI is not configured", categories: [] };
  const rows = await vmsDb.collection("categories").find({}, { projection: { name: 1, title: 1 } }).toArray();
  const names = Array.from(new Set(rows.map((r) => String(r.name || r.title || "").trim()).filter(Boolean)));
  names.sort((a, b) => a.localeCompare(b));
  return { available: true, categories: names };
}

module.exports = {
  normLocation, normCategory, normUnit, entryMatchesLocation, flattenItems, matchMeasurement,
  compareQuantities, validateWorkMeasurement, findMatches, resolveLink, getComparisons, getCategories
};
