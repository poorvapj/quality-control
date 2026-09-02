import React, { useState } from "react";
import Sidebar from "../Sidebar/Sidebar";
import Header from "../Header/Header";
import "./MainLayout.css";

const COLLAPSE_KEY = "neoteric_sidebar_collapsed";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });

  // The header's hamburger does double duty: on mobile it opens/closes the
  // overlay drawer, on desktop it collapses/expands the persistent sidebar.
  // Toggling BOTH states on every click (regardless of width) used to flip
  // `collapsed` on mobile too — and Sidebar.tsx hides all its text labels
  // whenever `collapsed` is true, with no viewport check — so the mobile
  // drawer alternated between showing full labels and a broken icon-only
  // layout depending on whether the tap count was even or odd. Only touch
  // the state that's actually relevant at the current width.
  function toggleSidebar() {
    const isMobile = window.matchMedia("(max-width: 960px)").matches;
    if (isMobile) {
      setSidebarOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <div className="app-shell">
      <div className={"sidebar-overlay" + (sidebarOpen ? " open" : "")} onClick={() => setSidebarOpen(false)}></div>
      <Sidebar open={sidebarOpen} collapsed={collapsed} onNavigate={() => setSidebarOpen(false)} />
      <div className="main-area">
        <Header onToggleSidebar={toggleSidebar} />
        <div className="wrap">{children}</div>
      </div>
    </div>
  );
}
