import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NavIcon from "./NavIcon";

export interface DropdownMenuItem {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  // Tooltip explaining why an item is disabled (e.g. "Locked — unlock to edit").
  title?: string;
  onClick: () => void;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  trigger?: React.ReactNode;
}

// Row-action popover menu, rendered via a portal at fixed viewport
// coordinates so it's never clipped by a scrollable ancestor (e.g. a
// table's own .table-scroll overflow-x wrapper).
const MENU_WIDTH = 180;
// The app's sticky floating Header (Header.css: margin-top 14 + height 64)
// occupies roughly this much space at the top of every page — never place
// the menu above this line, so it can't render over/behind the header.
const HEADER_CLEARANCE = 90;

export default function DropdownMenu({ items, trigger }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  // Screen (viewport) coordinates for the portal-rendered menu below — since
  // it renders into document.body (not as a DOM descendant of the trigger),
  // it needs its own fixed position rather than relying on a relative parent.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Recomputes pos from the trigger button's CURRENT on-screen position —
  // shared by the initial open and by the scroll/resize tracking below, so
  // the menu always reflects where the button actually is right now.
  function computePos() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // Estimated menu height (each item row ≈36px + the menu's own vertical
    // padding) — used only to decide whether it should flip upward, since
    // the real height isn't known until after it's rendered.
    const estHeight = items.length * 36 + 8;
    const openUp = window.innerHeight - rect.bottom < estHeight + 12 && rect.top - estHeight - 4 > HEADER_CLEARANCE;
    // Right-aligned to the button (its own right edge = the button's right
    // edge) — this is a row-action trigger, almost always the rightmost
    // thing in its row/column, so right-aligning keeps the menu over the
    // table instead of overhanging further right. Every edge is then
    // clamped to an 8px viewport margin, so it's always fully visible no
    // matter how close to a corner the button itself is.
    return {
      top: Math.min(
        Math.max(HEADER_CLEARANCE, openUp ? rect.top - 8 - estHeight : rect.bottom + 8),
        window.innerHeight - estHeight - 8
      ),
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    };
  }

  // A row-action menu like this routinely sits inside a horizontally
  // scrollable table (.table-scroll's own overflow-x auto — which, per the
  // CSS overflow spec, also makes the vertical axis non-`visible`, so an
  // absolutely-positioned child gets silently clipped the moment the row is
  // anywhere near that container's edge). Rendering into a portal at fixed
  // viewport coordinates sidesteps every ancestor's overflow/clipping,
  // regardless of which table or page this is used from.
  //
  // Since it's portaled out of the trigger's own DOM subtree, it also needs
  // to actively track the trigger's position while open — scrolling the
  // table (or the page) moves the button but wouldn't otherwise move this
  // portal, so it'd visually detach from its own "⋯" the moment you scroll.
  // `capture: true` on the scroll listener picks up scrolling on ANY
  // ancestor, not just window-level scroll.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function reposition() {
      const next = computePos();
      if (next) setPos(next);
      else setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openMenu() {
    setPos(computePos());
    setOpen((o) => !o);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); openMenu(); }}
        style={{
          width: 32, height: 32, borderRadius: 8, border: "none", background: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-sub)", cursor: "pointer", transition: "background .15s ease, color .15s ease"
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; e.currentTarget.style.color = "var(--text-main)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-sub)"; }}
      >
        {trigger ?? <NavIcon name="moreHorizontal" size={16} />}
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH, zIndex: 9999,
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.16)", overflow: "hidden", padding: "4px 0"
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onClick(); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                fontSize: 13, fontWeight: 500, textAlign: "left", border: "none", background: "none",
                cursor: item.disabled ? "not-allowed" : "pointer", opacity: item.disabled ? 0.4 : 1,
                color: item.danger ? "var(--color-fail)" : "var(--text-main)"
              }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = item.danger ? "rgba(239,68,68,0.08)" : "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              {item.icon && <NavIcon name={item.icon} size={14} />}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
