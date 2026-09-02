import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, projectFloors, floorUnits, trackStages, prog, floorReleased, floorBelow, unitSummary } from "../shared/rules";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";

export default function TowerBoard() {
  const { data, currentProjectId, setCurrentProjectId, openDrawer } = useApp();
  const allProjects = coll(data, "projects").filter((p) => p.active !== false);
  // The filter itself starts unset ("Choose") rather than showing whatever
  // project happens to be globally selected — but the board below still
  // shows real data from the start (currentProjectId), exactly like
  // before; only the dropdown's own label defaults to "Choose" until
  // someone actively picks from it.
  const [viewProjectId, setViewProjectId] = useState("");
  const boardProjectId = viewProjectId || currentProjectId;
  const floors = projectFloors(data, boardProjectId);
  const fstages = trackStages(data, boardProjectId, "floor");
  // Resolved (closed) snags per unit — a lighter, corner-dot indicator since
  // unlike an open snag it isn't an active alert, just history worth seeing.
  const closedSnagsByUnit = new Map<string, number>();
  for (const sn of coll(data, "snags")) {
    if (sn.status !== "Closed" || !sn.unitId) continue;
    closedSnagsByUnit.set(sn.unitId, (closedSnagsByUnit.get(sn.unitId) || 0) + 1);
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-icon"><NavIcon name="board" size={20} /></div>
          <div>
            <div className="page-title">Tower Quality Matrix</div>
            <div className="page-desc">Tap a unit for its trade timeline · tap the floor label for the RCC structure track.</div>
          </div>
        </div>
      </div>
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Project</label>
          <SearchDropdown
            value={viewProjectId}
            onChange={(v) => { setViewProjectId(v); setCurrentProjectId(v); }}
            options={[{ value: "", label: "Choose" }, ...allProjects.map((p) => ({ value: p.id, label: p.name }))]}
            neutralActive
          />
        </div>
      </div>
      <div className="card card-pad">
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
                {floorUnits(data, boardProjectId, f.id).map((u) => {
                  const s = unitSummary(data, boardProjectId, u.id);
                  let bg = "var(--bg-subtle)";
                  if (s.locked) bg = "var(--color-locked)";
                  else if (s.fail) bg = "var(--color-fail)";
                  else if (s.complete) bg = "#64748b";
                  else if (s.done > 0) bg = "var(--color-mep)";
                  // An open snag is a real alert — flag the whole tile, not
                  // just a small dot in the corner, so it's obvious at a
                  // glance even on a locked/not-started (gray) unit.
                  const hasSnag = s.snags > 0;
                  const closedSnags = closedSnagsByUnit.get(u.id) || 0;
                  const tip = `${u.name} · ${u.type || ""} · ${s.done}/${s.total} stages`
                    + (hasSnag ? " · " + s.snags + " open snag(s)" : "")
                    + (closedSnags ? " · " + closedSnags + " resolved snag(s)" : "");
                  const hasResolvedOnly = !hasSnag && closedSnags > 0;
                  return (
                    <div
                      key={u.id}
                      className={"cell" + (s.locked ? " lockedcell" : "") + (s.fail ? " pulse" : "") + (hasSnag ? " has-snag" : "") + (hasResolvedOnly ? " has-resolved-snag" : "")}
                      style={{ background: bg }}
                      title={tip}
                      onClick={() => { if (!s.locked) openDrawer({ kind: "unit", id: u.id }); }}
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
      </div>
    </div>
  );
}
