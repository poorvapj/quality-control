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

  // Early in a project every unit on a floor is blocked for the exact same
  // reason ("Structure not released — Floor X is still casting"). This is
  // shown once as an informational banner — it never disables the forms
  // (Internal/Owner possession checklists are a paperwork record, not a
  // construction-sequence gate).
  const hoiBlocks = mapped ? units.map((u) => blockReason(data, projectId, "unit", u.id, hoiIdx)) : [];
  const sharedHoiBlock = hoiBlocks.length > 0 && hoiBlocks.every((b) => b && b === hoiBlocks[0]) ? hoiBlocks[0] : null;

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
          <div className="grid grid-cols-2 gap-3.5 mb-5">
            <PossessionSummaryCard label="Internal Possession" passed={hoiPassed} total={units.length} />
            <PossessionSummaryCard label="Owner Possession" passed={hooPassed} total={units.length} />
          </div>

          {sharedHoiBlock && (
            <Card className="mb-5 border-[var(--color-gate)] bg-[rgba(249,115,22,0.06)]">
              <div className="text-[12.5px] font-bold text-[var(--color-gate)]">⚠ {sharedHoiBlock}</div>
              <div className="text-[11.5px] text-[var(--text-muted)] mt-1">
                Informational only — the Internal and Owner possession forms below can still be opened and filled.
              </div>
            </Card>
          )}

          <Card padded={false} className="p-[18px]">
            <Table
              columns={["Unit", "Internal Possession", "Owner Possession"]}
              empty="No units match these filters."
            >
              {units.map((u) => {
                const floorName = refLabel(data, "floors", u.floorId);
                return (
                  <TableRow key={u.id}>
                    <TableCell strong>{u.name}</TableCell>
                    <TableCell>
                      <StageCell
                        unitId={u.id} unitName={u.name} floorName={floorName} projectName={project?.name || ""}
                        idx={hoiIdx} joined={hoiStage!} myRole={myRole} onOpenForm={setActiveForm} data={data}
                        currentProjectId={projectId} suppressReason={!!sharedHoiBlock}
                        stageDesc="Civil / QC internal inspection before owner possession."
                      />
                    </TableCell>
                    <TableCell>
                      <StageCell
                        unitId={u.id} unitName={u.name} floorName={floorName} projectName={project?.name || ""}
                        idx={hooIdx} joined={hooStage!} myRole={myRole} onOpenForm={setActiveForm} data={data}
                        currentProjectId={projectId} suppressReason={!!sharedHoiBlock}
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

function PossessionSummaryCard({ label, passed, total }: { label: string; passed: number; total: number }) {
  const pct = total ? Math.round((passed / total) * 100) : 0;
  const pending = total - passed;
  return (
    <Card>
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</div>
      <div className="text-2xl font-extrabold leading-none">{passed} / {total}</div>
      <div className="h-1.5 rounded-full bg-[var(--bg-subtle)] overflow-hidden mt-2.5">
        <div className="h-full rounded-full" style={{ width: pct + "%", background: pct === 0 ? "var(--bg-subtle)" : pct === 100 ? "var(--color-pass)" : "var(--theme-primary)" }} />
      </div>
      <div className="text-[11px] text-[var(--text-sub)] font-semibold mt-2">{pct}% completed · {pending} pending</div>
    </Card>
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
  unitId, unitName, floorName, projectName, idx, joined, myRole, onOpenForm, data, currentProjectId, suppressReason, stageDesc
}: {
  unitId: string; unitName: string; floorName: string; projectName: string; idx: number;
  joined: ReturnType<typeof trackStages>[number];
  myRole: () => any; onOpenForm: (f: ActiveForm) => void;
  data: any; currentProjectId: string | null; suppressReason?: boolean; stageDesc: string;
}) {
  const p = prog(data, unitId, joined.stage.id);
  const done = p.status === "done";
  const fail = p.status === "fail";
  // Deliberately NOT gating the button on blockReason() — a Possession
  // checklist is a walkthrough/paperwork record, not a construction-sequence
  // gate, so "structure not released yet" is informational only here
  // (still shown as a small note) and must never stop someone opening or
  // filling the form. blockReason() itself is untouched — it still gates
  // every other stage in Drawer.tsx exactly as before.
  const block = blockReason(data, currentProjectId, "unit", unitId, idx);
  const mine = canAct(myRole(), joined.stage);
  const chk = joined.map.checklistId ? byId(coll(data, "checklists"), joined.map.checklistId) : null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {done && <StatusBadge status="Completed" label="Passed" />}
      {fail && <StatusBadge status="Snagged" label="Failed" />}
      {fail && p.note && <span className="text-[11px] text-[var(--text-muted)]">{p.note}</span>}
      {mine && chk ? (
        <Btn
          label={done ? "View / Refill" : fail ? "Rework" : "Fill Form"}
          size="sm"
          color={fail ? "danger" : done ? "secondary" : "primary"}
          onClick={() => onOpenForm({
            unitId, unitName, floorName, projectName,
            stageId: joined.stage.id, stageName: joined.stage.name, stageDesc, checklistId: chk.id
          })}
        />
      ) : (
        !done && !fail && <span className="text-[11px] text-[var(--text-muted)]">Not started</span>
      )}
      {block && !suppressReason && <span className="text-[10.5px] text-[var(--text-muted)]">⚠ {block}</span>}
    </div>
  );
}

