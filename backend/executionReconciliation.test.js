/* Plain-Node tests for executionReconciliation.js — no test framework, no
   real Mongo connection. Run with: node executionReconciliation.test.js
   Covers exactly the Phase A requirements: excluding invalidated progress
   entries, qty*rate value calc (GST-exclusive, matching VMS's own billing
   math), duplicate prevention, unmapped billed lines, billed-vs-executed
   reconciliation, and authorization. */
const assert = require("assert");
const { getExecutionReconciliation, requiresAdmin, activeQty } = require("./executionReconciliation.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}

function arr(rows) { return { find: () => ({ toArray: async () => rows }) }; }

async function main() {
  // --- activeQty: the exact invalidated-entry exclusion rule -------------
  await test("activeQty sums only non-invalidated progressEntries", () => {
    const entries = [
      { qtyAdded: 100 },
      { qtyAdded: 50, invalidated: { done: false } },
      { qtyAdded: 999, invalidated: { done: true, reason: "wrong entry" } } // must be excluded
    ];
    assert.strictEqual(activeQty(entries), 150);
  });

  await test("activeQty treats missing/empty entries as zero, never throws", () => {
    assert.strictEqual(activeQty(undefined), 0);
    assert.strictEqual(activeQty([]), 0);
  });

  // --- authorization -------------------------------------------------------
  await test("requiresAdmin: no session -> 401", () => {
    const r = requiresAdmin(null);
    assert.deepStrictEqual(r, { status: 401, error: "Sign-in required" });
  });

  await test("requiresAdmin: session but not admin -> 403", () => {
    const r = requiresAdmin({ userId: "U-05", isAdmin: false });
    assert.deepStrictEqual(r, { status: 403, error: "Admin access required" });
  });

  await test("requiresAdmin: admin session -> null (allowed)", () => {
    assert.strictEqual(requiresAdmin({ userId: "U-ADMIN", isAdmin: true }), null);
  });

  // --- getExecutionReconciliation: safe no-op when unconfigured ----------
  await test("getExecutionReconciliation returns {available:false} when SOURCE_MONGO_URI is unset and no override given", async () => {
    delete process.env.SOURCE_MONGO_URI;
    const result = await getExecutionReconciliation();
    assert.strictEqual(result.available, false);
    assert.ok(result.reason.includes("SOURCE_MONGO_URI"));
  });

  // --- full pipeline against an in-memory fake VMS db ---------------------
  const scopeItemId1 = "si1";
  const scopeItemId2 = "si2-unbilled";
  const subItemId1 = "sub1";
  const workOrders = [
    {
      _id: "wo1", workOrderNo: "WO-0001", projectId: "p1", projectName: "Zen Garden",
      scopeItems: [
        {
          _id: scopeItemId1, description: "Plinth Beam", unit: "R.ft", rate: 130,
          progressEntries: [
            { qtyAdded: 100, tower: "A", floor: "1" },
            { qtyAdded: 50, tower: "A", floor: "1", invalidated: { done: true, reason: "duplicate entry" } }, // must be excluded
            { qtyAdded: 25, tower: "A", floor: "2" }
          ],
          subItems: [
            {
              _id: subItemId1, description: "Plinth Beam - North wing", unit: "R.ft", rate: 130,
              progressEntries: [{ qtyAdded: 10, tower: "A", floor: "3" }]
            }
          ]
        },
        {
          _id: scopeItemId2, description: "Column work", unit: "R.ft", rate: 130,
          progressEntries: [{ qtyAdded: 40, tower: "B" }] // never billed — "Not yet billed" case
        }
      ]
    }
  ];
  const runningBills = [
    {
      billNo: "RA-0001", workOrderNo: "WO-0001",
      lineItems: [
        { scopeItemId: scopeItemId1, billedQty: 100, rate: 130, amount: 13000 }, // matches si1's executed qty exactly
        { subItemId: subItemId1, billedQty: 10, rate: 130, amount: 1300 },
        { scopeItemId: "ghost-item-does-not-exist", billedQty: 5, rate: 100, amount: 500 } // unmapped
      ]
    }
  ];
  const vmsProjects = [{ _id: "p1", code: "PRJ-013", name: "Zen Garden" }];

  const fakeVmsDb = {
    collection(name) {
      if (name === "workorders") return arr(workOrders);
      if (name === "runningbills") return arr(runningBills);
      if (name === "projects") return arr(vmsProjects);
      throw new Error("unexpected VMS collection: " + name);
    }
  };

  let result;
  await test("full pipeline: computes executed qty/value excluding invalidated entries, maps billed lines, flags unmapped", async () => {
    result = await getExecutionReconciliation(fakeVmsDb);
    assert.strictEqual(result.available, true);
    const si1 = result.rows.find((r) => r.itemId === scopeItemId1);
    assert.ok(si1, "scope item 1 row must exist");
    assert.strictEqual(si1.executedQty, 125, "100 (active) + 25 (active) — the invalidated 50 must be excluded");
    assert.strictEqual(si1.executedValue, 125 * 130, "value = qty * rate (GST-exclusive, matching VMS's own billing math)");
    assert.strictEqual(si1.measuredQty, si1.executedQty, "measured is explicitly the same figure as executed, not a fabricated second number");
    assert.strictEqual(si1.billedQty, 100);
    assert.strictEqual(si1.billedValue, 13000, "uses the line item's own stored amount, not a recomputed qty*rate");
  });

  await test("sub-item rows are computed and billed independently of their parent scope item", () => {
    const sub1 = result.rows.find((r) => r.itemId === subItemId1);
    assert.ok(sub1);
    assert.strictEqual(sub1.itemType, "subItem");
    assert.strictEqual(sub1.parentItemId, scopeItemId1);
    assert.strictEqual(sub1.executedQty, 10);
    assert.strictEqual(sub1.billedQty, 10);
    assert.strictEqual(sub1.billedValue, 1300);
  });

  await test("an item with no matching bill shows billedQty/billedValue of 0, not an error or a guess", () => {
    const si2 = result.rows.find((r) => r.itemId === scopeItemId2);
    assert.ok(si2);
    assert.strictEqual(si2.executedQty, 40);
    assert.strictEqual(si2.billedQty, 0);
    assert.strictEqual(si2.billedValue, 0);
  });

  await test("a bill line referencing an unknown scope item is reported as unmapped, never silently attributed to a real item", () => {
    assert.strictEqual(result.unmappedBilled.length, 1);
    assert.strictEqual(result.unmappedBilled[0].billNo, "RA-0001");
    assert.strictEqual(result.unmappedBilled[0].qty, 5);
    assert.strictEqual(result.unmappedBilled[0].value, 500);
    // the unmapped line's qty/value must NOT have been folded into si1's billedQty/billedValue
    const si1 = result.rows.find((r) => r.itemId === scopeItemId1);
    assert.strictEqual(si1.billedQty, 100, "unmapped line never leaks into a real item's billed total");
  });

  await test("re-running the same aggregation never double-counts (pure function of its input, not cumulative state)", async () => {
    const again = await getExecutionReconciliation(fakeVmsDb);
    const si1a = result.rows.find((r) => r.itemId === scopeItemId1);
    const si1b = again.rows.find((r) => r.itemId === scopeItemId1);
    assert.strictEqual(si1a.executedQty, si1b.executedQty);
    assert.strictEqual(si1a.billedQty, si1b.billedQty);
  });

  await test("quality-linked fields are never present on a row — the frontend's Data-unavailable rendering isn't contradicted by a hidden number", () => {
    for (const r of result.rows) {
      assert.ok(!("qualityCheckedQty" in r));
      assert.ok(!("qualityCheckedValue" in r));
      assert.ok(!("pendingQualityVerification" in r));
    }
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) {
    console.error("SOME TESTS FAILED");
    process.exit(1);
  }
}

main();
