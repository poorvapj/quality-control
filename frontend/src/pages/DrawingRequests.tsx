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

// Tailwind's default palette values, used verbatim so these badges match the
// reference app's ui/Badge.tsx COLOR_CLASSES exactly (bg-{color}-50 / text-{color}-600).
const TONE = {
  gray: { bg: "#F3F4F6", text: "#4B5563" },
  amber: { bg: "#FFFBEB", text: "#D97706" },
  green: { bg: "#ECFDF5", text: "#059669" },
  red: { bg: "#FEF2F2", text: "#DC2626" },
  blue: { bg: "#EFF6FF", text: "#2563EB" }
};

export default function DrawingRequestsPage() {
  const { data, myRole, currentUserId, apply, toast } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
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
  // DRI isn't a reviewer here (see shared/permissions.ts — only Admin +
  // explicitly-granted reviewers act on stages), so the board itself should
  // only surface the tickets they personally raised, not everyone's.
  if (!isAdmin && myRole() === "DRI") rows = rows.filter((r) => r.submittedByUserId === currentUserId);
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

  // Matches ui/Filters.tsx's SelectFilter/SearchFilter: h-10 (40px), text-sm (14px),
  // rounded-lg (8px), border-gray-200 (#E5E7EB).
  const filterInput: React.CSSProperties = {
    height: 40, boxSizing: "border-box", fontSize: 14, border: "1px solid #E5E7EB", borderRadius: 8,
    color: "#6B7280", background: "#fff", outline: "none"
  };
  const selectStyle: React.CSSProperties = { ...filterInput, padding: "0 12px", cursor: "pointer" };
  // Matches ui/DatePicker.tsx's DateRangePicker: h-9 (36px), text-[13px], pl-8/pr-2.5.
  const dateInput: React.CSSProperties = {
    height: 36, boxSizing: "border-box", fontSize: 13, border: "1px solid #E5E7EB", borderRadius: 8,
    color: "#1A1A2E", background: "#fff", outline: "none"
  };

  return (
    <div>
      {/* Matches ui/PageHeader.tsx exactly: w-10 h-10 (40px) rounded-xl (12px)
          bg-primary/10, icon w-5 h-5 (20px) text-primary; title text-xl (20px)
          font-bold #1A1A2E; subtitle text-sm (14px) text-gray-500; gap-3 (12px);
          mb-6 (24px). */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,122,0,0.1)", color: "#FF7A00", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <NavIcon name="drawing" size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1A1A2E", lineHeight: 1.3 }}>Drawing Requests</div>
            <div style={{ fontSize: 14, fontWeight: 400, color: "#6B7280", lineHeight: 1.4 }}>Manage drawing requests — {rows.length} total</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Matches ui/Btn.tsx's outline variant: border-gray-200, bg-white, text-gray-700, h-10, px-6, text-[13px], rounded-md (6px), font-bold. */}
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              height: 40, padding: "0 24px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff",
              fontSize: 13, fontWeight: 700, color: "#374151", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer"
            }}
          >
            <NavIcon name="drawing" size={16} /> Drawing Request
          </button>
        </div>
      </div>

      {/* Matches ui/Filters.tsx's FilterRow: flex flex-wrap items-end gap-3 (12px) mb-4 (16px). */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12, columnGap: 12, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex" }}>
            <NavIcon name="search" size={16} />
          </span>
          <input
            style={{ ...filterInput, width: "100%", padding: "0 12px 0 36px" }}
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
          <select style={{ ...selectStyle, width: 168, appearance: "none", paddingRight: 26 }} value={dTracking} onChange={(e) => setDTracking(e.target.value)}>
            <option value="">All Review Stages</option>
            <option value="pending">Pending</option><option value="committed">Committed</option><option value="completed">Completed</option><option value="delayed">Delayed</option>
          </select>
          <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", pointerEvents: "none", display: "flex" }}><NavIcon name="chevronDown" size={14} /></span>
        </span>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <span style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex", pointerEvents: "none" }}>
              <NavIcon name="calendar" size={16} />
            </span>
            {!dFrom && <span style={{ position: "absolute", left: 32, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 13, pointerEvents: "none" }}>From</span>}
            <input
              className="date-compact"
              type="date"
              style={{ ...dateInput, width: 116, padding: "0 10px 0 32px", color: dFrom ? "#1A1A2E" : "transparent" }}
              value={dFrom}
              onChange={(e) => setDFrom(e.target.value)}
            />
          </span>
          <span style={{ color: "#9CA3AF", fontSize: 14, margin: "0 8px" }}>to</span>
          <span style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", display: "flex", pointerEvents: "none" }}>
              <NavIcon name="calendar" size={16} />
            </span>
            {!dTo && <span style={{ position: "absolute", left: 32, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 13, pointerEvents: "none" }}>To</span>}
            <input
              className="date-compact"
              type="date"
              style={{ ...dateInput, width: 116, padding: "0 10px 0 32px", color: dTo ? "#1A1A2E" : "transparent" }}
              value={dTo}
              onChange={(e) => setDTo(e.target.value)}
            />
          </span>
        </div>
        {/* Matches ui/Btn.tsx's "purple" color: bg #8B5CF6, hover #7C3AED, text white, h-10, px-6, text-[13px], rounded-md (6px), font-bold. */}
        <button
          onClick={runSearch}
          style={{
            height: 40, padding: "0 24px", background: "#8B5CF6", borderRadius: 6, border: "none",
            fontSize: 13, fontWeight: 700, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6,
            cursor: "pointer", flexShrink: 0
          }}
        >
          <NavIcon name="eye" size={16} /> Search
        </button>
      </div>

      {/* Matches ui/Table.tsx exactly: rounded-lg (8px) border-gray-200 wrapper,
          text-sm (14px) table, bg-gray-50 thead, px-4 py-3 (16/12) cells,
          text-[11px] font-bold uppercase tracking-wider text-gray-500 headers,
          divide-y divide-gray-100 rows, hover:bg-gray-50. */}
      <div style={{ width: "100%", overflowX: "auto", borderRadius: 8, border: "1px solid #E5E7EB" }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 0", color: "#9CA3AF", fontSize: 14 }}>No drawing requests match these filters</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 620 }}>
            <thead style={{ background: "#F9FAFB" }}>
              <tr>
                {["Ticket No", "Project", "Description", "Type", "Source", "Requested by", "Request date", "Review", "Priority", "Status", "Plan verified", "Proj. ack.", "Remarks", "Action"].map((h) => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6B7280", padding: "12px 16px", whiteSpace: "nowrap", textAlign: "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const priorityVal = r.priority || r.requestedPriority;
                const priorityTone = priorityVal === "urgent" || priorityVal === "high" ? TONE.red : priorityVal === "medium" ? TONE.amber : TONE.gray;
                const trackingVal = r.trackingStatus || "pending";
                const trackingTone = trackingVal === "completed" ? TONE.green : trackingVal === "delayed" ? TONE.red : trackingVal === "committed" ? TONE.blue : TONE.amber;
                const reviewTone = r.reviewStatus === "approved" ? TONE.green : r.reviewStatus === "returned" ? TONE.red : TONE.amber;
                // Matches ui/Table.tsx's Td: px-4 py-3 (16/12) align-middle.
                const td: React.CSSProperties = { padding: "12px 16px", borderTop: i === 0 ? "none" : "1px solid #F3F4F6", verticalAlign: "middle", color: "#1A1A2E" };
                const ellipsis = (max: number): React.CSSProperties => ({ ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: max });
                // Matches ui/Badge.tsx's `small` variant: px-1.5 py-0.5 (6/2), text-[10px], rounded-full, font-bold uppercase tracking-wide.
                const badge = (tone: { bg: string; text: string }): React.CSSProperties => ({
                  display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 999,
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.025em",
                  background: tone.bg, color: tone.text, whiteSpace: "nowrap"
                });
                // Status is shown as plain colored text rather than a pill, matching the reference table.
                const statusText: React.CSSProperties = {
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.025em",
                  color: trackingTone.text
                };
                return (
                  <tr
                    key={r.id}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#F9FAFB"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    style={{ transition: "background-color .15s ease" }}
                  >
                    {/* Matches "font-mono font-bold text-purple-600" on the ticket number. */}
                    <td style={td}><strong style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, color: "#9333EA" }}>{r.ticketNo}</strong></td>
                    <td style={ellipsis(160)} title={r.projectName}><strong style={{ fontWeight: 600, color: "#1A1A2E" }}>{r.projectName}</strong></td>
                    <td style={ellipsis(180)} title={r.description}>{r.description}</td>
                    <td style={td}>{r.drawingType}</td>
                    <td style={td}>{r.source || <span style={{ color: "#D1D5DB" }}>—</span>}</td>
                    <td style={td}>{r.requesterName}</td>
                    <td style={td}>{r.createdAt ? fmtDate(r.createdAt) : "—"}</td>
                    <td style={td}><span style={{ ...badge(reviewTone), whiteSpace: "normal", textAlign: "center", maxWidth: 100 }}>{STAGE_LABEL[r.reviewStatus]}</span></td>
                    <td style={td}>{priorityVal ? <span style={badge(priorityTone)}>{priorityVal}</span> : <span style={{ color: "#D1D5DB" }}>—</span>}</td>
                    <td style={td}><span style={statusText}>{trackingVal}</span></td>
                    <td style={td}><span style={{ color: r.planningVerified ? "#059669" : "#9CA3AF", fontWeight: r.planningVerified ? 600 : 400 }}>{r.planningVerified ? "Yes" : "No"}</span></td>
                    <td style={td}><span style={{ color: r.projectAcknowledged ? "#059669" : "#9CA3AF", fontWeight: r.projectAcknowledged ? 600 : 400 }}>{r.projectAcknowledged ? "Yes" : "No"}</span></td>
                    <td style={ellipsis(140)} title={r.remarks}>{r.remarks || <span style={{ color: "#D1D5DB" }}>—</span>}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {/* Matches ui/Btn.tsx's `small outline`: h-8 (32px) px-3 (12px) text-[11px] rounded-md (6px) border-gray-200 bg-white text-gray-700. */}
                        <button
                          title="View" onClick={() => setDetail(r)}
                          style={{ height: 32, padding: "0 12px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", color: "#374151", display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                        >
                          <NavIcon name="eye" size={14} />
                        </button>
                        {editable && (
                          <>
                            <button
                              title="Edit" onClick={() => setEditing(r)}
                              style={{ height: 32, padding: "0 12px", border: "1px solid #E5E7EB", borderRadius: 6, background: "#fff", color: "#374151", display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                            >
                              <NavIcon name="edit" size={14} />
                            </button>
                            {/* Matches ui/Btn.tsx's `small color="red"`: bg #EF4444, hover #DC2626, text white. */}
                            <button
                              title="Delete" onClick={() => deleteRequest(r)}
                              style={{ height: 32, padding: "0 12px", border: "none", borderRadius: 6, background: "#EF4444", color: "#fff", display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                            >
                              <NavIcon name="trash" size={14} />
                            </button>
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
