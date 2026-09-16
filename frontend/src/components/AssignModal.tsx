import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectFloors, projectUnits, rccChecklistItems, myProjects } from "../shared/rules";
import { HOUR } from "../services/config";
import { useActions } from "../hooks/useActions";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import SearchDropdown from "./SearchDropdown";
import type { Track } from "../types";
import "./SharpPanel.css";

export default function AssignModal() {
  const { assignModal, closeAssignModal, data, currentUserId, toast, me } = useApp();
  const { saveAssignment } = useActions();

  const [projectId, setProjectId] = useState("");
  const [targetType, setTargetType] = useState<Track>("unit");
  const [targetId, setTargetId] = useState("");
  // Holds a mix of flat stage ids (STG-HOI/STG-HOO/floor stages) and RCC
  // item ids — one assignment gets created per value on submit, per target.
  const [stageValues, setStageValues] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  // Bulk mode: same stage/assignee/due/note, many targets at once. Kept as a
  // separate opt-in path rather than changing `targetId` — the single-target
  // flow above (submit()'s non-bulk branch) is untouched.
  const [bulk, setBulk] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const projects = myProjects(data, currentUserId);
  const currentUser = me();

  useEffect(() => {
    if (!assignModal) return;
    // Starts unset ("Choose") unless the caller passed an explicit
    // projectId (e.g. opened from a specific unit's drawer) — never
    // silently defaults to whichever project happens to be globally
    // selected, same reasoning as Raise Snag.
    setProjectId(assignModal.projectId || "");
    const t = assignModal.targetType || "unit";
    setTargetType(t);
    setTargetId(assignModal.targetId || "");
    setStageValues(assignModal.itemId ? [assignModal.itemId] : assignModal.stageId ? [assignModal.stageId] : []);
    setAssignedTo(assignModal.presetUser || "");
    setDue(new Date(Date.now() + 24 * HOUR).toISOString().slice(0, 16));
    setNote("");
    setBulk(false);
    setBulkTargetIds([]);
  }, [assignModal]);

  const targets = targetType === "unit" ? projectUnits(data, projectId) : projectFloors(data, projectId);
  const stages = trackStages(data, projectId, targetType);
  // Work assignments are always civil site work — only CIVIL-role users
  // can be assigned to them.
  const users = coll(data, "users").filter((u) => u.active !== false && u.role === "CIVIL");

  // Item-based stages (RCC, Brick, AC, Electric, Plastering) each render as
  // their own group in the Stage picker, one heading per stage, their items
  // nested underneath (floor track is unaffected — it has no item-based
  // stages, so its stages stay a flat list). The whole picker is
  // multi-select — one assignment gets created per selected value (see
  // submit()).
  const stageOptions: { value: string; label: string; group?: string; subgroup?: string }[] = stages.flatMap((x): { value: string; label: string; group?: string; subgroup?: string }[] =>
    x.stage.itemBased
      ? rccChecklistItems(data, x.map.checklistId).map((it: any) => ({ value: it.id, label: it.name, group: x.stage.name, subgroup: it.subgroup }))
      : [{ value: x.stage.id, label: x.stage.name }]
  );
  const stageIdForItem = new Map(
    stages.filter((x) => x.stage.itemBased).flatMap((x) => rccChecklistItems(data, x.map.checklistId).map((it: any) => [it.id, x.stage.id] as const))
  );

  function toggleBulkTarget(id: string) {
    setBulkTargetIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function submit() {
    if (!stageValues.length) { toast("Pick at least one stage"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }
    if (!projectId) { toast("Pick a project"); return; }

    const targetIds = bulk ? bulkTargetIds : [targetId];
    if (bulk && bulkTargetIds.length === 0) { toast("Pick at least one target"); return; }
    if (!bulk && !targetId) { toast("Pick a target"); return; }

    // Awaited one at a time — saveAssignment/nextId() derive the next
    // ASG-#### id from the client's in-memory snapshot with no
    // server-side locking, so firing these in parallel (Promise.all)
    // would compute the same id for every target/stage pair and silently
    // overwrite all but one via upsert. Serial + awaited keeps each id
    // generation seeing the previous assignment already applied.
    setBulkBusy(true);
    try {
      for (const tId of targetIds) {
        for (const v of stageValues) {
          const itemStageId = stageIdForItem.get(v);
          await saveAssignment({
            targetType, targetId: tId,
            stageId: itemStageId || v, itemId: itemStageId ? v : undefined,
            assignedTo, dueAt: new Date(due).getTime(), note, projectId
          });
        }
      }
    } finally {
      setBulkBusy(false);
    }
    toast(targetIds.length * stageValues.length + " assignment(s) created");
    closeAssignModal();
  }

  return (
    <SidePanel
      open={!!assignModal}
      wide
      icon={<NavIcon name="work" size={17} />}
      title="Assign Work"
      desc="Hand a stage of work to a team member, with a due date and instructions."
      onClose={closeAssignModal}
      panelClassName="sharp-panel"
    >
      <div
        className="card card-pad"
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18, fontSize: 12.5, color: "var(--text-sub)" }}
      >
        <div><strong style={{ color: "var(--text-main)" }}>Assigned by:</strong> {currentUser?.name || "—"}</div>
        {currentUser?.email && <div><strong style={{ color: "var(--text-main)" }}>Contact:</strong> {currentUser.email}</div>}
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            onChange={(v) => { setProjectId(v); setTargetId(""); setBulkTargetIds([]); setStageValues([]); }}
            options={[{ value: "", label: "Choose" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Which project this assignment belongs to — targets and stages below follow this choice.</div>
        </div>
        <div className="field">
          <label>Target type</label>
          <SearchDropdown
            searchable={false}
            value={targetType}
            onChange={(v) => { const t = v as Track; setTargetType(t); setTargetId(""); setBulkTargetIds([]); setStageValues([]); }}
            options={[{ value: "unit", label: "Unit / Flat" }, { value: "floor", label: "Floor / Structure" }]}
            neutralActive
          />
        </div>
        <div className="field full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input id="bulk-assign-toggle" type="checkbox" checked={bulk} onChange={(e) => { setBulk(e.target.checked); setTargetId(""); setBulkTargetIds([]); }} />
          <label htmlFor="bulk-assign-toggle" style={{ margin: 0 }}>Assign the same stage to multiple {targetType === "unit" ? "units" : "floors"} at once</label>
        </div>
        {bulk ? (
          <div className="field full">
            <label>Targets ({bulkTargetIds.length} selected)</label>
            <div className="card card-pad" style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {targets.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "4px 2px" }}>
                  {projectId ? `No ${targetType === "unit" ? "units" : "floors"} in this project yet.` : "Pick a project above first."}
                </div>
              ) : (
                targets.map((t) => (
                  <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={bulkTargetIds.includes(t.id)} onChange={() => toggleBulkTarget(t.id)} />
                    {t.name}
                  </label>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Target *</label>
            <SearchDropdown
              value={targetId}
              onChange={setTargetId}
              options={[{ value: "", label: "Choose" }, ...targets.map((t) => ({ value: t.id, label: t.name }))]}
              neutralActive
            />
          </div>
        )}
        <div className="field">
          <label>Stage * (pick one or more)</label>
          <SearchDropdown
            multi
            multiValue={stageValues}
            onChangeMulti={setStageValues}
            options={stageOptions}
            neutralActive
          />
        </div>
        <div className="field">
          <label>Assign to *</label>
          <SearchDropdown
            value={assignedTo}
            onChange={setAssignedTo}
            options={[{ value: "", label: "Choose" }, ...users.map((u) => ({ value: u.id, label: `${u.name} · ${u.role}` }))]}
            neutralActive
          />
        </div>
        <div className="field"><label>Due by *</label><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field full">
          <label>Instruction</label>
          <textarea className="textarea" placeholder="What exactly needs doing, and any constraint the person should know." value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>* Required</div>

      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={submit} disabled={bulkBusy}>
        {bulkBusy
          ? "Assigning…"
          : bulk
          ? `Assign to ${bulkTargetIds.length} target${bulkTargetIds.length === 1 ? "" : "s"}${stageValues.length > 1 ? " × " + stageValues.length + " stages" : ""}`
          : stageValues.length > 1
          ? `Assign ${stageValues.length} stages`
          : "Assign work"}
      </button>
    </SidePanel>
  );
}
