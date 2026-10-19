const assert = require("assert");
const {
  describeRecord, parseApprovalEntity, approvalRequestText, approvalRequestBlocks, approvalDecisionText,
  approvalResultLine, rejectModal, parseRejectSubmission, remarkRequiredResponse, observerCopyText
} = require("./approvalSlack.js");
const { parseActionId } = require("./slackActions.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

const insp = {
  id: "QI-0007", projectCode: "PRJ-013", floorName: "Second Floor", unitName: "Flat 3", workType: "Plastering Inspection", result: "Fail",
  inspectorName: "Dayansh Shrivastava", inspectionDate: "2026-10-17", remarks: "Wall not plumb",
  checklistItems: [
    { text: "Surface preparation", status: "OK" },
    { text: "Finish, level, and plumb", status: "Not OK", remarks: "off by 8mm" },
    { text: "Joint treatment", status: "N/A" }
  ],
  photos: [{ url: "https://x/1.jpg" }, { url: "https://x/2.jpg" }]
};
const meas = { id: "MM-0001", projectCode: "PRJ-013", floorName: "Ground Floor", unitName: "Flat 1", measuredQty: 265, measuredUnit: "sq.ft", recordedByName: "Mohit Pal", measurementDate: "2026-10-18" };
const wmeas = { id: "WM-0001", projectCode: "PRJ-013", category: "Plastering work", measuredQty: 40, measuredUnit: "sq.ft" };

console.log("record descriptions");
test("each kind is described the way the app describes it", () => {
  assert.strictEqual(describeRecord("qualityInspections", insp), "PRJ-013 · Second Floor / Flat 3 · Plastering Inspection · Fail");
  assert.strictEqual(describeRecord("materialMeasurements", meas), "PRJ-013 · Ground Floor / Flat 1 · 265 sq.ft");
  assert.strictEqual(describeRecord("workMeasurements", wmeas), "PRJ-013 · Plastering work · 40 sq.ft");
});

console.log("button ids (untrusted input from Slack)");
test("an action id round-trips through the existing <kind>:<entity> parser", () => {
  const blocks = approvalRequestBlocks("qualityInspections", insp).blocks;
  const buttons = blocks.find((b) => b.type === "actions").elements;
  const approve = parseActionId(buttons[0].action_id);
  assert.strictEqual(approve.kind, "approval_approve");
  assert.deepStrictEqual(parseApprovalEntity(approve.entityId), { coll: "qualityInspections", id: "QI-0007" });
  assert.strictEqual(parseActionId(buttons[1].action_id).kind, "approval_reject");
});
test("only the three approval collections are accepted — nothing else can be named by a button", () => {
  for (const bad of ["users:U-ADMIN", "snags:SNG-1", "moduleGrants:x", "qualityInspections:", ":QI-1", "qualityInspections", "", null, undefined, "__proto__:x"]) {
    assert.strictEqual(parseApprovalEntity(bad), null, String(bad));
  }
  assert.deepStrictEqual(parseApprovalEntity("workMeasurements:WM-0001"), { coll: "workMeasurements", id: "WM-0001" });
  // an id may itself contain a colon — only the first one splits
  assert.deepStrictEqual(parseApprovalEntity("materialMeasurements:MM:odd"), { coll: "materialMeasurements", id: "MM:odd" });
});

console.log("the request the team leader receives");
test("it says what, who, when, the failed points and the remark, with Approve and Reject", () => {
  const { text, blocks } = approvalRequestBlocks("qualityInspections", insp);
  assert.ok(text.includes("Inspection awaiting your approval"));
  assert.ok(text.includes("Dayansh Shrivastava") && text.includes("2026-10-17"));
  assert.ok(text.includes("Finish, level, and plumb") && text.includes("off by 8mm"));
  assert.ok(!text.includes("Surface preparation")); // only failed points
  assert.ok(text.includes("Wall not plumb"));
  const actions = blocks.find((b) => b.type === "actions").elements;
  assert.deepStrictEqual(actions.map((a) => [a.text.text, a.style]), [["Approve", "primary"], ["Reject", "danger"]]);
});
test("photos are shown (max 4) and a measurement reads sensibly", () => {
  assert.strictEqual(approvalRequestBlocks("qualityInspections", insp).blocks.filter((b) => b.type === "image").length, 2);
  const many = { ...insp, photos: Array.from({ length: 9 }, (_, i) => ({ url: "https://x/" + i })) };
  assert.strictEqual(approvalRequestBlocks("qualityInspections", many).blocks.filter((b) => b.type === "image").length, 4);
  const t = approvalRequestText("materialMeasurements", meas);
  assert.ok(t.includes("Measurement awaiting your approval") && t.includes("265 sq.ft") && t.includes("Mohit Pal"));
});

console.log("what happens after the decision");
test("the author is told approved / sent back (with the remark)", () => {
  assert.ok(approvalDecisionText({ coll: "qualityInspections", rec: insp, status: "approved", byName: "Rishabh" }).includes("approved"));
  const back = approvalDecisionText({ coll: "qualityInspections", rec: insp, status: "rejected", remark: "Redo wall", byName: "Rishabh" });
  assert.ok(back.includes("sent back") && back.includes("Redo wall") && back.includes("Rishabh"));
});
test("the leader's own message becomes a result line (so the buttons can't be pressed twice)", () => {
  const line = approvalResultLine({ coll: "materialMeasurements", rec: meas, status: "approved", byName: "Rishabh" });
  assert.ok(line.includes("approved") && line.includes("Rishabh") && !line.includes("button"));
});

console.log("the Reject form");
test("it carries the record and the message to update, and requires a remark", () => {
  const view = rejectModal({ coll: "qualityInspections", id: "QI-0007", summary: "Inspection · PRJ-013", channel: "D123", ts: "170.1" });
  assert.strictEqual(view.type, "modal");
  assert.deepStrictEqual(JSON.parse(view.private_metadata), { coll: "qualityInspections", id: "QI-0007", channel: "D123", ts: "170.1" });
  const input = view.blocks.find((b) => b.type === "input");
  assert.strictEqual(input.element.type, "plain_text_input");
  assert.strictEqual(input.optional, undefined); // required
});
test("a submission is parsed back; an empty remark is flagged; a forged one is refused", () => {
  const view = rejectModal({ coll: "workMeasurements", id: "WM-0001", channel: "D1", ts: "9" });
  const submit = (value, meta) => ({ view: { callback_id: view.callback_id, private_metadata: meta ?? view.private_metadata, state: { values: { remark_block: { remark_input: { value } } } } } });
  assert.deepStrictEqual(parseRejectSubmission(submit("  redo the slab ")), { coll: "workMeasurements", id: "WM-0001", channel: "D1", ts: "9", remark: "redo the slab" });
  assert.strictEqual(parseRejectSubmission(submit("   ")).remark, "");
  assert.deepStrictEqual(remarkRequiredResponse().response_action, "errors");
  assert.strictEqual(parseRejectSubmission(submit("x", JSON.stringify({ coll: "users", id: "U-ADMIN" }))), null);   // a collection we don't approve
  assert.strictEqual(parseRejectSubmission(submit("x", "not json")), null);
  assert.strictEqual(parseRejectSubmission({ view: { callback_id: "something_else" } }), null);
  assert.strictEqual(parseRejectSubmission(null), null);
});

console.log("copy to an observer (Poorva)");
test("the copy is text-only, says who it went to, and carries the original text", () => {
  const t = observerCopyText("Rishabh Rajput", "📝 hello");
  assert.ok(t.includes("Copy of a Slack notification") && t.includes("Rishabh Rajput") && t.includes("📝 hello"));
  assert.ok(!observerCopyText("", "x").includes("sent to"));
});

console.log(`\n${passed} passed`);
