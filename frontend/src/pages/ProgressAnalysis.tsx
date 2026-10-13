import React, { useEffect, useMemo, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import SidePanel from "../components/SidePanel";
import SearchDropdown from "../components/SearchDropdown";
import type { PurchaseOrder, TabKey } from "../types";

interface LocationRow {
  location: string; qty: number; billedQty: number; unbilledQty: number;
  tower?: string; floor?: string; flatNo?: string; plotNo?: string;
}
interface DetailRow {
  workOrderNo: string; item: ProgressItem;
  completedQty: number; billedQty: number; unbilledQty: number; locations: LocationRow[];
}
const unitOf = (l: LocationRow) => l.flatNo || l.plotNo || "";
interface ProgressItem {
  itemId: string; itemType: "scopeItem" | "subItem"; parentItemId: string | null;
  description: string; unit: string;
  plannedQty: number; completedQty: number;
  percentOfPlan: number | null;
  varianceFlag: boolean;
  varianceApproved: boolean;
  varianceApprovedByName: string | null;
  varianceApprovedAt: string | number | null;
  varianceApprovedAtQty: number | null;
  locations: LocationRow[];
  totalBilledQty: number;
  totalUnbilledQty: number;
}
interface ProgressWorkOrder { workOrderNo: string; items: ProgressItem[] }
interface ProgressProject { projectCode: string; projectName: string; workOrders: ProgressWorkOrder[] }
type ProgressResponse = { available: false; reason: string } | { available: true; projects: ProgressProject[] };

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function projectStats(p: ProgressProject) {
  let items = 0, variance = 0, pendingSignOff = 0, unbilled = 0;
  for (const wo of p.workOrders) {
    for (const item of wo.items) {
      items++;
      if (item.varianceFlag) { variance++; if (!item.varianceApproved) pendingSignOff++; }
      unbilled += item.totalUnbilledQty;
    }
  }
  return { items, variance, pendingSignOff, unbilled, workOrders: p.workOrders.length };
}

/* Project-wise VMS progress analysis — planned vs completed quantity,
   AGM/GM variance sign-off status, and billed-vs-unbilled qty per
   location. Reads VMS's own stored plannedQty/completedQty/
   varianceApproved / billedInRequestId fields directly (confirmed against
   VMS's actual source — WorkOrder.js/workOrderController.js/
   billRequestController.js — never re-derived or guessed). Deliberately
   non-financial: no rate/amount is read here (that stays in the
   admin-only Execution Reconciliation dashboard), so this is available to
   any signed-in user with the Work Quality Inspection grant, same as the
   Unit Execution Workflow page.

   Drill-down: a project-wise list; clicking a project opens a side panel
   (the list stays in place) with its Work Orders and items, filterable by
   Tower / Floor / Unit, plus a Purchase Orders section synced from IMS's
   PO_APPROVED webhook (backend/imsWebhook.js). IMS has no Work Order/
   scope-item reference on a PO — only a project NAME — so POs are shown at
   the project level only, matched by exact project-name equality; a PO
   whose name didn't match any real QC project is flagged "Unmatched"
   rather than guessed into the wrong project. */
export default function ProgressAnalysis() {
  const { data: boardData, setActiveTab } = useApp();
  const purchaseOrders = coll(boardData, "purchaseOrders").filter((po) => !po.deleted);
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectCode, setSelectedProjectCode] = useState<string | null>(null);
  const [onlyVariance, setOnlyVariance] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fTower, setFTower] = useState("");
  const [fFloor, setFFloor] = useState("");
  const [fUnit, setFUnit] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(API_BASE + "/api/progress-analysis", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { setData(j); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError("Failed to load progress analysis"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  function toggle(itemId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  const selectedProject = data && data.available ? data.projects.find((p) => p.projectCode === selectedProjectCode) || null : null;

  // Tower → Floor → Unit options for the open project, narrowed by whatever
  // is already picked above them (built from VMS's own per-entry fields).
  const allLocations = useMemo(
    () => (selectedProject ? selectedProject.workOrders.flatMap((wo) => wo.items.flatMap((i) => i.locations)) : []),
    [selectedProject]
  );
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const towerOptions = uniq(allLocations.map((l) => l.tower || ""));
  const floorOptions = uniq(allLocations.filter((l) => !fTower || l.tower === fTower).map((l) => l.floor || ""));
  const unitOptions = uniq(allLocations.filter((l) => (!fTower || l.tower === fTower) && (!fFloor || l.floor === fFloor)).map(unitOf));
  const anyLocationFilter = !!(fTower || fFloor || fUnit);

  const detailRows = useMemo(() => {
    if (!selectedProject) return [];
    const out: DetailRow[] = [];
    for (const wo of selectedProject.workOrders) {
      for (const item of wo.items) {
        if (onlyVariance && !item.varianceFlag) continue;
        if (!anyLocationFilter) {
          out.push({ workOrderNo: wo.workOrderNo, item, completedQty: item.completedQty, billedQty: item.totalBilledQty, unbilledQty: item.totalUnbilledQty, locations: item.locations });
          continue;
        }
        const locs = item.locations.filter((l) => (!fTower || l.tower === fTower) && (!fFloor || l.floor === fFloor) && (!fUnit || unitOf(l) === fUnit));
        if (locs.length === 0) continue;
        out.push({
          workOrderNo: wo.workOrderNo, item, locations: locs,
          completedQty: locs.reduce((s, l) => s + l.qty, 0),
          billedQty: locs.reduce((s, l) => s + l.billedQty, 0),
          unbilledQty: locs.reduce((s, l) => s + l.unbilledQty, 0)
        });
      }
    }
    return out;
  }, [selectedProject, onlyVariance, anyLocationFilter, fTower, fFloor, fUnit]);

  function openProject(code: string) {
    setSelectedProjectCode(code);
    setFTower(""); setFFloor(""); setFUnit("");
    setOnlyVariance(false);
    setExpanded(new Set());
  }
  function closePanel() { setSelectedProjectCode(null); }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="trend" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Progress Analysis</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Real VMS planned-vs-completed quantity, AGM/GM variance sign-off, and billed-vs-unbilled qty by location — read directly from VMS, non-financial.
            </div>
          </div>
        </div>
      </div>

      {loading && <Card><div className="empty">Loading…</div></Card>}
      {error && <Card><div className="empty">{error}</div></Card>}
      {data && !data.available && <Card><div className="empty">VMS progress data is unavailable right now ({data.reason}).</div></Card>}

      {data && data.available && (
        <ProjectList projects={data.projects} purchaseOrders={purchaseOrders} onSelect={openProject} onOpenPurchaseOrders={() => setActiveTab("purchaseOrders" as TabKey)} />
      )}

      <ProjectDetailPanel
        project={selectedProject}
        purchaseOrders={selectedProject ? purchaseOrders.filter((po) => po.projectCode === selectedProject.projectCode) : []}
        rows={detailRows}
        fTower={fTower} fFloor={fFloor} fUnit={fUnit}
        setFTower={(v) => { setFTower(v); setFFloor(""); setFUnit(""); }}
        setFFloor={(v) => { setFFloor(v); setFUnit(""); }}
        setFUnit={setFUnit}
        towerOptions={towerOptions} floorOptions={floorOptions} unitOptions={unitOptions}
        onlyVariance={onlyVariance}
        setOnlyVariance={setOnlyVariance}
        expanded={expanded}
        toggle={toggle}
        onClose={closePanel}
      />

    </div>
  );
}

function ProjectList({ projects, purchaseOrders, onSelect, onOpenPurchaseOrders }: { projects: ProgressProject[]; purchaseOrders: PurchaseOrder[]; onSelect: (code: string) => void; onOpenPurchaseOrders: () => void }) {
  const totals = projects.reduce((acc, p) => {
    const s = projectStats(p);
    acc.items += s.items; acc.variance += s.variance; acc.pendingSignOff += s.pendingSignOff; acc.unbilled += s.unbilled;
    return acc;
  }, { items: 0, variance: 0, pendingSignOff: 0, unbilled: 0 });
  const unmatchedPOs = purchaseOrders.filter((po) => !po.projectCode);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Projects" value={projects.length} icon="trend" />
        <StatTile label="Over-Plan (Variance)" value={totals.variance} icon="bug" valueClassName={totals.variance > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Pending AGM/GM Sign-off" value={totals.pendingSignOff} icon="clock" valueClassName={totals.pendingSignOff > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Unbilled Qty (all projects)" value={qty(totals.unbilled)} icon="package" />
      </div>

      {unmatchedPOs.length > 0 && (
        <Card className="mb-5 !py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[12px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--color-fail)]">{unmatchedPOs.length} Purchase Order{unmatchedPOs.length > 1 ? "s" : ""}</span> from IMS could not be matched to a project by name — not shown under any project below.
          </div>
          <Btn label="View in Purchase Orders" color="secondary" size="sm" onClick={onOpenPurchaseOrders} />
        </Card>
      )}

      <Card padded={false} className="p-[18px]">
        <Table
          columns={["Project", "Work Orders", "Items", "Variance", "Pending Sign-off", "Unbilled Qty", ""]}
          colWidths={["34%", "12%", "10%", "12%", "16%", "12%", "4%"]}
          colAligns={["left", "right", "right", "right", "right", "right", "left"]}
        >
          {projects.map((p) => {
            const s = projectStats(p);
            return (
              <TableRow key={p.projectCode}>
                <TableCell strong className="cursor-pointer" onClick={() => onSelect(p.projectCode)}>
                  <span className="text-primary">{p.projectCode}</span> — {p.projectName}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.workOrders}</TableCell>
                <TableCell className="text-right tabular-nums">{s.items}</TableCell>
                <TableCell className={"text-right tabular-nums" + (s.variance > 0 ? " text-[var(--color-fail)] font-semibold" : "")}>{s.variance}</TableCell>
                <TableCell className={"text-right tabular-nums" + (s.pendingSignOff > 0 ? " text-[var(--color-fail)] font-semibold" : "")}>{s.pendingSignOff}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(s.unbilled)}</TableCell>
                <TableCell className="text-right">
                  <Btn label="Open" color="secondary" size="sm" onClick={() => onSelect(p.projectCode)} />
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

function ProjectDetailPanel({
  project, purchaseOrders, rows, fTower, fFloor, fUnit, setFTower, setFFloor, setFUnit, towerOptions, floorOptions, unitOptions,
  onlyVariance, setOnlyVariance, expanded, toggle, onClose
}: {
  project: ProgressProject | null;
  purchaseOrders: PurchaseOrder[];
  rows: DetailRow[];
  fTower: string; fFloor: string; fUnit: string;
  setFTower: (v: string) => void; setFFloor: (v: string) => void; setFUnit: (v: string) => void;
  towerOptions: string[]; floorOptions: string[]; unitOptions: string[];
  onlyVariance: boolean;
  setOnlyVariance: (v: boolean | ((prev: boolean) => boolean)) => void;
  expanded: Set<string>;
  toggle: (itemId: string) => void;
  onClose: () => void;
}) {
  const varianceCount = rows.filter((r) => r.item.varianceFlag).length;
  const pendingSignOff = rows.filter((r) => r.item.varianceFlag && !r.item.varianceApproved).length;
  const totalUnbilled = rows.reduce((s, r) => s + r.unbilledQty, 0);
  const anyLocationFilter = !!(fTower || fFloor || fUnit);
  const opts = (label: string, list: string[]) => [{ value: "", label }, ...list.map((v) => ({ value: v, label: v }))];

  return (
    <SidePanel
      open={!!project}
      wide
      icon={<NavIcon name="trend" size={18} />}
      title={project ? `${project.projectCode} — ${project.projectName}` : ""}
      desc="Work-order items, variance sign-off and billing by location"
      onClose={onClose}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile label="Items" value={rows.length} icon="trend" />
        <StatTile label="Over-Plan (Variance)" value={varianceCount} icon="bug" valueClassName={varianceCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Pending Sign-off" value={pendingSignOff} icon="clock" valueClassName={pendingSignOff > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Unbilled Qty" value={qty(totalUnbilled)} icon="package" />
      </div>

      <div className="flex gap-3 flex-wrap items-end mb-4">
        {towerOptions.length > 0 && (
          <div className="min-w-[130px]">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Tower</div>
            <SearchDropdown value={fTower} onChange={setFTower} options={opts("All towers", towerOptions)} neutralActive />
          </div>
        )}
        {floorOptions.length > 0 && (
          <div className="min-w-[130px]">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
            <SearchDropdown value={fFloor} onChange={setFFloor} options={opts("All floors", floorOptions)} neutralActive />
          </div>
        )}
        {unitOptions.length > 0 && (
          <div className="min-w-[130px]">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Unit</div>
            <SearchDropdown value={fUnit} onChange={setFUnit} options={opts("All units", unitOptions)} neutralActive />
          </div>
        )}
        <Btn label={onlyVariance ? "Showing: Variance only" : "Show all items"} color="secondary" size="sm" onClick={() => setOnlyVariance((v) => !v)} />
      </div>
      {anyLocationFilter && (
        <div className="text-[11.5px] text-[var(--text-muted)] mb-3">
          Completed and Billed / Unbilled show only the selected location; Planned is the item's full plan.
        </div>
      )}

      <div className="text-[12.5px] font-semibold mb-2">Purchase Orders (from IMS)</div>
      {purchaseOrders.length === 0 ? (
        <Card className="mb-5 !py-3"><div className="text-[12px] text-[var(--text-sub)]">No Purchase Orders received from IMS for this project yet.</div></Card>
      ) : (
        <div className="flex flex-col gap-2 mb-5 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
          {purchaseOrders.map((po) => (
            <Card key={po.id} className="!py-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[12.5px] font-semibold">{po.id} {po.vendorName ? `· ${po.vendorName}` : ""}</div>
                <Badge color={po.status === "Approved" ? "green" : "amber"}><span className="whitespace-nowrap">{po.status}</span></Badge>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {po.date ? `Ordered ${po.date.slice(0, 10)}` : ""}{po.deliveryDate ? ` · Delivery ${po.deliveryDate.slice(0, 10)}` : ""}{po.milestone ? ` · ${po.milestone}` : ""}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {po.items.map((it, idx) => (
                  <div key={idx} className="text-[11px] border border-[var(--border)] rounded-radius-sm px-2 py-1 whitespace-nowrap">
                    {it.itemName}: {qty(it.qty)} {it.unit}
                  </div>
                ))}
              </div>
              {po.remark && <div className="text-[11px] text-[var(--text-muted)] mt-1.5">{po.remark}</div>}
            </Card>
          ))}
        </div>
      )}

      <Card padded={false} className="p-[14px]">
        <Table
          columns={["Work Order", "Item", "Planned", "Completed", "% of Plan", "Variance / Sign-off", "Billed / Unbilled", ""]}
          colAligns={["left", "left", "right", "right", "right", "left", "right", "left"]}
          maxHeight="440px"
          empty="No items match these filters."
        >
          {rows.map(({ workOrderNo, item, completedQty, billedQty, unbilledQty, locations }) => {
            const pct = item.plannedQty > 0 ? Math.round((completedQty / item.plannedQty) * 100) : null;
            const overPlan = pct !== null && pct > 100;
            return (
              <React.Fragment key={item.itemId}>
                <TableRow>
                  <TableCell muted className="whitespace-nowrap">{workOrderNo}</TableCell>
                  <TableCell strong>{item.itemType === "subItem" ? "↳ " : ""}{item.description}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(item.plannedQty)} {item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(completedQty)} {item.unit}</TableCell>
                  <TableCell className={"text-right tabular-nums whitespace-nowrap" + (overPlan ? " text-[var(--color-fail)] font-semibold" : "")}>
                    {pct === null ? <span className="text-[var(--text-sub)] font-normal">Data unavailable</span> : `${pct}%`}
                  </TableCell>
                  <TableCell>
                    {!item.varianceFlag ? <span className="text-[var(--text-sub)]">—</span> : (
                      <div>
                        <Badge color={item.varianceApproved ? "green" : "red"}>
                          <span className="whitespace-nowrap">{item.varianceApproved ? "Signed off" : "Pending"}</span>
                        </Badge>
                        {item.varianceApproved && item.varianceApprovedByName && (
                          <div className="text-[10.5px] text-[var(--text-muted)] mt-1 truncate">{item.varianceApprovedByName} · at {item.varianceApprovedAtQty} {item.unit}</div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell muted className="text-right tabular-nums whitespace-nowrap">{qty(billedQty)} / {qty(unbilledQty)} {item.unit}</TableCell>
                  <TableCell className="text-right">
                    {locations.length > 0 && (
                      <Btn label={expanded.has(item.itemId) ? "Hide" : "Locations"} color="secondary" size="sm" onClick={() => toggle(item.itemId)} />
                    )}
                  </TableCell>
                </TableRow>
                {expanded.has(item.itemId) && (
                  <TableRow>
                    <TableCell colSpan={8} className="bg-[var(--bg-subtle)]">
                      <div className="flex flex-wrap gap-2 py-1.5">
                        {locations.map((l) => (
                          <div key={l.location} className="text-[11px] border border-[var(--border)] rounded-radius-sm px-2 py-1 bg-[var(--bg-card)] whitespace-nowrap">
                            <span className="font-semibold">{l.location}</span>: {qty(l.qty)} {item.unit} (billed {qty(l.billedQty)}, unbilled {qty(l.unbilledQty)})
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </Table>
      </Card>
    </SidePanel>
  );
}
