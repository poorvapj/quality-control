const assert = require("assert");
const { deriveApprovalOnCreate, resolveApprovalOnUpdate } = require("./approvalRules.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

// Fixtures: Rishabh leads a team with Naman and Shubham.
const users = [
  { id: "RISHABH", name: "Rishabh Rajput", teamId: undefined },
  { id: "NAMAN", name: "Naman Jha", teamId: "T1" },
  { id: "SHUBHAM", name: "Shubham K", teamId: "T1" },
  { id: "LONE", name: "No Team" },
  { id: "LEADER2", name: "Leads Self", teamId: "T2" }
];
const teams = [{ id: "T1", leaderId: "RISHABH" }, { id: "T2", leaderId: "LEADER2" }];
const pending = { status: "pending", approverUserId: "RISHABH", approverName: "Rishabh Rajput" };
const stored = (approval) => ({ id: "QI-1", inspectorUserId: "NAMAN", approval });
const ask = (existing, wanted, session, now = 1000) =>
  resolveApprovalOnUpdate({ existing, incoming: { approval: wanted }, session, creatorId: "NAMAN", now });

console.log("on create");
test("a team member's new record is created pending and names the leader as approver", () => {
  assert.deepStrictEqual(deriveApprovalOnCreate({ creatorId: "NAMAN", users, teams }), pending);
});
test("no approval for someone on no team, for a leader, or for an unknown/admin id", () => {
  assert.strictEqual(deriveApprovalOnCreate({ creatorId: "LONE", users, teams }), null);
  assert.strictEqual(deriveApprovalOnCreate({ creatorId: "LEADER2", users, teams }), null); // leads their own team
  assert.strictEqual(deriveApprovalOnCreate({ creatorId: "U-ADMIN", users, teams }), null);
  assert.strictEqual(deriveApprovalOnCreate({ creatorId: "RISHABH", users, teams }), null);
});

console.log("on update");
test("the leader can approve a pending record; decision is stamped server-side", () => {
  const r = ask(stored(pending), { status: "approved", decidedByUserId: "FORGED", decidedAt: 1 }, { userId: "RISHABH" }, 5000);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.approval.status, "approved");
  assert.strictEqual(r.approval.decidedByUserId, "RISHABH"); // not the forged one
  assert.strictEqual(r.approval.decidedAt, 5000);
});
test("rejecting needs a remark; with one it is rejected and the remark is kept", () => {
  const no = ask(stored(pending), { status: "rejected" }, { userId: "RISHABH" });
  assert.strictEqual(no.ok, false); assert.strictEqual(no.status, 400);
  const yes = ask(stored(pending), { status: "rejected", remark: "  Wrong floor measured  " }, { userId: "RISHABH" });
  assert.strictEqual(yes.ok, true);
  assert.strictEqual(yes.approval.status, "rejected");
  assert.strictEqual(yes.approval.remark, "Wrong floor measured");
});
test("an Admin may decide it", () => {
  assert.strictEqual(ask(stored(pending), { status: "approved" }, { userId: "U-ADMIN", isAdmin: true }).ok, true);
});
test("the member can't approve their own work, and another member can't either", () => {
  const self = ask(stored(pending), { status: "approved" }, { userId: "NAMAN" });
  assert.strictEqual(self.ok, false); assert.strictEqual(self.status, 403);
  assert.strictEqual(ask(stored(pending), { status: "approved" }, { userId: "SHUBHAM" }).ok, false);
});
test("even an approver who is also the creator can't self-approve (admin who recorded it)", () => {
  const r = resolveApprovalOnUpdate({
    existing: { approval: pending }, incoming: { approval: { status: "approved" } },
    session: { userId: "U-ADMIN", isAdmin: true }, creatorId: "U-ADMIN"
  });
  assert.strictEqual(r.ok, false);
});
test("decided records are final: approved/rejected can't be flipped or reopened", () => {
  const approved = { status: "approved", approverUserId: "RISHABH" };
  assert.strictEqual(ask(stored(approved), { status: "rejected", remark: "x" }, { userId: "RISHABH" }).ok, false);
  assert.strictEqual(ask(stored({ ...approved, status: "rejected" }), { status: "pending" }, { userId: "RISHABH" }).approval.status, "rejected");
});
test("client can't add approval to a record that had none, nor strip or rewrite an existing one", () => {
  assert.strictEqual(resolveApprovalOnUpdate({ existing: { id: "x" }, incoming: { approval: { status: "approved" } }, session: { userId: "RISHABH" }, creatorId: "NAMAN" }).approval, undefined);
  assert.deepStrictEqual(resolveApprovalOnUpdate({ existing: stored(pending), incoming: {}, session: { userId: "NAMAN" }, creatorId: "NAMAN" }).approval, pending); // omitted -> kept
  const tamper = ask(stored(pending), { status: "pending", approverUserId: "NAMAN" }, { userId: "NAMAN" });
  assert.strictEqual(tamper.approval.approverUserId, "RISHABH"); // approver can't be swapped
});
test("an unknown status is rejected", () => {
  assert.strictEqual(ask(stored(pending), { status: "banana" }, { userId: "RISHABH" }).status, 400);
});

