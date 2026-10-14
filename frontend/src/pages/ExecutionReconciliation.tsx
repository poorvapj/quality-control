import React, { useEffect, useMemo, useState } from "react";
import { authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";

interface ReconRow {
  projectCode: string; projectName: string;
  workOrderNo: string; workOrderId: string;
  itemId: string; itemType: "scopeItem" | "subItem"; parentItemId: string | null;
  description: string; unit: string; rate: number;
  executedQty: number; executedValue: number;
  measuredQty: number; measuredValue: number;
  billedQty: number; billedValue: number;
  mapped: boolean;
  locations: string[];
}
interface UnmappedBilled { billNo: string; workOrderNo: string; qty: number; value: number; reason: string }
type ReconResponse =
  | { available: false; reason: string }
  | { available: true; generatedAt: number; rows: ReconRow[]; unmappedBilled: UnmappedBilled[] };

const money = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* Data-unavailable tile — used for the three quality-linked metrics this
   dashboard deliberately does NOT compute (see the read-only audit this
   was built from): QC's quality system (Stage/Checklist/QParam) is
   unit/floor-scoped and purely binary, with zero field referencing a VMS
   Work Order or scope item, and zero quantity dimension to link one to.
   Fabricating a number here would be worse than showing none. */
function DataUnavailableTile({ label }: { label: string }) {
  return (
    <Card className="relative">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</div>
          <div className="text-xl font-medium leading-none text-[var(--text-sub)]">Data unavailable</div>
          <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5 leading-snug">
            No field in either system links a QC quality record to a VMS scope item or verified quantity.
          </div>
        </div>
        <div className="w-7 h-7 rounded-radius-sm flex items-center justify-center shrink-0 bg-[var(--bg-subtle)] text-[var(--text-muted)]" title="QC's Stage/Checklist system is unit/floor-scoped and purely pass/fail — it has no quantity dimension and no reference to a VMS Work Order or scope item. This is a genuine data-model gap, not a missing query.">
          <NavIcon name="help" size={13} />
        </div>
      </div>
    </Card>
  );
}

export default function ExecutionReconciliation() {
  const [data, setData] = useState<ReconResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectCode, setProjectCode] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [locationFilter, setLocationFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API_BASE + "/api/execution-reconciliation", { headers: authHeaders() });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Request failed");
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = data && data.available ? data.rows : [];

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.projectCode && !seen.has(r.projectCode)) seen.set(r.projectCode, r.projectName || r.projectCode);
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label: `${value} — ${label}` }));
  }, [rows]);

  const workOrderOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (projectCode && r.projectCode !== projectCode) continue;
      if (r.workOrderNo) seen.add(r.workOrderNo);
    }
    return Array.from(seen).map((v) => ({ value: v, label: v }));
  }, [rows, projectCode]);

  // Date-range filtering: a scope-item row has no single date of its own
  // (it's an aggregate across many progress entries) — this app has no
  // per-progress-entry rows to filter on here (Phase A is item-level, not
  // entry-level), so the date range only narrows the location filter text
  // match is skipped if no entries matched; full entry-level date drill-
  // down is a Phase A follow-up, not fabricated here.
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (projectCode && r.projectCode !== projectCode) return false;
      if (workOrderNo && r.workOrderNo !== workOrderNo) return false;
      if (locationFilter && !r.locations.some((l) => l.toLowerCase().includes(locationFilter.toLowerCase()))) return false;
      return true;
    });
  }, [rows, projectCode, workOrderNo, locationFilter]);

  // Quantity totals are NEVER summed across rows with different units —
  // only value (money) is unit-agnostic and safe to sum. Quantity is
  // shown per-row (single unit each) in the table, and as a per-unit
  // subtotal count here, never as one combined cross-unit number.
  const totals = useMemo(() => {
    const byUnit = new Map<string, { executedQty: number; billedQty: number }>();
    let executedValue = 0, billedValue = 0, measuredValue = 0, mappedCount = 0, unmappedCount = 0;
    for (const r of filteredRows) {
      const u = byUnit.get(r.unit) || { executedQty: 0, billedQty: 0 };
      u.executedQty += r.executedQty;
      u.billedQty += r.billedQty;
      byUnit.set(r.unit, u);
      executedValue += r.executedValue;
      measuredValue += r.measuredValue;
      billedValue += r.billedValue;
      if (r.billedQty > 0 || r.billedValue > 0) mappedCount++; else unmappedCount++;
    }
    return { byUnit, executedValue, measuredValue, billedValue, mappedCount, unmappedCount };
  }, [filteredRows]);

  const unmappedBilled = data && data.available ? data.unmappedBilled : [];

  if (loading) {
    return <div className="py-12 text-center text-[13px] text-[var(--text-muted)]">Loading execution reconciliation…</div>;
  }
  if (error) {
    return <Card className="text-center text-[13px] text-[var(--color-fail)] py-6">{error}</Card>;
  }
  if (data && !data.available) {
    return (
      <Card className="text-center text-[13px] text-[var(--text-muted)] py-6">
        Execution Reconciliation is unavailable: {data.reason}.
      </Card>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3 mt-0.5 mb-5">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="database" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Execution Reconciliation</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Reported vs. billed execution, read directly from VMS's Work Orders — project, work order, and item level.
          </div>
        </div>
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={projectCode} onChange={(v) => { setProjectCode(v); setWorkOrderNo(""); }} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
        <div className="max-w-[220px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Work Order</div>
          <SearchDropdown value={workOrderNo} onChange={setWorkOrderNo} options={[{ value: "", label: "All work orders" }, ...workOrderOptions]} neutralActive />
        </div>
        <div className="min-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Tower / Floor / Flat / Plot</div>
          <input className="input w-full" placeholder="Search location…" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} />
        </div>
        <div className="text-[10.5px] text-[var(--text-sub)] self-end pb-2.5 italic">
          Date-range drill-down is per work order (progress entries are dated); item-level rows aggregate across all dates for now.
        </div>
      </Card>

      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-sub)] mb-2">EXECUTION &amp; MEASUREMENT</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <StatTile
          label="Total Execution Reported"
          value={"₹" + money(totals.executedValue)}
          foot={totals.byUnit.size ? `across ${totals.byUnit.size} unit type${totals.byUnit.size === 1 ? "" : "s"} — see below` : "No records"}
          icon="trend"
        />
        <StatTile
          label="Measured Execution"
          value={"₹" + money(totals.measuredValue)}
          foot="Same underlying VMS progress-entry data as Execution Reported — VMS has no independent measurement step"
          icon="award"
        />
        <StatTile
          label="Billed Execution"
          value={"₹" + money(totals.billedValue)}
          foot={`${totals.mappedCount} item(s) with a billed reference` + (totals.unmappedCount ? `, ${totals.unmappedCount} not yet billed` : "")}
          icon="dpr"
        />
        <StatTile
          label="Execution Pending Measurement"
          value="N/A"
          foot="VMS has no separate pending-measurement state — a progress entry IS the measurement record"
          icon="clock"
        />
      </div>

      {totals.byUnit.size > 0 && (
        <Card className="mb-6">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2.5">Executed Qty by Unit</div>
          <div className="flex flex-wrap gap-2">
            {Array.from(totals.byUnit.entries())
              .sort((a, b) => b[1].executedQty - a[1].executedQty)
              .map(([u, v]) => (
                <div key={u} className="text-[12px] border border-[var(--border)] rounded-radius-sm px-2.5 py-1.5 whitespace-nowrap">
                  <span className="font-semibold">{qty(v.executedQty)}</span> <span className="text-[var(--text-muted)]">{u || "unit"}</span>
                </div>
              ))}
          </div>
        </Card>
      )}

      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-sub)] mb-2">QUALITY (NOT LINKED TO EXECUTION DATA)</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <DataUnavailableTile label="Quality-Checked Execution" />
        <DataUnavailableTile label="Execution Pending Quality Verification" />
        <DataUnavailableTile label="Quality Completion %" />
      </div>

      {unmappedBilled.length > 0 && (
        <div className="mb-6">
          <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5">
            <NavIcon name="bug" size={13} /> Unmapped billed lines ({unmappedBilled.length})
          </div>
          <Card padded={false} className="p-[18px]">
            <Table
              columns={["Bill No", "Work Order", "Qty", "Value", "Reason"]}
              colAligns={["left", "left", "right", "right", "left"]}
              maxHeight="360px"
            >
              {unmappedBilled.map((u, i) => (
                <TableRow key={i}>
                  <TableCell strong className="whitespace-nowrap">{u.billNo || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{u.workOrderNo || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(u.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">₹{money(u.value)}</TableCell>
                  <TableCell muted>{u.reason}</TableCell>
                </TableRow>
              ))}
            </Table>
          </Card>
        </div>
      )}

      <div className="text-[13px] font-bold tracking-tight text-[var(--text-sub)] uppercase flex items-center gap-2 mb-2.5">
        <NavIcon name="board" size={13} /> Reconciliation — by work item
      </div>
      <Card padded={false} className="p-[18px]">
        <Table
          columns={["Project", "Work Order", "Item", "Unit", "Executed Qty", "Executed Value", "Billed Qty", "Billed Value", "Status", "Location(s)"]}
          colAligns={["left", "left", "left", "left", "right", "right", "right", "right", "left", "left"]}
          maxHeight="560px"
        >
          {filteredRows.map((r) => (
            <TableRow key={r.itemId}>
              <TableCell className="whitespace-nowrap">{r.projectCode}</TableCell>
              <TableCell className="whitespace-nowrap">{r.workOrderNo}</TableCell>
              <TableCell strong className={"min-w-[180px] " + (r.itemType === "subItem" ? "pl-5" : "")}>
                {r.itemType === "subItem" ? "↳ " : ""}{r.description || "—"}
              </TableCell>
              <TableCell muted className="whitespace-nowrap">{r.unit || "—"}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(r.executedQty)}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">₹{money(r.executedValue)}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">{r.billedQty > 0 ? qty(r.billedQty) : "—"}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">{r.billedValue > 0 ? "₹" + money(r.billedValue) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap">
                {r.billedQty > 0 || r.billedValue > 0
                  ? <Badge color="green">Billed</Badge>
                  : <Badge color="gray">Not yet billed</Badge>}
              </TableCell>
              <TableCell muted className="min-w-[120px]">{r.locations.join(", ") || "—"}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </div>
  );
}
