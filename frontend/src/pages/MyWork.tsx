import React from "react";
import { useApp } from "../context/AppContext";
import { myAssignments, mySnags, myReleases, refLabel } from "../shared/rules";
import { ago } from "../shared/helpers";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import NavIcon from "../components/NavIcon";

export default function MyWork() {
  const { data, currentProjectId, currentUserId, openAssignModal, openDrawer } = useApp();
  const asg = myAssignments(data, currentProjectId, currentUserId);
  const sng = mySnags(data, currentProjectId, currentUserId);
  const rel = myReleases(data, currentProjectId, currentUserId);

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
    </div>
  );
}
