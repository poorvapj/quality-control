/* ===========================================================================
   Dashboard page. Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc } from "../state/appState.js";
import { SEVERITIES } from "../services/config.js";
import { coll, me } from "../modules/helpers.js";
import { projectUnits, projectFloors, floorUnits, unitSummary, slowHandoffs, floorReleased, myAssignments, mySnags } from "../modules/rules.js";
import { refLabel } from "../modules/helpers.js";
import { assignRow, snagRow } from "../components/rows.js";

export function renderDashboard() {
  const units = projectUnits();
  const summaries = units.map((u) => unitSummary(u.id));
  const handed = summaries.filter((s) => s.complete).length;
  const stagesTotal = summaries.reduce((a, s) => a + s.total, 0) || 1;
  const stagesDone = summaries.reduce((a, s) => a + s.done, 0);
  const pct = Math.round((stagesDone / stagesTotal) * 100);
  const openSnags = coll("snags").filter((s) => s.status !== "Closed" && s.projectId === state.currentProjectId);
  const critical = openSnags.filter((s) => s.severity === "Critical").length;
  const slow = slowHandoffs();
  const castFloors = projectFloors().filter((f) => floorReleased(f.id)).length;

  const stats = [
    { label: "UNITS HANDED OVER", val: handed + "/" + units.length, ok: true, icon: "🏆", foot: pct + "% of all stages complete" },
    { label: "OPEN SNAGS", val: openSnags.length, bad: openSnags.length > 0, icon: "🐞", foot: critical + " critical" },
    { label: "SLOW HANDOFFS", val: slow.length, warn: slow.length > 0, icon: "⏳", foot: "Released past SLA, not acknowledged" },
    { label: "FLOORS CURED", val: castFloors + "/" + projectFloors().length, icon: "🏢", foot: "Bottom-up casting enforced" }
  ];

  $("statsGrid").innerHTML = stats.map((s) => `
    <div class="stat-card ${s.bad ? "bad" : s.warn ? "warn" : s.ok ? "ok" : ""}">
      <div class="micro-label">${s.label}</div>
      <div class="stat-val">${s.val}</div>
      <div class="stat-foot">${esc(s.foot || "")}</div>
      <div class="stat-icon">${s.icon}</div>
    </div>`).join("");

  const myOpen = myAssignments(state.currentUserId).length + mySnags(state.currentUserId).length;

  let html = `
    <div class="section-header">
      <div class="section-title">📌 WHAT NEEDS ME</div>
      <div class="section-sub">${myOpen} open item${myOpen === 1 ? "" : "s"} for ${esc(me() ? me().name : "")}</div>
    </div>
    <div class="card">${
      myOpen === 0
        ? `<div class="empty">🎉 Nothing assigned to you right now.</div>`
        : myAssignments(state.currentUserId).slice(0, 4).map(assignRow).join("") + mySnags(state.currentUserId).slice(0, 4).map(snagRow).join("")
    }</div>`;

  if (slow.length) {
    html += `
      <div class="section-header">
        <div class="section-title">⏳ SLOW HANDOFFS</div>
        <div class="section-sub">Released to a trade but never acknowledged — these are the huddle agenda</div>
      </div>
      <div class="card">${slow.slice(0, 6).map((s) => {
        const name = s.targetType === "unit" ? refLabel("units", s.targetId) : refLabel("floors", s.targetId);
        return `<div class="qitem warn" onclick="openDrawer('${s.targetType}:${s.targetId}')">
          <div class="qitem-main">
            <div class="qitem-title">${esc(name)} · ${esc(s.stage.name)}</div>
            <div class="qitem-sub">Waiting ${Math.round(s.hrs)}h · SLA ${s.sla}h · owner role ${esc(s.stage.role)}</div>
          </div>
          <span class="badge-tag gate">${Math.round(s.hrs - s.sla)}h OVER</span>
        </div>`;
      }).join("")}</div>`;
  }

  const bySeverity = SEVERITIES.map((sev) => ({ sev, n: openSnags.filter((s) => s.severity === sev).length }));
  html += `
    <div class="section-header"><div class="section-title">📈 FLOOR PROGRESS</div></div>
    <div class="card card-pad">
      ${projectFloors().slice().reverse().map((f) => {
        const us = floorUnits(f.id);
        const s = us.map((u) => unitSummary(u.id));
        const d = s.reduce((a, x) => a + x.done, 0);
        const t = s.reduce((a, x) => a + x.total, 0) || 1;
        const p = Math.round((d / t) * 100);
        return `<div style="margin-bottom:11px;">
          <div style="display:flex; justify-content:space-between; font-size:11.5px; font-weight:700;">
            <span>${esc(f.name)} <span style="color:var(--text-sub); font-weight:600;">· ${us.length} units${floorReleased(f.id) ? "" : " · structure in progress"}</span></span>
            <span style="color:var(--text-muted);">${p}%</span>
          </div>
          <div class="workload-bar"><div class="workload-fill" style="width:${p}%; background:${p === 100 ? "var(--color-pass)" : "var(--theme-primary)"};"></div></div>
        </div>`;
      }).join("")}
      <div class="legend-bar" style="margin-top:6px;">
        ${bySeverity.map((b) => `<div class="legend-item"><span class="badge-tag ${b.sev === "Critical" ? "crit" : b.sev === "Major" ? "gate" : "mute"}">${b.n} ${b.sev}</span></div>`).join("")}
      </div>
    </div>`;

  $("dashPanels").innerHTML = html;
}
