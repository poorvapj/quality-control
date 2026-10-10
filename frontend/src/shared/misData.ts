/* ===========================================================================
   MIS Dashboard — pure aggregation over the existing BoardData/rules.ts
   engine. Reads live data only (unitSummary/trackStages/openSnagsFor/
   myProjects, all unchanged) — no new backend endpoint, no change to any
   business rule, gating, or write path. Every number here is derivable
   from the same data the rest of the app already renders.
   =========================================================================== */

import type { BoardData, Snag } from "../types";
import {
  coll, byId, myProjects, projectUnits, projectFloors, trackStages, prog,
  unitSummary, openSnagsFor, rccChecklistItems, refLabel
} from "./rules";

export const DAY = 24 * 60 * 60 * 1000;

/* The 5 item-based unit-track stages, in the order construction actually
   runs — the "trade" dimension for stage-progress and contractor
   performance sections. Internal/Owner Possession are deliberately
   excluded here (they get their own Possession Tracker section). */
export const TRADE_STAGE_IDS = ["STG-RCC", "STG-BRICK", "STG-AC2", "STG-ELECTRIC", "STG-PLASTERING"] as const;

export interface UnitMisRow {
  unitId: string;
  unitName: string;
  projectId: string;
  projectName: string;
  floorId: string;
  floorName: string;
  done: number;
  total: number;
  qualityPct: number;
  complete: boolean;
  started: boolean;
  constructionComplete: boolean;
  internalDone: boolean;
  ownerDone: boolean;
  readyForPossession: boolean;
  openSnags: number;
  criticalSnags: number;
}

function stageDoneTotal(data: BoardData | null, projectId: string, unitId: string, stageId: string): { done: number; total: number } {
  const list = trackStages(data, projectId, "unit");
  const joined = list.find((x) => x.stage.id === stageId);
  if (!joined) return { done: 0, total: 0 };
  if (joined.stage.itemBased) {
    const items = rccChecklistItems(data, joined.map.checklistId);
    const cells = prog(data, unitId, stageId).checklist || [];
    const done = items.filter((it: any) => (cells as any[]).find((c) => c.itemId === it.id)?.status === "done").length;
    return { done, total: items.length };
  }
  const done = prog(data, unitId, stageId).status === "done" ? 1 : 0;
  return { done, total: 1 };
}

/** Every unit across every project the current user can see, with the MIS
 *  fields the rest of this module builds on. This is the single
 *  computation every section below filters/aggregates from. */
export function buildUnitRows(data: BoardData | null, currentUserId: string | null): UnitMisRow[] {
  const projects = myProjects(data, currentUserId);
  const rows: UnitMisRow[] = [];
  for (const project of projects) {
    const floors = projectFloors(data, project.id);
    const floorName = (floorId: string) => byId(floors, floorId)?.name || "—";
    for (const unit of projectUnits(data, project.id)) {
      const s = unitSummary(data, project.id, unit.id);
      const snags = openSnagsFor(data, unit.id);
      let constructionDone = 0, constructionTotal = 0;
      for (const stageId of TRADE_STAGE_IDS) {
        const { done, total } = stageDoneTotal(data, project.id, unit.id, stageId);
        constructionDone += done;
        constructionTotal += total;
      }
      const internalDone = prog(data, unit.id, "STG-HOI").status === "done";
      const ownerDone = prog(data, unit.id, "STG-HOO").status === "done";
      rows.push({
        unitId: unit.id, unitName: unit.name || unit.code || unit.id,
        projectId: project.id, projectName: project.name,
        floorId: unit.floorId, floorName: floorName(unit.floorId),
        done: s.done, total: s.total,
        qualityPct: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0,
        complete: s.complete, started: s.started,
        constructionComplete: constructionTotal > 0 && constructionDone === constructionTotal,
        internalDone, ownerDone,
        readyForPossession: constructionTotal > 0 && constructionDone === constructionTotal,
        openSnags: snags.length,
        criticalSnags: snags.filter((sn) => sn.severity === "Critical").length
      });
    }
  }
  return rows;
}

