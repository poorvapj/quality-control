import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectFloors, projectUnits } from "../lib/rules";
import { HOUR } from "../services/config";
import { useActions } from "../lib/useActions";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import type { Track } from "../types";

export default function AssignModal() {
  const { assignModal, closeAssignModal, data, currentProjectId, toast } = useApp();
  const { saveAssignment } = useActions();

  const [targetType, setTargetType] = useState<Track>("unit");
  const [targetId, setTargetId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!assignModal) return;
    const t = assignModal.targetType || "unit";
    setTargetType(t);
    setTargetId(assignModal.targetId || "");
    setStageId(assignModal.stageId || "");
    setAssignedTo(assignModal.presetUser || "");
    setDue(new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 16));
    setNote("");
  }, [assignModal]);

  const targets = targetType === "unit" ? projectUnits(data, currentProjectId) : projectFloors(data, currentProjectId);
  const stages = trackStages(data, currentProjectId, targetType);
  const users = coll(data, "users").filter((u) => u.active !== false);

  async function submit() {
    if (!targetId) { toast("Pick a target"); return; }
    if (!stageId) { toast("Pick a stage"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }
    await saveAssignment({ targetType, targetId, stageId, assignedTo, dueAt: new Date(due).getTime(), note });
    closeAssignModal();
  }

  return (
    <SidePanel
      open={!!assignModal}
      icon={<NavIcon name="work" size={17} />}
      title="Assign Work"
      desc="Hand a stage of work to a team member, with a due date and instructions."
      onClose={closeAssignModal}
    >
      <div className="form-grid">
        <div className="field">
          <label>Target type</label>
          <select className="select" value={targetType} onChange={(e) => { const t = e.target.value as Track; setTargetType(t); setTargetId(""); setStageId(""); }}>
            <option value="unit">Unit / Flat</option>
            <option value="floor">Floor / Structure</option>
          </select>
        </div>
        <div className="field">
          <label>Target</label>
          <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">—</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Stage</label>
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">—</option>
            {stages.map((x) => <option key={x.stage.id} value={x.stage.id}>{x.stage.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Assign to *</label>
          <select className="select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        <div className="field"><label>Due by</label><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field full">
          <label>Instruction</label>
          <textarea className="textarea" placeholder="What exactly needs doing, and any constraint the person should know." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 20 }} onClick={submit}>
        Assign work
      </button>
    </SidePanel>
  );
}
