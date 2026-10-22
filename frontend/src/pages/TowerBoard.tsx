import React, { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, projectFloors, floorUnits, trackStages, prog, floorReleased, floorBelow, unitSummary, myProjects, byId } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";
import { executionComplete } from "../shared/misData";
import { boardLensFor, qualityByUnit, qualityByFloor, measurementByUnit, LENS_LABEL, type BoardLens } from "../shared/boardLens";

const ALL_FLOORS = "__all__";
type StatusFilter = "" | "open-snag" | "qc-fail" | "locked" | "handed-over" | "not-started"
  | "ex-done" | "q-checked" | "q-in-progress" | "q-failed" | "q-pending" | "q-none" | "m-done" | "m-pending" | "m-none";
const LENSES: BoardLens[] = ["all", "execution", "quality", "measurement"];
const AMBER = "#f59e0b";
const IN_PROGRESS_BLUE = "#3b82f6";

export default function TowerBoard() {
  const { data, currentProjectId, setCurrentProjectId, currentUserId, openDrawer, myRole } = useApp();
  const allProjects = myProjects(data, currentUserId);
  // The filter itself starts unset ("Choose") rather than showing whatever
  // project happens to be globally selected — but the board below still
  // shows real data from the start (currentProjectId), exactly like
  // before; only the dropdown's own label defaults to "Choose" until
  // someone actively picks from it.
  // Quality team members (including its leader, Rishabh) work almost
  // exclusively on Zen Garden right now — default the board straight to
  // it for them instead of making them pick it every time.
  const me = byId(coll(data, "users"), currentUserId);
  const myTeam = me?.teamId ? byId(coll(data, "teams"), me.teamId) : null;
  const isQualityTeam = myTeam?.role === "Quality";
  const zenGarden = allProjects.find((p) => p.name === "Zen Garden");
  const defaultProjectId = isQualityTeam && zenGarden ? zenGarden.id : "";
  const [viewProjectId, setViewProjectId] = useState(defaultProjectId);
  const [fFloor, setFFloor] = useState(ALL_FLOORS);
  const [fStatus, setFStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
  // The same units, seen the way each team needs them. Execution / Quality /
  // Measurement people are held to their own lens; everyone else (Admin, DRI,
  // CRM…) sees the combined board and can flip between the lenses.
  const roleLens = boardLensFor(data, myRole());
  const [lensChoice, setLensChoice] = useState<BoardLens>("all");
  const lens: BoardLens = roleLens !== "all" ? roleLens : lensChoice;
  const stageLens = lens === "all" || lens === "execution"; // the original stage-progress colouring
  const inspectionsColl = coll(data, "qualityInspections");
  const measurementsColl = coll(data, "materialMeasurements");
  const qualityMap = useMemo(() => qualityByUnit(inspectionsColl), [inspectionsColl]);
  const qualityByFloorMap = useMemo(() => qualityByFloor(inspectionsColl), [inspectionsColl]);
  const measureMap = useMemo(() => measurementByUnit(measurementsColl), [measurementsColl]);
  const statusOptions = lens === "quality"
    ? [{ value: "", label: "All Statuses" }, { value: "q-checked", label: "Quality checked" }, { value: "q-in-progress", label: "In progress" }, { value: "q-failed", label: "Failed / rework" }, { value: "q-pending", label: "Awaiting approval" }, { value: "q-none", label: "Not inspected" }]
    : lens === "measurement"
    ? [{ value: "", label: "All Statuses" }, { value: "m-done", label: "Measured" }, { value: "m-pending", label: "Awaiting approval" }, { value: "m-none", label: "Not measured" }]
    : [
        { value: "", label: "All Statuses" },
        ...(lens === "execution" ? [{ value: "ex-done", label: "Work completed" }] : []),
        { value: "open-snag", label: "Open snag" },
        { value: "qc-fail", label: "QC fail / rework" },
        { value: "locked", label: "Structure not released" },
        { value: "handed-over", label: "Handed over" },
        { value: "not-started", label: "Not started" }
      ];
  const boardProjectId = viewProjectId || currentProjectId;
  let floors = projectFloors(data, boardProjectId);
  if (fFloor !== ALL_FLOORS) floors = floors.filter((f) => f.id === fFloor);
  const fstages = trackStages(data, boardProjectId, "floor");
  const hasFilter = fStatus !== "" || q.trim() !== "";
  // Resolved (closed) snags per unit — a lighter, corner-dot indicator since
  // unlike an open snag it isn't an active alert, just history worth seeing.
  const closedSnagsByUnit = new Map<string, number>();
  for (const sn of coll(data, "snags")) {
    if (sn.status !== "Closed" || !sn.unitId) continue;
    closedSnagsByUnit.set(sn.unitId, (closedSnagsByUnit.get(sn.unitId) || 0) + 1);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-center min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="board" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Tower Quality Matrix</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              {lens === "quality" ? "Quality view — a green flat has passed its quality check. Tap a unit for details."
                : lens === "measurement" ? "Measurement view — a green flat has been measured. Tap a unit for details."
                : lens === "execution" ? "Execution view — trade progress by unit. Tap a unit for its trade timeline · tap the floor label for the RCC structure track."
                : "Tap a unit for its trade timeline · tap the floor label for the RCC structure track. A green tick on a flat means its quality check has passed."}
            </div>
          </div>
        </div>
        {roleLens === "all" ? (
          <div className="inline-flex rounded-radius-md border border-[var(--border)] overflow-hidden self-center" role="tablist" aria-label="Board view">
            {LENSES.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={lens === l}
                onClick={() => { setLensChoice(l); setFStatus(""); }}
                className={"px-3.5 py-1.5 text-[12px] font-semibold " + (lens === l ? "bg-primary-light text-primary" : "text-[var(--text-muted)] hover:bg-[var(--bg-card-hover)]")}
              >
                {LENS_LABEL[l]}
              </button>
            ))}
          </div>
        ) : (
          <span className="self-center text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary-light text-primary">{LENS_LABEL[lens]} view</span>
        )}
      </div>

      <Card className="flex gap-3 flex-wrap mb-5">
        <div className="w-[200px] shrink-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Project</div>
          <SearchDropdown
            value={viewProjectId}
            onChange={(v) => { setViewProjectId(v); setCurrentProjectId(v); setFFloor(ALL_FLOORS); }}
            options={[{ value: "", label: "All Projects" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
        </div>
        <div className="w-[160px] shrink-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Floor</div>
          <SearchDropdown
            searchable={false}
            value={fFloor}
            onChange={setFFloor}
            options={[{ value: ALL_FLOORS, label: "All Floors" }, ...projectFloors(data, boardProjectId).map((f) => ({ value: f.id, label: f.name }))]}
            neutralActive
          />
        </div>
        <div className="w-[180px] shrink-0">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Status</div>
          <SearchDropdown
            searchable={false}
            value={fStatus}
            onChange={(v) => setFStatus(v as StatusFilter)}
            options={statusOptions}
            neutralActive
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Search Unit</div>
          <input className="input w-full" placeholder="Unit name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <Card>
        {floors.length === 0 && <div className="empty">No floors yet — add them in Masters ▸ Floor.</div>}
        {floors.slice().reverse().map((f) => {
          let fdone = 0, ffail = false;
          for (const x of fstages) {
            const p = prog(data, f.id, x.stage.id);
            if (p.status === "done") fdone++;
            if (p.status === "fail") ffail = true;
          }
          const cured = floorReleased(data, boardProjectId, f.id);
          const below = floorBelow(data, boardProjectId, f.id);
          const canCast = !below || floorReleased(data, boardProjectId, below.id);
          const label = cured ? "CURED ✓" : !canCast ? "LOCKED" : fdone > 0 ? `RCC ${fdone}/${fstages.length}` : "NOT STARTED";

          // Precompute match state for every unit on this floor first, so a
          // floor with zero matching units can be skipped entirely once a
          // Status/Search filter is active — otherwise every floor still
          // renders (just with its non-matching units dimmed), same as
          // before filters existed.
          const unitRows = floorUnits(data, boardProjectId, f.id).map((u) => {
            const s = unitSummary(data, boardProjectId, u.id);
            const hasSnag = s.snags > 0;
            const handedOver = s.complete;
            const notStarted = s.done === 0 && !s.fail;
            const exDone = lens === "execution" && !!boardProjectId && executionComplete(data, boardProjectId, u.id);
            const qs = qualityMap.get(u.id)?.state ?? qualityByFloorMap.get(f.id)?.state ?? "none";
            const ms = measureMap.get(u.id)?.state ?? "none";
            const matchesStatus =
              fStatus === "" ? true
              : fStatus === "ex-done" ? exDone
              : fStatus === "q-checked" ? qs === "checked"
              : fStatus === "q-in-progress" ? qs === "in-progress"
              : fStatus === "q-failed" ? qs === "failed"
              : fStatus === "q-pending" ? qs === "pending"
              : fStatus === "q-none" ? qs === "none"
              : fStatus === "m-done" ? ms === "measured"
              : fStatus === "m-pending" ? ms === "pending"
              : fStatus === "m-none" ? ms === "none"
              : fStatus === "open-snag" ? hasSnag
              : fStatus === "qc-fail" ? s.fail
              : fStatus === "locked" ? s.locked
              : fStatus === "handed-over" ? handedOver
              : notStarted;
            const ql = q.trim().toLowerCase();
            const matchesSearch = !ql || (u.name + " " + u.code).toLowerCase().includes(ql);
            return { u, s, hasSnag, qs, ms, exDone, matches: matchesStatus && matchesSearch };
          });
          if (hasFilter && !unitRows.some((r) => r.matches)) return null;

          // Floor label: the RCC state for the stage views, a done-count for
          // the quality / measurement views (turns green when every unit is done).
          const totalUnits = unitRows.length;
          const doneUnits = lens === "quality" ? unitRows.filter((r) => r.qs === "checked").length
            : lens === "measurement" ? unitRows.filter((r) => r.ms === "measured").length : 0;
          const displayLabel = stageLens ? label : lens === "quality" ? `QC ${doneUnits}/${totalUnits}` : `MEASURED ${doneUnits}/${totalUnits}`;
          const floorAllDone = !stageLens && totalUnits > 0 && doneUnits === totalUnits;

          return (
            <div className="floor-row" key={f.id}>
              <div
                className="floor-label"
                style={
                  !stageLens ? (floorAllDone ? { background: "var(--color-pass)", borderColor: "var(--color-pass)", color: "#fff" } : undefined)
                  : ffail ? { borderColor: "var(--color-fail)", color: "var(--color-fail)" }
                  : cured ? { background: "var(--color-pass)", borderColor: "var(--color-pass)", color: "#fff" }
                  : undefined
                }
                onClick={() => openDrawer({ kind: "floor", id: f.id })}
              >
                {f.code}<br /><span style={{ fontSize: 8, opacity: 0.75 }}>{displayLabel}</span>
              </div>
              <div className="cells-grid">
                {unitRows.map(({ u, s, hasSnag, qs, ms, exDone, matches }) => {
                  const closedSnags = closedSnagsByUnit.get(u.id) || 0;
                  const hasResolvedOnly = !hasSnag && closedSnags > 0;
                  let bg = "var(--bg-subtle)";
                  let textColor: string | undefined;
                  let tip = `${u.name} · ${u.type || ""}`;
                  if (lens === "quality") {
                    bg = qs === "checked" ? "var(--color-pass)" : qs === "failed" ? "var(--color-fail)" : qs === "pending" ? AMBER : qs === "in-progress" ? IN_PROGRESS_BLUE : "var(--bg-subtle)";
                    if (qs === "none") textColor = "var(--text-sub)";
                    const failing = (qualityMap.get(u.id) ?? qualityByFloorMap.get(f.id))?.latest;
                    tip += qs === "checked" ? " · quality check passed — Finishing & Handover cleared"
                      : qs === "failed" ? ` · quality check ${(failing?.result || "failed").toLowerCase()}${failing?.workType ? " — " + failing.workType : ""}${failing && !failing.unitId ? " (whole floor)" : ""}`
                      : qs === "pending" ? " · quality check passed — awaiting leader approval"
                      : qs === "in-progress" ? " · quality checks in progress — Finishing & Handover not cleared yet"
                      : " · not inspected yet";
                  } else if (lens === "measurement") {
                    bg = ms === "measured" ? "var(--color-pass)" : ms === "pending" ? AMBER : "var(--bg-subtle)";
                    if (ms === "none") textColor = "var(--text-sub)";
                    const n = measureMap.get(u.id)?.count || 0;
                    tip += ms === "measured" ? ` · measured (${n} record${n === 1 ? "" : "s"})`
                      : ms === "pending" ? " · measurement awaiting leader approval"
                      : " · not measured yet";
                  } else {
                    // Execution's own "done"/"complete" only tracks trade
                    // progress — it knew nothing about a Quality Inspection
                    // sitting unapproved or failed on this same unit, so a
                    // flat could show plain green here while the Quality
                    // lens, looking at the exact same unit, showed amber
                    // (awaiting approval) or red (failed) for it. Quality's
                    // failed/pending state now overrides the execution
                    // colour here too, so the two lenses never disagree on
                    // the same unit.
                    if (s.locked) bg = "var(--color-locked)";
                    else if (s.fail || qs === "failed") bg = "var(--color-fail)";
                    else if (qs === "pending") bg = AMBER;
                    else if (exDone) bg = "var(--color-pass)";
                    else if (s.complete) bg = "#64748b";
                    else if (s.done > 0) bg = "var(--color-mep)";
                    tip += ` · ${s.done}/${s.total} stages`
                      + (hasSnag ? " · " + s.snags + " open snag(s)" : "")
                      + (closedSnags ? " · " + closedSnags + " resolved snag(s)" : "");
                    if (exDone) tip += " · execution work completed";
                    if (lens === "all") tip += qs === "checked" ? " · quality checked" : qs === "failed" ? " · quality check failed" : qs === "pending" ? " · quality check awaiting leader approval" : qs === "in-progress" ? " · quality checks in progress" : "";
                  }
                  return (
                    <div
                      key={u.id}
                      className={"cell" + (stageLens && s.locked ? " lockedcell" : "") + (stageLens && s.fail ? " pulse" : "") + (stageLens && hasSnag ? " has-snag" : "") + (stageLens && hasResolvedOnly ? " has-resolved-snag" : "")}
                      style={{ background: bg, color: textColor, opacity: hasFilter && !matches ? 0.25 : 1 }}
                      title={tip}
                      // Always opens — a "locked" unit can still carry a
                      // real open snag (the has-snag orange override paints
                      // right over the locked-gray tile, see index.css), and
                      // that was previously unclickable: the tile looked
                      // like an urgent alert but silently did nothing.
                      // Viewing the drawer is harmless either way — actions
                      // on individual stages are still gated separately by
                      // blockReason()/canAct(), not by this click.
                      onClick={() => openDrawer({ kind: "unit", id: u.id })}
                    >
                      {u.seq != null ? u.seq : u.code}
                      {lens === "all" && qs === "checked" && (
                        <span
                          aria-label="Quality checked"
                          style={{ position: "absolute", top: -4, right: -4, width: 13, height: 13, borderRadius: "50%", background: "var(--color-pass)", border: "1.5px solid var(--bg-card)", color: "#fff", fontSize: 8, lineHeight: "10px", textAlign: "center", fontWeight: 800 }}
                        >✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="legend-bar">
          {(lens === "quality" ? [
            { c: "var(--color-pass)", t: "Quality check passed (Finishing & Handover cleared)" },
            { c: IN_PROGRESS_BLUE, t: "In progress — earlier stages passed, Finishing & Handover not yet cleared" },
            { c: "var(--color-fail)", t: "Failed / rework" },
            { c: AMBER, t: "Passed — awaiting approval" },
            { c: "var(--bg-subtle)", t: "Not inspected", border: true }
          ] : lens === "execution" ? [
            { c: "var(--color-pass)", t: "Work completed (all trades done)" },
            { c: "var(--color-mep)", t: "Trades in progress" },
            { c: AMBER, t: "Quality check awaiting approval" },
            { c: "var(--color-fail)", t: "QC fail / rework" },
            { c: "var(--bg-subtle)", t: "Not started", border: true },
            { c: "var(--color-locked)", t: "Structure not released" },
            { c: "var(--theme-primary)", t: "Open snag" },
            { c: "#94a3b8", t: "Resolved snag" }
          ] : lens === "measurement" ? [
            { c: "var(--color-pass)", t: "Measured" },
            { c: AMBER, t: "Awaiting approval" },
            { c: "var(--bg-subtle)", t: "Not measured", border: true }
          ] : [
            { c: "#64748b", t: "Handed over" },
            { c: "var(--color-mep)", t: "Trades in progress" },
            { c: AMBER, t: "Quality check awaiting approval" },
            { c: "var(--color-fail)", t: "QC fail / rework" },
            { c: "var(--bg-subtle)", t: "Not started", border: true },
            { c: "var(--color-locked)", t: "Structure not released" },
            { c: "var(--theme-primary)", t: "Open snag" },
            { c: "var(--color-pass)", t: "Resolved snag" }
          ]).map((x) => (
            <div className="legend-item" key={x.t}><div className="legend-box" style={{ background: x.c, border: (x as any).border ? "1px solid var(--border)" : undefined }}></div> {x.t}</div>
          ))}
          {lens === "all" && <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-pass)", borderRadius: "50%" }}></div> ✓ Quality checked</div>}
        </div>
      </Card>
    </div>
  );
}
