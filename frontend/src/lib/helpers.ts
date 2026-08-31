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
