const assert = require("assert");
const { sanitizePoEvent, matchProjectByName, isStaleUpdate, resolveAction } = require("./imsWebhook.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

const fullEvent = {
  event: "PO_APPROVED",
  action: "created",
  source: "NEXORA_IMS",
  sentAt: "2026-10-13T10:30:00.000Z",
  data: {
    poId: "PO-2026-0142",
    date: "2026-10-12",
    status: "Pending L1",
    priority: "Normal",
    updatedAt: "2026-10-12T17:45:00.000Z",
    project: { name: "Neoteric Tower - Block A", phase: "Phase 2", workType: "Civil", milestone: "Slab Casting - 5th Floor" },
    vendor: {
      name: "Shree Balaji Traders", gstNo: "27AAHFS5678K1Z2", panNo: "AAHFS5678K",
      bankDetails: { accountNo: "50200012345678", bankName: "HDFC Bank" }
    },
    approvals: { l1: { status: "Pending", at: null }, l2: null, l3: null },
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
  assert.strictEqual(rec.deleted, false);
  assert.strictEqual(rec.projectNameRaw, "Neoteric Tower - Block A");
  assert.strictEqual(rec.vendorName, "Shree Balaji Traders");
  assert.strictEqual(rec.status, "Pending L1");
  assert.strictEqual(rec.deliveryDate, "2026-10-20");
  assert.strictEqual(rec.items.length, 2);
  assert.strictEqual(rec.items[0].qty, 100);
  assert.strictEqual(rec.items[0].unit, "Bag");
  assert.strictEqual(rec.approvals.l1.status, "Pending");
  assert.strictEqual(rec.approvals.l2, null);
  assert.ok(Number.isFinite(rec.sourceUpdatedAt));
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

test("rejects an unsupported event type when no update/delete event names are configured", () => {
  const result = sanitizePoEvent({ event: "PO_REJECTED", data: {} });
  assert.strictEqual(result.valid, false);
  assert.ok(result.error.includes("PO_REJECTED"));
});

test("accepts a configured PO_UPDATED event name once VMS_PO_UPDATE_EVENT is set", () => {
  const body = { event: "PO_UPDATED", data: { poId: "PO-1", project: { name: "X" }, items: [] } };
  assert.strictEqual(sanitizePoEvent(body).valid, false, "not accepted until configured");
  assert.strictEqual(sanitizePoEvent(body, { updateEventName: "PO_UPDATED" }).valid, true);
});

test("accepts a configured PO_DELETED event name and treats it as a delete", () => {
  const body = { event: "PO_DELETED", data: { poId: "PO-1" } };
  const result = sanitizePoEvent(body, { deleteEventName: "PO_DELETED" });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.record.deleted, true);
});

test("PO_APPROVED is still accepted even when update/delete event names are configured", () => {
  const body = { event: "PO_APPROVED", data: { poId: "PO-1", project: { name: "X" }, items: [] } };
  assert.strictEqual(sanitizePoEvent(body, { updateEventName: "PO_UPDATED", deleteEventName: "PO_DELETED" }).valid, true);
});

test("resolveAction prefers the action field over the event name", () => {
  assert.strictEqual(resolveAction({ event: "PO_APPROVED", action: "updated" }), "updated");
  assert.strictEqual(resolveAction({ event: "PO_APPROVED", action: "deleted" }), "deleted");
  assert.strictEqual(resolveAction({ event: "PO_APPROVED" }), "created");
});

test("resolveAction falls back to the configured event name when action is absent", () => {
  assert.strictEqual(resolveAction({ event: "PO_DELETED" }, { deleteEventName: "PO_DELETED" }), "deleted");
  assert.strictEqual(resolveAction({ event: "PO_UPDATED" }, { updateEventName: "PO_UPDATED" }), "updated");
});

test("action:\"deleted\" or data.deleted:true marks the record deleted without requiring project/items", () => {
  const byAction = sanitizePoEvent({ event: "PO_APPROVED", action: "deleted", data: { poId: "PO-1" } });
  assert.strictEqual(byAction.valid, true);
  assert.strictEqual(byAction.record.deleted, true);

  const byFlag = sanitizePoEvent({ event: "PO_APPROVED", data: { poId: "PO-1", deleted: true } });
  assert.strictEqual(byFlag.valid, true);
  assert.strictEqual(byFlag.record.deleted, true);
});

test("a restore (action:updated, deleted:false) is validated like a normal update", () => {
  const result = sanitizePoEvent({
    event: "PO_APPROVED", action: "updated",
    data: { poId: "PO-1", deleted: false, project: { name: "X" }, items: [], status: "Approved" }
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.record.deleted, false);
  assert.strictEqual(result.record.status, "Approved");
});

test("a create/update still requires project.name and items", () => {
  assert.strictEqual(sanitizePoEvent({ event: "PO_APPROVED", data: { poId: "PO-1", items: [] } }).valid, false);
  assert.strictEqual(sanitizePoEvent({ event: "PO_APPROVED", data: { poId: "PO-1", project: { name: "X" } } }).valid, false);
});

test("rejects a missing poId regardless of action", () => {
  assert.strictEqual(sanitizePoEvent({ event: "PO_APPROVED", data: {} }).valid, false);
  assert.strictEqual(sanitizePoEvent({ event: "PO_APPROVED", action: "deleted", data: {} }).valid, false);
});

test("defaults a malformed item's qty to 0 rather than throwing", () => {
  const result = sanitizePoEvent({
    event: "PO_APPROVED",
    data: { poId: "PO-1", project: { name: "X" }, items: [{ itemName: "Thing" }] }
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.record.items[0].qty, 0);
});

test("isStaleUpdate: an older data.updatedAt than what's stored is stale", () => {
  const older = Date.parse("2026-10-01T00:00:00.000Z");
  const newer = Date.parse("2026-10-10T00:00:00.000Z");
  assert.strictEqual(isStaleUpdate(newer, older), true);
  assert.strictEqual(isStaleUpdate(older, newer), false);
  assert.strictEqual(isStaleUpdate(newer, newer), false, "equal timestamps are not stale");
});

test("isStaleUpdate: a missing timestamp on either side is never treated as stale", () => {
  assert.strictEqual(isStaleUpdate(null, 123), false);
  assert.strictEqual(isStaleUpdate(123, null), false);
  assert.strictEqual(isStaleUpdate(null, null), false);
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
