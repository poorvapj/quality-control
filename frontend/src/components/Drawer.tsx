import React, { useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { ROLES } from "../services/config";
import { byId, coll, canAct, blockReason, openSnagsFor, prog, refLabel, trackStages, snagTarget, unitSummary } from "../shared/rules";
import { fmtDT, ago, dueLabel } from "../shared/helpers";
import { useActions } from "../hooks/useActions";
import AssignRow from "./AssignRow";
import SnagRow from "./SnagRow";
import NavIcon from "./NavIcon";
import PossessionForm, { type PossessionActiveForm } from "./PossessionForm";
import { ACTION_LABEL } from "../pages/AuditLog";
import "./SharpPanel.css";

type UnitTab = "overview" | "gates" | "snags" | "possession" | "documents" | "activity";
const UNIT_TABS: { key: UnitTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "gates", label: "QC Gates" },
  { key: "snags", label: "Snags" },
  { key: "possession", label: "Possession" },
  { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity" }
];

export default function Drawer() {
  const { drawer, closeDrawer, data, currentProjectId, myRole } = useApp();
  if (!drawer) return null;
  return (
    <>
      <div className="overlay open" onClick={closeDrawer}></div>
      <div className="drawer-sheet open sharp-panel">
        {drawer.kind === "unit" || drawer.kind === "floor"
          ? <TrackDrawer kind={drawer.kind} id={drawer.id} />
          : drawer.kind === "snag"
          ? <SnagDrawer id={drawer.id} />
          : <UserDrawer id={drawer.id} />}
      </div>
    </>
  );
}

function TrackDrawer({ kind, id }: { kind: "unit" | "floor"; id: string }) {
  const { data, currentProjectId, myRole, closeDrawer, openAssignModal, openSnagModal, openChecklistModal } = useApp();
  const { ackStage, startStage, completeStage, failStage, capturePhoto } = useActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPhoto = useRef<{ kind: "unit" | "floor"; id: string; stageId: string } | null>(null);
  const [tab, setTab] = useState<UnitTab>("overview");
  const [possessionForm, setPossessionForm] = useState<PossessionActiveForm | null>(null);

  const track = kind;
  const list = trackStages(data, currentProjectId, track);
  const rec = byId(coll(data, kind === "unit" ? "units" : "floors"), id);
  if (!rec) return null;

  const snags = kind === "unit" ? openSnagsFor(data, id) : [];

  function renderStageList() {
    return (
      <>
        {snags.length > 0 && (
          <div className="note-box" style={{ marginBottom: 14 }}>
            {snags.length} open snag{snags.length > 1 ? "s" : ""} on this unit — QC gates stay blocked until they are closed.
          </div>
        )}
        {list.length === 0 && <div className="empty">No stages mapped for this track. Add them in Masters ▸ Stage Mapping.</div>}
        {list.map((x, idx) => {
          const s = x.stage;
          const p = prog(data, id, s.id);
          const done = p.status === "done";
          const fail = p.status === "fail";
          const block = blockReason(data, currentProjectId, kind, id, idx);
          const mine = canAct(myRole(), s);
          const chk = x.map.checklistId ? byId(coll(data, "checklists"), x.map.checklistId) : null;

          return (
            <div className={"stage-row" + (block && !done ? " is-locked" : "")} key={s.id}>
              <div className="stage-dot" style={{ background: done ? "var(--color-pass)" : fail ? "var(--color-fail)" : s.color || "var(--color-struct)" }}>
                {done ? "✓" : fail ? "✕" : idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {ROLES[s.role]?.name || s.role}{s.dwg ? " · 📐 " + s.dwg : ""}{chk ? " · ✅ " + chk.name : ""}
                </div>

                {s.isHidden && (
                  <div style={{ marginTop: 5 }}>
                    <span className={"badge-tag " + (p.meas ? "meas" : "gate")}>
                      {p.meas ? "📷 Measured " + fmtDT(p.meas) : "⚠️ Hidden work — DET measurement required"}
                    </span>
                  </div>
                )}

                {(p.rel || p.ack || p.start || p.at) && (
                  <div className="stage-meta">
                    {p.rel ? "Released " + fmtDT(p.rel) + " · " : ""}
                    {p.ack ? "Acknowledged " + fmtDT(p.ack) + " · " : ""}
                    {p.start ? "Started " + fmtDT(p.start) + " · " : ""}
                    {p.at ? "Completed " + fmtDT(p.at) : ""}
                    {p.by && <><br />By {refLabel(data, "users", p.by)}</>}
                  </div>
                )}

                {fail && p.note && <div className="note-box">Failed: {p.note}</div>}
                {block && !done && <div className="stage-meta" style={{ color: "var(--color-gate)", fontWeight: 700 }}>🔒 {block}</div>}

                <div className="stage-actions">
                  {(!block || done) && (
                    <>
                      {s.isHidden && !p.meas && (myRole() === "CIVIL" || myRole() === "ADMIN") && (
                        <button className="btn btn-meas btn-sm" onClick={() => { pendingPhoto.current = { kind, id, stageId: s.id }; fileRef.current?.click(); }}>
                          📸 Measure &amp; photograph
                        </button>
                      )}
                      {!done && mine && (
                        <>
                          {p.rel && !p.ack && <button className="btn btn-secondary btn-sm" onClick={() => ackStage(kind, id, s.id)}>Acknowledge</button>}
                          {!p.start && <button className="btn btn-secondary btn-sm" onClick={() => startStage(kind, id, s.id)}>Start work</button>}
                          {s.isGate && chk ? (
                            <button className="btn btn-primary btn-sm" onClick={() => openChecklistModal({ kind, id, stageId: s.id, checklistId: chk.id })}>✅ Run checklist</button>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => completeStage(kind, id, s.id)}>{fail ? "Rework done" : "Mark complete"}</button>
                          )}
                          {s.isGate && <button className="btn btn-danger btn-sm" onClick={() => failStage(kind, id, s.id)}>Fail</button>}
                        </>
                      )}
                    </>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => openAssignModal({ targetType: kind, targetId: id, stageId: s.id })}>👤 Assign</button>
                  {kind === "unit" && <button className="btn btn-secondary btn-sm" onClick={() => openSnagModal({ unitId: id, stageId: s.id, preset: "" })}>🐞 Snag</button>}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  }

  const photoInput = (
    <input
      type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        const pending = pendingPhoto.current;
        e.target.value = "";
        if (file && pending) capturePhoto(pending.kind, pending.id, pending.stageId, file);
      }}
    />
  );

  // Floor drawer is unchanged — no tabs, same single stage list as before.
  if (kind !== "unit") {
    return (
      <>
        <div className="drawer-header">
          <div style={{ minWidth: 0 }}>
            <div className="micro-label">RCC STRUCTURE TRACK</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{rec.name}</div>
          </div>
          <button className="btn-icon" onClick={closeDrawer}>✕</button>
        </div>
        <div className="drawer-body">{renderStageList()}</div>
        {photoInput}
      </>
    );
  }

  // Unit 360° — same drawer entry point, organized into tabs so the flat
  // stage list isn't the only thing a unit can show.
  const unit = rec as any;
  const closedSnags = coll(data, "snags").filter((s) => s.unitId === id && s.status === "Closed");
  const summary = unitSummary(data, currentProjectId, id);
  const overallPct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  const hoiIdx = list.findIndex((x) => x.stage.id === "STG-HOI");
  const hooIdx = list.findIndex((x) => x.stage.id === "STG-HOO");
  const floorName = refLabel(data, "floors", unit.floorId);
  const projectName = refLabel(data, "projects", currentProjectId);
  const activity = (data?.events || []).filter((e) => e.targetId === id).slice().sort((a, b) => b.ts - a.ts);

  function openPossession(idx: number) {
    if (idx === -1) return;
    const joined = list[idx];
    const chk = joined.map.checklistId ? byId(coll(data, "checklists"), joined.map.checklistId) : null;
    if (!chk) return;
    setPossessionForm({
      unitId: id, unitName: unit.name, floorName, projectName,
      stageId: joined.stage.id, stageName: joined.stage.name, checklistId: chk.id,
      stageDesc: joined.stage.id === "STG-HOI"
        ? "Civil / QC internal inspection before owner possession."
        : "Final owner possession and handover inspection."
    });
  }

  return (
    <>
      <div className="drawer-header">
        <div style={{ minWidth: 0 }}>
          <div className="micro-label">{floorName} · {unit.type || "Unit"}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{unit.name}</div>
        </div>
        <button className="btn-icon" onClick={closeDrawer}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 4, padding: "0 16px", borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
        {UNIT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flexShrink: 0, background: "none", border: "none", cursor: "pointer",
              padding: "10px 10px 8px", fontSize: 12, fontWeight: 700,
              color: tab === t.key ? "var(--theme-primary)" : "var(--text-muted)",
              borderBottom: tab === t.key ? "2px solid var(--theme-primary)" : "2px solid transparent"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === "overview" && (
          <>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                <span>Overall Progress</span>
                <span>{overallPct}%</span>
              </div>
              <div className="workload-bar"><div className="workload-fill" style={{ width: overallPct + "%" }} /></div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                {projectName} · {floorName} · {summary.done}/{summary.total} stages complete
              </div>
            </div>

            <div className="micro-label" style={{ marginBottom: 6 }}>QC GATES</div>
            <div className="card card-pad" style={{ marginBottom: 14 }}>
              {list.map((x) => {
                const p = prog(data, id, x.stage.id);
                const icon = p.status === "done" ? "✓" : p.status === "fail" ? "✕" : p.start ? "◐" : "○";
                const color = p.status === "done" ? "var(--color-pass)" : p.status === "fail" ? "var(--color-fail)" : "var(--text-muted)";
                return (
                  <div key={x.stage.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5 }}>
                    <span>{x.stage.name}</span>
                    <span style={{ color, fontWeight: 800 }}>{icon}</span>
                  </div>
                );
              })}
            </div>

            <div className="micro-label" style={{ marginBottom: 6 }}>SNAGS</div>
            <div className="card card-pad" style={{ marginBottom: 14, fontSize: 12.5 }}>
              {snags.length} Open{snags.filter((s) => s.severity === "Critical").length > 0 ? ` · ${snags.filter((s) => s.severity === "Critical").length} Critical` : ""}
              {closedSnags.length > 0 && <span style={{ color: "var(--text-muted)" }}> · {closedSnags.length} resolved</span>}
            </div>

            <div className="micro-label" style={{ marginBottom: 6 }}>POSSESSION</div>
            <div className="card card-pad" style={{ fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>Internal Possession</span>
                <span style={{ fontWeight: 700 }}>{hoiIdx === -1 ? "—" : prog(data, id, "STG-HOI").status === "done" ? "Completed" : prog(data, id, "STG-HOI").status === "fail" ? "Failed" : "Pending"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span>Owner Possession</span>
                <span style={{ fontWeight: 700 }}>{hooIdx === -1 ? "—" : prog(data, id, "STG-HOO").status === "done" ? "Completed" : prog(data, id, "STG-HOO").status === "fail" ? "Failed" : "Pending"}</span>
              </div>
            </div>
          </>
        )}

        {tab === "gates" && renderStageList()}

        {tab === "snags" && (
          <>
            <div className="micro-label" style={{ marginBottom: 6 }}>OPEN ({snags.length})</div>
            <div className="card" style={{ marginBottom: 16 }}>
              {snags.length ? snags.map((s) => <SnagRow key={s.id} s={s} />) : <div className="empty">No open snags on this unit.</div>}
            </div>
            <div className="micro-label" style={{ marginBottom: 6 }}>CLOSED ({closedSnags.length})</div>
            <div className="card card-pad">
              {closedSnags.length === 0 && <div className="empty">No closed snags yet.</div>}
              {closedSnags.map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, borderBottom: "1px solid var(--border)" }}>
                  <span>{s.title}</span>
                  <span style={{ color: "var(--text-muted)" }}>{s.closedAt ? fmtDT(s.closedAt) : ""}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "possession" && (
          <>
            {[{ idx: hoiIdx, label: "Internal Possession" }, { idx: hooIdx, label: "Owner Possession" }].map(({ idx, label }) => {
              if (idx === -1) {
                return (
                  <div key={label} className="card card-pad" style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>{label}</div>
                    <div className="empty">Not mapped for this project yet.</div>
                  </div>
                );
              }
              const joined = list[idx];
              const p = prog(data, id, joined.stage.id);
              const done = p.status === "done";
              const fail = p.status === "fail";
              const block = blockReason(data, currentProjectId, "unit", id, idx);
              const mine = canAct(myRole(), joined.stage);
              const chk = joined.map.checklistId ? byId(coll(data, "checklists"), joined.map.checklistId) : null;
              return (
                <div key={label} className="card card-pad" style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{label}</div>
                    {done && <span className="badge-tag pass">Completed</span>}
                    {fail && <span className="badge-tag fail">Failed</span>}
                  </div>
                  {block && !done && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>⚠ {block} — informational only, form still opens.</div>
                  )}
                  {!done && mine && chk && (
                    <button className="btn btn-primary btn-sm" onClick={() => openPossession(idx)}>{fail ? "Rework" : "Fill Form"}</button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {tab === "documents" && (
          <div className="empty">No documents yet.</div>
        )}

        {tab === "activity" && (
          <>
            {activity.length === 0 && <div className="empty">No activity logged for this unit yet.</div>}
            {activity.map((e, i) => (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ fontWeight: 700 }}>{refLabel(data, "users", e.userId)}</span>
                  <span style={{ color: "var(--text-muted)" }} title={fmtDT(e.ts)}>{ago(e.ts)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                  {ACTION_LABEL[e.action] || e.action} — {e.detail}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {photoInput}
      <PossessionForm form={possessionForm} onDone={() => setPossessionForm(null)} />
    </>
  );
}

function SnagDrawer({ id }: { id: string }) {
  const { data, closeDrawer, currentProjectId } = useApp();
  const { setSnagStatus, saveSnagAssignee, capturePhoto } = useActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const s = byId(coll(data, "snags"), id);
  const [assignee, setAssignee] = React.useState(s?.assignedTo || "");
  React.useEffect(() => setAssignee(s?.assignedTo || ""), [s?.assignedTo]);
  if (!s) return null;

  const d = dueLabel(s.dueAt);
  const closed = s.status === "Closed";
  const users = coll(data, "users").filter((u) => u.active !== false);

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 };
  const value: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--text-main)", lineHeight: 1.4 };
  const empty: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "#9CA3AF" };
  function Field({ full, children }: { full?: boolean; children: React.ReactNode }) {
    return <div style={full ? { gridColumn: "1 / -1" } : undefined}>{children}</div>;
  }

  return (
    <>
      <div className="drawer-header">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
          <div className="page-icon" style={{ width: 38, height: 38, fontSize: 17, flexShrink: 0 }}>
            <NavIcon name="snags" size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="micro-label">SNAG {s.id}</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{s.title}</div>
          </div>
        </div>
        <button
          onClick={closeDrawer}
          aria-label="Close"
          style={{
            width: 32, height: 32, flexShrink: 0, border: "none", background: "none",
            color: "var(--text-muted)", fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
        >
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
          <span className={"badge-tag " + (closed ? "pass" : s.status === "In Progress" ? "wip" : "fail")}>{s.status}</span>
          {!closed && <span className={"badge-tag " + d.cls}>{d.text}</span>}
        </div>

        <div style={label}>Description</div>
        <div style={{ ...value, marginBottom: 20 }}>{s.description || <span style={empty}>No description.</span>}</div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0 20px" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 32, rowGap: 16, marginBottom: 20 }}>
          <Field full><div style={label}>Location</div><div style={value}>{snagTarget(data, s)}</div></Field>
          <Field><div style={label}>Stage</div><div style={value}>{refLabel(data, "stages", s.stageId)}</div></Field>
          <Field><div style={label}>Parameter</div><div style={s.paramId ? value : empty}>{s.paramId ? refLabel(data, "qparams", s.paramId) : "—"}</div></Field>
          <Field><div style={label}>Raised By</div><div style={value}>{refLabel(data, "users", s.raisedBy)}<div style={{ fontSize: 11.5, color: "var(--text-sub)", marginTop: 2 }}>{ago(s.raisedAt)}</div></div></Field>
          <Field><div style={label}>Assigned To</div><div style={value}>{refLabel(data, "users", s.assignedTo)}</div></Field>
          {s.closedAt && (
            <Field full><div style={label}>Closed</div><div style={value}>{fmtDT(s.closedAt)} by {refLabel(data, "users", s.closedBy)}</div></Field>
          )}
          {!!s.reopenCount && (
            <Field full><div style={label}>Reopened</div><div style={value}>{s.reopenCount}× · last {fmtDT(s.reopenedAt)} by {refLabel(data, "users", s.reopenedBy)}</div></Field>
          )}
        </div>

        {(s.photos || []).length > 0 && (
          <>
            <div style={label}>Photos</div>
            <div className="photo-strip" style={{ marginBottom: 20 }}>
              {(s.photos || []).map((p, i) => (
                <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
              ))}
            </div>
          </>
        )}

        <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0 20px" }} />

        <div style={label}>Reassign</div>
        <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
        </select>
      </div>
      <div className="drawer-footer">
        <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>📸 Add photo</button>
        <button className="btn btn-secondary btn-sm" onClick={() => saveSnagAssignee(s.id, assignee)}>Save assignee</button>
        {closed ? (
          <button className="btn btn-secondary btn-sm" onClick={() => setSnagStatus(s.id, "Open")}>Reopen</button>
        ) : (
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setSnagStatus(s.id, "In Progress")}>In progress</button>
            <button className="btn btn-success btn-sm" onClick={() => setSnagStatus(s.id, "Closed")}>Close snag</button>
          </>
        )}
      </div>
      <input
        type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) capturePhoto("snag", s.id, "", file);
        }}
      />
    </>
  );
}

function UserDrawer({ id }: { id: string }) {
  const { data, closeDrawer, openAssignModal } = useApp();
  const u = byId(coll(data, "users"), id);
  if (!u) return null;
  // Matches Team.tsx's row totals — aggregated across every active project,
  // not just whichever one happens to be globally selected.
  const projectIds = coll(data, "projects").filter((p) => p.active !== false).map((p) => p.id);
  const asg = coll(data, "assignments").filter((a) => a.assignedTo === id && projectIds.includes(a.projectId) && a.status !== "Done");
  const sng = coll(data, "snags").filter((s) => s.assignedTo === id && projectIds.includes(s.projectId) && s.status !== "Closed");

  return (
    <>
      <div className="drawer-header">
        <div style={{ minWidth: 0 }}>
          <div className="micro-label">{ROLES[u.role]?.name?.toUpperCase() || u.role}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{u.name}</div>
        </div>
        <button className="btn-icon" onClick={closeDrawer}>✕</button>
      </div>
      <div className="drawer-body">
        <div className="card card-pad" style={{ fontSize: 12, lineHeight: 1.9, marginBottom: 16 }}>
          <div><strong>Company</strong> · {u.company || "—"}</div>
          <div><strong>Phone</strong> · {u.phone || "—"}</div>
          <div><strong>Email</strong> · {u.email || "—"}</div>
        </div>
        <div className="micro-label">OPEN ASSIGNMENTS ({asg.length})</div>
        <div className="card" style={{ marginBottom: 16, minHeight: 96, display: "flex", flexDirection: "column", justifyContent: asg.length ? "flex-start" : "center" }}>
          {asg.length ? asg.map((a) => <AssignRow key={a.id} a={a} />) : <div className="empty">None.</div>}
        </div>
        <div className="micro-label">OPEN SNAGS ({sng.length})</div>
        <div className="card" style={{ minHeight: 96, display: "flex", flexDirection: "column", justifyContent: sng.length ? "flex-start" : "center" }}>
          {sng.length ? sng.map((s) => <SnagRow key={s.id} s={s} />) : <div className="empty">None.</div>}
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => openAssignModal({ targetType: "unit", targetId: "", stageId: "", presetUser: id })}>
          ＋ Assign work to {u.name.split(" ")[0]}
        </button>
      </div>
    </>
  );
}
