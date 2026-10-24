import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { buildEventOp } from "../shared/eventLog";
import { canDecide, decideOp, describeRecord, effectiveApproval, KIND_LABEL, pendingFor, rejectedFor, type ApprovalColl } from "../shared/approval";
import type { Approval } from "../types";
import Badge from "../ui/tw/Badge";
import Btn from "../ui/tw/Btn";
import Card from "../ui/tw/Card";
import NavIcon from "./NavIcon";
import SidePanel from "./SidePanel";
import { coll } from "../shared/rules";

/** Where a record stands: Pending approval / Approved / Rejected (with the leader's remark). */
export function ApprovalBadge({ approval }: { approval?: Approval }) {
  if (!approval) return null;
  if (approval.status === "pending") {
    return (
      <div title={`Waiting for ${approval.approverName || "the team leader"}`}>
        <Badge color="amber"><span className="whitespace-nowrap">Pending approval</span></Badge>
        {approval.approverName && <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5 whitespace-nowrap">with {approval.approverName}</div>}
      </div>
    );
  }
  if (approval.status === "approved") {
    return <div title={approval.approverName ? `Approved by ${approval.approverName}` : undefined}><Badge color="green"><span className="whitespace-nowrap">Approved</span></Badge></div>;
  }
  return (
    <div>
      <Badge color="red"><span className="whitespace-nowrap">Rejected</span></Badge>
      {approval.remark && <div className="text-[10.5px] text-[var(--text-muted)] mt-1 max-w-[220px] whitespace-normal">{approval.remark}</div>}
    </div>
  );
}

/** Approve / Reject buttons — render nothing unless the signed-in person may decide this record. */
export function ApprovalActions({ collName, record }: { collName: ApprovalColl; record: any }) {
  const { data, apply, toast, currentUserId } = useApp();
  const [rejecting, setRejecting] = useState(false);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  if (!canDecide(data, currentUserId, record)) return null;

  async function decide(status: "approved" | "rejected") {
    if (status === "rejected" && !remark.trim()) { toast("Add a remark so they know what to redo"); return; }
    setBusy(true);
    try {
      await apply([
        decideOp(collName, record, status, remark, effectiveApproval(data, record)),
        buildEventOp(currentUserId, status === "approved" ? "APPROVAL_APPROVE" : "APPROVAL_REJECT", record.id, "", `${KIND_LABEL[collName]} · ${describeRecord(collName, record)}`)
      ]);
      toast(status === "approved" ? "Approved" : "Sent back for redo");
      setRejecting(false); setRemark("");
    } finally { setBusy(false); }
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5 mt-1.5 min-w-[200px]">
        <textarea className="textarea" rows={2} placeholder="What should be redone?" value={remark} onChange={(e) => setRemark(e.target.value)} />
        <div className="flex gap-1.5">
          <Btn label={busy ? "Sending…" : "Send back"} color="primary" size="sm" onClick={() => decide("rejected")} disabled={busy} />
          <Btn label="Cancel" color="secondary" size="sm" onClick={() => { setRejecting(false); setRemark(""); }} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 mt-1.5">
      <Btn label={busy ? "Approving…" : "Approve"} color="primary" size="sm" onClick={() => decide("approved")} disabled={busy} />
      <Btn label="Reject" color="secondary" size="sm" onClick={() => setRejecting(true)} disabled={busy} />
    </div>
  );
}

const FIELD_LABEL = "text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-0.5";

function Detail({ label, children }: { label: string; children?: React.ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return <div className="mb-3"><div className={FIELD_LABEL}>{label}</div><div className="text-[13px] leading-snug">{children}</div></div>;
}

function Photos({ photos }: { photos?: { url: string }[] }) {
  if (!photos || photos.length === 0) return null;
  return (
    <Detail label={`Photos (${photos.length})`}>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <img key={i} src={p.url} alt="" onClick={() => window.open(p.url, "_blank")}
            className="w-16 h-16 object-cover rounded-radius-sm border border-[var(--border)] cursor-pointer" />
        ))}
      </div>
    </Detail>
  );
}

const STATUS_COLOR: Record<string, string> = { OK: "#16a34a", "Not OK": "#dc2626", "N/A": "var(--text-muted)" };

