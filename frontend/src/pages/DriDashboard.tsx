import React from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, myAssignments, mySnags } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import Card from "../ui/tw/Card";
import StatTile from "../components/StatTile";
import type { TabKey } from "../types";

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "At Stage 1 — Screening",
  "stage-2-produce": "At Stage 2 — Drawing",
  "stage-3-crosscheck": "At Stage 3 — Cross-check",
  "stage-4-final-approve": "At Stage 4 — Final approval",
  approved: "Approved",
  returned: "Returned"
};

/* DRI's own dashboard — focused on their Drawing Request pipeline (the
   tickets they raised) and their own open assignments/snags, since DRI
   is not a Drawing Request reviewer (see shared/permissions.ts) and the
   ops-wide floor/handover KPIs on OpsDashboard aren't their day-to-day
   concern the way their own raised tickets are. */
export default function DriDashboard() {
  const { data, currentUserId, me, setActiveTab } = useApp();
  const projects = myProjects(data, currentUserId);
  const projectIds = projects.map((p) => p.id);

  const myTickets = coll(data, "drawingRequests").filter((r) => r.submittedByUserId === currentUserId);
  const pending = myTickets.filter((r) => r.reviewStatus !== "approved" && r.reviewStatus !== "returned");
  const approved = myTickets.filter((r) => r.reviewStatus === "approved").length;
  const returned = myTickets.filter((r) => r.reviewStatus === "returned").length;

  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId));
  const myOpen = asg.length + sng.length;

  const stats = [
    { label: "MY DRAWING REQUESTS", val: myTickets.length, icon: "drawing", foot: pending.length + " awaiting review", onClick: () => setActiveTab("drawingRequests" as TabKey) },
    { label: "APPROVED", val: approved, icon: "award", foot: "Cleared through all 4 stages" },
    { label: "RETURNED", val: returned, icon: "bug", foot: returned > 0 ? "Needs rework" : "None sent back" },
    { label: "MY OPEN ITEMS", val: myOpen, icon: "pin", foot: "Assignments + snags on you", onClick: () => setActiveTab("work" as TabKey) }
  ];

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="dashboard" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">My Dashboard</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Your Drawing Request tickets and open work across {projects.length} project{projects.length === 1 ? "" : "s"}.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map((s) => <StatTile key={s.label} label={s.label} value={s.val} foot={s.foot} icon={s.icon} onClick={s.onClick} />)}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
          <NavIcon name="pin" size={13} /> What Needs Me
        </div>
        <div className="text-[11px] text-[var(--text-muted)] font-medium">{myOpen} open item{myOpen === 1 ? "" : "s"} for {me()?.name || ""}</div>
      </div>
      <Card padded={false} className="mb-6">
        {myOpen === 0
          ? <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">🎉 Nothing assigned to you right now.</div>
          : <>{asg.slice(0, 5).map((a) => <AssignRow key={a.id} a={a} />)}{sng.slice(0, 5).map((s) => <SnagRow key={s.id} s={s} />)}</>}
      </Card>

      <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5">
        <NavIcon name="drawing" size={13} /> My Drawing Requests — pending
      </div>
      <Card padded={false}>
        {pending.length === 0
          ? <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">Nothing pending review right now.</div>
          : pending.slice(0, 8).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-3 px-4 border-b border-[var(--border)] last:border-b-0 cursor-pointer"
                onClick={() => setActiveTab("drawingRequests" as TabKey)}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold truncate">{r.ticketNo} · {r.description}</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{r.projectName}</div>
                </div>
                <span className="text-[11px] font-semibold text-[var(--text-muted)] shrink-0">{STAGE_LABEL[r.reviewStatus] || r.reviewStatus}</span>
              </div>
            ))}
      </Card>
    </div>
  );
}
