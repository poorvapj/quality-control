import React, { useEffect, useMemo, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll, myProjects, projectFloors, floorUnits, byId } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import SidePanel from "../components/SidePanel";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { MaterialMeasurement, Unit as QcUnit } from "../types";

interface VmsWorkItem {
  itemId: string; itemType: "scopeItem" | "subItem"; parentItemId: string | null;
  description: string; unit: string; plannedQty: number; executedQty: number; locations: string[];
}
interface VmsWorkOrderEntry { workOrderNo: string; items: VmsWorkItem[] }
interface VmsProjectEntry { projectCode: string; projectName: string; workOrders: VmsWorkOrderEntry[] }
type WorkItemsResponse = { available: false; reason: string } | { available: true; projects: VmsProjectEntry[] };

interface MeasurementPrefill {
  projectId: string; projectCode: string; projectName: string;
  floorId: string; floorName: string; unitId: string; unitCode: string; unitName: string;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

/* Anchored to QC's own real Project->Floor->Unit (same as Work Quality
   Inspection — see that page and types/index.ts's doc comments for why a
   VMS Work Order/scope-item can't be the anchor: QC has no "tower" concept
   at all, while VMS's execution locations are free text with no fixed
   format, so there's no reliable key to auto-match a Unit to a VMS item).
   VMS execution data is therefore shown as a separate, project-level
   reference list below the Unit table — never auto-joined to a specific
   unit row. Store Outward / Material Assigned to DRI integration is
   deferred to a later phase. */
export default function UnitExecutionWorkflow() {
  const { data, currentUserId, apply, toast, me } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const canCreate = isAdmin || hasModuleGrant(data, currentUserId, "qualityInspection", "create");
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));

  const [workItems, setWorkItems] = useState<WorkItemsResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(API_BASE + "/api/vms-work-items", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setWorkItems(j); })
      .catch(() => { if (!cancelled) setWorkItems({ available: false, reason: "Failed to load" }); });
    return () => { cancelled = true; };
  }, []);

  const inspections = coll(data, "qualityInspections").filter((i) => allowedProjectCodes.has(i.projectCode));
  const measurements = coll(data, "materialMeasurements").filter((m) => allowedProjectCodes.has(m.projectCode));

  const [panelOpen, setPanelOpen] = useState(false);
  const [prefill, setPrefill] = useState<MeasurementPrefill | null>(null);
  const [fProjectId, setFProjectId] = useState("");

  const projectRows = fProjectId ? allProjects.filter((p) => p.id === fProjectId) : allProjects;

  const unitRows = useMemo(() => {
    const rows: { projectId: string; projectCode: string; projectName: string; floorId: string; floorName: string; unit: QcUnit }[] = [];
    for (const p of projectRows) {
      for (const f of projectFloors(data, p.id)) {
        for (const u of floorUnits(data, p.id, f.id)) {
          rows.push({ projectId: p.id, projectCode: p.code, projectName: p.name, floorId: f.id, floorName: f.name, unit: u });
        }
      }
    }
    return rows;
  }, [data, projectRows]);

  function inspectionsFor(unitId: string) {
    return inspections.filter((i) => i.unitId === unitId);
  }
  function measurementsFor(unitId: string) {
    return measurements.filter((m) => m.unitId === unitId);
  }
  function latestInspection(unitId: string) {
    const related = inspectionsFor(unitId);
    return related.length ? related.sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  }

  const snags = coll(data, "snags");
  const unitsInspected = unitRows.filter((r) => inspectionsFor(r.unit.id).length > 0).length;
  const unresolvedQuality = inspections.filter((i) => {
    const snag = i.linkedSnagId ? byId(snags, i.linkedSnagId) : null;
    return snag && snag.status !== "Closed";
  }).length;
  const unitsMeasured = unitRows.filter((r) => measurementsFor(r.unit.id).length > 0).length;
  const totalMeasuredQty = measurements.reduce((s, m) => s + m.measuredQty, 0);

  // VMS execution reference list — project-level only, never auto-joined to
  // a specific unit row (see the page's doc comment above).
  const vmsItemRows = useMemo(() => {
    if (!workItems || !workItems.available) return [];
    const rows: { projectCode: string; projectName: string; workOrderNo: string; item: VmsWorkItem }[] = [];
    for (const p of workItems.projects) {
      if (fProjectId && !allProjects.some((pr) => pr.id === fProjectId && pr.code === p.projectCode)) continue;
      if (!allowedProjectCodes.has(p.projectCode)) continue;
      for (const wo of p.workOrders) {
        for (const item of wo.items) rows.push({ projectCode: p.projectCode, projectName: p.projectName, workOrderNo: wo.workOrderNo, item });
      }
    }
    return rows;
  }, [workItems, fProjectId, allProjects, allowedProjectCodes]);

  const projectOptions = allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="layers" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Unit Execution, Quality &amp; Measurement</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Per-unit Quality Inspection and Measurement history, plus a project-level VMS execution reference — the two are never auto-matched.
              Store Outward / Material Assigned to DRI integration is deferred to a later phase.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Units Inspected" value={`${unitsInspected} / ${unitRows.length}`} icon="eye" />
        <StatTile label="Unresolved Quality Issues" value={unresolvedQuality} icon="bug" valueClassName={unresolvedQuality > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Units Measured" value={`${unitsMeasured} / ${unitRows.length}`} icon="ruler" />
        <StatTile label="Total Measured Qty" value={totalMeasuredQty} icon="package" />
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectId} onChange={setFProjectId} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
      </Card>

      <Card padded={false} className="mb-5 p-[18px]">
        <Table
          columns={["Project", "Floor / Unit", "Latest Inspection", "Corrective Action", "VMS Reference", "Measured Qty", "Material Consumed", ""]}
          colWidths={["9%", "16%", "12%", "12%", "20%", "12%", "12%", "7%"]}
          colAligns={["left", "left", "left", "left", "left", "right", "right", "left"]}
          maxHeight="480px"
        >
          {unitRows.map(({ projectId, projectCode, projectName, floorId, floorName, unit }) => {
            const insp = latestInspection(unit.id);
            const unitMeasurements = measurementsFor(unit.id);
            const measuredQty = unitMeasurements.reduce((s, m) => s + m.measuredQty, 0);
            const materialConsumed = unitMeasurements.reduce((s, m) => s + m.materialConsumedQty, 0);
            const latestMeasurement = unitMeasurements.length ? unitMeasurements.sort((a, b) => b.createdAt - a.createdAt)[0] : null;
            const vmsRef = insp?.itemDescription || latestMeasurement?.itemDescription || null;
            const vmsWorkOrder = insp?.workOrderNo || latestMeasurement?.workOrderNo || null;
            return (
              <TableRow key={unit.id}>
                <TableCell className="whitespace-nowrap">{projectCode}</TableCell>
                <TableCell strong>{floorName} / {unit.name}</TableCell>
                <TableCell>
                  {insp ? <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}><span className="whitespace-nowrap">{insp.result}</span></Badge> : <span className="text-[var(--text-sub)]">Not inspected</span>}
                </TableCell>
                <TableCell muted className="whitespace-nowrap">
                  {(() => {
                    const snag = insp?.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
                    return snag ? (snag.status === "Closed" ? "Resolved" : "Open") : "—";
                  })()}
                </TableCell>
                <TableCell muted className="truncate max-w-0">{vmsRef ? `${vmsWorkOrder} · ${vmsRef}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{unitMeasurements.length ? `${measuredQty} ${unitMeasurements[0].measuredUnit}` : <span className="text-[var(--text-sub)]">Data unavailable</span>}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{unitMeasurements.length ? `${materialConsumed} ${unitMeasurements[0].materialUnit}` : <span className="text-[var(--text-sub)]">Data unavailable</span>}</TableCell>
                <TableCell className="text-right">
                  {canCreate && (
                    <Btn label="Measure" color="secondary" size="sm" onClick={() => {
                      setPrefill({ projectId, projectCode, projectName, floorId, floorName, unitId: unit.id, unitCode: unit.code, unitName: unit.name });
                      setPanelOpen(true);
                    }} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </Card>

      <Card padded={false}>
        <div className="px-4 pt-3.5 pb-2 text-[12.5px] font-semibold">VMS Execution Reference</div>
        <div className="px-4 pb-3 text-[11px] text-[var(--text-muted)]">
          Real executed quantity from VMS Site Progress, by Work Order item — shown for cross-reference only, not matched to a specific Unit above.
        </div>
        {workItems && !workItems.available && (
          <div className="empty mx-4 mb-4">VMS work items are unavailable right now ({workItems.reason}).</div>
        )}
        <Table columns={["Project / Work Order", "Item", "Executed Qty", "Locations"]} colWidths={["20%", "35%", "15%", "30%"]} colAligns={["left", "left", "right", "left"]} maxHeight="400px">
          {vmsItemRows.map(({ projectCode, workOrderNo, item }) => (
            <TableRow key={`${workOrderNo}-${item.itemId}`}>
              <TableCell className="whitespace-nowrap">{projectCode} · {workOrderNo}</TableCell>
              <TableCell strong>{item.itemType === "subItem" ? "↳ " : ""}{item.description}</TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">{item.executedQty} {item.unit}</TableCell>
              <TableCell muted className="truncate max-w-0">{item.locations.length ? item.locations.join(", ") : "—"}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Card>

      <MeasurementForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setPrefill(null); }}
        prefill={prefill}
        workItems={workItems}
        allProjects={allProjects}
        currentUserId={currentUserId}
        recordedByName={me()?.name || ""}
        apply={apply}
        toast={toast}
      />
    </div>
  );
}

function MeasurementForm({
  open, onClose, prefill, workItems, allProjects, currentUserId, recordedByName, apply, toast
}: {
  open: boolean; onClose: () => void; prefill: MeasurementPrefill | null;
  workItems: WorkItemsResponse | null;
  allProjects: { id: string; code: string; name: string }[];
  currentUserId: string | null; recordedByName: string;
  apply: (ops: any[]) => Promise<void>;
  toast: (msg: string) => void;
}) {
  const [measurementDate, setMeasurementDate] = useState(todayStr());
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [itemId, setItemId] = useState("");
  const [measuredQty, setMeasuredQty] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState("");
  const [materialConsumedQty, setMaterialConsumedQty] = useState("");
  const [materialUnit, setMaterialUnit] = useState("");
  const [unusedBalanceQty, setUnusedBalanceQty] = useState("");
  const [wastageQty, setWastageQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMeasurementDate(todayStr());
    setWorkOrderNo(""); setItemId("");
    setMeasuredQty(""); setMeasuredUnit("");
    setMaterialConsumedQty(""); setMaterialUnit("");
    setUnusedBalanceQty(""); setWastageQty(""); setRemarks("");
  }, [open, prefill]);

  // VMS Work Order/Item picker — same optional, manual-only cross-reference
  // pattern as Work Quality Inspection (see that page and the
  // MaterialMeasurement interface's doc comment in types/index.ts): a QC
  // Unit has no reliable key back to a VMS scope-item, so this is never
  // auto-matched to the Unit selected in the table, only a deliberate pick.
  const project = prefill ? allProjects.find((p) => p.id === prefill.projectId) || null : null;
  const projectEntry = (workItems && workItems.available && project)
    ? workItems.projects.find((p) => p.projectCode === project.code)
    : null;
  const workOrderEntry = projectEntry?.workOrders.find((w) => w.workOrderNo === workOrderNo) || null;
  const itemEntry = workOrderEntry?.items.find((i) => i.itemId === itemId) || null;

  async function save() {
    if (!prefill) { toast("Select a unit first"); return; }
    const mQty = Number(measuredQty), mcQty = Number(materialConsumedQty);
    const ubQty = Number(unusedBalanceQty) || 0, wQty = Number(wastageQty) || 0;
    if (!measuredUnit.trim() || !materialUnit.trim()) { toast("Measured unit and material unit are required"); return; }
    if (!Number.isFinite(mQty) || mQty < 0) { toast("Measured quantity must be a non-negative number"); return; }
    if (!Number.isFinite(mcQty) || mcQty < 0) { toast("Material consumed quantity must be a non-negative number"); return; }
    if (ubQty < 0 || wQty < 0) { toast("Unused balance and wastage must be non-negative"); return; }

    setSaving(true);
    const id = nextId("MM", []);
    const rec: MaterialMeasurement = {
      id,
      projectId: prefill.projectId, projectCode: prefill.projectCode, projectName: prefill.projectName,
      floorId: prefill.floorId, floorName: prefill.floorName,
      unitId: prefill.unitId, unitCode: prefill.unitCode, unitName: prefill.unitName,
      workOrderNo: itemEntry ? workOrderNo : undefined,
      itemId: itemEntry ? itemEntry.itemId : undefined,
      itemType: itemEntry?.itemType,
      itemDescription: itemEntry?.description,
      measurementDate,
      measuredQty: mQty, measuredUnit: measuredUnit.trim(),
      materialConsumedQty: mcQty, materialUnit: materialUnit.trim(),
      unusedBalanceQty: ubQty, wastageQty: wQty,
      remarks: remarks.trim() || undefined,
      qualityInspectionId: null,
      storeOutwardRef: null,
      purchaseOrderRef: null, // reserved for IMS integration — see MaterialMeasurement's doc comment
      recordedByUserId: currentUserId || "",
      recordedByName,
      createdAt: Date.now()
    };
    await apply([
      { op: "upsert", coll: "materialMeasurements", rec },
      buildEventOp(currentUserId, "MATERIAL_MEASUREMENT", id, "", `Measurement · ${rec.unitName} · ${mQty} ${rec.measuredUnit}`)
    ]);
    setSaving(false);
    toast("Measurement recorded");
    onClose();
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="ruler" size={18} />}
      title="Record Measurement"
      desc={prefill ? `${prefill.projectCode} · ${prefill.floorName} / ${prefill.unitName}` : "Select a unit from the table first."}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !prefill}>{saving ? "Saving…" : "Save Measurement"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Measurement Date *</label>
          <input className="input" type="date" value={measurementDate} onChange={(e) => setMeasurementDate(e.target.value)} />
        </div>
        <div className="field" />

        <div className="field">
          <label>VMS Work Order (optional)</label>
          {workItems && !workItems.available && (
            <div className="empty" style={{ marginBottom: 6 }}>VMS work items are unavailable right now ({workItems.reason}).</div>
          )}
          <select className="select" value={workOrderNo} disabled={!projectEntry} onChange={(e) => { setWorkOrderNo(e.target.value); setItemId(""); }}>
            <option value="">— none —</option>
            {projectEntry?.workOrders.map((w) => <option key={w.workOrderNo} value={w.workOrderNo}>{w.workOrderNo}</option>)}
          </select>
        </div>
        <div className="field">
          <label>VMS Work Item (optional)</label>
          <select
            className="select"
            value={itemId}
            disabled={!workOrderEntry}
            onChange={(e) => {
              const id = e.target.value;
              setItemId(id);
              const picked = workOrderEntry?.items.find((i) => i.itemId === id);
              if (picked && !measuredUnit) setMeasuredUnit(picked.unit);
            }}
          >
            <option value="">— not linked to a VMS item —</option>
            {workOrderEntry?.items.map((i) => <option key={i.itemId} value={i.itemId}>{i.itemType === "subItem" ? "↳ " : ""}{i.description} ({i.unit})</option>)}
          </select>
        </div>

        {itemEntry && (
          <div className="field full" style={{ marginTop: -6 }}>
            <div className="text-[11.5px] border border-[var(--border)] rounded-radius-sm px-2.5 py-2 bg-[var(--bg-subtle)]">
              <span className="font-semibold">Planned (VMS):</span> {itemEntry.plannedQty || <span className="text-[var(--text-sub)]">Data unavailable</span>} {itemEntry.unit}
              {" · "}<span className="font-semibold">Executed so far:</span> {itemEntry.executedQty} {itemEntry.unit}
            </div>
          </div>
        )}

        <div className="field">
          <label>Actual Measured Quantity *</label>
          <input className="input" type="number" min="0" value={measuredQty} onChange={(e) => setMeasuredQty(e.target.value)} />
        </div>
        <div className="field">
          <label>Measured Unit *</label>
          <input className="input" value={measuredUnit} onChange={(e) => setMeasuredUnit(e.target.value)} />
        </div>

        <div className="field">
          <label>Material Consumed *</label>
          <input className="input" type="number" min="0" value={materialConsumedQty} onChange={(e) => setMaterialConsumedQty(e.target.value)} />
        </div>
        <div className="field">
          <label>Material Unit *</label>
          <input className="input" value={materialUnit} onChange={(e) => setMaterialUnit(e.target.value)} />
        </div>

        <div className="field">
          <label>Unused Balance</label>
          <input className="input" type="number" min="0" value={unusedBalanceQty} onChange={(e) => setUnusedBalanceQty(e.target.value)} />
        </div>
        <div className="field">
          <label>Wastage</label>
          <input className="input" type="number" min="0" value={wastageQty} onChange={(e) => setWastageQty(e.target.value)} />
        </div>

        <div className="field full">
          <label>Remarks</label>
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </div>
      </div>
    </SidePanel>
  );
}
