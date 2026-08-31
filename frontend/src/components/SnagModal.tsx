import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectUnits } from "../lib/rules";
import { HOUR, SEVERITIES } from "../services/config";
import { useActions } from "../lib/useActions";
import Modal from "./Modal";
import type { Severity } from "../types";

export default function SnagModal() {
  const { snagModal, closeSnagModal, data, currentProjectId } = useApp();
  const { saveSnag } = useActions();

  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState("");
  const [stageId, setStageId] = useState("");
  const [paramId, setParamId] = useState("");
  const [severity, setSeverity] = useState<Severity>("Major");
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!snagModal) return;
    setTitle(snagModal.preset || "");
    setUnitId(snagModal.unitId || "");
    setStageId(snagModal.stageId || "");
    setParamId("");
    setSeverity("Major");
    setAssignedTo("");
    setDue(new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16));
    setDesc("");
  }, [snagModal]);

  if (!snagModal) return null;

  const units = projectUnits(data, currentProjectId);
  const stages = trackStages(data, currentProjectId, "unit");
  const params = coll(data, "qparams").filter((p) => p.active !== false);
  const users = coll(data, "users").filter((u) => u.active !== false);

  return (
    <Modal open sub="RAISE SNAG" title="New snag" onClose={closeSnagModal} footer={
      <>
        <button className="btn btn-secondary" onClick={closeSnagModal}>Cancel</button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await saveSnag({ unitId, stageId, paramId, title, description: desc, severity, assignedTo, dueAt: due ? new Date(due).getTime() : null });
            closeSnagModal();
          }}
        >
          Raise snag
        </button>
      </>
    }>
      <div className="form-grid">
        <div className="field full"><label>Title *</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific: what is wrong and where" /></div>
        <div className="field"><label>Unit *</label>
          <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Stage</label>
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((x) => <option key={x.stage.id} value={x.stage.id}>{x.stage.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Quality parameter</label>
          <select className="select" value={paramId} onChange={(e) => setParamId(e.target.value)}>
            <option value="">—</option>
            {params.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Severity *</label>
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field"><label>Assign to *</label>
          <select className="select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        <div className="field"><label>Due by</label><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field full"><label>Description</label><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Extent, location within the unit, and what rectification is expected." /></div>
      </div>
    </Modal>
  );
}
