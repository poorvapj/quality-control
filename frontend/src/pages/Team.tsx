import React from "react";
import { useApp } from "../context/AppContext";
import { ROLES } from "../services/config";
import { coll } from "../lib/rules";
import NavIcon from "../components/NavIcon";

export default function Team() {
  const { data, currentProjectId, openAssignModal, openDrawer } = useApp();
  const users = coll(data, "users").filter((u) => u.active !== false);
  const rows = users
    .map((u) => {
      const a = coll(data, "assignments").filter((x) => x.assignedTo === u.id && x.status !== "Done" && x.projectId === currentProjectId);
      const s = coll(data, "snags").filter((x) => x.assignedTo === u.id && x.status !== "Closed" && x.projectId === currentProjectId);
      const overdue = a.filter((x) => x.dueAt && x.dueAt < Date.now()).length + s.filter((x) => x.dueAt && x.dueAt < Date.now()).length;
      return { u, a: a.length, s: s.length, overdue, load: a.length + s.length };
    })
    .sort((x, y) => y.load - x.load);
  const max = Math.max(1, ...rows.map((r) => r.load));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="team" size={20} /></div>
          <div>
            <div className="page-title">Team Workload</div>
            <div className="page-desc">Open assignments and snags per person. Tap a person to see their board.</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => openAssignModal({ targetType: "unit", targetId: "", stageId: "" })}>＋ Assign work</button>
        </div>
      </div>
      <div className="card">
        {rows.map((r) => (
          <div key={r.u.id} className={"qitem" + (r.overdue ? " warn" : "")} onClick={() => openDrawer({ kind: "user", id: r.u.id })}>
            <div className="qitem-main">
              <div className="qitem-title">{r.u.name} <span style={{ color: "var(--text-sub)", fontWeight: 600 }}>· {ROLES[r.u.role]?.name || r.u.role}</span></div>
              <div className="qitem-sub">{r.u.company || ""}{r.u.phone ? " · " + r.u.phone : ""}</div>
              <div className="workload-bar" style={{ maxWidth: 260 }}>
                <div className="workload-fill" style={{ width: (r.load / max) * 100 + "%", background: r.overdue ? "var(--color-fail)" : "var(--theme-primary)" }}></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              <span className="badge-tag mute">{r.a} work</span>
              <span className={"badge-tag " + (r.s ? "fail" : "mute")}>{r.s} snags</span>
              {r.overdue > 0 && <span className="badge-tag gate">{r.overdue} overdue</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
