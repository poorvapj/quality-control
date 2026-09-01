import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectUnits } from "../lib/rules";
import { HOUR, SEVERITIES } from "../services/config";
import { useActions } from "../lib/useActions";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import type { Severity } from "../types";

export default function SnagModal() {
  const { snagModal, closeSnagModal, data, currentProjectId, toast } = useApp();
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

  const units = projectUnits(data, currentProjectId);
  const stages = trackStages(data, currentProjectId, "unit");
  const params = coll(data, "qparams").filter((p) => p.active !== false);
  const users = coll(data, "users").filter((u) => u.active !== false);

  async function submit() {
    if (!title.trim()) { toast("Title is required"); return; }
    if (!unitId) { toast("Pick a unit"); return; }
    if (!stageId) { toast("Pick a stage"); return; }
    if (!paramId) { toast("Pick a quality parameter"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }
    await saveSnag({ unitId, stageId, paramId, title, description: desc, severity, assignedTo, dueAt: new Date(due).getTime() });
    closeSnagModal();
  }

  return (
    <SidePanel
      open={!!snagModal}
      icon={<NavIcon name="snags" size={17} />}
      title="Raise Snag"
      desc="Log a quality defect against a unit and stage, with severity and an owner."
      onClose={closeSnagModal}
    >
      <div className="form-grid">
        <div className="field full"><label>Title *</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific: what is wrong and where" /></div>
        <div className="field"><label>Unit *</label>
          <select className="select" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">—</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Stage *</label>
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">—</option>
            {stages.map((x) => <option key={x.stage.id} value={x.stage.id}>{x.stage.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Quality parameter *</label>
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
        <div className="field"><label>Due by *</label><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field full"><label>Description</label><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Extent, location within the unit, and what rectification is expected." /></div>
      </div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 20 }} onClick={submit}>
        Raise snag
      </button>
    </SidePanel>
  );
}
