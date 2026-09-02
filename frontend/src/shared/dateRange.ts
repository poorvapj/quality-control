/* Shared date-range preset logic — originally built for Daily Progress
   Report's filter bar, reused by Dashboard so both pages resolve
   "Today"/"This Week"/"Week Number"/"Custom Range" etc. identically. */

export type DateRange = "all" | "today" | "yesterday" | "thisWeek" | "lastWeek" | "weekNumber" | "thisMonth" | "custom";

export const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This Week" },
  { key: "lastWeek", label: "Last Week" },
  { key: "weekNumber", label: "Week Number" },
  { key: "thisMonth", label: "This Month" },
  { key: "custom", label: "Custom Range" }
];

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday..Sunday bounds for ISO week `week` of `year`. */
export function isoWeekBounds(year: number, week: number): { from: string; to: string } {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const mon = new Date(jan4); mon.setDate(jan4.getDate() - jan4Dow + (week - 1) * 7);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

/** Real [from, to] (inclusive, YYYY-MM-DD) for each preset — Monday-start weeks. */
export function dateRangeBounds(range: DateRange): { from: string; to: string } | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (today.getDay() + 6) % 7; // 0 = Monday

  if (range === "all") return null;
  if (range === "today") return { from: ymd(today), to: ymd(today) };
  if (range === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { from: ymd(y), to: ymd(y) };
  }
  if (range === "thisWeek") {
    const mon = new Date(today); mon.setDate(mon.getDate() - dow);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }
  if (range === "lastWeek") {
    const mon = new Date(today); mon.setDate(mon.getDate() - dow - 7);
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }
  if (range === "thisMonth") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: ymd(first), to: ymd(last) };
  }
  return null; // "custom" and "weekNumber" are handled separately, with their own inputs
}

/** True if an epoch-ms timestamp falls within [from, to] (inclusive, YYYY-MM-DD). Null/undefined timestamps never match a real bound. */
export function tsInBounds(ts: number | null | undefined, bounds: { from: string; to: string } | null): boolean {
  if (!bounds) return true;
  if (ts == null) return false;
  const day = ymd(new Date(ts));
  return day >= bounds.from && day <= bounds.to;
}
