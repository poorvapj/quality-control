/* ===========================================================================
   Shared list-row renderers used by Dashboard, My Work, Snags and the Drawer.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state, esc, toast } from "../state/appState.js";
import { Store } from "../services/store.js";
import { byId, myRole, refLabel } from "../modules/helpers.js";
import { dueLabel, ago } from "../modules/helpers.js";
import { logEvent } from "../modules/actions.js";
import { reopenDrawer } from "./drawer.js";

export function assignRow(a) {
  const d = dueLabel(a.dueAt);
  const target = a.targetType === "unit" ? refLabel("units", a.targetId) : refLabel("floors", a.targetId);
  const mine = a.assignedTo === state.currentUserId || myRole() === "DRI";
  const actions = mine
    ? (a.status === "Assigned"
        ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); setAssignStatus('${a.id}','Accepted')">Accept</button>`
        : "") +
      `<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); setAssignStatus('${a.id}','Done')">Done</button>`
    : `<span class="badge-tag mute">${esc(a.status)}</span>`;

  return `<div class="qitem ${d.cls === "fail" ? "alert" : ""}" onclick="openDrawer('${a.targetType}:${a.targetId}')">
    <div class="qitem-main">
      <div class="qitem-title">📌 ${esc(target)} · ${esc(refLabel("stages", a.stageId))}</div>
      <div class="qitem-sub">${esc(a.note || "Assigned work")} · from ${esc(refLabel("users", a.assignedBy))} ${ago(a.assignedAt)}</div>
    </div>
    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
      <span class="badge-tag ${d.cls}">${d.text}</span>
      ${actions}
    </div>
  </div>`;
}

export function setAssignStatus(id, status) {
  const a = byId("assignments", id);
  if (!a) return;
  const rec = Object.assign({}, a, { status });
  if (status === "Done") { rec.doneAt = Date.now(); rec.doneBy = state.currentUserId; }
  Store.apply([
    { op: "upsert", coll: "assignments", rec },
    logEvent("ASSIGN_" + status.toUpperCase(), a.targetId, a.stageId, status + " by " + refLabel("users", state.currentUserId))
  ]);
  if (state.openDrawerId) reopenDrawer();
  toast("Assignment marked " + status.toLowerCase());
}

export function snagRow(s) {
  const d = dueLabel(s.dueAt);
  return `<div class="qitem ${s.severity === "Critical" ? "alert" : ""}" onclick="event.stopPropagation(); openDrawer('snag:${s.id}')">
    <div class="qitem-main">
      <div class="qitem-title">🐞 ${esc(s.title)}</div>
      <div class="qitem-sub">${esc(snagTargetLabel(s))} · ${esc(refLabel("stages", s.stageId))} · raised by ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)}</div>
    </div>
    <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
      <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
      <span class="badge-tag ${d.cls}">${d.text}</span>
    </div>
  </div>`;
}

/* Local wrapper avoids importing modules/rules.js just for one label helper
   (kept out of a circular import between rows/rules/masters). */
function snagTargetLabel(s) {
  return s.unitId ? refLabel("units", s.unitId) : s.floorId ? refLabel("floors", s.floorId) : "—";
}
