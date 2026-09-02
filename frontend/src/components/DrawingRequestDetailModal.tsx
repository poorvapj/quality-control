import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, refLabel } from "../shared/rules";
import { fmtDT } from "../shared/helpers";
import { canActOnStage } from "../shared/permissions";
import { useDrawingRequestActions } from "../hooks/useDrawingRequestActions";
import { uploadPhoto } from "../shared/uploadPhoto";
import SidePanel from "./SidePanel";
import NavIcon from "./NavIcon";
import Card from "../ui/Card";
import Btn from "../ui/Btn";
import SField from "../ui/SField";
import type { DrawingRequest, DrawingPriority } from "../types";

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "Stage 1 · Screening",
  "stage-2-produce": "Stage 2 · Producing drawing",
  "stage-3-crosscheck": "Stage 3 · Cross-check",
  "stage-4-final-approve": "Stage 4 · Final approval",
  approved: "Approved",
  returned: "Returned"
};

const PRIORITIES: { value: DrawingPriority; label: string }[] = [
  { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }
];

// The 5-node review workflow stepper — "Requested" is always node 0 (already
// done the moment a ticket exists); the remaining 4 map 1:1 onto reviewStatus.
const STEPS = [
  { key: "requested", label: "Requested" },
  { key: "stage-1-screen", label: "GM Screening (L1)" },
  { key: "stage-2-produce", label: "Architect Drawing (L2)" },
  { key: "stage-3-crosscheck", label: "GM Cross-Check (L3)" },
  { key: "stage-4-final-approve", label: "GM Final Approval (L4)" }
];
const STEP_INDEX: Record<string, number> = {
  "stage-1-screen": 1, "stage-2-produce": 2, "stage-3-crosscheck": 3, "stage-4-final-approve": 4, approved: 4, returned: 1
};
const WAITING_LABEL: Record<string, string> = {
  "stage-1-screen": "Waiting for GM Screening (L1)",
  "stage-2-produce": "Waiting for Architect Drawing (L2)",
  "stage-3-crosscheck": "Waiting for GM Cross-Check (L3)",
  "stage-4-final-approve": "Waiting for GM Final Approval (L4)",
  approved: "Approved",
  returned: "Returned to DRI"
};

