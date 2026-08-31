import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel } from "../lib/rules";
import { fmtDT } from "../lib/helpers";
import { canActOnStage } from "../lib/permissions";
import { useDrawingRequestActions } from "../lib/useDrawingRequestActions";
import { uploadPhoto } from "../lib/uploadPhoto";
import Modal from "./Modal";
import type { DrawingRequest, DrawingPriority } from "../types";

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "Stage 1 · Screening",
  "stage-2-produce": "Stage 2 · Producing drawing",
  "stage-3-crosscheck": "Stage 3 · Cross-check",
  "stage-4-final-approve": "Stage 4 · Final approval",
  approved: "Approved",
  returned: "Returned"
};

export default function DrawingRequestDetailModal({ dr, onClose }: { dr: DrawingRequest | null; onClose: () => void }) {
  const { data, currentUserId, myRole } = useApp();
  const { forwardToStage2, returnAtStage1, submitStage2, decideStage3, decideStage4, resubmit } = useDrawingRequestActions();
  const [remarks, setRemarks] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [committedDate, setCommittedDate] = useState("");
  const [priority, setPriority] = useState<DrawingPriority | "">("");
  const [uploading, setUploading] = useState(false);

  if (!dr) return null;
  const req = dr; // narrowed, non-null copy safe to close over in nested functions below
  const users = coll(data, "users").filter((u) => u.active !== false);
  const role = myRole();

  const canStage1 = canActOnStage(data, currentUserId, role, "canScreenStage1");
  const canStage2 = canActOnStage(data, currentUserId, role, "canProduceStage2");
  const canStage3 = canActOnStage(data, currentUserId, role, "canCrosscheckStage3");
  const canStage4 = canActOnStage(data, currentUserId, role, "canFinalApproveStage4");
  const isRequester = dr.submittedByUserId === currentUserId;

  async function handleStage2Upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = "";
    if (!files || !files.length) return;
    setUploading(true);
    const uploaded = [];
    for (const f of Array.from(files)) {
      const photo = await uploadPhoto(f, "drawings");
      uploaded.push({ name: f.name, url: photo.url });
    }
    setUploading(false);
    await submitStage2(req.id, uploaded, remarks);
    setRemarks("");
  }

  return (
    <Modal open wide sub={"DRAWING REQUEST · " + dr.ticketNo} title={dr.description} onClose={onClose} footer={
      <button className="btn btn-secondary" onClick={onClose}>Close</button>
    }>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <span className="badge-tag gate">{STAGE_LABEL[dr.reviewStatus]}</span>
        {dr.priority && <span className="badge-tag crit">{dr.priority}</span>}
        {dr.trackingStatus && <span className="badge-tag mute">{dr.trackingStatus}</span>}
        {dr.isPublic && <span className="badge-tag mute">Public submission</span>}
      </div>

      <div className="card card-pad" style={{ fontSize: 12, lineHeight: 1.9, marginBottom: 16 }}>
        <div><strong>Project</strong> · {dr.projectName || refLabel(data, "projects", dr.projectId)}</div>
        <div><strong>Type</strong> · {dr.drawingType}{dr.source ? " · Source: " + dr.source : ""}</div>
        <div><strong>Requested by</strong> · {dr.requesterName}</div>
        {dr.assignedTo && <div><strong>Assigned to</strong> · {refLabel(data, "users", dr.assignedTo)}</div>}
        {dr.committedDate && <div><strong>Committed date</strong> · {dr.committedDate}</div>}
        {dr.files.length > 0 && (
          <div><strong>Files</strong> · {dr.files.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{f.name}</a>)}</div>
        )}
      </div>

      {/* Action panel — only the action relevant to the stage this user is authorized for */}
      <div className="micro-label" style={{ marginBottom: 8 }}>ACTION</div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        {dr.reviewStatus === "stage-1-screen" && canStage1 && (
          <div className="form-grid">
            <div className="field"><label>Assign to</label>
              <select className="select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Committed date</label><input className="input" type="date" value={committedDate} onChange={(e) => setCommittedDate(e.target.value)} /></div>
            <div className="field full"><label>Remarks</label><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => { forwardToStage2(dr.id, assignedTo || null, committedDate || null, remarks); setRemarks(""); }}>Forward to Stage 2</button>
              <button className="btn btn-danger" onClick={() => { returnAtStage1(dr.id, remarks); setRemarks(""); }}>Not needed — Return</button>
            </div>
          </div>
        )}

        {dr.reviewStatus === "stage-2-produce" && canStage2 && (
          <div className="form-grid">
            <div className="field full"><label>Upload drawing file(s) *</label>
              <input type="file" multiple onChange={handleStage2Upload} disabled={uploading} />
              <div className="hint">Uploading also submits this ticket for cross-check.</div>
            </div>
            <div className="field full"><label>Remarks (optional, set before uploading)</label><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          </div>
        )}

        {dr.reviewStatus === "stage-3-crosscheck" && canStage3 && (
          <div className="form-grid">
            <div className="field full"><label>Remarks</label><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-success" onClick={() => { decideStage3(dr.id, true, remarks); setRemarks(""); }}>Approve → Stage 4</button>
              <button className="btn btn-danger" onClick={() => { decideStage3(dr.id, false, remarks); setRemarks(""); }}>Reject → back to Stage 2</button>
            </div>
          </div>
        )}

        {dr.reviewStatus === "stage-4-final-approve" && canStage4 && (
          <div className="form-grid">
            <div className="field"><label>Priority (on approval)</label>
              <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as DrawingPriority)}>
                <option value="">—</option>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </div>
            <div className="field full"><label>Remarks</label><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-success" onClick={() => { decideStage4(dr.id, true, priority, remarks); setRemarks(""); }}>Final approve</button>
              <button className="btn btn-danger" onClick={() => { decideStage4(dr.id, false, "", remarks); setRemarks(""); }}>Reject → back to Stage 2</button>
            </div>
          </div>
        )}

        {dr.reviewStatus === "returned" && isRequester && (
          <div className="form-grid">
            <div className="field full"><label>Remarks</label><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full"><button className="btn btn-primary" onClick={() => { resubmit(dr.id, remarks); setRemarks(""); }}>Resubmit — restarts at Stage 1</button></div>
          </div>
        )}

        {((dr.reviewStatus === "stage-1-screen" && !canStage1) ||
          (dr.reviewStatus === "stage-2-produce" && !canStage2) ||
          (dr.reviewStatus === "stage-3-crosscheck" && !canStage3) ||
          (dr.reviewStatus === "stage-4-final-approve" && !canStage4) ||
          (dr.reviewStatus === "returned" && !isRequester) ||
          dr.reviewStatus === "approved") && (
          <div className="empty">
            {dr.reviewStatus === "approved" ? "This ticket is fully approved." : "You aren't authorized to act on this stage."}
          </div>
        )}
      </div>

      <div className="micro-label" style={{ marginBottom: 8 }}>REVIEW HISTORY</div>
      <div className="card">
        {dr.reviewHistory.length === 0 ? <div className="empty">No history yet.</div> : dr.reviewHistory.slice().reverse().map((h, i) => (
          <div key={i} className="qitem" style={{ cursor: "default" }}>
            <div className="qitem-main">
              <div className="qitem-title">{STAGE_LABEL[h.stage] || h.stage} · {h.action}</div>
              <div className="qitem-sub">{h.byName || (h.by ? refLabel(data, "users", h.by) : "Public submitter")} · {fmtDT(h.at)}{h.remarks ? " · " + h.remarks : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
