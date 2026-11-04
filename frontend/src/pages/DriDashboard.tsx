import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, myAssignments, mySnags } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SidePanel from "../components/SidePanel";
import { viewPhoto } from "../shared/photoViewer";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import StatTile from "../components/StatTile";
import { ApprovalQueue, SentBackList } from "../components/ApprovalControls";
import { useSlaTimelines } from "../shared/slaTimelines";
import type { TabKey, TeamDailyReport, QualityInspection } from "../types";

/* One Team's Daily Report, pending or already-signed-off — the leader
   taps Approve, which is a sign-off record only (doesn't gate anything
   else; confirmed with whoever asked for this feature). */
function TeamReportCard({ report, canApprove }: { report: TeamDailyReport; canApprove: boolean }) {
  const { apply, toast } = useApp();
  const { isOverdue } = useSlaTimelines();
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
        ) : (
          <div className="flex items-center gap-2">
            {isOverdue(report.generatedAt, "teamDailyReportSignoff") && <Badge color="red">Overdue</Badge>}
            {canApprove ? (
              <Btn label={busy ? "Approving…" : "Approve"} color="primary" size="sm" onClick={approve} disabled={busy} />
            ) : (
              <Badge color="amber">Pending</Badge>
            )}
          </div>
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

/* One Fail/Rework inspection on this DRI's own project, waiting for them to
 * agree it genuinely failed here — separate from whatever team-leader
 * approval the inspector's own finding needed (that's about trusting the
 * inspector; this is the site's responsible person accepting it). Remarks
 * are optional. Drives Tower Board's unacknowledged (purple) -> acknowledged
 * (orange) Fail color for this unit/floor (see TowerBoard.tsx). */
function AckRow({ insp }: { insp: QualityInspection }) {
  const { apply, toast } = useApp();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function acknowledge() {
    setBusy(true);
    const synced = await apply([{
      op: "upsert", coll: "qualityInspections",
      rec: { id: insp.id, driAcknowledged: true, driAcknowledgedRemarks: remarks.trim() || undefined }
    } as any]);
    setBusy(false);
    toast(synced ? "Acknowledged" : "Saved on this device — will finish submitting once you're back online");
  }

  async function disagree() {
    if (!remarks.trim()) { toast("Add a remark explaining why you disagree"); return; }
    setBusy(true);
    const synced = await apply([{
      op: "upsert", coll: "qualityInspections",
      rec: { id: insp.id, driDisputed: true, driAcknowledgedRemarks: remarks.trim() }
    } as any]);
    setBusy(false);
    toast(synced ? "Marked as disputed" : "Saved on this device — will finish submitting once you're back online");
  }

  return (
    <div className="py-3 px-4 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-start justify-between gap-3 flex-wrap cursor-pointer" onClick={() => setExpanded(true)}>
        <div className="min-w-0">
          <div className="text-[13px] font-bold">{insp.projectName} · {insp.floorName}{insp.unitName ? ` / ${insp.unitName}` : ""}</div>
          <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{insp.workType} · {insp.result}{insp.remarks ? ` — ${insp.remarks}` : ""}</div>
        </div>
        <Badge color="red">Not acknowledged</Badge>
      </div>

      <SidePanel
        open={expanded} wide icon={<NavIcon name="alert-triangle" size={18} />}
        title={insp.workType || "Quality Inspection"} desc={`${insp.projectName} · ${insp.floorName}${insp.unitName ? ` / ${insp.unitName}` : ""}`}
        onClose={() => setExpanded(false)}
        footer={<button className="btn btn-secondary" onClick={() => setExpanded(false)}>Close</button>}
      >
        <div className="flex items-center gap-2 mb-3">
          <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}>{insp.result}</Badge>
          {insp.inspectionDate && <span className="text-[11.5px] text-[var(--text-muted)]">{insp.inspectionDate}</span>}
        </div>
        {insp.checklistItems && insp.checklistItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {insp.checklistItems.map((c, idx) => (
              <div key={idx} className="text-[11.5px] flex gap-1.5">
                <Badge color={c.status === "OK" ? "green" : c.status === "Not OK" ? "red" : "gray"}>{c.status}</Badge>
                <span className="flex-1">{c.text}{c.remarks ? ` — ${c.remarks}` : ""}</span>
              </div>
            ))}
          </div>
        )}
        {insp.remarks && <div className="text-[12px] mt-2.5">{insp.remarks}</div>}
        {insp.photos?.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {insp.photos.map((p, idx) => (
              <img
                key={idx} src={p.url} className="w-20 h-20 object-cover rounded-radius-sm border border-[var(--border)] cursor-pointer"
                onClick={() => viewPhoto(p.url, insp.photos!.map((x) => x.url))}
              />
            ))}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-[var(--border)]">
          <input
            className="input w-full" style={{ fontSize: 12.5 }} placeholder="Remarks — required if you disagree, optional if you agree"
            value={remarks} onChange={(e) => setRemarks(e.target.value)}
          />
          <div className="flex gap-2 mt-2.5 flex-wrap">
            <Btn label={busy ? "Saving…" : "I disagree"} color="secondary" size="sm" onClick={disagree} disabled={busy} />
            <Btn label={busy ? "Saving…" : "I agree — acknowledge"} size="sm" onClick={acknowledge} disabled={busy} />
          </div>
        </div>
      </SidePanel>
    </div>
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

  // Fail/Rework inspections on THIS DRI's own project(s) that they haven't
  // yet agreed genuinely failed here — regardless of who the corrective
  // action happens to be assigned to (QualityFailures below only ever shows
  // the person the SNAG is assigned to, which is almost never the site DRI
  // themself).
  const needsAck = coll(data, "qualityInspections")
    .filter((i) => projectIds.includes(i.projectId) && i.result !== "Pass" && !i.driAcknowledged && !i.driDisputed)
    .sort((a, b) => b.createdAt - a.createdAt);

  // Every OPEN snag on this DRI's own project(s), not just the ones
  // assigned specifically to them (mySnags/sng above) — the site's DRI is
  // responsible for knowing what's open on their own site even when the
  // corrective action itself sits with someone else.
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

      {needsAck.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
            <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
              <NavIcon name="bug" size={13} /> Quality Failures Needing Your Acknowledgment
            </div>
            <div className="text-[11px] text-[var(--text-muted)] font-medium">{needsAck.length} waiting</div>
          </div>
          <Card padded={false} className="mb-6">
            {needsAck.slice(0, 10).map((insp) => <AckRow key={insp.id} insp={insp} />)}
          </Card>
        </>
      )}

      <ApprovalQueue />
      <SentBackList />
      {/* "My Quality Failures" is dropped here — it's the same snags "What
          Needs Me" above already shows (both key off snags assigned to this
          user), so showing it again was pure duplication/confusion. */}

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
