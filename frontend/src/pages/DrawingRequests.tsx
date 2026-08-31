import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../lib/rules";
import { fmtDate } from "../lib/helpers";
import SidePanel from "../components/SidePanel";
import DrawingRequestForm from "../components/DrawingRequestForm";
import DrawingRequestDetailModal from "../components/DrawingRequestDetailModal";
import type { DrawingRequest } from "../types";

const STAGE_LABEL: Record<string, string> = {
  "stage-1-screen": "Stage 1 · Screening",
  "stage-2-produce": "Stage 2 · Producing",
  "stage-3-crosscheck": "Stage 3 · Cross-check",
  "stage-4-final-approve": "Stage 4 · Final approval",
  approved: "Approved",
  returned: "Returned"
};

export default function DrawingRequestsPage() {
  const { data, currentProjectId } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<DrawingRequest | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [fTracking, setFTracking] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fType, setFType] = useState("");
  const [fProject, setFProject] = useState(currentProjectId || "");

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  let rows = coll(data, "drawingRequests").slice();
  if (fStatus) rows = rows.filter((r) => r.reviewStatus === fStatus);
  if (fTracking) rows = rows.filter((r) => r.trackingStatus === fTracking);
  if (fPriority) rows = rows.filter((r) => r.priority === fPriority);
  if (fType) rows = rows.filter((r) => r.drawingType === fType);
  if (fProject) rows = rows.filter((r) => r.projectId === fProject);
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Keep the open detail view's data fresh as the board updates.
  const liveDetail = detail ? coll(data, "drawingRequests").find((r) => r.id === detail.id) || null : null;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon">📐</div>
          <div>
            <div className="page-title">Drawing Requests</div>
            <div className="page-desc">Manage drawing requests — {rows.length} total</div>
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>＋ New request</button>
        </div>
      </div>

      <div className="panel-card">
        <div className="toolbar">
          <select className="select" style={{ width: "auto" }} value={fProject} onChange={(e) => setFProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="">All types</option>
            {["Architectural", "Structural", "MEP", "Civil", "Interior", "Landscape", "Shop Drawing", "As-Built", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }} value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
            <option value="">All priorities</option>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <select className="select" style={{ width: "auto" }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" style={{ width: "auto" }} value={fTracking} onChange={(e) => setFTracking(e.target.value)}>
            <option value="">All review stages</option>
            <option value="pending">Pending</option><option value="committed">Committed</option><option value="completed">Completed</option><option value="delayed">Delayed</option>
          </select>
        </div>

        <div className="table-scroll">
          {rows.length === 0 ? (
            <div className="empty">No drawing requests yet.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Ticket No</th><th>Project</th><th>Description</th><th>Type</th><th>Source</th>
                  <th>Requested by</th><th>Request date</th><th>Review</th><th>Priority</th><th>Status</th>
                  <th>Plan verified</th><th>Proj. ack.</th><th>Remarks</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong style={{ color: "var(--theme-primary)" }}>{r.ticketNo}</strong></td>
                    <td>{r.projectName}</td>
                    <td>{r.description.length > 30 ? r.description.slice(0, 30) + "…" : r.description}</td>
                    <td>{r.drawingType}</td>
                    <td>{r.source || "—"}</td>
                    <td>{r.requesterName}</td>
                    <td>{r.createdAt ? fmtDate(r.createdAt) : "—"}</td>
                    <td><span className={"badge-tag " + (r.reviewStatus === "approved" ? "pass" : r.reviewStatus === "returned" ? "fail" : "gate")}>{STAGE_LABEL[r.reviewStatus]}</span></td>
                    <td>{r.priority || r.requestedPriority ? <span className="badge-tag crit">{r.priority || r.requestedPriority}</span> : "—"}</td>
                    <td>{r.trackingStatus ? <span className="badge-tag mute">{r.trackingStatus}</span> : <span className="badge-tag gate">Pending</span>}</td>
                    <td>{r.planningVerified ? "Yes" : "No"}</td>
                    <td>{r.projectAcknowledged ? "Yes" : "No"}</td>
                    <td>{r.remarks || "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" title="View" onClick={() => setDetail(r)}>👁</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <SidePanel open={createOpen} icon="🖊️" title="Request a Drawing" desc="Ask Planning/Design for a drawing you need on site" onClose={() => setCreateOpen(false)}>
        <DrawingRequestForm isPublic={false} onDone={() => setCreateOpen(false)} />
      </SidePanel>

      <DrawingRequestDetailModal dr={liveDetail} onClose={() => setDetail(null)} />
    </div>
  );
}
