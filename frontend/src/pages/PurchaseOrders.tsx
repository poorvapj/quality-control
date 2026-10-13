import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import SidePanel from "../components/SidePanel";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { PurchaseOrder } from "../types";

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const ITEMS_PREVIEW_COUNT = 2;
// IMS sometimes sends a full ISO timestamp ("2026-09-30T10:56:29.266Z")
// instead of a plain date for these fields — show just the date part so a
// long timestamp never overflows into the next column.
const fmtDate = (s?: string) => (s ? s.slice(0, 10) : "—");

function statusColor(status: string): "green" | "amber" | "gray" {
  if (status === "Approved" || status.toLowerCase().includes("fulfilled")) return "green";
  if (status.toLowerCase().includes("cancel") || status.toLowerCase().includes("reject")) return "gray";
  return "amber";
}

/* All Purchase Orders synced from IMS's PO_APPROVED webhook
   (backend/imsWebhook.js) — a flat, standalone list (Progress Analysis's
   project detail view shows the same records scoped to one project; this
   page is the full, unfiltered-by-default list across every project,
   including ones IMS referenced by a project name that didn't match any
   real QC project — surfaced here as "Unmatched" rather than hidden). Each
   row opens a side panel with the full item list — the table itself only
   previews the first couple of items so one PO with 20+ line items doesn't
   blow out every row's height. */
