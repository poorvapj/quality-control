import React, { useEffect, useMemo, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll, myProjects, projectFloors, floorUnits } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import { approvalFor, effectiveApproval } from "../shared/approval";
import { ApprovalBadge, ApprovalActions } from "../components/ApprovalControls";
import SidePanel from "../components/SidePanel";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { MaterialMeasurement } from "../types";

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

const CUSTOM_ITEM = "__custom__";
const todayStr = () => new Date().toISOString().slice(0, 10);

// Same fixed list + "Other" fallback as Measurement.tsx's Unit field — a
// dropdown avoids typos/inconsistent spelling that would otherwise make
// unit comparisons (e.g. against VMS) unreliable, while "Other" still
// allows a value outside this list since VMS's own units aren't fixed.
const MEASUREMENT_UNITS = ["sq.ft", "R.ft", "Rmt", "Cum", "Sqm", "Kg", "MT", "Nos", "Bag", "Ltr"];

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* Measurement — record a measurement for a QC Project → Floor → Unit,
   optionally cross-referenced to a real VMS work item (see MeasurementForm).
   The page itself is just the "New Measurement" button and the list of
   recorded measurements, filterable by project / floor / flat. A QC Unit has
   no reliable key back to a VMS scope item, so the VMS item is only ever a
   deliberate pick, never auto-matched. Store Outward / Material Assigned to
   DRI integration is deferred to a later phase. */
