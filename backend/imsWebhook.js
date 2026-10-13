/* Pure parsing/sanitizing logic for IMS's PO webhook events — extracted so
   the actual decision logic (what to keep, what to strip, how to match a
   project, how to resolve create/update/delete) is unit-testable without a
   running HTTP server.

   IMS pushes event payloads (not a pull API) containing a LOT of
   sensitive/financial data — vendor bank account details, GST/PAN numbers,
   contact phone/email, payment-timeline amounts. None of that has any
   legitimate use in QC, which keeps Progress Analysis and the rest of this
   module deliberately non-financial (see progressAnalysis.js's own doc
   comment). sanitizePoEvent() therefore keeps ONLY what the Purchase
   Orders / Progress Analysis pages actually display — PO id/status/
   approvals/date/items(name+qty+unit)/delivery date/project reference/
   soft-delete state — and drops everything else, rather than storing the
   full payload and hoping nothing sensitive leaks into a later UI.

   LIFECYCLE: as of this module's current version, IMS only sends
   event:"PO_APPROVED" for every lifecycle change (create/update/delete),
   with the real action in `body.action` ("created"/"updated"/"deleted") as
   a workaround — IMS returns 400 for any other event name today. Once IMS
   is updated to send real "PO_UPDATED"/"PO_DELETED" event names, set
   VMS_PO_UPDATE_EVENT/VMS_PO_DELETE_EVENT in .env (see server.js) and
   those are accepted too — no code change needed, this module already
   treats `event` and `action` as two independent, equally-valid signals
   for the same thing and takes whichever is more specific. */

const VALID_ACTIONS = new Set(["created", "updated", "deleted"]);

function resolveAction(body, { updateEventName, deleteEventName } = {}) {
  // `action` is the authoritative signal when IMS sends it.
  if (VALID_ACTIONS.has(body.action)) return body.action;
  // Fall back to inferring from the event name, for whenever IMS starts
  // sending real lifecycle event names instead of always "PO_APPROVED".
  if (deleteEventName && body.event === deleteEventName) return "deleted";
  if (updateEventName && body.event === updateEventName) return "updated";
  if (body.event === "PO_APPROVED") return "created";
  return null;
}

function isAcceptedEvent(eventName, { updateEventName, deleteEventName } = {}) {
  return eventName === "PO_APPROVED" || eventName === updateEventName || eventName === deleteEventName;
}

/** `opts.updateEventName`/`opts.deleteEventName` are the real lifecycle
 *  event names IMS will eventually send (VMS_PO_UPDATE_EVENT/
 *  VMS_PO_DELETE_EVENT) — omit/leave falsy until IMS confirms, and
 *  "PO_APPROVED" keeps being accepted for every action regardless. */
function sanitizePoEvent(body, opts = {}) {
  if (!body || typeof body !== "object") return { valid: false, error: "Request body must be a JSON object" };
  if (!isAcceptedEvent(body.event, opts)) return { valid: false, error: `Unsupported event type: ${body.event}` };
  const data = body.data;
  if (!data || typeof data !== "object") return { valid: false, error: "Missing data object" };
  if (!data.poId) return { valid: false, error: "Missing data.poId" };

  const action = resolveAction(body, opts);
  const deleted = action === "deleted" || data.deleted === true;

  // A delete carries no reliable project/items payload (it's often just
  // {poId, deleted:true}) — only require the full shape for a create/update,
  // so a delete/restore ping is never rejected for a field it was never
  // going to send.
  if (!deleted) {
    if (!data.project || !data.project.name) return { valid: false, error: "Missing data.project.name" };
    if (!Array.isArray(data.items)) return { valid: false, error: "Missing data.items array" };
  }

  const items = Array.isArray(data.items) ? data.items.map((i) => ({
    itemName: i.itemName || "",
    sku: i.sku || "",
    category: i.category || "",
    qty: typeof i.qty === "number" ? i.qty : 0,
    unit: i.unit || ""
  })) : [];

  const approvalLevel = (a) => (a && a.status) ? { status: a.status, at: a.at || null } : null;
  const approvals = data.approvals ? {
    l1: approvalLevel(data.approvals.l1),
    l2: approvalLevel(data.approvals.l2),
    l3: approvalLevel(data.approvals.l3)
  } : null;

  return {
    valid: true,
    record: {
      id: data.poId,
      deleted,
      // Only overwritten for a create/update — a delete ping keeps
      // whatever project/items/status the record already had, since the
      // delete payload usually doesn't resend them.
      ...(deleted ? {} : {
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
        approvals,
        remark: data.remark || ""
      }),
      sourceUpdatedAt: typeof data.updatedAt === "string" ? Date.parse(data.updatedAt) || null : null,
      receivedAt: Date.now()
    }
  };
}

// A later-arriving webhook call for the same PO whose own `data.updatedAt`
// is OLDER than what's already stored is a reordered/retried delivery, not
// newer information — applying it would silently revert a newer status.
// Either side missing a timestamp means "can't tell, apply it" (never
// block on the one piece of real data because the clock is unset).
function isStaleUpdate(existingSourceUpdatedAt, incomingSourceUpdatedAt) {
  if (!existingSourceUpdatedAt || !incomingSourceUpdatedAt) return false;
  return incomingSourceUpdatedAt < existingSourceUpdatedAt;
}

// Exact, case-insensitive, trimmed match only — never a partial/fuzzy
// match, since a wrong project link is worse than an unmatched PO (which
// is at least visibly flagged as unmatched, not silently wrong).
function matchProjectByName(poProjectName, qcProjects) {
  const needle = String(poProjectName || "").trim().toLowerCase();
  if (!needle) return null;
  return (qcProjects || []).find((p) => String(p.name || "").trim().toLowerCase() === needle) || null;
}

module.exports = { sanitizePoEvent, matchProjectByName, isStaleUpdate, resolveAction };
