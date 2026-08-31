/* ===========================================================================
   Team workload page. Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc } from "../state/appState.js";
import { ROLES } from "../services/config.js";
import { coll } from "../modules/helpers.js";

export function renderTeam() {
  const users = coll("users").filter((u) => u.active !== false);
  const rows = users.map((u) => {
    const a = coll("assignments").filter((x) => x.assignedTo === u.id && x.status !== "Done" && x.projectId === state.currentProjectId);
    const s = coll("snags").filter((x) => x.assignedTo === u.id && x.status !== "Closed" && x.projectId === state.currentProjectId);
    const overdue = a.filter((x) => x.dueAt && x.dueAt < Date.now()).length + s.filter((x) => x.dueAt && x.dueAt < Date.now()).length;
    return { u, a: a.length, s: s.length, overdue, load: a.length + s.length };
  }).sort((x, y) => y.load - x.load);

  const max = Math.max(1, ...rows.map((r) => r.load));

  $("teamPanels").innerHTML = `
    <div class="card">${rows.map((r) => `
      <div class="qitem ${r.overdue ? "warn" : ""}" onclick="openDrawer('user:${r.u.id}')">
        <div class="qitem-main">
          <div class="qitem-title">${esc(r.u.name)} <span style="color:var(--text-sub); font-weight:600;">· ${esc(ROLES[r.u.role] ? ROLES[r.u.role].name : r.u.role)}</span></div>
          <div class="qitem-sub">${esc(r.u.company || "")}${r.u.phone ? " · " + esc(r.u.phone) : ""}</div>
          <div class="workload-bar" style="max-width:260px;"><div class="workload-fill" style="width:${(r.load / max) * 100}%; background:${r.overdue ? "var(--color-fail)" : "var(--theme-primary)"};"></div></div>
        </div>
        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
          <span class="badge-tag mute">${r.a} work</span>
          <span class="badge-tag ${r.s ? "fail" : "mute"}">${r.s} snags</span>
          ${r.overdue ? `<span class="badge-tag gate">${r.overdue} overdue</span>` : ""}
        </div>
      </div>`).join("")}</div>`;
}
