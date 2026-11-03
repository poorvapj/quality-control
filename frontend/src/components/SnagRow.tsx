import React from "react";
import { useApp } from "../context/AppContext";
import { refLabel, snagTarget, rccItemLabel } from "../shared/rules";
import { dueLabel, ago } from "../shared/helpers";
import type { Snag } from "../types";

export default function SnagRow({ s, showAssignee }: { s: Snag; showAssignee?: boolean }) {
  const { data, openDrawer } = useApp();
  const closed = s.status === "Closed";
  // Was always "alert"/"warn" off severity alone, and always showed
  // dueLabel()'s "Overdue by Xh" — both purely time/severity-based, with no
  // idea the snag might already be Closed. A Minor snag resolved weeks ago,
  // whose due date happened to be in the past before it was fixed, still
  // read as an urgent red "Overdue" row forever — exactly what kept a
  // reinspected-and-approved Pass looking like an open red alert on a team
  // leader's dashboard.
  const d = dueLabel(s.dueAt);
  return (
    <div className={"qitem" + (closed ? "" : s.severity === "Critical" ? " alert" : " warn")} onClick={(e) => { e.stopPropagation(); openDrawer({ kind: "snag", id: s.id }); }}>
      <div className="qitem-main">
        <div className="qitem-title">🐞 {s.title}</div>
        <div className="qitem-sub">
          {snagTarget(data, s)} · {s.itemId ? rccItemLabel(data, s.itemId) : refLabel(data, "stages", s.stageId)} · raised by {refLabel(data, "users", s.raisedBy)}
          {showAssignee ? <> · on {refLabel(data, "users", s.assignedTo)}</> : null} {ago(s.raisedAt)}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
        {closed ? <span className="badge-tag pass">Resolved</span> : <span className={"badge-tag " + d.cls}>{d.text}</span>}
      </div>
    </div>
  );
}