/** The whole record, laid out so a leader can judge it before deciding. */
function RecordDetails({ collName, rec }: { collName: ApprovalColl; rec: any }) {
  if (collName === "qualityInspections") {
    const color = rec.result === "Pass" ? "#16a34a" : rec.result === "Fail" ? "#dc2626" : "#d97706";
    return (
      <>
        <Detail label="Project">{rec.projectCode} — {rec.projectName}</Detail>
        <Detail label="Location">{rec.floorName}{rec.unitName ? ` / ${rec.unitName}` : " (whole floor)"}</Detail>
        <Detail label="Checklist">{rec.workType}</Detail>
        <Detail label="Result"><b style={{ color }}>{rec.result}</b></Detail>
        <Detail label="Inspected by">{rec.inspectorName} · {rec.inspectionDate}</Detail>
        <Detail label="Contractor">{rec.contractor}</Detail>
        <Detail label="Columns">{rec.columns?.length ? rec.columns.join(", ") : ""}</Detail>
        <Detail label="Slabs">{rec.slabs?.length ? rec.slabs.join(", ") : ""}</Detail>
        <Detail label="Areas">{rec.areas?.length ? rec.areas.join(", ") : ""}</Detail>
        <Detail label="VMS item">{rec.itemDescription ? `${rec.workOrderNo || ""} · ${rec.itemDescription}` : ""}</Detail>
        {rec.checklistItems?.length > 0 && (
          <Detail label="Checklist points">
            <div className="border border-[var(--border)] rounded-radius-sm">
              {rec.checklistItems.map((c: any, i: number) => (
                <div key={i} className="px-2.5 py-2 border-b border-[var(--border)] last:border-b-0 text-[12.5px]">
                  <div className="flex gap-2 justify-between">
                    <span>{c.text}</span>
                    <b className="shrink-0 whitespace-nowrap" style={{ color: STATUS_COLOR[c.status] }}>{c.status}</b>
                  </div>
                  {c.remarks && <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{c.remarks}</div>}
                </div>
              ))}
            </div>
          </Detail>
        )}
        <Detail label="Remarks">{rec.remarks}</Detail>
        <Photos photos={rec.photos} />
        {rec.correctiveAction && <Detail label="Corrective action">{rec.correctiveAction.assignedToName} · due {rec.correctiveAction.targetDate}</Detail>}
        <Detail label="Snag raised">{rec.linkedSnagId}</Detail>
      </>
    );
  }
  if (collName === "materialMeasurements") {
    return (
      <>
        <Detail label="Project">{rec.projectCode} — {rec.projectName}</Detail>
        <Detail label="Location">{rec.floorName} / {rec.unitName}</Detail>
        <Detail label="Recorded by">{rec.recordedByName} · {rec.measurementDate}</Detail>
        <Detail label="VMS item">{rec.itemDescription ? `${rec.workOrderNo || ""} · ${rec.itemDescription}${rec.itemIsCustom ? " (typed in, not in VMS)" : ""}` : ""}</Detail>
        <Detail label="Measured">{rec.measuredQty} {rec.measuredUnit}</Detail>
        <Detail label="Material consumed">{rec.materialConsumedQty} {rec.materialUnit}</Detail>
        <Detail label="Unused balance / wastage">{rec.unusedBalanceQty} / {rec.wastageQty} {rec.materialUnit}</Detail>
        <Detail label="Remarks">{rec.remarks}</Detail>
      </>
    );
  }
  const loc = rec.location || {};
  const where = [loc.tower && `Tower ${loc.tower}`, loc.floor && `Floor ${loc.floor}`, loc.flat && `Flat ${loc.flat}`, loc.area].filter(Boolean).join(" · ");
  const d = rec.dimensions || {};
  const dims = ([["L", d.length], ["W", d.width], ["H", d.height], ["T", d.thickness]] as const).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(" × ");
  return (
    <>
      <Detail label="Project">{rec.projectCode} — {rec.projectName}</Detail>
      <Detail label="Location">{where}</Detail>
      <Detail label="Work category">{rec.category}</Detail>
      <Detail label="Recorded by">{rec.recordedByName} · {rec.measurementDate}</Detail>
      <Detail label="Measured">{rec.measuredQty} {rec.measuredUnit}</Detail>
      <Detail label="Dimensions">{dims}</Detail>
      <Detail label="VMS item">{rec.linkedItemDescription ? `${rec.linkedWorkOrderNo || ""} · ${rec.linkedItemDescription}` : ""}</Detail>
      <Detail label="Remarks">{rec.remarks}</Detail>
      <Photos photos={rec.photos} />
    </>
  );
}

