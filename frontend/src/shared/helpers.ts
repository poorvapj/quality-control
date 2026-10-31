import { HOUR } from "../services/config";

export function fmtDT(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
export function ago(ts?: number | null): string {
  if (!ts) return "—";
  const h = (Date.now() - ts) / HOUR;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + "m ago";
  if (h < 48) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}
export function dueLabel(ts?: number | null): { text: string; cls: "mute" | "fail" | "gate" } {
  if (!ts) return { text: "No due date", cls: "mute" };
  const h = (ts - Date.now()) / HOUR;
  if (h < 0) return { text: "Overdue by " + Math.round(-h) + "h", cls: "fail" };
  if (h < 12) return { text: "Due in " + Math.round(h) + "h", cls: "gate" };
  return { text: "Due " + fmtDate(ts), cls: "mute" };
}

export function nextId(prefix: string, rows: { id?: string }[]): string {
  let max = 0;
  for (const r of rows) {
    const m = new RegExp("^" + prefix + "-(\\d+)$").exec(r.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + "-" + String(max + 1).padStart(4, "0");
}

// A placeholder id for a brand-new record — the server (see backend/idSeq.js)
// exchanges this for a real, atomically-issued sequential id (e.g. "SNG-0097")
// before validating or writing anything, so two people creating a record
// around the same moment can never collide (the old failure mode here —
// nextId() above scanning the in-memory collection — is exactly what caused
// real production data loss for DPR) while the id stays short and readable,
// unlike a client-generated timestamp+random one. The EXACT same placeholder
// value used elsewhere in the same apply() batch (e.g. a Quality Inspection's
// linkedSnagId pointing at a Snag created in the same submission) gets
// resolved to that Snag's own real id too — never generate two separate
// placeholders when one record must reference another from the same batch.
export function makeTempId(prefix: string): string {
  return "⁣TEMPID:" + prefix + ":" + Math.random().toString(36).slice(2, 8);
}

// Until a record made with makeTempId() actually reaches the server (it's
// offline-queued, or the request is still in flight), nobody knows its real
// id yet — the server assigns it, not the browser. Wherever an id is shown
// to a person, show this instead of the raw placeholder for that window;
// it swaps to the real "SNG-0097"-style id itself the moment sync finishes
// and fresh server data replaces the optimistic local copy.
export function displayId(id: string | null | undefined): string {
  return id && id.startsWith("⁣TEMPID:") ? "Pending sync" : id || "";
}

// After a successful /api/ops save, the server tells us what each
// makeTempId() placeholder actually turned into ({placeholder: realId} —
// see backend/idSeq.js). Walks the SAME op/rec objects the caller already
// built and swaps any string field that is exactly one of those
// placeholders for its real id, in place — so a caller's own `rec` (still
// referenced in its closure after `await apply(ops)` returns) already shows
// the real id, not the placeholder, by the time it builds a toast or
// returns something to its own caller.
export function resolveIdsInPlace(obj: any, resolvedIds: Record<string, string>): void {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === "string" && Object.prototype.hasOwnProperty.call(resolvedIds, v)) obj[k] = resolvedIds[v];
    else if (v && typeof v === "object") resolveIdsInPlace(v, resolvedIds);
  }
}
