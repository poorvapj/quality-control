import React, { useEffect, useMemo, useRef, useState } from "react";
import { type DateRange, DATE_RANGES, dateRangeBounds } from "../shared/dateRange";
import CalendarRangePicker from "../components/CalendarRangePicker";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll, myProjects, projectFloors, floorUnits, byId } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import { approvalFor, effectiveApproval } from "../shared/approval";
import { ApprovalBadge, ApprovalActions, ApprovalReviewPanel } from "../components/ApprovalControls";
import PhotoGroupUploader from "../components/PhotoGroupUploader";
import SidePanel from "../components/SidePanel";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { Op, Photo, QualityInspection as QI, QualityInspectionResult, Severity, Snag, TabKey } from "../types";

interface VmsWorkItem { itemId: string; itemType: "scopeItem" | "subItem"; parentItemId: string | null; description: string; unit: string }
interface VmsWorkOrderEntry { workOrderNo: string; items: VmsWorkItem[] }
interface VmsProjectEntry { projectCode: string; projectName: string; workOrders: VmsWorkOrderEntry[] }
type WorkItemsResponse = { available: false; reason: string } | { available: true; projects: VmsProjectEntry[] };

const RESULTS: QualityInspectionResult[] = ["Pass", "Fail", "Rework Required"];
const SEVERITIES: Severity[] = ["Critical", "Major", "Minor"];
const CHECKLIST_STATUSES = ["OK", "Not OK", "N/A"] as const;
const todayStr = () => new Date().toISOString().slice(0, 10);

// Checklists that aren't split into timed phases — one flat list, same as
// always. Keyed by the checklist's own title, used as both the "Work Type"
// picker's value and the record's `workType`.
const STANDALONE_CHECKLISTS: Record<string, string[]> = {
  "Material Testing & Quality Checks": [
    "Concrete strength: verify approved mix design, sampling, cube/cylinder casting, identification, curing, and compressive-strength test reports.",
    "Sand: check grading/particle size, silt content, cleanliness, and compliance with approved specifications.",
    "Coarse aggregate (metal): check nominal size, grading, shape/flakiness, cleanliness, and approved test results.",
    "Bricks — strength: verify compressive-strength test results and compliance with specifications.",
    "Bricks — water absorption: check water absorption test results as per applicable standards.",
    "Other required material tests: verify test certificates and approvals before use."
  ],
  "Column Inspection": [
    "Location and dimensions: confirm column position, size, and orientation against approved structural drawings.",
    "Reinforcement steel: verify bar diameter, number, spacing, lap/development length, anchorage, and stirrup spacing.",
    "Concrete cover: check specified cover blocks and required clear cover on all sides.",
    "Shuttering/formwork: verify dimensions, line, level, verticality, rigidity, joints, cleanliness, and application of release agent.",
    "Plumb: check column verticality before concreting and recheck as required."
  ],
  "Tile Work Inspection": [
    "Floor level and slope: verify finished levels and required slope toward floor traps/drains in wet areas.",
    "Tile condition: check tiles for cracks, chips, scratches, stains, and other visible defects before laying.",
    "Base surface: confirm the substrate is sound, clean, level/appropriately sloped, and free of loose material.",
    "Joints and gaps: check uniform joint width, alignment, spacers, and approved grout/filler.",
    "Hollow tiles and finish: tap-test for hollow areas where appropriate; check lippage, cutting, edge finish, and skirting alignment.",
    "Protection and cleaning: clean grout residue and protect finished tiles from damage until handover."
  ],
  "Finishing & Handover Inspection": [
    "All punch list items from earlier stages closed: zero open NCRs, verified by Quality Inspector.",
    "Doors & windows: smooth operation, gaps under 5mm on all sides, locks functional.",
    "All fixtures working: taps, switches, fans, geysers tested — no snag.",
    "Flooring: no hollow tiles, clean grout — 100% tap test on all floor tiles, uniform grout joints.",
    "Paint: no peeling, uniform finish, no patches — visual check in daylight; touch-up not acceptable over peeling.",
    "Customer walkthrough checklist signed: customer signs, any observation noted and resolved before possession."
  ]
};

interface PhaseDef { label: string; items: string[] }
interface PhaseGroup { name: string; scope: "floor" | "unit" | "unit-area"; phases: PhaseDef[] }

// The remaining checklists are split into the site's own timed phases
// (before/during/after a physical event — a pour, brickwork, plastering,
// waterproofing application, panel installation…), each its own entry in
// the Work Type picker ("<group> — <phase>"), and each phase can only be
// filled once the one before it has a Pass on record for the same
// floor/flat (see phaseInfo/pendingPriorPhase below) — all the existing
// checkpoints are kept, just grouped under whichever phase they belong to.
const PHASE_GROUPS: PhaseGroup[] = [
  {
    name: "R.C.C. Slab Inspection",
    scope: "floor",
    phases: [
      {
        label: "Before Pour",
        items: [
          "Shuttering check: verify slab level, thickness, dimensions, support/props, stability, tight joints, and cleanliness.",
          "Reinforcement steel: check bar diameter, spacing, top and bottom reinforcement, extra bars, laps, anchorage, and openings as per drawings.",
          "Cover and embedded services: verify cover blocks, electrical conduits, sleeves, and other inserts do not displace reinforcement.",
          "Pre-pour approval: confirm inspection clearance, concrete grade, pour sequence, access, and curing arrangements."
        ]
      },
      {
        label: "During Pour",
        items: [
          "Slump test at pour point: record the value and reject the batch if it falls outside the design mix range.",
          "Cube samples taken: minimum 3 cubes per 5 cum, labelled with floor and date.",
          "Vibration done correctly: poker at max 500mm centres, no cold joints — no gap over 30 minutes between layers."
        ]
      },
      {
        label: "After Pour",
        items: ["Curing started within 24 hours of pour: wet gunny or curing compound, minimum 7 days."]
      }
    ]
  },
  {
    name: "Brickwork & Plaster",
    scope: "unit",
    phases: [
      {
        label: "Before Brickwork",
        items: ["Brickwork layout: check wall location, thickness, openings, and alignment against approved drawings."]
      },
      {
        label: "During Brickwork",
        items: [
          "Line, level, and plumb: check courses and wall faces regularly using suitable instruments — plumb check every 3 courses, max deviation 3mm per 3m.",
          "Bond and joints: ensure proper bond, staggered vertical joints, uniform joint thickness, and fully filled mortar joints.",
          "Mortar and bricks: verify approved materials, mortar mix, brick condition, and appropriate wetting where specified.",
          "Laying and curing: ensure proper laying technique, toothed/keyed junctions where specified, and curing as required."
        ]
      },
      {
        label: "During Plastering",
        items: [
          "Pre-plaster services: check plumbing pipes, electrical conduits/boxes, and A.C. pipe/fittings before plastering.",
          "Surface preparation: ensure background is clean, sound, and prepared to the approved method; provide bonding treatment where specified.",
          "Finish, level, and plumb: check thickness (12mm internal, verified with pin at 3 points per wall), flatness, corners, edges, line, level, and verticality."
        ]
      },
      {
        label: "After Plastering",
        items: ["Tap test: 100% tap test after plastering — zero hollow plaster allowed; any hollow area broken out and redone."]
      }
    ]
  },
  {
    name: "Waterproofing Inspection",
    scope: "unit-area",
    phases: [
      {
        label: "Before Application",
        items: ["All surface cracks sealed before WP coat: approved crack filler; inspector confirms surface is ready."]
      },
      {
        label: "During Application",
        items: ["Two coats applied, turned up 150mm on all walls: overlap 150mm at joints, full turn-up at floor-wall junction."]
      },
      {
        label: "After WP / Before Tiling",
        items: ["Flood test — 50mm water ponding for 24 hours: non-negotiable; inspector present at start and end."]
      },
      {
        label: "After 24 Hours",
        items: [
          "Ceiling below inspected for seepage after 24 hours: zero leaks to proceed; any seepage means redo WP and retest.",
          "Sign-off: flood test result recorded with date, time, and inspector name — photo mandatory."
        ]
      }
    ]
  },
  {
    name: "Plumbing & Electrical Inspection",
    scope: "unit",
    phases: [
      { label: "Before Plastering", items: ["Pipe pressure test before concealment: 1.5x working pressure for 30 minutes, zero pressure drop."] },
      { label: "Before Pour", items: ["All sleeves placed before structural pour: DRI confirms — no chasing of RCC members allowed."] },
      { label: "During Installation", items: ["Earthing continuity confirmed floor by floor: continuity tester, each floor signed off separately."] },
      { label: "After Panel Installation", items: ["ELCB trip test done after panel installation: trip time within IS specification, recorded in register."] },
      { label: "Before Handover", items: ["As-built drawing updated and filed before handover: attached to the QC file for this apartment."] }
    ]
  }
];

