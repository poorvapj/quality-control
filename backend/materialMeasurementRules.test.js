const assert = require("assert");
const { validateMeasurement } = require("./materialMeasurementRules.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

const base = {
  measuredQty: 10, measuredUnit: "R.ft",
  materialConsumedQty: 12, materialUnit: "bags",
  unusedBalanceQty: 1, wastageQty: 0.5
};

test("accepts a fully valid record", () => {
  assert.strictEqual(validateMeasurement(base), null);
});

test("rejects negative measuredQty", () => {
  assert.ok(validateMeasurement({ ...base, measuredQty: -1 }));
});

test("rejects missing/NaN materialConsumedQty", () => {
  assert.ok(validateMeasurement({ ...base, materialConsumedQty: NaN }));
  assert.ok(validateMeasurement({ ...base, materialConsumedQty: undefined }));
});

test("rejects non-numeric unusedBalanceQty", () => {
  assert.ok(validateMeasurement({ ...base, unusedBalanceQty: "1" }));
});

test("rejects negative wastageQty", () => {
  assert.ok(validateMeasurement({ ...base, wastageQty: -0.1 }));
});

test("accepts zero for all quantity fields", () => {
  assert.strictEqual(validateMeasurement({ ...base, measuredQty: 0, materialConsumedQty: 0, unusedBalanceQty: 0, wastageQty: 0 }), null);
});

test("rejects missing measuredUnit", () => {
  assert.ok(validateMeasurement({ ...base, measuredUnit: "" }));
});

test("rejects missing materialUnit", () => {
  assert.ok(validateMeasurement({ ...base, materialUnit: "   " }));
});

console.log(`\n${passed} passed`);
if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
