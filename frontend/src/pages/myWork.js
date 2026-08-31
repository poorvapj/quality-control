/* ===========================================================================
   My Work page. Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc } from "../state/appState.js";
import { myAssignments, mySnags, myReleases } from "../modules/rules.js";
import { refLabel, ago } from "../modules/helpers.js";
import { assignRow, snagRow } from "../components/rows.js";

export function renderWork() {
  const asg = myAssignments(state.currentUserId);
  const sng = mySnags(state.currentUserId);
  const rel = myReleases(state.currentUserId);
  $("workSubtitle").innerText = `${asg.length} assigned · ${rel.length} released to your role · ${sng.length} snags on you`;

  const relHtml = rel.length ? rel.map((r) => {
    const name = r.targetType === "unit" ? refLabel("units", r.targetId) : refLabel("floors", r.targetId);
    const st = r.p.status;
    const label = st === "fail" ? "REWORK" : st === "wip" ? "IN PROGRESS" : st === "ack" ? "ACKNOWLEDGED" : "NEW RELEASE";
    return `<div class="qitem ${st === "fail" ? "alert" : ""}" onclick="openDrawer('${r.targetType}:${r.targetId}')">
      <div class="qitem-main">
        <div class="qitem-title">${esc(name)} · ${esc(r.stage.name)}</div>
        <div class="qitem-sub">Released ${ago(r.p.rel)}${r.p.note ? " · " + esc(r.p.note) : ""}</div>
      </div>
      <span class="badge-tag ${st === "fail" ? "fail" : st === "wip" ? "wip" : "gate"}">${label}</span>
    </div>`;
  }).join("") : `<div class="empty">No stages released to your role.</div>`;

  $("workPanels").innerHTML = `
    <div class="section-header"><div class="section-title">📌 ASSIGNED TO ME</div></div>
    <div class="card">${asg.length ? asg.map(assignRow).join("") : `<div class="empty">Nothing assigned to you.</div>`}</div>

    <div class="section-header"><div class="section-title">⚡ RELEASED TO MY ROLE</div></div>
    <div class="card">${relHtml}</div>

    <div class="section-header"><div class="section-title">🐞 SNAGS ON ME</div></div>
    <div class="card">${sng.length ? sng.map(snagRow).join("") : `<div class="empty">No open snags assigned to you.</div>`}</div>`;
}
