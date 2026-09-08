import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import {
  byId, coll, refLabel, trackStages, projectUnits, projectFloors,
  blockReason, prog, canAct
} from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import PossessionForm, { type PossessionActiveForm } from "../components/PossessionForm";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import Table, { TableRow, TableCell } from "../ui/tw/Table";
import StatusBadge from "../ui/tw/StatusBadge";

const ALL_FLOORS = "__all__";
type ActiveForm = PossessionActiveForm;

/* Shortcut view onto the two handover-stage entries already wired into
   the generic Stage/StageMap/Checklist system (STG-HOI, STG-HOO) — see
   backend/seed.js. Reuses the exact same blockReason/prog/canAct/
   submitChecklist machinery components/Drawer.tsx uses for every other
   gate; this page adds no new checklist logic, just a faster way to
   reach these two stages across many units without opening each unit's
   drawer individually. The fill-out form itself opens as a SidePanel
   drawer, the same visual pattern as AssignModal.tsx's "Assign Work"
   form — not a popup, not a plain card. */
export default function HandoverChecklist() {
  const { data, currentProjectId, setCurrentProjectId, myRole } = useApp();
  // Same pattern as TowerBoard.tsx: this page owns its own Project filter
  // instead of only trusting whatever the global currentProjectId happens
  // to be (set from Dashboard/TowerBoard) — a DRI landing here directly
  // shouldn't have to switch project somewhere else first.
  const allProjects = coll(data, "projects").filter((p) => p.active !== false);
  const [viewProjectId, setViewProjectId] = useState("");
  const projectId = viewProjectId || currentProjectId;
  const project = byId(allProjects, projectId);

  const floors = projectFloors(data, projectId);
  const [fFloor, setFFloor] = useState(floors[0]?.id || ALL_FLOORS);
  const [q, setQ] = useState("");
  const [activeForm, setActiveForm] = useState<ActiveForm | null>(null);

  const unitStages = trackStages(data, projectId, "unit");
  const hoiIdx = unitStages.findIndex((x) => x.stage.id === "STG-HOI");
  const hooIdx = unitStages.findIndex((x) => x.stage.id === "STG-HOO");

  const mapped = hoiIdx !== -1 && hooIdx !== -1;
  const hoiStage = mapped ? unitStages[hoiIdx] : null;
  const hooStage = mapped ? unitStages[hooIdx] : null;

  let units = projectUnits(data, projectId);
  if (fFloor !== ALL_FLOORS) units = units.filter((u) => u.floorId === fFloor);
  if (q) {
    const ql = q.toLowerCase();
    units = units.filter((u) => (u.name + " " + u.code).toLowerCase().includes(ql));
  }
  units = units.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));

  const hoiPassed = mapped ? units.filter((u) => prog(data, u.id, "STG-HOI").status === "done").length : 0;
  const hooPassed = mapped ? units.filter((u) => prog(data, u.id, "STG-HOO").status === "done").length : 0;

  return (
    <div>
      <PageHeader />

      <Card className="flex gap-3 flex-wrap mb-5">
        <div className="w-[130px] shrink-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown
            value={viewProjectId}
            onChange={(v) => { setViewProjectId(v); setCurrentProjectId(v); setFFloor(ALL_FLOORS); }}
            options={[{ value: "", label: "Choose" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
        </div>
        <div className="w-[140px] shrink-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
          <SearchDropdown
            searchable={false}
            value={fFloor}
            onChange={setFFloor}
            options={[{ value: ALL_FLOORS, label: "All Floors" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
            neutralActive
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Search Unit</div>
          <input className="input w-full" placeholder="Unit name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      {!mapped ? (
        <Card className="text-center text-[13px] text-[var(--text-muted)]">
          Internal Possession / Owner Possession stages aren't mapped for this project yet.
          Add them via <b>Masters ▸ Stage Mapping</b> (see STG-HOI / STG-HOO in Masters ▸ Stages).
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Total Units</div>
                  <div className="text-2xl font-extrabold leading-none">{units.length}</div>
                  <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5">
                    {fFloor === ALL_FLOORS ? "Across all floors" : "On selected floor"}
                  </div>
                </div>
                <div className="w-7 h-7 rounded-radius-sm bg-[var(--bg-subtle)] text-[var(--text-muted)] flex items-center justify-center shrink-0">
                  <NavIcon name="handover" size={13} />
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Internal Completed</div>
                  <div className="text-2xl font-extrabold leading-none">{hoiPassed}/{units.length}</div>
                  <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5">
                    {units.length ? Math.round((hoiPassed / units.length) * 100) : 0}% completed
                  </div>
                </div>
                <div className="w-7 h-7 rounded-radius-sm bg-[rgba(34,197,94,0.12)] text-[var(--color-pass)] flex items-center justify-center shrink-0">
                  <NavIcon name="check" size={13} />
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Owner Completed</div>
                  <div className="text-2xl font-extrabold leading-none">{hooPassed}/{units.length}</div>
                  <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5">
                    {units.length ? Math.round((hooPassed / units.length) * 100) : 0}% completed
                  </div>
                </div>
                <div className="w-7 h-7 rounded-radius-sm bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <NavIcon name="team" size={13} />
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Pending</div>
                  <div className="text-2xl font-extrabold leading-none">{units.length - hoiPassed}</div>
                  <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5">
                    {units.length ? Math.round(((units.length - hoiPassed) / units.length) * 100) : 0}% pending
                  </div>
                </div>
                <div className="w-7 h-7 rounded-radius-sm bg-primary-light text-primary flex items-center justify-center shrink-0">
                  <NavIcon name="clock" size={13} />
                </div>
              </div>
            </Card>
          </div>

          <Card padded={false} className="p-[18px]">
            <Table
              columns={["Unit", "Internal Possession", "Owner Possession"]}
              empty="No units match these filters."
              maxHeight="560px"
            >
              {units.map((u) => {
                const floorName = refLabel(data, "floors", u.floorId);
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        {u.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StageCell
                        unitId={u.id} unitName={u.name} floorName={floorName} projectName={project?.name || ""}
                        idx={hoiIdx} joined={hoiStage!} myRole={myRole} onOpenForm={setActiveForm} data={data}
                        currentProjectId={projectId} solid
                        stageDesc="Civil / QC internal inspection before owner possession."
                      />
                    </TableCell>
                    <TableCell>
                      <StageCell
                        unitId={u.id} unitName={u.name} floorName={floorName} projectName={project?.name || ""}
                        idx={hooIdx} joined={hooStage!} myRole={myRole} onOpenForm={setActiveForm} data={data}
                        currentProjectId={projectId} solid={false}
                        stageDesc="Final owner possession and handover inspection."
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
          </Card>
        </>
      )}

      <PossessionForm form={activeForm} onDone={() => setActiveForm(null)} />
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
      <div className="flex gap-3.5 items-start min-w-0">
        <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
          <NavIcon name="handover" size={20} />
        </div>
        <div>
          <div className="text-xl font-semibold tracking-tight leading-tight">Handover Checklist</div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
            Internal (Civil/QC) and Owner possession checklists, unit by unit.
          </div>
        </div>
      </div>
    </div>
  );
}

function StageCell({
  unitId, unitName, floorName, projectName, idx, joined, myRole, onOpenForm, data, currentProjectId, solid, stageDesc
}: {
  unitId: string; unitName: string; floorName: string; projectName: string; idx: number;
  joined: ReturnType<typeof trackStages>[number];
  myRole: () => any; onOpenForm: (f: ActiveForm) => void;
  data: any; currentProjectId: string | null; solid: boolean; stageDesc: string;
}) {
  const p = prog(data, unitId, joined.stage.id);
  const done = p.status === "done";
  const fail = p.status === "fail";
  // Deliberately NOT gating the button on blockReason() — a Possession
  // checklist is a walkthrough/paperwork record, not a construction-sequence
  // gate, so "structure not released yet" is informational only (shown as
  // the row's own sub-text, e.g. "Waiting on QC GATE 4") and must never
  // stop someone opening or filling the form. blockReason() itself is
  // untouched — it still gates every other stage in Drawer.tsx as before.
  const block = blockReason(data, currentProjectId, "unit", unitId, idx);
  const openSnags = coll(data, "snags").filter((s: any) => s.unitId === unitId && s.status !== "Closed");
  const mine = canAct(myRole(), joined.stage);
  const chk = joined.map.checklistId ? byId(coll(data, "checklists"), joined.map.checklistId) : null;

  const subtext = fail && p.note
    ? p.note
    : openSnags.length > 0
    ? `Open snag on this unit (${openSnags.length})`
    : block || null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div>
        {done ? (
          <StatusBadge status="Completed" label="Completed" />
        ) : fail ? (
          <StatusBadge status="Snagged" label="Failed" />
        ) : (
          <StatusBadge status={solid ? "Pending" : "Locked"} label={solid ? "Pending" : "Waiting"} />
        )}
        {!done && subtext && <div className="text-[10.5px] text-[var(--text-muted)] mt-1 max-w-[220px]">{subtext}</div>}
      </div>
      {mine && chk ? (
        <Btn
          label={(done ? "View / Refill" : fail ? "Rework" : "Fill Form") + " →"}
          size="sm"
          color={fail ? "danger" : done || !solid ? "secondary" : "primary"}
          className={!done && !fail && !solid ? "!bg-transparent !border-primary !text-primary" : ""}
          onClick={() => onOpenForm({
            unitId, unitName, floorName, projectName,
            stageId: joined.stage.id, stageName: joined.stage.name, stageDesc, checklistId: chk.id
          })}
        />
      ) : (
        !done && !fail && <span className="text-[11px] text-[var(--text-muted)]">Not started</span>
      )}
    </div>
  );
}

