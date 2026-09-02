import React from "react";
import { useApp } from "../context/AppContext";
import { refLabel } from "../shared/rules";
import { dueLabel, ago } from "../shared/helpers";
import { useActions } from "../hooks/useActions";
import type { Assignment } from "../types";

export default function AssignRow({ a }: { a: Assignment }) {
  const { data, currentUserId, myRole, openDrawer } = useApp();
  const { setAssignStatus } = useActions();
  const d = dueLabel(a.dueAt);
  const target = a.targetType === "unit" ? refLabel(data, "units", a.targetId) : refLabel(data, "floors", a.targetId);
  const mine = a.assignedTo === currentUserId || myRole() === "DRI";

  return (
    <div className={"qitem" + (d.cls === "fail" ? " alert" : "")} onClick={() => openDrawer({ kind: a.targetType, id: a.targetId })}>
      <div className="qitem-main">
        <div className="qitem-title">📌 {target} · {refLabel(data, "stages", a.stageId)}</div>
        <div className="qitem-sub">{a.note || "Assigned work"} · from {refLabel(data, "users", a.assignedBy)} {ago(a.assignedAt)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span className={"badge-tag " + d.cls}>{d.text}</span>
        {mine ? (
          <>
            {a.status === "Assigned" && (
              <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setAssignStatus(a.id, "Accepted"); }}>Accept</button>
            )}
            <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); setAssignStatus(a.id, "Done"); }}>Done</button>
          </>
        ) : (
          <span className="badge-tag mute">{a.status}</span>
        )}
      </div>
    </div>
  );
}
