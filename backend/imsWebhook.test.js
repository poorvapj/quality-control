const assert = require("assert");
const { sanitizePoEvent, matchProjectByName } = require("./imsWebhook.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

const fullEvent = {
  event: "PO_APPROVED",
  source: "NEXORA_IMS",
  sentAt: "2026-10-13T10:30:00.000Z",
  data: {
    poId: "PO-2026-0142",
    date: "2026-10-12",
    status: "Approved",
    priority: "Normal",
    project: { name: "Neoteric Tower - Block A", phase: "Phase 2", workType: "Civil", milestone: "Slab Casting - 5th Floor" },
    vendor: {
      name: "Shree Balaji Traders", gstNo: "27AAHFS5678K1Z2", panNo: "AAHFS5678K",
      bankDetails: { accountNo: "50200012345678", bankName: "HDFC Bank" }
    },
    deliveryDetails: { deliveryDate: "2026-10-20", contactPhone: "+91 98900 44556" },
    items: [
      { sku: "CEM-OPC53-50KG", itemName: "OPC 53 Grade Cement", category: "Cement", qty: 100, unit: "Bag", rate: 380, totalWithGST: 44840 },
      { sku: "STL-TMT-12MM", itemName: "TMT Bar 12mm Fe550D", category: "Steel", qty: 2, unit: "MT" }
    ],
    summary: { grandTotal: 185260 },
    paymentTimelines: [{ type: "Advance", amount: 55578 }],
    remark: "Deliver cement in covered vehicle."
  }
};

test("accepts a valid PO_APPROVED event and strips all financial/PII fields", () => {
  const result = sanitizePoEvent(fullEvent);
  assert.strictEqual(result.valid, true);
  const rec = result.record;
  assert.strictEqual(rec.id, "PO-2026-0142");
  assert.strictEqual(rec.projectNameRaw, "Neoteric Tower - Block A");
  assert.strictEqual(rec.vendorName, "Shree Balaji Traders");
  assert.strictEqual(rec.status, "Approved");
  assert.strictEqual(rec.deliveryDate, "2026-10-20");
  assert.strictEqual(rec.items.length, 2);
  assert.strictEqual(rec.items[0].qty, 100);
  assert.strictEqual(rec.items[0].unit, "Bag");
  // Never present anywhere on the sanitized record — these are the fields
  // this module exists specifically to drop.
  const json = JSON.stringify(rec);
  assert.ok(!json.includes("gstNo"));
  assert.ok(!json.includes("panNo"));
  assert.ok(!json.includes("bankDetails"));
  assert.ok(!json.includes("accountNo"));
  assert.ok(!json.includes("contactPhone"));
  assert.ok(!json.includes("grandTotal"));
  assert.ok(!json.includes("rate"));
  assert.ok(!json.includes("totalWithGST"));
  assert.ok(!json.includes("paymentTimelines"));
});

test("rejects a non-object body", () => {
  assert.strictEqual(sanitizePoEvent(null).valid, false);
  assert.strictEqual(sanitizePoEvent("x").valid, false);
});

test("rejects an unsupported event type", () => {
  const result = sanitizePoEvent({ event: "PO_REJECTED", data: {} });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("PO_REJECTED"));
});

test("rejects a missing poId", () => {
  const result = sanitizePoEvent({ event: "PO_APPROVED", data: { project: { name: "X" }, items: [] } });
  assert.strictEqual(result.valid, false);
});

test("rejects a missing project.name", () => {
  const result = sanitizePoEvent({ event: "PO_APPROVED", data: { poId: "PO-1", items: [] } });
  assert.strictEqual(result.valid, false);
});

test("rejects a missing items array", () => {
  const result = sanitizePoEvent({ event: "PO_APPROVED", data: { poId: "PO-1", project: { name: "X" } } });
  assert.strictEqual(result.valid, false);
});

test("defaults a malformed item's qty to 0 rather than throwing", () => {
  const result = sanitizePoEvent({
    event: "PO_APPROVED",
    data: { poId: "PO-1", project: { name: "X" }, items: [{ itemName: "Thing" }] }
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.record.items[0].qty, 0);
});

test("matchProjectByName matches exact name, case-insensitive and trimmed", () => {
  const projects = [{ id: "p1", name: "Neoteric Tower - Block A" }, { id: "p2", name: "Zen Garden" }];
  assert.strictEqual(matchProjectByName("  neoteric tower - block a  ", projects).id, "p1");
});

test("matchProjectByName never partial/fuzzy-matches — returns null rather than a wrong guess", () => {
  const projects = [{ id: "p1", name: "Neoteric Tower - Block A" }];
  assert.strictEqual(matchProjectByName("Neoteric Tower", projects), null);
  assert.strictEqual(matchProjectByName("", projects), null);
  assert.strictEqual(matchProjectByName("Unknown Project", projects), null);
});

console.log(`\n${passed} passed`);
if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
