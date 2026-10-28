// Tests for the client side of the data-integrity fixes: kept-rejected-changes list, changed-fields-only diff, and the
// local mirror of the new `push` op.   cd frontend && node --test tests/dataIntegrity.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { addRejected, parseRejected, redactOps, REJECTED_CAP } from "../src/shared/rejected.ts";
import { diffRecord } from "../src/shared/recordDiff.ts";
import { applyOpsLocal } from "../src/shared/applyOpsLocal.ts";

test("rejected changes: kept in a bounded list, newest last", () => {
  let raw = null;
  for (let i = 0; i < REJECTED_CAP + 5; i++) raw = JSON.stringify(addRejected(raw, [{ op: "upsert", coll: "snags", rec: { id: "S" + i } }], "err " + i, 1000 + i));
  const list = parseRejected(raw);
  assert.equal(list.length, REJECTED_CAP);
  assert.equal(list[list.length - 1].ops[0].rec.id, "S" + (REJECTED_CAP + 4));
  assert.equal(list[0].ops[0].rec.id, "S5");
});

test("rejected changes: a plaintext password is never kept, other fields are, and the original ops are untouched", () => {
  const ops = [{ op: "upsert", coll: "users", rec: { id: "U1", name: "Pat", email: "p@x.test", password: "Sup3r-Secret" } }, { op: "upsert", coll: "snags", rec: { id: "S1", title: "t" } }];
  const kept = addRejected(null, ops, "Admin access required");
  const text = JSON.stringify(kept);
  assert.ok(!text.includes("Sup3r-Secret") && !text.includes('"password"'));
  assert.equal(kept[0].ops[0].rec.name, "Pat");
  assert.equal(ops[0].rec.password, "Sup3r-Secret", "the live ops (still needed for delivery) are not modified");
  assert.deepEqual(redactOps(ops)[1], ops[1]);
});

test("rejected changes: garbage in storage is ignored, long errors are cut, bad ops cannot throw", () => {
  assert.deepEqual(parseRejected("not json"), []);
  assert.deepEqual(parseRejected('{"a":1}'), []);
  assert.deepEqual(parseRejected(null), []);
  assert.equal(addRejected(null, [], "x".repeat(1000))[0].error.length, 300);
  const circular = {}; circular.self = circular;
  assert.deepEqual(redactOps([circular]), []);
});

test("diffRecord: only changed fields are sent, always with the id", () => {
  const original = { id: "P1", name: "Tower", code: "T1", active: true, colour: "#fff", note: undefined };
  assert.deepEqual(diffRecord(original, { id: "P1", name: "Tower", code: "T1", active: true, colour: "#fff", note: null }), { id: "P1" });
  assert.deepEqual(diffRecord(original, { id: "P1", name: "Tower 2", code: "T1", active: true, colour: "#fff" }), { id: "P1", name: "Tower 2" });
});

test("diffRecord: clearing a field that had a value sends null; arrays/objects compare by content", () => {
  const original = { id: "C1", name: "Checklist", items: [{ a: 1 }], remarks: "old" };
  assert.deepEqual(diffRecord(original, { id: "C1", name: "Checklist", items: [{ a: 1 }], remarks: null }), { id: "C1", remarks: null });
  assert.deepEqual(diffRecord(original, { id: "C1", items: [{ a: 1 }, { a: 2 }] }), { id: "C1", items: [{ a: 1 }, { a: 2 }] });
});

test("diffRecord: fields the form does not show are never sent, so a colleague's change to them survives", () => {
  const stale = { id: "T1", name: "Team", leaderId: "OLD-LEADER", active: true };
  assert.deepEqual(diffRecord(stale, { id: "T1", name: "Team renamed" }), { id: "T1", name: "Team renamed" });
});

test("diffRecord: no original (new record) sends everything non-empty", () => {
  assert.deepEqual(diffRecord(null, { id: "X", a: 1, b: null }), { id: "X", a: 1 });
});

