import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, myAssignments, mySnags } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import StatTile from "../components/StatTile";
import QualityFailures from "../components/QualityFailures";
import { ApprovalQueue, SentBackList } from "../components/ApprovalControls";
import type { TabKey, TeamDailyReport } from "../types";

/* One Team's Daily Report, pending or already-signed-off — the leader
   taps Approve, which is a sign-off record only (doesn't gate anything
   else; confirmed with whoever asked for this feature). */
function TeamReportCard({ report, canApprove }: { report: TeamDailyReport; canApprove: boolean }) {
  const { apply, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await apply([{ op: "upsert", coll: "teamDailyReports", rec: { id: report.id } }]);
      toast("Report approved");
    } catch {
      toast("Couldn't approve — try again");
    } finally {
      setBusy(false);
    }
  }

  const t = report.totals;
  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 cursor-pointer" onClick={() => setExpanded((x) => !x)}>
          <div className="text-[13px] font-bold">{report.date}</div>
          <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
            {t.assignmentsDone} assignment{t.assignmentsDone === 1 ? "" : "s"} done · {t.snagsClosed} snag{t.snagsClosed === 1 ? "" : "s"} closed · {t.qualityInspections} inspection{t.qualityInspections === 1 ? "" : "s"} · {t.measurementsRecorded} measurement{t.measurementsRecorded === 1 ? "" : "s"}
          </div>
        </div>
        {report.status === "Approved" ? (
          <Badge color="green">Approved{report.approvedByName ? ` by ${report.approvedByName}` : ""}</Badge>
        ) : canApprove ? (
          <Btn label={busy ? "Approving…" : "Approve"} color="primary" size="sm" onClick={approve} disabled={busy} />
        ) : (
          <Badge color="amber">Pending</Badge>
        )}
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          {report.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
              <div className="font-semibold">{m.userName}</div>
              <div className="text-[var(--text-muted)]">
                {m.assignmentsDone} asg · {m.snagsClosed} snag · {m.qualityInspections} insp · {m.measurementsRecorded} meas
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

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
  const { data, currentUserId, me, setActiveTab, setOpenDrawingRequestId, openDrawer } = useApp();
  const projects = myProjects(data, currentUserId);
  const projectIds = projects.map((p) => p.id);

  // If this DRI leads a Team (Masters ▸ Teams), their dashboard also shows
  // each team member's own open work — same open-assignments/snags figures
  // Team.tsx itself shows, just surfaced here too so a team leader doesn't
  // have to leave their dashboard to see it.
  const myTeam = coll(data, "teams").find((t) => t.leaderId === currentUserId) || null;
  // A role can be split across several Team records (e.g. Execution is 3
  // sub-teams under Ayush/Saurabh/Deepti) — a level above them (e.g.
  // Akhilesh, leading his own Execution-tagged team with no direct
  // members of his own) sees the combined roster/reports of every team
  // sharing that role, same grouping Team.tsx itself uses. A team with no
  // role set is its own group of one, unchanged from before.
  const myRoleTeams = myTeam ? (myTeam.role ? coll(data, "teams").filter((t) => t.role === myTeam.role) : [myTeam]) : [];
  const myRoleTeamIds = new Set(myRoleTeams.map((t) => t.id));
  const teamMembers = myRoleTeams.length
    ? coll(data, "users").filter((u) => u.active !== false && myRoleTeams.some((t) => (u.teamId === t.id && (!t.role || u.role === t.role)) || u.id === t.leaderId) && u.id !== currentUserId)
    : [];
  const teamRows = teamMembers.map((u) => {
    const a = coll(data, "assignments").filter((x) => x.assignedTo === u.id && x.status !== "Done" && projectIds.includes(x.projectId));
    const s = coll(data, "snags").filter((x) => x.assignedTo === u.id && x.status !== "Closed" && projectIds.includes(x.projectId));
    const overdue = a.filter((x) => x.dueAt && x.dueAt < Date.now()).length + s.filter((x) => x.dueAt && x.dueAt < Date.now()).length;
    return { user: u, assignments: a.length, snags: s.length, overdue };
  }).sort((a, b) => (b.assignments + b.snags) - (a.assignments + a.snags));

  // Daily Team Reports — generated once a day (see backend/
  // teamDailyReports.js), newest first, combined across every team sharing
  // this role. Approve is still restricted to that specific report's own
  // team leader (or an Admin) — a level-above viewer like Akhilesh can see
  // every sub-team's report but can't sign off on one that isn't his own
  // (enforced server-side too; the button itself is hidden for them here).
  const teamReports = myRoleTeamIds.size
    ? coll(data, "teamDailyReports").filter((r) => myRoleTeamIds.has(r.teamId)).sort((a, b) => b.date.localeCompare(a.date))
    : [];
  const teamById = new Map(coll(data, "teams").map((t: any) => [t.id, t]));

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

      <ApprovalQueue />
      <SentBackList />
      <QualityFailures />

      {myTeam && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
            <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
              <NavIcon name="team" size={13} /> {myRoleTeams.length > 1 ? myTeam.role : myTeam.name} — My Team's Work
            </div>
            <div className="text-[11px] text-[var(--text-muted)] font-medium">{teamRows.length} member{teamRows.length === 1 ? "" : "s"}</div>
          </div>
          <Card padded={false} className="mb-6">
            {teamRows.length === 0 ? (
              <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">No one is assigned to {myTeam.name} yet.</div>
            ) : (
              teamRows.map((r) => (
                <div
                  key={r.user.id}
                  className="flex items-center justify-between gap-3 py-3 px-4 border-b border-[var(--border)] last:border-b-0 cursor-pointer"
                  onClick={() => openDrawer({ kind: "user", id: r.user.id })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold truncate">{r.user.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{r.assignments} assignment{r.assignments === 1 ? "" : "s"} · {r.snags} snag{r.snags === 1 ? "" : "s"}{r.overdue > 0 ? ` · ${r.overdue} overdue` : ""}</div>
                  </div>
                  {r.overdue > 0 && <span className="text-[11px] font-semibold shrink-0" style={{ color: "var(--color-fail)" }}>Overdue</span>}
                </div>
              ))
            )}
          </Card>
        </>
      )}

      {myTeam && teamReports.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
            <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
              <NavIcon name="board" size={13} /> {myRoleTeams.length > 1 ? myTeam.role : myTeam.name} — Daily Reports
            </div>
            <div className="text-[11px] text-[var(--text-muted)] font-medium">
              {teamReports.filter((r) => r.status === "Pending").length} pending
            </div>
          </div>
          <div className="mb-6">
            {teamReports.slice(0, 7).map((r) => {
              const reportTeam = teamById.get(r.teamId);
              const canApprove = !!reportTeam && reportTeam.leaderId === currentUserId;
              return <TeamReportCard key={r.id} report={r} canApprove={canApprove} />;
            })}
          </div>
        </>
      )}

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
                onClick={() => { setOpenDrawingRequestId(r.id); setActiveTab("drawingRequests" as TabKey); }}
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
