import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { buildEventOp } from "../shared/eventLog";
import { canDecide, decideOp, describeRecord, effectiveApproval, KIND_LABEL, pendingFor, rejectedFor, type ApprovalColl } from "../shared/approval";
import type { Approval } from "../types";
import Badge from "../ui/tw/Badge";
import Btn from "../ui/tw/Btn";
import Card from "../ui/tw/Card";
import NavIcon from "./NavIcon";

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
          <Btn label="Send back" color="primary" size="sm" onClick={() => decide("rejected")} disabled={busy} />
          <Btn label="Cancel" color="secondary" size="sm" onClick={() => { setRejecting(false); setRemark(""); }} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 mt-1.5">
      <Btn label="Approve" color="primary" size="sm" onClick={() => decide("approved")} disabled={busy} />
      <Btn label="Reject" color="secondary" size="sm" onClick={() => setRejecting(true)} disabled={busy} />
    </div>
  );
}

const sectionLabel = "text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5";

/** Dashboard section for a team leader: their team's inspections/measurements waiting on them. */
export function ApprovalQueue() {
  const { data, currentUserId } = useApp();
  const [showAll, setShowAll] = useState(false);
  const items = pendingFor(data, currentUserId);
  if (items.length === 0) return null;
  return (
    <>
      <div className={sectionLabel}><NavIcon name="award" size={13} /> Awaiting My Approval <span className="text-[11px] font-medium normal-case text-[var(--text-muted)]">· {items.length}</span></div>
      <Card padded={false} className="mb-6">
        {(showAll ? items : items.slice(0, 8)).map(({ coll: c, rec }) => (
          <div key={rec.id} className="py-3 px-4 border-b border-[var(--border)] last:border-b-0">
            <div className="text-[13px] font-bold">{KIND_LABEL[c]} · {describeRecord(c, rec)}</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              by {rec.inspectorName || rec.recordedByName || "—"}{rec.inspectionDate || rec.measurementDate ? ` · ${rec.inspectionDate || rec.measurementDate}` : ""}
            </div>
            <ApprovalActions collName={c} record={rec} />
          </div>
        ))}
        {items.length > 8 && (
          <button type="button" className="py-2 px-4 text-[11.5px] font-semibold text-[var(--theme-primary)]" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </Card>
    </>
  );
}

/** Dashboard section for a team member: their work the leader sent back. */
export function SentBackList() {
  const { data, currentUserId } = useApp();
  const items = rejectedFor(data, currentUserId);
  if (items.length === 0) return null;
  return (
    <>
      <div className={sectionLabel}><NavIcon name="bug" size={13} /> Sent Back To Redo <span className="text-[11px] font-medium normal-case text-[var(--text-muted)]">· {items.length}</span></div>
      <Card padded={false} className="mb-6">
        {items.slice(0, 6).map(({ coll: c, rec }) => (
          <div key={rec.id} className="py-3 px-4 border-b border-[var(--border)] last:border-b-0">
            <div className="text-[13px] font-bold">{KIND_LABEL[c]} · {describeRecord(c, rec)}</div>
            <div className="text-[11.5px] mt-1" style={{ color: "var(--color-fail)" }}>
              {rec.approval?.approverName || "Team leader"}: {rec.approval?.remark || "no remark"}
            </div>
            <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Record a new one to replace it.</div>
          </div>
        ))}
      </Card>
    </>
  );
}