export interface MisFilters {
  projectId?: string;
  floorId?: string;
  unitId?: string;
  stageId?: string;
  severity?: string;
  status?: string;
  fromTs?: number;
  toTs?: number;
}

export function filterUnitRows(rows: UnitMisRow[], f: MisFilters): UnitMisRow[] {
  return rows.filter((r) =>
    (!f.projectId || r.projectId === f.projectId) &&
    (!f.floorId || r.floorId === f.floorId) &&
    (!f.unitId || r.unitId === f.unitId)
  );
}

export interface TopKpis {
  totalProjects: number;
  totalUnits: number;
  unitsCompleted: number;
  unitsInProgress: number;
  openSnags: number;
  criticalSnags: number;
  unitsReadyForPossession: number;
  avgSnagClosureDays: number | null;
}

function snagsInScope(data: BoardData | null, rows: UnitMisRow[], f: MisFilters): Snag[] {
  const unitIds = new Set(rows.map((r) => r.unitId));
  return coll(data, "snags").filter((s) => {
    if (s.unitId && !unitIds.has(s.unitId)) return false;
    if (f.severity && s.severity !== f.severity) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.stageId && s.stageId !== f.stageId) return false;
    if (f.fromTs && s.raisedAt < f.fromTs) return false;
    if (f.toTs && s.raisedAt > f.toTs) return false;
    return true;
  });
}

function avgClosureDays(snags: Snag[]): number | null {
  const closed = snags.filter((s) => s.status === "Closed" && s.closedAt);
  if (!closed.length) return null;
  const totalMs = closed.reduce((sum, s) => sum + (s.closedAt! - s.raisedAt), 0);
  return Math.round((totalMs / closed.length / DAY) * 10) / 10;
}

export function computeTopKpis(data: BoardData | null, currentUserId: string | null, f: MisFilters): TopKpis {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  const projectIds = new Set(rows.map((r) => r.projectId));
  const snags = snagsInScope(data, rows, f);
  const openSnags = snags.filter((s) => s.status !== "Closed");
  return {
    totalProjects: projectIds.size,
    totalUnits: rows.length,
    unitsCompleted: rows.filter((r) => r.complete).length,
    unitsInProgress: rows.filter((r) => r.started && !r.complete).length,
    openSnags: openSnags.length,
    criticalSnags: openSnags.filter((s) => s.severity === "Critical").length,
    unitsReadyForPossession: rows.filter((r) => r.readyForPossession && !r.internalDone).length,
    avgSnagClosureDays: avgClosureDays(snags)
  };
}

export interface ProjectOverviewRow {
  projectId: string;
  projectName: string;
  totalUnits: number;
  completedUnits: number;
  inProgressUnits: number;
  qualityPct: number;
  openSnags: number;
  criticalSnags: number;
  possessionReadyPct: number;
  status: "On Track" | "Needs Attention" | "At Risk";
}

export function computeProjectOverview(data: BoardData | null, currentUserId: string | null, f: MisFilters): ProjectOverviewRow[] {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  const byProject = new Map<string, UnitMisRow[]>();
  for (const r of rows) {
    if (!byProject.has(r.projectId)) byProject.set(r.projectId, []);
    byProject.get(r.projectId)!.push(r);
  }
  const out: ProjectOverviewRow[] = [];
  for (const [projectId, us] of byProject) {
    const doneSum = us.reduce((a, r) => a + r.done, 0);
    const totalSum = us.reduce((a, r) => a + r.total, 0);
    const qualityPct = totalSum > 0 ? Math.round((doneSum / totalSum) * 100) : 0;
    const criticalSnags = us.reduce((a, r) => a + r.criticalSnags, 0);
    const openSnags = us.reduce((a, r) => a + r.openSnags, 0);
    const possessionReadyPct = us.length ? Math.round((us.filter((r) => r.readyForPossession).length / us.length) * 100) : 0;
    const status: ProjectOverviewRow["status"] =
      criticalSnags > 0 || qualityPct < 40 ? "At Risk" :
      openSnags > 5 || qualityPct < 70 ? "Needs Attention" : "On Track";
    out.push({
      projectId, projectName: us[0].projectName,
      totalUnits: us.length,
      completedUnits: us.filter((r) => r.complete).length,
      inProgressUnits: us.filter((r) => r.started && !r.complete).length,
      qualityPct, openSnags, criticalSnags, possessionReadyPct, status
    });
  }
  return out.sort((a, b) => b.qualityPct - a.qualityPct);
}

