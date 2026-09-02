import React, { useRef } from "react";
import { useApp } from "../context/AppContext";
import { ROLES } from "../services/config";
import { byId, coll, canAct, blockReason, openSnagsFor, prog, refLabel, trackStages, snagTarget } from "../shared/rules";
import { fmtDT, ago, dueLabel } from "../shared/helpers";
import { useActions } from "../hooks/useActions";
import AssignRow from "./AssignRow";
import SnagRow from "./SnagRow";

export default function Drawer() {
  const { drawer, closeDrawer, data, currentProjectId, myRole } = useApp();
  if (!drawer) return null;
  return (
    <>
      <div className="overlay open" onClick={closeDrawer}></div>
      <div className="drawer-sheet open">
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

  const track = kind;
  const list = trackStages(data, currentProjectId, track);
  const rec = byId(coll(data, kind === "unit" ? "units" : "floors"), id);
  if (!rec) return null;

  const snags = kind === "unit" ? openSnagsFor(data, id) : [];

  return (
    <>
      <div className="drawer-header">
        <div style={{ minWidth: 0 }}>
          <div className="micro-label">{kind === "unit" ? `${refLabel(data, "floors", (rec as any).floorId)} · ${(rec as any).type || "Unit"}` : "RCC STRUCTURE TRACK"}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{rec.name}</div>
        </div>
        <button className="btn-icon" onClick={closeDrawer}>✕</button>
      </div>
      <div className="drawer-body">
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
                      {s.isHidden && !p.meas && (myRole() === "MEAS" || myRole() === "DRI") && (
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
      </div>
      <input
        type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const pending = pendingPhoto.current;
          e.target.value = "";
          if (file && pending) capturePhoto(pending.kind, pending.id, pending.stageId, file);
        }}
      />
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

  return (
    <>
      <div className="drawer-header">
        <div style={{ minWidth: 0 }}>
          <div className="micro-label">SNAG {s.id}</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{s.title}</div>
        </div>
        <button className="btn-icon" onClick={closeDrawer}>✕</button>
      </div>
      <div className="drawer-body">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <span className={"badge-tag " + (s.severity === "Critical" ? "crit" : s.severity === "Major" ? "gate" : "mute")}>{s.severity}</span>
          <span className={"badge-tag " + (closed ? "pass" : s.status === "In Progress" ? "wip" : "fail")}>{s.status}</span>
          {!closed && <span className={"badge-tag " + d.cls}>{d.text}</span>}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{s.description || "No description."}</div>
        <div className="card card-pad" style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div><strong>Location</strong> · {snagTarget(data, s)}</div>
          <div><strong>Stage</strong> · {refLabel(data, "stages", s.stageId)}</div>
          {s.paramId && <div><strong>Parameter</strong> · {refLabel(data, "qparams", s.paramId)}</div>}
          <div><strong>Raised by</strong> · {refLabel(data, "users", s.raisedBy)} {ago(s.raisedAt)}</div>
          <div><strong>Assigned to</strong> · {refLabel(data, "users", s.assignedTo)}</div>
          {s.closedAt && <div><strong>Closed</strong> · {fmtDT(s.closedAt)} by {refLabel(data, "users", s.closedBy)}</div>}
        </div>
        {(s.photos || []).length > 0 && (
          <div className="photo-strip">
            {(s.photos || []).map((p, i) => (
              <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
            ))}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <div className="micro-label">REASSIGN</div>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
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
  const { data, currentProjectId, closeDrawer, openAssignModal } = useApp();
  const u = byId(coll(data, "users"), id);
  if (!u) return null;
  const asg = coll(data, "assignments").filter((a) => a.assignedTo === id && a.projectId === currentProjectId && a.status !== "Done");
  const sng = coll(data, "snags").filter((s) => s.assignedTo === id && s.projectId === currentProjectId && s.status !== "Closed");

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
        <div className="card" style={{ marginBottom: 16 }}>
          {asg.length ? asg.map((a) => <AssignRow key={a.id} a={a} />) : <div className="empty">None.</div>}
        </div>
        <div className="micro-label">OPEN SNAGS ({sng.length})</div>
        <div className="card">
          {sng.length ? sng.map((s) => <SnagRow key={s.id} s={s} />) : <div className="empty">None.</div>}
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => openAssignModal({ targetType: "unit", targetId: "", stageId: "", presetUser: id })}>
          ＋ Assign work to {u.name.split(" ")[0]}
        </button>
      </div>
    </>
  );
}
