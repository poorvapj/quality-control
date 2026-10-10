import React from "react";
import { useApp } from "../context/AppContext";
import { myAssignments, mySnags, myReleases, assignmentsByMe, snagsByMe, refLabel, snagTarget, myProjects } from "../shared/rules";
import { ago, dueLabel } from "../shared/helpers";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import NavIcon from "../components/NavIcon";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";

function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-sub)] mb-2 mt-5 first:mt-0">
      <NavIcon name={icon} size={13} /> {children}
    </div>
  );
}

export default function MyWork() {
  const { data, currentUserId, openAssignModal, openDrawer } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  // "My Work" is personal — whatever's assigned to me, on any project —
  // not scoped to whichever project happens to be selected elsewhere.
  // The global current-project selector defaults to projects[0] and this page has no project
  // switcher, so scoping to it silently hid work from other projects.
  const projectIds = myProjects(data, currentUserId).map((p) => p.id);
  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId));
  const rel = projectIds.flatMap((pid) => myReleases(data, pid, currentUserId));
  // What I've handed off to someone else, still open — a DRI assigning work
  // needs to see who they gave it to and its status, not just what's on them.
  const outAsg = projectIds.flatMap((pid) => assignmentsByMe(data, pid, currentUserId));
  const outSng = projectIds.flatMap((pid) => snagsByMe(data, pid, currentUserId));
  // Admin doesn't personally do stage work, so the personal sections above
  // are always empty for them — instead they need to see everyone's open
  // work and progress across every project, not just what was handed off by
  // them specifically.
  const allAsg = isAdmin
    ? (data?.assignments || []).filter((a) => projectIds.includes(a.projectId) && a.status !== "Done").sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
    : [];
  const allSng = isAdmin
    ? (data?.snags || []).filter((s) => projectIds.includes(s.projectId) && s.status !== "Closed").sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
    : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
        <div className="flex gap-3.5 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="work" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">My Work</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              {isAdmin
                ? `${allAsg.length} open assignments · ${allSng.length} open snags across all projects`
                : `${asg.length} assigned · ${rel.length} released to your role · ${sng.length} snags on you`}
            </div>
          </div>
        </div>
        <Btn label="＋ Assign work" size="sm" onClick={() => openAssignModal({ targetType: "unit", targetId: "", stageId: "" })} />
      </div>

      {isAdmin ? (
        <>
          <SectionLabel icon="pin">All Assigned Work</SectionLabel>
          <Card padded={false}>
            {allAsg.length ? allAsg.map((a) => <AssignRow key={a.id} a={a} showAssignee />) : <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">No open assignments across any project.</div>}
          </Card>

          <SectionLabel icon="snags">All Open Snags</SectionLabel>
          <Card padded={false}>
            {allSng.length ? allSng.map((s) => <SnagRow key={s.id} s={s} showAssignee />) : <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">No open snags across any project.</div>}
          </Card>
        </>
      ) : (
        <>
          <SectionLabel icon="pin">Assigned to Me</SectionLabel>
          <Card padded={false}>
            {asg.length ? asg.map((a) => <AssignRow key={a.id} a={a} />) : <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">Nothing assigned to you.</div>}
          </Card>

          <SectionLabel icon="work">Released to My Role</SectionLabel>
          <Card padded={false}>
            {rel.length ? rel.map((r, i) => {
              const name = r.targetType === "unit" ? refLabel(data, "units", r.targetId) : refLabel(data, "floors", r.targetId);
              const st = r.p.status;
              const label = st === "fail" ? "REWORK" : st === "wip" ? "IN PROGRESS" : st === "ack" ? "ACKNOWLEDGED" : "NEW RELEASE";
              return (
                <div
                  key={i}
                  className={
                    "flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors last:border-b-0" +
                    (st === "fail" ? " border-l-4 border-l-[var(--color-fail)] bg-[rgba(239,68,68,0.05)]" : "")
                  }
                  onClick={() => openDrawer({ kind: r.targetType, id: r.targetId })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{name} · {r.stage.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">Released {ago(r.p.rel)}{r.p.note ? " · " + r.p.note : ""}</div>
                  </div>
                  <Badge color={st === "fail" ? "red" : st === "wip" ? "blue" : "amber"}>{label}</Badge>
                </div>
              );
            }) : <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">No stages released to your role.</div>}
          </Card>

          <SectionLabel icon="snags">Snags on Me</SectionLabel>
          <Card padded={false}>
            {sng.length ? sng.map((s) => <SnagRow key={s.id} s={s} />) : <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">No open snags assigned to you.</div>}
          </Card>
        </>
      )}

      <SectionLabel icon="pin">Assigned by Me</SectionLabel>
      <Card padded={false}>
        {outAsg.length === 0 && outSng.length === 0 ? (
          <div className="py-7 text-center text-[var(--text-muted)] text-[13px]">You haven't handed off any work.</div>
        ) : (
          <>
            {outAsg.map((a) => {
              const target = a.targetType === "unit" ? refLabel(data, "units", a.targetId) : refLabel(data, "floors", a.targetId);
              const d = dueLabel(a.dueAt);
              return (
                <div
                  key={a.id}
                  className={
                    "flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors last:border-b-0" +
                    (d.cls === "fail" ? " border-l-4 border-l-[var(--color-fail)] bg-[rgba(239,68,68,0.05)]" : "")
                  }
                  onClick={() => openDrawer({ kind: a.targetType, id: a.targetId })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">📌 {target} · {refLabel(data, "stages", a.stageId)}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">Handed to {refLabel(data, "users", a.assignedTo)} {ago(a.assignedAt)}{a.note ? " · " + a.note : ""}</div>
                  </div>
                  <Badge color={d.cls === "fail" ? "red" : d.cls === "gate" ? "amber" : "gray"}>{a.status}</Badge>
                </div>
              );
            })}
            {outSng.map((s) => {
              const d = dueLabel(s.dueAt);
              return (
                <div
                  key={s.id}
                  className={
                    "flex items-center justify-between gap-3 py-3.5 px-4 border-b border-[var(--border)] cursor-pointer transition-colors last:border-b-0" +
                    (s.severity === "Critical" ? " border-l-4 border-l-[var(--color-fail)] bg-[rgba(239,68,68,0.05)]" : "")
                  }
                  onClick={() => openDrawer({ kind: "snag", id: s.id })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">🐞 {s.title}</div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-normal">{snagTarget(data, s)} · handed to {refLabel(data, "users", s.assignedTo)} {ago(s.lastReassignedAt)}</div>
                  </div>
                  <Badge color={d.cls === "fail" ? "red" : d.cls === "gate" ? "amber" : "gray"}>{s.status}</Badge>
                </div>
              );
            })}
          </>
        )}
      </Card>
    </div>
  );
}
