import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, trackStages, projectUnits } from "../shared/rules";
import { HOUR, SEVERITIES } from "../services/config";
import { useActions } from "../hooks/useActions";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import SearchDropdown from "./SearchDropdown";
import type { Severity } from "../types";
import "./SharpPanel.css";

export default function SnagModal() {
  const { snagModal, closeSnagModal, data, toast, me } = useApp();
  const { saveSnag } = useActions();

  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState("");
  const [stageId, setStageId] = useState("");
  const [paramId, setParamId] = useState("");
  const [severity, setSeverity] = useState<Severity>("Major");
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [desc, setDesc] = useState("");

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const currentUser = me();

  useEffect(() => {
    if (!snagModal) return;
    // Starts unset ("Choose") rather than defaulting to whatever project
    // happens to be globally selected — same reasoning as Assign Work:
    // makes the choice explicit instead of silently picking one for you.
    setProjectId("");
    setTitle(snagModal.preset || "");
    setUnitId(snagModal.unitId || "");
    setStageId(snagModal.stageId || "");
    setParamId("");
    setSeverity("Major");
    setAssignedTo("");
    setDue(new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 16));
    setDesc("");
  }, [snagModal]);

  const units = projectUnits(data, projectId);
  const stages = trackStages(data, projectId, "unit");
  const params = coll(data, "qparams").filter((p) => p.active !== false);
  const users = coll(data, "users").filter((u) => u.active !== false);

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!title.trim()) { toast("Title is required"); return; }
    if (!unitId) { toast("Pick a unit"); return; }
    if (!stageId) { toast("Pick a stage"); return; }
    if (!paramId) { toast("Pick a quality parameter"); return; }
    if (!assignedTo) { toast("Pick who this is assigned to"); return; }
    if (!due) { toast("Pick a due date"); return; }
    await saveSnag({ unitId, stageId, paramId, title, description: desc, severity, assignedTo, dueAt: new Date(due).getTime(), projectId });
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
          <button className="btn btn-primary" style={{ minWidth: 160, justifyContent: "center" }} onClick={submit}>
            Raise snag
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
            onChange={(v) => { setProjectId(v); setUnitId(""); setStageId(""); }}
            options={[{ value: "", label: "Choose" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Which project this snag belongs to — unit and stage below follow this choice.</div>
        </div>
        <div className="field full"><label>Title *</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific: what is wrong and where" /></div>
        <div className="field"><label>Unit *</label>
          <SearchDropdown
            value={unitId}
            onChange={setUnitId}
            options={[{ value: "", label: "Choose" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
            neutralActive
          />
        </div>
        <div className="field"><label>Stage *</label>
          <SearchDropdown
            value={stageId}
            onChange={setStageId}
            options={[{ value: "", label: "Choose" }, ...stages.map((x) => ({ value: x.stage.id, label: x.stage.name }))]}
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
