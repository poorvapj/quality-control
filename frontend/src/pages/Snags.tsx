import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel, snagTarget } from "../shared/rules";
import { dueLabel, ago } from "../shared/helpers";
import { ESCALATION_DAYS, HOUR } from "../services/config";
import NavIcon from "../components/NavIcon";

export default function Snags() {
  const { data, currentProjectId, currentUserId, openSnagModal, openDrawer, apply, toast } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const [q, setQ] = useState("");
  const [fs, setFs] = useState("");
  const [fv, setFv] = useState("");
  const [fm, setFm] = useState("");

  async function deleteSnag(e: React.MouseEvent, s: { id: string; title: string }) {
    e.stopPropagation();
    if (!confirm(`Delete snag ${s.id} — "${s.title}"?\n\nThis removes it for everyone on the board.`)) return;
    await apply([{ op: "delete", coll: "snags", id: s.id }]);
    toast("Deleted " + s.id);
  }

  let list = coll(data, "snags").filter((s) => s.projectId === currentProjectId);
  if (fs) list = list.filter((s) => s.status === fs);
  if (fv) list = list.filter((s) => s.severity === fv);
  if (fm === "mine") list = list.filter((s) => s.assignedTo === currentUserId);
  if (fm === "raised") list = list.filter((s) => s.raisedBy === currentUserId);
  if (q) {
    const ql = q.toLowerCase();
    list = list.filter((s) => (s.title + " " + (s.description || "") + " " + snagTarget(data, s)).toLowerCase().includes(ql));
  }
  list = list.slice().sort(
    (a, b) => (b.status === "Closed" ? -1 : 1) - (a.status === "Closed" ? -1 : 1) || (b.raisedAt || 0) - (a.raisedAt || 0)
  );

  const all = coll(data, "snags").filter((s) => s.projectId === currentProjectId);
  const open = all.filter((s) => s.status !== "Closed");
  const overdue = open.filter((s) => s.dueAt && s.dueAt < Date.now());
  // Escalation is deliberately computed on read, not a cron job or persisted
  // flag — always reflects the live picture, no scheduler/notification
  // infra needed. Threshold: overdue by ESCALATION_DAYS+ still-open days.
  const escalated = open
    .filter((s) => s.dueAt && Date.now() - s.dueAt >= ESCALATION_DAYS * 24 * HOUR)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="snags" size={20} /></div>
          <div>
            <div className="page-title">Snag Register</div>
            <div className="page-desc">{open.length} open · {overdue.length} overdue · {all.length - open.length} closed</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => openSnagModal({ unitId: "", stageId: "" })}>＋ Raise snag</button>
        </div>
      </div>

      {escalated.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: "var(--color-fail)", background: "rgba(239,68,68,0.06)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-fail)", marginBottom: 8 }}>
            ⚠ {escalated.length} snag{escalated.length === 1 ? "" : "s"} escalated — overdue {ESCALATION_DAYS}+ days, needs senior attention
          </div>
          {escalated.map((s) => (
            <div key={s.id} className="qitem alert" onClick={() => openDrawer({ kind: "snag", id: s.id })} style={{ cursor: "pointer" }}>
              <div className="qitem-main">
                <div className="qitem-title">{s.id} · {s.title}</div>
                <div className="qitem-sub">{snagTarget(data, s)} · assigned to {refLabel(data, "users", s.assignedTo)} · {dueLabel(s.dueAt).text}</div>
              </div>
              <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
            </div>
          ))}
        </div>
      )}

      <div className="panel-card">
        <div className="toolbar">
          <input className="input grow" placeholder="Search snags by title, unit or description…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: "auto" }} value={fs} onChange={(e) => setFs(e.target.value)}>
            <option value="">All statuses</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Closed">Closed</option>
          </select>
          <select className="select" style={{ width: "auto" }} value={fv} onChange={(e) => setFv(e.target.value)}>
            <option value="">All severities</option>
            <option value="Critical">Critical</option>
            <option value="Major">Major</option>
            <option value="Minor">Minor</option>
          </select>
          <select className="select" style={{ width: "auto" }} value={fm} onChange={(e) => setFm(e.target.value)}>
            <option value="">Everyone</option>
            <option value="mine">Assigned to me</option>
            <option value="raised">Raised by me</option>
          </select>
        </div>
        <div>
          {list.length === 0 && <div className="empty">No snags match these filters.</div>}
          {list.map((s) => {
            const d = dueLabel(s.dueAt);
            const closed = s.status === "Closed";
            return (
              <div
                key={s.id}
                className={"qitem" + (!closed && s.severity === "Critical" ? " alert" : "")}
                style={closed ? { opacity: 0.6 } : undefined}
                onClick={() => openDrawer({ kind: "snag", id: s.id })}
              >
                <div className="qitem-main">
                  <div className="qitem-title">{s.id} · {s.title}</div>
                  <div className="qitem-sub">
                    {snagTarget(data, s)} · {refLabel(data, "stages", s.stageId)} ·{" "}
                    {s.paramId ? refLabel(data, "qparams", s.paramId) + " · " : ""}
                    raised by {refLabel(data, "users", s.raisedBy)} {ago(s.raisedAt)} · on {refLabel(data, "users", s.assignedTo)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
                  <span className={"badge-tag " + (closed ? "pass" : s.status === "In Progress" ? "wip" : "fail")}>{s.status}</span>
                  {!closed && <span className={"badge-tag " + d.cls}>{d.text}</span>}
                  {isAdmin && (
                    <button className="btn-icon" title="Delete" onClick={(e) => deleteSnag(e, s)} style={{ width: 28, height: 28 }}>
                      <NavIcon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
