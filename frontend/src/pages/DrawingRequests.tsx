import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll } from "../shared/rules";
import { fmtDate } from "../shared/helpers";
import SidePanel from "../components/SidePanel";
import DrawingRequestForm from "../components/DrawingRequestForm";
import DrawingRequestDetailModal from "../components/DrawingRequestDetailModal";
import NavIcon from "../components/NavIcon";
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
  const { data, myRole, apply, toast } = useApp();
  const editable = myRole() === "DRI";
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<DrawingRequest | null>(null);
  const [editing, setEditing] = useState<DrawingRequest | null>(null);
  // Draft filter state (what the user is currently typing/selecting) is
  // kept separate from applied state (what actually filters `rows` below) —
  // the Search button commits draft → applied, matching the reference
  // app's explicit-search toolbar instead of filtering on every keystroke.
  const [dSearch, setDSearch] = useState("");
  const [dType, setDType] = useState("");
  const [dPriority, setDPriority] = useState("");
  const [dStatus, setDStatus] = useState("");
  const [dTracking, setDTracking] = useState("");
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");

  const [search, setSearch] = useState("");
  const [fType, setFType] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fTracking, setFTracking] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");

  function runSearch() {
    setSearch(dSearch); setFType(dType); setFPriority(dPriority);
    setFStatus(dStatus); setFTracking(dTracking);
    setFFrom(dFrom); setFTo(dTo);
  }

  let rows = coll(data, "drawingRequests").slice();
  if (fStatus) rows = rows.filter((r) => r.reviewStatus === fStatus);
  if (fTracking) rows = rows.filter((r) => r.trackingStatus === fTracking);
  if (fPriority) rows = rows.filter((r) => r.priority === fPriority);
  if (fType) rows = rows.filter((r) => r.drawingType === fType);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    rows = rows.filter((r) =>
      r.projectName?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q) ||
      r.ticketNo?.toLowerCase().includes(q) ||
      r.requesterName?.toLowerCase().includes(q)
    );
  }
  if (fFrom) { const t = new Date(fFrom).getTime(); rows = rows.filter((r) => (r.createdAt || 0) >= t); }
  if (fTo) { const t = new Date(fTo).getTime() + 86400000; rows = rows.filter((r) => (r.createdAt || 0) < t); }
  rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  // Keep the open detail view's data fresh as the board updates.
  const liveDetail = detail ? coll(data, "drawingRequests").find((r) => r.id === detail.id) || null : null;

  async function deleteRequest(r: DrawingRequest) {
    if (!confirm(`Delete drawing request ${r.ticketNo}?\n\nThis removes it for everyone on the board.`)) return;
    await apply([{ op: "delete", coll: "drawingRequests", id: r.id }]);
    toast("Deleted " + r.ticketNo);
  }

  const inputBase: React.CSSProperties = {
    height: 36, boxSizing: "border-box", fontSize: 13, border: "1px solid #E5E7EB", borderRadius: 8,
    color: "#374151", background: "#fff", outline: "none"
  };
  const selectStyle: React.CSSProperties = { ...inputBase, padding: "8px 10px", fontWeight: 500, cursor: "pointer" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#FFF1E0", color: "#F97316", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <NavIcon name="drawing" size={18} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", lineHeight: 1.3, marginBottom: 2 }}>Drawing Requests</div>
            <div style={{ fontSize: 13, fontWeight: 400, color: "#6B7280", lineHeight: 1.4 }}>Manage drawing requests — {rows.length} total</div>
          </div>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            height: 36, padding: "8px 14px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff",
            fontSize: 13, fontWeight: 600, color: "#111827", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0
          }}
        >
          <NavIcon name="drawing" size={14} /> Drawing Request
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, flexWrap: "nowrap", overflowX: "auto" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex" }}>
              <NavIcon name="search" size={14} />
            </span>
            <input
              style={{ ...inputBase, width: "100%", padding: "8px 10px 8px 32px" }}
              placeholder="Search project…"
              value={dSearch}
              onChange={(e) => setDSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            />
          </div>
          <span style={{ position: "relative", flexShrink: 0 }}>
            <select style={{ ...selectStyle, width: 110, appearance: "none", paddingRight: 26 }} value={dType} onChange={(e) => setDType(e.target.value)}>
              <option value="">All Types</option>
              {["Architectural", "Structural", "MEP", "Civil", "Interior", "Landscape", "Shop Drawing", "As-Built", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", pointerEvents: "none", display: "flex" }}><NavIcon name="chevronDown" size={14} /></span>
          </span>
          <span style={{ position: "relative", flexShrink: 0 }}>
            <select style={{ ...selectStyle, width: 120, appearance: "none", paddingRight: 26 }} value={dPriority} onChange={(e) => setDPriority(e.target.value)}>
              <option value="">All Priorities</option>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", pointerEvents: "none", display: "flex" }}><NavIcon name="chevronDown" size={14} /></span>
          </span>
          <span style={{ position: "relative", flexShrink: 0 }}>
            <select style={{ ...selectStyle, width: 115, appearance: "none", paddingRight: 26 }} value={dStatus} onChange={(e) => setDStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", pointerEvents: "none", display: "flex" }}><NavIcon name="chevronDown" size={14} /></span>
          </span>
          <span style={{ position: "relative", flexShrink: 0 }}>
            <select style={{ ...selectStyle, width: 140, appearance: "none", paddingRight: 26 }} value={dTracking} onChange={(e) => setDTracking(e.target.value)}>
              <option value="">All Review Stages</option>
              <option value="pending">Pending</option><option value="committed">Committed</option><option value="completed">Completed</option><option value="delayed">Delayed</option>
            </select>
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", pointerEvents: "none", display: "flex" }}><NavIcon name="chevronDown" size={14} /></span>
          </span>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <span style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex", pointerEvents: "none" }}>
                <NavIcon name="calendar" size={13} />
              </span>
              {!dFrom && <span style={{ position: "absolute", left: 27, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 13, pointerEvents: "none" }}>From</span>}
              <input
                className="date-compact"
                type="date"
                style={{ ...inputBase, width: 110, padding: "8px 10px 8px 28px", color: dFrom ? "#111827" : "transparent" }}
                value={dFrom}
                onChange={(e) => setDFrom(e.target.value)}
              />
            </span>
            <span style={{ color: "#9CA3AF", fontSize: 13, margin: "0 8px" }}>to</span>
            <span style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex", pointerEvents: "none" }}>
                <NavIcon name="calendar" size={13} />
              </span>
              {!dTo && <span style={{ position: "absolute", left: 27, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 13, pointerEvents: "none" }}>To</span>}
              <input
                className="date-compact"
                type="date"
                style={{ ...inputBase, width: 110, padding: "8px 10px 8px 28px", color: dTo ? "#111827" : "transparent" }}
                value={dTo}
                onChange={(e) => setDTo(e.target.value)}
              />
            </span>
          </div>
          <button
            onClick={runSearch}
            style={{
              height: 36, padding: "8px 16px", background: "#6366F1", borderRadius: 8, border: "none",
              fontSize: 13, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: 6,
              cursor: "pointer", flexShrink: 0, minWidth: 90, justifyContent: "center"
            }}
          >
            <NavIcon name="search" size={14} /> Search
          </button>
        </div>

        <div className="table-scroll">
          {rows.length === 0 ? (
            <div className="empty">No drawing requests yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr>
                  {["Ticket No", "Project", "Description", "Type", "Source", "Requested by", "Request date", "Review", "Priority", "Status", "Plan verified", "Proj. ack.", "Remarks", "Action"].map((h) => (
                    <th key={h} style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6B7280", padding: "12px 16px", borderBottom: "1px solid #E5E7EB", background: "transparent", whiteSpace: "nowrap", textAlign: "left" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const priorityVal = r.priority || r.requestedPriority;
                  const priorityColor = priorityVal === "urgent" || priorityVal === "high" ? "#DC2626" : priorityVal === "medium" ? "#D97706" : "#6B7280";
                  const trackingVal = r.trackingStatus || "pending";
                  const trackingColor = trackingVal === "completed" ? "#16A34A" : trackingVal === "delayed" ? "#DC2626" : trackingVal === "committed" ? "#2563EB" : "#EA8C00";
                  const td: React.CSSProperties = { padding: "16px", borderBottom: "1px solid #F3F4F6", fontSize: 13, fontWeight: 400, color: "#111827", verticalAlign: "middle" };
                  const ellipsis: React.CSSProperties = { ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 };
                  return (
                    <tr key={r.id}>
                      <td style={td}><strong style={{ fontSize: 13, fontWeight: 600, color: "#6366F1" }}>{r.ticketNo}</strong></td>
                      <td style={ellipsis} title={r.projectName}>{r.projectName}</td>
                      <td style={ellipsis} title={r.description}>{r.description}</td>
                      <td style={td}>{r.drawingType}</td>
                      <td style={td}>{r.source || "—"}</td>
                      <td style={td}>{r.requesterName}</td>
                      <td style={td}>{r.createdAt ? fmtDate(r.createdAt) : "—"}</td>
                      <td style={td}>
                        <span style={{ padding: "4px 10px", borderRadius: 6, background: "#FFF3D6", fontSize: 11, fontWeight: 700, color: "#C2650A", whiteSpace: "nowrap" }}>
                          {STAGE_LABEL[r.reviewStatus]}
                        </span>
                      </td>
                      <td style={td}>{priorityVal ? <strong style={{ color: priorityColor, textTransform: "uppercase", fontSize: 12, fontWeight: 700 }}>{priorityVal}</strong> : "—"}</td>
                      <td style={td}><strong style={{ color: trackingColor, textTransform: "uppercase", fontSize: 12, fontWeight: 700 }}>{trackingVal}</strong></td>
                      <td style={td}>{r.planningVerified ? "Yes" : "No"}</td>
                      <td style={td}>{r.projectAcknowledged ? "Yes" : "No"}</td>
                      <td style={td}>{r.remarks || "—"}</td>
                    <td style={td}>
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" title="View" onClick={() => setDetail(r)}><NavIcon name="eye" size={13} /></button>
                        {editable && (
                          <>
                            <button className="btn btn-secondary btn-sm" title="Edit" onClick={() => setEditing(r)}><NavIcon name="edit" size={13} /></button>
                            <button className="btn btn-danger btn-sm solid" title="Delete" onClick={() => deleteRequest(r)}><NavIcon name="trash" size={13} /></button>
                          </>
                        )}
                      </div>
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <SidePanel open={createOpen} icon={<NavIcon name="drawing" size={17} />} title="Request a Drawing" desc="Ask Planning/Design for a drawing you need on site" onClose={() => setCreateOpen(false)}>
        <DrawingRequestForm isPublic={false} onDone={() => setCreateOpen(false)} />
      </SidePanel>

      <SidePanel open={!!editing} icon={<NavIcon name="edit" size={17} />} title="Edit Drawing Request" desc="Update the ticket details — the review stage and history are unaffected" onClose={() => setEditing(null)}>
        {editing && <DrawingRequestForm isPublic={false} editRecord={editing} onDone={() => setEditing(null)} />}
      </SidePanel>

      <DrawingRequestDetailModal dr={liveDetail} onClose={() => setDetail(null)} />
    </div>
  );
}
