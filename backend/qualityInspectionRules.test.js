const assert = require("assert");
const { shouldResolveOriginal, enforceResultFromChecklist } = require("./qualityInspectionRules.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok -", name); }
  catch (e) { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; }
}

test("a Pass with no reInspectionOf does not resolve anything", () => {
  assert.strictEqual(shouldResolveOriginal({ result: "Pass", reInspectionOf: null }), false);
});

test("a Fail with a reInspectionOf set does not resolve the original (only a Pass closes the loop)", () => {
  assert.strictEqual(shouldResolveOriginal({ result: "Fail", reInspectionOf: "QI-0001" }), false);
});

test("Rework Required with a reInspectionOf set does not resolve the original", () => {
  assert.strictEqual(shouldResolveOriginal({ result: "Rework Required", reInspectionOf: "QI-0001" }), false);
});

test("a Pass that references what it re-inspected resolves the original", () => {
  assert.strictEqual(shouldResolveOriginal({ result: "Pass", reInspectionOf: "QI-0001" }), true);
});

test("a checklist item marked Not OK forces result to Fail, overriding whatever the client sent", () => {
  const rec = { result: "Rework Required", checklistItems: [{ text: "a", status: "OK" }, { text: "b", status: "Not OK" }] };
  enforceResultFromChecklist(rec);
  assert.strictEqual(rec.result, "Fail");
});

test("no Not OK items leaves the client's result untouched", () => {
  const rec = { result: "Pass", checklistItems: [{ text: "a", status: "OK" }, { text: "b", status: "N/A" }] };
  enforceResultFromChecklist(rec);
  assert.strictEqual(rec.result, "Pass");
});

test("a record with no checklistItems at all is left untouched", () => {
  const rec = { result: "Rework Required" };
  enforceResultFromChecklist(rec);
  assert.strictEqual(rec.result, "Rework Required");
});

console.log(`\n${passed} passed`);
if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
