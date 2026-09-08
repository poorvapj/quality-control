import type { Op, EventLog } from "../types";

/** Builds an "event" op for the audit trail (events collection) — the same
 *  shape hooks/useActions.ts's own logEvent() produces, extracted so
 *  call sites that don't otherwise need useActions() (DprForm.tsx,
 *  useDrawingRequestActions.ts, RecordModal.tsx, Backups.tsx) can still
 *  log a real audit entry instead of leaving these actions untracked. */
export function buildEventOp(userId: string | null, action: string, targetId: string, stageId: string, detail: string): Op {
  const ev: EventLog = { ts: Date.now(), userId: userId || "", action, targetId, stageId, detail };
  return { op: "event", ev };
}
