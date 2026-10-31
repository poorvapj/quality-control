import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import { buildEventOp } from "../shared/eventLog";
import { makeTempId } from "../shared/helpers";
import { WORK_CATEGORIES } from "../services/config";
import type { DailyProgressReport, DprWorkEntry, ShiftType, Photo, WorkTarget, Op } from "../types";
import PhotoGroupUploader from "./PhotoGroupUploader";
import SearchDropdown from "./SearchDropdown";
import { ymd } from "../shared/dateRange";

const OTHER_VENDOR = "__other__";

function slugCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "VENDOR";
}

const CategoryGrid = React.memo(function CategoryGrid({ checked, onToggle }: { checked: Record<string, boolean>; onToggle: (cat: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, maxHeight: 260, overflowY: "auto", paddingRight: 4 }}>
      {WORK_CATEGORIES.map((cat) => (
        <div key={cat} className="check-row" style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <input type="checkbox" id={"cat-" + cat} checked={!!checked[cat]} onChange={() => onToggle(cat)} />
          <label htmlFor={"cat-" + cat}>{cat}</label>
        </div>
      ))}
    </div>
  );
});

type PhotoGroup = "generalPhotos" | "beforePhotos" | "afterPhotos";

// One checked work type's qty/unit + three photo pickers. Memoised so typing
// a quantity in one work type (or any header field) doesn't re-render the
// photo thumbnails of every other checked work type.
const CategoryEntry = React.memo(function CategoryEntry({ cat, entry, target, onQty, onPhotos }: {
  cat: string; entry: DprWorkEntry | undefined; target: WorkTarget | undefined;
  onQty: (cat: string, qty: string, unit: string) => void;
  onPhotos: (cat: string, group: PhotoGroup, photos: Photo[]) => void;
}) {
  const onGeneral = useCallback((p: Photo[]) => onPhotos(cat, "generalPhotos", p), [cat, onPhotos]);
  const onBefore = useCallback((p: Photo[]) => onPhotos(cat, "beforePhotos", p), [cat, onPhotos]);
  const onAfter = useCallback((p: Photo[]) => onPhotos(cat, "afterPhotos", p), [cat, onPhotos]);
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{cat}</div>
      <div className="form-grid" style={{ marginBottom: 10 }}>
        <div className="field">
          <label>Qty done today {target ? `(planned ${target.plannedQty} ${target.unit})` : ""}</label>
          <input
            className="input" type="number" min={0} step="any"
            placeholder={target ? `e.g. in ${target.unit}` : "optional"}
            value={entry?.qty ?? ""}
            onChange={(e) => onQty(cat, e.target.value, entry?.unit || target?.unit || "")}
          />
        </div>
        <div className="field">
          <label>Unit</label>
          <input
            className="input" placeholder="e.g. sq.ft, cum, nos"
            value={entry?.unit ?? target?.unit ?? ""}
            onChange={(e) => onQty(cat, entry?.qty != null ? String(entry.qty) : "", e.target.value)}
          />
        </div>
      </div>
      <PhotoGroupUploader label="General / WIP photos" photos={entry?.generalPhotos || NO_PHOTOS} onChange={onGeneral} />
      <PhotoGroupUploader label="Before photos" photos={entry?.beforePhotos || NO_PHOTOS} onChange={onBefore} />
      <PhotoGroupUploader label="After photos" photos={entry?.afterPhotos || NO_PHOTOS} onChange={onAfter} />
    </div>
  );
});

const NO_PHOTOS: Photo[] = [];

