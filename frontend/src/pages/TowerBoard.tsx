import React from "react";
import { useApp } from "../context/AppContext";
import { projectFloors, floorUnits, trackStages, prog, floorReleased, floorBelow, unitSummary } from "../lib/rules";
import NavIcon from "../components/NavIcon";

export default function TowerBoard() {
  const { data, currentProjectId, openDrawer } = useApp();
  const floors = projectFloors(data, currentProjectId);
  const fstages = trackStages(data, currentProjectId, "floor");

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
      <div className="card card-pad">
        {floors.length === 0 && <div className="empty">No floors yet — add them in Masters ▸ Floor.</div>}
        {floors.slice().reverse().map((f) => {
          let fdone = 0, ffail = false;
          for (const x of fstages) {
            const p = prog(data, f.id, x.stage.id);
            if (p.status === "done") fdone++;
            if (p.status === "fail") ffail = true;
          }
          const cured = floorReleased(data, currentProjectId, f.id);
          const below = floorBelow(data, currentProjectId, f.id);
          const canCast = !below || floorReleased(data, currentProjectId, below.id);
          const label = cured ? "CURED ✓" : !canCast ? "LOCKED" : fdone > 0 ? `RCC ${fdone}/${fstages.length}` : "NOT STARTED";

          return (
            <div className="floor-row" key={f.id}>
              <div
                className="floor-label"
                style={ffail ? { borderColor: "var(--color-fail)", color: "var(--color-fail)" } : undefined}
                onClick={() => openDrawer({ kind: "floor", id: f.id })}
              >
                {f.code}<br /><span style={{ fontSize: 8, opacity: 0.75 }}>{label}</span>
              </div>
              <div className="cells-grid">
                {floorUnits(data, currentProjectId, f.id).map((u) => {
                  const s = unitSummary(data, currentProjectId, u.id);
                  let bg = "var(--bg-subtle)";
                  if (s.locked) bg = "var(--color-locked)";
                  else if (s.fail) bg = "var(--color-fail)";
                  else if (s.complete) bg = "var(--color-pass)";
                  else if (s.done > 0) bg = "var(--color-mep)";
                  const tip = `${u.name} · ${u.type || ""} · ${s.done}/${s.total} stages${s.snags ? " · " + s.snags + " open snag(s)" : ""}`;
                  return (
                    <div
                      key={u.id}
                      className={"cell" + (s.locked ? " lockedcell" : "") + (s.fail ? " pulse" : "")}
                      style={{ background: bg }}
                      title={tip}
                      onClick={() => { if (!s.locked) openDrawer({ kind: "unit", id: u.id }); }}
                    >
                      {u.seq != null ? u.seq : u.code}
                      {s.snags > 0 && <span className="snag-dot"></span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="legend-bar">
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-pass)" }}></div> Handed over</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-mep)" }}></div> Trades in progress</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-fail)" }}></div> QC fail / rework</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}></div> Not started</div>
          <div className="legend-item"><div className="legend-box" style={{ background: "var(--color-locked)" }}></div> Structure not released</div>
          <div className="legend-item"><span className="snag-dot" style={{ position: "static", display: "inline-block" }}></span> Open snag</div>
        </div>
      </div>
    </div>
  );
}
