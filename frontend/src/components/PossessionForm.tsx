import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { byId, coll, pkey } from "../shared/rules";
import { useActions } from "../hooks/useActions";
import { uploadPhoto } from "../shared/uploadPhoto";
import NavIcon from "./NavIcon";
import SidePanel from "./SidePanel";
import "./SharpPanel.css";
import type { ChecklistItem, Photo, QParam } from "../types";

export interface PossessionActiveForm {
  unitId: string; unitName: string; floorName: string; projectName: string;
  stageId: string; stageName: string; stageDesc: string; checklistId: string;
}

interface RowState { paramId: string; result: "pass" | "fail" | "na"; remark: string; photo?: Photo }

const draftKey = (unitId: string, stageId: string) => `handoverDraft:${unitId}:${stageId}`;

/* Fill-out form for one possession checklist (Internal or Owner) — opens
   as a right-side SidePanel drawer, the same visual language as
   AssignModal.tsx's "Assign Work" form (icon+title+desc header, bordered
   card sections, sticky footer with Cancel/Save/Submit, sharp-panel
   corners). Submission still goes through the existing
   useActions().submitChecklist — same pass/fail/snag logic as
   ChecklistModal, just presented as a full drawer instead of a popup.

   Shared by HandoverChecklist.tsx's unit table and Drawer.tsx's Unit 360°
   "Possession" tab — one implementation, not a second copy. */
