import type { BoardData, Approval, QualityInspection, MaterialMeasurement } from "../types";
import { coll } from "./rules";

/* Tower Board "lenses" — the same units, seen the way each team needs them:
     execution   trade/stage progress (the original board)
     quality     has this flat had its quality check?   green = passed
     measurement has this flat been measured?           green = measured
     all         the original board plus a quality-checked tick, with a
                 switcher to flip between the three (Admin, DRI, CRM…)
   A person's default lens comes from their role: a role record's
   "Tower Board view" setting wins, otherwise the role name decides
   (Execution / Quality / Measurement Engineer). */

export type BoardLens = "all" | "execution" | "quality" | "measurement";
export const LENS_LABEL: Record<BoardLens, string> = { all: "All", execution: "Execution", quality: "Quality", measurement: "Measurement" };

export function boardLensFor(data: BoardData | null, role: string | null | undefined): BoardLens {
  if (!role) return "all";
  const rec = coll(data, "roles").find((r) => r.name === role) as any;
  const set = rec?.boardView;
  if (set === "execution" || set === "quality" || set === "measurement" || set === "all") return set;
  if (/execution/i.test(role)) return "execution";
  if (/quality/i.test(role)) return "quality";
  if (/measure/i.test(role)) return "measurement";
  return "all";
}

// A rejected record was sent back to be redone — it never counts as done.
const counts = (a?: Approval) => a?.status !== "rejected";
const awaiting = (a?: Approval) => a?.status === "pending";

export type QualityState = "checked" | "pending" | "failed" | "none";
export interface UnitQuality { state: QualityState; latest?: QualityInspection }

/** Per unit: where its quality checks stand. A flat can have several inspections
 *  (brickwork, plastering, tile work…), so the LATEST non-rejected inspection is
 *  taken per work type, then combined: any failed → failed, else any awaiting
 *  approval → pending, else every checked work type passed → checked. A failed
 *  flat turns green again once a re-inspection of that work type passes. */
export function qualityByUnit(inspections: QualityInspection[]): Map<string, UnitQuality> {
  const latest = new Map<string, QualityInspection>(); // unitId|workType -> newest inspection
  for (const i of inspections) {
    if (!i.unitId || !counts(i.approval)) continue;
    const key = i.unitId + "|" + ((i as any).workType || "");
    const cur = latest.get(key);
    const newer = !cur || (i.inspectionDate || "").localeCompare(cur.inspectionDate || "") > 0
      || ((i.inspectionDate || "") === (cur.inspectionDate || "") && (i.createdAt || 0) > (cur.createdAt || 0));
    if (newer) latest.set(key, i);
  }
  const byUnit = new Map<string, QualityInspection[]>();
  for (const i of latest.values()) byUnit.set(i.unitId as string, [...(byUnit.get(i.unitId as string) || []), i]);
  const out = new Map<string, UnitQuality>();
  for (const [unitId, list] of byUnit) {
    const failed = list.find((i) => i.result !== "Pass");
    const pending = list.find((i) => awaiting(i.approval));
    const newest = [...list].sort((x, y) => (y.inspectionDate || "").localeCompare(x.inspectionDate || "") || (y.createdAt || 0) - (x.createdAt || 0))[0];
    out.set(unitId, { state: failed ? "failed" : pending ? "pending" : "checked", latest: failed || pending || newest });
  }
  return out;
}

/** Same combine rule as qualityByUnit, but keyed on Floor instead of Unit —
 *  Work Quality Inspection moved to Floor-level this cycle (unitId is now
 *  optional, left blank by every new inspection; only kept on old records
 *  for backward display), so a NEW inspection naming no unit fell through
 *  qualityByUnit entirely (it explicitly requires a unitId) and never
 *  painted a tile at all. A floor-level Fail applies to every unit on
 *  that floor — the caller (Tower Board) falls back to this per-floor
 *  result for any unit qualityByUnit has nothing for. */
export function qualityByFloor(inspections: QualityInspection[]): Map<string, UnitQuality> {
  const latest = new Map<string, QualityInspection>(); // floorId|workType -> newest inspection
  for (const i of inspections) {
    if (i.unitId || !i.floorId || !counts(i.approval)) continue; // unit-scoped ones are qualityByUnit's job
    const key = i.floorId + "|" + ((i as any).workType || "");
    const cur = latest.get(key);
    const newer = !cur || (i.inspectionDate || "").localeCompare(cur.inspectionDate || "") > 0
      || ((i.inspectionDate || "") === (cur.inspectionDate || "") && (i.createdAt || 0) > (cur.createdAt || 0));
    if (newer) latest.set(key, i);
  }
  const byFloor = new Map<string, QualityInspection[]>();
  for (const i of latest.values()) byFloor.set(i.floorId as string, [...(byFloor.get(i.floorId as string) || []), i]);
  const out = new Map<string, UnitQuality>();
  for (const [floorId, list] of byFloor) {
    const failed = list.find((i) => i.result !== "Pass");
    const pending = list.find((i) => awaiting(i.approval));
    const newest = [...list].sort((x, y) => (y.inspectionDate || "").localeCompare(x.inspectionDate || "") || (y.createdAt || 0) - (x.createdAt || 0))[0];
    out.set(floorId, { state: failed ? "failed" : pending ? "pending" : "checked", latest: failed || pending || newest });
  }
  return out;
}

export type MeasureState = "measured" | "pending" | "none";
export interface UnitMeasure { state: MeasureState; count: number }

/** Per unit: measured once at least one non-rejected measurement is recorded
 *  (amber while every one of them is still awaiting the leader's approval). */
export function measurementByUnit(measurements: MaterialMeasurement[]): Map<string, UnitMeasure> {
  const out = new Map<string, UnitMeasure>();
  for (const m of measurements) {
    if (!m.unitId || !counts(m.approval)) continue;
    const cur = out.get(m.unitId) || { state: "pending" as MeasureState, count: 0 };
    cur.count++;
    if (!awaiting(m.approval)) cur.state = "measured";
    out.set(m.unitId, cur);
  }
  return out;
}
