import React from "react";

export type BadgeColor = "gray" | "blue" | "green" | "red" | "amber";

const COLOR_CLS: Record<BadgeColor, string> = {
  gray: "bg-[var(--bg-subtle)] text-[var(--text-muted)]",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  green: "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
};

/* Tailwind-utility version of the plain-CSS ../Badge.tsx (kept separate —
   see ui/tw/Card.tsx's header comment). Only the 4 semantic colors
   literally needed by the Dashboard pilot conversion so far, plus a
   neutral gray — extend as real needs come up. */
export default function Badge({ color = "gray", children }: { color?: BadgeColor; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${COLOR_CLS[color]}`}>
      {children}
    </span>
  );
}
