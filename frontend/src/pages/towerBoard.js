/* ===========================================================================
   Tower Board page. Extracted verbatim from app.js.
   =========================================================================== */

import { $, esc } from "../state/appState.js";
import { projectFloors, floorUnits, trackStages, prog, floorReleased, floorBelow, unitSummary } from "../modules/rules.js";

export function renderBoard() {
  const floors = projectFloors();
  let html = "";

  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i];
    const fstages = trackStages("floor");
    let fdone = 0, ffail = false;
    for (const x of fstages) {
      const p = prog(f.id, x.stage.id);
      if (p.status === "done") fdone++;
      if (p.status === "fail") ffail = true;
    }
    const cured = floorReleased(f.id);
    const below = floorBelow(f.id);
    const canCast = !below || floorReleased(below.id);
    const label = cured ? "CURED ✓" : !canCast ? "LOCKED" : fdone > 0 ? "RCC " + fdone + "/" + fstages.length : "NOT STARTED";

    html += `<div class="floor-row">
      <div class="floor-label" style="${ffail ? "border-color:var(--color-fail); color:var(--color-fail);" : ""}" onclick="openDrawer('floor:${f.id}')">
        ${esc(f.code)}<br><span style="font-size:8px; opacity:0.75;">${label}</span>
      </div>
      <div class="cells-grid">`;

    for (const u of floorUnits(f.id)) {
      const s = unitSummary(u.id);
      let bg = "var(--bg-subtle)";
      if (s.locked) bg = "var(--color-locked)";
      else if (s.fail) bg = "var(--color-fail)";
      else if (s.complete) bg = "var(--color-pass)";
      else if (s.done > 0) bg = "var(--color-mep)";
      const tip = `${u.name} · ${u.type || ""} · ${s.done}/${s.total} stages${s.snags ? " · " + s.snags + " open snag(s)" : ""}`;
      html += `<div class="cell ${s.locked ? "lockedcell" : ""} ${s.fail ? "pulse" : ""}"
          style="background:${bg}" title="${esc(tip)}"
          onclick="${s.locked ? "" : `openDrawer('unit:${u.id}')`}">
        ${esc(u.seq != null ? u.seq : u.code)}${s.snags ? '<span class="snag-dot"></span>' : ""}
      </div>`;
    }
    html += `</div></div>`;
  }

  $("towerBoard").innerHTML = html || `<div class="empty">No floors yet — add them in Masters ▸ Floor.</div>`;
  $("legendBar").innerHTML = `
    <div class="legend-item"><div class="legend-box" style="background:var(--color-pass);"></div> Handed over</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-mep);"></div> Trades in progress</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-fail);"></div> QC fail / rework</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--bg-subtle); border:1px solid var(--border);"></div> Not started</div>
    <div class="legend-item"><div class="legend-box" style="background:var(--color-locked);"></div> Structure not released</div>
    <div class="legend-item"><span class="snag-dot" style="position:static; display:inline-block;"></span> Open snag</div>`;
}