export default function UnitExecutionWorkflow() {
  const { data, currentUserId, apply, toast, me } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const canCreate = isAdmin || hasModuleGrant(data, currentUserId, "unitExecution", "create");
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));

  const [workItems, setWorkItems] = useState<WorkItemsResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A non-OK reply (expired session, server error) used to be treated as
    // data and shown as a bare "unavailable"; now the real reason is kept.
    fetch(API_BASE + "/api/vms-work-items", { headers: authHeaders() })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || typeof j.available !== "boolean") {
          return { available: false, reason: (j && j.error) || `server replied ${r.status}` } as WorkItemsResponse;
        }
        return j as WorkItemsResponse;
      })
      .then((j) => { if (!cancelled) setWorkItems(j); })
      .catch(() => { if (!cancelled) setWorkItems({ available: false, reason: "could not reach the server" }); });
    return () => { cancelled = true; };
  }, []);

  const measurements = coll(data, "materialMeasurements").filter((m) => allowedProjectCodes.has(m.projectCode));

  const [panelOpen, setPanelOpen] = useState(false);
  const [fProjectId, setFProjectId] = useState("");
  // Floor / Flat only make sense inside one project — floor and unit names
  // repeat across projects ("Ground Floor", "Flat 1"), so both stay disabled
  // under "All projects" and reset whenever the project changes.
  const [fFloorId, setFFloorId] = useState("");
  const [fUnitId, setFUnitId] = useState("");

  const floorOptions = fProjectId ? projectFloors(data, fProjectId) : [];
  const unitOptions = fProjectId && fFloorId ? floorUnits(data, fProjectId, fFloorId) : [];
  const projectOptions = allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));

  const records = measurements
    .filter((m) => (!fProjectId || m.projectId === fProjectId) && (!fFloorId || m.floorId === fFloorId) && (!fUnitId || m.unitId === fUnitId))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="ruler" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Measurement</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Record measured quantity and material consumption by project, floor and flat, optionally linked to a VMS work item.
            </div>
          </div>
        </div>
        {canCreate && <Btn label="＋ New Measurement" color="primary" onClick={() => setPanelOpen(true)} />}
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectId} onChange={(v) => { setFProjectId(v); setFFloorId(""); setFUnitId(""); }} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
        <div className="max-w-[220px] min-w-[170px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
          <SearchDropdown
            searchable={false}
            value={fFloorId}
            onChange={(v) => { setFFloorId(v); setFUnitId(""); }}
            options={[{ value: "", label: "All floors" }, ...floorOptions.map((fl) => ({ value: fl.id, label: fl.name }))]}
            neutralActive
            disabled={!fProjectId}
          />
        </div>
        <div className="max-w-[220px] min-w-[170px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Flat / Unit</div>
          <SearchDropdown
            value={fUnitId}
            onChange={setFUnitId}
            options={[{ value: "", label: "All flats" }, ...unitOptions.map((u) => ({ value: u.id, label: u.name }))]}
            neutralActive
            disabled={!fFloorId}
          />
        </div>
      </Card>

      <Card padded={false} className="p-3 md:p-[18px]">
        {/* phones: one card per measurement instead of an 8-column table squeezed sideways */}
        <div className="md:hidden flex flex-col gap-2.5">
          {records.length === 0 && <div className="py-6 text-center text-[13px] text-[var(--text-muted)]">No measurements recorded yet.</div>}
          {records.map((m) => (
            <div key={m.id} className="border border-[var(--border)] rounded-radius-md p-3.5 bg-[var(--bg-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold leading-snug">{m.floorName} / {m.unitName}</div>
                  {m.itemDescription && (
                    <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
                      {m.itemDescription} · {m.itemIsCustom ? "Not in VMS" : m.workOrderNo}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
                <span>{m.measurementDate}</span>
                <span>{m.projectCode}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <div><span className="text-[var(--text-muted)]">Measured: </span><span className="font-semibold tabular-nums">{qty(m.measuredQty)} {m.measuredUnit}</span></div>
                <div><span className="text-[var(--text-muted)]">Consumed: </span><span className="font-semibold tabular-nums">{qty(m.materialConsumedQty)} {m.materialUnit}</span></div>
                <div className="col-span-2"><span className="text-[var(--text-muted)]">Unused/Wastage: </span><span className="font-semibold tabular-nums">{qty(m.unusedBalanceQty)} / {qty(m.wastageQty)} {m.materialUnit}</span></div>
              </div>
              {m.remarks && <div className="text-[11px] text-[var(--text-muted)] mt-1.5">{m.remarks}</div>}
              <div className="flex items-center justify-between gap-2 mt-2.5">
                <span className="text-[11.5px] text-[var(--text-muted)]">{m.recordedByName}</span>
                <ApprovalBadge approval={effectiveApproval(data, m)} />
              </div>
              <div className="mt-1"><ApprovalActions collName="materialMeasurements" record={m} /></div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <Table
            columns={["Date", "Project", "Floor / Unit", "VMS Item", "Measured Qty", "Material Consumed", "Unused / Wastage", "Recorded By"]}
            colAligns={["left", "left", "left", "left", "right", "right", "right", "left"]}
            maxHeight="560px"
            empty="No measurements recorded yet."
          >
            {records.map((m) => (
              <TableRow key={m.id}>
                <TableCell muted className="whitespace-nowrap">{m.measurementDate}</TableCell>
                <TableCell className="whitespace-nowrap">{m.projectCode}</TableCell>
                <TableCell strong className="whitespace-nowrap">{m.floorName} / {m.unitName}</TableCell>
                <TableCell>
                  {m.itemDescription
                    ? <>{m.itemDescription}<div className="text-[10.5px] text-[var(--text-muted)] font-normal">{m.itemIsCustom ? "Not in VMS (typed in)" : m.workOrderNo}</div></>
                    : <span className="text-[var(--text-sub)]">—</span>}
                  {m.remarks && <div className="text-[10.5px] text-[var(--text-muted)] font-normal max-w-[260px] truncate" title={m.remarks}>{m.remarks}</div>}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(m.measuredQty)} {m.measuredUnit}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(m.materialConsumedQty)} {m.materialUnit}</TableCell>
                <TableCell muted className="text-right tabular-nums whitespace-nowrap">{qty(m.unusedBalanceQty)} / {qty(m.wastageQty)} {m.materialUnit}</TableCell>
                <TableCell muted>
                  <div className="whitespace-nowrap">{m.recordedByName}</div>
                  <div className="mt-1"><ApprovalBadge approval={effectiveApproval(data, m)} /></div>
                  <ApprovalActions collName="materialMeasurements" record={m} />
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      </Card>

      <MeasurementForm
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        defaults={{ projectId: fProjectId, floorId: fFloorId, unitId: fUnitId }}
        existing={coll(data, "materialMeasurements")}
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
  open, onClose, defaults, existing, workItems, allProjects, currentUserId, recordedByName, apply, toast
}: {
  open: boolean; onClose: () => void;
  /** Starting selection (the page's current filters) — the person can change it. */
  defaults: { projectId: string; floorId: string; unitId: string };
  existing: MaterialMeasurement[];
  workItems: WorkItemsResponse | null;
  allProjects: { id: string; code: string; name: string }[];
  currentUserId: string | null; recordedByName: string;
  apply: (ops: any[]) => Promise<boolean>;
  toast: (msg: string) => void;
}) {
  const { data } = useApp();
  const [pProjectId, setPProjectId] = useState("");
  const [pFloorId, setPFloorId] = useState("");
  const [pUnitId, setPUnitId] = useState("");
  const [measurementDate, setMeasurementDate] = useState(todayStr());
  const [itemId, setItemId] = useState("");
  // A work item the person typed because it isn't in VMS.
  const [customItem, setCustomItem] = useState("");
  const [measuredQty, setMeasuredQty] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState("");
  const [customMeasuredUnit, setCustomMeasuredUnit] = useState(false);
  const [materialConsumedQty, setMaterialConsumedQty] = useState("");
  const [materialUnit, setMaterialUnit] = useState("");
  const [customMaterialUnit, setCustomMaterialUnit] = useState(false);
  const [unusedBalanceQty, setUnusedBalanceQty] = useState("");
  const [wastageQty, setWastageQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPProjectId(defaults.projectId); setPFloorId(defaults.floorId); setPUnitId(defaults.unitId);
    setMeasurementDate(todayStr());
    setItemId(""); setCustomItem("");
    setMeasuredQty(""); setMeasuredUnit(""); setCustomMeasuredUnit(false);
    setMaterialConsumedQty(""); setMaterialUnit(""); setCustomMaterialUnit(false);
    setUnusedBalanceQty(""); setWastageQty(""); setRemarks("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Project -> Floor -> Flat, chosen here (the page no longer has a unit
  // table to launch from). `prefill` is the resolved selection, or null
  // until all three are picked.
  const pProject = allProjects.find((p) => p.id === pProjectId) || null;
  const pFloors = pProject ? projectFloors(data, pProject.id) : [];
  const pFloor = pFloors.find((fl) => fl.id === pFloorId) || null;
  const pUnits = pProject && pFloor ? floorUnits(data, pProject.id, pFloor.id) : [];
  const pUnit = pUnits.find((u) => u.id === pUnitId) || null;
  const prefill: MeasurementPrefill | null = pProject && pFloor && pUnit
    ? { projectId: pProject.id, projectCode: pProject.code, projectName: pProject.name, floorId: pFloor.id, floorName: pFloor.name, unitId: pUnit.id, unitCode: pUnit.code, unitName: pUnit.name }
    : null;

  // VMS item picker — one searchable list of every item on this project's
  // VMS work orders (the Work Order is no longer a separate step; it's shown
  // in each option's label and still saved on the record, taken from the
  // chosen item). Still optional and manual-only, same as Work Quality
  // Inspection: a QC Unit has no reliable key back to a VMS scope-item, so
  // it is never auto-matched to the Unit selected in the table, only a
  // deliberate pick.
  const project = prefill ? allProjects.find((p) => p.id === prefill.projectId) || null : null;
  const projectEntry = (workItems && workItems.available && project)
    ? workItems.projects.find((p) => p.projectCode === project.code)
    : null;
  const projectItems = useMemo(
    () => (projectEntry ? projectEntry.workOrders.flatMap((w) => w.items.map((i) => ({ ...i, workOrderNo: w.workOrderNo }))) : []),
    [projectEntry]
  );
  const itemEntry = projectItems.find((i) => i.itemId === itemId) || null;

  async function save() {
    if (!prefill) { toast("Select the project, floor and flat first"); return; }
    const mQty = Number(measuredQty), mcQty = Number(materialConsumedQty);
    const ubQty = Number(unusedBalanceQty) || 0, wQty = Number(wastageQty) || 0;
    if (!measuredUnit.trim() || !materialUnit.trim()) { toast("Measured unit and material unit are required"); return; }
    if (!Number.isFinite(mQty) || mQty < 0) { toast("Measured quantity must be a non-negative number"); return; }
    if (!Number.isFinite(mcQty) || mcQty < 0) { toast("Material consumed quantity must be a non-negative number"); return; }
    if (ubQty < 0 || wQty < 0) { toast("Unused balance and wastage must be non-negative"); return; }

    setSaving(true);
    const id = nextId("MM", existing);
    const rec: MaterialMeasurement = {
      id,
      projectId: prefill.projectId, projectCode: prefill.projectCode, projectName: prefill.projectName,
      floorId: prefill.floorId, floorName: prefill.floorName,
      unitId: prefill.unitId, unitCode: prefill.unitCode, unitName: prefill.unitName,
      workOrderNo: !customItem && itemEntry ? itemEntry.workOrderNo : undefined,
      itemId: !customItem && itemEntry ? itemEntry.itemId : undefined,
      itemType: itemEntry?.itemType,
      itemDescription: customItem ? customItem : itemEntry?.description,
      itemIsCustom: customItem ? true : undefined,
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
      // a team member's measurement waits for their team leader (server re-derives this)
      approval: approvalFor(data, currentUserId),
      createdAt: Date.now()
    };
    const synced = await apply([
      { op: "upsert", coll: "materialMeasurements", rec },
      buildEventOp(currentUserId, "MATERIAL_MEASUREMENT", id, "", `Measurement · ${rec.unitName} · ${mQty} ${rec.measuredUnit}`)
    ]);
    setSaving(false);
    toast(synced ? "Measurement recorded" : "Saved on this device — will finish submitting once you're back online");
    onClose();
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="ruler" size={18} />}
      title="Record Measurement"
      desc={prefill ? `${prefill.projectCode} · ${prefill.floorName} / ${prefill.unitName}` : "Pick the project, floor and flat to measure."}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !prefill}>{saving ? "Saving…" : "Save Measurement"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Project *</label>
          <SearchDropdown
            value={pProjectId}
            onChange={(v) => { setPProjectId(v); setPFloorId(""); setPUnitId(""); setItemId(""); }}
            options={[{ value: "", label: "Select project…" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
        <div className="field">
          <label>Floor *</label>
          <SearchDropdown
            searchable={false}
            value={pFloorId}
            onChange={(v) => { setPFloorId(v); setPUnitId(""); }}
            options={[{ value: "", label: "Select floor…" }, ...pFloors.map((fl) => ({ value: fl.id, label: fl.name }))]}
            disabled={!pProjectId}
          />
        </div>
        <div className="field">
          <label>Flat / Unit *</label>
          <SearchDropdown
            value={pUnitId}
            onChange={setPUnitId}
            options={[{ value: "", label: "Select flat…" }, ...pUnits.map((u) => ({ value: u.id, label: u.name }))]}
            disabled={!pFloorId}
          />
        </div>
        <div className="field">
          <label>Measurement Date *</label>
          <input className="input" type="date" value={measurementDate} onChange={(e) => setMeasurementDate(e.target.value)} />
        </div>
        <div className="field">
          <label>VMS Work Item (optional)</label>
          <SearchDropdown
            value={customItem ? CUSTOM_ITEM : itemId}
            disabled={!project}
            onChange={(id) => {
              if (id === CUSTOM_ITEM) return; // re-picking the typed entry — nothing to change
              setCustomItem("");
              setItemId(id);
              const picked = projectItems.find((i) => i.itemId === id);
              if (picked && !measuredUnit) setMeasuredUnit(picked.unit);
            }}
            // Type something that isn't listed and an 'Add "…"' row appears.
            onCreate={(text) => { setCustomItem(text); setItemId(""); }}
            options={[
              { value: "", label: "Select or type a work item…" },
              ...(customItem ? [{ value: CUSTOM_ITEM, label: `${customItem} (added by you)` }] : []),
              ...projectItems.map((i) => ({
                value: i.itemId,
                label: `${i.itemType === "subItem" ? "↳ " : ""}${i.description} · ${i.workOrderNo} (${i.unit})`
              }))
            ]}
          />
          {workItems && !workItems.available && (
            <div className="text-[11px] text-[var(--color-fail)] mt-1">VMS work items unavailable ({workItems.reason}) — you can still type one.</div>
          )}
          {workItems && workItems.available && !!project && projectItems.length === 0 && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">No VMS items for this project — type one in the search box.</div>
          )}
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
          {!customMeasuredUnit ? (
            <select
              className="select"
              value={MEASUREMENT_UNITS.includes(measuredUnit) ? measuredUnit : ""}
              onChange={(e) => {
                if (e.target.value === "__other__") { setCustomMeasuredUnit(true); setMeasuredUnit(""); }
                else setMeasuredUnit(e.target.value);
              }}
            >
              <option value="">Select unit…</option>
              {MEASUREMENT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="__other__">Other…</option>
            </select>
          ) : (
            <div className="flex gap-1.5">
              <input className="input" value={measuredUnit} onChange={(e) => setMeasuredUnit(e.target.value)} placeholder="Type unit" autoFocus />
              <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => { setCustomMeasuredUnit(false); setMeasuredUnit(""); }}>List</button>
            </div>
          )}
        </div>

        <div className="field">
          <label>Material Consumed *</label>
          <input className="input" type="number" min="0" value={materialConsumedQty} onChange={(e) => setMaterialConsumedQty(e.target.value)} />
        </div>
        <div className="field">
          <label>Material Unit *</label>
          {!customMaterialUnit ? (
            <select
              className="select"
              value={MEASUREMENT_UNITS.includes(materialUnit) ? materialUnit : ""}
              onChange={(e) => {
                if (e.target.value === "__other__") { setCustomMaterialUnit(true); setMaterialUnit(""); }
                else setMaterialUnit(e.target.value);
              }}
            >
              <option value="">Select unit…</option>
              {MEASUREMENT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value="__other__">Other…</option>
            </select>
          ) : (
            <div className="flex gap-1.5">
              <input className="input" value={materialUnit} onChange={(e) => setMaterialUnit(e.target.value)} placeholder="Type unit" autoFocus />
              <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => { setCustomMaterialUnit(false); setMaterialUnit(""); }}>List</button>
            </div>
          )}
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
