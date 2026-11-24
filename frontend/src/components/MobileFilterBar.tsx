import React, { useState } from "react";
import NavIcon from "./NavIcon";

/* On a narrow screen, a page with several filter dropdowns (Date Range,
 * Project, Floor, Result, DRI, Snag Status, Approval, ...) used to render
 * every one of them stacked, full-width — a lot of scrolling before any
 * actual data. This collapses that whole row into two compact icon buttons
 * (search + filter), matching a reference design: the filter icon opens a
 * full-screen modal holding the SAME filter controls the page already had
 * (passed in as `children`, completely unchanged) instead of showing them
 * inline. Desktop is untouched — this entire component only ever renders
 * on a narrow viewport (the trigger row is `md:hidden`), so nothing changes
 * above the mobile breakpoint.
 *
 * Deliberately does NOT own any filter state itself — it just repositions
 * the exact same controls a page already built, so each page's own filter
 * logic/handlers/options are completely unaffected by using this. */
export default function MobileFilterBar({
  children,
  activeCount,
  search,
  trailing,
  hideTrigger,
  open: controlledOpen,
  onOpenChange
}: {
  /** The page's own filter controls (dropdowns, pickers, etc.) — rendered
   *  unchanged inside the modal body. */
  children: React.ReactNode;
  /** How many filters are currently non-default — shown as a small badge
   *  on the filter icon so it's obvious something's filtered even with the
   *  panel closed. Omit (or 0) for no badge. */
  activeCount?: number;
  /** Optional compact search box shown as its own icon that expands inline
   *  (the reference design's magnifying-glass icon) — omit entirely for a
   *  page with no free-text search. */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** Optional extra content (e.g. a page's primary action button) pushed to
   *  the far end of the trigger row, so it sits on the same line as the
   *  search/filter icons instead of wrapping to its own row on mobile. */
  trailing?: React.ReactNode;
  /** Skip rendering the built-in trigger row entirely — for a page that
   *  places its own filter-icon button elsewhere (e.g. beside a header
   *  action button) and drives the modal via `open`/`onOpenChange` instead. */
  hideTrigger?: boolean;
  /** Controlled open state for the modal — pairs with `hideTrigger` so a
   *  page's own button can open/close it. Omit for the default
   *  uncontrolled behavior (the built-in trigger manages its own state). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : openState;
  const setOpen = onOpenChange || setOpenState;
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      {!hideTrigger && (
        <div className="flex md:hidden items-center gap-2 mb-3">
          {search && (
            searchOpen ? (
              <input
                autoFocus
                className="input flex-1"
                placeholder={search.placeholder || "Search..."}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                onBlur={() => { if (!search.value) setSearchOpen(false); }}
              />
            ) : (
              <button type="button" className="btn-icon" onClick={() => setSearchOpen(true)} aria-label="Search">
                <NavIcon name="search" size={16} />
              </button>
            )
          )}
          <button type="button" className="btn-icon relative" onClick={() => setOpen(true)} aria-label="Filters">
            <NavIcon name="filter" size={16} />
            {!!activeCount && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center"
              >
                {activeCount}
              </span>
            )}
          </button>
          {trailing && <div className="ml-auto flex items-center" style={{ height: 38 }}>{trailing}</div>}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--bg-card)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="font-bold text-[15px]">Filters</div>
            <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
              <NavIcon name="close" size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
            {children}
          </div>
          <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
            <button type="button" className="btn btn-primary btn-sm w-full justify-center" onClick={() => setOpen(false)}>
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
}
