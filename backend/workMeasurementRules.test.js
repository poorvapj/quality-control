const assert = require("assert");
const {
  normLocation, normCategory, matchMeasurement, flattenItems, compareQuantities,
  validateWorkMeasurement, findMatches, resolveLink, getComparisons
} = require("./workMeasurementRules.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

// Test fixtures only — shaped like the real VMS documents (see the schema
// notes at the top of workMeasurementRules.js), never loaded anywhere else.
const entry = (qty, loc = {}, extra = {}) => ({ qtyAdded: qty, ...loc, ...extra });
const wo = (workOrderNo, category, scopeItems) => ({ _id: "id-" + workOrderNo, workOrderNo, projectId: "p1", category, scopeItems });
const si = (_id, description, unit, progressEntries, subItems = [], plannedQty = 0) => ({ _id, description, unit, progressEntries, subItems, plannedQty });

function fakeDb(workOrders, projects = [{ _id: "p1", code: "PRJ-013" }], categories = []) {
  const arr = (rows) => ({ find: () => ({ toArray: async () => rows }) });
  return {
    collection(name) {
      if (name === "workorders") return arr(workOrders);
      if (name === "projects") return arr(projects);
      if (name === "categories") return arr(categories);
      throw new Error("unexpected collection: " + name);
    }
  };
}

const draft = (over = {}) => ({
  projectCode: "PRJ-013", category: "Plastering work",
  location: { floor: "6th Floor", flat: "", tower: "", area: "" },
  measuredQty: 100, measuredUnit: "sq.ft", ...over
});

(async () => {
  console.log("normalisation (format-only, never fuzzy)");
  await test("location keys ignore case/ordinals/noise words but stay exact otherwise", () => {
    assert.strictEqual(normLocation("6th Floor"), "6");
    assert.strictEqual(normLocation("Sixth floor"), "6");
    assert.strictEqual(normLocation("6"), "6");
    assert.strictEqual(normLocation("Flat 1001"), "1001");
    assert.notStrictEqual(normLocation("60"), normLocation("6"));
    assert.notStrictEqual(normLocation("Ground Floor"), normLocation("First Floor"));
  });
  await test("category keys ignore case/punctuation/trailing 'work' but a typo does not match", () => {
    assert.strictEqual(normCategory("Plastering work"), normCategory("PLASTERING"));
    assert.strictEqual(normCategory("Column work"), normCategory("column"));
    assert.notStrictEqual(normCategory("Block Masonary"), normCategory("Block Masonry"));
  });

  console.log("matching: unique / ambiguous / missing");
  await test("UNIQUE: one item matches by description and location → auto-linkable", () => {
    const items = flattenItems([
      wo("WO-1", "Civil / RCC", [
        si("a", "Plastering work", "sq.ft", [entry(40, { floor: "6th floor" }), entry(60, { floor: "6" })], [], 200),
        si("b", "Column work", "R.ft", [entry(5, { floor: "6th floor" })])
      ])
    ]);
    const r = matchMeasurement(draft(), items);
    assert.strictEqual(r.status, "unique");
    assert.strictEqual(r.candidates[0].itemId, "a");
    assert.strictEqual(r.candidates[0].executedQtyAtLocation, 100); // both entries are the same floor after normalisation
    assert.strictEqual(r.candidates[0].plannedQty, 200);
    assert.strictEqual(r.candidates[0].matchedOn, "itemDescription");
  });

  await test("AMBIGUOUS: the same category at the same location in two work orders → needs confirmation, never auto-picked", () => {
    const items = flattenItems([
      wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(40, { floor: "6th floor" })])]),
      wo("WO-2", "Civil / RCC", [si("c", "Plastering work", "sq.ft", [entry(25, { floor: "6th floor" })])])
    ]);
    const r = matchMeasurement(draft(), items);
    assert.strictEqual(r.status, "ambiguous");
    assert.deepStrictEqual(r.candidates.map((c) => c.workOrderNo).sort(), ["WO-1", "WO-2"]);
  });

  await test("MISSING: no item with that category → none (NO_CATEGORY_MATCH)", () => {
    const items = flattenItems([wo("WO-1", "Painting", [si("a", "Putty", "sq.ft", [entry(10, { floor: "6th floor" })])])]);
    const r = matchMeasurement(draft(), items);
    assert.strictEqual(r.status, "none");
    assert.strictEqual(r.reason, "NO_CATEGORY_MATCH");
  });

  await test("MISSING: category exists but VMS recorded nothing at this location → none (NO_LOCATION_MATCH)", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(10, { floor: "2nd floor" })])])]);
    const r = matchMeasurement(draft(), items);
    assert.strictEqual(r.status, "none");
    assert.strictEqual(r.reason, "NO_LOCATION_MATCH");
  });

  await test("MISSING: progress entries with a blank location are never treated as 'any location'", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(10), entry(5, { floor: "" })])])]);
    assert.strictEqual(matchMeasurement(draft(), items).status, "none");
  });

  await test("invalidated progress entries are ignored", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [
      si("a", "Plastering work", "sq.ft", [entry(10, { floor: "6th floor" }, { invalidated: { done: true } })])
    ])]);
    assert.strictEqual(matchMeasurement(draft(), items).status, "none");
  });

  await test("every specified location field must agree: a conflicting flat excludes the entry", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [
      si("a", "Plastering work", "sq.ft", [entry(10, { floor: "6th floor", flatNo: "602" })])
    ])]);
    assert.strictEqual(matchMeasurement(draft({ location: { floor: "6", flat: "601" } }), items).status, "none");
    assert.strictEqual(matchMeasurement(draft({ location: { floor: "6", flat: "602" } }), items).status, "unique");
    // a flat the entry doesn't record can't be verified either
    const noFlat = flattenItems([wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(10, { floor: "6th floor" })])])]);
    assert.strictEqual(matchMeasurement(draft({ location: { floor: "6", flat: "602" } }), noFlat).status, "none");
  });

  await test("category falls back to the work order's coarse category only when no item description matches", () => {
    const items = flattenItems([wo("WO-1", "Painting", [si("a", "Putty", "sq.ft", [entry(10, { floor: "6th floor" })])])]);
    const r = matchMeasurement(draft({ category: "Painting" }), items);
    assert.strictEqual(r.status, "unique");
    assert.strictEqual(r.candidates[0].matchedOn, "workOrderCategory");
    // description match wins over a coarse-category match
    const both = flattenItems([wo("WO-1", "Painting", [
      si("a", "Putty", "sq.ft", [entry(1, { floor: "6th floor" })]),
      si("b", "Painting", "sq.ft", [entry(2, { floor: "6th floor" })])
    ])]);
    const r2 = matchMeasurement(draft({ category: "Painting" }), both);
    assert.strictEqual(r2.status, "unique");
    assert.strictEqual(r2.candidates[0].itemId, "b");
  });

  await test("sub-items are candidates too, and area matches plotNo or locationNote", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [
      si("a", "Civil", "sq.ft", [], [si("s1", "Plastering work", "sq.ft", [entry(7, {}, { locationNote: "Villa 76-81" })])])
    ])]);
    const r = matchMeasurement(draft({ location: { area: "villa 76-81" } }), items);
    assert.strictEqual(r.status, "unique");
    assert.strictEqual(r.candidates[0].itemType, "subItem");
  });

  await test("a measurement with no category or no location is never matched", () => {
    const items = flattenItems([wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(1, { floor: "6" })])])]);
    assert.strictEqual(matchMeasurement(draft({ category: "" }), items).reason, "NO_CATEGORY");
    assert.strictEqual(matchMeasurement(draft({ location: {} }), items).reason, "NO_LOCATION");
  });

  console.log("execution vs measured");
  await test("variance only when both sides are in the same unit", () => {
    const same = compareQuantities(110, "sq.ft", 100, "Sq.Ft");
    assert.deepStrictEqual(same, { comparable: true, variance: 10, variancePct: 10 });
    const diff = compareQuantities(110, "sq.ft", 100, "R.ft");
    assert.deepStrictEqual(diff, { comparable: false, variance: null, variancePct: null });
  });

  console.log("link resolution against a (fake, read-only) VMS");
  const uniqueDb = fakeDb([wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(60, { floor: "6th floor" })], [], 500)])]);
  const ambiguousDb = fakeDb([
    wo("WO-1", "Civil / RCC", [si("a", "Plastering work", "sq.ft", [entry(40, { floor: "6th floor" })])]),
    wo("WO-2", "Civil / RCC", [si("c", "Plastering work", "sq.ft", [entry(25, { floor: "6th floor" })])])
  ]);

  await test("unique match is auto-linked and the labels come from VMS, not the client", async () => {
    const link = await resolveLink({ ...draft(), linkedItemDescription: "forged label" }, uniqueDb);
    assert.strictEqual(link.linkStatus, "auto");
    assert.strictEqual(link.linkedItemId, "a");
    assert.strictEqual(link.linkedWorkOrderNo, "WO-1");
    assert.strictEqual(link.linkedItemDescription, "Plastering work");
  });
  await test("ambiguous with no choice stays unlinked and flagged for confirmation", async () => {
    const link = await resolveLink(draft(), ambiguousDb);
    assert.strictEqual(link.linkStatus, "ambiguous");
    assert.strictEqual(link.linkedItemId, null);
  });
  await test("ambiguous + a valid chosen item → confirmed", async () => {
    const link = await resolveLink({ ...draft(), linkedItemId: "c" }, ambiguousDb);
    assert.strictEqual(link.linkStatus, "confirmed");
    assert.strictEqual(link.linkedWorkOrderNo, "WO-2");
  });
  await test("a chosen item that isn't a verified candidate is dropped, not trusted", async () => {
    const link = await resolveLink({ ...draft(), linkedItemId: "not-a-candidate" }, ambiguousDb);
    assert.strictEqual(link.linkStatus, "ambiguous");
    assert.strictEqual(link.linkedItemId, null);
    const unique = await resolveLink({ ...draft(), linkedItemId: "not-a-candidate" }, uniqueDb);
    assert.strictEqual(unique.linkedItemId, "a"); // overridden by the verified match
  });
  await test("no match → unmatched; project absent from VMS → unmatched", async () => {
    const none = await resolveLink(draft({ category: "Tiles work" }), uniqueDb);
    assert.strictEqual(none.linkStatus, "unmatched");
    assert.strictEqual(none.linkNote, "NO_CATEGORY_MATCH");
    const m = await findMatches(draft({ projectCode: "PRJ-999" }), uniqueDb);
    assert.strictEqual(m.reason, "PROJECT_NOT_IN_VMS");
  });
  await test("work orders of another VMS project are never candidates", async () => {
    const db = fakeDb([{ ...wo("WO-9", "Civil / RCC", [si("z", "Plastering work", "sq.ft", [entry(5, { floor: "6th floor" })])]), projectId: "other" }]);
    assert.strictEqual((await findMatches(draft(), db)).status, "none");
  });

  await test("comparison: live executed qty at the measurement's location, only for linked records", async () => {
    const out = await getComparisons([
      { id: "m1", projectCode: "PRJ-013", category: "Plastering work", location: { floor: "6th Floor" }, measuredQty: 70, measuredUnit: "sq.ft", linkedItemId: "a" },
      { id: "m2", projectCode: "PRJ-013", category: "Plastering work", location: { floor: "6th Floor" }, measuredQty: 70, measuredUnit: "sq.ft", linkedItemId: null }
    ], uniqueDb);
    assert.strictEqual(out.byId.m1.executedQty, 60);
    assert.strictEqual(out.byId.m1.variance, 10);
    assert.strictEqual(out.byId.m1.plannedQty, 500, "planned qty is read from VMS's own stored field, for the measurement form's reference display");
    assert.strictEqual(out.byId.m2, undefined);
  });

  console.log("validation");
  await test("validateWorkMeasurement enforces the required fields", () => {
    const ok = { projectCode: "PRJ-013", category: "Plastering work", location: { floor: "6" }, measurementDate: "2026-10-13", measuredQty: 5, measuredUnit: "sq.ft", photos: [] };
    assert.strictEqual(validateWorkMeasurement(ok), null);
    assert.ok(validateWorkMeasurement({ ...ok, category: "" }));
    assert.ok(validateWorkMeasurement({ ...ok, location: {} }));
    assert.ok(validateWorkMeasurement({ ...ok, measurementDate: "13/10/2026" }));
    assert.ok(validateWorkMeasurement({ ...ok, measuredQty: -1 }));
    assert.ok(validateWorkMeasurement({ ...ok, measuredUnit: " " }));
    assert.ok(validateWorkMeasurement({ ...ok, dimensions: { length: -2 } }));
    assert.strictEqual(validateWorkMeasurement({ ...ok, dimensions: { length: 2, width: 3 } }), null);
  });

  console.log(`\n${passed} passed`);
})();
