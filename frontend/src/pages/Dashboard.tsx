import React from "react";
import { useApp } from "../context/AppContext";
import { SEVERITIES } from "../services/config";
import {
  coll, projectUnits, projectFloors, floorUnits, unitSummary, slowHandoffs, floorReleased,
  myAssignments, mySnags, refLabel
} from "../lib/rules";
import AssignRow from "../components/AssignRow";
import SnagRow from "../components/SnagRow";
import NavIcon from "../components/NavIcon";
import type { Floor } from "../types";

const FLOOR_LIST_CAP = 40;

export default function Dashboard({ viewAllProjects }: { viewAllProjects: boolean }) {
  const { data, currentProjectId, currentUserId, me, openDrawer } = useApp();
  const allProjects = coll(data, "projects").filter((p) => p.active !== false);
  // "All Projects" combines real per-project results — each helper below is
  // still called once per real project (never with a null/empty projectId),
  // so a floor's own project always drives its own stage list. No shared
  // rule function had to change to make this work.
  const projectIds = viewAllProjects ? allProjects.map((p) => p.id) : [currentProjectId];

  const units = projectIds.flatMap((pid) => projectUnits(data, pid));
  const summaries = projectIds.flatMap((pid) => projectUnits(data, pid).map((u) => unitSummary(data, pid, u.id)));
  const handed = summaries.filter((s) => s.complete).length;
  const stagesTotal = summaries.reduce((a, s) => a + s.total, 0) || 1;
  const stagesDone = summaries.reduce((a, s) => a + s.done, 0);
  const pct = Math.round((stagesDone / stagesTotal) * 100);
  const openSnags = viewAllProjects
    ? coll(data, "snags").filter((s) => s.status !== "Closed")
    : coll(data, "snags").filter((s) => s.status !== "Closed" && s.projectId === currentProjectId);
  const critical = openSnags.filter((s) => s.severity === "Critical").length;
  const slow = projectIds.flatMap((pid) => slowHandoffs(data, pid)).sort((a, b) => b.hrs - a.hrs);
  const floors: Floor[] = projectIds.flatMap((pid) => projectFloors(data, pid));
  const castFloors = floors.filter((f) => floorReleased(data, f.projectId, f.id)).length;

  const stats = [
    { label: "UNITS HANDED OVER", val: `${handed}/${units.length}`, ok: true, icon: "award", foot: pct + "% of all stages complete" },
    { label: "OPEN SNAGS", val: openSnags.length, bad: openSnags.length > 0, icon: "bug", foot: critical + " critical" },
    { label: "SLOW HANDOFFS", val: slow.length, warn: slow.length > 0, icon: "clock", foot: "Released past SLA, not acknowledged" },
    { label: "FLOORS CURED", val: `${castFloors}/${floors.length}`, icon: "board", foot: "Bottom-up casting enforced" }
  ];

  const asg = projectIds.flatMap((pid) => myAssignments(data, pid, currentUserId));
  const sng = projectIds.flatMap((pid) => mySnags(data, pid, currentUserId));
  const myOpen = asg.length + sng.length;
  const bySeverity = SEVERITIES.map((sev) => ({ sev, n: openSnags.filter((s) => s.severity === sev).length }));

  const floorRows = floors.slice().reverse().slice(0, FLOOR_LIST_CAP);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="dashboard" size={20} /></div>
          <div>
            <div className="page-title">Dashboard</div>
            <div className="page-desc">
              {viewAllProjects
                ? "Combined KPIs, what needs you, and floor-by-floor progress across all projects."
                : "Site-wide KPIs, what needs you, and floor-by-floor progress."}
            </div>
          </div>
        </div>
      </div>

      <div className="micro-label" style={{ marginBottom: 10 }}>KPI OVERVIEW</div>
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {stats.map((s) => (
          <div key={s.label} className={"stat-card" + (s.bad ? " bad" : s.warn ? " warn" : s.ok ? " ok" : "")}>
            <div className="micro-label">{s.label}</div>
            <div className="stat-val">{s.val}</div>
            <div className="stat-foot">{s.foot}</div>
            <div className="stat-icon"><NavIcon name={s.icon} size={15} /></div>
          </div>
        ))}
      </div>

      <div className="section-header">
        <div className="section-title"><span className="icon-mono"><NavIcon name="pin" size={14} /></span> WHAT NEEDS ME</div>
        <div className="section-sub">{myOpen} open item{myOpen === 1 ? "" : "s"} for {me()?.name || ""}</div>
      </div>
      <div className="card">
        {myOpen === 0
          ? <div className="empty">🎉 Nothing assigned to you right now.</div>
          : <>{asg.slice(0, 4).map((a) => <AssignRow key={a.id} a={a} />)}{sng.slice(0, 4).map((s) => <SnagRow key={s.id} s={s} />)}</>}
      </div>

      {slow.length > 0 && (
        <>
          <div className="section-header">
            <div className="section-title"><span className="icon-mono"><NavIcon name="clock" size={14} /></span> SLOW HANDOFFS</div>
            <div className="section-sub">Released to a trade but never acknowledged — these are the huddle agenda</div>
          </div>
          <div className="card">
            {slow.slice(0, 6).map((s, i) => {
              const name = s.targetType === "unit" ? refLabel(data, "units", s.targetId) : refLabel(data, "floors", s.targetId);
              return (
                <div key={i} className="qitem warn" onClick={() => openDrawer({ kind: s.targetType, id: s.targetId })}>
                  <div className="qitem-main">
                    <div className="qitem-title">{name} · {s.stage.name}</div>
                    <div className="qitem-sub">Waiting {Math.round(s.hrs)}h · SLA {s.sla}h · owner role {s.stage.role}</div>
                  </div>
                  <span className="badge-tag gate">{Math.round(s.hrs - s.sla)}h OVER</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="section-header">
        <div className="section-title"><span className="icon-mono"><NavIcon name="trend" size={14} /></span> FLOOR PROGRESS</div>
        {viewAllProjects && floors.length > FLOOR_LIST_CAP && (
          <div className="section-sub">Showing the latest {FLOOR_LIST_CAP} of {floors.length} floors across all projects</div>
        )}
      </div>
      <div className="card card-pad">
        {floorRows.map((f) => {
          const us = floorUnits(data, f.projectId, f.id);
          const s = us.map((u) => unitSummary(data, f.projectId, u.id));
          const d = s.reduce((a, x) => a + x.done, 0);
          const t = s.reduce((a, x) => a + x.total, 0) || 1;
          const p = Math.round((d / t) * 100);
          const released = floorReleased(data, f.projectId, f.id);
          return (
            <div key={f.id} style={{ marginBottom: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700 }}>
                <span>
                  {viewAllProjects ? refLabel(data, "projects", f.projectId) + " · " : ""}{f.name}{" "}
                  <span style={{ color: "var(--text-sub)", fontWeight: 600 }}>· {us.length} units{released ? "" : " · structure in progress"}</span>
                </span>
                <span style={{ color: "var(--text-muted)" }}>{p}%</span>
              </div>
              <div className="workload-bar"><div className="workload-fill" style={{ width: p + "%", background: p === 100 ? "var(--color-pass)" : "var(--theme-primary)" }}></div></div>
            </div>
          );
        })}
        <div className="legend-bar" style={{ marginTop: 6 }}>
          {bySeverity.map((b) => (
            <div key={b.sev} className="legend-item">
              <span className={"badge-tag " + (b.sev === "Critical" ? "crit" : b.sev === "Major" ? "gate" : "mute")}>{b.n} {b.sev}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