export interface StageProgressRow {
  stageId: string;
  label: string;
  completed: number;
  inProgress: number;
  pending: number;
  pct: number;
}

const TRADE_LABEL: Record<string, string> = {
  "STG-RCC": "RCC", "STG-BRICK": "Brickwork", "STG-AC2": "AC",
  "STG-ELECTRIC": "Electrical", "STG-PLASTERING": "Plastering"
};

export function computeStageProgress(data: BoardData | null, currentUserId: string | null, f: MisFilters): StageProgressRow[] {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  return TRADE_STAGE_IDS.map((stageId) => {
    let completed = 0, inProgress = 0, pending = 0;
    for (const r of rows) {
      const { done, total } = stageDoneTotal(data, r.projectId, r.unitId, stageId);
      if (total === 0) continue;
      if (done === total) completed++;
      else if (done > 0) inProgress++;
      else pending++;
    }
    const n = completed + inProgress + pending;
    return { stageId, label: TRADE_LABEL[stageId], completed, inProgress, pending, pct: n ? Math.round((completed / n) * 100) : 0 };
  });
}

export interface SnagAnalysis {
  total: number;
  critical: number;
  major: number;
  minor: number;
  open: number;
  inProgress: number;
  closed: number;
  reopened: number;
  avgClosureDays: number | null;
  byProject: { name: string; count: number }[];
  byTrade: { label: string; count: number }[];
}

