import React, { useMemo } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, myAssignments, mySnags, myReleases, isCivilLikeRole } from "../shared/rules";
import { ROLES } from "../services/config";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import { hasModuleGrant } from "../shared/permissionMatrix";
import QualityFailures from "../components/QualityFailures";
import { ApprovalQueue, SentBackList } from "../components/ApprovalControls";
import NavIcon from "../components/NavIcon";
import Card from "../ui/tw/Card";
import StatTile from "../components/StatTile";
import Badge from "../ui/tw/Badge";
import type { TabKey } from "../types";

function SectionLabel({ icon, children, right }: { icon: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
      <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2">
        <NavIcon name={icon} size={13} /> {children}
      </div>
      {right && <div className="text-[11px] text-[var(--text-muted)] font-medium">{right}</div>}
    </div>
  );
}

/* Dashboard for a custom role (Masters ▸ Roles — e.g. "Quality",
   "Measurement", "Execution") that isn't DRI/CRM/ADMIN/civil-like and has
   no Drawing Request approval stage of its own. Every section below is
   gated on the SAME module grant that controls whether that module's page
   even shows in the sidebar (hasModuleGrant) — so this dashboard always
   matches whatever the role can actually do today, and automatically
   grows new sections the moment Permission Matrix grants more, no code
   change needed. A role with no grants at all still gets the Team section
   (if they lead one) and a plain "nothing yet" notice, never a blank page. */
