import React, { useEffect, useMemo, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll, myProjects, projectFloors, projectUnits, floorUnits } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import { approvalFor, effectiveApproval } from "../shared/approval";
import { ApprovalBadge, ApprovalActions } from "../components/ApprovalControls";
import SidePanel from "../components/SidePanel";
import StatTile from "../components/StatTile";
import PhotoGroupUploader from "../components/PhotoGroupUploader";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { Photo, WorkMeasurement } from "../types";

interface Candidate {
  workOrderNo: string; workOrderCategory: string; itemId: string; itemType: "scopeItem" | "subItem";
  description: string; unit: string; plannedQty: number; matchedOn: string; matchedEntryCount: number; executedQtyAtLocation: number; executedQtyTotal?: number;
}
interface MatchResponse {
  available: boolean; reason?: string; status: "unique" | "ambiguous" | "none"; candidates: Candidate[]; categoryItems?: Candidate[];
}
interface Comparison {
  found: boolean; executedQty?: number; executedUnit?: string; plannedQty?: number; matchedEntryCount?: number;
  comparable?: boolean; variance?: number | null; variancePct?: number | null;
}

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Common construction-measurement units — a fixed dropdown instead of free
// text avoids typos/inconsistent spelling (e.g. "sqft" vs "sq.ft") that
// would otherwise silently break the VMS comparison's unit match. "Other"
// still allows a value outside this list, since VMS's own scope-item units
// aren't a fixed, enumerable set either.
const MEASUREMENT_UNITS = ["sq.ft", "R.ft", "Rmt", "Cum", "Sqm", "Kg", "MT", "Nos", "Bag", "Ltr"];
const loc = (l: WorkMeasurement["location"]) =>
  [l.tower && `Tower ${l.tower}`, l.floor && `Floor ${l.floor}`, l.flat && `Flat ${l.flat}`, l.area].filter(Boolean).join(" · ") || "—";

const REASON: Record<string, string> = {
  NO_CATEGORY: "Pick a work category to look for a VMS match.",
  NO_LOCATION: "Enter at least one of tower / floor / flat / area to look for a VMS match.",
  NO_CATEGORY_MATCH: "No VMS scope item has this category for this project.",
  NO_LOCATION_MATCH: "VMS has this category, but no progress is recorded at this location.",
  PROJECT_NOT_IN_VMS: "This project isn't in VMS."
};

async function postMatch(body: unknown): Promise<MatchResponse> {
  const r = await fetch(API_BASE + "/api/work-measurements/match", {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body)
  });
  return r.json();
}

/* Measurement — an independently measured quantity per Project →
   Tower/Floor/Flat/Area → Work Category. The engineer never enters a Work
   Order number: the server matches the measurement to a VMS scope item from
   project + category + location (see backend/workMeasurementRules.js for
   exactly what is and isn't matched, and why category alone never is).
   Reference-only — saving a measurement changes nothing in VMS, billing,
   approvals or quality statuses. */
