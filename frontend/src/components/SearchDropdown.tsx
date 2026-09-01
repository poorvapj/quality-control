import React, { useEffect, useRef, useState } from "react";
import NavIcon from "./NavIcon";

export interface DropdownOption { value: string; label: string }

/** Custom filter dropdown — button + floating panel with an optional search
 *  box and a checkmark on the selected row. Matches the reference app's
 *  Project/DRI/Date-Range filter style instead of a plain native <select>. */
export default function SearchDropdown({
  value, onChange, options, searchable = true, icon, scrollable = true
}: {
  value: string; onChange: (v: string) => void; options: DropdownOption[]; searchable?: boolean; icon?: string; scrollable?: boolean;
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
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", cursor: "pointer" }}
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
        <div className="dropdown-panel">
          {searchable && (
            <div className="dropdown-search">
              <NavIcon name="search" size={13} />
              <input autoFocus placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className={"dropdown-list" + (scrollable ? "" : " no-scroll")}>
            {filtered.length === 0 ? (
              <div className="dropdown-empty">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  className={"dropdown-row" + (o.value === value ? " active" : "")}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  <span>{o.label}</span>
                  {o.value === value && <NavIcon name="check" size={14} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
