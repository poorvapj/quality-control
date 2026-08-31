/* ===========================================================================
   The rules engine — pure functions over BoardData. Same logic as the
   original vanilla rules.js, just taking `data`/`projectId` as parameters
   instead of reading module-level singletons (idiomatic for React).
   =========================================================================== */

import type {
  BoardData, CollectionName, Track, Stage, StageMap, Unit, Floor, Role, User, Snag, Assignment
} from "../types";
import { HOUR } from "../services/config";

export const coll = <K extends CollectionName>(data: BoardData | null, name: K): BoardData[K] extends (infer T)[] ? T[] : never =>
  (data && (data[name] as any)) || [];

export function byId<T extends { id: string }>(rows: T[], id: string | null | undefined): T | null {
  if (!id) return null;
  return rows.find((r) => r.id === id) || null;
}

export const pkey = (targetId: string, stageId: string) => targetId + "::" + stageId;
export const prog = (data: BoardData | null, targetId: string, stageId: string) =>
  (data?.progress && data.progress[pkey(targetId, stageId)]) || {};

export interface JoinedStage { map: StageMap; stage: Stage; }

export function trackStages(data: BoardData | null, projectId: string | null, track: Track): JoinedStage[] {
  if (!data) return [];
  return data.stagemap
    .filter((m) => m.projectId === projectId && m.track === track && m.active !== false)
    .map((m) => ({ map: m, stage: byId(data.stages, m.stageId) as Stage }))
    .filter((x): x is JoinedStage => !!x.stage && x.stage.active !== false)
    .sort((a, b) => (a.map.seq || 0) - (b.map.seq || 0));
}

export function projectFloors(data: BoardData | null, projectId: string | null): Floor[] {
  if (!data) return [];
  return data.floors.filter((f) => f.projectId === projectId && f.active !== false).sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
export function projectUnits(data: BoardData | null, projectId: string | null): Unit[] {
  if (!data) return [];
  return data.units.filter((u) => u.projectId === projectId && u.active !== false);
}
export function floorUnits(data: BoardData | null, projectId: string | null, floorId: string): Unit[] {
  return projectUnits(data, projectId).filter((u) => u.floorId === floorId).sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export function floorReleased(data: BoardData | null, projectId: string | null, floorId: string): boolean {
  const stages = trackStages(data, projectId, "floor");
  if (!stages.length) return true;
  const last = stages[stages.length - 1];
  return prog(data, floorId, last.stage.id).status === "done";
}
export function floorBelow(data: BoardData | null, projectId: string | null, floorId: string): Floor | null {
  const fl = projectFloors(data, projectId);
  const i = fl.findIndex((f) => f.id === floorId);
  return i > 0 ? fl[i - 1] : null;
}

export function openSnagsFor(data: BoardData | null, unitId: string): Snag[] {
  if (!data) return [];
  return data.snags.filter((s) => s.unitId === unitId && s.status !== "Closed");
}

export function refLabel(data: BoardData | null, collName: CollectionName, id?: string | null): string {
  if (!id) return "—";
  const rows = coll(data, collName) as { id: string; name?: string; code?: string }[];
  const r = byId(rows, id);
  if (!r) return id || "—";
  return r.name || r.code || r.id;
}

export function snagTarget(data: BoardData | null, s: Snag): string {
  return s.unitId ? refLabel(data, "units", s.unitId) : s.floorId ? refLabel(data, "floors", s.floorId) : "—";
}

export function blockReason(
  data: BoardData | null,
  projectId: string | null,
  targetType: Track,
  targetId: string,
  idx: number
): string | null {
  const list = trackStages(data, projectId, targetType);
  const cur = list[idx];
  if (!cur) return "Stage not mapped";

  if (targetType === "floor") {
    const below = floorBelow(data, projectId, targetId);
    if (below && !floorReleased(data, projectId, below.id)) {
      return "Bottom-up casting — " + below.name + " is not cured yet";
    }
  } else {
    const unit = byId(coll(data, "units"), targetId);
    if (unit && !floorReleased(data, projectId, unit.floorId)) {
      return "Structure not released — " + refLabel(data, "floors", unit.floorId) + " is still casting";
    }
  }

  const predId = cur.map.predecessorId || (idx > 0 ? list[idx - 1].stage.id : "");
  if (predId) {
    const pred = list.find((x) => x.stage.id === predId);
    if (pred && prog(data, targetId, predId).status !== "done") {
      return "Waiting on " + pred.stage.name;
    }
  }

  if (cur.stage.isGate) {
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].stage.isGate) break;
      if (list[i].stage.isHidden && !prog(data, targetId, list[i].stage.id).meas) {
        return "Hidden work lock — " + list[i].stage.name + " not measured by DET";
      }
    }
    if (targetType === "unit") {
      const upto = new Set(list.slice(0, idx + 1).map((x) => x.stage.id));
      const open = openSnagsFor(data, targetId).filter((s) => !s.stageId || upto.has(s.stageId));
      if (open.length) return "Open snag" + (open.length > 1 ? "s" : "") + " on this unit (" + open.length + ")";
    }
  }
  return null;
}

