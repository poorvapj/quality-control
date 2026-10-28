import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { MASTERS, ROLES } from "../services/config";
import { byId, coll, refLabel } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import Modal from "./Modal";
import SearchDropdown from "./SearchDropdown";
import type { ChecklistItem, CustomFormField, CustomFormFieldType, MasterField, ModuleAction } from "../types";
import PermissionGrid from "./PermissionGrid";

const FORM_FIELD_TYPES: { value: CustomFormFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown (pick one)" },
  { value: "multiselect", label: "Checklist (pick multiple)" },
  { value: "bool", label: "Yes/No" }
];

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
  const [formFields, setFormFields] = useState<CustomFormField[]>([]);
  const [saving, setSaving] = useState(false);
  // Creating a brand-new Unit can target several floors at once (same unit
  // code/name repeated per floor — e.g. "1014" exists on every floor of a
  // tower) instead of one "New Unit" round-trip per floor. Only for new
  // records: editing an existing unit still moves it to exactly one floor,
  // via the normal single-select "ref" field.
  const [multiFloorIds, setMultiFloorIds] = useState<string[]>([]);
  const isNewUnit = recordModal?.master === "units" && !recordModal?.id;

  useEffect(() => {
    if (!recordModal || !master) return;
    const base: Record<string, any> = {};
    for (const f of master.fields) {
      if (f.type === "items" || f.type === "formFields") continue;
      if (f.type === "permissionGrid") { base[f.k] = (rec as any)?.[f.k] || {}; continue; }
      base[f.k] = rec ? (rec as any)[f.k] : (f.type === "bool" ? (f.default ?? true) : "");
    }
    setValues(base);
    setItems((rec as any)?.items || []);
    setFormFields((rec as any)?.fields || []);
    setMultiFloorIds([]);
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

  const isBuiltinRole = recordModal!.master === "roles" && !!(rec as any)?.builtin;

  function renderField(f: MasterField) {
    const v = values[f.k];
    const full = f.type === "items" || f.type === "textarea" || f.k === "name";

    // Built-in roles (DRI/CRM/CIVIL/ADMIN/SUPERVISOR) can't be renamed or
    // deactivated here — this record only exists to hold a Permission
    // Matrix ▸ Role-wise override on top of their hardcoded baseline.
    if (isBuiltinRole && f.k === "name") {
      return (
        <div className="field full" key={f.k}>
          <label>{f.label}</label>
          <input className="input" value={(ROLES as any)[v]?.name || v} disabled />
          <div className="hint">Built-in role — name is fixed.</div>
        </div>
      );
    }
    if (isBuiltinRole && f.k === "active") return null;

    let inner: React.ReactNode;
    if (f.type === "select") {
      // The Users master's "role" field is the one select whose real
      // option list isn't static — merge in any custom role from
      // Masters ▸ Role Master alongside the 5 built-in ones.
      const options = recordModal!.master === "users" && f.k === "role"
        ? [...(f.options || []), ...coll(data, "roles").filter((r: any) => r.active !== false && !r.builtin).map((r: any) => r.name)]
        : (f.options || []);
      inner = (
        <SearchDropdown
          value={v ?? ""}
          onChange={(val) => setV(f.k, val)}
          options={[...(!f.required ? [{ value: "", label: "Choose…" }] : []), ...options.map((o) => ({ value: o, label: o }))]}
        />
      );
    } else if (isNewUnit && f.k === "floorId") {
      const floors = coll(data, "floors").filter((fl: any) => fl.active !== false && fl.projectId === values.projectId);
      const toggle = (id: string) => setMultiFloorIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
      return (
        <div className="field full" key={f.k}>
          <label>{f.label} * <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— pick one or more; the same unit code/name is created on each floor picked</span></label>
          {!values.projectId ? (
            <div className="hint">Pick a project first</div>
          ) : floors.length === 0 ? (
            <div className="hint">This project has no floors yet</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
              {floors.map((fl: any) => (
                <label key={fl.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={multiFloorIds.includes(fl.id)} onChange={() => toggle(fl.id)} />
                  {fl.name}
                </label>
              ))}
            </div>
          )}
        </div>
      );
    } else if (f.type === "ref") {
      // A person picker (Team Leader, Permission user…) lists EVERYONE, sorted by
      // name, with their role beside the name — so "Rishi" and "Rishabh" can't be
      // mixed up — and inactive people are shown greyed out and labelled rather
      // than silently missing (an inactive account can't be picked, but you can
      // now see that it is the reason).
      const isUsers = f.coll === "users";
      let opts = coll(data, f.coll!).filter((r: any) => isUsers || r.active !== false);
      if (f.coll === "floors" || f.coll === "units") opts = opts.filter((r: any) => r.projectId === currentProjectId);
      if (isUsers) opts = [...opts].sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));
      inner = (
        <SearchDropdown
          value={v ?? ""}
          onChange={(val) => { setV(f.k, val); if (isNewUnit && f.k === "projectId") setMultiFloorIds([]); }}
          options={[
            { value: "", label: "Choose…" },
            ...opts.map((o: any) => {
              const inactive = isUsers && o.active === false;
              const label = isUsers
                ? `${refLabel(data, f.coll!, o.id)} · ${(ROLES as any)[o.role]?.name || o.role || "no role"}${inactive ? " (inactive)" : ""}`
                : refLabel(data, f.coll!, o.id);
              return { value: o.id, label };
            })
          ]}
        />
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
    } else if (f.type === "permissionGrid") {
      const grants = v || {};
      const toggle = (moduleKey: string, action: ModuleAction, val: boolean) =>
        setV(f.k, { ...grants, [moduleKey]: { ...grants[moduleKey], [action]: val } });
      return (
        <div className="field full" key={f.k}>
          <label>{f.label}</label>
          <div style={{ marginTop: 8 }}>
            <PermissionGrid grants={grants} onToggle={toggle} />
          </div>
        </div>
      );
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
    } else if (f.type === "formFields") {
      return (
        <div className="field full" key={f.k}>
          <label>{f.label}</label>
          <FormFieldsEditor fields={formFields} setFields={setFormFields} />
          <button
            className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
            onClick={() => setFormFields((fs) => [...fs, { key: "field_" + (fs.length + 1), label: "", type: "text", required: false }])}
          >
            ＋ Add field
          </button>
        </div>
      );
    } else {
      const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "color" ? "color" : f.type === "password" ? "password" : "text";
      inner = <input className="input" type={type} autoComplete={f.type === "password" ? "new-password" : undefined} value={v ?? ""} onChange={(e) => setV(f.k, e.target.value)} />;
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
    // The modal stays open for a moment while apply() round-trips — without
    // this guard, a second click in that window re-ran nextId() against the
    // same (not-yet-updated) `data`, handing out the SAME id twice and
    // creating a duplicate/overwriting record. Button is disabled below too,
    // but the guard is here as well in case save() is ever reached another way.
    if (saving) return;
    setSaving(true);
    try {
      if (isNewUnit) {
        if (multiFloorIds.length === 0) { toast("Pick at least one floor"); return; }
        // Was nextId("UNT", existingUnits) — but this collection's regular
        // flats/units carry bulk-import ids like "UNT-PRJ-001-0101", which
        // that scan's "^UNT-(\d+)$" never matches, so it always counted
        // from 0 among this screen's own small plain-numbered pool
        // regardless of how many real units already exist. Two admins
        // adding a unit around the same time (neither had re-synced to see
        // the other's save) could both land on "UNT-0001" and silently
        // overwrite one another — same bug class as the DPR/Drawing
        // Request fixes. A timestamp+random id per floor can't collide.
        const batchStamp = Date.now().toString(36).toUpperCase();
        let seq = 0;
        const ops: any[] = [];
        for (const floorId of multiFloorIds) {
          const out: any = { id: "UNT-" + batchStamp + "-" + String(++seq).padStart(2, "0") + "-" + Math.random().toString(36).slice(2, 5).toUpperCase() };
          for (const f of master!.fields) {
            if (f.k === "floorId") { out.floorId = floorId; continue; }
            let v = values[f.k];
            if (f.type === "number") v = v === "" ? null : Number(v);
            if (f.required && (v === "" || v == null)) { toast(f.label + " is required"); return; }
            out[f.k] = v;
          }
          if (!out.code) out.code = out.id;
          ops.push({ op: "upsert", coll: "units", rec: out });
          ops.push(buildEventOp(currentUserId, "MASTER_SAVE", out.id, "", `${master!.label} · created · ${out.name || out.code}`));
        }
        const synced = await apply(ops);
        closeRecordModal();
        toast(synced ? `Created ${multiFloorIds.length} unit${multiFloorIds.length === 1 ? "" : "s"}` : "Saved on this device — will finish submitting once you're back online");
        return;
      }

      const out: any = recordModal!.id ? Object.assign({}, rec) : { id: nextId(master!.prefix, coll(data, recordModal!.master)) };
      for (const f of master!.fields) {
        if (f.type === "items") { out.items = items; continue; }
        if (f.type === "formFields") { out.fields = formFields; continue; }
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

      const synced = await apply([
        { op: "upsert", coll: recordModal!.master, rec: out },
        buildEventOp(currentUserId, "MASTER_SAVE", out.id, "", `${master!.label} · ${recordModal!.id ? "updated" : "created"} · ${out.name || out.code || out.id}`)
      ]);
      closeRecordModal();
      toast(synced ? (recordModal!.id ? "Updated " : "Created ") + (out.name || out.code || out.id) : "Saved on this device — will finish submitting once you're back online");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      wide={master.fields.some((f) => f.type === "items" || f.type === "permissionGrid" || f.type === "formFields")}
      sub={(recordModal.id ? "EDIT " : "NEW ") + master.label.toUpperCase() + " RECORD"}
      title={recordModal.id ? (isBuiltinRole ? ((ROLES as any)[(rec as any)?.name]?.name || (rec as any)?.name) : (rec as any)?.name || (rec as any)?.code || recordModal.id) : "New " + master.label}
      onClose={closeRecordModal}
      footer={
        <>
          <button className="btn btn-secondary" onClick={closeRecordModal} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : recordModal.id ? "Save changes" : isNewUnit && multiFloorIds.length > 1 ? `Create ${multiFloorIds.length} Units` : "Create " + master.label}
          </button>
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
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", width: 20, paddingTop: 9 }}>{i + 1}</span>
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

function FormFieldsEditor({ fields, setFields }: { fields: CustomFormField[]; setFields: React.Dispatch<React.SetStateAction<CustomFormField[]>> }) {
  function update(i: number, patch: Partial<CustomFormField>) {
    setFields((fs) => fs.map((f, fi) => fi === i ? { ...f, ...patch } : f));
  }
  if (!fields.length) return <div className="empty" style={{ padding: 14 }}>No fields yet — add at least one.</div>;
  return (
    <div>
      {fields.map((f, i) => (
        <div key={i} className="check-row" style={{ gap: 8, alignItems: "flex-start", borderBottom: "1px solid var(--border)", padding: "9px 0", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", width: 20, paddingTop: 9 }}>{i + 1}</span>
          <input
            className="input" style={{ flex: 2, minWidth: 140 }} placeholder="Field label (e.g. Vendor name)"
            value={f.label} onChange={(e) => update(i, { label: e.target.value })}
          />
          <select
            className="select" style={{ flex: 1, minWidth: 110 }} value={f.type}
            onChange={(e) => update(i, { type: e.target.value as CustomFormFieldType })}
          >
            {FORM_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {(f.type === "select" || f.type === "multiselect") && (
            <input
              className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Options, comma separated"
              value={(f.options || []).join(", ")}
              onChange={(e) => update(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
            />
          )}
          {f.type === "bool" && (
            <>
              <input
                className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Yes label"
                value={f.yesLabel ?? ""} onChange={(e) => update(i, { yesLabel: e.target.value })}
              />
              <input
                className="input" style={{ flex: 1, minWidth: 90 }} placeholder="No label"
                value={f.noLabel ?? ""} onChange={(e) => update(i, { noLabel: e.target.value })}
              />
            </>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, whiteSpace: "nowrap", paddingTop: 9 }}>
            <input type="checkbox" checked={!!f.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
          </label>
          {f.type === "multiselect" && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, whiteSpace: "nowrap", paddingTop: 9 }}>
              <input type="checkbox" checked={!!f.photoEvidence} onChange={(e) => update(i, { photoEvidence: e.target.checked })} /> Photo evidence per item
            </label>
          )}
          {f.type === "multiselect" && f.photoEvidence && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, whiteSpace: "nowrap", paddingTop: 9 }}>
              Min photos
              <input
                className="input" type="number" min={0} style={{ width: 48, padding: "2px 6px" }}
                value={f.minPhotos ?? 0}
                onChange={(e) => update(i, { minPhotos: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span style={{ color: "var(--text-sub)" }}>(0 = optional)</span>
            </label>
          )}
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={() => setFields((fs) => fs.filter((_, fi) => fi !== i))}>✕</button>
        </div>
      ))}
    </div>
  );
}
