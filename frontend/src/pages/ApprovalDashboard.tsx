import React from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { canActOnStage, type StageKey } from "../shared/permissions";
import NavIcon from "../components/NavIcon";
import Card from "../ui/tw/Card";
import StatTile from "../components/StatTile";
import type { ReviewStage, TabKey } from "../types";

const STAGES: { key: StageKey; reviewStage: ReviewStage; label: string }[] = [
  { key: "canScreenStage1", reviewStage: "stage-1-screen", label: "Stage 1 — Screening" },
  { key: "canProduceStage2", reviewStage: "stage-2-produce", label: "Stage 2 — Drawing" },
  { key: "canCrosscheckStage3", reviewStage: "stage-3-crosscheck", label: "Stage 3 — Cross-check" },
  { key: "canFinalApproveStage4", reviewStage: "stage-4-final-approve", label: "Stage 4 — Final approval" }
];

/* Dashboard for a custom approval-only role (e.g. GM, Architect) — people
   whose whole reason to be in QC is reviewing Drawing Requests at one or
   more stages (shared/permissions.ts's canActOnStage), not running a
   project. Shows exactly what's waiting on THEM, nothing else. */
export default function ApprovalDashboard() {
  const { data, currentUserId, myRole, setActiveTab } = useApp();
  const role = myRole();
  const myStages = STAGES.filter((s) => canActOnStage(data, currentUserId, role, s.key));
  const all = coll(data, "drawingRequests");
  const pending = all.filter((r) => myStages.some((s) => s.reviewStage === r.reviewStatus));

  const stats = myStages.map((s) => ({
    label: s.label.toUpperCase(),
    val: all.filter((r) => r.reviewStatus === s.reviewStage).length,
    icon: "drawing"
  }));

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="dashboard" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">My Dashboard</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Drawing Requests waiting on your review.
          </div>
        </div>
      </div>

      {stats.length === 0 ? (
        <Card className="text-center text-[13px] text-[var(--text-muted)] py-6">
          You have no Drawing Request stage approval rights yet — ask Admin to grant them via Masters ▸ Role Master or Permission Matrix.
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.val} icon={s.icon} onClick={() => setActiveTab("drawingRequests" as TabKey)} />)}
        </div>
      )}

      <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5">
        <NavIcon name="pin" size={13} /> Waiting on you
      </div>
      <Card padded={false}>
        {pending.length === 0
          ? <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">🎉 Nothing waiting on you right now.</div>
          : pending.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-3 px-4 border-b border-[var(--border)] last:border-b-0 cursor-pointer"
                onClick={() => setActiveTab("drawingRequests" as TabKey)}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold truncate">{r.ticketNo} · {r.description}</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{r.projectName} · raised by {r.requesterName}</div>
                </div>
              </div>
            ))}
      </Card>
    </div>
  );
}
