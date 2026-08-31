/* ===========================================================================
   Stage/gate transitions, the assign modal and the gate checklist modal.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc, toast } from "../state/appState.js";
import { Store } from "../services/store.js";
import { HOUR } from "../services/config.js";
import { byId, coll, nextId, refLabel } from "./helpers.js";
import { trackStages, projectFloors, projectUnits, prog, pkey } from "./rules.js";
import { reopenDrawer } from "../components/drawer.js";
import { showModal, closeModal } from "../main.js";
import { openSnagModal } from "../pages/snags.js";

export function logEvent(action, targetId, stageId, detail) {
  return { op: "event", ev: { ts: Date.now(), userId: state.currentUserId, action, targetId, stageId, detail } };
}

export function ackStage(kind, id, stageId) {
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "ack", ack: Date.now(), by: state.currentUserId } },
    logEvent("ACK", id, stageId, "Acknowledged release")
  ]);
  reopenDrawer();
  toast("Release acknowledged");
}

export function startStage(kind, id, stageId) {
  const p = prog(id, stageId);
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "wip", ack: p.ack || Date.now(), start: Date.now(), by: state.currentUserId } },
    logEvent("START", id, stageId, "Work started")
  ]);
  reopenDrawer();
  toast("Work started");
}

/* Completing a stage releases the next one — that is the handoff. */
export function releaseNextOps(kind, id, stageId) {
  const track = kind === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const i = list.findIndex((x) => x.stage.id === stageId);
  if (i === -1 || i + 1 >= list.length) return [];
  const nxt = list[i + 1].stage;
  if (prog(id, nxt.id).status) return [];
  return [{ op: "progress", key: pkey(id, nxt.id), patch: { status: "released", rel: Date.now() } }];
}

export function completeStage(kind, id, stageId) {
  const ops = [
    { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: Date.now(), by: state.currentUserId, note: null } },
    logEvent("COMPLETE", id, stageId, "Stage completed")
  ].concat(releaseNextOps(kind, id, stageId));
  Store.apply(ops);
  reopenDrawer();
  toast("Completed · next stage released");
}

export function failStage(kind, id, stageId) {
  const reason = prompt("QC failure reason (mandatory):");
  if (!reason) return;
  Store.apply([
    { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: Date.now(), by: state.currentUserId, note: reason } },
    logEvent("QC_FAIL", id, stageId, reason)
  ]);
  reopenDrawer();
  toast("Gate failed — raise a snag to track the rework");
  if (kind === "unit") openSnagModal(id, stageId, reason);
}

/* ------------------------------------------------------ gate checklist */

