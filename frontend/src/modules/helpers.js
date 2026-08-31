/* ===========================================================================
   Small read helpers over Store.data. Extracted verbatim from app.js.
   =========================================================================== */

import { Store } from "../services/store.js";
import { state } from "../state/appState.js";
import { HOUR } from "../services/config.js";

export const D = () => Store.data;
export const coll = (name) => (Store.data && Store.data[name]) || [];
export const byId = (name, id) => coll(name).find((r) => r.id === id) || null;
export const me = () => byId("users", state.currentUserId);
export const myRole = () => (me() ? me().role : "DRI");

export function nextId(prefix, collName) {
  let max = 0;
  for (const r of coll(collName)) {
    const m = new RegExp("^" + prefix + "-(\\d+)$").exec(r.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + "-" + String(max + 1).padStart(4, "0");
}

export function fmtDT(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
export function ago(ts) {
  if (!ts) return "—";
  const h = (Date.now() - ts) / HOUR;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + "m ago";
  if (h < 48) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}
export function dueLabel(ts) {
  if (!ts) return { text: "No due date", cls: "mute" };
  const h = (ts - Date.now()) / HOUR;
  if (h < 0) return { text: "Overdue by " + Math.round(-h) + "h", cls: "fail" };
  if (h < 12) return { text: "Due in " + Math.round(h) + "h", cls: "gate" };
  return { text: "Due " + fmtDate(ts), cls: "mute" };
}

/* Human label for any referenced record. */
export function refLabel(collName, id) {
  const r = byId(collName, id);
  if (!r) return id || "—";
  if (collName === "stages") return r.name;
  if (collName === "users") return r.name;
  if (collName === "units") return r.name;
  if (collName === "floors") return r.name;
  return r.name || r.code || r.id;
}
