import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* All Purchase Orders synced from IMS's PO_APPROVED webhook
   (backend/imsWebhook.js) — a flat, standalone list (Progress Analysis's
   project detail view shows the same records scoped to one project; this
   page is the full, unfiltered-by-default list across every project,
   including ones IMS referenced by a project name that didn't match any
   real QC project — surfaced here as "Unmatched" rather than hidden). */
export default function PurchaseOrders() {
  const { data, currentUserId } = useApp();
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));

  const purchaseOrders = coll(data, "purchaseOrders")
    .filter((po) => !po.projectCode || allowedProjectCodes.has(po.projectCode))
    .sort((a, b) => b.receivedAt - a.receivedAt);

  const [fProjectCode, setFProjectCode] = useState("");
  const [fStatus, setFStatus] = useState("");

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
              Synced from IMS's PO_APPROVED webhook — non-financial (no vendor GST/PAN/bank details or payment amounts are stored). Matched to a QC project by exact name.
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
      </Card>

      <Card padded={false}>
        <Table
          columns={["PO ID", "Project", "Vendor", "Status", "Items", "Order Date", "Delivery Date"]}
          colAligns={["left", "left", "left", "left", "left", "left", "left"]}
          empty="No Purchase Orders received from IMS yet."
          maxHeight="640px"
        >
          {filtered.map((po) => (
            <TableRow key={po.id}>
              <TableCell strong className="whitespace-nowrap">{po.id}</TableCell>
              <TableCell className="whitespace-nowrap">
                {po.projectCode ? `${po.projectCode}` : (
                  <span title={`IMS sent project name "${po.projectNameRaw}" which didn't match any real QC project`}>
                    <Badge color="red"><span className="whitespace-nowrap">Unmatched</span></Badge>
                  </span>
                )}
                <div className="text-[10.5px] text-[var(--text-muted)] mt-0.5">{po.projectNameRaw}</div>
              </TableCell>
              <TableCell muted>{po.vendorName || "—"}</TableCell>
              <TableCell>
                <Badge color={po.status === "Approved" ? "green" : "amber"}><span className="whitespace-nowrap">{po.status}</span></Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {po.items.map((it, idx) => (
                    <span key={idx} className="text-[11px] border border-[var(--border)] rounded-radius-sm px-1.5 py-0.5 whitespace-nowrap">
                      {it.itemName}: {qty(it.qty)} {it.unit}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell muted className="whitespace-nowrap">{po.date || "—"}</TableCell>
              <TableCell muted className="whitespace-nowrap">{po.deliveryDate || "—"}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </div>
  );
}
