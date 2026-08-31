import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../lib/rules";
import { useDrawingRequestActions } from "../lib/useDrawingRequestActions";
import type { DrawingType, DrawingSource, DrawingPriority } from "../types";

const DRAWING_TYPES: DrawingType[] = ["Architectural", "Structural", "MEP", "Civil", "Interior", "Landscape", "Shop Drawing", "As-Built", "Other"];
const SOURCES: DrawingSource[] = ["Site Visit", "RFI", "Client Request", "Internal Review", "Other"];

export default function DrawingRequestForm({ isPublic, onDone }: { isPublic: boolean; onDone: (ticketNo: string) => void }) {
  const { data, currentProjectId, me, toast } = useApp();
  const { createDrawingRequest } = useDrawingRequestActions();
  const projects = coll(data, "projects").filter((p) => p.active !== false);

  const [projectId, setProjectId] = useState(currentProjectId || projects[0]?.id || "");
  const [description, setDescription] = useState("");
  const [drawingType, setDrawingType] = useState<DrawingType | "">("");
  const [source, setSource] = useState<DrawingSource | "">("");
  const [requestedPriority, setRequestedPriority] = useState<DrawingPriority | "">("");
  const [requesterName, setRequesterName] = useState(isPublic ? "" : me()?.name || "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!description.trim()) { toast("Drawing description is required"); return; }
    if (!drawingType) { toast("Pick a drawing type"); return; }
    if (!requesterName.trim()) { toast("Requester name is required"); return; }
    setSaving(true);
    const ticketNo = await createDrawingRequest({
      projectId, description: description.trim(), drawingType, source, requesterName: requesterName.trim(), isPublic, requestedPriority
    });
    setSaving(false);
    onDone(ticketNo!);
  }

  return (
    <div className="form-grid">
      <div className="field full"><label>Project *</label>
        <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Select project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field full"><label>Drawing description *</label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Structural drawing for 2nd floor slab, Tower B" />
      </div>
      <div className="field full"><label>Drawing type *</label>
        <select className="select" value={drawingType} onChange={(e) => setDrawingType(e.target.value as DrawingType)}>
          <option value="">Choose type</option>
          {DRAWING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="field full"><label>Source (optional)</label>
        <select className="select" value={source} onChange={(e) => setSource(e.target.value as DrawingSource)}>
          <option value="">Choose source</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="field full"><label>Priority (optional)</label>
        <select className="select" value={requestedPriority} onChange={(e) => setRequestedPriority(e.target.value as DrawingPriority)}>
          <option value="">Choose priority</option>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <div className="hint">Your preference only — the final priority is confirmed at Stage 4 approval.</div>
      </div>
      <div className="field full"><label>Requested by (DRI) *</label>
        <input className="input" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Requester's name" />
      </div>
      <div className="field full">
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={saving} onClick={submit}>
          {saving ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}
