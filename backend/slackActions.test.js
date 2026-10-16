const assert = require("assert");
const crypto = require("crypto");
const { verifySlackSignature, parseSlackActionPayload, parseActionId, snagCloseBlocks, teamReportApproveBlocks } = require("./slackActions");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("PASS:", name); }
  catch (e) { failed++; console.error("FAIL:", name, "-", e.message); }
}

function sign(secret, timestamp, rawBody) {
  const base = `v0:${timestamp}:${rawBody}`;
  return "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
}

test("verifySlackSignature: accepts a correctly-signed, fresh request", () => {
  const secret = "test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = "payload=%7B%7D";
  const signature = sign(secret, timestamp, rawBody);
  assert.strictEqual(verifySlackSignature({ signingSecret: secret, timestamp, rawBody, signature }), true);
});

test("verifySlackSignature: rejects a wrong signature", () => {
  const secret = "test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.strictEqual(
    verifySlackSignature({ signingSecret: secret, timestamp, rawBody: "payload=%7B%7D", signature: "v0=deadbeef" }),
    false
  );
});

test("verifySlackSignature: rejects a stale timestamp (replay protection)", () => {
  const secret = "test-secret";
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes old
  const rawBody = "payload=%7B%7D";
  const signature = sign(secret, staleTimestamp, rawBody);
  assert.strictEqual(verifySlackSignature({ signingSecret: secret, timestamp: staleTimestamp, rawBody, signature }), false);
});

test("verifySlackSignature: rejects when any required field is missing", () => {
  assert.strictEqual(verifySlackSignature({ signingSecret: "", timestamp: "1", rawBody: "a", signature: "v0=x" }), false);
  assert.strictEqual(verifySlackSignature({ signingSecret: "s", timestamp: "", rawBody: "a", signature: "v0=x" }), false);
});

test("parseSlackActionPayload: parses the urlencoded payload field", () => {
  const body = "payload=" + encodeURIComponent(JSON.stringify({ actions: [{ action_id: "snag_close:SNG-0001" }], user: { id: "U123" } }));
  const parsed = parseSlackActionPayload(body);
  assert.strictEqual(parsed.actions[0].action_id, "snag_close:SNG-0001");
  assert.strictEqual(parsed.user.id, "U123");
});

test("parseSlackActionPayload: null when payload field is missing or invalid JSON", () => {
  assert.strictEqual(parseSlackActionPayload("foo=bar"), null);
  assert.strictEqual(parseSlackActionPayload("payload=" + encodeURIComponent("not json")), null);
});

test("parseActionId: splits kind and entityId on the first colon", () => {
  assert.deepStrictEqual(parseActionId("snag_close:SNG-0001"), { kind: "snag_close", entityId: "SNG-0001" });
  assert.deepStrictEqual(parseActionId("team_report_approve:TDR-TEAM-0001-2026-10-16"), { kind: "team_report_approve", entityId: "TDR-TEAM-0001-2026-10-16" });
});

test("parseActionId: null when there's no colon", () => {
  assert.strictEqual(parseActionId("snag_close"), null);
  assert.strictEqual(parseActionId(""), null);
  assert.strictEqual(parseActionId(undefined), null);
});

test("snagCloseBlocks: button value matches the given snag id", () => {
  const blocks = snagCloseBlocks("Snag *Foo*", "SNG-0007");
  const button = blocks[1].elements[0];
  assert.strictEqual(button.action_id, "snag_close:SNG-0007");
  assert.strictEqual(button.value, "SNG-0007");
});

test("teamReportApproveBlocks: button value matches the given report id", () => {
  const blocks = teamReportApproveBlocks("Report text", "TDR-TEAM-0001-2026-10-16");
  const button = blocks[1].elements[0];
  assert.strictEqual(button.action_id, "team_report_approve:TDR-TEAM-0001-2026-10-16");
  assert.strictEqual(button.value, "TDR-TEAM-0001-2026-10-16");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
