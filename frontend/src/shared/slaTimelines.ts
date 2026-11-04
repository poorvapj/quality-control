import { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "./rules";
import type { SlaQueueKey } from "../types";

/* SLA hours per pending queue (Masters ▸ SLA Timeline) — same
 * Masters-driven-with-hardcoded-fallback pattern as checklistDefs.ts's
 * useChecklistDefs(): a queue with no row yet falls back to a sane default
 * rather than never showing overdue. Deliberately excludes Drawing
 * Requests and DPR — those have their own separate review flows. */
const DEFAULT_HOURS = 48;

export function useSlaTimelines() {
  const { data } = useApp();
  const rows = coll(data, "slaTimelines");

  return useMemo(() => {
    const byQueue = new Map<string, number>();
    for (const r of rows) {
      if (r.active === false) continue;
      byQueue.set(r.queueKey, r.hours);
    }
    const hoursFor = (queueKey: SlaQueueKey): number => byQueue.get(queueKey) ?? DEFAULT_HOURS;
    const isOverdue = (pendingSinceTs: number | null | undefined, queueKey: SlaQueueKey): boolean => {
      if (!pendingSinceTs) return false;
      return Date.now() - pendingSinceTs > hoursFor(queueKey) * 60 * 60 * 1000;
    };
    return { hoursFor, isOverdue };
  }, [rows]);
}
