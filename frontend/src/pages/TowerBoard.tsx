import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, projectFloors, floorUnits, trackStages, prog, floorReleased, floorBelow, unitSummary } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import Card from "../ui/tw/Card";

const ALL_FLOORS = "__all__";
type StatusFilter = "" | "open-snag" | "qc-fail" | "locked" | "handed-over" | "not-started";

export default function TowerBoard() {
  const { data, currentProjectId, setCurrentProjectId, openDrawer } = useApp();
  const allProjects = coll(data, "projects").filter((p) => p.active !== false);
  // The filter itself starts unset ("Choose") rather than showing whatever
  // project happens to be globally selected — but the board below still
  // shows real data from the start (currentProjectId), exactly like
  // before; only the dropdown's own label defaults to "Choose" until
  // someone actively picks from it.
  const [viewProjectId, setViewProjectId] = useState("");
  const [fFloor, setFFloor] = useState(ALL_FLOORS);
  const [fStatus, setFStatus] = useState<StatusFilter>("");
  const [q, setQ] = useState("");
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
          <div className="w-9 h-9 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="board" size={17} />
          </div>
          <div>
            <div className="text-[17px] font-semibold tracking-tight leading-tight">Tower Quality Matrix</div>
            <div className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-normal">
              Tap a unit for its trade timeline · tap the floor label for the RCC structure track.
            </div>
          </div>
        </div>
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
            options={[
              { value: "", label: "All Statuses" },
              { value: "open-snag", label: "Open snag" },
              { value: "qc-fail", label: "QC fail / rework" },
              { value: "locked", label: "Structure not released" },
              { value: "handed-over", label: "Handed over" },
              { value: "not-started", label: "Not started" }
            ]}
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
            const matchesStatus =
              fStatus === "" ? true
              : fStatus === "open-snag" ? hasSnag
              : fStatus === "qc-fail" ? s.fail
              : fStatus === "locked" ? s.locked
              : fStatus === "handed-over" ? handedOver
              : notStarted;
            const ql = q.trim().toLowerCase();
            const matchesSearch = !ql || (u.name + " " + u.code).toLowerCase().includes(ql);
            return { u, s, hasSnag, matches: matchesStatus && matchesSearch };
          });
          if (hasFilter && !unitRows.some((r) => r.matches)) return null;

          return (
            <div className="floor-row" key={f.id}>
              <div
                className="floor-label"
                style={
                  ffail ? { borderColor: "var(--color-fail)", color: "var(--color-fail)" }
                  : cured ? { background: "var(--color-pass)", borderColor: "var(--color-pass)", color: "#fff" }
                  : undefined
                }
                onClick={() => openDrawer({ kind: "floor", id: f.id })}
              >
                {f.code}<br /><span style={{ fontSize: 8, opacity: 0.75 }}>{label}</span>
              </div>
              <div className="cells-grid">
                {unitRows.map(({ u, s, hasSnag, matches }) => {
                  let bg = "var(--bg-subtle)";
                  if (s.locked) bg = "var(--color-locked)";
                  else if (s.fail) bg = "var(--color-fail)";
                  else if (s.complete) bg = "#64748b";
                  else if (s.done > 0) bg = "var(--color-mep)";
                  // An open snag is a real alert — flag the whole tile, not
                  // just a small dot in the corner, so it's obvious at a
                  // glance even on a locked/not-started (gray) unit.
                  const closedSnags = closedSnagsByUnit.get(u.id) || 0;
                  const tip = `${u.name} · ${u.type || ""} · ${s.done}/${s.total} stages`
                    + (hasSnag ? " · " + s.snags + " open snag(s)" : "")
                    + (closedSnags ? " · " + closedSnags + " resolved snag(s)" : "");
                  const hasResolvedOnly = !hasSnag && closedSnags > 0;
                  return (
                    <div
                      key={u.id}
                      className={"cell" + (s.locked ? " lockedcell" : "") + (s.fail ? " pulse" : "") + (hasSnag ? " has-snag" : "") + (hasResolvedOnly ? " has-resolved-snag" : "")}
                      style={{ background: bg, opacity: hasFilter && !matches ? 0.25 : 1 }}
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
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="legend-bar">
          <div className="legend-item"><div className="legend-box" style={{ background: "#64748b" }}></div> Handed over</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-mep)" }}></div> Trades in progress</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-fail)" }}></div> QC fail / rework</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}></div> Not started</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-locked)" }}></div> Structure not released</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--theme-primary)" }}></div> Open snag</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-pass)" }}></div> Resolved snag</div>
        </div>
      </Card>
    </div>
  );
}
