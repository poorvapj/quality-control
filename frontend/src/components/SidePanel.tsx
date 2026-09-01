import React, { useEffect, useRef } from "react";

/** Right-side sliding panel for creation forms — reuses the same
 *  .overlay/.drawer-sheet classes the existing unit/floor/snag Drawer
 *  already uses, just with an icon+title+description header instead of
 *  the Drawer's micro-label+title pairing. */
export default function SidePanel({
  open, icon, title, desc, onClose, children
}: {
  open: boolean; icon: React.ReactNode; title: string; desc: string; onClose: () => void; children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const titleId = "side-panel-title";
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    closeBtnRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="overlay open" onClick={onClose}></div>
      <div className="drawer-sheet open" ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="drawer-header">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
            <div className="page-icon" style={{ width: 38, height: 38, fontSize: 17 }}>{icon}</div>
            <div style={{ minWidth: 0 }}>
              <div id={titleId} style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>
            </div>
          </div>
          <button ref={closeBtnRef} className="btn-icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </>
  );
}
