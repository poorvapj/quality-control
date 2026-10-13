/* ===========================================================================
   DRI Quality Score — pure, read-only derivation from the existing
   QualityInspection records. Nothing here is stored: the score is
   re-computed from the inspection history every time, so it can never drift
   from the records it's based on, and every point can be traced to one
   inspection (see DriScoreEvent.inspectionId).

   Who a record counts against / for is read ONLY from fields the record
   already carries — never inferred:
     - Fail / Rework Required  → the DRI named in correctiveAction.
       assignedToUserId (the "responsible DRI" the inspector had to pick).
     - Pass                    → counts for a DRI only when it re-inspects
       (reInspectionOf) that DRI's own earlier Fail/Rework — a verified
       recovery. A first-time Pass names no DRI, so it is not credited to
       anyone (reported separately as `unattributedPasses`).

   Rules (the constants below are also what the UI prints, so the rules on
   screen can never differ from the rules in the code):
     start at 100, then in date order
       Fail             −10
       Rework Required   −5
       Recovery pass     +5, plus a streak bonus of +2 per extra consecutive
                         recovery (capped at +6) — a streak resets on any new
                         Fail/Rework against that DRI
     score is kept within 0–100.
   =========================================================================== */

import type { QualityInspection, User } from "../types";

export const DRI_SCORING = {
  base: 100,
  min: 0,
  max: 100,
  fail: -10,
  rework: -5,
  recovery: 5,
  streakBonusStep: 2,
  streakBonusCap: 6,
  trendWindowDays: 30,
  goodAt: 80,
  watchAt: 60
} as const;

const DAY = 24 * 60 * 60 * 1000;

export type DriEventKind = "fail" | "rework" | "recovery";

export interface DriScoreEvent {
  inspectionId: string;
  kind: DriEventKind;
  date: string; // inspection date, YYYY-MM-DD
  ts: number;
  points: number;
  scoreAfter: number;
  projectName: string;
  location: string; // "Floor / Unit"
  remarks?: string;
  /** Fail/Rework only — has a later Pass re-inspection closed it out? */
  resolved?: boolean;
  /** Recovery only — the earlier failed inspection this Pass re-checked. */
  recoveryOf?: string;
  streak?: number;
}

export type DriTrendDirection = "up" | "down" | "flat";

export interface DriScore {
  userId: string;
  name: string;
  score: number;
  fails: number;
  reworks: number;
  recoveries: number;
  openFailures: number;
  streak: number; // current run of consecutive recoveries
  events: DriScoreEvent[]; // chronological
  /** Change over the last `trendWindowDays` (current score − score at the
   *  start of the window; if the DRI's history is shorter than the window,
   *  measured against the starting 100). */
  trend: { direction: DriTrendDirection; delta: number; windowDays: number; eventsInWindow: number };
}

export interface DriScoreResult {
  scores: DriScore[];
  /** Pass inspections that aren't a re-inspection of a failure — they name no
   *  DRI, so they're deliberately not credited to anyone. */
  unattributedPasses: number;
}

const clamp = (n: number) => Math.max(DRI_SCORING.min, Math.min(DRI_SCORING.max, n));

export function scoreBand(score: number): "good" | "watch" | "poor" {
  return score >= DRI_SCORING.goodAt ? "good" : score >= DRI_SCORING.watchAt ? "watch" : "poor";
}

function sortKey(i: QualityInspection) {
  return (i.inspectionDate || "") + "|" + String(i.createdAt || 0).padStart(15, "0");
}

export function computeDriScores(
  inspections: QualityInspection[],
  users: User[],
  now: number = Date.now()
): DriScoreResult {
  const byId = new Map(inspections.map((i) => [i.id, i]));
  const resolvedIds = new Set<string>();
  for (const i of inspections) {
    if (i.result === "Pass" && i.reInspectionOf) resolvedIds.add(i.reInspectionOf);
  }

  // Raw, un-scored events per DRI.
  type Raw = { insp: QualityInspection; kind: DriEventKind; recoveryOf?: string };
  const perDri = new Map<string, { name: string; raw: Raw[] }>();
  const push = (userId: string, name: string, r: Raw) => {
    if (!perDri.has(userId)) perDri.set(userId, { name, raw: [] });
    perDri.get(userId)!.raw.push(r);
  };

  let unattributedPasses = 0;
  for (const insp of inspections) {
    if (insp.result === "Fail" || insp.result === "Rework Required") {
      const dri = insp.correctiveAction;
      if (dri?.assignedToUserId) push(dri.assignedToUserId, dri.assignedToName, { insp, kind: insp.result === "Fail" ? "fail" : "rework" });
    } else if (insp.result === "Pass") {
      const orig = insp.reInspectionOf ? byId.get(insp.reInspectionOf) : undefined;
      const owner = orig && orig.result !== "Pass" ? orig.correctiveAction : null;
      if (owner?.assignedToUserId) push(owner.assignedToUserId, owner.assignedToName, { insp, kind: "recovery", recoveryOf: orig!.id });
      else unattributedPasses++;
    }
  }

  const scores: DriScore[] = [];
  for (const [userId, { name, raw }] of perDri) {
    raw.sort((a, b) => sortKey(a.insp).localeCompare(sortKey(b.insp)));
    let score: number = DRI_SCORING.base;
    let streak = 0;
    const events: DriScoreEvent[] = [];
    for (const r of raw) {
      let points: number;
      if (r.kind === "recovery") {
        streak++;
        points = DRI_SCORING.recovery + Math.min((streak - 1) * DRI_SCORING.streakBonusStep, DRI_SCORING.streakBonusCap);
      } else {
        streak = 0;
        points = r.kind === "fail" ? DRI_SCORING.fail : DRI_SCORING.rework;
      }
      const before = score;
      score = clamp(score + points);
      events.push({
        inspectionId: r.insp.id,
        kind: r.kind,
        date: r.insp.inspectionDate,
        ts: new Date(r.insp.inspectionDate).getTime(),
        // the points actually applied (after the 0–100 clamp), so the ledger always adds up
        points: score - before,
        scoreAfter: score,
        projectName: r.insp.projectName,
        location: r.insp.unitName ? `${r.insp.floorName} / ${r.insp.unitName}` : r.insp.floorName,
        remarks: r.insp.remarks,
        resolved: r.kind === "recovery" ? undefined : resolvedIds.has(r.insp.id),
        recoveryOf: r.recoveryOf,
        streak: r.kind === "recovery" ? streak : undefined
      });
    }

    const cutoff = now - DRI_SCORING.trendWindowDays * DAY;
    const before = events.filter((e) => e.ts <= cutoff);
    const baseline = before.length ? before[before.length - 1].scoreAfter : DRI_SCORING.base;
    const delta = score - baseline;
    scores.push({
      userId,
      name: users.find((u) => u.id === userId)?.name || name,
      score,
      fails: events.filter((e) => e.kind === "fail").length,
      reworks: events.filter((e) => e.kind === "rework").length,
      recoveries: events.filter((e) => e.kind === "recovery").length,
      openFailures: events.filter((e) => e.kind !== "recovery" && !e.resolved).length,
      streak,
      events,
      trend: {
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        delta,
        windowDays: DRI_SCORING.trendWindowDays,
        eventsInWindow: events.length - before.length
      }
    });
  }
  scores.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return { scores, unattributedPasses };
}
