/* ===========================================================================
   Shared mutable UI state + tiny DOM helpers.
   Extracted verbatim from the original app.js so every module reads/writes
   the same values the render functions always relied on.
   =========================================================================== */

export const state = {
  currentUserId: null,
  currentProjectId: null,
  activeTab: "dash",
  activeMaster: "projects",
  openDrawerId: null,   // "unit:UNT-0101" | "floor:FLR-01" | "snag:SNG-0001" | "user:USR-02"
  editingId: null,
  checklistCtx: null
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(msg) {
  const t = $("toast");
  t.innerText = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2600);
}
