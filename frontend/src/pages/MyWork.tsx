import React from "react";
import { useApp } from "../context/AppContext";
import { coll, myAssignments, mySnags, myReleases, assignmentsByMe, snagsByMe, refLabel, snagTarget } from "../shared/rules";
import { ago, dueLabel } from "../shared/helpers";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import NavIcon from "../components/NavIcon";

export default function MyWork() {
  const { data, currentProjectId, currentUserId, openAssignModal, openDrawer } = useApp();
  // "My Work" is personal — whatever's assigned to me, on any project —
  // not scoped to whichever project happens to be selected elsewhere.
  // `currentProjectId` defaults to projects[0] and this page has no project
  // switcher, so scoping to it silently hid work from other projects.
  const projectIds = coll(data, "projects").filter((p) => p.active !== false).map((p) => p.id);
  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId));
  const rel = projectIds.flatMap((pid) => myReleases(data, pid, currentUserId));
  // What I've handed off to someone else, still open — a DRI assigning work
  // needs to see who they gave it to and its status, not just what's on them.
  const outAsg = projectIds.flatMap((pid) => assignmentsByMe(data, pid, currentUserId));
  const outSng = projectIds.flatMap((pid) => snagsByMe(data, pid, currentUserId));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="work" size={20} /></div>
          <div>
            <div className="page-title">My Work</div>
            <div className="page-desc">{asg.length} assigned · {rel.length} released to your role · {sng.length} snags on you</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => openAssignModal({ targetType: "unit", targetId: "", stageId: "" })}>＋ Assign work</button>
        </div>
      </div>

      <div className="section-header"><div className="section-title"><span className="icon-mono"><NavIcon name="pin" size={14} /></span> ASSIGNED TO ME</div></div>
      <div className="card">
        {asg.length ? asg.map((a) => <AssignRow key={a.id} a={a} />) : <div className="empty">Nothing assigned to you.</div>}
      </div>

      <div className="section-header"><div className="section-title"><span className="icon-mono"><NavIcon name="work" size={14} /></span> RELEASED TO MY ROLE</div></div>
      <div className="card">
        {rel.length ? rel.map((r, i) => {
          const name = r.targetType === "unit" ? refLabel(data, "units", r.targetId) : refLabel(data, "floors", r.targetId);
          const st = r.p.status;
          const label = st === "fail" ? "REWORK" : st === "wip" ? "IN PROGRESS" : st === "ack" ? "ACKNOWLEDGED" : "NEW RELEASE";
          return (
            <div key={i} className={"qitem" + (st === "fail" ? " alert" : "")} onClick={() => openDrawer({ kind: r.targetType, id: r.targetId })}>
              <div className="qitem-main">
                <div className="qitem-title">{name} · {r.stage.name}</div>
                <div className="qitem-sub">Released {ago(r.p.rel)}{r.p.note ? " · " + r.p.note : ""}</div>
              </div>
              <span className={"badge-tag " + (st === "fail" ? "fail" : st === "wip" ? "wip" : "gate")}>{label}</span>
            </div>
          );
        }) : <div className="empty">No stages released to your role.</div>}
      </div>

      <div className="section-header"><div className="section-title"><span className="icon-mono"><NavIcon name="snags" size={14} /></span> SNAGS ON ME</div></div>
      <div className="card">
        {sng.length ? sng.map((s) => <SnagRow key={s.id} s={s} />) : <div className="empty">No open snags assigned to you.</div>}
      </div>

      <div className="section-header"><div className="section-title"><span className="icon-mono"><NavIcon name="pin" size={14} /></span> ASSIGNED BY ME</div></div>
      <div className="card">
        {outAsg.length === 0 && outSng.length === 0 ? (
          <div className="empty">You haven't handed off any work.</div>
        ) : (
          <>
            {outAsg.map((a) => {
              const target = a.targetType === "unit" ? refLabel(data, "units", a.targetId) : refLabel(data, "floors", a.targetId);
              const d = dueLabel(a.dueAt);
              return (
                <div key={a.id} className={"qitem" + (d.cls === "fail" ? " alert" : "")} onClick={() => openDrawer({ kind: a.targetType, id: a.targetId })}>
                  <div className="qitem-main">
                    <div className="qitem-title">📌 {target} · {refLabel(data, "stages", a.stageId)}</div>
                    <div className="qitem-sub">Handed to {refLabel(data, "users", a.assignedTo)} {ago(a.assignedAt)}{a.note ? " · " + a.note : ""}</div>
                  </div>
                  <span className={"badge-tag " + d.cls}>{a.status}</span>
                </div>
              );
            })}
            {outSng.map((s) => {
              const d = dueLabel(s.dueAt);
              return (
                <div key={s.id} className={"qitem" + (s.severity === "Critical" ? " alert" : "")} onClick={() => openDrawer({ kind: "snag", id: s.id })}>
                  <div className="qitem-main">
                    <div className="qitem-title">🐞 {s.title}</div>
                    <div className="qitem-sub">{snagTarget(data, s)} · handed to {refLabel(data, "users", s.assignedTo)} {ago(s.lastReassignedAt)}</div>
                  </div>
                  <span className={"badge-tag " + d.cls}>{s.status}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
