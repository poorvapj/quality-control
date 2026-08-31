/* ===========================================================================
   The rules engine — progress keys, stage ordering, block reasons, roll-ups.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state } from "../state/appState.js";
import { HOUR } from "../services/config.js";
import { D, coll, byId, myRole, refLabel } from "./helpers.js";

export const pkey = (targetId, stageId) => targetId + "::" + stageId;
export const prog = (targetId, stageId) => (D().progress && D().progress[pkey(targetId, stageId)]) || {};

/* Ordered, joined stage list for a track on the active project. */
export function trackStages(track) {
  return coll("stagemap")
    .filter((m) => m.projectId === state.currentProjectId && m.track === track && m.active !== false)
    .map((m) => ({ map: m, stage: byId("stages", m.stageId) }))
    .filter((x) => x.stage && x.stage.active !== false)
    .sort((a, b) => (a.map.seq || 0) - (b.map.seq || 0));
}

export const projectFloors = () => coll("floors").filter((f) => f.projectId === state.currentProjectId && f.active !== false).sort((a, b) => (a.seq || 0) - (b.seq || 0));
export const projectUnits = () => coll("units").filter((u) => u.projectId === state.currentProjectId && u.active !== false);
export const floorUnits = (floorId) => projectUnits().filter((u) => u.floorId === floorId).sort((a, b) => (a.seq || 0) - (b.seq || 0));

/* A floor is castable only once the floor below it has cured. */
export function floorReleased(floorId) {
  const stages = trackStages("floor");
  if (!stages.length) return true;
  const last = stages[stages.length - 1];
  return prog(floorId, last.stage.id).status === "done";
}
export function floorBelow(floorId) {
  const fl = projectFloors();
  const i = fl.findIndex((f) => f.id === floorId);
  return i > 0 ? fl[i - 1] : null;
}

export function openSnagsFor(unitId) {
  return coll("snags").filter((s) => s.unitId === unitId && s.status !== "Closed");
}

/* Snags raised on the structure track hang off a floor, not a flat. */
export function snagTarget(s) {
  return s.unitId ? refLabel("units", s.unitId) : s.floorId ? refLabel("floors", s.floorId) : "—";
}

/*
 * Why a stage cannot be worked yet — returns null when it is open for work.
 * This is the single place the board's rules live.
 */
export function blockReason(targetType, targetId, idx) {
  const track = targetType === "unit" ? "unit" : "floor";
  const list = trackStages(track);
  const cur = list[idx];
  if (!cur) return "Stage not mapped";

  if (targetType === "floor") {
    const below = floorBelow(targetId);
    if (below && !floorReleased(below.id)) {
      return "Bottom-up casting — " + below.name + " is not cured yet";
    }
  } else {
    const unit = byId("units", targetId);
    if (unit && !floorReleased(unit.floorId)) {
      return "Structure not released — " + refLabel("floors", unit.floorId) + " is still casting";
    }
  }

  // Predecessor from Stage Mapping (falls back to the previous mapped stage).
  const predId = cur.map.predecessorId || (idx > 0 ? list[idx - 1].stage.id : "");
  if (predId) {
    const pred = list.find((x) => x.stage.id === predId);
    if (pred && prog(targetId, predId).status !== "done") {
      return "Waiting on " + pred.stage.name;
    }
  }

  // Hidden work since the last gate must be measured before a gate can pass.
  if (cur.stage.isGate) {
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].stage.isGate) break;
      if (list[i].stage.isHidden && !prog(targetId, list[i].stage.id).meas) {
        return "Hidden work lock — " + list[i].stage.name + " not measured by DET";
      }
    }
    if (targetType === "unit") {
      // Only snags from this gate or an earlier stage hold it up — a snag
      // recorded against a later stage is not this gate's problem.
      const upto = new Set(list.slice(0, idx + 1).map((x) => x.stage.id));
      const open = openSnagsFor(targetId).filter((s) => !s.stageId || upto.has(s.stageId));
      if (open.length) return "Open snag" + (open.length > 1 ? "s" : "") + " on this unit (" + open.length + ")";
    }
  }
  return null;
}

export function canAct(stage) {
  const r = myRole();
  return r === "DRI" || r === stage.role;
}

/* Unit roll-up used by the tower matrix and KPIs. */
export function unitSummary(unitId) {
  const list = trackStages("unit");
  let done = 0, fail = false, started = false;
  for (const x of list) {
    const p = prog(unitId, x.stage.id);
    if (p.status === "done") done++;
    else if (p.status === "fail") fail = true;
    if (p.status && p.status !== "released") started = true;
  }
  const unit = byId("units", unitId);
  const locked = unit ? !floorReleased(unit.floorId) : true;
  const snags = openSnagsFor(unitId).length;
  return { done, total: list.length, fail, started, locked, snags, complete: list.length > 0 && done === list.length };
}

/* Every handoff released to somebody but not yet acknowledged. */
export function slowHandoffs() {
  const out = [];
  const push = (targetType, targetId, x) => {
    const p = prog(targetId, x.stage.id);
    if (p.status === "released" && p.rel && !p.ack) {
      const sla = x.map.slaHours || 24;
      const hrs = (Date.now() - p.rel) / HOUR;
      if (hrs >= sla) out.push({ targetType, targetId, stage: x.stage, hrs, sla });
    }
  };
  for (const u of projectUnits()) trackStages("unit").forEach((x) => push("unit", u.id, x));
  for (const f of projectFloors()) trackStages("floor").forEach((x) => push("floor", f.id, x));
  return out.sort((a, b) => b.hrs - a.hrs);
}

export function myAssignments(userId) {
  return coll("assignments")
    .filter((a) => a.assignedTo === userId && a.status !== "Done" && a.projectId === state.currentProjectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}
export function mySnags(userId) {
  return coll("snags")
    .filter((s) => s.assignedTo === userId && s.status !== "Closed" && s.projectId === state.currentProjectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}
/* Stages released to my role that nobody has picked up. */
export function myReleases(userId) {
  const u = byId("users", userId);
  if (!u) return [];
  const out = [];
  const scan = (targetType, targetId, list) => {
    list.forEach((x, i) => {
      if (x.stage.role !== u.role && u.role !== "DRI") return;
      const p = prog(targetId, x.stage.id);
      if (p.status === "done") return;
      if (p.status === "released" || p.status === "ack" || p.status === "wip" || p.status === "fail") {
        if (!blockReason(targetType, targetId, i)) out.push({ targetType, targetId, stage: x.stage, p, idx: i });
      }
    });
  };
  for (const un of projectUnits()) scan("unit", un.id, trackStages("unit"));
  for (const f of projectFloors()) scan("floor", f.id, trackStages("floor"));
  return out;
}
