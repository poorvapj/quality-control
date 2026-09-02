import React, { useEffect, useRef, useState } from "react";
import NavIcon from "./NavIcon";

export interface DropdownOption { value: string; label: string }

/** Custom filter dropdown — button + floating panel with an optional search
 *  box and a checkmark on the selected row. Matches the reference app's
 *  Project/DRI/Date-Range filter style instead of a plain native <select>.
 *  Fully inline-styled (no shared CSS classes) so each usage is
 *  self-contained, same pattern as DropdownMenu.tsx. */
export default function SearchDropdown({
  value, onChange, options, searchable = true, icon, scrollable = true, pill = false, neutralActive = false
}: {
  value: string; onChange: (v: string) => void; options: DropdownOption[]; searchable?: boolean; icon?: string; scrollable?: boolean; pill?: boolean;
  /** Renders the selected row in the normal text color (just the checkmark
   *  stays orange) instead of orange bold text — used by Dashboard's
   *  "Active Project" filter to match its reference styling. */
  neutralActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => { if (!open) setQ(""); }, [open]);

  const current = options.find((o) => o.value === value);
  const filtered = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="select"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", cursor: "pointer",
          ...(pill ? { borderRadius: 999, width: "auto", fontWeight: 600 } : {})
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {icon && <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex" }}><NavIcon name={icon} size={13} /></span>}
          {current?.label ?? "—"}
        </span>
        <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
          <NavIcon name="chevronDown" size={14} />
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: "100%", width: "max-content", maxWidth: 280,
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14)", zIndex: 70, overflow: "hidden"
          }}
        >
          {searchable && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <NavIcon name="search" size={13} />
              <input
                autoFocus
                placeholder="Search..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, border: "none", outline: "none", background: "none", fontSize: 13, color: "var(--text-main)" }}
              />
            </div>
          )}
          <div style={{ maxHeight: scrollable ? 240 : "none", overflowY: scrollable ? "auto" : "visible", padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 14, textAlign: "center", fontSize: 12.5, color: "var(--text-sub)" }}>No matches</div>
            ) : (
              filtered.map((o) => {
                const isActive = o.value === value;
                return (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
                      padding: "9px 12px", border: "none", background: "none", borderRadius: 7, fontSize: 14,
                      fontWeight: isActive ? 700 : 500, color: isActive && !neutralActive ? "var(--theme-primary)" : "var(--text-main)",
                      textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                  >
                    <span>{o.label}</span>
                    {isActive && <span style={{ color: "var(--theme-primary)", display: "flex", flexShrink: 0 }}><NavIcon name="check" size={14} /></span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
