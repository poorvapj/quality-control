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
      className={"relative transition-shadow" + (onClick ? " cursor-pointer" : "")}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</div>
          <div className={"text-xl font-medium leading-none " + (valueClassName || "text-[var(--text-main)]")}>{value}</div>
          {foot && <div className="text-[10.5px] text-[var(--text-sub)] font-semibold mt-1.5 leading-snug">{foot}</div>}
        </div>
        {icon && (
          <div className={"w-7 h-7 rounded-radius-sm flex items-center justify-center shrink-0 " + (iconClassName || "bg-[var(--bg-subtle)] text-[var(--text-muted)]")}>
            <NavIcon name={icon} size={13} />
          </div>
        )}
      </div>
    </Card>
  );
}
