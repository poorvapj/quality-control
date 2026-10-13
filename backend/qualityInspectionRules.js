/* Pure decision logic for qualityInspections writes (server.js's applyOps
   branch calls these) — extracted so the actual business rules are
   unit-testable without a running HTTP server or a real Mongo connection.
   Notification-on-assignment is NOT handled here any more: a Fail/Rework
   result creates a real Snag (op: upsert, coll: "snags") in the same
   client apply() batch, and server.js's existing snags-upsert branch
   already notifies the assignee on a brand-new/reassigned snag — reusing
   that system instead of duplicating it here. */

// A passing re-inspection resolves (closes) the ORIGINAL failed
// inspection's linked Snag — only ever true for a Pass result that
// explicitly references what it's re-checking.
function shouldResolveOriginal(rec) {
  return rec.result === "Pass" && !!rec.reInspectionOf;
}

module.exports = { shouldResolveOriginal };
