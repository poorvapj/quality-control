const assert = require("assert");
const { getVmsWorkItems } = require("./vmsWorkItems.js");

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
    const result = await getVmsWorkItems();
    assert.strictEqual(result.available, false);
  });

  const fakeVmsDb = {
    collection(name) {
      if (name === "workorders") {
        return arr([{
          _id: "wo1", workOrderNo: "WO-0001", projectId: "p1", projectName: "Zen Garden",
          scopeItems: [
            {
              _id: "si1", description: "Plinth Beam", unit: "R.ft", rate: 130, plannedQty: 500,
              progressEntries: [
                { qtyAdded: 100, tower: "A", floor: "1" },
                { qtyAdded: 999, invalidated: { done: true, reason: "duplicate" } }
              ],
              subItems: [{ _id: "sub1", description: "North wing", unit: "R.ft", rate: 130 }]
            }
          ]
        }]);
      }
      if (name === "projects") return arr([{ _id: "p1", code: "PRJ-013", name: "Zen Garden" }]);
      throw new Error("unexpected collection: " + name);
    }
  };

  await test("builds project > work order > item structure with no rate/amount fields exposed", async () => {
    const result = await getVmsWorkItems(fakeVmsDb);
    assert.strictEqual(result.available, true);
    const proj = result.projects.find((p) => p.projectCode === "PRJ-013");
    assert.ok(proj);
    const wo = proj.workOrders.find((w) => w.workOrderNo === "WO-0001");
    assert.ok(wo);
    assert.strictEqual(wo.items.length, 2);
    const scopeItem = wo.items.find((i) => i.itemType === "scopeItem");
    assert.strictEqual(scopeItem.description, "Plinth Beam");
    assert.ok(!("rate" in scopeItem), "rate must never be exposed on this non-financial endpoint");
    assert.ok(!("amount" in scopeItem));
    assert.strictEqual(scopeItem.executedQty, 100, "excludes the invalidated 999 entry, same rule as Execution Reconciliation");
    assert.strictEqual(scopeItem.plannedQty, 500, "planned qty is read from VMS's own stored field, for the Measurement form's reference display");
    assert.deepStrictEqual(scopeItem.locations, ["A / 1"]);
    const subItem = wo.items.find((i) => i.itemType === "subItem");
    assert.strictEqual(subItem.parentItemId, "si1");
    assert.strictEqual(subItem.plannedQty, 0, "a sub-item with no stored plannedQty defaults to 0, never fabricated");
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
