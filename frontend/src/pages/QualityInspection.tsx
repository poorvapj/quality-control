import React, { useEffect, useMemo, useState } from "react";
import { useApp, authHeaders } from "../context/AppContext";
import { API_BASE } from "../services/config";
import { coll, myProjects, projectFloors, byId } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import PhotoGroupUploader from "../components/PhotoGroupUploader";
import SidePanel from "../components/SidePanel";
import StatTile from "../components/StatTile";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Badge from "../ui/tw/Badge";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import type { Photo, QualityInspection as QI, QualityInspectionResult, Severity, Snag } from "../types";

interface VmsWorkItem { itemId: string; itemType: "scopeItem" | "subItem"; parentItemId: string | null; description: string; unit: string }
interface VmsWorkOrderEntry { workOrderNo: string; items: VmsWorkItem[] }
interface VmsProjectEntry { projectCode: string; projectName: string; workOrders: VmsWorkOrderEntry[] }
type WorkItemsResponse = { available: false; reason: string } | { available: true; projects: VmsProjectEntry[] };

const RESULTS: QualityInspectionResult[] = ["Pass", "Fail", "Rework Required"];
const SEVERITIES: Severity[] = ["Critical", "Major", "Minor"];
const CHECKLIST_STATUSES = ["OK", "Not OK", "N/A"] as const;
const todayStr = () => new Date().toISOString().slice(0, 10);

