/* Pure parsing/sanitizing logic for the IMS "PO_APPROVED" webhook event —
   extracted so the actual decision logic (what to keep, what to strip, how
   to match a project) is unit-testable without a running HTTP server.

   IMS pushes an event payload (not a pull API) containing a LOT of
   sensitive/financial data — vendor bank account details, GST/PAN numbers,
   contact phone/email, payment-timeline amounts, per-level approval
   signatures. None of that has any legitimate use in QC, which keeps
   Progress Analysis and the rest of this module deliberately non-
   financial (see progressAnalysis.js's own doc comment). sanitizePoEvent()
   therefore keeps ONLY what Progress Analysis actually displays —
   PO id/status/date/items(name+qty+unit)/delivery date/project reference —
   and drops everything else, rather than storing the full payload and
   hoping nothing sensitive leaks into a later UI. */

function sanitizePoEvent(body) {
  if (!body || typeof body !== "object") return { valid: false, error: "Request body must be a JSON object" };
  if (body.event !== "PO_APPROVED") return { valid: false, error: `Unsupported event type: ${body.event}` };
  const data = body.data;
  if (!data || typeof data !== "object") return { valid: false, error: "Missing data object" };
  if (!data.poId) return { valid: false, error: "Missing data.poId" };
  if (!data.project || !data.project.name) return { valid: false, error: "Missing data.project.name" };
  if (!Array.isArray(data.items)) return { valid: false, error: "Missing data.items array" };

  const items = data.items.map((i) => ({
    itemName: i.itemName || "",
    sku: i.sku || "",
    category: i.category || "",
    qty: typeof i.qty === "number" ? i.qty : 0,
    unit: i.unit || ""
  }));

  return {
    valid: true,
    record: {
      id: data.poId,
      projectNameRaw: data.project.name,
      phase: data.project.phase || "",
      workType: data.project.workType || "",
      milestone: data.project.milestone || "",
      vendorName: (data.vendor && data.vendor.name) || "",
      status: data.status || "",
      priority: data.priority || "",
      date: data.date || "",
      deliveryDate: (data.deliveryDetails && data.deliveryDetails.deliveryDate) || "",
      items,
      remark: data.remark || "",
      receivedAt: Date.now()
    }
  };
}

// Exact, case-insensitive, trimmed match only — never a partial/fuzzy
// match, since a wrong project link is worse than an unmatched PO (which
// is at least visibly flagged as unmatched, not silently wrong).
function matchProjectByName(poProjectName, qcProjects) {
  const needle = String(poProjectName || "").trim().toLowerCase();
  if (!needle) return null;
  return (qcProjects || []).find((p) => String(p.name || "").trim().toLowerCase() === needle) || null;
}

module.exports = { sanitizePoEvent, matchProjectByName };