/** Opens from a queue row: the full record, then (for the person who may decide it) Approve / Reject. */
export function ApprovalReviewPanel({ item, onClose, closeWhenDecided }: {
  item: { coll: ApprovalColl; rec: any } | null; onClose: () => void; closeWhenDecided?: boolean;
}) {
  const { data, currentUserId } = useApp();
  const live = item ? ((coll(data, item.coll) as any[]).find((r) => r.id === item.rec.id) || item.rec) : null;
  const decidable = !!item && canDecide(data, currentUserId, live);
  // once the decision is saved there is nothing left to do here
  useEffect(() => { if (closeWhenDecided && item && !decidable) onClose(); }, [closeWhenDecided, item?.rec.id, decidable]); // eslint-disable-line react-hooks/exhaustive-deps
  const approval = live ? effectiveApproval(data, live) : undefined;
  return (
    <SidePanel
      open={!!item}
      wide
      icon={<NavIcon name="award" size={18} />}
      title={item ? `${KIND_LABEL[item.coll]} · ${describeRecord(item.coll, live)}` : ""}
      desc={live ? `by ${live.inspectorName || live.recordedByName || "—"} · ${live.inspectionDate || live.measurementDate || ""}` : ""}
      onClose={onClose}
    >
      {item && live && (
        <>
          <div className="mb-4"><ApprovalBadge approval={approval} /></div>
          <RecordDetails collName={item.coll} rec={live} />
          {decidable && (
            <div className="mt-2 pt-3 border-t border-[var(--border)]">
              <div className={FIELD_LABEL}>Your decision</div>
              <ApprovalActions collName={item.coll} record={live} />
            </div>
          )}
        </>
      )}
    </SidePanel>
  );
}

const sectionLabel = "text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5";

/** Dashboard section for a team leader: their team's inspections/measurements waiting on them. */
export function ApprovalQueue() {
  const { data, currentUserId } = useApp();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<{ coll: ApprovalColl; rec: any } | null>(null);
  const items = pendingFor(data, currentUserId);
  if (items.length === 0) return null;
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
        <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2"><NavIcon name="award" size={13} /> Awaiting My Approval <span className="text-[11px] font-medium normal-case text-[var(--text-muted)]">· {items.length}</span></div>
      </div>
      <Card padded={false} className="mb-6">
        {(showAll ? items : items.slice(0, 8)).map(({ coll: c, rec }) => (
          <div
            key={rec.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpen({ coll: c, rec })}
            onKeyDown={(e) => { if (e.key === "Enter") setOpen({ coll: c, rec }); }}
            className="py-3 px-4 border-b border-[var(--border)] last:border-b-0 cursor-pointer hover:bg-[var(--bg-card-hover)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-bold">{KIND_LABEL[c]} · {describeRecord(c, rec)}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  by {rec.inspectorName || rec.recordedByName || "—"}{rec.inspectionDate || rec.measurementDate ? ` · ${rec.inspectionDate || rec.measurementDate}` : ""}
                </div>
              </div>
              <span className="text-[11px] font-semibold text-[var(--theme-primary)] whitespace-nowrap shrink-0">View details ›</span>
            </div>
            <div onClick={(e) => e.stopPropagation()}><ApprovalActions collName={c} record={rec} /></div>
          </div>
        ))}
        {items.length > 8 && (
          <button type="button" className="py-2 px-4 text-[11.5px] font-semibold text-[var(--theme-primary)]" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </Card>
      <ApprovalReviewPanel item={open} onClose={() => setOpen(null)} closeWhenDecided />
    </>
  );
}

/** Dashboard section for a team member: their work the leader sent back. */
export function SentBackList() {
  const { data, currentUserId } = useApp();
  const [open, setOpen] = useState<{ coll: ApprovalColl; rec: any } | null>(null);
  const items = rejectedFor(data, currentUserId);
  if (items.length === 0) return null;
  return (
    <>
      <div className={sectionLabel}><NavIcon name="bug" size={13} /> Sent Back To Redo <span className="text-[11px] font-medium normal-case text-[var(--text-muted)]">· {items.length}</span></div>
      <Card padded={false} className="mb-6">
        {items.slice(0, 6).map(({ coll: c, rec }) => (
          <div
            key={rec.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpen({ coll: c, rec })}
            onKeyDown={(e) => { if (e.key === "Enter") setOpen({ coll: c, rec }); }}
            className="py-3 px-4 border-b border-[var(--border)] last:border-b-0 cursor-pointer hover:bg-[var(--bg-card-hover)]"
          >
            <div className="text-[13px] font-bold">{KIND_LABEL[c]} · {describeRecord(c, rec)}</div>
            <div className="text-[11.5px] mt-1" style={{ color: "var(--color-fail)" }}>
              {rec.approval?.approverName || "Team leader"}: {rec.approval?.remark || "no remark"}
            </div>
            <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Record a new one to replace it. · View details ›</div>
          </div>
        ))}
      </Card>
      <ApprovalReviewPanel item={open} onClose={() => setOpen(null)} />
    </>
  );
}