export function openChecklist(kind, id, stageId, checklistId) {
  const chk = byId("checklists", checklistId);
  if (!chk) return;
  state.checklistCtx = { kind, id, stageId, checklistId };
  $("modalBox").className = "modal-box wide";
  $("modalSub").innerText = "QUALITY CHECKLIST · " + refLabel(kind === "unit" ? "units" : "floors", id);
  $("modalTitle").innerText = chk.name;
  $("modalContent").innerHTML = `
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:14px; line-height:1.6;">
      Mark each parameter. Any failed line raises a snag automatically and fails the gate.
    </div>
    ${(chk.items || []).map((it, i) => {
      const p = byId("qparams", it.paramId);
      if (!p) return "";
      return `<div style="border-bottom:1px solid var(--border); padding:12px 0;" data-chk data-param="${p.id}">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:13px; font-weight:800;">${i + 1}. ${esc(p.name)}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:3px; line-height:1.5;">
              ${esc(p.method || "")}${p.acceptance ? " · Accept: " + esc(p.acceptance) : ""}
            </div>
          </div>
          <span class="badge-tag ${p.severity === "Critical" ? "crit" : p.severity === "Major" ? "gate" : "mute"}">${esc(p.severity)}</span>
        </div>
        <div style="display:flex; gap:6px; margin-top:9px; flex-wrap:wrap;">
          <label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="pass" data-res checked style="margin-right:5px;">Pass</label>
          <label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="fail" data-res style="margin-right:5px;">Fail</label>
          ${it.mandatory === false ? `<label class="btn btn-secondary btn-sm"><input type="radio" name="chk${i}" value="na" data-res style="margin-right:5px;">N/A</label>` : ""}
          <input class="input" data-remark placeholder="Observation / remark" style="flex:1; min-width:150px;">
        </div>
      </div>`;
    }).join("")}`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="submitChecklist()">Submit checklist</button>`;
  showModal();
}

export function submitChecklist() {
  const rows = Array.from($("modalContent").querySelectorAll("[data-chk]"));
  const results = rows.map((r) => ({
    paramId: r.dataset.param,
    result: (r.querySelector("[data-res]:checked") || {}).value || "pass",
    remark: r.querySelector("[data-remark]").value.trim()
  }));
  const failed = results.filter((r) => r.result === "fail");
  const { kind, id, stageId, checklistId } = state.checklistCtx;
  const now = Date.now();

  if (!failed.length) {
    const ops = [
      { op: "progress", key: pkey(id, stageId), patch: { status: "done", at: now, by: state.currentUserId, note: null, checklistId, checklist: results } },
      logEvent("QC_PASS", id, stageId, "Checklist passed (" + results.length + " lines)")
    ].concat(releaseNextOps(kind, id, stageId));
    Store.apply(ops);
    closeModal();
    reopenDrawer();
    return toast("Gate passed · next stage released");
  }

  // Failed lines become snags, assigned to whoever owns that trade.
  const stage = byId("stages", stageId);
  const owner = coll("users").find((u) => u.role === stage.role && u.active !== false) || byId("users", state.currentUserId);
  const ops = [
    { op: "progress", key: pkey(id, stageId), patch: { status: "fail", at: now, by: state.currentUserId, checklistId, checklist: results, note: failed.length + " parameter(s) failed" } },
    logEvent("QC_FAIL", id, stageId, failed.length + " parameter(s) failed")
  ];
  let n = 0;
  for (const f of failed) {
    const p = byId("qparams", f.paramId);
    ops.push({
      op: "upsert", coll: "snags",
      rec: {
        id: nextId("SNG", "snags").replace(/(\d+)$/, (m) => String(parseInt(m, 10) + n++).padStart(4, "0")),
        projectId: state.currentProjectId,
        unitId: kind === "unit" ? id : "",
        stageId, paramId: f.paramId,
        title: p.name + " failed at " + stage.name,
        description: f.remark || (p.name + " outside acceptance criteria (" + (p.acceptance || "as per spec") + ")."),
        severity: p.severity || "Major",
        status: "Open",
        raisedBy: state.currentUserId, raisedAt: now,
        assignedTo: owner ? owner.id : state.currentUserId,
        dueAt: now + (p.severity === "Critical" ? 24 : 72) * HOUR,
        photos: [], comments: []
      }
    });
  }
  Store.apply(ops);
  closeModal();
  reopenDrawer();
  toast(failed.length + " snag(s) raised · gate failed");
}

/* ------------------------------------------------------------- assign */
export function openAssignModal(kind, targetId, stageId, presetUser) {
  $("modalBox").className = "modal-box";
  $("modalSub").innerText = "ASSIGN WORK";
  $("modalTitle").innerText = "Assign to a team member";
  const dueDefault = new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 16);

  $("modalContent").innerHTML = `<div class="form-grid">
    <div class="field">
      <label>Target type</label>
      <select class="select" id="asgType" onchange="syncAssignTargets()">
        <option value="unit" ${kind !== "floor" ? "selected" : ""}>Unit / Flat</option>
        <option value="floor" ${kind === "floor" ? "selected" : ""}>Floor / Structure</option>
      </select>
    </div>
    <div class="field"><label>Target</label><select class="select" id="asgTarget"></select></div>
    <div class="field"><label>Stage</label><select class="select" id="asgStage"></select></div>
    <div class="field">
      <label>Assign to *</label>
      <select class="select" id="asgUser">
        ${coll("users").filter((u) => u.active !== false).map((u) => `<option value="${u.id}" ${u.id === presetUser ? "selected" : ""}>${esc(u.name)} · ${esc(u.role)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Due by</label><input class="input" type="datetime-local" id="asgDue" value="${dueDefault}"></div>
    <div class="field full"><label>Instruction</label><textarea class="textarea" id="asgNote" placeholder="What exactly needs doing, and any constraint the person should know."></textarea></div>
  </div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveAssignment()">Assign work</button>`;
  showModal();
  syncAssignTargets(targetId, stageId);
}

export function syncAssignTargets(presetTarget, presetStage) {
  const type = $("asgType").value;
  const targets = type === "unit" ? projectUnits() : projectFloors();
  $("asgTarget").innerHTML = targets.map((t) => `<option value="${t.id}" ${t.id === presetTarget ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const stages = trackStages(type);
  $("asgStage").innerHTML = stages.map((x) => `<option value="${x.stage.id}" ${x.stage.id === presetStage ? "selected" : ""}>${esc(x.stage.name)}</option>`).join("");
}

export function saveAssignment() {
  const rec = {
    id: nextId("ASG", "assignments"),
    projectId: state.currentProjectId,
    targetType: $("asgType").value,
    targetId: $("asgTarget").value,
    stageId: $("asgStage").value,
    assignedTo: $("asgUser").value,
    assignedBy: state.currentUserId,
    assignedAt: Date.now(),
    dueAt: $("asgDue").value ? new Date($("asgDue").value).getTime() : null,
    status: "Assigned",
    note: $("asgNote").value.trim()
  };
  if (!rec.targetId) return toast("Pick a target first");
  Store.apply([
    { op: "upsert", coll: "assignments", rec },
    logEvent("ASSIGN", rec.targetId, rec.stageId, "Assigned to " + refLabel("users", rec.assignedTo))
  ]);
  closeModal();
  toast("Assigned to " + refLabel("users", rec.assignedTo));
}
