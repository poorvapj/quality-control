import React from "react";

/* Shared table shell for the app's newer Tailwind-built pages — light
   muted-uppercase header, thin horizontal row separators (no vertical
   borders), compact padding, internal horizontal scroll only (the
   .overflow-x-auto wrapper), so the page itself never scrolls sideways.
   Extracted from HandoverChecklist.tsx's original hand-rolled table so
   later page conversions reuse the same markup instead of retyping it. */
export default function Table({
  columns, children, empty = "No records found."
}: {
  columns: string[];
  children: React.ReactNode;
  empty?: string;
}) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {columns.map((c) => <th key={c} className="pb-2.5 pr-4 last:pr-0">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {hasRows ? children : (
            <tr><td colSpan={columns.length} className="py-6 text-center text-[var(--text-muted)]">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function TableRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-[var(--border)]">{children}</tr>;
}

export function TableCell({
  children, strong, muted, className = ""
}: {
  children: React.ReactNode; strong?: boolean; muted?: boolean; className?: string;
}) {
  const tone = strong ? "font-bold" : muted ? "text-[var(--text-muted)]" : "";
  return <td className={`py-2.5 pr-4 last:pr-0 ${tone} ${className}`.trim()}>{children}</td>;
}