export default function Measurement() {
  const { data, currentUserId, apply, toast, me } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const canCreate = isAdmin || hasModuleGrant(data, currentUserId, "measurement", "create");
  const allProjects = myProjects(data, currentUserId);
  // `useMemo` was imported but never actually used — this filter+sort (and
  // the shown/linkedCount/needsConfirm/unlinked ones below) re-ran on every
  // render, including a keystroke in an unrelated field, instead of only
  // when the measurements themselves (or the filters) change.
  const measurements = useMemo(() => {
    const allowedCodes = new Set(allProjects.map((p) => p.code));
    return coll(data, "workMeasurements")
      .filter((m) => allowedCodes.has(m.projectCode))
      .sort((a, b) => b.createdAt - a.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, currentUserId]);

  const [fProjectId, setFProjectId] = useState("");
  const [fLink, setFLink] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirming, setConfirming] = useState<WorkMeasurement | null>(null);

  const [categories, setCategories] = useState<{ name: string; group: string }[]>([]);
  const [categoriesNote, setCategoriesNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(API_BASE + "/api/work-measurements/categories", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.available) setCategories(j.categories); else setCategoriesNote(j.reason || "VMS categories unavailable");
      })
      .catch(() => { if (!cancelled) setCategoriesNote("Failed to load VMS categories"); });
    return () => { cancelled = true; };
  }, []);

  // Live execution (VMS) vs measured — re-read whenever a link changes.
  const linkKey = measurements.map((m) => m.id + ":" + (m.linkedItemId || "")).join(",");
  const [comparisons, setComparisons] = useState<Record<string, Comparison>>({});
  const [comparisonNote, setComparisonNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(API_BASE + "/api/work-measurements/comparison", { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setComparisons(j.byId || {});
        setComparisonNote(j.available === false ? (j.reason || "VMS data unavailable") : null);
      })
      .catch(() => { if (!cancelled) setComparisonNote("Failed to load VMS execution data"); });
    return () => { cancelled = true; };
  }, [linkKey]);

  const shown = useMemo(() => measurements.filter((m) => {
    if (fProjectId && m.projectId !== fProjectId) return false;
    if (fLink === "linked" && !(m.linkStatus === "auto" || m.linkStatus === "confirmed")) return false;
    if (fLink && fLink !== "linked" && m.linkStatus !== fLink) return false;
    return true;
  }), [measurements, fProjectId, fLink]);
  const { linkedCount, needsConfirm, unlinked } = useMemo(() => ({
    linkedCount: measurements.filter((m) => m.linkStatus === "auto" || m.linkStatus === "confirmed").length,
    needsConfirm: measurements.filter((m) => m.linkStatus === "ambiguous").length,
    unlinked: measurements.filter((m) => m.linkStatus === "unmatched").length
  }), [measurements]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="ruler" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Measurement</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal max-w-[760px]">
              Record an independently measured quantity by project, location and work category — no Work Order number needed.
              It is matched to the VMS scope item automatically only when exactly one fits; the record is reference-only and never changes billing, approvals or quality status.
            </div>
          </div>
        </div>
        {canCreate && <Btn label="＋ New Measurement" color="primary" onClick={() => setPanelOpen(true)} />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Measurements" value={measurements.length} icon="ruler" />
        <StatTile label="Linked to VMS" value={linkedCount} icon="layers" />
        <StatTile label="Needs Confirmation" value={needsConfirm} icon="clock" valueClassName={needsConfirm > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Unlinked" value={unlinked} icon="package" />
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
        <div className="max-w-[260px] min-w-[200px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectId} onChange={setFProjectId} options={[{ value: "", label: "All projects" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]} neutralActive />
        </div>
        <div className="max-w-[220px] min-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">VMS link</div>
          <SearchDropdown searchable={false} value={fLink} onChange={setFLink} neutralActive options={[
            { value: "", label: "All" }, { value: "linked", label: "Linked" }, { value: "ambiguous", label: "Needs confirmation" }, { value: "unmatched", label: "Unlinked" }
          ]} />
        </div>
      </Card>
      {comparisonNote && <div className="text-[12px] text-[var(--text-muted)] mb-3">VMS execution figures unavailable: {comparisonNote}</div>}

      <Card padded={false} className="mb-5 p-3 md:p-[18px]">
        {/* phones: one card per measurement instead of a 10-column table squeezed sideways */}
        <div className="md:hidden flex flex-col gap-2.5">
          {shown.length === 0 && <div className="py-6 text-center text-[13px] text-[var(--text-muted)]">No measurements recorded yet.</div>}
          {shown.map((m) => {
            const c = m.linkedItemId ? comparisons[m.id] : undefined;
            return (
              <div key={m.id} className="border border-[var(--border)] rounded-radius-md p-3.5 bg-[var(--bg-card)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-snug">{m.category}</div>
                    <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{loc(m.location)}</div>
                  </div>
                  <LinkBadge m={m} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
                  <span>{m.measurementDate}</span>
                  <span>{m.projectCode}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  <div><span className="text-[var(--text-muted)]">Measured: </span><span className="font-semibold tabular-nums">{qty(m.measuredQty)} {m.measuredUnit}</span></div>
                  <div><span className="text-[var(--text-muted)]">Planned (VMS): </span><span className="font-semibold tabular-nums">{c?.found ? <>{qty(c.plannedQty || 0)} {c.executedUnit}</> : "—"}</span></div>
                  <div><span className="text-[var(--text-muted)]">VMS executed: </span><span className="font-semibold tabular-nums">{c?.found ? <>{qty(c.executedQty || 0)} {c.executedUnit}</> : "—"}</span></div>
                  <div>
                    <span className="text-[var(--text-muted)]">Difference: </span>
                    <span className="font-semibold tabular-nums">
                      {c?.found
                        ? (c.comparable
                          ? <span style={{ color: (c.variance || 0) === 0 ? undefined : "var(--color-fail)" }}>
                              {(c.variance || 0) > 0 ? "+" : ""}{qty(c.variance || 0)}{c.variancePct != null ? ` (${c.variancePct}%)` : ""}
                            </span>
                          : "Units differ")
                        : "—"}
                    </span>
                  </div>
                </div>
                {m.linkedItemId && <div className="text-[10.5px] text-[var(--text-muted)] mt-1.5">{m.linkedWorkOrderNo} · {m.linkedItemDescription}</div>}
                {!m.linkedItemId && m.linkNote && <div className="text-[10.5px] text-[var(--text-muted)] mt-1.5">{REASON[m.linkNote] || m.linkNote}</div>}
                <div className="flex items-center justify-between gap-2 mt-2.5">
                  <ApprovalBadge approval={effectiveApproval(data, m)} />
                  {m.linkStatus === "ambiguous" && canCreate && <Btn label="Choose link" color="secondary" size="sm" onClick={() => setConfirming(m)} />}
                </div>
                <div className="mt-1.5"><ApprovalActions collName="workMeasurements" record={m} /></div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block">
          <Table
            columns={["Date", "Project", "Location", "Category", "Measured", "Planned (VMS)", "VMS executed (here)", "Difference", "VMS link", ""]}
            colAligns={["left", "left", "left", "left", "right", "right", "right", "right", "left", "left"]}
            maxHeight="560px"
            empty="No measurements recorded yet."
          >
            {shown.map((m) => {
              const c = m.linkedItemId ? comparisons[m.id] : undefined;
              return (
                <TableRow key={m.id}>
                  <TableCell muted className="whitespace-nowrap">{m.measurementDate}</TableCell>
                  <TableCell className="whitespace-nowrap">{m.projectCode}</TableCell>
                  <TableCell>{loc(m.location)}</TableCell>
                  <TableCell strong>{m.category}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {qty(m.measuredQty)} {m.measuredUnit}
                    {m.dimensions && Object.values(m.dimensions).some((v) => v != null) && (
                      <div className="text-[10.5px] text-[var(--text-muted)] font-normal">
                        {([["L", m.dimensions.length], ["W", m.dimensions.width], ["H", m.dimensions.height], ["T", m.dimensions.thickness]] as const)
                          .filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(" × ")}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {c?.found ? <>{qty(c.plannedQty || 0)} {c.executedUnit}</> : <span className="text-[var(--text-sub)]">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {c?.found ? <>{qty(c.executedQty || 0)} {c.executedUnit}</> : <span className="text-[var(--text-sub)]">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {c?.found
                      ? (c.comparable
                        ? <span style={{ color: (c.variance || 0) === 0 ? undefined : "var(--color-fail)", fontWeight: 600 }}>
                            {(c.variance || 0) > 0 ? "+" : ""}{qty(c.variance || 0)}{c.variancePct != null ? ` (${c.variancePct}%)` : ""}
                          </span>
                        : <span className="text-[var(--text-sub)]" title="Measured and VMS units differ, so no difference is computed">Units differ</span>)
                      : <span className="text-[var(--text-sub)]">—</span>}
                  </TableCell>
                  <TableCell>
                    <LinkBadge m={m} />
                    {m.linkedItemId && <div className="text-[10.5px] text-[var(--text-muted)] mt-1">{m.linkedWorkOrderNo} · {m.linkedItemDescription}</div>}
                    {!m.linkedItemId && m.linkNote && <div className="text-[10.5px] text-[var(--text-muted)] mt-1 max-w-[220px] whitespace-normal">{REASON[m.linkNote] || m.linkNote}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <ApprovalBadge approval={effectiveApproval(data, m)} />
                      <ApprovalActions collName="workMeasurements" record={m} />
                    </div>
                    {m.linkStatus === "ambiguous" && canCreate && <Btn label="Choose link" color="secondary" size="sm" onClick={() => setConfirming(m)} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </Table>
        </div>
      </Card>

      <MeasurementPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        categories={categories}
        categoriesNote={categoriesNote}
        existing={coll(data, "workMeasurements")}
        apply={apply}
        toast={toast}
        userId={currentUserId || ""}
        userName={me()?.name || ""}
      />
      <ConfirmLinkPanel
        record={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={async (itemId) => {
          if (!confirming) return;
          const synced = await apply([
            { op: "upsert", coll: "workMeasurements", rec: { ...confirming, linkedItemId: itemId } },
            buildEventOp(currentUserId, "WORK_MEASUREMENT_LINK", confirming.id, "", `Link confirmed · ${confirming.category}`)
          ]);
          toast(synced ? "VMS link confirmed" : "Saved on this device — will finish submitting once you're back online");
          setConfirming(null);
        }}
      />
    </div>
  );
}

function LinkBadge({ m }: { m: WorkMeasurement }) {
  if (m.linkStatus === "auto") return <Badge color="green"><span className="whitespace-nowrap">Linked (auto)</span></Badge>;
  if (m.linkStatus === "confirmed") return <Badge color="green"><span className="whitespace-nowrap">Linked (confirmed)</span></Badge>;
  if (m.linkStatus === "ambiguous") return <Badge color="amber"><span className="whitespace-nowrap">Needs confirmation</span></Badge>;
  return <Badge color="gray"><span className="whitespace-nowrap">Unlinked</span></Badge>;
}

function CandidateList({ candidates, value, onChange, allowLater }: {
  candidates: Candidate[]; value: string | null; onChange: (v: string) => void; allowLater?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {candidates.map((c) => (
        <label key={c.itemId} className="flex gap-2 items-start text-[12px] border border-[var(--border)] rounded-radius-sm px-2.5 py-2 cursor-pointer">
          <input type="radio" name="vms-candidate" checked={value === c.itemId} onChange={() => onChange(c.itemId)} className="mt-0.5" />
          <span>
            <b>{c.workOrderNo}</b> · {c.description}
            <span className="text-[var(--text-muted)]"> — Planned: {qty(c.plannedQty || 0)} {c.unit} · Executed here: {qty(c.executedQtyAtLocation)} {c.unit}</span>
            <span className="block text-[10.5px] text-[var(--text-muted)]">{c.workOrderCategory || "no category"} · matched on {c.matchedOn === "itemDescription" ? "item name" : "work-order category"}</span>
          </span>
        </label>
      ))}
      {allowLater && (
        <label className="flex gap-2 items-center text-[12px] border border-dashed border-[var(--border)] rounded-radius-sm px-2.5 py-2 cursor-pointer">
          <input type="radio" name="vms-candidate" checked={value === ""} onChange={() => onChange("")} />
          Don't link now — keep unlinked and confirm later
        </label>
      )}
    </div>
  );
}

function ConfirmLinkPanel({ record, onClose, onConfirm }: {
  record: WorkMeasurement | null; onClose: () => void; onConfirm: (itemId: string) => Promise<void>;
}) {
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMatch(null); setChoice(null);
    if (!record) return;
    let cancelled = false;
    postMatch(record).then((j) => { if (!cancelled) setMatch(j); }).catch(() => { if (!cancelled) setMatch({ available: false, reason: "Failed to load", status: "none", candidates: [] }); });
    return () => { cancelled = true; };
  }, [record]);

  return (
    <SidePanel
      open={!!record}
      icon={<NavIcon name="layers" size={18} />}
      title="Choose the VMS item"
      desc={record ? `${record.projectCode} · ${loc(record.location)} · ${record.category}` : ""}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!choice || busy} onClick={async () => { setBusy(true); await onConfirm(choice!); setBusy(false); }}>Confirm link</button>
        </>
      }
    >
      {!match && <div className="text-[13px] text-[var(--text-muted)]">Looking up VMS…</div>}
      {match && match.status === "ambiguous" && (
        <>
          <div className="text-[12.5px] mb-3">More than one VMS item fits this measurement. Pick the one it belongs to:</div>
          <CandidateList candidates={match.candidates} value={choice} onChange={setChoice} />
        </>
      )}
      {match && match.status !== "ambiguous" && (
        <div className="text-[12.5px] text-[var(--text-muted)]">
          {match.status === "unique" ? "VMS data has changed — exactly one item fits now. Re-saving this record will link it automatically." : (match.reason && REASON[match.reason]) || match.reason || "No VMS match."}
        </div>
      )}
    </SidePanel>
  );
}

function MeasurementPanel({ open, onClose, categories, categoriesNote, existing, apply, toast, userId, userName }: {
  open: boolean; onClose: () => void; categories: { name: string; group: string }[]; categoriesNote: string | null;
  existing: WorkMeasurement[]; apply: (ops: any[]) => Promise<any>; toast: (m: string) => void; userId: string; userName: string;
}) {
  const { data, currentUserId } = useApp();
  const projects = myProjects(data, currentUserId);
  const today = new Date().toISOString().slice(0, 10);

  const [projectId, setProjectId] = useState("");
  const [tower, setTower] = useState("");
  const [floor, setFloor] = useState("");
  const [flat, setFlat] = useState("");
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [measuredQty, setMeasuredQty] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState("");
  const [customUnit, setCustomUnit] = useState(false);
  const [dim, setDim] = useState({ length: "", width: "", height: "", thickness: "" });
  const [measurementDate, setMeasurementDate] = useState(today);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [matching, setMatching] = useState(false);
  const [choice, setChoice] = useState<string | null>(null); // null = undecided, "" = link later

  useEffect(() => {
    if (!open) return;
    setProjectId(""); setTower(""); setFloor(""); setFlat(""); setArea(""); setCategory("");
    setMeasuredQty(""); setMeasuredUnit(""); setCustomUnit(false); setDim({ length: "", width: "", height: "", thickness: "" });
    setMeasurementDate(today); setPhotos([]); setRemarks(""); setMatch(null); setChoice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const project = projects.find((p) => p.id === projectId) || null;
  const projectFloorList = project ? projectFloors(data, project.id) : [];
  // Flat/Unit cascades from the selected Floor (by real QC Floor->Unit
  // structure) when one is picked; otherwise every unit in the project, so
  // picking a flat is still possible even if Floor is left blank.
  const selectedFloorRec = project ? projectFloorList.find((f) => f.name === floor) || null : null;
  const flatOptionList = project
    ? (selectedFloorRec ? floorUnits(data, project.id, selectedFloorRec.id) : projectUnits(data, project.id))
    : [];
  const hasLocation = !!(tower.trim() || floor.trim() || flat.trim() || area.trim());

  // Live VMS match preview — debounced; the server re-checks it on save.
  useEffect(() => {
    setChoice(null);
    if (!open || !project || !category || !hasLocation) { setMatch(null); setMatching(false); return; }
    let cancelled = false;
    setMatching(true);
    const t = setTimeout(() => {
      postMatch({ projectCode: project.code, category, location: { tower: tower.trim(), floor: floor.trim(), flat: flat.trim(), area: area.trim() } })
        .then((j) => { if (!cancelled) { setMatch(j); setMatching(false); } })
        .catch(() => { if (!cancelled) { setMatch({ available: false, reason: "Failed to reach VMS", status: "none", candidates: [] }); setMatching(false); } });
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, project?.code, category, tower, floor, flat, area]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!project) { toast("Select a project"); return; }
    if (!category) { toast("Select a work category"); return; }
    if (!hasLocation) { toast("Enter at least one of tower / floor / flat / area"); return; }
    const q = Number(measuredQty);
    if (measuredQty.trim() === "" || !Number.isFinite(q) || q < 0) { toast("Measured quantity must be a non-negative number"); return; }
    if (!measuredUnit.trim()) { toast("Unit is required"); return; }
    const dimensions: Record<string, number> = {};
    for (const k of ["length", "width", "height", "thickness"] as const) {
      if ((dim[k] as string).trim() === "") continue;
      const v = Number(dim[k]);
      if (!Number.isFinite(v) || v < 0) { toast(`Dimension "${k}" must be a non-negative number`); return; }
      dimensions[k] = v;
    }
    if (match?.status === "ambiguous" && choice === null) { toast("Several VMS items fit — choose one, or 'Don't link now'"); return; }

    setSaving(true);
    const id = nextId("WM", existing);
    const rec: WorkMeasurement = {
      id,
      projectId: project.id, projectCode: project.code, projectName: project.name,
      location: { tower: tower.trim(), floor: floor.trim(), flat: flat.trim(), area: area.trim() },
      category,
      measurementDate,
      measuredQty: q, measuredUnit: measuredUnit.trim(),
      dimensions: Object.keys(dimensions).length ? dimensions : undefined,
      photos,
      remarks: remarks.trim() || undefined,
      recordedByUserId: userId, recordedByName: userName,
      createdAt: Date.now(),
      // a team member's measurement waits for their team leader (server re-derives this)
      approval: approvalFor(data, userId),
      // Only a person's explicit pick is proposed; the server decides the link.
      linkedItemId: match?.status === "ambiguous" && choice ? choice : null
    };
    try {
      const synced = await apply([
        { op: "upsert", coll: "workMeasurements", rec },
        buildEventOp(userId, "WORK_MEASUREMENT", id, "", `Measurement · ${category} · ${q} ${rec.measuredUnit}`)
      ]);
      toast(synced ? "Measurement recorded" : "Saved on this device — will finish submitting once you're back online");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="ruler" size={18} />}
      title="New Measurement"
      desc="Project → location → work category. No Work Order number needed."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Measurement"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Project *</label>
          <SearchDropdown value={projectId} onChange={setProjectId} options={[{ value: "", label: "Select project…" }, ...projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]} />
        </div>
        <div className="field">
          <label>Tower</label>
          <input className="input" value={tower} onChange={(e) => setTower(e.target.value)} placeholder="e.g. A" />
        </div>
        <div className="field">
          <label>Floor</label>
          <select className="select" value={floor} disabled={!project} onChange={(e) => { setFloor(e.target.value); setFlat(""); }}>
            <option value="">Select floor…</option>
            {projectFloorList.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Flat / Unit</label>
          <select className="select" value={flat} disabled={!project} onChange={(e) => setFlat(e.target.value)}>
            <option value="">Select flat/unit…</option>
            {flatOptionList.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Area / Plot</label>
          <input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Villa 76-81, boundary wall" />
        </div>
        <div className="text-[11px] text-[var(--text-muted)] full" style={{ gridColumn: "1 / -1", marginTop: -4 }}>
          Fill at least one. Each one you fill must agree with what VMS recorded for the link to be made.
        </div>

        <div className="field full">
          <label>Work Category *</label>
          <SearchDropdown value={category} onChange={setCategory} options={[{ value: "", label: "Select category…" }, ...categories.map((c) => ({ value: c.name, label: c.name, group: c.group }))]} />
          {categoriesNote && <div className="text-[11px] text-[var(--text-muted)] mt-1">VMS categories unavailable: {categoriesNote}</div>}
        </div>

        <MatchPreview match={match} matching={matching} ready={!!project && !!category && hasLocation} choice={choice} setChoice={setChoice} />

        <div className="field">
          <label>Measured Quantity *</label>
          <input className="input" type="number" min={0} step="any" value={measuredQty} onChange={(e) => setMeasuredQty(e.target.value)} />
        </div>
        <div className="field">
          <label>Unit *</label>
          {!customUnit ? (
            <select
              className="select"
              value={MEASUREMENT_UNITS.includes(measuredUnit) ? measuredUnit : ""}
              onChange={(e) => {
                if (e.target.value === "__other__") { setCustomUnit(true); setMeasuredUnit(""); }
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
              <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => { setCustomUnit(false); setMeasuredUnit(""); }}>List</button>
            </div>
          )}
        </div>
        {(["length", "width", "height", "thickness"] as const).map((k) => (
          <div className="field" key={k}>
            <label style={{ textTransform: "capitalize" }}>{k} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span></label>
            <input className="input" type="number" min={0} step="any" value={dim[k]} onChange={(e) => setDim({ ...dim, [k]: e.target.value })} />
          </div>
        ))}
        <div className="field">
          <label>Measurement Date *</label>
          <input className="input" type="date" value={measurementDate} onChange={(e) => setMeasurementDate(e.target.value)} />
        </div>
        <div className="field full">
          <label>Photos</label>
          <PhotoGroupUploader label="Measurement photos" photos={photos} onChange={setPhotos} optional />
        </div>
        <div className="field full">
          <label>Remarks</label>
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
    </SidePanel>
  );
}

function MatchPreview({ match, matching, ready, choice, setChoice }: {
  match: MatchResponse | null; matching: boolean; ready: boolean; choice: string | null; setChoice: (v: string) => void;
}) {
  const box = "full rounded-radius-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5 text-[12px]";
  const style = { gridColumn: "1 / -1" } as const;
  if (!ready) return <div className={box} style={style}><b>VMS link:</b> <span className="text-[var(--text-muted)]">choose project, location and category to look for a match.</span></div>;
  if (matching || !match) return <div className={box} style={style}><b>VMS link:</b> <span className="text-[var(--text-muted)]">looking up VMS…</span></div>;
  if (!match.available) return <div className={box} style={style}><b>VMS link:</b> <span className="text-[var(--text-muted)]">VMS unavailable ({match.reason}) — will be saved unlinked.</span></div>;
  if (match.status === "unique") {
    const c = match.candidates[0];
    return (
      <div className={box} style={style}>
        <b style={{ color: "#16a34a" }}>Will auto-link</b> to <b>{c.workOrderNo}</b> · {c.description}
        <div className="text-[var(--text-muted)] mt-0.5">Planned: {qty(c.plannedQty || 0)} {c.unit} · Executed at this location: {qty(c.executedQtyAtLocation)} {c.unit}</div>
      </div>
    );
  }
  if (match.status === "ambiguous") {
    return (
      <div className={box} style={style}>
        <b style={{ color: "#d97706" }}>{match.candidates.length} VMS items fit — please confirm</b>
        <div className="mt-2"><CandidateList candidates={match.candidates} value={choice} onChange={setChoice} allowLater /></div>
      </div>
    );
  }
  return (
    <div className={box} style={style}>
      <b>No VMS match — will be saved unlinked.</b>
      <div className="text-[var(--text-muted)] mt-0.5">{(match.reason && REASON[match.reason]) || "Nothing in VMS fits."} You can still record the measurement.</div>
      {match.categoryItems && match.categoryItems.length > 0 && (
        <div className="mt-2">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">VMS items for this category — for reference, not linked</div>
          <div className="flex flex-col gap-1">
            {match.categoryItems.slice(0, 6).map((c) => (
              <div key={c.itemId} className="text-[12px]">
                <b>{c.workOrderNo}</b> · {c.description}
                <span className="text-[var(--text-muted)]"> — Planned: {qty(c.plannedQty || 0)} {c.unit} · Executed so far (all locations): {qty(c.executedQtyTotal || 0)} {c.unit}</span>
              </div>
            ))}
            {match.categoryItems.length > 6 && <div className="text-[11px] text-[var(--text-muted)]">+{match.categoryItems.length - 6} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}
