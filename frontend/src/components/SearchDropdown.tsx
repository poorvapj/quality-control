import React, { useEffect, useRef, useState } from "react";
import NavIcon from "./NavIcon";

export interface DropdownOption {
  value: string;
  label: string;
  /** Groups consecutive options under a bold heading row (e.g. "RCC" above
   *  its 13 sub-items) — options without a group render flat, exactly as
   *  before. Heading text is taken from the first option carrying that
   *  group name. */
  group?: string;
  /** Makes the group's heading row itself clickable/selectable, picking
   *  this value (e.g. "whole RCC stage, no specific item") — set this on
   *  every option sharing the group so each one can look up its heading's
   *  value. When the heading's value is the current selection, every
   *  option in that group renders ticked, showing "all of RCC" is covered. */
  groupValue?: string;
  /** Nests this option one more heading level under its group (e.g.
   *  "Brick"/"AC"/"Electric"/"Plastering" under "RCC") — a plain,
   *  non-selectable label, purely organizational. Options without one
   *  render directly under the group, exactly as before. */
  subgroup?: string;
}

/** Custom filter dropdown — button + floating panel with an optional search
 *  box and a checkmark on the selected row. Matches the reference app's
 *  Project/DRI/Date-Range filter style instead of a plain native <select>.
 *  Fully inline-styled (no shared CSS classes) so each usage is
 *  self-contained, same pattern as DropdownMenu.tsx. */
export default function SearchDropdown({
  value, onChange, multi = false, multiValue, onChangeMulti, options, searchable = true, icon, scrollable = true, pill = false, neutralActive = false, disabled = false
}: {
  value?: string; onChange?: (v: string) => void; options: DropdownOption[]; searchable?: boolean; icon?: string; scrollable?: boolean; pill?: boolean;
  /** Turns this into a multi-select checklist: the panel stays open across
   *  picks, every row (including group/subgroup headings, which cascade to
   *  their descendants) toggles in/out of `multiValue` instead of replacing
   *  a single `value`. Ignores `value`/`onChange` when true. */
  multi?: boolean;
  multiValue?: string[];
  onChangeMulti?: (vals: string[]) => void;
  /** Renders the selected row in the normal text color (just the checkmark
   *  stays orange) instead of orange bold text — used by Dashboard's
   *  "Active Project" filter to match its reference styling. */
  neutralActive?: boolean;
  /** For cascading pickers (e.g. Floor before a Project is chosen) — greys
   *  out the button and blocks opening the panel, instead of opening onto
   *  an empty/meaningless option list. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const mv = multiValue || [];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => { if (!open) setQ(""); }, [open]);

  const current = multi
    ? undefined
    : options.find((o) => o.value === value)
      || (() => { const g = options.find((o) => o.groupValue === value); return g ? { value, label: g.group || g.label } : undefined; })();
  const currentLabel = multi
    ? (mv.length === 0 ? "Choose" : mv.length === 1 ? (options.find((o) => o.value === mv[0])?.label ?? "1 selected") : mv.length + " selected")
    : current?.label ?? "—";
  const filtered = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  function toggleMulti(vals: string[]) {
    if (!onChangeMulti) return;
    const allIn = vals.every((v) => mv.includes(v));
    onChangeMulti(allIn ? mv.filter((v) => !vals.includes(v)) : Array.from(new Set([...mv, ...vals])));
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="select"
        disabled={disabled}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          ...(pill ? { borderRadius: 999, width: "auto", fontWeight: 600 } : {})
        }}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {icon && <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex" }}><NavIcon name={icon} size={13} /></span>}
          {currentLabel}
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
              filtered.map((o, i) => {
                // Every option belonging to a group whose heading (or
                // subheading) is fully "covered" reads as active too — not
                // just an exact value match — so picking "whole RCC"/a
                // whole sub-category visually ticks every item under it.
                const groupCovered = !multi && !!o.group && !!o.groupValue && o.groupValue === value;
                const isActive = multi ? mv.includes(o.value) : o.value === value || groupCovered;
                const showHeading = o.group && o.group !== filtered[i - 1]?.group;
                const showSubHeading = o.subgroup && (o.subgroup !== filtered[i - 1]?.subgroup || o.group !== filtered[i - 1]?.group);

                // Descendant values for cascading group/subgroup checkboxes
                // — computed from the FULL option list, not the filtered
                // (search-narrowed) one, so toggling a heading always
                // covers all of its items regardless of an active search.
                const groupValues = o.group ? options.filter((x) => x.group === o.group).map((x) => x.value) : [];
                const subgroupValues = o.subgroup ? options.filter((x) => x.group === o.group && x.subgroup === o.subgroup).map((x) => x.value) : [];
                const groupAllSelected = multi && groupValues.length > 0 && groupValues.every((v) => mv.includes(v));
                const subgroupAllSelected = multi && subgroupValues.length > 0 && subgroupValues.every((v) => mv.includes(v));

                const checkbox = (active: boolean) => (
                  <span
                    style={{
                      width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                      border: "1.5px solid " + (active ? "var(--theme-primary)" : "#64748b"),
                      background: active ? "var(--theme-primary)" : "none",
                      display: "flex", alignItems: "center", justifyContent: "center", color: "#fff"
                    }}
                  >
                    {active && <NavIcon name="check" size={10} />}
                  </span>
                );
                return (
                  <React.Fragment key={o.value}>
                    {showHeading && (
                      <button
                        type="button"
                        onClick={() => {
                          if (multi) { toggleMulti(groupValues); return; }
                          if (o.groupValue) { onChange?.(o.groupValue); setOpen(false); }
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "8px 12px 6px", border: "none", background: "none",
                          cursor: multi || o.groupValue ? "pointer" : "default", textAlign: "left"
                        }}
                      >
                        {checkbox(multi ? groupAllSelected : groupCovered)}
                        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: "var(--text-muted)", textTransform: "uppercase" }}>
                          {o.group}
                        </span>
                      </button>
                    )}
                    {showSubHeading && (
                      <button
                        type="button"
                        onClick={() => { if (multi) toggleMulti(subgroupValues); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "6px 12px 2px 20px", border: "none", background: "none",
                          cursor: multi ? "pointer" : "default", textAlign: "left"
                        }}
                      >
                        {multi && checkbox(subgroupAllSelected)}
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: "var(--text-muted)", textTransform: "uppercase" }}>
                          {o.subgroup}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (multi) { toggleMulti([o.value]); return; }
                        onChange?.(o.value); setOpen(false);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "9px 12px", paddingLeft: o.subgroup ? 32 : o.group ? 20 : 12, border: "none", background: "none", borderRadius: 7, fontSize: 14,
                        fontWeight: isActive ? 700 : 500, color: isActive && !neutralActive ? "var(--theme-primary)" : "var(--text-main)",
                        textAlign: "left", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      {(o.group || multi) && checkbox(isActive)}
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
                      {isActive && !o.group && !multi && <span style={{ color: "var(--theme-primary)", display: "flex", flexShrink: 0 }}><NavIcon name="check" size={14} /></span>}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
