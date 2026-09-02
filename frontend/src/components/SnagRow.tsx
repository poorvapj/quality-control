import React from "react";
import { useApp } from "../context/AppContext";
import { refLabel, snagTarget } from "../shared/rules";
import { dueLabel, ago } from "../shared/helpers";
import type { Snag } from "../types";

export default function SnagRow({ s }: { s: Snag }) {
  const { data, openDrawer } = useApp();
  const d = dueLabel(s.dueAt);
  return (
    <div className={"qitem" + (s.severity === "Critical" ? " alert" : " warn")} onClick={(e) => { e.stopPropagation(); openDrawer({ kind: "snag", id: s.id }); }}>
      <div className="qitem-main">
        <div className="qitem-title">🐞 {s.title}</div>
        <div className="qitem-sub">{snagTarget(data, s)} · {refLabel(data, "stages", s.stageId)} · raised by {refLabel(data, "users", s.raisedBy)} {ago(s.raisedAt)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
        <span className={"badge-tag " + d.cls}>{d.text}</span>
      </div>
    </div>
  );
}
