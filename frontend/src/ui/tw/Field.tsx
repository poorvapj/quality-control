import React from "react";

/* Tailwind-utility version of the plain-CSS ../Field.tsx (kept separate —
   see ui/tw/Card.tsx's header comment). Uppercase muted label, optional
   orange-asterisk required marker, optional hint line below whatever
   input/select is passed as children. */
export default function Field({
  label, required, hint, children
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
        {label}{required && <span className="text-primary"> *</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-[var(--text-sub)]">{hint}</div>}
    </div>
  );
}
