/* ===========================================================================
   Snags page — list/filter, raise modal, status actions, CSV export.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc, toast } from "../state/appState.js";
import { Store } from "../services/store.js";
import { SEVERITIES, HOUR } from "../services/config.js";
import { coll, byId, nextId, refLabel, dueLabel, ago } from "../modules/helpers.js";
import { projectUnits, trackStages, snagTarget } from "../modules/rules.js";
import { downloadCsv } from "../services/csv.js";
import { logEvent } from "../modules/actions.js";
import { showModal, closeModal } from "../main.js";
import { reopenDrawer } from "../components/drawer.js";

export function renderSnags() {
  const q = ($("snagSearch").value || "").toLowerCase();
  const fs = $("snagStatusFilter").value;
  const fv = $("snagSevFilter").value;
  const fm = $("snagMineFilter").value;

  let list = coll("snags").filter((s) => s.projectId === state.currentProjectId);
  if (fs) list = list.filter((s) => s.status === fs);
  if (fv) list = list.filter((s) => s.severity === fv);
  if (fm === "mine") list = list.filter((s) => s.assignedTo === state.currentUserId);
  if (fm === "raised") list = list.filter((s) => s.raisedBy === state.currentUserId);
  if (q) {
    list = list.filter((s) =>
      (s.title + " " + (s.description || "") + " " + snagTarget(s)).toLowerCase().includes(q));
  }
  list.sort((a, b) => (b.status === "Closed" ? -1 : 1) - (a.status === "Closed" ? -1 : 1) || (b.raisedAt || 0) - (a.raisedAt || 0));

  const all = coll("snags").filter((s) => s.projectId === state.currentProjectId);
  const open = all.filter((s) => s.status !== "Closed");
  const overdue = open.filter((s) => s.dueAt && s.dueAt < Date.now());
  $("snagSubtitle").innerText = `${open.length} open · ${overdue.length} overdue · ${all.length - open.length} closed`;

  $("snagList").innerHTML = list.length
    ? list.map((s) => {
        const d = dueLabel(s.dueAt);
        const closed = s.status === "Closed";
        return `<div class="qitem ${!closed && s.severity === "Critical" ? "alert" : ""}" onclick="openDrawer('snag:${s.id}')" style="${closed ? "opacity:0.6;" : ""}">
          <div class="qitem-main">
            <div class="qitem-title">${esc(s.id)} · ${esc(s.title)}</div>
            <div class="qitem-sub">
              ${esc(snagTarget(s))} · ${esc(refLabel("stages", s.stageId))} ·
              ${s.paramId ? esc(refLabel("qparams", s.paramId)) + " · " : ""}
              raised by ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)} ·
              on ${esc(refLabel("users", s.assignedTo))}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
            <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
            <span class="badge-tag ${closed ? "pass" : s.status === "In Progress" ? "wip" : "fail"}">${esc(s.status)}</span>
            ${closed ? "" : `<span class="badge-tag ${d.cls}">${d.text}</span>`}
          </div>
        </div>`;
      }).join("")
    : `<div class="empty">No snags match these filters.</div>`;
}

export function openSnagModal(unitId, stageId, preset) {
  $("modalBox").className = "modal-box";
  $("modalSub").innerText = "RAISE SNAG";
  $("modalTitle").innerText = "New snag";
  const dueDefault = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16);

  $("modalContent").innerHTML = `<div class="form-grid">
    <div class="field full"><label>Title *</label><input class="input" id="sngTitle" value="${esc(preset || "")}" placeholder="Short, specific: what is wrong and where"></div>
    <div class="field"><label>Unit *</label><select class="select" id="sngUnit">${projectUnits().map((u) => `<option value="${u.id}" ${u.id === unitId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Stage</label><select class="select" id="sngStage">${trackStages("unit").map((x) => `<option value="${x.stage.id}" ${x.stage.id === stageId ? "selected" : ""}>${esc(x.stage.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Quality parameter</label><select class="select" id="sngParam"><option value="">—</option>${coll("qparams").filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${esc(p.code)} · ${esc(p.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Severity *</label><select class="select" id="sngSev">${SEVERITIES.map((s) => `<option value="${s}" ${s === "Major" ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="field"><label>Assign to *</label><select class="select" id="sngUser">${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.role)}</option>`).join("")}</select></div>
    <div class="field"><label>Due by</label><input class="input" type="datetime-local" id="sngDue" value="${dueDefault}"></div>
    <div class="field full"><label>Description</label><textarea class="textarea" id="sngDesc" placeholder="Extent, location within the unit, and what rectification is expected."></textarea></div>
  </div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveSnag()">Raise snag</button>`;
  showModal();
}

export function saveSnag() {
  const title = $("sngTitle").value.trim();
  if (!title) return toast("Give the snag a title");
  const rec = {
    id: nextId("SNG", "snags"),
    projectId: state.currentProjectId,
    unitId: $("sngUnit").value,
    stageId: $("sngStage").value,
    paramId: $("sngParam").value,
    title,
    description: $("sngDesc").value.trim(),
    severity: $("sngSev").value,
    status: "Open",
    raisedBy: state.currentUserId,
    raisedAt: Date.now(),
    assignedTo: $("sngUser").value,
    dueAt: $("sngDue").value ? new Date($("sngDue").value).getTime() : null,
    photos: [], comments: []
  };
  Store.apply([
    { op: "upsert", coll: "snags", rec },
    logEvent("SNAG_RAISE", rec.unitId, rec.stageId, title)
  ]);
  closeModal();
  toast("Snag " + rec.id + " raised");
}

export function setSnagStatus(id, status) {
  const s = byId("snags", id);
  const patch = Object.assign({}, s, { status });
  if (status === "Closed") { patch.closedAt = Date.now(); patch.closedBy = state.currentUserId; }
  else { patch.closedAt = null; patch.closedBy = null; } // null clears on merge
  Store.apply([
    { op: "upsert", coll: "snags", rec: patch },
    logEvent("SNAG_" + status.toUpperCase().replace(" ", "_"), s.unitId, s.stageId, s.title)
  ]);
  reopenDrawer();
  toast("Snag " + status.toLowerCase());
}

export function saveSnagAssignee(id) {
  const s = byId("snags", id);
  const to = $("snagAssignee").value;
  Store.apply([
    { op: "upsert", coll: "snags", rec: Object.assign({}, s, { assignedTo: to }) },
    logEvent("SNAG_REASSIGN", s.unitId, s.stageId, "to " + refLabel("users", to))
  ]);
  reopenDrawer();
  toast("Reassigned to " + refLabel("users", to));
}

export function exportSnagCsv() {
  const head = ["Snag ID", "Unit", "Floor", "Stage", "Parameter", "Title", "Description", "Severity", "Status",
                "Raised by", "Raised at", "Assigned to", "Due at", "Closed at", "Closed by", "Hours open"];
  const body = coll("snags").filter((s) => s.projectId === state.currentProjectId).map((s) => {
    const unit = byId("units", s.unitId);
    const end = s.closedAt || Date.now();
    return [
      s.id, snagTarget(s), unit ? refLabel("floors", unit.floorId) : (s.floorId ? refLabel("floors", s.floorId) : ""),
      refLabel("stages", s.stageId), s.paramId ? refLabel("qparams", s.paramId) : "",
      s.title, s.description, s.severity, s.status,
      refLabel("users", s.raisedBy), s.raisedAt ? new Date(s.raisedAt).toISOString() : "",
      refLabel("users", s.assignedTo), s.dueAt ? new Date(s.dueAt).toISOString() : "",
      s.closedAt ? new Date(s.closedAt).toISOString() : "", s.closedBy ? refLabel("users", s.closedBy) : "",
      s.raisedAt ? Math.round((end - s.raisedAt) / HOUR) : ""
    ];
  });
  downloadCsv("snag-register.csv", [head].concat(body));
}
