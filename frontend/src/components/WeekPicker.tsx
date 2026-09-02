import React from "react";
import { isoWeekBounds } from "../shared/dateRange";

function fmtRange(from: string, to: string) {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${f.toLocaleDateString("en-US", opts)} - ${t.toLocaleDateString("en-US", opts)}`;
}

/** Floating "Week NN, YYYY" picker — a year header (prev/next arrows) over a
 *  scrollable 2-column grid of ISO weeks, each showing its Monday–Sunday
 *  range, and a "Back" row to return to the parent date-range dropdown.
 *  Matches the reference app's Week Number filter panel. */
export default function WeekPicker({
  year, week, onPickWeek, onYearChange, onBack
}: {
  year: number;
  week: number;
  onPickWeek: (week: number) => void;
  onYearChange: (year: number) => void;
  onBack: () => void;
}) {
  const weeks = Array.from({ length: 53 }, (_, i) => 53 - i); // 53 .. 1

  return (
    <div
      style={{
        position: "absolute", top: "calc(100% + 6px)", left: 0, width: 280,
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14)", zIndex: 70, overflow: "hidden"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => onYearChange(year - 1)} title="Previous year">‹</button>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--text-main)" }}>Week {year}</div>
        <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => onYearChange(year + 1)} title="Next year">›</button>
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto", padding: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {weeks.map((w) => {
            const { from, to } = isoWeekBounds(year, w);
            const active = w === week;
            return (
              <button
                type="button"
                key={w}
                onClick={() => onPickWeek(w)}
                style={{
                  textAlign: "left", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                  border: "1px solid " + (active ? "var(--theme-primary)" : "var(--border)"),
                  background: active ? "color-mix(in srgb, var(--theme-primary) 10%, transparent)" : "none"
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: active ? "var(--theme-primary)" : "var(--text-main)" }}>Wk {w}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{fmtRange(from, to)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onBack}
        style={{
          width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderTop: "1px solid var(--border)",
          background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--text-sub)"
        }}
      >
        ← Back
      </button>
    </div>
  );
}
