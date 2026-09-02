import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { byId, coll, refLabel } from "../shared/rules";
import { useActions } from "../hooks/useActions";
import Modal from "./Modal";

interface RowState { paramId: string; result: "pass" | "fail" | "na"; remark: string }

export default function ChecklistModal() {
  const { checklistModal, closeChecklistModal, data, currentProjectId } = useApp();
  const { submitChecklist } = useActions();
  const [rows, setRows] = useState<RowState[]>([]);

  const chk = checklistModal ? byId(coll(data, "checklists"), checklistModal.checklistId) : null;

  useEffect(() => {
    if (!chk) { setRows([]); return; }
    setRows((chk.items || []).map((it) => ({ paramId: it.paramId, result: "pass", remark: "" })));
  }, [checklistModal?.checklistId]);

  if (!checklistModal || !chk) return null;

  const targetLabel = refLabel(data, checklistModal.kind === "unit" ? "units" : "floors", checklistModal.id);

  return (
    <Modal open wide sub={"QUALITY CHECKLIST · " + targetLabel} title={chk.name} onClose={closeChecklistModal} footer={
      <>
        <button className="btn btn-secondary" onClick={closeChecklistModal}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await submitChecklist(checklistModal.kind, checklistModal.id, checklistModal.stageId, checklistModal.checklistId, rows);
            closeChecklistModal();
          }}
        >
          Submit checklist
        </button>
      </>
    }>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
        Mark each parameter. Any failed line raises a snag automatically and fails the gate.
      </div>
      {(chk.items || []).map((it, i) => {
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
                    onChange={() => setRows((rs) => rs.map((r, ri) => ri === i ? { ...r, result: v } : r))}
                  />
                  {v === "pass" ? "Pass" : "Fail"}
                </label>
              ))}
              {it.mandatory === false && (
                <label className="btn btn-secondary btn-sm">
                  <input type="radio" style={{ marginRight: 5 }} checked={row?.result === "na"} onChange={() => setRows((rs) => rs.map((r, ri) => ri === i ? { ...r, result: "na" } : r))} />
                  N/A
                </label>
              )}
              <input
                className="input" placeholder="Observation / remark" style={{ flex: 1, minWidth: 150 }}
                value={row?.remark || ""}
                onChange={(e) => setRows((rs) => rs.map((r, ri) => ri === i ? { ...r, remark: e.target.value } : r))}
              />
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
