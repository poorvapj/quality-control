import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { nextId } from "../shared/helpers";
import type { DailyProgressReport, DprWorkEntry, ShiftType, Photo } from "../types";
import PhotoGroupUploader from "./PhotoGroupUploader";

/* Real site work-type checklist — matches the reference layout's 16-item,
   4-column grid rather than the smaller Quality Parameter category set. */
const WORK_CATEGORIES = [
  "Civil", "RCC", "Electrical", "Painter",
  "Plumbing", "Wooden", "Floor Grinding", "Core Cutting",
  "Fire", "Waterproofing", "Carpenter", "Fabrication",
  "UPVC", "Material Lifting", "Excavation", "Plantation"
];

function slugCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "VENDOR";
}

export default function DprForm({ isPublic, onDone }: { isPublic: boolean; onDone: (id: string) => void }) {
  const { data, apply, toast, currentUserId, currentProjectId, me } = useApp();
  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const users = coll(data, "users").filter((u) => u.active !== false);

  const [projectId, setProjectId] = useState(currentProjectId || projects[0]?.id || "");
  const [submittedByName, setSubmittedByName] = useState(isPublic ? "" : me()?.name || "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendorName, setVendorName] = useState("");
  const [shift, setShift] = useState<ShiftType | "">("");
  const [labourCount, setLabourCount] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [entries, setEntries] = useState<Record<string, DprWorkEntry>>({});
  const [saving, setSaving] = useState(false);

  function toggleCategory(cat: string) {
    setChecked((c) => ({ ...c, [cat]: !c[cat] }));
    setEntries((e) => {
      if (e[cat]) return e;
      return { ...e, [cat]: { category: cat, generalPhotos: [], beforePhotos: [], afterPhotos: [] } };
    });
  }

  function setEntryPhotos(cat: string, group: "generalPhotos" | "beforePhotos" | "afterPhotos", photos: Photo[]) {
    setEntries((e) => ({ ...e, [cat]: { ...e[cat], [group]: photos } }));
  }

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!vendorName.trim()) { toast("Contractor name is required"); return; }
    if (!submittedByName.trim()) { toast("DRI name is required"); return; }
    if (!shift) { toast("Pick a shift type"); return; }
    const labour = Number(labourCount);
    if (!Number.isFinite(labour) || labour < 0) { toast("Number of labourers must be a non-negative number"); return; }

    const workEntries = Object.keys(checked).filter((c) => checked[c]).map((c) => entries[c]);
    setSaving(true);
    const rec: DailyProgressReport = {
      id: nextId("DPR", coll(data, "dpr")),
      projectId,
      projectName: coll(data, "projects").find((p) => p.id === projectId)?.name || "",
      submittedByUserId: isPublic ? null : currentUserId,
      submittedByName: submittedByName.trim(),
      date,
      vendorCode: slugCode(vendorName),
      vendorName: vendorName.trim(),
      shift,
      labourCount: labour,
      workEntries,
      isPublic
    };
    await apply([{ op: "upsert", coll: "dpr", rec }]);
    setSaving(false);
    toast("Daily progress report submitted");
    onDone(rec.id);
  }

  return (
    <div>
      <div className="micro-label" style={{ marginBottom: 4 }}>REPORT DETAILS</div>
      <div className="form-grid" style={{ marginBottom: 20 }}>
        <div className="field">
          <label>Project *</label>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Contractor name *</label>
          <input className="input" list="dpr-contractors" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Choose or type" />
          <datalist id="dpr-contractors">
            {Array.from(new Set(coll(data, "dpr").map((r) => r.vendorName).filter(Boolean))).map((v) => <option key={v} value={v} />)}
          </datalist>
        </div>
        <div className="field">
          <label>DRI name *</label>
          {isPublic ? (
            <input className="input" value={submittedByName} onChange={(e) => setSubmittedByName(e.target.value)} placeholder="Your name" />
          ) : (
            <select className="select" value={submittedByName} onChange={(e) => setSubmittedByName(e.target.value)}>
              <option value="">Choose</option>
              {users.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          )}
          <div className="hint">Always required, independent of the logged-in account — so public submissions work too.</div>
        </div>
        <div className="field">
          <label>Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Shift type *</label>
          <select className="select" value={shift} onChange={(e) => setShift(e.target.value as ShiftType)}>
            <option value="">Choose</option>
            <option value="Day">Day</option>
            <option value="Night">Night</option>
          </select>
        </div>
        <div className="field">
          <label>Number of labourers *</label>
          <input className="input" type="number" min={0} placeholder="e.g. 12" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} />
        </div>
      </div>

      <div className="micro-label" style={{ marginBottom: 4 }}>WORK TYPE — CHECK WHAT HAPPENED TODAY</div>
      <div className="card card-pad">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {WORK_CATEGORIES.map((cat) => (
            <div key={cat} className="check-row" style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
              <input type="checkbox" id={"cat-" + cat} checked={!!checked[cat]} onChange={() => toggleCategory(cat)} />
              <label htmlFor={"cat-" + cat}>{cat}</label>
            </div>
          ))}
        </div>

        {WORK_CATEGORIES.filter((c) => checked[c]).map((cat) => (
          <div key={cat} style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>{cat}</div>
            <PhotoGroupUploader label="General / WIP photos" photos={entries[cat]?.generalPhotos || []} onChange={(p) => setEntryPhotos(cat, "generalPhotos", p)} />
            <PhotoGroupUploader label="Before photos" photos={entries[cat]?.beforePhotos || []} onChange={(p) => setEntryPhotos(cat, "beforePhotos", p)} />
            <PhotoGroupUploader label="After photos" photos={entries[cat]?.afterPhotos || []} onChange={(p) => setEntryPhotos(cat, "afterPhotos", p)} />
          </div>
        ))}
      </div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 20 }} disabled={saving} onClick={submit}>
        {saving ? "Submitting…" : "Submit daily progress report"}
      </button>
    </div>
  );
}