// The site's physical QA/QC checklists, transcribed verbatim (per-item
// text only — Status/Remarks are filled in by the inspector, not part of
// the master list). Keyed by the checklist's own title, used as both the
// "Work Type" picker's value and the record's `workType`.
const QC_CHECKLISTS: Record<string, string[]> = {
  "R.C.C. Slab Inspection": [
    "Shuttering check: verify slab level, thickness, dimensions, support/props, stability, tight joints, and cleanliness.",
    "Reinforcement steel: check bar diameter, spacing, top and bottom reinforcement, extra bars, laps, anchorage, and openings as per drawings.",
    "Cover and embedded services: verify cover blocks, electrical conduits, sleeves, and other inserts do not displace reinforcement.",
    "Pre-pour approval: confirm inspection clearance, concrete grade, pour sequence, access, and curing arrangements."
  ],
  "Brickwork Inspection": [
    "Brickwork layout: check wall location, thickness, openings, and alignment against approved drawings.",
    "Line, level, and plumb: check courses and wall faces regularly using suitable instruments.",
    "Bond and joints: ensure proper bond, staggered vertical joints, uniform joint thickness, and fully filled mortar joints.",
    "Mortar and bricks: verify approved materials, mortar mix, brick condition, and appropriate wetting where specified.",
    "Laying and curing: ensure proper laying technique, toothed/keyed junctions where specified, and curing as required."
  ],
  "Plastering Inspection": [
    "Pre-plaster services: check plumbing pipes, electrical conduits/boxes, and A.C. pipe/fittings before plastering.",
    "Joint treatment: apply approved fibre mesh at concrete–brickwork junctions and other specified locations.",
    "Surface preparation: ensure background is clean, sound, and prepared to the approved method; provide bonding treatment where specified.",
    "Finish, level, and plumb: check thickness, flatness, corners, edges, line, level, and verticality."
  ],
  "Tile Work Inspection": [
    "Floor level and slope: verify finished levels and required slope toward floor traps/drains in wet areas.",
    "Tile condition: check tiles for cracks, chips, scratches, stains, and other visible defects before laying.",
    "Base surface: confirm the substrate is sound, clean, level/appropriately sloped, and free of loose material.",
    "Joints and gaps: check uniform joint width, alignment, spacers, and approved grout/filler.",
    "Hollow tiles and finish: tap-test for hollow areas where appropriate; check lippage, cutting, edge finish, and skirting alignment.",
    "Protection and cleaning: clean grout residue and protect finished tiles from damage until handover."
  ]
};
type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

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
  const { data, currentUserId, myRole, apply, toast, me } = useApp();
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

  function linkedSnag(insp: QI): Snag | null {
    return insp.linkedSnagId ? byId(snags, insp.linkedSnagId) : null;
  }

  const [panelOpen, setPanelOpen] = useState(false);
  const [reInspectOf, setReInspectOf] = useState<QI | null>(null);
  const [historyFloor, setHistoryFloor] = useState<{ floorId: string; floorLabel: string } | null>(null);

  // --- filters for the list ------------------------------------------------
  const [fProjectId, setFProjectId] = useState("");
  const [fFloorId, setFFloorId] = useState("");
  const [fResult, setFResult] = useState("");
  const [fDri, setFDri] = useState("");
  const [fSnagStatus, setFSnagStatus] = useState(""); // "", "open", "overdue", "closed"

  const fFloors = projectFloors(data, fProjectId || null);

  const filtered = useMemo(() => {
    const today = todayStr();
    return inspections.filter((i) => {
      if (fProjectId && i.projectId !== fProjectId) return false;
      if (fFloorId && i.floorId !== fFloorId) return false;
      if (fResult && i.result !== fResult) return false;
      if (fDri && i.correctiveAction?.assignedToUserId !== fDri) return false;
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
  }, [inspections, fProjectId, fFloorId, fResult, fDri, fSnagStatus, snags]);

  const openIssues = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status !== "Closed"; }).length;
  const failedCount = inspections.filter((i) => i.result === "Fail").length;
  const overdueCount = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status !== "Closed" && s.dueAt && s.dueAt < Date.now(); }).length;
  const resolvedCount = inspections.filter((i) => { const s = linkedSnag(i); return s && s.status === "Closed"; }).length;

  const projectOptions = allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const driOptions = users.filter((u) => inspections.some((i) => i.correctiveAction?.assignedToUserId === u.id)).map((u) => ({ value: u.id, label: u.name }));

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatTile label="Open Quality Issues" value={openIssues} icon="bug" valueClassName={openIssues > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Failed Inspections" value={failedCount} icon="bug" />
        <StatTile label="Overdue Corrective Actions" value={overdueCount} icon="clock" valueClassName={overdueCount > 0 ? "text-[var(--color-fail)]" : undefined} />
        <StatTile label="Resolved Issues" value={resolvedCount} icon="award" />
      </div>

      <Card className="flex gap-3.5 flex-wrap mb-5">
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
      </Card>

      <Card padded={false} className="p-[18px]">
        <Table
          columns={["Date", "Project", "Floor", "VMS Reference", "Result", "Inspector", "Snag / Corrective Action", ""]}
          colWidths={["9%", "9%", "15%", "16%", "13%", "12%", "17%", "9%"]}
          maxHeight="560px"
        >
          {filtered.map((insp) => {
            const snag = linkedSnag(insp);
            const overdue = !!snag && snag.status !== "Closed" && !!snag.dueAt && snag.dueAt < Date.now();
            return (
              <TableRow key={insp.id}>
                <TableCell muted className="whitespace-nowrap">{insp.inspectionDate}</TableCell>
                <TableCell className="whitespace-nowrap">{insp.projectCode}</TableCell>
                <TableCell strong>
                  {insp.floorName}
                  {insp.workType && <div className="text-[10.5px] text-[var(--text-muted)] font-normal mt-0.5">{insp.workType}</div>}
                </TableCell>
                <TableCell muted className="truncate max-w-0">{insp.itemDescription ? `${insp.workOrderNo} · ${insp.itemDescription}` : "—"}</TableCell>
                <TableCell>
                  <Badge color={insp.result === "Pass" ? "green" : insp.result === "Fail" ? "red" : "amber"}>
                    <span className="whitespace-nowrap">{insp.result}</span>
                  </Badge>
                </TableCell>
                <TableCell muted className="truncate max-w-0">{insp.inspectorName}</TableCell>
                <TableCell>
                  {!snag ? <span className="text-[var(--text-sub)]">—</span> : (
                    <div>
                      <Badge color={snag.status === "Closed" ? "green" : overdue ? "red" : "amber"}>
                        <span className="whitespace-nowrap">{snag.status === "Closed" ? "Resolved" : overdue ? "Overdue" : snag.status}</span>
                      </Badge>
                      <div className="text-[10.5px] text-[var(--text-muted)] mt-1 truncate">
                        {insp.correctiveAction?.assignedToName} · due {insp.correctiveAction?.targetDate}
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1.5 items-start">
                    <Btn label="History" color="secondary" size="sm" onClick={() => setHistoryFloor({ floorId: insp.floorId, floorLabel: insp.floorName })} />
                    {canCreate && insp.result !== "Pass" && snag?.status !== "Closed" && (
                      <Btn label="Re-inspect" color="secondary" size="sm" onClick={() => { setReInspectOf(insp); setPanelOpen(true); }} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
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
  const [workOrderNo, setWorkOrderNo] = useState("");
  const [itemId, setItemId] = useState("");
  const [inspectionDate, setInspectionDate] = useState(todayStr());
  const [workType, setWorkType] = useState("");
  const [contractor, setContractor] = useState("");
  const [checklist, setChecklist] = useState<{ text: string; status: ChecklistStatus | ""; remarks: string }[]>([]);
  const [result, setResult] = useState<QualityInspectionResult>("Pass");
  const [severity, setSeverity] = useState<Severity>("Major");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Pre-fill from the unit/item being re-inspected, once, when the panel opens.
  useEffect(() => {
    if (!open) return;
    if (reInspectOf) {
      setProjectId(reInspectOf.projectId);
      setFloorId(reInspectOf.floorId);
      setWorkOrderNo(reInspectOf.workOrderNo || "");
      setItemId(reInspectOf.itemId || "");
      setWorkType(reInspectOf.workType || "");
      setChecklist((reInspectOf.workType && QC_CHECKLISTS[reInspectOf.workType] || []).map((text) => ({ text, status: "", remarks: "" })));
    } else {
      setProjectId(""); setFloorId(""); setWorkOrderNo(""); setItemId("");
      setWorkType(""); setChecklist([]);
    }
    setInspectionDate(todayStr());
    setContractor("");
    setResult("Pass"); setSeverity("Major"); setRemarks(""); setPhotos([]);
    setAssignedToUserId(""); setTargetDate("");
  }, [open, reInspectOf]);

  // Picking a Work Type (re)seeds the checklist from the master list —
  // blank status/remarks, ready for the inspector to fill in. Switching
  // Work Type mid-form replaces the whole checklist (the old answers were
  // for a different checklist, not partial progress on this one).
  function onWorkTypeChange(wt: string) {
    setWorkType(wt);
    setChecklist((QC_CHECKLISTS[wt] || []).map((text) => ({ text, status: "", remarks: "" })));
  }
  function setItemStatus(idx: number, status: ChecklistStatus) {
    setChecklist((prev) => prev.map((row, i) => (i === idx ? { ...row, status } : row)));
    // Nudge the overall Result toward Fail the moment anything is marked
    // Not OK — still just a default the inspector can change, never forced.
    if (status === "Not OK") setResult((r) => (r === "Pass" ? "Fail" : r));
  }
  function setItemRemarks(idx: number, text: string) {
    setChecklist((prev) => prev.map((row, i) => (i === idx ? { ...row, remarks: text } : row)));
  }

  const project = allProjects.find((p) => p.id === projectId) || null;
  const floors = projectFloors(data, projectId || null);
  const floor = byId(floors, floorId);

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
    if (checklist.some((row) => !row.status)) { toast("Mark every checklist point as OK / Not OK / N/A"); return; }
    if (result !== "Pass" && !remarks.trim()) { toast("Remarks are required for Fail / Rework Required"); return; }
    if (result !== "Pass" && !assignedToUserId) { toast("A responsible DRI must be assigned for Fail / Rework Required"); return; }
    if (result !== "Pass" && !targetDate) { toast("A target date is required for the corrective action"); return; }

    setSaving(true);
    const assignee = users.find((u) => u.id === assignedToUserId);
    const id = nextId("QI", []); // id uniqueness enforced by server-side unique index on `id`, same as every other master
    const needsSnag = result !== "Pass";
    // Snag id/record built up-front so it can be cross-referenced from the
    // inspection record in the SAME apply() batch — both are brand-new
    // records created together exactly once, which is what prevents a
    // duplicate snag ever being raised for the same failed inspection
    // (there is no edit path for an already-saved inspection, only a
    // fresh "re-inspect" record).
    const snagId = needsSnag ? nextId("SNG", []) : null;

    const rec: QI = {
      id,
      projectId, projectCode: project?.code || "", projectName: project?.name || "",
      floorId, floorName: floor?.name || "",
      workOrderNo: itemEntry ? workOrderNo : undefined,
      itemId: itemEntry ? itemEntry.itemId : undefined,
      itemType: itemEntry?.itemType,
      itemDescription: itemEntry?.description,
      unit: itemEntry?.unit,
      workType,
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
      createdAt: Date.now()
    };

    const ops: any[] = [
      { op: "upsert", coll: "qualityInspections", rec },
      buildEventOp(currentUserId, "QUALITY_INSPECTION", id, "", `Quality Inspection · ${result} · ${rec.floorName}`)
    ];
    if (needsSnag && snagId) {
      // Location always in the title — never just the VMS item description
      // — so the snag/quality observation is unambiguous on the DRI
      // dashboard and in their failure history, even if a VMS item was
      // also picked.
      const location = rec.floorName;
      const label = itemEntry?.description ? `${location} · ${itemEntry.description}` : location;
      ops.push({
        op: "upsert", coll: "snags",
        rec: {
          id: snagId,
          projectId,
          floorId,
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
      desc={reInspectOf ? `Re-checking: ${reInspectOf.floorName}` : "Record a Pass/Fail/Rework Required result against a real Floor."}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Inspection"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Project *</label>
          <SearchDropdown
            value={projectId}
            disabled={!!reInspectOf}
            onChange={(v) => { setProjectId(v); setFloorId(""); }}
            options={[{ value: "", label: "Select project…" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
        <div className="field full">
          <label>Floor *</label>
          <SearchDropdown
            value={floorId}
            disabled={!!reInspectOf || !projectId}
            onChange={setFloorId}
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
            options={[{ value: "", label: "Select checklist…" }, ...Object.keys(QC_CHECKLISTS).map((wt) => ({ value: wt, label: wt }))]}
          />
        </div>

        {checklist.length > 0 && (
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
          <input className="input" value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Optional" />
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
          />
        </div>

        <div className="field full">
          <label>Remarks{result !== "Pass" ? " *" : ""}</label>
          <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={result !== "Pass" ? "Describe the defect — required for Fail/Rework" : "Optional"} />
        </div>

        <div className="field full">
          <label>Photo Evidence</label>
          <PhotoGroupUploader label="Inspection photos" photos={photos} onChange={setPhotos} optional />
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
              <SearchDropdown
                value={assignedToUserId}
                onChange={setAssignedToUserId}
                options={[{ value: "", label: "Select DRI…" }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
              />
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
