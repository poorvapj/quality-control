const assert = require("assert");
const { getProgressAnalysis, activeEntries, locationBreakdown } = require("./progressAnalysis.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
function arr(rows) { return { find: () => ({ toArray: async () => rows }) }; }

async function main() {
  await test("returns {available:false} when SOURCE_MONGO_URI is unset", async () => {
    delete process.env.SOURCE_MONGO_URI;
    const result = await getProgressAnalysis();
    assert.strictEqual(result.available, false);
  });

  test("activeEntries excludes invalidated entries", () => {
    const entries = [{ qtyAdded: 10 }, { qtyAdded: 5, invalidated: { done: true } }];
    assert.strictEqual(activeEntries(entries).length, 1);
  });

  test("locationBreakdown splits billed vs unbilled qty by location, excluding invalidated", () => {
    const entries = [
      { qtyAdded: 10, tower: "A", floor: "1", billedInRequestId: "BR-1" },
      { qtyAdded: 4, tower: "A", floor: "1" },
      { qtyAdded: 999, tower: "A", floor: "1", invalidated: { done: true } },
      { qtyAdded: 7, tower: "B", floor: "2" }
    ];
    const rows = locationBreakdown(entries);
    const a1 = rows.find((r) => r.location === "A / 1");
    const b2 = rows.find((r) => r.location === "B / 2");
    assert.strictEqual(a1.qty, 14);
    assert.strictEqual(a1.billedQty, 10);
    assert.strictEqual(a1.unbilledQty, 4);
    assert.strictEqual(b2.qty, 7);
    assert.strictEqual(b2.billedQty, 0);
    assert.strictEqual(b2.unbilledQty, 7);
  });

  const fakeVmsDb = {
    collection(name) {
      if (name === "workorders") {
        return arr([{
          _id: "wo1", workOrderNo: "WO-0001", projectId: "p1", projectName: "Zen Garden",
          scopeItems: [
            {
              _id: "si1", description: "Plinth Beam", unit: "R.ft",
              plannedQty: 100, completedQty: 120,
              varianceApproved: true, varianceApprovedBy: "u1", varianceApprovedAt: new Date("2026-01-01"), varianceApprovedAtQty: 120,
              progressEntries: [
                { qtyAdded: 100, tower: "A", floor: "1", billedInRequestId: "BR-1" },
                { qtyAdded: 20, tower: "A", floor: "1" }
              ],
              subItems: [{
                _id: "sub1", description: "North wing", unit: "R.ft",
                plannedQty: 0, completedQty: 30,
                progressEntries: [{ qtyAdded: 30, tower: "A", floor: "2" }]
              }]
            }
          ]
        }]);
      }
      if (name === "projects") return arr([{ _id: "p1", code: "PRJ-013", name: "Zen Garden" }]);
      if (name === "users") return arr([{ _id: "u1", name: "Rakesh AGM", email: "rakesh@x.com" }]);
      throw new Error("unexpected collection: " + name);
    }
  };

  await test("full pipeline: variance flagged + sign-off resolved, sub-item plannedQty=0 gives null percent", async () => {
    const result = await getProgressAnalysis(fakeVmsDb);
    assert.strictEqual(result.available, true);
    const proj = result.projects.find((p) => p.projectCode === "PRJ-013");
    const wo = proj.workOrders.find((w) => w.workOrderNo === "WO-0001");
    const scope = wo.items.find((i) => i.itemType === "scopeItem");
    assert.strictEqual(scope.plannedQty, 100);
    assert.strictEqual(scope.completedQty, 120);
    assert.strictEqual(scope.percentOfPlan, 120);
    assert.strictEqual(scope.varianceFlag, true);
    assert.strictEqual(scope.varianceApproved, true);
    assert.strictEqual(scope.varianceApprovedByName, "Rakesh AGM");
    assert.strictEqual(scope.totalBilledQty, 100);
    assert.strictEqual(scope.totalUnbilledQty, 20);

    const sub = wo.items.find((i) => i.itemType === "subItem");
    assert.strictEqual(sub.parentItemId, "si1");
    assert.strictEqual(sub.percentOfPlan, null, "plannedQty=0 must never fabricate a percentage");
    assert.strictEqual(sub.varianceFlag, false, "a 0-planned item is never flagged as over-plan");
  });

  await test("an item with no variance approval ever recorded reports varianceApprovedByName as null, not a guess", async () => {
    const db = {
      collection(name) {
        if (name === "workorders") return arr([{
          _id: "wo2", workOrderNo: "WO-0002", projectId: "p1", projectName: "Zen Garden",
          scopeItems: [{ _id: "si2", description: "Plaster", unit: "sqm", plannedQty: 50, completedQty: 20, progressEntries: [] }]
        }]);
        if (name === "projects") return arr([{ _id: "p1", code: "PRJ-013", name: "Zen Garden" }]);
        if (name === "users") return arr([]);
        throw new Error("unexpected collection: " + name);
      }
    };
    const result = await getProgressAnalysis(db);
    const item = result.projects[0].workOrders[0].items[0];
    assert.strictEqual(item.varianceApprovedByName, null);
    assert.strictEqual(item.varianceFlag, false);
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
