import React from "react";

/* Small pill switch — no other bool field in the app used this look before
   (RecordModal.tsx's bool fields are plain checkboxes); extracted out of
   PermissionMatrix.tsx so AddUser.tsx's inline Permission Matrix section can
   share the exact same control instead of a second copy. */
export default function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
        (on ? "bg-primary" : "bg-[var(--bg-subtle)] border border-[var(--border)]")
      }
    >
      <span
        className={
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform " +
          (on ? "translate-x-[18px]" : "translate-x-1")
        }
      />
    </button>
  );
}
