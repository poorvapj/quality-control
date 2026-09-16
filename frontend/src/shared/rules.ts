/* ===========================================================================
   The rules engine — pure functions over BoardData. Same logic as the
   original vanilla rules.js, just taking `data`/`projectId` as parameters
   instead of reading module-level singletons (idiomatic for React).
   =========================================================================== */

import type {
  BoardData, CollectionName, Track, Stage, StageMap, Unit, Floor, Role, User, Snag, Assignment, ProgressHistoryEntry, Project
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

export interface StageCycle { rel: number | null; ack: number | null; start: number | null; end: number | null; endStatus: "done" | "fail" | null; }

/** Splits a stage instance's full `history` log into one entry per
 *  released->(done|fail) attempt, so reports can see every rework cycle
 *  instead of only the latest one (which is all `rel`/`ack`/`start`/`at`
 *  on the patch itself ever hold — see ProgressPatch.history). A stage
 *  still mid-cycle (no `done`/`fail` yet) is included with `end: null`. */
export function stageCycles(patch: { history?: ProgressHistoryEntry[] } | undefined): StageCycle[] {
  const history = patch?.history || [];
  const cycles: StageCycle[] = [];
  let cur: StageCycle | null = null;
  for (const h of history) {
    if (h.status === "released") {
      if (cur) cycles.push(cur);
      cur = { rel: h.ts, ack: null, start: null, end: null, endStatus: null };
      continue;
    }
    if (!cur) cur = { rel: null, ack: null, start: null, end: null, endStatus: null };
    if (h.status === "ack") cur.ack = h.ts;
    else if (h.status === "wip") cur.start = h.ts;
    else if (h.status === "done" || h.status === "fail") { cur.end = h.ts; cur.endStatus = h.status; cycles.push(cur); cur = null; }
  }
  if (cur) cycles.push(cur);
  return cycles;
}

export interface JoinedStage { map: StageMap; stage: Stage; }

/* trackStages re-filters the whole stagemap on every call — cheap for one
   project, but unitSummary() calls it (directly, and again indirectly via
   floorReleased) for every single unit, so "All Projects" dashboards doing
   this for ~2600 units re-scan the stagemap thousands of times per render.
   Memoized per (data object identity, project+track) — safe because `data`
   is treated as immutable within a render; AppContext always produces a new
   object via structuredClone on every real change, so a stale cache entry
   for an old `data` reference is simply never looked up again. */
const trackStagesCache = new WeakMap<BoardData, Map<string, JoinedStage[]>>();

export function trackStages(data: BoardData | null, projectId: string | null, track: Track): JoinedStage[] {
  if (!data) return [];
  let byKey = trackStagesCache.get(data);
  if (!byKey) { byKey = new Map(); trackStagesCache.set(data, byKey); }
  const key = projectId + "::" + track;
  const cached = byKey.get(key);
  if (cached) return cached;

  const result = data.stagemap
    .filter((m) => m.projectId === projectId && m.track === track && m.active !== false)
    .map((m) => ({ map: m, stage: byId(data.stages, m.stageId) as Stage }))
    .filter((x): x is JoinedStage => !!x.stage && x.stage.active !== false)
    .sort((a, b) => (a.map.seq || 0) - (b.map.seq || 0));
  byKey.set(key, result);
  return result;
}

/** Every active project this user is allowed to see — unrestricted (all
 *  active projects) unless their User record's `projectIds` is set, in
 *  which case only those. The one choke-point every project picker
 *  (Dashboard, Tower Board, Handover Checklist, Raise Snag, Assign Work)
 *  should build its options from, instead of `coll(data,"projects")`
 *  directly. Admin is never restricted, even if `projectIds` was set. */
export function myProjects(data: BoardData | null, userId: string | null): Project[] {
  const all = coll(data, "projects").filter((p) => p.active !== false);
  if (userId === "U-ADMIN") return all;
  const user = byId(coll(data, "users"), userId);
  if (!user?.projectIds?.length) return all;
  const allowed = new Set(user.projectIds);
  return all.filter((p) => allowed.has(p.id));
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
  return myRole === "ADMIN" || myRole === "DRI" || myRole === stage.role;
}

/** CHK-RCC's items aren't their own collection — this looks up an item's
 *  display name from the RCC checklist for Assign/Snag rows, the same way
 *  refLabel() does for a real collection record. */
export function rccItemLabel(data: BoardData | null, itemId?: string | null): string {
  if (!itemId) return "—";
  const checklists = coll(data, "checklists");
  for (const c of checklists) {
    const item = (c.items || []).find((it) => it.id === itemId);
    if (item) return (item as any).name || itemId;
  }
  return itemId;
}

/** Item-level equivalent of blockReason(), scoped to one stage instance's
 *  checklist (RCC's 13 sequenced sub-items). Item `idx` is blocked if the
 *  previous item isn't done yet, if it's a gate item and a hidden-work
 *  item since the previous gate hasn't been measured, or if there's an
 *  open snag against an item up to and including this gate. */
export function rccItemBlockReason(
  data: BoardData | null,
  unitId: string,
  stageId: string,
  items: { id: string; name?: string; isGate?: boolean; isHidden?: boolean }[],
  idx: number
): string | null {
  const cur = items[idx];
  if (!cur) return "Item not found";
  const patch = prog(data, unitId, stageId);
  const cells = patch.checklist || [];
  const cellFor = (itemId: string) => cells.find((c: any) => c.itemId === itemId) as any;

  if (idx > 0) {
    const prev = items[idx - 1];
    const prevCell = cellFor(prev.id);
    if (!prevCell || prevCell.status !== "done") {
      return "Waiting on " + (prev.name || prev.id);
    }
  }

  if (cur.isGate) {
    for (let i = idx - 1; i >= 0; i--) {
      if (items[i].isGate) break;
      const c = cellFor(items[i].id);
      if (items[i].isHidden && !c?.meas) {
        return "Hidden work lock — " + (items[i].name || items[i].id) + " not measured by DET";
      }
    }
    const upto = new Set(items.slice(0, idx + 1).map((x) => x.id));
    const open = openSnagsFor(data, unitId).filter((s) => s.stageId === stageId && s.itemId && upto.has(s.itemId));
    if (open.length) return "Open snag" + (open.length > 1 ? "s" : "") + " on this item (" + open.length + ")";
  }
  return null;
}

/** Is `leaderId` the Team Leader of whichever team `memberUserId` belongs
 *  to? Used to additively extend "mine"-style checks (e.g. AssignRow.tsx)
 *  so a Team Leader can act on their own team's members' work, without
 *  needing Admin or a broader Permission Matrix grant. */
export function isTeamLeaderOf(data: BoardData | null, leaderId: string | null, memberUserId: string | null | undefined): boolean {
  if (!leaderId || !memberUserId) return false;
  const member = byId(coll(data, "users"), memberUserId);
  const team = member?.teamId ? byId(coll(data, "teams"), member.teamId) : null;
  return !!team && team.leaderId === leaderId;
}

export interface UnitSummary { done: number; total: number; fail: boolean; started: boolean; locked: boolean; snags: number; complete: boolean; }

export function unitSummary(data: BoardData | null, projectId: string | null, unitId: string): UnitSummary {
  const list = trackStages(data, projectId, "unit");
  let done = 0, total = 0, fail = false, started = false;
  for (const x of list) {
    if (x.stage.itemBased) {
      const items = rccChecklistItems(data, x.map.checklistId);
      const p = prog(data, unitId, x.stage.id);
      const cells = p.checklist || [];
      total += items.length;
      for (const it of items) {
        const c = cells.find((cc: any) => cc.itemId === it.id);
        if (c?.status === "done") done++;
        else if (c?.status === "fail") fail = true;
        if (c?.status && c.status !== "released") started = true;
      }
      continue;
    }
    total++;
    const p = prog(data, unitId, x.stage.id);
    if (p.status === "done") done++;
    else if (p.status === "fail") fail = true;
    if (p.status && p.status !== "released") started = true;
  }
  const unit = byId(coll(data, "units"), unitId);
  const locked = unit ? !floorReleased(data, projectId, unit.floorId) : true;
  const snags = openSnagsFor(data, unitId).length;
  return { done, total, fail, started, locked, snags, complete: total > 0 && done === total };
}

/** Resolves CHK-RCC's checklist items sorted by their `seq`, given the
 *  stagemap's `checklistId` for STG-RCC. */
export function rccChecklistItems(data: BoardData | null, checklistId?: string | null) {
  if (!checklistId) return [];
  const c = byId(coll(data, "checklists"), checklistId);
  return ((c?.items || []) as any[]).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
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

/** Work assignments this user has handed out to someone else (still open),
 *  not what's on them — powers My Work's "Assigned by me" section. Excludes
 *  self-assignment (assignedTo === assignedBy) since that isn't "handing
 *  off" to anyone. */
export function assignmentsByMe(data: BoardData | null, projectId: string | null, userId: string | null): Assignment[] {
  if (!data || !userId) return [];
  return data.assignments
    .filter((a) => a.assignedBy === userId && a.assignedTo !== userId && a.status !== "Done" && a.projectId === projectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}

/** Snags this user last reassigned to someone else (still open) — see
 *  Snag.lastReassignedBy in types/index.ts for why this can't just reuse
 *  mySnags(). */
export function snagsByMe(data: BoardData | null, projectId: string | null, userId: string | null): Snag[] {
  if (!data || !userId) return [];
  return data.snags
    .filter((s) => s.lastReassignedBy === userId && s.assignedTo !== userId && s.status !== "Closed" && s.projectId === projectId)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
}

export interface Release { targetType: Track; targetId: string; stage: Stage; p: ReturnType<typeof prog>; idx: number; }

export function myReleases(data: BoardData | null, projectId: string | null, userId: string | null): Release[] {
  const u = byId(coll(data, "users"), userId);
  if (!u) return [];
  const out: Release[] = [];
  const scan = (targetType: Track, targetId: string, list: JoinedStage[]) => {
    list.forEach((x, i) => {
      if (x.stage.role !== u.role && u.role !== "ADMIN" && u.role !== "DRI") return;
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