const phaseWorkType = (groupName: string, label: string) => `${groupName} — ${label}`;

// workType -> which group/phase it is, so the form can look up its scope
// and what has to have passed before it unlocks.
const PHASE_LOOKUP = new Map<string, { group: PhaseGroup; phaseIndex: number }>();
for (const group of PHASE_GROUPS) {
  group.phases.forEach((phase, phaseIndex) => PHASE_LOOKUP.set(phaseWorkType(group.name, phase.label), { group, phaseIndex }));
}

// Flat map of every Work Type -> its checklist items, for the places that
// just need "what are this checklist's points" (seeding the form, Case
// Studies' category list) without caring whether it's standalone or one
// phase of a group.
export const QC_CHECKLISTS: Record<string, string[]> = {
  ...STANDALONE_CHECKLISTS,
  ...Object.fromEntries(
    PHASE_GROUPS.flatMap((group) => group.phases.map((phase) => [phaseWorkType(group.name, phase.label), phase.items]))
  )
};
type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

// The Work Type picker: standalone checklists in their old order, then
// each phase group's phases in sequence (so "R.C.C. Slab Inspection —
// Before Pour" always precedes "— During Pour" in the list).
const WORK_TYPES = [
  "Material Testing & Quality Checks",
  "Column Inspection",
  ...PHASE_GROUPS.flatMap((group) => group.phases.map((phase) => phaseWorkType(group.name, phase.label))),
  "Tile Work Inspection",
  "Finishing & Handover Inspection"
];

// A standalone checklist's scope: floor-level ones ask no flat; unit-level
// ones (just Tile Work and the final Finishing & Handover gate — the phase
// groups handle their own scope via PHASE_LOOKUP) do.
const STANDALONE_UNIT_SCOPED = new Set(["Tile Work Inspection", "Finishing & Handover Inspection"]);

function scopeOf(wt: string): "floor" | "unit" | "unit-area" {
  const phase = PHASE_LOOKUP.get(wt);
  if (phase) return phase.group.scope;
  return STANDALONE_UNIT_SCOPED.has(wt) ? "unit" : "floor";
}
const isFlatWise = (wt: string) => !!wt && scopeOf(wt) !== "floor";
const requiresAreas = (wt: string) => !!wt && scopeOf(wt) === "unit-area";

// The unit-wise/unit-area-wise stages whose LAST phase (or, for a
// standalone checklist, itself) must have a Pass on record before
// Finishing & Handover — the final gate — can be filled for that flat.
const UNIT_FINAL_STAGES = [
  ...PHASE_GROUPS.filter((g) => g.scope !== "floor").map((g) => phaseWorkType(g.name, g.phases[g.phases.length - 1].label)),
  "Tile Work Inspection"
];

// Fixed across every project/floor — confirmed with the person who asked
// for this field, not read from any per-floor master data.
const TOTAL_COLUMNS = 60;
const COLUMN_OPTIONS = Array.from({ length: TOTAL_COLUMNS }, (_, i) => `Column ${i + 1}`);

// "Up to 10" per the person who asked — not a hard ceiling, a bigger floor
// can still add a custom one via the "Other…" option below.
const TOTAL_SLABS = 10;
const SLAB_OPTIONS = Array.from({ length: TOTAL_SLABS }, (_, i) => `Slab ${i + 1}`);

// Waterproofing is checked by wet area WITHIN the flat, not the whole flat —
// kitchen/bathrooms/balconies. Fixed common areas plus a custom option,
// same pattern as Select Slabs above, for a flat with an extra wet area
// (utility, dry balcony, etc.) not in this default list.
const AREA_OPTIONS = ["Kitchen", "Bathroom 1", "Bathroom 2", "Bathroom 3", "Balcony 1", "Balcony 2"];

// A sentinel, non-real Stage id used ONLY to tag snags that originated from
// a Work Quality Inspection failure — never a real progression Stage
// record, so it never appears in / affects floor-release or gate
// sequencing (those only match a snag's stageId against real predecessor
// stage ids in the chain; an unknown id like this one simply never
// matches, same as if stageId were blank). Chosen so these snags are still
// fully visible everywhere a generic Snag is shown (Snags.tsx, My Work,
// DRI dashboard) via the existing refLabel() fallback-to-raw-id behavior.
const QC_INSPECTION_STAGE_ID = "STG-QC-INSPECTION";

