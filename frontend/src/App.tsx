import React, { useState } from "react";
import { useApp } from "./context/AppContext";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import LoginScreen from "./components/LoginScreen";
import Toast from "./components/Toast";
import Drawer from "./components/Drawer";
import AssignModal from "./components/AssignModal";
import SnagModal from "./components/SnagModal";
import ChecklistModal from "./components/ChecklistModal";
import RecordModal from "./components/RecordModal";
import Dashboard from "./pages/Dashboard";
import MyWork from "./pages/MyWork";
import TowerBoard from "./pages/TowerBoard";
import Snags from "./pages/Snags";
import Team from "./pages/Team";
import Masters from "./pages/Masters";
import DailyProgressReport from "./pages/DailyProgressReport";
import DrawingRequests from "./pages/DrawingRequests";

const COLLAPSE_KEY = "neoteric_sidebar_collapsed";

export default function App() {
  const { loggedIn, currentUserId, activeTab } = useApp();
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

  if (!loggedIn) return <><LoginScreen /><Toast /></>;

  const isAdmin = currentUserId === "U-ADMIN";

  const pages: Record<string, React.ReactNode> = {
    dash: <Dashboard />,
    work: <MyWork />,
    board: <TowerBoard />,
    snags: <Snags />,
    team: <Team />,
    masters: <Masters />,
    dpr: <DailyProgressReport />,
    drawingRequests: <DrawingRequests />
  };

  // Team is admin-only — a stale activeTab (e.g. from before this
  // restriction existed) should fall back to Dashboard, not just hide the
  // nav link while still rendering the page underneath. Masters is open to
  // everyone now, so it's excluded from this check.
  const restrictedTab = activeTab === "team" && !isAdmin;

  return (
    <div className="app-shell">
      <div className={"sidebar-overlay" + (sidebarOpen ? " open" : "")} onClick={() => setSidebarOpen(false)}></div>
      <Sidebar open={sidebarOpen} collapsed={collapsed} onNavigate={() => setSidebarOpen(false)} />
      <div className="main-area">
        <Header onToggleSidebar={toggleSidebar} />
        <div className="wrap">
          {restrictedTab ? <Dashboard /> : pages[activeTab]}
        </div>
      </div>

      <Drawer />
      <AssignModal />
      <SnagModal />
      <ChecklistModal />
      <RecordModal />
      <Toast />
    </div>
  );
}