export function canAct(myRole: Role, stage: Stage): boolean {
  return myRole === "DRI" || myRole === stage.role;
}

export interface UnitSummary { done: number; total: number; fail: boolean; started: boolean; locked: boolean; snags: number; complete: boolean; }

export function unitSummary(data: BoardData | null, projectId: string | null, unitId: string): UnitSummary {
  const list = trackStages(data, projectId, "unit");
  let done = 0, fail = false, started = false;
  for (const x of list) {
    const p = prog(data, unitId, x.stage.id);
    if (p.status === "done") done++;
    else if (p.status === "fail") fail = true;
    if (p.status && p.status !== "released") started = true;
  }
  const unit = byId(coll(data, "units"), unitId);
  const locked = unit ? !floorReleased(data, projectId, unit.floorId) : true;
  const snags = openSnagsFor(data, unitId).length;
  return { done, total: list.length, fail, started, locked, snags, complete: list.length > 0 && done === list.length };
}

export interface SlowHandoff { targetType: Track; targetId: string; stage: Stage; hrs: number; sla: number; }

export function slowHandoffs(data: BoardData | null, projectId: string | null): SlowHandoff[] {
  const out: SlowHandoff[] = [];
  const push = (targetType: Track, targetId: string, x: JoinedStage) => {
    const p = prog(data, targetId, x.stage.id);
    if (p.status === "released" && p.rel && !p.ack) {
      const sla = x.map.slaHours || 24;
      const hrs = (Date.now() - p.rel) / HOUR;
      if (hrs >= sla) out.push({ targetType, targetId, stage: x.stage, hrs, sla });
    }
  };
  for (const u of projectUnits(data, projectId)) trackStages(data, projectId, "unit").forEach((x) => push("unit", u.id, x));
  for (const f of projectFloors(data, projectId)) trackStages(data, projectId, "floor").forEach((x) => push("floor", f.id, x));
  return out.sort((a, b) => b.hrs - a.hrs);
}

export function myAssignments(data: BoardData | null, projectId: string | null, userId: string | null): Assignment[] {
  if (!data || !userId) return [];
  return data.assignments
    .filter((a) => a.assignedTo === userId && a.status !== "Done" && a.projectId === projectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}
export function mySnags(data: BoardData | null, projectId: string | null, userId: string | null): Snag[] {
  if (!data || !userId) return [];
  return data.snags
    .filter((s) => s.assignedTo === userId && s.status !== "Closed" && s.projectId === projectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}

export interface Release { targetType: Track; targetId: string; stage: Stage; p: ReturnType<typeof prog>; idx: number; }

export function myReleases(data: BoardData | null, projectId: string | null, userId: string | null): Release[] {
  const u = byId(coll(data, "users"), userId);
  if (!u) return [];
  const out: Release[] = [];
  const scan = (targetType: Track, targetId: string, list: JoinedStage[]) => {
    list.forEach((x, i) => {
      if (x.stage.role !== u.role && u.role !== "DRI") return;
      const p = prog(data, targetId, x.stage.id);
      if (p.status === "done") return;
      if (p.status === "released" || p.status === "ack" || p.status === "wip" || p.status === "fail") {
        if (!blockReason(data, projectId, targetType, targetId, i)) out.push({ targetType, targetId, stage: x.stage, p, idx: i });
      }
    });
  };
  for (const un of projectUnits(data, projectId)) scan("unit", un.id, trackStages(data, projectId, "unit"));
  for (const f of projectFloors(data, projectId)) scan("floor", f.id, trackStages(data, projectId, "floor"));
  return out;
}
