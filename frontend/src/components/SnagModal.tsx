import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectUnits, projectFloors, rccChecklistItems, myProjects } from "../shared/rules";
import { HOUR, SEVERITIES } from "../services/config";
import { useActions } from "../hooks/useActions";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import SearchDropdown from "./SearchDropdown";
import type { Severity } from "../types";
import "./SharpPanel.css";

export default function SnagModal() {
  const { snagModal, closeSnagModal, data, toast, me, currentUserId } = useApp();
  const { saveSnag } = useActions();

  const [projectId, setProjectId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState("");
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [paramId, setParamId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [severity, setSeverity] = useState<Severity>("Major");
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [desc, setDesc] = useState("");
  // Bulk mode: same title/stage/severity/assignee, many units at once —
  // mirrors Assign Work's "Assign the same stage to multiple targets"
  // toggle. Kept as a separate opt-in path rather than changing `unitId`,
  // so the single-target flow above (submit()'s non-bulk branch) stays
  // untouched.
  const [bulk, setBulk] = useState(false);
  const [bulkUnitIds, setBulkUnitIds] = useState<string[]>([]);

  const projects = myProjects(data, currentUserId);
  const currentUser = me();

  useEffect(() => {
    if (!snagModal) return;
    // Starts unset ("Choose") rather than defaulting to whatever project
    // happens to be globally selected — same reasoning as Assign Work:
    // makes the choice explicit instead of silently picking one for you.
    setProjectId("");
    setFloorId("");
    setTitle(snagModal.preset || "");
    setUnitId(snagModal.unitId || "");
    setItemIds(snagModal.itemId ? [snagModal.itemId] : []);
    setParamId("");
    setSeverity("Major");
    setAssignedTo("");
    setDue(new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16));
    setDesc("");
    setBulk(false);
    setBulkUnitIds([]);
  }, [snagModal]);

  const floors = projectFloors(data, projectId);
  let units = projectUnits(data, projectId);
  if (floorId) units = units.filter((u) => u.floorId === floorId);
  units = units.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  // Internal/Owner Possession are handled through the dedicated Possession
  // Form, not through a generic snag — a snag can only target one of the
  // item-based stages (RCC, Brick, AC, Electric, Plastering), each its own
  // group of selectable items in the picker below.
  const stages = trackStages(data, projectId, "unit").filter((x) => x.stage.itemBased);
  const params = coll(data, "qparams").filter((p) => p.active !== false);
  // Snags on RCC's item-based stages are always civil site work — only
  // CIVIL-role users can be assigned to fix them.
  const users = coll(data, "users").filter((u) => u.active !== false && u.role === "CIVIL");
  const stageOptions = stages.flatMap((x) =>
    rccChecklistItems(data, x.map.checklistId).map((it: any) => ({ value: it.id, label: it.name, group: x.stage.name, subgroup: it.subgroup }))
  );
  const stageIdForItem = new Map(stages.flatMap((x) => rccChecklistItems(data, x.map.checklistId).map((it: any) => [it.id, x.stage.id] as const)));

  function toggleBulkUnit(id: string) {
    setBulkUnitIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!title.trim()) { toast("Title is required"); return; }
    if (bulk && bulkUnitIds.length === 0) { toast("Pick at least one unit"); return; }
    if (!bulk && !unitId) { toast("Pick a unit"); return; }
    if (!itemIds.length) { toast("Pick at least one stage item"); return; }
    if (!paramId) { toast("Pick a quality parameter"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }
    // Awaited one at a time — saveSnag/nextId() derive the next SNG-####
    // id from the client's in-memory snapshot with no server-side locking,
    // so firing these in parallel would compute the same id for every
    // unit/item pair and silently overwrite all but one via upsert.
    const unitIds = bulk ? bulkUnitIds : [unitId];
    setSubmitting(true);
    try {
      for (const uId of unitIds) {
        for (const id of itemIds) {
          const stageId = stageIdForItem.get(id) || "";
          await saveSnag({ unitId: uId, stageId, itemId: id, paramId, title, description: desc, severity, assignedTo, dueAt: new Date(due).getTime(), projectId });
        }
      }
    } finally {
      setSubmitting(false);
    }
    toast(unitIds.length * itemIds.length + " snag(s) raised");
    closeSnagModal();
  }

  return (
    <SidePanel
      open={!!snagModal}
      wide
      icon={<NavIcon name="snags" size={17} />}
      title="Raise Snag"
      desc="Log a quality defect against a unit and stage, with severity and an owner."
      onClose={closeSnagModal}
      panelClassName="sharp-panel"
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>* Required</span>
          <button className="btn btn-primary" style={{ minWidth: 160, justifyContent: "center" }} onClick={submit} disabled={submitting}>
            {submitting
              ? "Raising…"
              : bulk
              ? `Raise ${bulkUnitIds.length} × ${Math.max(itemIds.length, 1)} snags`
              : itemIds.length > 1
              ? `Raise ${itemIds.length} snags`
              : "Raise snag"}
          </button>
        </div>
      }
    >
      <div
        className="card card-pad"
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18, fontSize: 12.5, color: "var(--text-sub)" }}
      >
        <div><strong style={{ color: "var(--text-main)" }}>Raised by:</strong> {currentUser?.name || "—"}</div>
        {currentUser?.email && <div><strong style={{ color: "var(--text-main)" }}>Contact:</strong> {currentUser.email}</div>}
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            onChange={(v) => { setProjectId(v); setFloorId(""); setUnitId(""); setBulkUnitIds([]); setItemIds([]); }}
            options={[{ value: "", label: "Choose" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Which project this snag belongs to — floor, unit and stage below follow this choice.</div>
        </div>
        <div className="field"><label>Floor</label>
          <SearchDropdown
            searchable={false}
            value={floorId}
            onChange={(v) => { setFloorId(v); setUnitId(""); setBulkUnitIds([]); }}
            options={[{ value: "", label: "All Floors" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
            neutralActive
          />
        </div>
        <div className="field full"><label>Title *</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific: what is wrong and where" /></div>
        <div className="field full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input id="bulk-snag-toggle" type="checkbox" checked={bulk} onChange={(e) => { setBulk(e.target.checked); setUnitId(""); setBulkUnitIds([]); }} />
          <label htmlFor="bulk-snag-toggle" style={{ margin: 0 }}>Raise the same snag against multiple units at once</label>
        </div>
        {bulk ? (
          <div className="field full">
            <label>Units ({bulkUnitIds.length} selected)</label>
            <div className="card card-pad" style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {units.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "4px 2px" }}>
                  {projectId ? "No units in this project yet." : "Pick a project above first."}
                </div>
              ) : (
                units.map((u) => (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={bulkUnitIds.includes(u.id)} onChange={() => toggleBulkUnit(u.id)} />
                    {u.name}
                  </label>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="field"><label>Unit *</label>
            <SearchDropdown
              value={unitId}
              onChange={setUnitId}
              options={[{ value: "", label: "Choose" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
              neutralActive
            />
          </div>
        )}
        <div className="field"><label>Stage * (pick one or more)</label>
          <SearchDropdown
            multi
            multiValue={itemIds}
            onChangeMulti={setItemIds}
            options={stageOptions}
            neutralActive
          />
        </div>
        <div className="field"><label>Quality parameter *</label>
          <SearchDropdown
            value={paramId}
            onChange={setParamId}
            options={[{ value: "", label: "Choose" }, ...params.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]}
            neutralActive
          />
        </div>
        <div className="field"><label>Severity *</label>
          <SearchDropdown
            searchable={false}
            value={severity}
            onChange={(v) => setSeverity(v as Severity)}
            options={SEVERITIES.map((s) => ({ value: s, label: s }))}
            neutralActive
          />
        </div>
        <div className="field"><label>Assign to *</label>
          <SearchDropdown
            value={assignedTo}
            onChange={setAssignedTo}
            options={[{ value: "", label: "Choose" }, ...users.map((u) => ({ value: u.id, label: `${u.name} · ${u.role}` }))]}
            neutralActive
          />
        </div>
        <div className="field"><label>Due by *</label><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div className="field full"><label>Description</label><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Extent, location within the unit, and what rectification is expected." /></div>
      </div>
    </SidePanel>
  );
}
