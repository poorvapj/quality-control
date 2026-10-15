import React from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import SnagRow from "./SnagRow";
import Card from "../ui/tw/Card";
import NavIcon from "./NavIcon";

/* "My Quality Failures" — inspections that failed (or need rework) with
   ME named as the responsible DRI, shown as the snag each one raised, open
   first. Deliberately NO score: the dashboards show the failures themselves,
   not a mark. (The score maths still exists in shared/driQuality.ts and can
   be switched back on with SHOW_QUALITY_SCORE.) */
export default function QualityFailures() {
  const { data, currentUserId } = useApp();
  const snags = coll(data, "snags");
  const rows = coll(data, "qualityInspections")
    .filter((i) => i.result !== "Pass" && i.correctiveAction?.assignedToUserId === currentUserId)
    .map((insp) => {
      const snag = insp.linkedSnagId ? snags.find((s) => s.id === insp.linkedSnagId) : undefined;
      return { insp, snag, open: !snag || snag.status !== "Closed" };
    })
    .sort((a, b) => Number(b.open) - Number(a.open) || (b.insp.createdAt || 0) - (a.insp.createdAt || 0));
  const openCount = rows.filter((r) => r.open).length;

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
          <NavIcon name="bug" size={13} /> My Quality Failures
        </div>
        <div className="text-[11px] text-[var(--text-muted)] font-medium">{openCount} open · {rows.length - openCount} resolved</div>
      </div>
      <Card padded={false} className="mb-6">
        {rows.length === 0 ? (
          <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">No failed inspections against you.</div>
        ) : (
          rows.slice(0, 6).map(({ insp, snag }) =>
            snag ? (
              <SnagRow key={insp.id} s={snag} />
            ) : (
              <div key={insp.id} className="py-3 px-4 border-b border-[var(--border)] last:border-b-0">
                <div className="text-[13px] font-bold">{insp.projectCode} · {insp.floorName} / {insp.unitName} — {insp.result}</div>
                {insp.remarks && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{insp.remarks}</div>}
              </div>
            )
          )
        )}
        {rows.length > 6 && <div className="py-2 px-4 text-[11.5px] text-[var(--text-muted)]">+{rows.length - 6} more — see Snags for the full list.</div>}
      </Card>
    </>
  );
}
