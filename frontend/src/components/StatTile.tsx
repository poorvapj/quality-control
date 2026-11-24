import React from "react";
import Card from "../ui/tw/Card";
import NavIcon from "./NavIcon";

/** One shared KPI tile shape (micro-label, value, optional footnote, optional
 *  icon box) — used by every page's stat-card row (Dashboard, Handover
 *  Checklist, ...) instead of each page hand-rolling its own markup with
 *  its own font-size/weight. Keeps future "match the reference's typography"
 *  fixes to one place instead of finding every page that duplicated it. */
export default function StatTile({
  label, value, foot, icon, iconClassName, valueClassName, onClick
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  icon?: string;
  iconClassName?: string;
  valueClassName?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      padded={false}
      // Smaller padding on a phone-width screen — a stat tile's own content
      // (one number, one short label) never needed the same breathing room
      // a full content card does, and the previous p-4/p-5 made 2-up rows
      // of these take up most of a phone's screen before any real data.
      className={"relative transition-shadow p-2 sm:p-4" + (onClick ? " cursor-pointer" : "")}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0">
          <div className="text-[8.5px] sm:text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-0.5 sm:mb-1 leading-tight">{label}</div>
          <div className={"text-base sm:text-xl font-medium leading-none " + (valueClassName || "text-[var(--text-main)]")}>{value}</div>
          {foot && <div className="text-[9.5px] sm:text-[10.5px] text-[var(--text-sub)] font-semibold mt-1 sm:mt-1.5 leading-snug">{foot}</div>}
        </div>
        {icon && (
          <div className={"w-5 h-5 sm:w-7 sm:h-7 rounded-radius-sm flex items-center justify-center shrink-0 " + (iconClassName || "bg-[var(--bg-subtle)] text-[var(--text-muted)]")}>
            <NavIcon name={icon} size={11} />
          </div>
        )}
      </div>
    </Card>
  );
}
