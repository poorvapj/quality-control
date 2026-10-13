/* Pure validation for materialMeasurements writes — extracted so the rule
   itself is unit-testable without a running HTTP server. Store integration
   is deferred (see types/index.ts's doc comment on MaterialMeasurement), so
   there is no "issued quantity" to reconcile these numbers against yet —
   this only enforces that every quantity is a real, non-negative number,
   not a cross-check against a store ledger that doesn't exist. */
function validateMeasurement(rec) {
  const fields = [
    ["measuredQty", rec.measuredQty],
    ["materialConsumedQty", rec.materialConsumedQty],
    ["unusedBalanceQty", rec.unusedBalanceQty],
    ["wastageQty", rec.wastageQty]
  ];
  for (const [name, value] of fields) {
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
      return `"${name}" must be a non-negative number`;
    }
  }
  if (!rec.measuredUnit || !String(rec.measuredUnit).trim()) return '"measuredUnit" is required';
  if (!rec.materialUnit || !String(rec.materialUnit).trim()) return '"materialUnit" is required';
  return null; // valid
}

module.exports = { validateMeasurement };
