import type { Approval, BoardData, Op } from "../types";
import { coll } from "./rules";

/* Team-leader approval helpers — the browser-side mirror of
   backend/approvalRules.js. The server is the authority (it re-derives the
   approval on every save); these only decide what to SHOW and what a save
   should optimistically look like. */

export type ApprovalColl = "qualityInspections" | "materialMeasurements" | "workMeasurements";
export const APPROVAL_COLLS: ApprovalColl[] = ["qualityInspections", "materialMeasurements", "workMeasurements"];

type Rec = { id: string; approval?: Approval; inspectorUserId?: string; recordedByUserId?: string; [k: string]: any };

export const creatorOf = (r: Rec) => r.inspectorUserId || r.recordedByUserId || "";

/** The approval a record saved by `userId` must carry (undefined = none needed). */
export function approvalFor(data: BoardData | null, userId: string | null): Approval | undefined {
  if (!userId) return undefined;
  const users = coll(data, "users");
  const me = users.find((u) => u.id === userId);
  const team = me?.teamId ? coll(data, "teams").find((t) => t.id === me.teamId) : null;
  if (!team?.leaderId || team.leaderId === userId) return undefined;
  const leader = users.find((u) => u.id === team.leaderId);
  return { status: "pending", approverUserId: team.leaderId, approverName: leader?.name || "" };
}

/** The approval a record effectively has. A record saved before approval
 *  existed has none stored; if its author is on a team it counts as awaiting
 *  that team's leader (the server applies the same rule when they decide it),
 *  so the leader can still review older work. */
export function effectiveApproval(data: BoardData | null, r: Rec): Approval | undefined {
  const current = approvalFor(data, creatorOf(r)); // the author's team + CURRENT leader, if any
  if (!r.approval) return current;
  // Pending work is waiting on the team's CURRENT leader, even if the leader was
  // set or changed after the record was saved (the server applies the same rule).
  return r.approval.status === "pending" && current
    ? { ...r.approval, approverUserId: current.approverUserId, approverName: current.approverName }
    : r.approval;
}

/** Can this person approve/reject this record right now? */
export function canDecide(data: BoardData | null, userId: string | null, r: Rec): boolean {
  const a = effectiveApproval(data, r);
  if (!userId || a?.status !== "pending") return false;
  if (userId === creatorOf(r)) return false;
  return userId === "U-ADMIN" || userId === a.approverUserId;
}

/** Pending records waiting on this person (all of them for Admin). */
export function pendingFor(data: BoardData | null, userId: string | null): { coll: ApprovalColl; rec: Rec }[] {
  if (!userId) return [];
  const out: { coll: ApprovalColl; rec: Rec }[] = [];
  for (const c of APPROVAL_COLLS) {
    for (const rec of coll(data, c) as Rec[]) if (canDecide(data, userId, rec)) out.push({ coll: c, rec });
  }
  return out.sort((a, b) => (b.rec.createdAt || 0) - (a.rec.createdAt || 0));
}

/** Records this person made that their leader rejected — sent back to redo. */
export function rejectedFor(data: BoardData | null, userId: string | null): { coll: ApprovalColl; rec: Rec }[] {
  if (!userId) return [];
  const out: { coll: ApprovalColl; rec: Rec }[] = [];
  for (const c of APPROVAL_COLLS) {
    for (const rec of coll(data, c) as Rec[]) if (rec.approval?.status === "rejected" && creatorOf(rec) === userId) out.push({ coll: c, rec });
  }
  return out.sort((a, b) => (b.rec.approval?.decidedAt || 0) - (a.rec.approval?.decidedAt || 0));
}

export const KIND_LABEL: Record<ApprovalColl, string> = {
  qualityInspections: "Inspection",
  materialMeasurements: "Measurement",
  workMeasurements: "Measurement"
};

export function describeRecord(c: ApprovalColl, r: Rec): string {
  if (c === "qualityInspections") return `${r.projectCode} · ${r.floorName} / ${r.unitName} · ${r.result}`;
  if (c === "materialMeasurements") return `${r.projectCode} · ${r.floorName} / ${r.unitName} · ${r.measuredQty} ${r.measuredUnit}`;
  return `${r.projectCode} · ${r.category} · ${r.measuredQty} ${r.measuredUnit}`;
}

/** The save that records a decision. The server stamps who/when and re-checks the rights. */
export function decideOp(c: ApprovalColl, r: Rec, status: "approved" | "rejected", remark?: string, base?: Approval): Op {
  return { op: "upsert", coll: c, rec: { ...r, approval: { ...((base ?? r.approval) as Approval), status, remark: remark?.trim() || undefined } } } as Op;
}