export default function PurchaseOrders() {
  const { data, currentUserId } = useApp();
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));

  const allPurchaseOrders = coll(data, "purchaseOrders")
    .filter((po) => !po.projectCode || allowedProjectCodes.has(po.projectCode))
    .sort((a, b) => b.receivedAt - a.receivedAt);

  const [fProjectCode, setFProjectCode] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);

  // Deleted (IMS Recycle Bin) POs are kept in storage (soft delete — never
  // actually removed, so a later restore event has the original data to
  // restore onto) but hidden from the default view, same as a real recycle
  // bin — visible only via the toggle.
  const purchaseOrders = showDeleted ? allPurchaseOrders : allPurchaseOrders.filter((po) => !po.deleted);
  const deletedCount = allPurchaseOrders.filter((po) => po.deleted).length;

  const statusOptions = useMemo(
    () => Array.from(new Set(purchaseOrders.map((po) => po.status).filter(Boolean))).sort(),
    [purchaseOrders]
  );
  const projectOptions = allProjects.map((p) => ({ value: p.code, label: `${p.code} — ${p.name}` }));

  const filtered = purchaseOrders.filter((po) => {
    if (fProjectCode && po.projectCode !== fProjectCode) return false;
    if (fStatus && po.status !== fStatus) return false;
    return true;
  });

  const unmatchedCount = purchaseOrders.filter((po) => !po.projectCode).length;
  const matchedCount = purchaseOrders.length - unmatchedCount;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="package" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Purchase Orders</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Synced from IMS's PO_APPROVED webhook — non-financial (no vendor GST/PAN/bank details or payment amounts are stored). Matched to a QC project by exact name. Click a row for full details.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Total Purchase Orders" value={purchaseOrders.length} icon="package" />
        <StatTile label="Matched to a Project" value={matchedCount} icon="trend" />
        <StatTile label="Unmatched" value={unmatchedCount} icon="bug" valueClassName={unmatchedCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Statuses Seen" value={statusOptions.length} icon="clock" />
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectCode} onChange={setFProjectCode} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
        <div className="max-w-[200px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Status</div>
          <SearchDropdown value={fStatus} onChange={setFStatus} options={[{ value: "", label: "All statuses" }, ...statusOptions.map((s) => ({ value: s, label: s }))]} neutralActive />
        </div>
        {deletedCount > 0 && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] cursor-pointer self-end pb-1.5">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            Show deleted ({deletedCount})
          </label>
        )}
      </Card>

      <Card padded={false} className="p-[18px]">
        <Table
          columns={["PO ID", "Project", "Vendor", "Status", "Items", "Order Date", "Delivery Date"]}
          colWidths={["11%", "17%", "14%", "12%", "26%", "10%", "10%"]}
          colAligns={["left", "left", "left", "left", "left", "left", "left"]}
          empty="No Purchase Orders received from IMS yet."
          maxHeight="640px"
        >
          {filtered.map((po) => (
            <TableRow key={po.id}>
              <TableCell strong className="whitespace-nowrap cursor-pointer" onClick={() => setSelected(po)}>
                {po.id}
                {po.deleted && <Badge color="gray"><span className="whitespace-nowrap ml-1">Deleted</span></Badge>}
              </TableCell>
              <TableCell className="whitespace-nowrap cursor-pointer" onClick={() => setSelected(po)}>
                {po.projectCode ? `${po.projectCode}` : (
                  <span title={`IMS sent project name "${po.projectNameRaw}" which didn't match any real QC project`}>
                    <Badge color="red"><span className="whitespace-nowrap">Unmatched</span></Badge>
                  </span>
                )}
                <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5 truncate max-w-[160px]">{po.projectNameRaw}</div>
              </TableCell>
              <TableCell muted className="truncate max-w-0 cursor-pointer" onClick={() => setSelected(po)}>{po.vendorName || "—"}</TableCell>
              <TableCell className="cursor-pointer" onClick={() => setSelected(po)}>
                <Badge color={statusColor(po.status)}><span className="whitespace-nowrap">{po.status}</span></Badge>
              </TableCell>
              <TableCell className="cursor-pointer" onClick={() => setSelected(po)}>
                <div className="flex flex-wrap gap-1 items-center">
                  {po.items.slice(0, ITEMS_PREVIEW_COUNT).map((it, idx) => (
                    <span key={idx} className="text-[11px] border border-[var(--border)] rounded-radius-sm px-1.5 py-0.5 whitespace-nowrap">
                      {it.itemName}: {qty(it.qty)} {it.unit}
                    </span>
                  ))}
                  {po.items.length > ITEMS_PREVIEW_COUNT && (
                    <span className="text-[11px] text-[var(--text-muted)] font-semibold whitespace-nowrap">+{po.items.length - ITEMS_PREVIEW_COUNT} more</span>
                  )}
                  {po.items.length === 0 && <span className="text-[var(--text-sub)]">—</span>}
                </div>
              </TableCell>
              <TableCell muted className="whitespace-nowrap cursor-pointer" onClick={() => setSelected(po)}>{fmtDate(po.date)}</TableCell>
              <TableCell muted className="whitespace-nowrap cursor-pointer" onClick={() => setSelected(po)}>{fmtDate(po.deliveryDate)}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>

      <PurchaseOrderDetail po={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function PurchaseOrderDetail({ po, onClose }: { po: PurchaseOrder | null; onClose: () => void }) {
  return (
    <SidePanel
      open={!!po}
      icon={<NavIcon name="package" size={18} />}
      title={po?.id || ""}
      desc={po ? (po.projectCode ? `${po.projectCode} — ${po.projectNameRaw}` : `Unmatched — "${po.projectNameRaw}"`) : ""}
      onClose={onClose}
      footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {po && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Status</div>
              <Badge color={statusColor(po.status)}>{po.status}</Badge>
            </div>
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Vendor</div>
              <div className="text-[13px] font-medium">{po.vendorName || "—"}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Order Date</div>
              <div className="text-[13px]">{fmtDate(po.date)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Delivery Date</div>
              <div className="text-[13px]">{fmtDate(po.deliveryDate)}</div>
            </div>
            {po.phase && (
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Phase</div>
                <div className="text-[13px]">{po.phase}</div>
              </div>
            )}
            {po.workType && (
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Work Type</div>
                <div className="text-[13px]">{po.workType}</div>
              </div>
            )}
            {po.milestone && (
              <div className="col-span-2">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Milestone</div>
                <div className="text-[13px]">{po.milestone}</div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Items ({po.items.length})</div>
            <div className="flex flex-col gap-1.5">
              {po.items.length === 0 && <div className="text-[13px] text-[var(--text-sub)]">No items recorded.</div>}
              {po.items.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-[12.5px] border border-[var(--border)] rounded-radius-sm px-2.5 py-2">
                  <div>
                    <div className="font-medium">{it.itemName}</div>
                    {(it.sku || it.category) && <div className="text-[10.5px] text-[var(--text-muted)]">{[it.sku, it.category].filter(Boolean).join(" · ")}</div>}
                  </div>
                  <div className="font-semibold whitespace-nowrap">{qty(it.qty)} {it.unit}</div>
                </div>
              ))}
            </div>
          </div>

          {po.approvals && (po.approvals.l1 || po.approvals.l2 || po.approvals.l3) && (
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Approvals</div>
              <div className="flex gap-2 flex-wrap">
                {(["l1", "l2", "l3"] as const).map((lvl) => po.approvals?.[lvl] && (
                  <div key={lvl} className="text-[11.5px] border border-[var(--border)] rounded-radius-sm px-2 py-1">
                    <span className="font-semibold uppercase">{lvl}</span>: {po.approvals[lvl]!.status}
                  </div>
                ))}
              </div>
            </div>
          )}

          {po.deleted && (
            <div className="text-[12px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
              This PO was deleted in IMS (moved to Recycle Bin or permanently removed). If it's restored in IMS, it will reappear here automatically.
            </div>
          )}

          {po.remark && (
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Remark</div>
              <div className="text-[13px]">{po.remark}</div>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}
