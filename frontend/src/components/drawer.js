/* ===========================================================================
   The detail drawer — unit / floor stage timeline, snag detail, user detail.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc } from "../state/appState.js";
import { ROLES } from "../services/config.js";
import { byId, coll, myRole, refLabel, fmtDT, dueLabel, ago } from "../modules/helpers.js";
import { trackStages, prog, openSnagsFor, canAct, blockReason, snagTarget } from "../modules/rules.js";
import { assignRow, snagRow } from "./rows.js";

export function openDrawer(ref) {
  state.openDrawerId = ref;
  const [kind, id] = ref.split(":");
  if (kind === "unit" || kind === "floor") renderTrackDrawer(kind, id);
  else if (kind === "snag") renderSnagDrawer(id);
  else if (kind === "user") renderUserDrawer(id);
  $("overlay").classList.add("open");
  $("sheet").classList.add("open");
}
export function reopenDrawer() { if (state.openDrawerId) openDrawer(state.openDrawerId); }
export function closeDrawer() {
  state.openDrawerId = null;
  $("overlay").classList.remove("open");
  $("sheet").classList.remove("open");
}

function renderTrackDrawer(kind, id) {
  const track = kind === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const rec = byId(kind === "unit" ? "units" : "floors", id);
  if (!rec) return;

  $("sheetSub").innerText = kind === "unit"
    ? `${refLabel("floors", rec.floorId)} · ${rec.type || "Unit"}`
    : "RCC STRUCTURE TRACK";
  $("sheetTitle").innerText = rec.name;
  $("sheetFooter").classList.add("hide");

  const snags = kind === "unit" ? openSnagsFor(id) : [];
  let html = "";

  if (snags.length) {
    html += `<div class="note-box" style="margin-bottom:14px;">
      ${snags.length} open snag${snags.length > 1 ? "s" : ""} on this unit — QC gates stay blocked until they are closed.
    </div>`;
  }

  list.forEach((x, idx) => {
    const s = x.stage;
    const p = prog(id, s.id);
    const done = p.status === "done";
    const fail = p.status === "fail";
    const block = blockReason(kind, id, idx);
    const mine = canAct(s);
    const chk = x.map.checklistId ? byId("checklists", x.map.checklistId) : null;

    html += `<div class="stage-row ${block && !done ? "is-locked" : ""}">
      <div class="stage-dot" style="background:${done ? "var(--color-pass)" : fail ? "var(--color-fail)" : s.color || "var(--color-struct)"}">${done ? "✓" : fail ? "✕" : idx + 1}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:800;">${esc(s.name)}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          ${esc(ROLES[s.role] ? ROLES[s.role].name : s.role)}${s.dwg ? " · 📐 " + esc(s.dwg) : ""}${chk ? " · ✅ " + esc(chk.name) : ""}
        </div>`;

    if (s.isHidden) {
      html += `<div style="margin-top:5px;"><span class="badge-tag ${p.meas ? "meas" : "gate"}">
        ${p.meas ? "📷 Measured " + fmtDT(p.meas) : "⚠️ Hidden work — DET measurement required"}</span></div>`;
    }

    if (p.rel || p.ack || p.start || p.at) {
      html += `<div class="stage-meta">
        ${p.rel ? "Released " + fmtDT(p.rel) + " · " : ""}${p.ack ? "Acknowledged " + fmtDT(p.ack) + " · " : ""}
        ${p.start ? "Started " + fmtDT(p.start) + " · " : ""}${p.at ? "Completed " + fmtDT(p.at) : ""}
        ${p.by ? "<br>By " + esc(refLabel("users", p.by)) : ""}
      </div>`;
    }

    if (fail && p.note) html += `<div class="note-box">Failed: ${esc(p.note)}</div>`;
    if (block && !done) html += `<div class="stage-meta" style="color:var(--color-gate); font-weight:700;">🔒 ${esc(block)}</div>`;

    html += `<div class="stage-actions">`;
    if (!block || done) {
      if (s.isHidden && !p.meas && (myRole() === "MEAS" || myRole() === "DRI")) {
        html += `<button class="btn btn-meas btn-sm" onclick="capturePhoto('${kind}','${id}','${s.id}')">📸 Measure &amp; photograph</button>`;
      }
      if (!done && mine) {
        if (p.rel && !p.ack) html += `<button class="btn btn-secondary btn-sm" onclick="ackStage('${kind}','${id}','${s.id}')">Acknowledge</button>`;
        if (!p.start) html += `<button class="btn btn-secondary btn-sm" onclick="startStage('${kind}','${id}','${s.id}')">Start work</button>`;
        if (s.isGate && chk) {
          html += `<button class="btn btn-primary btn-sm" onclick="openChecklist('${kind}','${id}','${s.id}','${chk.id}')">✅ Run checklist</button>`;
        } else {
          html += `<button class="btn btn-primary btn-sm" onclick="completeStage('${kind}','${id}','${s.id}')">${fail ? "Rework done" : "Mark complete"}</button>`;
        }
        if (s.isGate) html += `<button class="btn btn-danger btn-sm" onclick="failStage('${kind}','${id}','${s.id}')">Fail</button>`;
      }
    }
    html += `<button class="btn btn-secondary btn-sm" onclick="openAssignModal('${kind}','${id}','${s.id}')">👤 Assign</button>`;
    if (kind === "unit") html += `<button class="btn btn-secondary btn-sm" onclick="openSnagModal('${id}','${s.id}')">🐞 Snag</button>`;
    html += `</div></div></div>`;
  });

  $("sheetContent").innerHTML = html || `<div class="empty">No stages mapped for this track. Add them in Masters ▸ Stage Mapping.</div>`;
}

function renderSnagDrawer(id) {
  const s = byId("snags", id);
  if (!s) return;
  $("sheetSub").innerText = "SNAG " + s.id;
  $("sheetTitle").innerText = s.title;
  const d = dueLabel(s.dueAt);
  const closed = s.status === "Closed";

  $("sheetContent").innerHTML = `
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;">
      <span class="badge-tag ${s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute"}">${esc(s.severity)}</span>
      <span class="badge-tag ${closed ? "pass" : s.status === "In Progress" ? "wip" : "fail"}">${esc(s.status)}</span>
      ${closed ? "" : `<span class="badge-tag ${d.cls}">${d.text}</span>`}
    </div>
    <div style="font-size:13px; line-height:1.6; margin-bottom:16px;">${esc(s.description || "No description.")}</div>
    <div class="card card-pad" style="font-size:12px; line-height:1.9;">
      <div><strong>Location</strong> · ${esc(snagTarget(s))}</div>
      <div><strong>Stage</strong> · ${esc(refLabel("stages", s.stageId))}</div>
      ${s.paramId ? `<div><strong>Parameter</strong> · ${esc(refLabel("qparams", s.paramId))}</div>` : ""}
      <div><strong>Raised by</strong> · ${esc(refLabel("users", s.raisedBy))} ${ago(s.raisedAt)}</div>
      <div><strong>Assigned to</strong> · ${esc(refLabel("users", s.assignedTo))}</div>
      ${s.closedAt ? `<div><strong>Closed</strong> · ${fmtDT(s.closedAt)} by ${esc(refLabel("users", s.closedBy))}</div>` : ""}
    </div>
    ${(s.photos || []).length ? `<div class="photo-strip">${s.photos.map((p) => { const u = (p && p.url) || p; return `<img class="photo-thumb" src="${esc(u)}" onclick="window.open('${esc(u)}','_blank')">`; }).join("")}</div>` : ""}
    <div style="margin-top:16px;">
      <div class="micro-label">REASSIGN</div>
      <select class="select" id="snagAssignee">${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}" ${u.id === s.assignedTo ? "selected" : ""}>${esc(u.name)} · ${esc(u.role)}</option>`).join("")}</select>
    </div>`;

  $("sheetFooter").classList.remove("hide");
  $("sheetFooter").innerHTML = `
    <button class="btn btn-secondary btn-sm" onclick="capturePhoto('snag','${s.id}','')">📸 Add photo</button>
    <button class="btn btn-secondary btn-sm" onclick="saveSnagAssignee('${s.id}')">Save assignee</button>
    ${closed
      ? `<button class="btn btn-secondary btn-sm" onclick="setSnagStatus('${s.id}','Open')">Reopen</button>`
      : `<button class="btn btn-secondary btn-sm" onclick="setSnagStatus('${s.id}','In Progress')">In progress</button>
         <button class="btn btn-success btn-sm" onclick="setSnagStatus('${s.id}','Closed')">Close snag</button>`}`;
}

function renderUserDrawer(id) {
  const u = byId("users", id);
  if (!u) return;
  $("sheetSub").innerText = ROLES[u.role] ? ROLES[u.role].name.toUpperCase() : u.role;
  $("sheetTitle").innerText = u.name;
  $("sheetFooter").classList.add("hide");

  const asg = coll("assignments").filter((a) => a.assignedTo === id && a.projectId === state.currentProjectId && a.status !== "Done");
  const sng = coll("snags").filter((s) => s.assignedTo === id && s.projectId === state.currentProjectId && s.status !== "Closed");

  $("sheetContent").innerHTML = `
    <div class="card card-pad" style="font-size:12px; line-height:1.9; margin-bottom:16px;">
      <div><strong>Company</strong> · ${esc(u.company || "—")}</div>
      <div><strong>Phone</strong> · ${esc(u.phone || "—")}</div>
      <div><strong>Email</strong> · ${esc(u.email || "—")}</div>
    </div>
    <div class="micro-label">OPEN ASSIGNMENTS (${asg.length})</div>
    <div class="card" style="margin-bottom:16px;">${asg.length ? asg.map(assignRow).join("") : `<div class="empty">None.</div>`}</div>
    <div class="micro-label">OPEN SNAGS (${sng.length})</div>
    <div class="card">${sng.length ? sng.map(snagRow).join("") : `<div class="empty">None.</div>`}</div>
    <button class="btn btn-primary btn-sm" style="margin-top:16px;" onclick="openAssignModal('','','', '${id}')">＋ Assign work to ${esc(u.name.split(" ")[0])}</button>`;
}