export default function QualityInspection() {
  const { data, currentUserId, myRole, apply, toast, me, reInspectQualityId, setReInspectQualityId, setActiveTab } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  const canCreate = isAdmin || hasModuleGrant(data, currentUserId, "qualityInspection", "create");
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));
  const users = coll(data, "users");
  const snags = coll(data, "snags");

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

  // Admin only (the server enforces it too): permanently removes a wrongly
  // entered / test inspection together with the one snag it raised.
  async function deleteInspection(insp: QI) {
    if (!isAdmin) return;
    if (coll(data, "qualityInspections").some((i) => i.reInspectionOf === insp.id)) {
      toast("Can't delete — a re-inspection was recorded against it. Delete that first.");
      return;
    }
    const snag = insp.linkedSnagId ? byId(coll(data, "snags"), insp.linkedSnagId) : null;
    const what = `${insp.projectCode} · ${insp.floorName}${insp.unitName ? " / " + insp.unitName : ""}${insp.workType ? " · " + insp.workType : ""} · ${insp.result} · ${insp.inspectionDate}`;
    if (!window.confirm(`Permanently delete this inspection${snag ? " and the snag it raised" : ""}?

${what}

This cannot be undone.`)) return;
    const ops: Op[] = [
      { op: "delete", coll: "qualityInspections", id: insp.id },
      ...(snag ? [{ op: "delete" as const, coll: "snags" as const, id: snag.id }] : []),
      buildEventOp(currentUserId, "QUALITY_INSPECTION_DELETE", insp.id, "", `Deleted inspection · ${what}`)
    ];
    await apply(ops);
    toast("Inspection deleted");
  }

  // Pieces shared by the desktop table row and the mobile card, so the two
  // layouts always show the same thing.
  const snagSummary = (insp: QI, snag: Snag | null, overdue: boolean) =>
    !snag ? <span className="text-[var(--text-sub)]">—</span> : (
      <div>
        <Badge color={snag.status === "Closed" ? "green" : overdue ? "red" : "amber"}>
          <span className="whitespace-nowrap">{snag.status === "Closed" ? "Resolved" : overdue ? "Overdue" : snag.status}</span>
        </Badge>
        <div className="text-[10.5px] text-[var(--text-muted)] mt-1">
          {insp.correctiveAction?.assignedToName} · due {insp.correctiveAction?.targetDate}
        </div>
      </div>
    );
  const rowActions = (insp: QI, snag: Snag | null, row: boolean) => (
    <div className={row ? "flex flex-col gap-1.5 items-start" : "flex flex-wrap gap-1.5"} onClick={(e) => e.stopPropagation()}>
      <Btn label="History" color="secondary" size="sm" onClick={() => setHistoryFloor({ floorId: insp.floorId, floorLabel: insp.floorName })} />
      {canCreate && insp.result !== "Pass" && snag?.status !== "Closed" && (
        <Btn label="Re-inspect" color="secondary" size="sm" onClick={() => { setReInspectOf(insp); setPanelOpen(true); }} />
      )}
      {isAdmin && <Btn label="Delete" color="secondary" size="sm" onClick={() => deleteInspection(insp)} />}
    </div>
  );

  function linkedSnag(insp: QI): Snag | null {
    return insp.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
  }

  const [panelOpen, setPanelOpen] = useState(false);
  const [reInspectOf, setReInspectOf] = useState<QI | null>(null);
  const [reviewing, setReviewing] = useState<QI | null>(null); // a clicked row: just that one inspection, with Approve / Reject
  const [historyFloor, setHistoryFloor] = useState<{ floorId: string; floorLabel: string } | null>(null);

  // A dashboard's Recent Inspections row set this (then switched to this
  // tab) to jump straight into Re-inspect for one exact failed record,
  // instead of making the inspector find it again in the list below.
  useEffect(() => {
    if (!reInspectQualityId) return;
    const insp = inspections.find((i) => i.id === reInspectQualityId);
    if (insp) { setReInspectOf(insp); setPanelOpen(true); }
    setReInspectQualityId(null);
  }, [reInspectQualityId]);

  // --- filters for the list ------------------------------------------------
  const [fProjectId, setFProjectId] = useState("");
  const [fFloorId, setFFloorId] = useState("");
  const [fResult, setFResult] = useState("");
  const [fDri, setFDri] = useState("");
  const [fSnagStatus, setFSnagStatus] = useState(""); // "", "open", "overdue", "closed"
  const [fRange, setFRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!calendarOpen) return;
    function onDocClick(e: MouseEvent) {
      if (calendarWrapRef.current && !calendarWrapRef.current.contains(e.target as Node)) setCalendarOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [calendarOpen]);
  const dateBounds = fRange === "custom"
    ? (customFrom || customTo ? { from: customFrom || "0000-01-01", to: customTo || "9999-12-31" } : null)
    : dateRangeBounds(fRange);

  const fFloors = projectFloors(data, fProjectId || null);

  const filtered = useMemo(() => {
    return inspections.filter((i) => {
      if (fProjectId && i.projectId !== fProjectId) return false;
      if (fFloorId && i.floorId !== fFloorId) return false;
      if (fResult && i.result !== fResult) return false;
      if (fDri && i.correctiveAction?.assignedToUserId !== fDri) return false;
      if (dateBounds) { const d = i.inspectionDate; if (d < dateBounds.from || d > dateBounds.to) return false; }
      if (fSnagStatus) {
        const snag = linkedSnag(i);
        const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
        if (fSnagStatus === "open" && (!snag || snag.status === "Closed")) return false;
        if (fSnagStatus === "overdue" && !overdue) return false;
        if (fSnagStatus === "closed" && (!snag || snag.status !== "Closed")) return false;
      }
      return true;
    }).sort((a, b) => b.createdAt - a.createdAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspections, fProjectId, fFloorId, fResult, fDri, fSnagStatus, dateBounds, snags]);

  const openIssues = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status !== "Closed"; }).length;
  const failedCount = inspections.filter((i) => i.result === "Fail").length;
  const overdueCount = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status !== "Closed" && s.dueAt && s.dueAt < Date.now(); }).length;
  const resolvedCount = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status === "Closed"; }).length;

  const projectOptions = allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const driOptions = users.filter((u) => inspections.some((i) => i.correctiveAction?.assignedToUserId === u.id)).map((u) => ({ value: u.id, label: u.name }));

  const [generating, setGenerating] = useState(false);
  async function generateReport() {
    setGenerating(true);
    try {
      const { downloadQcInspectionPdf } = await import("../components/QcInspectionPdfDocument");
      const rangeLabel = fRange === "custom"
        ? (dateBounds ? `${dateBounds.from} → ${dateBounds.to}` : "All Time")
        : DATE_RANGES.find((r) => r.key === fRange)?.label || "All Time";
      const filterLabels: string[] = [];
      if (fProjectId) filterLabels.push(`Project: ${byId(allProjects, fProjectId)?.name || fProjectId}`);
      if (fFloorId) filterLabels.push(`Floor: ${byId(fFloors, fFloorId)?.name || fFloorId}`);
      if (fResult) filterLabels.push(`Result: ${fResult}`);
      if (fDri) filterLabels.push(`DRI: ${byId(users, fDri)?.name || fDri}`);
      if (fSnagStatus) filterLabels.push(`Snag: ${fSnagStatus}`);
      const total = filtered.length;
      const pass = filtered.filter((i) => i.result === "Pass").length;
      const fail = filtered.filter((i) => i.result === "Fail").length;
      const rework = filtered.filter((i) => i.result === "Rework Required").length;
      const overdue = filtered.filter((i) => { const s = linkedSnag(i); return s && s.status !== "Closed" && s.dueAt && s.dueAt < Date.now(); }).length;
      await downloadQcInspectionPdf({
        scopeLabel: filterLabels.length ? filterLabels.join(" · ") : "All projects",
        periodLabel: rangeLabel,
        generatedAt: Date.now(),
        generatedBy: me()?.name || "—",
        kpis: { total, pass, fail, rework, passRate: total ? Math.round((pass / total) * 100) : 0, overdue },
        rows: filtered.map((i) => {
          const snag = linkedSnag(i);
          const overdueRow = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
          return {
            date: i.inspectionDate,
            projectCode: i.projectCode,
            floor: i.floorName + (i.unitName ? ` / ${i.unitName}` : ""),
            workType: i.workType || "—",
            result: i.result,
            inspector: i.inspectorName,
            snagStatus: !snag ? "—" : snag.status === "Closed" ? "Resolved" : overdueRow ? "Overdue" : snag.status
          };
        })
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="eye" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Work Quality Inspection</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Floor-wise Pass/Fail/Rework inspections. A Fail/Rework automatically raises a Snag against the responsible DRI, reusing the existing Snag/DRI workflow.
            </div>
          </div>
        </div>
        {canCreate && (
          <Btn label="＋ New Inspection" color="primary" onClick={() => { setReInspectOf(null); setPanelOpen(true); }} />
        )}
      </div>

      <div className="flex gap-3.5 flex-wrap items-end mb-5">
        <div className="max-w-[180px]" style={{ position: "relative" }} ref={calendarWrapRef}>
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Date Range</div>
          <SearchDropdown
            icon="calendar"
            searchable={false}
            scrollable={false}
            value={fRange}
            onChange={(v) => { setFRange(v as DateRange); if (v === "custom") setCalendarOpen(true); }}
            options={DATE_RANGES.map((r) => ({ value: r.key, label: r.label }))}
            neutralActive
          />
          {fRange === "custom" && customFrom && customTo && (
            <div className="text-[11px] text-[var(--text-muted)] mt-1">{customFrom} → {customTo}</div>
          )}
          {fRange === "custom" && calendarOpen && (
            <CalendarRangePicker
              from={customFrom}
              to={customTo}
              onCancel={() => setCalendarOpen(false)}
              onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setCalendarOpen(false); }}
            />
          )}
        </div>
        <div className="max-w-[220px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown value={fProjectId} onChange={(v) => { setFProjectId(v); setFFloorId(""); }} options={[{ value: "", label: "All projects" }, ...projectOptions]} neutralActive />
        </div>
        <div className="max-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
          <SearchDropdown value={fFloorId} onChange={setFFloorId} options={[{ value: "", label: "All floors" }, ...fFloors.map((f) => ({ value: f.id, label: f.name }))]} neutralActive />
        </div>
        <div className="max-w-[170px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Result</div>
          <SearchDropdown value={fResult} onChange={setFResult} options={[{ value: "", label: "All results" }, ...RESULTS.map((r) => ({ value: r, label: r }))]} neutralActive />
        </div>
        <div className="max-w-[170px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">DRI</div>
          <SearchDropdown value={fDri} onChange={setFDri} options={[{ value: "", label: "All" }, ...driOptions]} neutralActive />
        </div>
        <div className="max-w-[180px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Snag Status</div>
          <SearchDropdown value={fSnagStatus} onChange={setFSnagStatus} options={[
            { value: "", label: "All" }, { value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "closed", label: "Closed" }
          ]} neutralActive />
        </div>
        <Btn label={generating ? "Generating…" : "Generate Report"} color="secondary" icon="download" onClick={generateReport} disabled={generating} />
        <Btn label="Fail Register" color="secondary" icon="bug" onClick={() => setActiveTab("qualityFails" as TabKey)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Open Quality Issues" value={openIssues} icon="bug" valueClassName={openIssues > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Failed Inspections" value={failedCount} icon="bug" />
        <StatTile label="Overdue Corrective Actions" value={overdueCount} icon="clock" valueClassName={overdueCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Resolved Issues" value={resolvedCount} icon="award" />
      </div>

      <Card padded={false} className="p-3 md:p-[18px]">
        {/* phones: one card per inspection instead of a table that scrolls sideways */}
        <div className="md:hidden flex flex-col gap-2.5">
          {filtered.length === 0 && <div className="py-6 text-center text-[13px] text-[var(--text-muted)]">No inspections recorded yet.</div>}
          {filtered.map((insp) => {
            const snag = linkedSnag(insp);
            const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
            return (
              <div
                key={insp.id}
                className="border border-[var(--border)] rounded-radius-md p-3.5 bg-[var(--bg-card)]"
                onClick={() => setReviewing(insp)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-snug">{insp.floorName}{insp.unitName ? ` / ${insp.unitName}` : ""}</div>
                    {insp.workType && <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5">{insp.workType}</div>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}>
                      <span className="whitespace-nowrap">{insp.result}</span>
                    </Badge>
                    <ApprovalBadge approval={effectiveApproval(data, insp)} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
                  <span>{insp.inspectionDate}</span>
                  <span>{insp.projectCode}</span>
                  <span>by {insp.inspectorName}</span>
                </div>
                {insp.itemDescription && <div className="mt-1 text-[11.5px] text-[var(--text-muted)]">{insp.workOrderNo} · {insp.itemDescription}</div>}
                {snag && <div className="mt-2.5">{snagSummary(insp, snag, overdue)}</div>}
                <div className="mt-3">{rowActions(insp, snag, false)}</div>
                <div onClick={(e) => e.stopPropagation()}><ApprovalActions collName="qualityInspections" record={insp} /></div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block">
        <Table
          columns={["Date", "Project", "Floor", "VMS Reference", "Result", "Inspector", "Snag / Corrective Action", ""]}
          // Fixed px widths (not %) so the table keeps its natural size on a
          // narrow/mobile screen and scrolls horizontally (Table's own
          // overflow-x-auto wrapper) instead of squeezing every column down
          // to an unreadable, overlapping sliver.
          colWidths={["100px", "90px", "160px", "190px", "140px", "130px", "200px", "150px"]}
          maxHeight="560px"
        >
          {filtered.map((insp) => {
            const snag = linkedSnag(insp);
            const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
            return (
              <TableRow key={insp.id} onClick={() => setReviewing(insp)}>
                <TableCell muted className="whitespace-nowrap">{insp.inspectionDate}</TableCell>
                <TableCell className="whitespace-nowrap">{insp.projectCode}</TableCell>
                <TableCell strong>
                  {insp.floorName}{insp.unitName ? ` / ${insp.unitName}` : ""}
                  {insp.workType && (
                    <div className="text-[10.5px] text-[var(--text-muted)] font-normal mt-0.5">
                      {insp.workType}
                      {insp.columns?.length ? ` · ${insp.columns.length} column${insp.columns.length === 1 ? "" : "s"}` : ""}
                      {insp.slabs?.length ? ` · ${insp.slabs.length} slab${insp.slabs.length === 1 ? "" : "s"}` : ""}
                      {insp.areas?.length ? ` · ${insp.areas.join(", ")}` : ""}
                    </div>
                  )}
                </TableCell>
                <TableCell muted className="truncate max-w-0">{insp.itemDescription ? `${insp.workOrderNo} · ${insp.itemDescription}` : "—"}</TableCell>
                <TableCell>
                  <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}>
                    <span className="whitespace-nowrap">{insp.result}</span>
                  </Badge>
                  <div className="mt-1"><ApprovalBadge approval={effectiveApproval(data, insp)} /></div>
                  <div onClick={(e) => e.stopPropagation()}><ApprovalActions collName="qualityInspections" record={insp} /></div>
                </TableCell>
                <TableCell muted className="truncate max-w-0">{insp.inspectorName}</TableCell>
                <TableCell>{snagSummary(insp, snag, overdue)}</TableCell>
                <TableCell>{rowActions(insp, snag, true)}</TableCell>
              </TableRow>
            );
          })}
        </Table>
        </div>
      </Card>

      <InspectionForm
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        reInspectOf={reInspectOf}
        workItems={workItems}
        allProjects={allProjects}
        data={data}
        users={users}
        allInspections={inspections}
        currentUserId={currentUserId}
        inspectorName={me()?.name || ""}
        apply={apply}
        toast={toast}
      />

      <ApprovalReviewPanel item={reviewing ? { coll: "qualityInspections", rec: reviewing } : null} onClose={() => setReviewing(null)} />
      <FloorHistoryPanel
        open={!!historyFloor}
        onClose={() => setHistoryFloor(null)}
        floorId={historyFloor?.floorId || ""}
        floorLabel={historyFloor?.floorLabel || ""}
        inspections={inspections}
        snags={snags}
      />
    </div>
  );
}

function FloorHistoryPanel({
  open, onClose, floorId, floorLabel, inspections, snags
}: {
  open: boolean; onClose: () => void; floorId: string; floorLabel: string;
  inspections: QI[]; snags: Snag[];
}) {
  const history = useMemo(
    () => inspections.filter((i) => i.floorId === floorId).sort((a, b) => a.createdAt - b.createdAt),
    [inspections, floorId]
  );
  return (
    <SidePanel open={open} wide icon={<NavIcon name="clock" size={18} />} title="Floor Quality History" desc={floorLabel} onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      {history.length === 0 ? (
        <div className="empty">No inspections recorded for this floor yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {history.map((insp) => {
            const snag = insp.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
            return (
              <Card key={insp.id} className="!p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[12.5px] font-semibold">{insp.inspectionDate} {insp.workType ? `· ${insp.workType}` : ""}{insp.itemDescription ? ` · ${insp.itemDescription}` : ""}</div>
                  <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}>{insp.result}</Badge>
                </div>
                {insp.reInspectionOf && <div className="text-[11px] text-[var(--text-muted)] mt-1">Re-inspection of {insp.reInspectionOf}</div>}
                {insp.contractor && <div className="text-[11px] text-[var(--text-muted)] mt-1">Contractor: {insp.contractor}</div>}
                {insp.columns && insp.columns.length > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">Columns: {insp.columns.join(", ")}</div>
                )}
                {insp.slabs && insp.slabs.length > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">Slabs: {insp.slabs.join(", ")}</div>
                )}
                {insp.areas && insp.areas.length > 0 && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-1">Areas: {insp.areas.join(", ")}</div>
                )}
                {insp.checklistItems && insp.checklistItems.length > 0 && (
                  <div className="flex flex-col gap-1 mt-2">
                    {insp.checklistItems.map((c, idx) => (
                      <div key={idx} className="text-[11.5px] flex gap-1.5">
                        <Badge color={c.status === "OK" ? "green" : c.status === "Not OK" ? "red" : "gray"}>{c.status}</Badge>
                        <span className="flex-1">{c.text}{c.remarks ? ` — ${c.remarks}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {insp.remarks && <div className="text-[12px] mt-1.5">{insp.remarks}</div>}
                {insp.photos?.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {insp.photos.map((p, idx) => <img key={idx} src={p.url} className="w-14 h-14 object-cover rounded-radius-sm border border-[var(--border)]" />)}
                  </div>
                )}
                {snag && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-2 border-t border-[var(--border)] pt-1.5">
                    Snag {snag.id} · {snag.status} · assigned to {insp.correctiveAction?.assignedToName} · due {insp.correctiveAction?.targetDate}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </SidePanel>
  );
}

function InspectionForm({
  open, onClose, reInspectOf, workItems, allProjects, data, users, allInspections, currentUserId, inspectorName, apply, toast
}: {
  open: boolean; onClose: () => void; reInspectOf: QI | null;
  workItems: WorkItemsResponse | null;
  allProjects: { id: string; code: string; name: string }[];
  data: any;
  users: { id: string; name: string }[];
  allInspections: QI[];
  currentUserId: string | null; inspectorName: string;
  apply: (ops: any[]) => Promise<void>;
  toast: (msg: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [itemId, setItemId] = useState("");
  const [inspectionDate, setInspectionDate] = useState(todayStr());
  const [workType, setWorkType] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [selectedSlabs, setSelectedSlabs] = useState<string[]>([]);
  const [addingCustomSlab, setAddingCustomSlab] = useState(false);
  const [customSlabText, setCustomSlabText] = useState("");
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [addingCustomArea, setAddingCustomArea] = useState(false);
  const [customAreaText, setCustomAreaText] = useState("");
  const savedCustomAreaNames = coll(data, "customAreaNames").map((c: any) => c.name as string);
  const areaOptions = [...AREA_OPTIONS, ...savedCustomAreaNames.filter((n) => !AREA_OPTIONS.includes(n))];
  function addCustomArea(rawText: string) {
    const name = rawText.trim();
    if (!name) return;
    setSelectedAreas((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setCustomAreaText(""); setAddingCustomArea(false);
    const exists = areaOptions.some((a) => a.toLowerCase() === name.toLowerCase());
    if (!exists) {
      apply([{ op: "upsert", coll: "customAreaNames", rec: { id: nextId("CARE", coll(data, "customAreaNames")), name } }]);
    }
  }
  // The fixed Slab 1-10 list plus any custom name a past inspector already
  // saved (CustomSlabName) — so this isn't a one-off, local-to-this-record
  // value; everyone's Select Slabs picks up what others have added.
  const savedCustomSlabNames = coll(data, "customSlabNames").map((c: any) => c.name as string);
  const slabOptions = [...SLAB_OPTIONS, ...savedCustomSlabNames.filter((n) => !SLAB_OPTIONS.includes(n))];
  function addCustomSlab(rawText: string) {
    const name = rawText.trim();
    if (!name) return;
    setSelectedSlabs((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setCustomSlabText(""); setAddingCustomSlab(false);
    const exists = slabOptions.some((s) => s.toLowerCase() === name.toLowerCase());
    if (!exists) {
      apply([{ op: "upsert", coll: "customSlabNames", rec: { id: nextId("CSLB", coll(data, "customSlabNames")), name } }]);
    }
  }
  const [contractor, setContractor] = useState("");
  const [customContractor, setCustomContractor] = useState(false);
  const vendors = coll(data, "vendors").filter((v) => v.status !== "inactive");
  const [checklist, setChecklist] = useState<{ text: string; status: ChecklistStatus | ""; remarks: string }[]>([]);
  const [result, setResult] = useState<QualityInspectionResult>("Pass");
  const [severity, setSeverity] = useState<Severity>("Major");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  // The responsible DRI for a Fail/Rework is this inspector's own Team
  // leader (e.g. Quality's leader is fixed as Rishabh Rajput) — never a
  // free pick, since the team already has exactly one fixed head.
  const allUsers = coll(data, "users");
  const myTeam = coll(data, "teams").find((t: any) => t.id === allUsers.find((u: any) => u.id === currentUserId)?.teamId) || null;
  const myTeamLeader = myTeam?.leaderId ? allUsers.find((u: any) => u.id === myTeam.leaderId) || null : null;

  // Pre-fill from the unit/item being re-inspected, once, when the panel opens.
  useEffect(() => {
    if (!open) return;
    if (reInspectOf) {
      setProjectId(reInspectOf.projectId);
      setFloorId(reInspectOf.floorId);
      setUnitId(reInspectOf.unitId || "");
      setWorkOrderNo(reInspectOf.workOrderNo || "");
      setItemId(reInspectOf.itemId || "");
      setWorkType(reInspectOf.workType || "");
      setSelectedColumns(reInspectOf.columns || []);
      setSelectedSlabs(reInspectOf.slabs || []);
      setSelectedAreas(reInspectOf.areas || []);
      setChecklist((reInspectOf.workType && QC_CHECKLISTS[reInspectOf.workType] || []).map((text) => ({ text, status: "", remarks: "" })));
    } else {
      setProjectId(""); setFloorId(""); setUnitId(""); setWorkOrderNo(""); setItemId("");
      setWorkType(""); setSelectedColumns([]); setSelectedSlabs([]); setSelectedAreas([]); setChecklist([]);
    }
    setInspectionDate(todayStr());
    setContractor(""); setCustomContractor(false);
    setResult("Pass"); setSeverity("Major"); setRemarks(""); setPhotos([]);
    setAssignedToUserId(myTeamLeader?.id || ""); setTargetDate("");
  }, [open, reInspectOf]);

  // Picking a Work Type (re)seeds the checklist from the master list —
  // blank status/remarks, ready for the inspector to fill in. Switching
  // Work Type mid-form replaces the whole checklist (the old answers were
  // for a different checklist, not partial progress on this one).
  function onWorkTypeChange(wt: string) {
    setWorkType(wt);
    if (!isFlatWise(wt)) setUnitId(""); // floor-level checklist: no flat
    const group = PHASE_LOOKUP.get(wt)?.group.name;
    if (wt !== "Column Inspection") setSelectedColumns([]);
    if (group !== "R.C.C. Slab Inspection") { setSelectedSlabs([]); setAddingCustomSlab(false); setCustomSlabText(""); }
    if (group !== "Waterproofing Inspection") { setSelectedAreas([]); setAddingCustomArea(false); setCustomAreaText(""); }
    setChecklist((QC_CHECKLISTS[wt] || []).map((text) => ({ text, status: "", remarks: "" })));
  }
  function setItemStatus(idx: number, status: ChecklistStatus) {
    setChecklist((prev) => prev.map((row, i) => (i === idx ? { ...row, status } : row)));
  }
  // Any Not OK item forces the overall Result to Fail — locked, not a
  // default the inspector can override. Un-locks automatically if every
  // Not OK item is corrected back to OK/N/A before saving.
  const anyNotOk = checklist.some((c) => c.status === "Not OK");
  useEffect(() => {
    if (anyNotOk) setResult("Fail");
  }, [anyNotOk]);
  function setItemRemarks(idx: number, text: string) {
    setChecklist((prev) => prev.map((row, i) => (i === idx ? { ...row, remarks: text } : row)));
  }

  const project = allProjects.find((p) => p.id === projectId) || null;
  const floors = projectFloors(data, projectId || null);
  const floor = byId(floors, floorId);
  const flatWise = isFlatWise(workType);
  const units = flatWise && projectId && floorId ? floorUnits(data, projectId, floorId) : [];
  const unit = byId(units, unitId);

  // Latest-result lookup shared by both gates below: the most recent
  // inspection logged for a given Work Type + flat (+ wet area, for
  // Waterproofing's per-area phases). Only the latest attempt counts, so a
  // phase that failed and was later re-inspected to Pass still clears it.
  function latestResult(stageWorkType: string, forUnitId: string, area?: string): QualityInspectionResult | undefined {
    const matches = allInspections
      .filter((i) => i.workType === stageWorkType && (forUnitId ? i.unitId === forUnitId : !i.unitId && i.floorId === floorId))
      .filter((i) => !area || i.areas?.includes(area))
      .sort((a, b) => b.createdAt - a.createdAt);
    return matches[0]?.result;
  }

  // Finishing & Handover is the final gate for a flat — it shows up in the
  // picker like any other checklist, but can't actually be filled in until
  // every unit-wise stage's LAST phase has a Pass on record for THIS unit.
  const pendingPriorStages = workType === "Finishing & Handover Inspection" && unitId
    ? UNIT_FINAL_STAGES.filter((stage) => latestResult(stage, unitId) !== "Pass")
    : [];
  const blockedByPriorStages = workType === "Finishing & Handover Inspection" && !!unitId && pendingPriorStages.length > 0;

  // Every OTHER phase (2nd onward) of a timed group is gated the same way,
  // one step at a time, against the phase immediately before it — Before
  // Pour must Pass before During Pour unlocks, During Pour before After
  // Pour, and so on. Waterproofing is gated per wet area: each selected
  // area has to have passed the previous phase on its own, since one
  // bathroom finishing its flood test doesn't mean the kitchen has.
  const phaseInfo = PHASE_LOOKUP.get(workType);
  const priorPhaseWorkType = phaseInfo && phaseInfo.phaseIndex > 0
    ? phaseWorkType(phaseInfo.group.name, phaseInfo.group.phases[phaseInfo.phaseIndex - 1].label)
    : null;
  const scopeKeyReady = phaseInfo?.group.scope === "floor" ? !!floorId : !!unitId;
  const pendingPriorAreas = phaseInfo?.group.scope === "unit-area" && priorPhaseWorkType && unitId
    ? selectedAreas.filter((area) => latestResult(priorPhaseWorkType, unitId, area) !== "Pass")
    : [];
  const blockedByPriorPhase = !!priorPhaseWorkType && scopeKeyReady && (
    phaseInfo!.group.scope === "unit-area"
      ? selectedAreas.length > 0 && pendingPriorAreas.length > 0
      : latestResult(priorPhaseWorkType, unitId) !== "Pass"
  );
  const priorPhaseMessage = phaseInfo?.group.scope === "unit-area"
    ? `"${priorPhaseWorkType}" hasn't passed yet for: ${pendingPriorAreas.join(", ")}`
    : `"${priorPhaseWorkType}" hasn't passed yet for this ${phaseInfo?.group.scope === "floor" ? "floor" : "flat"}`;

  // Floor-to-floor is a heads-up only, never a hard block (teams asked for
  // flexibility here) — the inspector can still proceed, but sees which
  // earlier floor(s) haven't finished their own Structure stage yet.
  const structureGroup = PHASE_GROUPS.find((g) => g.name === "R.C.C. Slab Inspection")!;
  const structureLastPhase = phaseWorkType(structureGroup.name, structureGroup.phases[structureGroup.phases.length - 1].label);
  function floorPassed(fId: string): boolean {
    const matches = allInspections
      .filter((i) => i.workType === structureLastPhase && !i.unitId && i.floorId === fId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return matches[0]?.result === "Pass";
  }
  const earlierFloorsNotStructurallyDone = workType && PHASE_LOOKUP.get(workType)?.group === structureGroup && floor
    ? floors.filter((f) => (f.seq || 0) < (floor.seq || 0) && !floorPassed(f.id))
    : [];

  // VMS Work Order/Item picker is an OPTIONAL manual reference only — a QC
  // Unit has no reliable key back to a VMS scope-item/location (see the
  // QualityInspection interface's doc comment in types/index.ts), so this
  // is never auto-matched or auto-filtered by the unit chosen above. It is
  // keyed by the project's VMS code, two steps (Work Order, then Item)
  // same as the original VMS item picker pattern.
  const projectEntry = (workItems && workItems.available && project)
    ? workItems.projects.find((p) => p.projectCode === project.code)
    : null;
  const workOrderEntry = projectEntry?.workOrders.find((w) => w.workOrderNo === workOrderNo) || null;
  const itemEntry = workOrderEntry?.items.find((i) => i.itemId === itemId) || null;

  // Previous Similar Issues — only ever matched by the same, explicitly
  // picked VMS itemId across OTHER real floors (never guessed from free-text
  // description — this is purely informational history for the inspector).
  const similarIssues = useMemo(() => {
    if (!itemId) return [];
    return allInspections
      .filter((i) => i.itemId === itemId && i.floorId !== floorId && i.result !== "Pass")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
  }, [allInspections, itemId, floorId]);

  async function save() {
    if (!projectId || !floorId) { toast("Project and Floor are required"); return; }
    if (!workType) { toast("Select a checklist (Work Type) first"); return; }
    if (flatWise && !unitId) { toast("Pick the flat — Brickwork and the work after it is inspected flat by flat"); return; }
    if (blockedByPriorStages) { toast(`Finish and pass ${pendingPriorStages.join(", ")} for this flat first`); return; }
    if (blockedByPriorPhase) { toast(priorPhaseMessage); return; }
    if (workType === "Column Inspection" && selectedColumns.length === 0) { toast("Select at least one column"); return; }
    if (phaseInfo?.group.name === "R.C.C. Slab Inspection" && selectedSlabs.length === 0) { toast("Select at least one slab"); return; }
    if (requiresAreas(workType) && selectedAreas.length === 0) { toast("Select at least one area (kitchen/bathroom/balcony)"); return; }
    if (checklist.some((row) => !row.status)) { toast("Mark every checklist point as OK / Not OK / N/A"); return; }
    if (result !== "Pass" && !remarks.trim()) { toast("Remarks are required for Fail / Rework Required"); return; }
    if (result !== "Pass" && !assignedToUserId) { toast("A responsible DRI must be assigned for Fail / Rework Required"); return; }
    if (result !== "Pass" && !targetDate) { toast("A target date is required for the corrective action"); return; }

    setSaving(true);
    const assignee = users.find((u) => u.id === assignedToUserId);
    // BUG FIX: was nextId("QI", []), which always returned "QI-0001" and
    // silently overwrote every previous inspection on every new submission.
    // Must scan the FULL collection, not `allInspections` (scoped to the
    // signed-in user's allowed projects) — a user restricted to a subset of
    // projects (e.g. Deepti Dixit) would otherwise compute the max id from
    // only their visible projects and collide with a newer inspection
    // saved in a project they can't see, silently overwriting it.
    const id = nextId("QI", coll(data, "qualityInspections"));
    const needsSnag = result !== "Pass";
    // Snag id/record built up-front so it can be cross-referenced from the
    // inspection record in the SAME apply() batch — both are brand-new
    // records created together exactly once, which is what prevents a
    // duplicate snag ever being raised for the same failed inspection
    // (there is no edit path for an already-saved inspection, only a
    // fresh "re-inspect" record).
    // BUG FIX: was nextId("SNG", []), which always returned "SNG-0001" and
    // would silently overwrite every previous Quality-Inspection-raised snag
    // the next time an inspection failed — same bug class as the QI id above.
    const snagId = needsSnag ? nextId("SNG", coll(data, "snags")) : null;

    const rec: QI = {
      id,
      projectId, projectCode: project?.code || "", projectName: project?.name || "",
      floorId, floorName: floor?.name || "",
      // flat-wise work types also record the flat (this is what turns the flat green on the Tower Board)
      ...(flatWise && unit ? { unitId: unit.id, unitCode: unit.code, unitName: unit.name } : {}),
      workOrderNo: itemEntry ? workOrderNo : undefined,
      itemId: itemEntry ? itemEntry.itemId : undefined,
      itemType: itemEntry?.itemType,
      itemDescription: itemEntry?.description,
      unit: itemEntry?.unit,
      workType,
      columns: workType === "Column Inspection" ? selectedColumns : undefined,
      slabs: phaseInfo?.group.name === "R.C.C. Slab Inspection" ? selectedSlabs : undefined,
      areas: requiresAreas(workType) ? selectedAreas : undefined,
      contractor: contractor.trim() || undefined,
      checklistItems: checklist.map((row) => ({ text: row.text, status: row.status as "OK" | "Not OK" | "N/A", remarks: row.remarks.trim() || undefined })),
      inspectionDate, result,
      remarks: remarks.trim() || undefined,
      photos,
      inspectorUserId: currentUserId || "",
      inspectorName,
      correctiveAction: needsSnag
        ? { assignedToUserId, assignedToName: assignee?.name || assignedToUserId, targetDate }
        : null,
      linkedSnagId: snagId,
      reInspectionOf: reInspectOf?.id || null,
      // a team member's inspection waits for their team leader (server re-derives this)
      approval: approvalFor(data, currentUserId),
      createdAt: Date.now()
    };

    const ops: any[] = [
      { op: "upsert", coll: "qualityInspections", rec },
      buildEventOp(currentUserId, "QUALITY_INSPECTION", id, "", `Quality Inspection · ${result} · ${rec.floorName}${rec.unitName ? " / " + rec.unitName : ""}`)
    ];
    if (needsSnag && snagId) {
      // Location always in the title — never just the VMS item description
      // — so the snag/quality observation is unambiguous on the DRI
      // dashboard and in their failure history, even if a VMS item was
      // also picked.
      const location = rec.unitName ? `${rec.floorName} / ${rec.unitName}` : rec.floorName;
      const label = itemEntry?.description ? `${location} · ${itemEntry.description}` : location;
      ops.push({
        op: "upsert", coll: "snags",
        rec: {
          id: snagId,
          projectId,
          floorId,
          ...(rec.unitId ? { unitId: rec.unitId } : {}),
          stageId: QC_INSPECTION_STAGE_ID,
          qualityInspectionId: id,
          title: `Quality ${result} — ${label}`,
          description: remarks.trim(),
          severity,
          status: "Open",
          raisedBy: currentUserId || "",
          raisedAt: Date.now(),
          assignedTo: assignedToUserId,
          dueAt: new Date(targetDate).getTime() || null,
          photos,
          comments: []
        }
      });
    }

    await apply(ops);
    setSaving(false);
    toast(needsSnag ? `Inspection recorded · Snag ${snagId} raised` : "Inspection recorded");
    onClose();
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="eye" size={18} />}
      title={reInspectOf ? "Re-inspect" : "New Inspection"}
      desc={reInspectOf ? `Re-checking: ${reInspectOf.floorName}${reInspectOf.unitName ? " / " + reInspectOf.unitName : ""}` : "Record a Pass/Fail/Rework Required result against a real Floor."}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || blockedByPriorStages || blockedByPriorPhase}>{saving ? "Saving…" : "Save Inspection"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            disabled={!!reInspectOf}
            onChange={(v) => { setProjectId(v); setFloorId(""); setUnitId(""); }}
            options={[{ value: "", label: "Select project…" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
        <div className="field">
          <label>Floor *</label>
          <SearchDropdown
            value={floorId}
            disabled={!!reInspectOf || !projectId}
            onChange={(v) => { setFloorId(v); setUnitId(""); }}
            options={[{ value: "", label: "Select floor…" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
          />
        </div>

        {itemId && similarIssues.length > 0 && (
          <div className="field full">
            <label>Previous Similar Issues (same work item, other units)</label>
            <div className="flex flex-col gap-1.5 border border-[var(--border)] rounded-radius-md p-2.5 bg-[var(--surface-muted)]">
              {similarIssues.map((s) => (
                <div key={s.id} className="text-[11.5px]">
                  <Badge color={s.result === "Fail" ? "red" : "amber"}>{s.result}</Badge>{" "}
                  <span className="font-medium">{s.floorName}</span> · {s.inspectionDate}
                  {s.remarks && <div className="text-[var(--text-muted)] mt-0.5">{s.remarks}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="field full">
          <label>Checklist (Work Type) *</label>
          <SearchDropdown
            value={workType}
            disabled={!!reInspectOf}
            onChange={onWorkTypeChange}
            options={[{ value: "", label: "Select checklist…" }, ...WORK_TYPES.map((wt) => ({ value: wt, label: wt }))]}
          />
        </div>

        {flatWise && (
          <div className="field full">
            <label>Flat / Unit *</label>
            <SearchDropdown
              value={unitId}
              disabled={!!reInspectOf || !floorId}
              onChange={setUnitId}
              options={[{ value: "", label: floorId ? "Select flat…" : "Select a floor first…" }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
            />
            <div className="text-[11px] text-[var(--text-muted)] mt-1">{workType} is checked flat by flat — pick the flat this inspection is for.</div>
          </div>
        )}

        {blockedByPriorStages && (
          <div className="field full">
            <div className="text-[12.5px] font-semibold p-3 rounded-radius-md" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-fail)" }}>
              This is the final gate — it can't be filled in until every earlier stage has passed for this flat. Still pending: {pendingPriorStages.join(", ")}.
            </div>
          </div>
        )}

        {blockedByPriorPhase && (
          <div className="field full">
            <div className="text-[12.5px] font-semibold p-3 rounded-radius-md" style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-fail)" }}>
              Can't fill this in yet — {priorPhaseMessage}.
            </div>
          </div>
        )}

        {earlierFloorsNotStructurallyDone.length > 0 && (
          <div className="field full">
            <div className="text-[12.5px] font-semibold p-3 rounded-radius-md" style={{ background: "rgba(217,119,6,0.08)", color: "#d97706" }}>
              Heads up: {earlierFloorsNotStructurallyDone.map((f) => f.name).join(", ")} {earlierFloorsNotStructurallyDone.length === 1 ? "hasn't" : "haven't"} finished Structure (After Pour) yet — pouring on this floor ahead of that is out of sequence, though you can still proceed.
            </div>
          </div>
        )}

        {workType === "Column Inspection" && (
          <div className="field full">
            <label>Select Columns *</label>
            <SearchDropdown
              multi
              multiValue={selectedColumns}
              onChangeMulti={setSelectedColumns}
              options={COLUMN_OPTIONS.map((c) => ({ value: c, label: c }))}
            />
            <div className="text-[11px] text-[var(--text-muted)] mt-1">{selectedColumns.length} of {TOTAL_COLUMNS} column{selectedColumns.length === 1 ? "" : "s"} selected.</div>
          </div>
        )}

        {phaseInfo?.group.name === "R.C.C. Slab Inspection" && (
          <div className="field full">
            <label>Select Slabs *</label>
            <SearchDropdown
              multi
              multiValue={selectedSlabs}
              onChangeMulti={(vals) => {
                if (vals.includes("__custom__")) { setAddingCustomSlab(true); setSelectedSlabs(vals.filter((v) => v !== "__custom__")); }
                else setSelectedSlabs(vals);
              }}
              options={[...slabOptions.map((s) => ({ value: s, label: s })), { value: "__custom__", label: "Custom…" }]}
              onCreate={addCustomSlab}
            />
            {addingCustomSlab && (
              <div className="flex gap-1.5 mt-1.5">
                <input
                  className="input" autoFocus placeholder="Type a custom slab name"
                  value={customSlabText} onChange={(e) => setCustomSlabText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customSlabText.trim()) addCustomSlab(customSlabText.trim()); }}
                />
                <button
                  type="button" className="btn btn-secondary" style={{ flexShrink: 0 }}
                  onClick={() => { if (customSlabText.trim()) addCustomSlab(customSlabText.trim()); }}
                >Add</button>
              </div>
            )}
            <div className="text-[11px] text-[var(--text-muted)] mt-1">{selectedSlabs.length} slab{selectedSlabs.length === 1 ? "" : "s"} selected.</div>
          </div>
        )}

        {requiresAreas(workType) && (
          <div className="field full">
            <label>Select Areas *</label>
            <SearchDropdown
              multi
              multiValue={selectedAreas}
              onChangeMulti={(vals) => {
                if (vals.includes("__custom__")) { setAddingCustomArea(true); setSelectedAreas(vals.filter((v) => v !== "__custom__")); }
                else setSelectedAreas(vals);
              }}
              options={[...areaOptions.map((a) => ({ value: a, label: a })), { value: "__custom__", label: "Custom…" }]}
              onCreate={addCustomArea}
            />
            {addingCustomArea && (
              <div className="flex gap-1.5 mt-1.5">
                <input
                  className="input" autoFocus placeholder="Type a custom area name"
                  value={customAreaText} onChange={(e) => setCustomAreaText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customAreaText.trim()) addCustomArea(customAreaText.trim()); }}
                />
                <button
                  type="button" className="btn btn-secondary" style={{ flexShrink: 0 }}
                  onClick={() => { if (customAreaText.trim()) addCustomArea(customAreaText.trim()); }}
                >Add</button>
              </div>
            )}
            <div className="text-[11px] text-[var(--text-muted)] mt-1">Waterproofing is checked per wet area, not the whole flat — {selectedAreas.length} area{selectedAreas.length === 1 ? "" : "s"} selected.</div>
          </div>
        )}

        {checklist.length > 0 && !blockedByPriorStages && !blockedByPriorPhase && (
          <div className="field full">
            <div className="overflow-x-auto border border-[var(--border)] rounded-radius-md">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg-subtle)]">
                    <th className="p-2 w-8">#</th>
                    <th className="p-2">Inspection / Check Point</th>
                    <th className="p-2 w-[220px]">Status *</th>
                    <th className="p-2 w-[180px]">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {checklist.map((row, idx) => (
                    <tr key={idx} className="border-t border-[var(--border)] align-top">
                      <td className="p-2 text-[var(--text-muted)]">{idx + 1}</td>
                      <td className="p-2">{row.text}</td>
                      <td className="p-2">
                        <div className="flex gap-2.5 flex-wrap">
                          {CHECKLIST_STATUSES.map((st) => (
                            <label key={st} className="flex items-center gap-1 text-[11.5px] cursor-pointer whitespace-nowrap">
                              <input type="radio" name={`checklist-${idx}`} checked={row.status === st} onChange={() => setItemStatus(idx, st)} />
                              {st}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="p-2">
                        <input className="input" value={row.remarks} onChange={(e) => setItemRemarks(idx, e.target.value)} placeholder="Optional" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="field">
          <label>Contractor</label>
          {!customContractor ? (
            <SearchDropdown
              value={vendors.some((v) => v.vendorName === contractor) ? contractor : ""}
              searchPlaceholder="Search by name or vendor code…"
              onChange={(v) => {
                if (v === "__other__") { setCustomContractor(true); setContractor(""); }
                else setContractor(v);
              }}
              options={[
                { value: "", label: "Select contractor…" },
                ...vendors.map((v) => ({ value: v.vendorName, label: `${v.vendorName} (${v.vendorCode})` })),
                { value: "__other__", label: "Other…" }
              ]}
            />
          ) : (
            <div className="flex gap-1.5">
              <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Type contractor name" autoFocus />
              <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => { setCustomContractor(false); setContractor(""); }}>List</button>
            </div>
          )}
        </div>

        <div className="field">
          <label>Inspection Date *</label>
          <input className="input" type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Result *</label>
          <SearchDropdown
            searchable={false}
            value={result}
            onChange={(v) => setResult(v as QualityInspectionResult)}
            options={RESULTS.map((r) => ({ value: r, label: r }))}
            disabled={anyNotOk}
          />
          {anyNotOk && <div className="hint">Locked to Fail — a checklist item is marked Not OK.</div>}
        </div>

        <div className="field full">
          <label>Remarks{result !== "Pass" ? " *" : ""}</label>
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={result !== "Pass" ? "Describe the defect — required for Fail/Rework" : "Optional"} />
        </div>

        <div className="field full">
          <label>Photo Evidence</label>
          <PhotoGroupUploader label="Inspection photos (optional)" photos={photos} onChange={setPhotos} />
        </div>

        {result !== "Pass" && (
          <>
            <div className="field">
              <label>Severity *</label>
              <SearchDropdown
                searchable={false}
                value={severity}
                onChange={(v) => setSeverity(v as Severity)}
                options={SEVERITIES.map((sv) => ({ value: sv, label: sv }))}
              />
            </div>
            <div className="field">
              <label>Responsible DRI *</label>
              {myTeamLeader ? (
                <div className="input flex items-center" style={{ cursor: "default", color: "var(--text-muted)" }}>
                  {myTeamLeader.name} <span className="ml-1.5 text-[11px]">(your team's head)</span>
                </div>
              ) : (
                <SearchDropdown
                  value={assignedToUserId}
                  onChange={setAssignedToUserId}
                  options={[{ value: "", label: "Select DRI…" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                />
              )}
            </div>
            <div className="field">
              <label>Target Date *</label>
              <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}
