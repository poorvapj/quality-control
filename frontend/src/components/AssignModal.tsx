import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectFloors, projectUnits } from "../shared/rules";
import { HOUR } from "../services/config";
import { useActions } from "../hooks/useActions";
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
  // Bulk mode: same stage/assignee/due/note, many targets at once. Kept as a
  // separate opt-in path rather than changing `targetId` — the single-target
  // flow above (submit()'s non-bulk branch) is untouched.
  const [bulk, setBulk] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!assignModal) return;
    const t = assignModal.targetType || "unit";
    setTargetType(t);
    setTargetId(assignModal.targetId || "");
    setStageId(assignModal.stageId || "");
    setAssignedTo(assignModal.presetUser || "");
    setDue(new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 16));
    setNote("");
    setBulk(false);
    setBulkTargetIds([]);
  }, [assignModal]);

  const targets = targetType === "unit" ? projectUnits(data, currentProjectId) : projectFloors(data, currentProjectId);
  const stages = trackStages(data, currentProjectId, targetType);
  const users = coll(data, "users").filter((u) => u.active !== false);

  function toggleBulkTarget(id: string) {
    setBulkTargetIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function submit() {
    if (!stageId) { toast("Pick a stage"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }

    if (bulk) {
      if (bulkTargetIds.length === 0) { toast("Pick at least one target"); return; }
      // Awaited one at a time — saveAssignment/nextId() derive the next
      // ASG-#### id from the client's in-memory snapshot with no
      // server-side locking, so firing these in parallel (Promise.all)
      // would compute the same id for every target and silently
      // overwrite all but one via upsert. Serial + awaited keeps each
      // id generation seeing the previous assignment already applied.
      setBulkBusy(true);
      try {
        for (const id of bulkTargetIds) {
          await saveAssignment({ targetType, targetId: id, stageId, assignedTo, dueAt: new Date(due).getTime(), note });
        }
      } finally {
        setBulkBusy(false);
      }
      toast(bulkTargetIds.length + " units assigned");
      closeAssignModal();
      return;
    }

    if (!targetId) { toast("Pick a target"); return; }
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
          <select className="select" value={targetType} onChange={(e) => { const t = e.target.value as Track; setTargetType(t); setTargetId(""); setBulkTargetIds([]); setStageId(""); }}>
            <option value="unit">Unit / Flat</option>
            <option value="floor">Floor / Structure</option>
          </select>
        </div>
        <div className="field full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input id="bulk-assign-toggle" type="checkbox" checked={bulk} onChange={(e) => { setBulk(e.target.checked); setTargetId(""); setBulkTargetIds([]); }} />
          <label htmlFor="bulk-assign-toggle" style={{ margin: 0 }}>Assign the same stage to multiple {targetType === "unit" ? "units" : "floors"} at once</label>
        </div>
        {bulk ? (
          <div className="field full">
            <label>Targets ({bulkTargetIds.length} selected)</label>
            <div className="card card-pad" style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {targets.map((t) => (
                <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={bulkTargetIds.includes(t.id)} onChange={() => toggleBulkTarget(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Target</label>
            <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">—</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
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

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 20 }} onClick={submit} disabled={bulkBusy}>
        {bulkBusy ? "Assigning…" : bulk ? `Assign to ${bulkTargetIds.length} target${bulkTargetIds.length === 1 ? "" : "s"}` : "Assign work"}
      </button>
    </SidePanel>
  );
}
