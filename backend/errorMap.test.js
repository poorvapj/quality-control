/* Tests for errorMap.js. Run with: node errorMap.test.js */
const assert = require("assert");
const { classifyError, isTransientDbError } = require("./errorMap.js");

let passed = 0, started = 0;
process.on("exit", (code) => { if (code === 0 && passed !== started) { console.error(`FAIL - ${started - passed} test(s) failed or never finished`); process.exitCode = 1; } });
function test(name, fn) {
  started++;
  try { fn(); passed++; console.log("  ok -", name); } catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}
const err = (props, msg = "x") => Object.assign(new Error(msg), props);

test("duplicate key -> 409, names the field, never echoes the value", () => {
  const r = classifyError(err({ code: 11000, keyPattern: { email: 1 }, keyValue: { email: "secret@example.com" } }, 'E11000 dup key: { email: "secret@example.com" }'));
  assert.strictEqual(r.status, 409);
  assert.ok(/email/.test(r.message) && !/secret@example\.com/.test(r.message) && !/E11000/.test(r.message));
});
test("duplicate key without keyPattern still -> 409 with a generic message", () => {
  const r = classifyError(err({ code: 11000 })); assert.strictEqual(r.status, 409); assert.ok(r.message.length > 5);
});
test("transient errors (network, selection, timeout, failover codes, labels) -> 503", () => {
  for (const e of [
    err({ name: "MongoNetworkError" }), err({ name: "MongoServerSelectionError" }), err({ name: "MongoNetworkTimeoutError" }), err({ name: "MongoPoolClearedError" }),
    err({ code: 91 }), err({ code: 10107 }), err({ code: 11600 }), err({ code: 189 }), err({ code: "ECONNRESET" }), err({ code: "ETIMEDOUT" }),
    err({ hasErrorLabel: (l) => l === "TransientTransactionError" }), err({ hasErrorLabel: (l) => l === "RetryableWriteError" })
  ]) { const r = classifyError(e); assert.strictEqual(r.status, 503, JSON.stringify(e.name || e.code)); assert.ok(!/ECONN|Mongo/.test(r.message)); }
});
test("everything else keeps the old behaviour: 400 with the error's own message", () => {
  const r = classifyError(new Error("ops[] required")); assert.deepStrictEqual(r, { status: 400, message: "ops[] required" });
  assert.strictEqual(classifyError(err({ code: 121 }, "Document failed validation")).status, 400);
  assert.strictEqual(classifyError(null).status, 400); assert.strictEqual(classifyError(undefined).status, 400);
});
test("a throwing label lookup cannot break classification", () => {
  assert.strictEqual(isTransientDbError(err({ hasErrorLabel() { throw new Error("boom"); } })), false);
});
test("an ordinary validation error that merely mentions a code word is not transient", () => {
  assert.strictEqual(classifyError(new Error("ETIMEDOUT mentioned in text only")).status, 400);
});

console.log(`\n${passed} passed`);