export default function DrawingRequestDetailModal({ dr, onClose }: { dr: DrawingRequest | null; onClose: () => void }) {
  const { data, currentUserId, myRole, toast } = useApp();
  const { forwardToStage2, returnAtStage1, submitStage2, decideStage3, decideStage4, resubmit } = useDrawingRequestActions();
  const [remarks, setRemarks] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [committedDate, setCommittedDate] = useState("");
  const [priority, setPriority] = useState<DrawingPriority | "">("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // A picked-but-not-yet-uploaded selection, and an in-progress upload, both
  // represent work that a stray back/close would silently throw away — warn
  // on an actual tab close/reload, and block this panel's own close button
  // while an upload is actively running (selecting files with nothing
  // uploading yet is safe to close, since nothing has started).
  React.useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (uploading) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [uploading]);

  function guardedClose() {
    if (uploading) { toast("Upload in progress — please wait for it to finish"); return; }
    onClose();
  }

  if (!dr) return null;
  const req = dr; // narrowed, non-null copy safe to close over in nested functions below
  const users = coll(data, "users").filter((u) => u.active !== false);
  const role = myRole();

  const canStage1 = canActOnStage(data, currentUserId, role, "canScreenStage1");
  const canStage2 = canActOnStage(data, currentUserId, role, "canProduceStage2");
  const canStage3 = canActOnStage(data, currentUserId, role, "canCrosscheckStage3");
  const canStage4 = canActOnStage(data, currentUserId, role, "canFinalApproveStage4");
  const isRequester = dr.submittedByUserId === currentUserId;

  async function handleStage2Upload() {
    if (!selectedFiles.length) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: selectedFiles.length });
    const uploaded = [];
    for (const f of selectedFiles) {
      const photo = await uploadPhoto(f, "drawings");
      uploaded.push({ name: f.name, url: photo.url });
      setUploadProgress({ done: uploaded.length, total: selectedFiles.length });
    }
    setUploading(false);
    setUploadProgress(null);
    setSelectedFiles([]);
    await submitStage2(req.id, uploaded, remarks);
    setRemarks("");
  }

  return (
    <SidePanel
      open
      wide
      icon={<NavIcon name="drawing" size={17} />}
      title="Drawing Request"
      desc={dr.projectName || refLabel(data, "projects", dr.projectId)}
      onClose={guardedClose}
      footer={<Btn variant="secondary" label="Close" disabled={uploading} onClick={guardedClose} />}
    >
      {dr.files.length > 0 && (
        <Card style={{ fontSize: 12, lineHeight: 1.9, marginBottom: 16 }}>
          <div><strong>Files</strong> · {dr.files.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{f.name}</a>)}</div>
        </Card>
      )}

      {/* ── Review workflow stepper — 5 fixed nodes; "Requested" is always
          complete, the other 4 map 1:1 onto reviewStatus via STEP_INDEX. ── */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div className="micro-label">REVIEW WORKFLOW</div>
          <span
            style={{
              padding: "4px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
              border: "1px solid " + (dr.reviewStatus === "approved" ? "var(--color-pass)" : dr.reviewStatus === "returned" ? "var(--color-fail)" : "var(--theme-primary)"),
              color: dr.reviewStatus === "approved" ? "var(--color-pass)" : dr.reviewStatus === "returned" ? "var(--color-fail)" : "var(--theme-primary)"
            }}
          >
            {WAITING_LABEL[dr.reviewStatus] || dr.reviewStatus}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {STEPS.map((step, i) => {
            const current = STEP_INDEX[dr.reviewStatus] ?? 0;
            const done = i === 0 || i < current || (dr.reviewStatus === "approved" && i <= current);
            const isCurrent = !done && i === current;
            const circleColor = done ? "var(--color-pass)" : isCurrent ? "var(--theme-primary)" : "var(--border-strong)";
            return (
              <React.Fragment key={step.key}>
                {i > 0 && <div style={{ flex: 1, height: 2, background: i <= current ? "var(--color-pass)" : "var(--border)", marginTop: 15 }} />}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 84, textAlign: "center" }}>
                  <div
                    style={{
                      width: 30, height: 30, borderRadius: "50%", border: "2px solid " + circleColor,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: done ? "#fff" : circleColor, background: done ? "var(--color-pass)" : "transparent",
                      fontSize: 12, fontWeight: 800, flexShrink: 0
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isCurrent || done ? "var(--text-main)" : "var(--text-sub)", marginTop: 8 }}>{step.label}</div>
                  {i === 0 && (
                    <div style={{ fontSize: 10.5, color: "var(--text-sub)", marginTop: 2 }}>
                      {dr.requesterName} · {fmtDT(dr.createdAt)}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </Card>

      <div className="micro-label" style={{ marginBottom: 8 }}>REVIEW TIMELINE</div>
      <Card padded={false} style={{ marginBottom: 16 }}>
        {dr.reviewHistory.length === 0 ? <div className="empty">No review activity yet.</div> : dr.reviewHistory.slice().reverse().map((h, i) => (
          <div key={i} className="qitem" style={{ cursor: "default" }}>
            <div className="qitem-main">
              <div className="qitem-title">{STAGE_LABEL[h.stage] || h.stage} · {h.action}</div>
              <div className="qitem-sub">{h.byName || (h.by ? refLabel(data, "users", h.by) : "Public submitter")} · {fmtDT(h.at)}{h.remarks ? " · " + h.remarks : ""}</div>
            </div>
          </div>
        ))}
      </Card>

      {/* Action panel — only the action relevant to the stage this user is authorized for */}
      <Card style={{ marginBottom: 16 }}>
        {dr.reviewStatus === "stage-1-screen" && canStage1 && (
          <div className="form-grid">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--theme-primary)", marginBottom: -4 }} className="field full">GM Screening (L1)</div>
            <SField
              label="Assign Architect (optional)" full={false} placeholder="Choose"
              value={assignedTo} onChange={setAssignedTo}
              options={users.map((u) => ({ value: u.id, label: u.name }))}
            />
            <div className="field">
              <label>Committed Date (optional)</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex", pointerEvents: "none" }}>
                  <NavIcon name="calendar" size={14} />
                </span>
                {!committedDate && <span style={{ position: "absolute", left: 34, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 13, pointerEvents: "none" }}>Select date</span>}
                <input
                  className="input date-compact"
                  type="date"
                  style={{ paddingLeft: 34, color: committedDate ? "var(--text-main)" : "transparent" }}
                  value={committedDate}
                  onChange={(e) => setCommittedDate(e.target.value)}
                />
              </div>
            </div>
            <div className="field full"><textarea className="textarea" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <Btn variant="success" label="Yes — Forward to Architect" onClick={() => { forwardToStage2(dr.id, assignedTo || null, committedDate || null, remarks); setRemarks(""); }} />
              <Btn variant="danger" label="Not Needed — Return to DRI" onClick={() => { returnAtStage1(dr.id, remarks); setRemarks(""); }} />
            </div>
          </div>
        )}

        {dr.reviewStatus === "stage-2-produce" && canStage2 && (
          <div className="form-grid">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--theme-primary)", marginBottom: -4 }} className="field full">Architect Drawing (L2)</div>
            <div className="field full">
              <label>Upload drawing file(s) *</label>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--border-strong)", cursor: uploading ? "not-allowed" : "pointer",
                  color: "var(--text-muted)", fontSize: 13, fontWeight: 500, opacity: uploading ? 0.6 : 1
                }}
              >
                <NavIcon name="download" size={14} />
                {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) selected` : "Attach drawing file(s) — click to browse"}
                <input
                  type="file" multiple disabled={uploading} className="hide"
                  onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                />
              </label>
              {selectedFiles.length > 0 && !uploading && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11.5, color: "var(--text-muted)" }}>
                  {selectedFiles.map((f, i) => <li key={i}>{f.name}</li>)}
                </ul>
              )}
              <div className="hint">Uploading also submits this ticket for cross-check.</div>
            </div>
            <div className="field full"><textarea className="textarea" placeholder="Remarks (optional, set before uploading)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full">
              {uploading && uploadProgress ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--bg-subtle)", overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "var(--theme-primary)", width: `${(uploadProgress.done / uploadProgress.total) * 100}%`, transition: "width .2s ease" }} />
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    Uploading {uploadProgress.done}/{uploadProgress.total}…
                  </span>
                </div>
              ) : (
                <Btn label="Submit Drawing" disabled={selectedFiles.length === 0} onClick={handleStage2Upload} />
              )}
            </div>
          </div>
        )}

        {dr.reviewStatus === "stage-3-crosscheck" && canStage3 && (
          <div className="form-grid">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--theme-primary)", marginBottom: -4 }} className="field full">GM Cross-Check (L3)</div>
            <div className="field full"><textarea className="textarea" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <Btn variant="success" label="Yes — Approve for Final Sign-off" onClick={() => { decideStage3(dr.id, true, remarks); setRemarks(""); }} />
              <Btn variant="danger" label="Reject — Return to Architect" onClick={() => { decideStage3(dr.id, false, remarks); setRemarks(""); }} />
            </div>
          </div>
        )}

        {dr.reviewStatus === "stage-4-final-approve" && canStage4 && (
          <div className="form-grid">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--theme-primary)", marginBottom: -4 }} className="field full">GM Final Approval (L4)</div>
            <SField
              label="Priority (on approval)" full={false} placeholder="Choose"
              value={priority} onChange={(v) => setPriority(v as DrawingPriority)}
              options={PRIORITIES}
            />
            <div className="field full"><textarea className="textarea" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full" style={{ display: "flex", gap: 8 }}>
              <Btn variant="success" label="Yes — Final Approve" onClick={() => { decideStage4(dr.id, true, priority, remarks); setRemarks(""); }} />
              <Btn variant="danger" label="Reject — Return to Architect" onClick={() => { decideStage4(dr.id, false, "", remarks); setRemarks(""); }} />
            </div>
          </div>
        )}

        {dr.reviewStatus === "returned" && isRequester && (
          <div className="form-grid">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-fail)", marginBottom: -4 }} className="field full">Returned to DRI</div>
            <div className="field full"><textarea className="textarea" placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
            <div className="field full"><Btn label="Resubmit — Restart Review" onClick={() => { resubmit(dr.id, remarks); setRemarks(""); }} /></div>
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
      </Card>

      {/* ── Ticket Details — read-only, two-column reference view of every
          field on the record. Priority is plain colored text (matches the
          list page); Status is the one pill in this section. ── */}
      <div style={{ borderTop: "1px solid #E5E7EB", margin: "20px 0" }} />
      {(() => {
        const priorityVal = dr.priority || dr.requestedPriority;
        const priorityColor = priorityVal === "urgent" || priorityVal === "high" ? "#DC2626" : priorityVal === "medium" ? "#D97706" : "#6B7280";
        const trackingVal = dr.trackingStatus || "pending";
        const trackingColor = trackingVal === "completed" ? "#16A34A" : trackingVal === "delayed" ? "#DC2626" : trackingVal === "committed" ? "#2563EB" : "#EA8C00";
        let delayDays: number | null = null;
        if (dr.committedDate && dr.actualCompletionDate) {
          const ms = new Date(dr.actualCompletionDate).getTime() - new Date(dr.committedDate).getTime();
          delayDays = Math.round(ms / 86400000);
        }

        const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#9CA3AF", textTransform: "none", marginBottom: 4 };
        const value: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "#111827", lineHeight: 1.4 };
        const empty: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "#9CA3AF" };

        function Field({ full, children }: { full?: boolean; children: React.ReactNode }) {
          return <div style={full ? { gridColumn: "1 / -1" } : undefined}>{children}</div>;
        }

        return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 40, rowGap: 20, paddingBottom: 24 }}>
            <Field full>
              <div style={label}>Ticket No</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#7C3AED" }}>{dr.ticketNo}</div>
            </Field>

            <Field><div style={label}>Project</div><div style={value}>{dr.projectName || refLabel(data, "projects", dr.projectId)}</div></Field>
            <Field><div style={label}>Drawing Type</div><div style={value}>{dr.drawingType}</div></Field>

            <Field full>
              <div style={label}>Drawing Description</div>
              <div style={value}>{dr.description}</div>
            </Field>

            <Field><div style={label}>Source</div><div style={dr.source ? value : empty}>{dr.source || "—"}</div></Field>
            <Field><div style={label}>Requested By (DRI)</div><div style={value}>{dr.requesterName}</div></Field>

            <Field><div style={label}>Request Date</div><div style={value}>{fmtDT(dr.createdAt)}</div></Field>
            <Field><div style={label}>Assigned To</div><div style={dr.assignedTo ? value : empty}>{dr.assignedTo ? refLabel(data, "users", dr.assignedTo) : "—"}</div></Field>

            <Field>
              <div style={label}>Priority</div>
              {priorityVal ? <strong style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: priorityColor }}>{priorityVal}</strong> : <div style={empty}>—</div>}
            </Field>
            <Field>
              <div style={label}>Status</div>
              <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: trackingVal === "pending" ? "#FFF3D6" : `${trackingColor}1A`, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: trackingVal === "pending" ? "#C2650A" : trackingColor }}>
                {trackingVal}
              </span>
            </Field>

            <Field><div style={label}>Committed Date</div><div style={dr.committedDate ? value : empty}>{dr.committedDate || "—"}</div></Field>
            <Field><div style={label}>Actual Completion</div><div style={dr.actualCompletionDate ? value : empty}>{dr.actualCompletionDate || "—"}</div></Field>

            <Field><div style={label}>Delay (Days)</div><div style={delayDays != null ? value : empty}>{delayDays != null ? delayDays : "—"}</div></Field>
            <Field><div style={label}>Planning Verified</div><div style={value}>{dr.planningVerified ? "Yes" : "No"}</div></Field>

            <Field full><div style={label}>Project Acknowledged</div><div style={value}>{dr.projectAcknowledged ? "Yes" : "No"}</div></Field>
          </div>
        );
      })()}

      <div className="micro-label" style={{ marginBottom: 8 }}>REVIEW HISTORY</div>
      <Card padded={false}>
        {dr.reviewHistory.length === 0 ? <div className="empty">No history yet.</div> : dr.reviewHistory.slice().reverse().map((h, i) => (
          <div key={i} className="qitem" style={{ cursor: "default" }}>
            <div className="qitem-main">
              <div className="qitem-title">{STAGE_LABEL[h.stage] || h.stage} · {h.action}</div>
              <div className="qitem-sub">{h.byName || (h.by ? refLabel(data, "users", h.by) : "Public submitter")} · {fmtDT(h.at)}{h.remarks ? " · " + h.remarks : ""}</div>
            </div>
          </div>
        ))}
      </Card>
    </SidePanel>
  );
}
