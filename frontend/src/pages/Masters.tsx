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
import CustomFormFill from "../components/CustomFormFill";
import SidePanel from "../components/SidePanel";
import type { MasterKey } from "../types";
import { BUILT_IN_ROLES } from "../types";

export default function Masters() {
  const {
    data, currentProjectId, currentUserId, myRole, activeMaster: rawActiveMaster, setActiveMaster,
    openRecordModal, apply, toast, setActiveTab
  } = useApp();
  const [q, setQ] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [fillFormId, setFillFormId] = useState<string | null>(null);
  const [viewSubmissionsFormId, setViewSubmissionsFormId] = useState<string | null>(null);
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
    if (activeMaster === "forms" && key === "isPublic") {
      if (!v) return <span className="badge-tag mute">Internal only</span>;
      const link = window.location.origin + "/forms/" + rec.id;
      return (
        <span
          className="badge-tag wip" style={{ cursor: "pointer" }} title="Click to copy"
          onClick={() => { navigator.clipboard.writeText(link); toast("Copied: " + link); }}
        >
          🔗 {link}
        </span>
      );
    }
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
                          {activeMaster === "forms" && (
                            <>
                              <button className="btn btn-secondary btn-sm" title="Fill form" onClick={() => setFillFormId(r.id)}>Fill</button>
                              <button className="btn btn-secondary btn-sm" title="View submissions" onClick={() => setViewSubmissionsFormId(r.id)}>
                                {coll(data, "formSubmissions").filter((s: any) => s.formId === r.id).length} 📥
                              </button>
                              {r.isPublic && (
                                <button
                                  className="btn btn-secondary btn-sm" title="Copy public link"
                                  onClick={() => {
                                    const link = window.location.origin + "/forms/" + r.id;
                                    navigator.clipboard.writeText(link);
                                    toast("Copied: " + link);
                                  }}
                                >
                                  🔗 Public link
                                </button>
                              )}
                            </>
                          )}
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

      {(() => {
        const fillForm = fillFormId ? byId(coll(data, "forms"), fillFormId) : null;
        return (
          <SidePanel
            open={!!fillForm}
            wide
            icon={<NavIcon name="masters" size={18} />}
            title={fillForm?.name || "Fill form"}
            desc="Submitting this from inside the app, same as the public link."
            onClose={() => setFillFormId(null)}
          >
            {fillForm && <CustomFormFill form={fillForm} onDone={() => { setFillFormId(null); toast("Submitted"); }} />}
          </SidePanel>
        );
      })()}

      {(() => {
        const subsForm = viewSubmissionsFormId ? byId(coll(data, "forms"), viewSubmissionsFormId) : null;
        const subs = subsForm ? coll(data, "formSubmissions").filter((s: any) => s.formId === subsForm.id).sort((a: any, b: any) => b.submittedAt - a.submittedAt) : [];
        return (
          <SidePanel
            open={!!subsForm}
            wide
            icon={<NavIcon name="masters" size={18} />}
            title={(subsForm?.name || "Submissions") + " — Submissions"}
            desc={subs.length + " response" + (subs.length === 1 ? "" : "s")}
            onClose={() => setViewSubmissionsFormId(null)}
          >
            {subsForm && (
              subs.length === 0 ? <div className="empty">No submissions yet.</div> : (
                <div className="table-scroll" style={{ maxHeight: 560, overflowY: "auto" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        {subsForm.fields.map((f: any) => <th key={f.key}>{f.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {subs.map((s: any) => (
                        <tr key={s.id}>
                          <td>{new Date(s.submittedAt).toLocaleString("en-IN")}{s.isPublic ? " (public)" : ""}</td>
                          {subsForm.fields.map((f: any) => (
                            <td key={f.key}>
                              {(() => {
                                const val = s.values?.[f.key];
                                if (val === true) return f.yesLabel || "Yes";
                                if (val === false) return f.noLabel || "No";
                                if (Array.isArray(val)) {
                                  if (!val.length) return "—";
                                  const photosByOption = f.photoEvidence ? (s.values?.[f.key + "__photos"] || {}) : null;
                                  const photoCount = photosByOption
                                    ? Object.values(photosByOption).reduce((a: number, p: any) => a + (p?.work?.length || 0) + (p?.before?.length || 0) + (p?.after?.length || 0), 0)
                                    : 0;
                                  return val.join(", ") + (photoCount > 0 ? ` (${photoCount} photo${photoCount === 1 ? "" : "s"})` : "");
                                }
                                return val ?? "—";
                              })()}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </SidePanel>
        );
      })()}
    </div>
  );
}