console.log("older records (saved before approval existed, so no approval stored)");
const legacy = { id: "QI-OLD", inspectorUserId: "NAMAN" }; // no approval field at all
const askLegacy = (wanted, session, creatorId = "NAMAN") =>
  resolveApprovalOnUpdate({ existing: legacy, incoming: { approval: wanted }, session, creatorId, users, teams, now: 7000 });
test("the author's team leader can approve or reject an older record", () => {
  const approved = askLegacy({ status: "approved" }, { userId: "RISHABH" });
  assert.strictEqual(approved.ok, true);
  assert.strictEqual(approved.approval.status, "approved");
  assert.strictEqual(approved.approval.approverUserId, "RISHABH");
  assert.strictEqual(approved.approval.decidedByUserId, "RISHABH");
  const noRemark = askLegacy({ status: "rejected" }, { userId: "RISHABH" });
  assert.strictEqual(noRemark.ok, false); assert.strictEqual(noRemark.status, 400); // a remark is still required
  assert.strictEqual(askLegacy({ status: "rejected", remark: "redo" }, { userId: "RISHABH" }).approval.status, "rejected");
});
test("Admin may too, but the author and other people may not", () => {
  assert.strictEqual(askLegacy({ status: "approved" }, { userId: "U-ADMIN", isAdmin: true }).ok, true);
  assert.strictEqual(askLegacy({ status: "approved" }, { userId: "NAMAN" }).ok, false);   // own work
  assert.strictEqual(askLegacy({ status: "approved" }, { userId: "SHUBHAM" }).ok, false); // a teammate
  assert.strictEqual(askLegacy({ status: "approved" }, { userId: "LEADER2" }).ok, false); // another team's leader
});
test("an older record by someone on no team (or a team leader) gets no approval - it stays free", () => {
  const free = resolveApprovalOnUpdate({ existing: { id: "x" }, incoming: { approval: { status: "approved" } }, session: { userId: "RISHABH" }, creatorId: "LONE", users, teams });
  assert.strictEqual(free.ok, true); assert.strictEqual(free.approval, undefined);
  const leader = resolveApprovalOnUpdate({ existing: { id: "x" }, incoming: { approval: { status: "approved" } }, session: { userId: "RISHABH" }, creatorId: "LEADER2", users, teams });
  assert.strictEqual(leader.approval, undefined);
});
test("a client still cannot attach a PENDING approval to an older record", () => {
  const r = askLegacy({ status: "pending", approverUserId: "NAMAN" }, { userId: "NAMAN" });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.approval, undefined);
});

console.log(`\n${passed} passed`);
