import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel } from "../shared/rules";
import { fmtDT, ago } from "../shared/helpers";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import type { EventLog } from "../types";

const ACTION_LABEL: Record<string, string> = {
  ACK: "Release acknowledged",
  START: "Work started",
  COMPLETE: "Stage completed",
  QC_FAIL: "QC gate failed",
  QC_PASS: "QC gate passed",
  MEASURE: "Hidden work measured",
  ASSIGN: "Work assigned",
  ASSIGN_ASSIGNED: "Reassigned",
  ASSIGN_ACCEPTED: "Assignment accepted",
  ASSIGN_DONE: "Assignment marked done",
  SNAG_RAISE: "Snag raised",
  SNAG_REOPEN: "Snag reopened",
  SNAG_REASSIGN: "Snag reassigned",
  SNAG_OPEN: "Snag reopened as Open",
  SNAG_IN_PROGRESS: "Snag marked In Progress",
  SNAG_CLOSED: "Snag closed"
};

/* Modules with an empty `actions` list have no corresponding entry in the
   `events` collection at all yet (nothing in the app currently calls
   logEvent() for them) — shown honestly as "0 logs" rather than inventing
   activity, same as the reference layout's genuinely-unused modules.

   Every action string this list covers must match exactly what
   hooks/useActions.ts's logEvent() calls actually emit — a few were found
   missing from this list during an audit (SNAG_REASSIGN, the
   SNAG_OPEN/IN_PROGRESS/CLOSED status-change events, ASSIGN_ASSIGNED, and
   MEASURE), which meant those real, already-logged events were simply
   unreachable from every module card. Keep this in sync if useActions.ts
   ever adds a new logEvent() action. */
interface ModuleDef { key: string; label: string; desc: string; icon: string; actions: string[] }
const MODULES: ModuleDef[] = [
  { key: "workProgress", label: "Work Progress", desc: "Stage acknowledgements, starts, completions, QC gates, and hidden-work measurements", icon: "board", actions: ["ACK", "START", "COMPLETE", "QC_FAIL", "QC_PASS", "MEASURE"] },
  { key: "assignments", label: "Assignments", desc: "Work handed off, accepted, reassigned, and marked done", icon: "work", actions: ["ASSIGN", "ASSIGN_ASSIGNED", "ASSIGN_ACCEPTED", "ASSIGN_DONE"] },
  { key: "snags", label: "Snags", desc: "Quality defects raised, reassigned, reopened, and status changes", icon: "snags", actions: ["SNAG_RAISE", "SNAG_REOPEN", "SNAG_REASSIGN", "SNAG_OPEN", "SNAG_IN_PROGRESS", "SNAG_CLOSED"] },
  { key: "drawingRequests", label: "Drawing Requests", desc: "Drawing request review chain", icon: "drawing", actions: [] },
  { key: "dpr", label: "Daily Progress Reports", desc: "Site DPR submissions", icon: "dpr", actions: [] },
  { key: "masters", label: "Masters", desc: "Project/Floor/Unit/Stage configuration", icon: "masters", actions: [] },
  { key: "users", label: "Users", desc: "User accounts and roles", icon: "team", actions: [] },
  { key: "backups", label: "Backups", desc: "Board backups and restores", icon: "database", actions: [] }
];

function moduleEvents(events: EventLog[], mod: ModuleDef): EventLog[] {
  return events.filter((e) => mod.actions.includes(e.action));
}

export default function AuditLog() {
  const { data, currentUserId } = useApp();
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fAction, setFAction] = useState("");
  const [fUser, setFUser] = useState("");

  const users = coll(data, "users");
  const allEvents = (data?.events || []).slice().sort((a, b) => b.ts - a.ts);

  if (!moduleKey) {
    return (
      <div>
        <div className="page-header">
          <div className="page-header-left">
            <div className="page-icon"><NavIcon name="clock" size={20} /></div>
            <div>
              <div className="page-title">Audit Logs</div>
              <div className="page-desc">Complete record of who did what, and when — pick a module to see its activity.</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {MODULES.map((mod) => {
            const evs = moduleEvents(allEvents, mod);
            const last = evs[0]?.ts;
            return (
              <div key={mod.key} className="card card-pad" style={{ cursor: "pointer" }} onClick={() => setModuleKey(mod.key)}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <div className="page-icon" style={{ width: 34, height: 34, fontSize: 15 }}><NavIcon name={mod.icon} size={16} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{mod.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{mod.desc}</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12 }}>
                  <span style={{ fontWeight: 800, color: "var(--text-main)" }}>{evs.length} log{evs.length === 1 ? "" : "s"}</span>
                  <span style={{ color: "var(--text-muted)" }}>{last ? fmtDT(last) : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const mod = MODULES.find((m) => m.key === moduleKey)!;
  const scoped = moduleEvents(allEvents, mod);
  const actionOptions = Array.from(new Set(scoped.map((e) => e.action))).sort();

  let rows = scoped;
  if (fAction) rows = rows.filter((e) => e.action === fAction);
  if (fUser) rows = rows.filter((e) => e.userId === fUser);
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter((e) =>
      (e.detail + " " + e.action + " " + refLabel(data, "users", e.userId)).toLowerCase().includes(ql)
    );
  }

  const ROW_CAP = 300;
  const shown = rows.slice(0, ROW_CAP);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name={mod.icon} size={20} /></div>
          <div>
            <div className="page-title">{mod.label}</div>
            <div className="page-desc">{mod.desc}</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => { setModuleKey(null); setQ(""); setFAction(""); setFUser(""); }}>‹ All modules</button>
        </div>
      </div>

      {scoped.length === 0 ? (
        <div className="panel-card">
          <div className="empty">No activity logged for this module yet.</div>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <input className="input grow" placeholder="Search by detail, action, or user…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ width: 200 }}>
              <SearchDropdown
                value={fAction}
                onChange={setFAction}
                options={[{ value: "", label: "All actions" }, ...actionOptions.map((a) => ({ value: a, label: ACTION_LABEL[a] || a }))]}
                neutralActive
              />
            </div>
            <div style={{ width: 200 }}>
              <SearchDropdown
                value={fUser}
                onChange={setFUser}
                options={[{ value: "", label: "Everyone" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                neutralActive
              />
            </div>
          </div>

          <div className="panel-card" style={{ minHeight: "60vh" }}>
            {shown.length === 0 ? (
              <div className="empty">No events match these filters.</div>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((e, i) => (
                      <tr key={i} title={fmtDT(e.ts)}>
                        <td className="num">{ago(e.ts)}</td>
                        <td>{e.userId === currentUserId ? "You" : refLabel(data, "users", e.userId)}</td>
                        <td><span className="badge-tag mute">{ACTION_LABEL[e.action] || e.action}</span></td>
                        <td>{e.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > ROW_CAP && (
              <div className="section-sub" style={{ padding: "10px 4px 0" }}>
                Showing the {ROW_CAP} most recent of {rows.length} matching events — narrow the filters above to see older ones.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
