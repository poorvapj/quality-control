import React from "react";
import Badge from "../ui/tw/Badge";
import { DRI_SCORING, SHOW_QUALITY_SCORE, scoreBand, type DriScore, type DriScoreEvent } from "../shared/driQuality";

/* Presentational pieces for the DRI Quality Score, shared by the Quality MIS
   Dashboard (all DRIs) and the DRI's own dashboard (just themselves). All
   numbers come from shared/driQuality.ts — nothing is computed here. */

const BAND_COLOR = { good: "#16a34a", watch: "#f59e0b", poor: "#dc2626" } as const;

export function ScoreBar({ score }: { score: number }) {
  const color = BAND_COLOR[scoreBand(score)];
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-[var(--bg-subtle)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="font-bold tabular-nums" style={{ color }}>{score}</span>
    </div>
  );
}

export function TrendChip({ trend }: { trend: DriScore["trend"] }) {
  if (trend.direction === "flat") {
    return <span className="text-[var(--text-muted)] whitespace-nowrap">— no change</span>;
  }
  const up = trend.direction === "up";
  return (
    <span className="font-semibold whitespace-nowrap" style={{ color: up ? "#16a34a" : "#dc2626" }}>
      {up ? "▲ +" : "▼ −"}{Math.abs(trend.delta)}
      <span className="font-normal text-[var(--text-muted)]"> / {trend.windowDays}d</span>
    </span>
  );
}

/** Running score after each scored inspection, starting from the base 100. */
export function Sparkline({ events }: { events: DriScoreEvent[] }) {
  const w = 96, h = 26, pad = 3;
  const series = [DRI_SCORING.base as number, ...events.map((e) => e.scoreAfter)];
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => pad + ((DRI_SCORING.max - v) * (h - pad * 2)) / (DRI_SCORING.max - DRI_SCORING.min);
  const last = series[series.length - 1];
  const color = BAND_COLOR[scoreBand(last)];
  return (
    <svg width={w} height={h} role="img" aria-label={`Score history: ${series.join(", ")}`}>
      <polyline fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" points={series.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
      <circle cx={x(series.length - 1)} cy={y(last)} r={2.5} fill={color} />
    </svg>
  );
}

const KIND_LABEL = { fail: "Fail", rework: "Rework Required", recovery: "Pass (re-inspection)" } as const;
const KIND_COLOR = { fail: "red", rework: "amber", recovery: "green" } as const;

/** Every scored inspection for one DRI — each row is one real inspection
 *  record, so the total can be audited line by line. */
export function ScoreLedger({ events, showScore = SHOW_QUALITY_SCORE }: { events: DriScoreEvent[]; showScore?: boolean }) {
  const rows = events.slice().reverse(); // newest first
  return (
    <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] sticky top-0 bg-[var(--bg-card)]">
            <th className="py-2 pr-4">Date</th>
            <th className="py-2 pr-4">Project · Floor / Unit</th>
            <th className="py-2 pr-4">Inspection result</th>
            {showScore && <th className="py-2 pr-4 text-right">Marks</th>}
            {showScore && <th className="py-2 pr-4 text-right">Score after</th>}
            <th className="py-2">Record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.inspectionId} className="border-t border-[var(--border)] align-top">
              <td className="py-2 pr-4 whitespace-nowrap">{e.date}</td>
              <td className="py-2 pr-4">
                {e.projectName} · {e.location}
                {e.remarks && e.kind !== "recovery" && <div className="text-[11px] text-[var(--text-muted)] mt-0.5 max-w-[320px] truncate" title={e.remarks}>{e.remarks}</div>}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">
                <Badge color={KIND_COLOR[e.kind] as any}>{KIND_LABEL[e.kind]}</Badge>
                {e.kind === "recovery" && e.streak && e.streak > 1 && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">streak ×{e.streak}</span>}
              </td>
              {showScore && (
                <td className="py-2 pr-4 text-right tabular-nums font-semibold" style={{ color: e.points < 0 ? "#dc2626" : e.points > 0 ? "#16a34a" : undefined }}>
                  {e.points > 0 ? "+" : e.points < 0 ? "−" : ""}{Math.abs(e.points)}
                </td>
              )}
              {showScore && <td className="py-2 pr-4 text-right tabular-nums">{e.scoreAfter}</td>}
              <td className="py-2 text-[var(--text-muted)]">
                <span className="font-mono text-[11px]">{e.inspectionId}</span>
                {e.kind === "recovery"
                  ? <div className="text-[11px]">re-checks {e.recoveryOf}</div>
                  : <div className="text-[11px]">{e.resolved ? "Resolved by re-inspection" : "Still open"}</div>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={showScore ? 6 : 4} className="py-5 text-center text-[var(--text-muted)]">No failed inspections yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ScoringRules({ unattributedPasses }: { unattributedPasses?: number }) {
  const s = DRI_SCORING;
  return (
    <div className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">
      <b className="text-[var(--text-sub)]">How the score works:</b> every DRI starts at {s.base}. Each Fail against them is {s.fail} and each
      Rework Required is {s.rework}. A later Pass that re-inspects one of their own failures earns +{s.recovery}, plus +{s.streakBonusStep} for each
      extra consecutive recovery (up to +{s.streakBonusCap}); a new Fail or Rework resets that streak. Score stays between {s.min} and {s.max}.
      Trend compares today's score with {s.trendWindowDays} days ago. Marks are taken only from the DRI named on each inspection's corrective action
      {unattributedPasses ? ` — ${unattributedPasses} first-time Pass${unattributedPasses === 1 ? "" : "es"} name no DRI, so ${unattributedPasses === 1 ? "it isn't" : "they aren't"} credited to anyone` : ""}.
    </div>
  );
}
