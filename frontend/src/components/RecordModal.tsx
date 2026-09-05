import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { MASTERS } from "../services/config";
import { byId, coll, refLabel } from "../shared/rules";
import { nextId } from "../shared/helpers";
import Modal from "./Modal";
import type { ChecklistItem, MasterField } from "../types";

export default function RecordModal() {
  const { recordModal, closeRecordModal, data, currentProjectId, currentUserId, apply, toast } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  // User Master is Admin-only — don't trust whatever `master` key this was
  // opened with; the backend also rejects it, but fail closed here too
  // instead of relying solely on every future caller staying careful.
  const blocked = recordModal?.master === "users" && !isAdmin;
  const master = recordModal && !blocked ? MASTERS[recordModal.master] : null;
  const rec = recordModal?.id && !blocked ? byId(coll(data, recordModal.master), recordModal.id) : null;

  const [values, setValues] = useState<Record<string, any>>({});
  const [items, setItems] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!recordModal || !master) return;
    const base: Record<string, any> = {};
    for (const f of master.fields) {
      if (f.type === "items") continue;
      base[f.k] = rec ? (rec as any)[f.k] : (f.type === "bool" ? (f.default ?? true) : "");
    }
    setValues(base);
    setItems((rec as any)?.items || []);
  }, [recordModal?.master, recordModal?.id]);

  if (!recordModal) return null;

  if (blocked) {
    return (
      <Modal open sub="ACCESS DENIED" title="User Master" onClose={closeRecordModal} footer={
        <button className="btn btn-secondary" onClick={closeRecordModal}>Close</button>
      }>
        <div className="empty">Only Admin can manage the User Master.</div>
      </Modal>
    );
  }

  if (!master) return null;

  const setV = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));

  function renderField(f: MasterField) {
    const v = values[f.k];
    const full = f.type === "items" || f.type === "textarea" || f.k === "name";

    let inner: React.ReactNode;
    if (f.type === "select") {
      inner = (
        <select className="select" value={v ?? ""} onChange={(e) => setV(f.k, e.target.value)}>
          {!f.required && <option value="">—</option>}
          {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    } else if (f.type === "ref") {
      let opts = coll(data, f.coll!).filter((r: any) => r.active !== false);
      if (f.coll === "floors" || f.coll === "units") opts = opts.filter((r: any) => r.projectId === currentProjectId);
      inner = (
        <select className="select" value={v ?? ""} onChange={(e) => setV(f.k, e.target.value)}>
          <option value="">—</option>
          {opts.map((o: any) => <option key={o.id} value={o.id}>{refLabel(data, f.coll!, o.id)}</option>)}
        </select>
      );
    } else if (f.type === "bool") {
      return (
        <div className="field" key={f.k}>
          <div className="check-row">
            <input type="checkbox" id={"fld-" + f.k} checked={v !== false} onChange={(e) => setV(f.k, e.target.checked)} />
            <label htmlFor={"fld-" + f.k}>{f.label}</label>
          </div>
        </div>
      );
    } else if (f.type === "textarea") {
      inner = <textarea className="textarea" value={v ?? ""} onChange={(e) => setV(f.k, e.target.value)} />;
    } else if (f.type === "items") {
      return (
        <div className="field full" key={f.k}>
          <label>{f.label}</label>
          <ItemsEditor items={items} setItems={setItems} />
          <button
            className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
            onClick={() => setItems((its) => [...its, { id: "", paramId: coll(data, "qparams")[0]?.id || "", mandatory: true, evidence: false }])}
          >
            ＋ Add line
          </button>
        </div>
      );
    } else {
      const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "color" ? "color" : "text";
      inner = <input className="input" type={type} value={v ?? ""} onChange={(e) => setV(f.k, e.target.value)} />;
    }

    return (
      <div className={"field" + (full ? " full" : "")} key={f.k}>
        <label>{f.label}{f.required ? " *" : ""}</label>
        {inner}
        {f.hint && <div className="hint">{f.hint}</div>}
      </div>
    );
  }

  async function save() {
    const out: any = recordModal!.id ? Object.assign({}, rec) : { id: nextId(master!.prefix, coll(data, recordModal!.master)) };
    for (const f of master!.fields) {
      if (f.type === "items") { out.items = items; continue; }
      let v = values[f.k];
      if (f.type === "number") v = v === "" ? null : Number(v);
      if (f.required && (v === "" || v == null)) { toast(f.label + " is required"); return; }
      out[f.k] = v;
    }
    if (!out.code && out.id) out.code = out.id;
    if (master!.fields.some((f) => f.k === "projectId") && !out.projectId) out.projectId = currentProjectId;

    // A second active Work Target for the same project+category would
    // silently double the "planned" total the DPR report rolls up (it sums
    // every matching target) without any visible sign why — block it here
    // rather than let two rows quietly disagree with what DprForm's own
    // single-target lookup shows.
    if (recordModal!.master === "workTargets") {
      const dup = coll(data, "workTargets").some(
        (t: any) => t.id !== out.id && t.active !== false && t.projectId === out.projectId && t.category === out.category
      );
      if (dup) { toast("A Work Target for this project + category already exists"); return; }
    }

    await apply([{ op: "upsert", coll: recordModal!.master, rec: out }]);
    closeRecordModal();
    toast((recordModal!.id ? "Updated " : "Created ") + (out.name || out.code || out.id));
  }

  return (
    <Modal
      open
      wide={master.fields.some((f) => f.type === "items")}
      sub={(recordModal.id ? "EDIT " : "NEW ") + master.label.toUpperCase() + " RECORD"}
      title={recordModal.id ? ((rec as any)?.name || (rec as any)?.code || recordModal.id) : "New " + master.label}
      onClose={closeRecordModal}
      footer={
        <>
          <button className="btn btn-secondary" onClick={closeRecordModal}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{recordModal.id ? "Save changes" : "Create " + master.label}</button>
        </>
      }
    >
      <div className="form-grid">{master.fields.map(renderField)}</div>
    </Modal>
  );
}

function ItemsEditor({ items, setItems }: { items: ChecklistItem[]; setItems: React.Dispatch<React.SetStateAction<ChecklistItem[]>> }) {
  const { data } = useApp();
  const params = coll(data, "qparams").filter((p) => p.active !== false);
  if (!items.length) return <div className="empty" style={{ padding: 14 }}>No lines yet.</div>;
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="check-row" style={{ gap: 8, alignItems: "flex-start", borderBottom: "1px solid var(--border)", padding: "9px 0" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-sub)", width: 20, paddingTop: 9 }}>{i + 1}</span>
          <select
            className="select" style={{ flex: 1 }} value={it.paramId}
            onChange={(e) => setItems((its) => its.map((x, xi) => xi === i ? { ...x, paramId: e.target.value } : x))}
          >
            {params.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, whiteSpace: "nowrap", paddingTop: 9 }}>
            <input
              type="checkbox" checked={it.mandatory !== false}
              onChange={(e) => setItems((its) => its.map((x, xi) => xi === i ? { ...x, mandatory: e.target.checked } : x))}
            /> Mandatory
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, whiteSpace: "nowrap", paddingTop: 9 }}>
            <input
              type="checkbox" checked={!!it.evidence}
              onChange={(e) => setItems((its) => its.map((x, xi) => xi === i ? { ...x, evidence: e.target.checked } : x))}
            /> Photo
          </label>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={() => setItems((its) => its.filter((_, xi) => xi !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}
