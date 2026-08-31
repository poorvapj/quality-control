/* ===========================================================================
   Masters page — table, record editor modal, checklist items editor, CSV.
   Extracted verbatim from app.js.
   =========================================================================== */

import { state, $, esc, toast } from "../state/appState.js";
import { Store } from "../services/store.js";
import { MASTERS } from "../services/config.js";
import { coll, byId, nextId, myRole, refLabel } from "../modules/helpers.js";
import { downloadCsv } from "../services/csv.js";
import { showModal, closeModal } from "../main.js";

export function renderMasters() {
  $("masterNav").innerHTML = Object.entries(MASTERS).map(([k, m]) =>
    `<button class="sub-btn ${k === state.activeMaster ? "active" : ""}" onclick="switchMaster('${k}')">${m.icon} ${esc(m.label)} Master</button>`
  ).join("");
  $("masterSubtitle").innerText = MASTERS[state.activeMaster].desc;
  $("dangerZone").innerHTML = myRole() === "DRI" ? `
    <button class="btn btn-secondary btn-sm" onclick="if(confirm('Reload the demo data? This replaces the whole board for everyone.')) Store.reset('demo')">↻ Reload demo data</button>
    <button class="btn btn-secondary btn-sm" onclick="if(confirm('Wipe everything and start from a blank board? This cannot be undone.')) Store.reset('blank')">⌫ Start blank board</button>
    <button class="btn btn-secondary btn-sm" onclick="exportSnagCsv()">⬇ Snag register CSV</button>` : "";
  renderMasterTable();
}

export function switchMaster(k) { state.activeMaster = k; $("masterSearch").value = ""; renderMasters(); }

function masterRows() {
  const m = MASTERS[state.activeMaster];
  let rows = coll(state.activeMaster).slice();
  // Project-scoped masters only show the active project.
  if (m.fields.some((f) => f.k === "projectId")) rows = rows.filter((r) => !r.projectId || r.projectId === state.currentProjectId);
  const q = ($("masterSearch").value || "").toLowerCase();
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  return rows;
}

function cellValue(rec, key) {
  const m = MASTERS[state.activeMaster];
  const field = m.fields.find((f) => f.k === key);
  const v = rec[key];
  if (key === "itemCount") return (rec.items || []).length + " lines";
  if (field && field.type === "ref") return esc(refLabel(field.coll, v));
  if (field && field.type === "bool") return v === false ? `<span class="badge-tag mute">Inactive</span>` : `<span class="badge-tag pass">Active</span>`;
  if (key === "isGate" || key === "isHidden") return v ? `<span class="badge-tag gate">Yes</span>` : `<span class="badge-tag mute">No</span>`;
  if (key === "severity") return `<span class="badge-tag ${v === "Critical" ? "crit" : v === "Major" ? "gate" : "mute"}">${esc(v)}</span>`;
  if (key === "track") return `<span class="badge-tag ${v === "unit" ? "wip" : "mute"}">${v === "unit" ? "Unit" : "Floor"}</span>`;
  if (key === "role") return `<span class="badge-tag mute">${esc(v)}</span>`;
  if (v == null || v === "") return `<span style="color:var(--text-sub);">—</span>`;
  return esc(v);
}

export function renderMasterTable() {
  const m = MASTERS[state.activeMaster];
  const rows = masterRows();
  const editable = myRole() === "DRI";
  $("masterAddBtn").style.display = editable ? "inline-flex" : "none";

  if (!rows.length) {
    $("masterTable").innerHTML = `<div class="empty">No ${esc(m.label.toLowerCase())} records yet.</div>`;
    return;
  }
  const head = m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    return `<th>${esc(f ? f.label : c)}</th>`;
  }).join("") + (editable ? "<th></th>" : "");

  const body = rows.map((r) => `
    <tr>
      ${m.cols.map((c) => `<td>${cellValue(r, c)}</td>`).join("")}
      ${editable ? `<td><div class="row-actions">
        <button class="btn btn-secondary btn-sm" onclick="openRecordModal('${r.id}')" title="Edit">✎</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteRecord('${r.id}')" title="Delete">🗑</button>
      </div></td>` : ""}
    </tr>`).join("");

  $("masterTable").innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/* ======================================================= record editing */

export function openRecordModal(id) {
  const m = MASTERS[state.activeMaster];
  state.editingId = id;
  const rec = id ? byId(state.activeMaster, id) : {};
  $("modalSub").innerText = (id ? "EDIT " : "NEW ") + m.label.toUpperCase() + " RECORD";
  $("modalTitle").innerText = id ? (rec.name || rec.code || id) : "New " + m.label;
  $("modalBox").className = "modal-box" + (m.fields.some((f) => f.type === "items") ? " wide" : "");
  $("modalContent").innerHTML = `<div class="form-grid">${m.fields.map((f) => fieldHtml(f, rec)).join("")}</div>`;
  $("modalFooter").innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveRecord()">${id ? "Save changes" : "Create " + esc(m.label)}</button>`;
  showModal();
}

