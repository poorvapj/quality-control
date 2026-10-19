/* Slack side of the team-leader approval flow — pure helpers (no Slack/Mongo
 * calls) so what a message says, what its buttons carry, and what a click is
 * allowed to touch are unit-testable without a running server.
 *
 * Buttons use the existing "<kind>:<entityId>" action_id convention (see
 * slackActions.js): "approval_approve:<collection>:<recordId>" and
 * "approval_reject:<collection>:<recordId>". Whatever a button carries is
 * untrusted input from Slack, so the collection is checked against a fixed
 * whitelist here, and the server still re-checks WHO clicked (their Slack
 * email must map to an app user) and applies the same rules as the app does
 * (approvalRules.js) — a button can never grant more than the app would.
 */

const APPROVAL_COLLECTIONS = ["qualityInspections", "materialMeasurements", "workMeasurements"];

const KIND_LABEL = {
  qualityInspections: "Inspection",
  materialMeasurements: "Measurement",
  workMeasurements: "Measurement"
};

/** One line saying which record this is — same wording as the app's lists. */
function describeRecord(coll, r) {
  if (coll === "qualityInspections") {
    return `${r.projectCode || "—"} · ${r.floorName || "—"}${r.unitName ? " / " + r.unitName : ""}${r.workType ? " · " + r.workType : ""} · ${r.result}`;
  }
  if (coll === "materialMeasurements") {
    return `${r.projectCode || "—"} · ${r.floorName || "—"} / ${r.unitName || "—"} · ${r.measuredQty} ${r.measuredUnit}`;
  }
  return `${r.projectCode || "—"} · ${r.category || "—"} · ${r.measuredQty} ${r.measuredUnit}`;
}

/** "qualityInspections:QI-0007" -> {coll, id}; anything else (or a collection we don't approve) -> null. */
function parseApprovalEntity(entityId) {
  const s = String(entityId || "");
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const coll = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!APPROVAL_COLLECTIONS.includes(coll) || !id) return null;
  return { coll, id };
}

const actionId = (kind, coll, id) => `${kind}:${coll}:${id}`;

/** The DM the team leader gets when a member's work is waiting on them. */
function approvalRequestText(coll, rec) {
  const lines = [`📝 *${KIND_LABEL[coll]} awaiting your approval* — ${describeRecord(coll, rec)}`];
  lines.push(`By ${rec.inspectorName || rec.recordedByName || "—"} · ${rec.inspectionDate || rec.measurementDate || "—"}`);
  const failed = (rec.checklistItems || []).filter((c) => c.status === "Not OK").slice(0, 5);
  for (const c of failed) lines.push(`• ✕ ${c.text}${c.remarks ? ` — _${c.remarks}_` : ""}`);
  if (rec.remarks) lines.push(`> ${rec.remarks}`);
  return lines.join("\n");
}

function approvalRequestBlocks(coll, rec) {
  const text = approvalRequestText(coll, rec);
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text } }
  ];
  for (const p of (rec.photos || []).slice(0, 4)) {
    if (p && p.url) blocks.push({ type: "image", image_url: p.url, alt_text: `${KIND_LABEL[coll]} photo` });
  }
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Approve" }, style: "primary", action_id: actionId("approval_approve", coll, rec.id), value: rec.id },
      { type: "button", text: { type: "plain_text", text: "Reject" }, style: "danger", action_id: actionId("approval_reject", coll, rec.id), value: rec.id }
    ]
  });
  return { text, blocks };
}

/** What the author is told once their work has been decided. */
function approvalDecisionText({ coll, rec, status, remark, byName }) {
  const what = `${KIND_LABEL[coll]} ${describeRecord(coll, rec)}`;
  return status === "approved"
    ? `✅ Your ${what} was *approved*${byName ? ` by ${byName}` : ""}.`
    : `↩️ Your ${what} was *sent back*${byName ? ` by ${byName}` : ""} to redo.${remark ? `\n> ${remark}` : ""}`;
}

/** The text the leader's own message becomes after they decide (buttons gone). */
function approvalResultLine({ coll, rec, status, remark, byName }) {
  const what = `${KIND_LABEL[coll]} ${describeRecord(coll, rec)}`;
  return status === "approved"
    ? `✅ ${what} — *approved* by ${byName || "you"}.`
    : `↩️ ${what} — *sent back* by ${byName || "you"}.${remark ? `\n> ${remark}` : ""}`;
}

const REMARK_BLOCK = "remark_block";
const REMARK_INPUT = "remark_input";
const REJECT_CALLBACK = "approval_reject_submit";

/** The small form Reject opens — a remark is required, the same as in the app.
 *  private_metadata carries which record and which message to update afterwards. */
function rejectModal({ coll, id, summary, channel, ts }) {
  return {
    type: "modal",
    callback_id: REJECT_CALLBACK,
    private_metadata: JSON.stringify({ coll, id, channel: channel || null, ts: ts || null }),
    title: { type: "plain_text", text: "Send back to redo" },
    submit: { type: "plain_text", text: "Send back" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      ...(summary ? [{ type: "section", text: { type: "mrkdwn", text: String(summary).slice(0, 280) } }] : []),
      {
        type: "input",
        block_id: REMARK_BLOCK,
        label: { type: "plain_text", text: "What should be redone?" },
        element: { type: "plain_text_input", action_id: REMARK_INPUT, multiline: true, max_length: 500 }
      }
    ]
  };
}

/** Pull what the leader typed, and which record, out of a view_submission payload. */
function parseRejectSubmission(payload) {
  const view = payload && payload.view;
  if (!view || view.callback_id !== REJECT_CALLBACK) return null;
  let meta;
  try { meta = JSON.parse(view.private_metadata || "{}"); } catch { return null; }
  if (!APPROVAL_COLLECTIONS.includes(meta.coll) || !meta.id) return null;
  const value = view.state && view.state.values && view.state.values[REMARK_BLOCK] && view.state.values[REMARK_BLOCK][REMARK_INPUT]
    ? view.state.values[REMARK_BLOCK][REMARK_INPUT].value
    : "";
  return { coll: meta.coll, id: meta.id, channel: meta.channel, ts: meta.ts, remark: String(value || "").trim() };
}

/** Slack's reply to a submission with no remark — shown under the field, modal stays open. */
const remarkRequiredResponse = () => ({ response_action: "errors", errors: { [REMARK_BLOCK]: "Please say what should be redone." } });

/** Text of the copy that goes to an observer (e.g. Poorva) alongside any
 *  notification sent to someone else. Text only — no buttons, so a copy can
 *  never be clicked as if it were the real request. */
function observerCopyText(sentToLabel, text) {
  return `📋 _Copy of a Slack notification${sentToLabel ? ` sent to *${sentToLabel}*` : ""}_\n${text}`;
}

module.exports = {
  APPROVAL_COLLECTIONS, KIND_LABEL, describeRecord, parseApprovalEntity, approvalRequestText, approvalRequestBlocks,
  approvalDecisionText, approvalResultLine, rejectModal, parseRejectSubmission, remarkRequiredResponse, observerCopyText,
  REJECT_CALLBACK
};
