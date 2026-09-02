import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { MASTERS } from "../services/config";
import { coll, byId, refLabel } from "../shared/rules";
import { exportSnagCsv } from "../shared/exportSnagCsv";
import { downloadCsv } from "../shared/csv";
import NavIcon from "../components/NavIcon";
import type { MasterKey } from "../types";

export default function Masters() {
  const {
    data, currentProjectId, currentUserId, myRole, activeMaster: rawActiveMaster, setActiveMaster,
    openRecordModal, apply, toast
  } = useApp();
  const [q, setQ] = useState("");
  const isAdmin = currentUserId === "U-ADMIN";
  const editable = myRole() === "DRI";
  // User Master exposes every account's contact/role data — Admin only.
  // Every other master stays fully open to any signed-in user.
  const activeMaster: MasterKey = (rawActiveMaster === "users" && !isAdmin) ? "projects" : rawActiveMaster;
  const master = MASTERS[activeMaster];

  let rows: any[] = coll(data, activeMaster).slice();
  if (master.fields.some((f) => f.k === "projectId")) {
    rows = rows.filter((r: any) => !r.projectId || r.projectId === currentProjectId);
  }
  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(ql));
  }

  function cellValue(rec: any, key: string): React.ReactNode {
    const field = master.fields.find((f) => f.k === key);
    const v = rec[key];
    if (key === "itemCount") return (rec.items || []).length + " lines";
    if (field?.type === "ref") return refLabel(data, field.coll!, v);
    if (field?.type === "bool") return v === false ? <span className="badge-tag mute">Inactive</span> : <span className="badge-tag pass">Active</span>;
    if (key === "isGate" || key === "isHidden") return v ? <span className="badge-tag gate">Yes</span> : <span className="badge-tag mute">No</span>;
    if (key === "severity") return <span className={"badge-tag " + (v === "Critical" ? "crit" : v === "Major" ? "gate" : "mute")}>{v}</span>;
    if (key === "track") return <span className={"badge-tag " + (v === "unit" ? "wip" : "mute")}>{v === "unit" ? "Unit" : "Floor"}</span>;
    if (key === "role") return <span className="badge-tag mute">{v}</span>;
    if (v == null || v === "") return <span style={{ color: "var(--text-sub)" }}>—</span>;
    return String(v);
  }

  async function deleteRecord(id: string) {
    const rec = byId(coll(data, activeMaster), id);
    if (!rec) return;
    if (!confirm(`Delete ${master.label.toLowerCase()} "${(rec as any).name || rec.code || id}"?\n\nThis removes it for everyone on the board.`)) return;
    await apply([{ op: "delete", coll: activeMaster, id }]);
    toast("Deleted " + id);
  }

  function exportMasterCsv() {
    const head = master.cols.map((c) => master.fields.find((x) => x.k === c)?.label || c);
    const body = rows.map((r) =>
      master.cols.map((c) => {
        const f = master.fields.find((x) => x.k === c);
        if (c === "itemCount") return (r.items || []).length;
        if (f?.type === "ref") return refLabel(data, f.coll!, r[c]);
        return r[c];
      })
    );
    downloadCsv(activeMaster + "-master.csv", [head, ...body]);
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="masters" size={20} /></div>
          <div>
            <div className="page-title">Master Data</div>
            <div className="page-desc">{master.desc}</div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="sub-nav">
          {(Object.entries(MASTERS) as [MasterKey, typeof master][])
            .filter(([k]) => k !== "users" || isAdmin)
            .map(([k, m]) => (
              <button key={k} className={"sub-btn" + (k === activeMaster ? " active" : "")} onClick={() => { setActiveMaster(k); setQ(""); }}>
                {m.icon} {m.label} Master
              </button>
            ))}
        </div>
        <div className="toolbar">
          <input className="input grow" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-secondary btn-sm" onClick={exportMasterCsv}>⬇ Export CSV</button>
          {editable && <button className="btn btn-primary btn-sm" onClick={() => openRecordModal({ master: activeMaster, id: null })}>＋ New</button>}
        </div>
        <div className="table-scroll">
          {rows.length === 0 ? (
            <div className="empty">No {master.label.toLowerCase()} records yet.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {master.cols.map((c) => <th key={c}>{master.fields.find((f) => f.k === c)?.label || c}</th>)}
                  {editable && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    {master.cols.map((c) => <td key={c}>{cellValue(r, c)}</td>)}
                    {editable && (
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-secondary btn-sm" title="Edit" onClick={() => openRecordModal({ master: activeMaster, id: r.id })}><NavIcon name="edit" size={13} /></button>
                          <button className="btn btn-secondary btn-sm" title="Delete" onClick={() => deleteRecord(r.id)}><NavIcon name="trash" size={13} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editable && (
        <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => exportSnagCsv(data, currentProjectId)}>⬇ Snag register CSV</button>
        </div>
      )}
    </div>
  );
}
