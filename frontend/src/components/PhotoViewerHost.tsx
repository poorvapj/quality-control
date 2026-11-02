import React, { useCallback, useEffect, useRef, useState } from "react";
import { PHOTO_VIEW_EVENT, type PhotoViewDetail } from "../shared/photoViewer";

/* Mounted once (main.tsx). Shows the photo a component asked for with viewPhoto() in a full-screen overlay.
   - Back button (phone) / browser Back closes it: opening pushes ONE history entry, a popstate closes it, so Back returns to the
     report instead of leaving the app. Closing with the ✕ / Esc / a tap on the dark area removes that entry again.
   - Several photos of the same group: ‹ › buttons, left/right arrow keys, or swipe.
   - It never navigates anywhere, so the app page (and the sign-in) stays exactly as it was. */
const STATE_KEY = "photoViewer";

export default function PhotoViewerHost() {
  const [view, setView] = useState<PhotoViewDetail | null>(null);
  const pushedRef = useRef(false);   // did WE push a history entry that is still on top?
  const touchX = useRef<number | null>(null);

  const open = useCallback((d: PhotoViewDetail) => {
    setView(d);
    if (!pushedRef.current) {
      try { window.history.pushState({ [STATE_KEY]: true }, ""); pushedRef.current = true; } catch { /* history unavailable: still works, Back just leaves */ }
    }
  }, []);

  const close = useCallback(() => {
    setView(null);
    if (pushedRef.current) {
      pushedRef.current = false;
      try { window.history.back(); } catch {}
    }
  }, []);

  useEffect(() => {
    const onView = (e: Event) => open((e as CustomEvent<PhotoViewDetail>).detail);
    const onPop = () => { if (pushedRef.current) { pushedRef.current = false; setView(null); } };   // Back pressed: our entry is already gone
    window.addEventListener(PHOTO_VIEW_EVENT, onView);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener(PHOTO_VIEW_EVENT, onView); window.removeEventListener("popstate", onPop); };
  }, [open]);

  const step = useCallback((delta: number) => {
    setView((v) => (v && v.urls.length > 1 ? { ...v, index: (v.index + delta + v.urls.length) % v.urls.length } : v));
  }, []);

  useEffect(() => {
    if (!view) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener("keydown", onKey, true); };
  }, [view, close, step]);

  if (!view) return null;
  const many = view.urls.length > 1;
  const btn: React.CSSProperties = { position: "absolute", width: 44, height: 44, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 22, lineHeight: "44px", cursor: "pointer" };
  return (
    <div
      role="dialog" aria-modal="true" aria-label="Photo"
      onClick={close}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const start = touchX.current; touchX.current = null;
        if (start == null || !many) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
      }}
      style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: "56px 12px" }}
    >
      <img
        src={view.urls[view.index]} alt={`Photo ${view.index + 1} of ${view.urls.length}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, touchAction: "pinch-zoom" }}
      />
      <button type="button" aria-label="Close photo" onClick={(e) => { e.stopPropagation(); close(); }} style={{ ...btn, top: 10, right: 10 }}>✕</button>
      {many && <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }} style={{ ...btn, left: 10, top: "50%", marginTop: -22 }}>‹</button>}
      {many && <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }} style={{ ...btn, right: 10, top: "50%", marginTop: -22 }}>›</button>}
      {many && <div style={{ position: "absolute", top: 18, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 13, pointerEvents: "none" }}>{view.index + 1} / {view.urls.length}</div>}
    </div>
  );
}