test("local mirror of push: appends to the array, creates it when missing, and does not touch the op itself", () => {
  const d = { snags: [{ id: "S1", title: "t", photos: [{ url: "a" }] }], events: [] };
  const op = { op: "upsert", coll: "snags", rec: { id: "S1" }, push: { photos: { url: "b" } } };
  applyOpsLocal(d, [op]);
  assert.deepEqual(d.snags[0].photos.map((p) => p.url), ["a", "b"]);
  assert.equal(d.snags[0].title, "t");
  assert.deepEqual(op.rec, { id: "S1" }, "the op sent to the server keeps its rec free of the pushed field");
  const d2 = { snags: [{ id: "S2" }], events: [] };
  applyOpsLocal(d2, [{ op: "upsert", coll: "snags", rec: { id: "S2" }, push: { photos: { url: "x" } } }]);
  assert.deepEqual(d2.snags[0].photos, [{ url: "x" }]);
});

test("local mirror of push: a create with a first photo", () => {
  const d = { snags: [], events: [] };
  const op = { op: "upsert", coll: "snags", create: true, rec: { id: "S9", title: "new" }, push: { photos: { url: "first" } } };
  applyOpsLocal(d, [op]);
  assert.deepEqual(d.snags[0], { id: "S9", title: "new", photos: [{ url: "first" }] });
  assert.deepEqual(op.rec, { id: "S9", title: "new" });
});

test("local mirror: patches from two writers keep both fields (field-level merge, as on the server)", () => {
  const d = { snags: [{ id: "S1", status: "Open", assignedTo: "A" }], events: [] };
  applyOpsLocal(d, [{ op: "upsert", coll: "snags", rec: { id: "S1", assignedTo: "C" } }, { op: "upsert", coll: "snags", rec: { id: "S1", status: "Closed" } }]);
  assert.equal(d.snags[0].assignedTo, "C"); assert.equal(d.snags[0].status, "Closed");
});

import { grantPatch } from "../src/shared/recordDiff.ts";
import { buildDecisionOp as decideOp } from "../src/shared/approvalOp.ts";

test("grantPatch: only the modules that changed, as dotted keys; null removes one", () => {
  const base = { masters: { view: true }, dpr: { view: true, create: true }, snags: { view: true } };
  const next = { masters: { view: true }, dpr: { view: true, create: false }, work: { view: true } };
  assert.deepEqual(grantPatch(base, next), { "grants.dpr": { view: true, create: false }, "grants.snags": null, "grants.work": { view: true } });
  assert.deepEqual(grantPatch(base, base), {});
  assert.deepEqual(grantPatch(null, { a: { view: true } }), { "grants.a": { view: true } });
});

test("local mirror of dotted keys: sets one nested entry, removes on null, never mutates the previous object", () => {
  const prevGrants = { masters: { view: true }, dpr: { view: true } };
  const d = { moduleGrants: [{ id: "MG-U", userId: "U", grants: prevGrants }], events: [] };
  applyOpsLocal(d, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-U", "grants.dpr": { view: false }, "grants.masters": null, "grants.work": { view: true } } }]);
  assert.deepEqual(d.moduleGrants[0].grants, { dpr: { view: false }, work: { view: true } });
  assert.deepEqual(prevGrants, { masters: { view: true }, dpr: { view: true } }, "the earlier object is untouched");
  assert.ok(!Object.keys(d.moduleGrants[0]).some((k) => k.includes(".")), "no literal dotted key is left on the record");
  const d2 = { moduleGrants: [], events: [] };
  applyOpsLocal(d2, [{ op: "upsert", coll: "moduleGrants", rec: { id: "MG-V", userId: "V", "grants.a": { view: true } } }]);
  assert.deepEqual(d2.moduleGrants[0].grants, { a: { view: true } });
});

test("approval decisions are sent as just {id, approval} (never the whole record)", () => {
  const rec = { id: "WM-1", projectCode: "P", category: "RCC", measuredQty: 5, measuredUnit: "m", approval: { status: "pending", approverUserId: "U-A" } };
  const op = decideOp("workMeasurements", rec, "approved", " ok ");
  assert.deepEqual(Object.keys(op.rec).sort(), ["approval", "id"]);
  assert.equal(op.rec.approval.status, "approved"); assert.equal(op.rec.approval.remark, "ok"); assert.equal(op.rec.approval.approverUserId, "U-A");
  const d = { workMeasurements: [rec], events: [] };
  applyOpsLocal(d, [op]);
  assert.equal(d.workMeasurements[0].measuredQty, 5); assert.equal(d.workMeasurements[0].approval.status, "approved");
});