export function computeSnagAnalysis(data: BoardData | null, currentUserId: string | null, f: MisFilters): SnagAnalysis {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  const snags = snagsInScope(data, rows, f);
  const projectNameByUnit = new Map(rows.map((r) => [r.unitId, r.projectName]));
  const byProjectMap = new Map<string, number>();
  const byTradeMap = new Map<string, number>();
  for (const s of snags) {
    const pname = s.unitId ? projectNameByUnit.get(s.unitId) : undefined;
    if (pname) byProjectMap.set(pname, (byProjectMap.get(pname) || 0) + 1);
    const label = s.stageId === "STG-RCC" || TRADE_LABEL[s.stageId] ? (TRADE_LABEL[s.stageId] || "RCC") : refLabel(data, "stages", s.stageId);
    byTradeMap.set(label, (byTradeMap.get(label) || 0) + 1);
  }
  return {
    total: snags.length,
    critical: snags.filter((s) => s.severity === "Critical").length,
    major: snags.filter((s) => s.severity === "Major").length,
    minor: snags.filter((s) => s.severity === "Minor").length,
    open: snags.filter((s) => s.status === "Open").length,
    inProgress: snags.filter((s) => s.status === "In Progress").length,
    closed: snags.filter((s) => s.status === "Closed").length,
    reopened: snags.filter((s) => (s.reopenCount || 0) > 0).length,
    avgClosureDays: avgClosureDays(snags),
    byProject: [...byProjectMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byTrade: [...byTradeMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  };
}

export interface PossessionTracker {
  internalReadyPct: number;
  ownerReadyPct: number;
  pendingInternal: number;
  pendingOwner: number;
  failedInternal: number;
  failedOwner: number;
  waitingRectification: UnitMisRow[];
}

export function computePossessionTracker(data: BoardData | null, currentUserId: string | null, f: MisFilters): PossessionTracker {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  const n = rows.length || 1;
  const failedInternal = rows.filter((r) => prog(data, r.unitId, "STG-HOI").status === "fail").length;
  const failedOwner = rows.filter((r) => prog(data, r.unitId, "STG-HOO").status === "fail").length;
  return {
    internalReadyPct: Math.round((rows.filter((r) => r.internalDone).length / n) * 100),
    ownerReadyPct: Math.round((rows.filter((r) => r.ownerDone).length / n) * 100),
    pendingInternal: rows.filter((r) => r.readyForPossession && !r.internalDone).length,
    pendingOwner: rows.filter((r) => r.internalDone && !r.ownerDone).length,
    failedInternal, failedOwner,
    waitingRectification: rows.filter((r) => r.criticalSnags > 0 || failedInternal > 0 && prog(data, r.unitId, "STG-HOI").status === "fail")
  };
}

export interface TradePerformance {
  stageId: string;
  label: string;
  unitsHandled: number;
  workProgressPct: number;
  openSnags: number;
  criticalSnags: number;
  closedSnags: number;
  reopenRate: number;
  avgClosureDays: number | null;
}

export function computeTradePerformance(data: BoardData | null, currentUserId: string | null, f: MisFilters): TradePerformance[] {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  return TRADE_STAGE_IDS.map((stageId) => {
    let unitsHandled = 0, doneSum = 0, totalSum = 0;
    for (const r of rows) {
      const { done, total } = stageDoneTotal(data, r.projectId, r.unitId, stageId);
      if (total > 0 && done > 0) unitsHandled++;
      doneSum += done; totalSum += total;
    }
    const tradeSnags = coll(data, "snags").filter((s) => s.stageId === stageId);
    const closed = tradeSnags.filter((s) => s.status === "Closed");
    const reopened = tradeSnags.filter((s) => (s.reopenCount || 0) > 0);
    return {
      stageId, label: TRADE_LABEL[stageId],
      unitsHandled,
      workProgressPct: totalSum ? Math.round((doneSum / totalSum) * 100) : 0,
      openSnags: tradeSnags.filter((s) => s.status !== "Closed").length,
      criticalSnags: tradeSnags.filter((s) => s.severity === "Critical" && s.status !== "Closed").length,
      closedSnags: closed.length,
      reopenRate: tradeSnags.length ? Math.round((reopened.length / tradeSnags.length) * 100) : 0,
      avgClosureDays: avgClosureDays(tradeSnags)
    };
  });
}

export interface ManagementAlert { severity: "critical" | "warning"; text: string; }

export function computeManagementAlerts(data: BoardData | null, currentUserId: string | null, f: MisFilters): ManagementAlert[] {
  const allRows = buildUnitRows(data, currentUserId);
  const rows = filterUnitRows(allRows, f);
  const alerts: ManagementAlert[] = [];
  const unitIds = new Set(rows.map((r) => r.unitId));
  const snags = coll(data, "snags").filter((s) => !s.unitId || unitIds.has(s.unitId));

  const criticalOpen = snags.filter((s) => s.severity === "Critical" && s.status !== "Closed");
  if (criticalOpen.length) alerts.push({ severity: "critical", text: `${criticalOpen.length} critical snag(s) still open` });

  const now = Date.now();
  const overdue = snags.filter((s) => s.status !== "Closed" && s.dueAt && s.dueAt < now);
  if (overdue.length) alerts.push({ severity: "critical", text: `${overdue.length} snag(s) overdue for closure` });

  const reopened = snags.filter((s) => (s.reopenCount || 0) >= 2);
  if (reopened.length) alerts.push({ severity: "warning", text: `${reopened.length} snag(s) reopened 2+ times — recurring quality issue` });

  const stuck = rows.filter((r) => r.started && !r.complete && r.openSnags === 0 && r.qualityPct < 100 && r.qualityPct > 0);
  // "Stuck" here means visibly not progressing — approximated as started,
  // incomplete, and not blocked by an open snag (so the delay isn't
  // explained by a known issue).
  if (stuck.length) alerts.push({ severity: "warning", text: `${stuck.length} unit(s) in progress with no open snag but not completing` });

  const failedPossession = rows.filter((r) => prog(data, r.unitId, "STG-HOI").status === "fail" || prog(data, r.unitId, "STG-HOO").status === "fail");
  if (failedPossession.length) alerts.push({ severity: "critical", text: `${failedPossession.length} unit(s) failed a possession check` });

  const projects = computeProjectOverview(data, currentUserId, f);
  const lowQuality = projects.filter((p) => p.status === "At Risk");
  for (const p of lowQuality) alerts.push({ severity: "critical", text: `${p.projectName}: quality ${p.qualityPct}% — At Risk` });

  return alerts;
}
