import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { useDrawingRequestActions } from "../hooks/useDrawingRequestActions";
import Field from "../ui/Field";
import SField from "../ui/SField";
import Btn from "../ui/Btn";
import type { DrawingType, DrawingSource, DrawingPriority, DrawingRequest } from "../types";

const DRAWING_TYPES: DrawingType[] = ["Architectural", "Structural", "MEP", "Civil", "Interior", "Landscape", "Shop Drawing", "As-Built", "Other"];
const SOURCES: DrawingSource[] = ["Site Visit", "RFI", "Client Request", "Internal Review", "Other"];
const PRIORITIES: { value: DrawingPriority; label: string }[] = [
  { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }
];

export default function DrawingRequestForm({
  isPublic, onDone, editRecord
}: {
  isPublic: boolean; onDone: (ticketNo: string) => void; editRecord?: DrawingRequest | null;
}) {
  const { data, toast, apply } = useApp();
  const { createDrawingRequest } = useDrawingRequestActions();
  const projects = coll(data, "projects").filter((p) => p.active !== false);

  const [projectId, setProjectId] = useState(editRecord?.projectId || "");
  const [description, setDescription] = useState(editRecord?.description || "");
  const [drawingType, setDrawingType] = useState<DrawingType | "">(editRecord?.drawingType || "");
  const [source, setSource] = useState<DrawingSource | "">(editRecord?.source || "");
  const [requestedPriority, setRequestedPriority] = useState<DrawingPriority | "">(editRecord?.requestedPriority || "");
  const [requesterName, setRequesterName] = useState(editRecord?.requesterName || "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!projectId) { toast("Pick a project"); return; }
    if (!description.trim()) { toast("Drawing description is required"); return; }
    if (!drawingType) { toast("Pick a drawing type"); return; }
    if (!requesterName.trim()) { toast("Requester name is required"); return; }
    setSaving(true);
    if (editRecord) {
      // Only the basic ticket details are editable here — reviewStatus, reviewHistory,
      // files and stage assignment are never touched, so the workflow stays append-only.
      const projectName = coll(data, "projects").find((p) => p.id === projectId)?.name || "";
      await apply([{
        op: "upsert", coll: "drawingRequests",
        rec: { id: editRecord.id, projectId, projectName, description: description.trim(), drawingType, source, requesterName: requesterName.trim(), requestedPriority }
      }]);
      setSaving(false);
      toast("Drawing request updated");
      onDone(editRecord.ticketNo);
      return;
    }
    const ticketNo = await createDrawingRequest({
      projectId, description: description.trim(), drawingType, source, requesterName: requesterName.trim(), isPublic, requestedPriority
    });
    setSaving(false);
    onDone(ticketNo!);
  }

  return (
    <div className="form-grid">
      <SField
        label="Project" required placeholder="Select project"
        value={projectId} onChange={setProjectId}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
      />
      <Field
        label="Drawing description" required textarea
        value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. Structural drawing for 2nd floor slab, Tower B"
      />
      <SField
        label="Drawing type" required placeholder="Choose type"
        value={drawingType} onChange={(v) => setDrawingType(v as DrawingType)}
        options={DRAWING_TYPES.map((t) => ({ value: t, label: t }))}
      />
      <SField
        label="Source (optional)" placeholder="Choose source"
        value={source} onChange={(v) => setSource(v as DrawingSource)}
        options={SOURCES.map((s) => ({ value: s, label: s }))}
      />
      <SField
        label="Priority (optional)" placeholder="Choose priority"
        value={requestedPriority} onChange={(v) => setRequestedPriority(v as DrawingPriority)}
        options={PRIORITIES}
        hint="Your preference only — the final priority is confirmed at Stage 4 approval."
      />
      <Field
        label="Requested by (DRI)" required
        value={requesterName} onChange={(e) => setRequesterName(e.target.value)}
        placeholder="Requester's name"
      />
      <div className="field full">
        <Btn full loading={saving} onClick={submit} label={editRecord ? "Save changes" : "Submit Request"} />
      </div>
    </div>
  );
}