export default function RoleDashboard() {
  const { data, currentUserId, myRole, setActiveTab, openDrawer, setReInspectQualityId } = useApp();
  const role = myRole();
  const projects = myProjects(data, currentUserId);
  const projectIds = projects.map((p) => p.id);

  const roleLabel = ROLES[role]?.name || role;
  // Site roles (Civil Engineer, Site Supervisor, and any custom role with
  // "Site access" ticked) also act on Tower Board stages, so their dashboard
  // leads with what is waiting on them personally.
  const siteRole = isCivilLikeRole(data, role);
  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId));
  const releases = siteRole ? projectIds.flatMap((pid) => myReleases(data, pid, currentUserId)) : [];
  const now = Date.now();
  const overdueMine = asg.filter((a) => a.dueAt && a.dueAt < now).length + sng.filter((x) => x.dueAt && x.dueAt < now).length;

  const canQuality = hasModuleGrant(data, currentUserId, "qualityInspection", "view");
  const canUnitExecution = hasModuleGrant(data, currentUserId, "unitExecution", "view");
  const canMeasurement = hasModuleGrant(data, currentUserId, "measurement", "view");
  const canProgressAnalysis = hasModuleGrant(data, currentUserId, "progressAnalysis", "view");
  const canPurchaseOrders = hasModuleGrant(data, currentUserId, "purchaseOrders", "view");
  const anySection = canQuality || canUnitExecution || canMeasurement || canProgressAnalysis || canPurchaseOrders;

  const myTeam = coll(data, "teams").find((t) => t.leaderId === currentUserId) || null;
  const teamMembers = myTeam ? coll(data, "users").filter((u) => u.teamId === myTeam.id && u.active !== false && (!myTeam.role || u.role === myTeam.role)) : [];
  const teamRows = teamMembers.map((u) => {
    const a = coll(data, "assignments").filter((x) => x.assignedTo === u.id && x.status !== "Done" && projectIds.includes(x.projectId));
    const s = coll(data, "snags").filter((x) => x.assignedTo === u.id && x.status !== "Closed" && projectIds.includes(x.projectId));
    const overdue = a.filter((x) => x.dueAt && x.dueAt < Date.now()).length + s.filter((x) => x.dueAt && x.dueAt < Date.now()).length;
    return { user: u, assignments: a.length, snags: s.length, overdue };
  }).sort((a, b) => (b.assignments + b.snags) - (a.assignments + a.snags));

  // --- Quality section — my own inspection activity + my Quality Score
  // (as the responsible DRI, same computation DriDashboard uses). ---------
  const allInspections = coll(data, "qualityInspections").filter((i) => projectIds.includes(i.projectId));
  const myInspections = allInspections.filter((i) => i.inspectorUserId === currentUserId).sort((a, b) => b.createdAt - a.createdAt);
  const openIssuesRaised = myInspections.filter((i) => {
    const snag = i.linkedSnagId ? coll(data, "snags").find((s) => s.id === i.linkedSnagId) : null;
    return snag && snag.status !== "Closed";
  }).length;

  // --- Measurement section — my own recorded measurements. ---------------
  const myUnitMeasurements = coll(data, "materialMeasurements").filter((m) => m.recordedByUserId === currentUserId && projectIds.includes(m.projectId));
  const myWorkMeasurements = coll(data, "workMeasurements").filter((m) => m.recordedByUserId === currentUserId && projectIds.includes(m.projectId));
  const recentMeasurements = [...myUnitMeasurements, ...myWorkMeasurements].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="dashboard" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">My Dashboard</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            {roleLabel} · {projects.length} project{projects.length === 1 ? "" : "s"}.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {siteRole && <StatTile label="Stages To Act On" value={releases.length} icon="board" onClick={() => setActiveTab("board" as TabKey)} />}
        <StatTile label="Open Assignments" value={asg.length} icon="pin" onClick={() => setActiveTab("work" as TabKey)} />
        <StatTile label="Open Snags" value={sng.length} icon="bug" onClick={() => setActiveTab("snags" as TabKey)} />
        <StatTile label="Overdue" value={overdueMine} icon="clock" valueClassName={overdueMine > 0 ? "text-[var(--color-fail)]" : undefined} />
      </div>

      <SectionLabel icon="pin" right={`${asg.length + sng.length} open item${asg.length + sng.length === 1 ? "" : "s"}`}>What Needs Me</SectionLabel>
      <Card padded={false} className="mb-6">
        {asg.length + sng.length === 0
          ? <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">Nothing assigned to you right now.</div>
          : <>{asg.slice(0, 5).map((a) => <AssignRow key={a.id} a={a} />)}{sng.slice(0, 5).map((x) => <SnagRow key={x.id} s={x} />)}</>}
      </Card>

      <ApprovalQueue />
      <SentBackList />

      {canQuality && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatTile label="My Inspections" value={myInspections.length} icon="eye" onClick={() => setActiveTab("qualityInspection" as TabKey)} />
            <StatTile label="Failed / Rework" value={myInspections.filter((i) => i.result !== "Pass").length} icon="bug" />
            <StatTile label="Open Issues I Raised" value={openIssuesRaised} icon="clock" valueClassName={openIssuesRaised > 0 ? "text-[var(--color-fail)]" : undefined} />
            <StatTile label="Pass Rate" value={myInspections.length ? `${Math.round((myInspections.filter((i) => i.result === "Pass").length / myInspections.length) * 100)}%` : "—"} icon="award" />
          </div>

          <QualityFailures />

          <SectionLabel icon="eye" right={`${myInspections.length} total`}>Recent Inspections</SectionLabel>
          <Card padded={false} className="mb-6">
            {myInspections.length === 0 ? (
              <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">You haven't logged an inspection yet.</div>
            ) : (
              myInspections.slice(0, 6).map((i) => {
                const canReinspect = i.result !== "Pass";
                return (
                  <div
                    key={i.id}
                    className={"flex items-center justify-between gap-3 py-3 px-4 border-b border-[var(--border)] last:border-b-0" + (canReinspect ? " cursor-pointer" : "")}
                    onClick={canReinspect ? () => { setReInspectQualityId(i.id); setActiveTab("qualityInspection" as TabKey); } : undefined}
                    title={canReinspect ? "Re-inspect this" : undefined}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold truncate">{i.projectCode} · {i.floorName}{i.workType ? ` · ${i.workType}` : ""}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{i.inspectionDate}</div>
                    </div>
                    <Badge color={i.result === "Pass" ? "green" : i.result === "Fail" ? "red" : "amber"}>{i.result}</Badge>
                  </div>
                );
              })
            )}
          </Card>
        </>
      )}

      {(canUnitExecution || canMeasurement) && (
        <>
          <SectionLabel icon="ruler" right={`${myUnitMeasurements.length + myWorkMeasurements.length} total`}>My Measurements</SectionLabel>
          <Card padded={false} className="mb-6">
            {recentMeasurements.length === 0 ? (
              <div className="py-6 px-5 text-center text-[var(--text-muted)] text-[13px]">You haven't recorded a measurement yet.</div>
            ) : (
              recentMeasurements.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-3 px-4 border-b border-[var(--border)] last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold truncate">{m.projectCode} · {m.category || m.floorName}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{m.measurementDate}</div>
                  </div>
                  <div className="text-[12.5px] font-semibold whitespace-nowrap">{m.measuredQty} {m.measuredUnit}</div>
                </div>
              ))
            )}
          </Card>
        </>
      )}

      {canProgressAnalysis && (
        <Card className="mb-6 cursor-pointer" onClick={() => setActiveTab("progressAnalysis" as TabKey)}>
          <div className="flex items-center gap-2.5">
            <NavIcon name="trend" size={16} />
            <div className="text-[13px] font-semibold">Open Progress Analysis</div>
          </div>
          <div className="text-[11.5px] text-[var(--text-muted)] mt-1">Planned-vs-completed VMS execution, variance sign-off status, by project.</div>
        </Card>
      )}

      {canPurchaseOrders && (
        <Card className="mb-6 cursor-pointer" onClick={() => setActiveTab("purchaseOrders" as TabKey)}>
          <div className="flex items-center gap-2.5">
            <NavIcon name="package" size={16} />
            <div className="text-[13px] font-semibold">Open Purchase Orders</div>
          </div>
          <div className="text-[11.5px] text-[var(--text-muted)] mt-1">Purchase Orders synced from IMS.</div>
        </Card>
      )}

      {!anySection && !siteRole && (
        <Card className="mb-6">
          <div className="text-[13px] text-[var(--text-muted)]">
            No module is granted to your role yet. An admin can grant access from Masters ▸ Role Master's Permission Matrix.
          </div>
        </Card>
      )}

      {myTeam && (
        <>
          <SectionLabel icon="team" right={`${teamRows.length} member${teamRows.length === 1 ? "" : "s"}`}>{myTeam.name} — My Team's Work</SectionLabel>
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
    </div>
  );
}
