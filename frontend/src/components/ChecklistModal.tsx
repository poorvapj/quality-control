import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { byId, coll, refLabel } from "../shared/rules";
import { useActions } from "../hooks/useActions";
import { uploadPhoto } from "../shared/uploadPhoto";
import Modal from "./Modal";
import type { Photo, QParam } from "../types";

interface RowState { paramId: string; result: "pass" | "fail" | "na"; remark: string; photo?: Photo }

export default function ChecklistModal() {
  const { checklistModal, closeChecklistModal, data, toast } = useApp();
  const { submitChecklist } = useActions();
  const [rows, setRows] = useState<RowState[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingPhotoRow = useRef<number | null>(null);

  const chk = checklistModal ? byId(coll(data, "checklists"), checklistModal.checklistId) : null;

  useEffect(() => {
    if (!chk) { setRows([]); return; }
    setRows((chk.items || []).map((it) => ({ paramId: it.paramId, result: "pass", remark: "" })));
  }, [checklistModal?.checklistId]);

  if (!checklistModal || !chk) return null;

  const targetLabel = refLabel(data, checklistModal.kind === "unit" ? "units" : "floors", checklistModal.id);

  function setRow(i: number, patch: Partial<RowState>) {
    setRows((rs) => rs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  }

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
  // photo attached before this gate can be submitted — previously that flag
  // was set-and-forget (RecordModal.tsx wrote it, nothing ever read it back).
  const items = chk.items || [];
  const missingEvidence = items
    .map((it, i) => ({ it, row: rows[i] }))
    .find(({ it, row }) => it.evidence && row && row.result !== "na" && !row.photo);

  async function submit() {
    if (missingEvidence) {
      const param = byId(coll(data, "qparams"), missingEvidence.it.paramId) as QParam | null;
      toast(`"${param?.name || "This item"}" needs a photo before you can submit`);
      return;
    }
    await submitChecklist(checklistModal!.kind, checklistModal!.id, checklistModal!.stageId, checklistModal!.checklistId, rows);
    closeChecklistModal();
  }

  return (
    <Modal open wide sub={"QUALITY CHECKLIST · " + targetLabel} title={chk.name} onClose={closeChecklistModal} footer={
      <>
        <button className="btn btn-secondary" onClick={closeChecklistModal}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Submit checklist</button>
      </>
    }>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
        Mark each parameter. Any failed line raises a snag automatically and fails the gate.
      </div>
      {items.map((it, i) => {
        const p = byId(coll(data, "qparams"), it.paramId);
        if (!p) return null;
        const row = rows[i];
        return (
          <div key={it.paramId + i} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{i + 1}. {p.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>
                  {p.method || ""}{p.acceptance ? " · Accept: " + p.acceptance : ""}
                </div>
              </div>
              <span className={"badge-tag " + (p.severity === "Critical" ? "crit" : p.severity === "Major" ? "gate" : "mute")}>{p.severity}</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {(["pass", "fail"] as const).map((v) => (
                <label key={v} className="btn btn-secondary btn-sm">
                  <input
                    type="radio" style={{ marginRight: 5 }}
                    checked={row?.result === v}
                    onChange={() => setRow(i, { result: v })}
                  />
                  {v === "pass" ? "Pass" : "Fail"}
                </label>
              ))}
              {it.mandatory === false && (
                <label className="btn btn-secondary btn-sm">
                  <input type="radio" style={{ marginRight: 5 }} checked={row?.result === "na"} onChange={() => setRow(i, { result: "na" })} />
                  N/A
                </label>
              )}
              <input
                className="input" placeholder="Observation / remark" style={{ flex: 1, minWidth: 150 }}
                value={row?.remark || ""}
                onChange={(e) => setRow(i, { remark: e.target.value })}
              />
            </div>
            {it.evidence && row?.result !== "na" && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className={"btn btn-sm " + (row?.photo ? "btn-secondary" : "btn-danger")}
                  onClick={() => requestPhoto(i)}
                  disabled={uploadingIdx === i}
                >
                  {uploadingIdx === i ? "Uploading…" : row?.photo ? "📷 Retake photo" : "📸 Photo required"}
                </button>
                {row?.photo && <img src={row.photo.url} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />}
              </div>
            )}
          </div>
        );
      })}
      <input
        type="file" accept="image/*" capture="environment" ref={fileRef} style={{ display: "none" }}
        onChange={onPhotoPicked}
      />
    </Modal>
  );
}