function fieldHtml(f, rec) {
  const v = rec[f.k];
  const full = f.type === "items" || f.type === "textarea" || f.k === "name" ? " full" : "";
  let inner = "";

  if (f.type === "select") {
    inner = `<select class="select" data-k="${f.k}">
      ${f.required ? "" : `<option value="">—</option>`}
      ${f.options.map((o) => `<option value="${esc(o)}" ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select>`;
  } else if (f.type === "ref") {
    let opts = coll(f.coll).filter((r) => r.active !== false);
    if (f.coll === "floors" || f.coll === "units") opts = opts.filter((r) => r.projectId === state.currentProjectId);
    inner = `<select class="select" data-k="${f.k}">
      <option value="">—</option>
      ${opts.map((o) => `<option value="${o.id}" ${v === o.id ? "selected" : ""}>${esc(refLabel(f.coll, o.id))}</option>`).join("")}
    </select>`;
  } else if (f.type === "bool") {
    return `<div class="field${full}"><div class="check-row">
      <input type="checkbox" id="fld-${f.k}" data-k="${f.k}" ${v !== false ? "checked" : ""}>
      <label for="fld-${f.k}">${esc(f.label)}</label>
    </div></div>`;
  } else if (f.type === "textarea") {
    inner = `<textarea class="textarea" data-k="${f.k}">${esc(v || "")}</textarea>`;
  } else if (f.type === "items") {
    return `<div class="field full">
      <label>${esc(f.label)}</label>
      <div id="itemsEditor">${itemsEditorHtml(rec.items || [])}</div>
      <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="addChecklistItem()">＋ Add line</button>
    </div>`;
  } else {
    const type = f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "color" ? "color" : "text";
    inner = `<input class="input" type="${type}" data-k="${f.k}" value="${esc(v == null ? "" : v)}">`;
  }

  return `<div class="field${full}">
    <label>${esc(f.label)}${f.required ? " *" : ""}</label>
    ${inner}
    ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ""}
  </div>`;
}

function itemsEditorHtml(items) {
  const params = coll("qparams").filter((p) => p.active !== false);
  if (!items.length) return `<div class="empty" style="padding:14px;">No lines yet.</div>`;
  return items.map((it, i) => `
    <div class="check-row" data-item style="gap:8px; align-items:flex-start; border-bottom:1px solid var(--border); padding:9px 0;">
      <span style="font-size:11px; font-weight:800; color:var(--text-sub); width:20px; padding-top:9px;">${i + 1}</span>
      <select class="select" data-item-param style="flex:1;">
        ${params.map((p) => `<option value="${p.id}" ${it.paramId === p.id ? "selected" : ""}>${esc(p.code)} · ${esc(p.name)}</option>`).join("")}
      </select>
      <label style="display:flex; align-items:center; gap:5px; font-size:11px; white-space:nowrap; padding-top:9px;">
        <input type="checkbox" data-item-mand ${it.mandatory !== false ? "checked" : ""}> Mandatory
      </label>
      <label style="display:flex; align-items:center; gap:5px; font-size:11px; white-space:nowrap; padding-top:9px;">
        <input type="checkbox" data-item-ev ${it.evidence ? "checked" : ""}> Photo
      </label>
      <button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="this.closest('[data-item]').remove()">✕</button>
    </div>`).join("");
}

export function addChecklistItem() {
  const cur = readChecklistItems();
  cur.push({ id: "", paramId: (coll("qparams")[0] || {}).id, mandatory: true, evidence: false });
  $("itemsEditor").innerHTML = itemsEditorHtml(cur);
}

function readChecklistItems() {
  const ed = $("itemsEditor");
  if (!ed) return [];
  return Array.from(ed.querySelectorAll("[data-item]")).map((row, i) => ({
    id: (state.editingId || "CHK") + "-I" + String(i + 1).padStart(2, "0"),
    paramId: row.querySelector("[data-item-param]").value,
    mandatory: row.querySelector("[data-item-mand]").checked,
    evidence: row.querySelector("[data-item-ev]").checked
  }));
}

export function saveRecord() {
  const m = MASTERS[state.activeMaster];
  const rec = state.editingId ? Object.assign({}, byId(state.activeMaster, state.editingId)) : { id: nextId(m.prefix, state.activeMaster) };

  for (const f of m.fields) {
    if (f.type === "items") { rec.items = readChecklistItems(); continue; }
    const el = $("modalContent").querySelector(`[data-k="${f.k}"]`);
    if (!el) continue;
    let v = f.type === "bool" ? el.checked : el.value;
    if (f.type === "number") v = v === "" ? null : Number(v);
    if (f.required && (v === "" || v == null)) return toast(f.label + " is required");
    rec[f.k] = v;
  }
  if (!rec.code && rec.id) rec.code = rec.id;
  if (m.fields.some((f) => f.k === "projectId") && !rec.projectId) rec.projectId = state.currentProjectId;

  Store.apply([{ op: "upsert", coll: state.activeMaster, rec }]);
  closeModal();
  toast((state.editingId ? "Updated " : "Created ") + (rec.name || rec.code || rec.id));
}

export function deleteRecord(id) {
  const m = MASTERS[state.activeMaster];
  const rec = byId(state.activeMaster, id);
  if (!confirm(`Delete ${m.label.toLowerCase()} "${rec.name || rec.code || id}"?\n\nThis removes it for everyone on the board.`)) return;
  Store.apply([{ op: "delete", coll: state.activeMaster, id }]);
  toast("Deleted " + id);
}

export function exportMasterCsv() {
  const m = MASTERS[state.activeMaster];
  const rows = masterRows();
  const head = m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    return f ? f.label : c;
  });
  const body = rows.map((r) => m.cols.map((c) => {
    const f = m.fields.find((x) => x.k === c);
    if (c === "itemCount") return (r.items || []).length;
    if (f && f.type === "ref") return refLabel(f.coll, r[c]);
    return r[c];
  }));
  downloadCsv(state.activeMaster + "-master.csv", [head].concat(body));
}