export default function DprForm({ isPublic, onDone, onDirtyChange }: { isPublic: boolean; onDone: (id: string) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { data, apply, toast, currentUserId } = useApp();
  const projects = useMemo(
    () => (isPublic ? coll(data, "projects").filter((p) => p.active !== false) : myProjects(data, currentUserId)),
    [data, isPublic, currentUserId]
  );
  // Only Site In-charges (DRI) and Site Supervisors submit DPRs — not
  // every active user (e.g. a Quality/Measurement/Execution team member).
  const users = useMemo(
    () => coll(data, "users").filter((u) => u.active !== false && (u.role === "DRI" || u.role === "SUPERVISOR")),
    [data]
  );
  const projectOptions = useMemo(() => [{ value: "", label: "Choose" }, ...projects.map((p) => ({ value: p.id, label: p.name }))], [projects]);
  const userOptions = useMemo(() => [{ value: "", label: "Choose" }, ...users.map((u) => ({ value: u.name, label: u.name }))], [users]);

  const [projectId, setProjectId] = useState("");
  const [submittedByName, setSubmittedByName] = useState("");
  const [date, setDate] = useState(() => ymd(new Date()));
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendorNameOther, setVendorNameOther] = useState("");
  const [shift, setShift] = useState<ShiftType | "">("");
  const [labourCount, setLabourCount] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [entries, setEntries] = useState<Record<string, DprWorkEntry>>({});
  const [saving, setSaving] = useState(false);

  const toggleCategory = useCallback((cat: string) => {
    setChecked((c) => ({ ...c, [cat]: !c[cat] }));
    setEntries((e) => {
      if (e[cat]) return e;
      return { ...e, [cat]: { category: cat, generalPhotos: [], beforePhotos: [], afterPhotos: [] } };
    });
  }, []);

  const setEntryPhotos = useCallback((cat: string, group: PhotoGroup, photos: Photo[]) => {
    setEntries((e) => ({ ...e, [cat]: { ...e[cat], [group]: photos } }));
  }, []);

  const setEntryQty = useCallback((cat: string, qty: string, unit: string) => {
    setEntries((e) => ({ ...e, [cat]: { ...e[cat], qty: qty === "" ? undefined : Number(qty), unit: unit || undefined } }));
  }, []);

  const workTargets = coll(data, "workTargets") as WorkTarget[];
  // first active target per category for the chosen project, built once
  // instead of a find() per category on every render
  const targetsByCategory = useMemo(() => {
    const m = new Map<string, WorkTarget>();
    for (const t of workTargets) if (t.projectId === projectId && t.active !== false && !m.has(t.category)) m.set(t.category, t);
    return m;
  }, [workTargets, projectId]);
  const targetFor = (cat: string): WorkTarget | undefined => targetsByCategory.get(cat);

  // Known contractors — the full VMS vendor master (migrated into the
  // "vendors" collection) merged with any vendorCode/vendorName pair seen
  // across past DPR submissions here that isn't in that master yet (e.g. a
  // contractor added via "Other" below). "Other" reveals a free-text field
  // for a contractor that isn't in either list.
  const vendorsColl = coll(data, "vendors");
  const dprColl = coll(data, "dpr");
  // Cached on the two collections themselves: the loop over every vendor and
  // every past DPR, plus the sort, used to re-run on every keystroke.
  const { vendorByCode, contractorOptions } = useMemo(() => {
    const byCode = new Map<string, { vendorCode: string; vendorName: string }>();
    for (const v of vendorsColl) {
      if (v.vendorCode) byCode.set(v.vendorCode, { vendorCode: v.vendorCode, vendorName: v.vendorName });
    }
    for (const r of dprColl) {
      if (r.vendorCode && !byCode.has(r.vendorCode)) {
        byCode.set(r.vendorCode, { vendorCode: r.vendorCode, vendorName: r.vendorName });
      }
    }
    const options = Array.from(byCode.values())
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
      .map((r) => ({ value: r.vendorCode, label: `${r.vendorCode} — ${r.vendorName}` }));
    return {
      vendorByCode: byCode,
      contractorOptions: [{ value: "", label: "Choose" }, ...options, { value: OTHER_VENDOR, label: "+ Other (new contractor)" }]
    };
  }, [vendorsColl, dprColl]);
  const resolvedVendor = vendorChoice === OTHER_VENDOR
    ? { vendorCode: slugCode(vendorNameOther), vendorName: vendorNameOther.trim() }
    : vendorByCode.get(vendorChoice) || null;

  // Real work entered so far (a project/contractor/labour picked, a work
  // type checked, or a photo taken) that a stray back-tap, accidental
  // overlay click, or tab close would otherwise throw away with zero
  // warning — same guard QualityInspection.tsx's InspectionForm already
  // has for its own (even more data-heavy) form; this one had none at all.
  const isDirty = !!projectId || !!vendorChoice || !!submittedByName.trim() || !!labourCount
    || Object.values(checked).some(Boolean) || Object.values(entries).some((e) => e.generalPhotos.length > 0 || e.beforePhotos.length > 0 || e.afterPhotos.length > 0);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!resolvedVendor || !resolvedVendor.vendorName.trim()) { toast("Contractor name is required"); return; }
    if (!submittedByName.trim()) { toast("DRI name is required"); return; }
    if (!shift) { toast("Pick a shift type"); return; }
    const labour = Number(labourCount);
    if (!Number.isFinite(labour) || labour < 0) { toast("Number of labourers must be a non-negative number"); return; }

    const workEntries = Object.keys(checked).filter((c) => checked[c]).map((c) => entries[c]);
    if (workEntries.length === 0) { toast("Check at least one work type"); return; }
    // Proof-of-work photo, not before/after (those stay optional extras) —
    // matches the reference spec's "at least 1 image per work entry" rule.
    const missingPhoto = workEntries.find((e) => e.generalPhotos.length === 0);
    if (missingPhoto) { toast(`"${missingPhoto.category}" needs at least 1 photo`); return; }
    setSaving(true);
    const rec: DailyProgressReport = {
      // nextId("DPR", coll(data,"dpr")) used to pick this — but its regex
      // only recognizes this app's own "DPR-0001" shape, never the
      // "DPR-VMS-<id>" ones the VMS sync writes (by far most of this
      // collection in production), so it always counted from 0 on any
      // board whose only dpr rows happened to be VMS ones. Two DRIs
      // submitting around the same time (neither had yet re-synced to see
      // the other's save) both computed "DPR-0001" — same id, so the
      // second one's upsert silently overwrote the first one's report with
      // no error to either DRI. makeTempId() can't collide this way — the
      // server exchanges it for a real sequential id (idSeq.js) before
      // writing anything, never by counting what the client can see.
      id: makeTempId("DPR"),
      projectId,
      projectName: coll(data, "projects").find((p) => p.id === projectId)?.name || "",
      submittedByUserId: isPublic ? null : currentUserId,
      submittedByName: submittedByName.trim(),
      date,
      vendorCode: resolvedVendor.vendorCode,
      vendorName: resolvedVendor.vendorName.trim(),
      shift,
      labourCount: labour,
      workEntries,
      isPublic
    };
    // The anonymous public submission form has no session, and the backend
    // requires one for "event" ops (assertOpAllowed) — only log an audit
    // entry for a real signed-in submission, matching how every other
    // logEvent() call in the app is implicitly gated by already requiring a
    // session for its own op.
    const ops: Op[] = [{ op: "upsert", coll: "dpr", rec }];
    if (!isPublic) ops.push(buildEventOp(currentUserId, "DPR_SUBMIT", rec.id, "", `${rec.vendorName} · ${workEntries.length} work item(s) · ${rec.projectName}`));
    // apply() queues the op on this device instead of losing it when the
    // network/session fails (see AppContext.tsx), but this form kept
    // showing the same "submitted" toast either way — someone whose
    // submission only got as far as the local queue (phone briefly
    // offline, a flaky connection, an expired 7-day session) saw the exact
    // same confirmation as a real save, with nothing telling them it
    // hadn't actually reached the server yet. QualityInspection.tsx's own
    // save() already checks this; DprForm.tsx never did.
    const synced = await apply(ops);
    setSaving(false);
    toast(synced ? "Daily progress report submitted" : "Saved on this device — will finish submitting once you're back online");
    onDone(rec.id);
  }

  return (
    <div>
      <div className="micro-label" style={{ marginBottom: 4 }}>REPORT DETAILS</div>
      <div className="form-grid" style={{ marginBottom: 20 }}>
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
          />
        </div>
        <div className="field">
          <label>Contractor name *</label>
          <SearchDropdown
            value={vendorChoice}
            onChange={setVendorChoice}
            options={contractorOptions}
          />
          {vendorChoice === OTHER_VENDOR && (
            <input
              className="input" style={{ marginTop: 6 }}
              placeholder="New contractor's name"
              value={vendorNameOther}
              onChange={(e) => setVendorNameOther(e.target.value)}
            />
          )}
        </div>
        <div className="field">
          <label>DRI name *</label>
          {isPublic ? (
            <input className="input" value={submittedByName} onChange={(e) => setSubmittedByName(e.target.value)} placeholder="Your name" />
          ) : (
            <SearchDropdown
              value={submittedByName}
              onChange={setSubmittedByName}
              options={userOptions}
            />
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
        <CategoryGrid checked={checked} onToggle={toggleCategory} />

        {WORK_CATEGORIES.filter((c) => checked[c]).map((cat) => (
          <CategoryEntry key={cat} cat={cat} entry={entries[cat]} target={targetsByCategory.get(cat)} onQty={setEntryQty} onPhotos={setEntryPhotos} />
        ))}
      </div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 20 }} disabled={saving} onClick={submit}>
        {saving ? "Submitting…" : "Submit daily progress report"}
      </button>
    </div>
  );
}