export default function PossessionForm({ form, onDone }: { form: PossessionActiveForm | null; onDone: () => void }) {
  const { data, toast, apply } = useApp();
  const { submitChecklist } = useActions();
  const [rows, setRows] = useState<RowState[]>([]);
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRow = useRef<number | null>(null);

  const chk = form ? byId(coll(data, "checklists"), form.checklistId) : null;
  const items: ChecklistItem[] = chk?.items || [];

  // A draft is just this in-progress form state, kept client-side
  // (localStorage) rather than written to `progress` — submitChecklist()
  // is the only thing that actually finalizes a pass/fail (and can raise a
  // snag), so a draft must never call it. Restores automatically if the
  // same unit+stage form is reopened before submitting.
  useEffect(() => {
    if (!form) return;
    let restored: { rows: RowState[]; touched: Record<number, boolean>; remarks?: string } | null = null;
    try {
      const raw = localStorage.getItem(draftKey(form.unitId, form.stageId));
      if (raw) restored = JSON.parse(raw);
    } catch { /* corrupt/blocked storage — fall back to a fresh form */ }
    if (restored && restored.rows.length === items.length) {
      setRows(restored.rows);
      setTouched(restored.touched || {});
      setRemarks(restored.remarks || "");
    } else {
      setRows(items.map((it) => ({ paramId: it.paramId, result: "pass", remark: "" })));
      setTouched({});
      setRemarks("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.checklistId, form?.unitId]);

  const setRow = (i: number, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
    setTouched((t) => ({ ...t, [i]: true }));
  };
  const answeredCount = Object.values(touched).filter(Boolean).length;
  const pct = items.length ? Math.round((answeredCount / items.length) * 100) : 0;

  function saveDraft() {
    if (!form) return;
    setSavingDraft(true);
    try {
      localStorage.setItem(draftKey(form.unitId, form.stageId), JSON.stringify({ rows, touched, remarks }));
      toast("Draft saved");
    } catch {
      toast("Couldn't save draft — browser storage unavailable");
    }
    setSavingDraft(false);
  }

  const groups: { category: string; entries: { item: ChecklistItem; param: QParam; i: number }[] }[] = [];
  items.forEach((it, i) => {
    const param = byId(coll(data, "qparams"), it.paramId) as QParam | null;
    if (!param) return;
    const cat = param.category || "General";
    let g = groups.find((x) => x.category === cat);
    if (!g) { g = { category: cat, entries: [] }; groups.push(g); }
    g.entries.push({ item: it, param, i });
  });

  function requestPhoto(i: number) {
    pendingPhotoRow.current = i;
    fileRef.current?.click();
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const i = pendingPhotoRow.current;
    e.target.value = "";
    if (!file || i == null) return;
    setUploadingIdx(i);
    const photo = await uploadPhoto(file, "qc");
    setRow(i, { photo });
    setUploadingIdx(null);
  }

  // Items flagged `evidence: true` in Masters ▸ Quality Checklist need a
  // photo attached before this can be submitted — previously that flag was
  // set-and-forget (RecordModal.tsx wrote it, nothing ever read it back).
  const missingEvidence = items
    .map((it, i) => ({ it, row: rows[i] }))
    .find(({ it, row }) => it.evidence && row && row.result !== "na" && !row.photo);

  async function submit() {
    if (!form) return;
    if (missingEvidence) {
      const param = byId(coll(data, "qparams"), missingEvidence.it.paramId) as QParam | null;
      toast(`"${param?.name || "This item"}" needs a photo before you can submit`);
      return;
    }
    setSubmitting(true);
    await submitChecklist("unit", form.unitId, form.stageId, form.checklistId, rows);
    // Additive only — a free-text note alongside the pass/fail results,
    // stored on the same progress record. submitChecklist()'s own `note`
    // field is reserved for the auto-generated fail summary, so this is a
    // separate key rather than overwriting it.
    if (remarks.trim()) {
      await apply([{ op: "progress", key: pkey(form.unitId, form.stageId), patch: { remarks: remarks.trim() } }]);
    }
    try { localStorage.removeItem(draftKey(form.unitId, form.stageId)); } catch { /* ignore */ }
    setSubmitting(false);
    onDone();
  }

  return (
    <SidePanel
      open={!!form}
      wide
      icon={<NavIcon name="handover" size={17} />}
      title={form ? form.stageName.replace("QC GATE", "").trim() : ""}
      desc={form?.stageDesc || ""}
      onClose={onDone}
      panelClassName="sharp-panel"
      footer={
        form && (
          <>
            <button className="btn btn-secondary" onClick={onDone} disabled={submitting || savingDraft}>Cancel</button>
            <button className="btn btn-secondary" onClick={saveDraft} disabled={submitting}>{savingDraft ? "Saving…" : "Save Draft"}</button>
            <button className="btn btn-primary" onClick={submit} disabled={savingDraft}>
              {submitting ? "Submitting…" : "Submit " + (form.stageId === "STG-HOI" ? "Internal Possession" : "Owner Possession")}
            </button>
          </>
        )
      }
    >
      {!form || !chk ? null : (
        <>
          <div className="micro-label" style={{ marginBottom: 8 }}>UNIT INFORMATION</div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div className="form-grid">
              <div className="field"><label>Project</label><div style={{ fontSize: 13, fontWeight: 700 }}>{form.projectName || "—"}</div></div>
              <div className="field"><label>Floor</label><div style={{ fontSize: 13, fontWeight: 700 }}>{form.floorName || "—"}</div></div>
              <div className="field"><label>Unit</label><div style={{ fontSize: 13, fontWeight: 700 }}>{form.unitName}</div></div>
              <div className="field"><label>Status</label><div style={{ fontSize: 13, fontWeight: 700 }}>{answeredCount === 0 ? "Pending" : answeredCount < items.length ? "In Progress" : "Completed"}</div></div>
            </div>
          </div>

          <div className="micro-label" style={{ marginBottom: 8 }}>POSSESSION CHECKLIST</div>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              <span>Progress</span>
              <span>{answeredCount} / {items.length}</span>
            </div>
            <div className="workload-bar">
              <div className="workload-fill" style={{ width: pct + "%" }} />
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.category} style={{ marginBottom: 18 }}>
              <div className="micro-label" style={{ marginBottom: 8 }}>{g.category}</div>
              <div className="card card-pad">
                {g.entries.map(({ item, param, i }, gi) => {
                  const row = rows[i];
                  if (!row) return null;
                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: "10px 0",
                        borderBottom: gi < g.entries.length - 1 ? "1px solid var(--border)" : "none"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 160 }}>{param.name}</div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className={"btn btn-sm " + (row.result === "pass" ? "btn-primary" : "btn-secondary")} onClick={() => setRow(i, { result: "pass" })}>Pass</button>
                          <button className={"btn btn-sm " + (row.result === "fail" ? "btn-danger" : "btn-secondary")} onClick={() => setRow(i, { result: "fail" })}>Fail</button>
                          {item.mandatory === false && (
                            <button className={"btn btn-sm " + (row.result === "na" ? "btn-primary" : "btn-secondary")} onClick={() => setRow(i, { result: "na" })}>N/A</button>
                          )}
                        </div>
                      </div>
                      {item.evidence && row.result !== "na" && (
                        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={"btn btn-sm " + (row.photo ? "btn-secondary" : "btn-danger")}
                            onClick={() => requestPhoto(i)}
                            disabled={uploadingIdx === i}
                          >
                            {uploadingIdx === i ? "Uploading…" : row.photo ? "📷 Retake photo" : "📸 Photo required"}
                          </button>
                          {row.photo && <img src={row.photo.url} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
                        </div>
                      )}
                      {row.result === "fail" && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Remarks</label>
                          <input
                            className="input"
                            style={{ marginTop: 4 }}
                            placeholder="What's wrong, and what needs to happen before this passes"
                            value={row.remark}
                            onChange={(e) => setRow(i, { remark: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 18 }}>
            <div className="micro-label" style={{ marginBottom: 8 }}>REMARKS</div>
            <div className="card card-pad">
              <textarea
                className="textarea"
                rows={3}
                placeholder="Any additional notes for this possession checklist…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Any item marked Fail automatically raises a snag for rework.
          </div>
          <input
            type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
            onChange={onPhotoPicked}
          />
        </>
      )}
    </SidePanel>
  );
}
