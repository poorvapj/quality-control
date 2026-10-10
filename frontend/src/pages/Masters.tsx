import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { MASTERS } from "../services/config";
import { coll, byId, refLabel } from "../shared/rules";
import { exportSnagCsv } from "../shared/exportSnagCsv";
import { downloadCsv } from "../shared/csv";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant, effectiveRoleGrants } from "../shared/permissionMatrix";
import { ROLES } from "../services/config";
import NavIcon from "../components/NavIcon";
import WorkTargetBulkImport from "../components/WorkTargetBulkImport";
import type { MasterKey } from "../types";
import { BUILT_IN_ROLES } from "../types";

export default function Masters() {
  const {
    data, currentProjectId, currentUserId, myRole, activeMaster: rawActiveMaster, setActiveMaster,
    openRecordModal, apply, toast, setActiveTab
  } = useApp();
  const [q, setQ] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const isAdmin = currentUserId === "U-ADMIN";
  const editable = myRole() === "ADMIN" || myRole() === "DRI" || hasModuleGrant(data, currentUserId, "masters", "edit");
  // User Master exposes every account's contact/role data — Admin only.
  // Every other master stays fully open to any signed-in user.
  const activeMaster: MasterKey = (rawActiveMaster === "users" && !isAdmin) ? "projects" : rawActiveMaster;
  const master = MASTERS[activeMaster];

  let rows: any[] = coll(data, activeMaster).slice();
  if (master.fields.some((f) => f.k === "projectId")) {
    rows = rows.filter((r: any) => !r.projectId || r.projectId === currentProjectId);
  }
  if (activeMaster === "roles") {
    // Built-in role default-permission overrides (saved from Permission
    // Matrix ▸ Role-wise) are stored in this same "roles" collection but
    // aren't real custom roles — don't list the raw override record;
    // instead show one synthetic row per built-in role so DRI/CRM/Civil
    // Engineer/Admin/Supervisor are visible here too, editing the same
    // override record underneath (created on first save if none exists
    // yet).
    const overrides = rows;
    const builtinRows = BUILT_IN_ROLES.map((r) => {
      const existing = overrides.find((o: any) => o.name === r);
      return existing || { id: "ROLE-OVERRIDE-" + r, name: r, active: true, builtin: true };
    });
    rows = [...builtinRows, ...overrides.filter((o: any) => !o.builtin)];
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
    if (activeMaster === "roles" && rec.builtin && key === "name") return (ROLES as any)[v]?.name || v;
    if (activeMaster === "roles" && key === "active" && rec.builtin) return <span className="badge-tag wip">Built-in</span>;
    if (v == null || v === "") return <span style={{ color: "var(--text-sub)" }}>—</span>;
    return String(v);
  }

  async function deleteRecord(id: string) {
    const rec = byId(coll(data, activeMaster), id) as any;
    if (!rec) return;
    // Work Targets have neither a real `name` nor a meaningful `code` — the
    // project + category combination is what actually identifies one, so
    // the confirm dialog should show that instead of falling through to the
    // bare id (which tells the person deleting nothing about which target
    // it actually is).
    const identity = activeMaster === "workTargets"
      ? `${refLabel(data, "projects", rec.projectId)} · ${rec.category}`
      : (rec.name || rec.code || id);
    if (!confirm(`Delete ${master.label.toLowerCase()} "${identity}"?\n\nThis removes it for everyone on the board.`)) return;
    await apply([
      { op: "delete", coll: activeMaster, id },
      buildEventOp(currentUserId, "MASTER_DELETE", id, "", `${master.label} · deleted · ${identity}`)
    ]);
    toast("Deleted " + id);
  }

  // Opening Edit on a built-in role that has never been overridden yet
  // (synthetic row, no real "roles" record) — write through a real record
  // first, pre-filled with its actual current defaults, so RecordModal has
  // something genuine to load instead of blank fields.
  async function openRoleEdit(r: any) {
    if (r.builtin && !coll(data, "roles").some((x) => x.id === r.id)) {
      const roleCode = r.id.replace("ROLE-OVERRIDE-", "");
      await apply([{ op: "upsert", coll: "roles", rec: { id: r.id, name: roleCode, active: true, builtin: true, grants: effectiveRoleGrants(data, roleCode) } }]);
    }
    openRecordModal({ master: activeMaster, id: r.id });
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
          {editable && activeMaster === "workTargets" && (
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkImportOpen(true)}>📋 Bulk Import</button>
          )}
          {editable && (
            <button
              className="btn btn-primary btn-sm"
              // The Users master gets its own dedicated Add New User page
              // (password + inline Permission Matrix) instead of the
              // generic RecordModal — every other master is unaffected.
              onClick={() => (activeMaster === "users" ? setActiveTab("addUser") : openRecordModal({ master: activeMaster, id: null }))}
            >
              ＋ New
            </button>
          )}
        </div>

        {bulkImportOpen && <WorkTargetBulkImport onClose={() => setBulkImportOpen(false)} />}
        <div className="table-scroll" style={{ maxHeight: 560, overflowY: "auto" }}>
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
                          <button className="btn btn-secondary btn-sm" title="Edit" onClick={() => (activeMaster === "roles" ? openRoleEdit(r) : openRecordModal({ master: activeMaster, id: r.id }))}><NavIcon name="edit" size={13} /></button>
                          {!(activeMaster === "roles" && r.builtin) && (
                            <button className="btn btn-secondary btn-sm" title="Delete" onClick={() => deleteRecord(r.id)}><NavIcon name="trash" size={13} /></button>
                          )}
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
