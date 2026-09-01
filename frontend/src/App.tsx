import React, { useState } from "react";
import { useApp } from "./context/AppContext";
import { ROLES } from "./services/config";
import { coll } from "./lib/rules";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import LoginScreen from "./components/LoginScreen";
import Toast from "./components/Toast";
import Drawer from "./components/Drawer";
import AssignModal from "./components/AssignModal";
import SnagModal from "./components/SnagModal";
import ChecklistModal from "./components/ChecklistModal";
import RecordModal from "./components/RecordModal";
import SearchDropdown from "./components/SearchDropdown";
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
  const { data, loggedIn, currentProjectId, setCurrentProjectId, me, activeTab } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  // Dashboard-only "All Projects" view. Deliberately NOT stored on
  // currentProjectId — that value is shared by Tower Board/My Work/Snags,
  // none of which have an "all projects" mode, so it must always stay a
  // real single project id for them regardless of what Dashboard is showing.
  const [viewAllProjects, setViewAllProjects] = useState(true);
  const ALL_PROJECTS_VALUE = "__all__";

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

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const u = me();
  const isAdmin = u?.id === "U-ADMIN";

  const pages: Record<string, React.ReactNode> = {
    dash: <Dashboard viewAllProjects={viewAllProjects} />,
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
          {activeTab === "dash" && (
            <div className="role-bar">
              <div className="role-info" style={{ flex: "0 1 auto", minWidth: 200 }}>
                <div style={{ minWidth: 0, maxWidth: 260 }}>
                  <div className="micro-label">ACTIVE PROJECT</div>
                  <SearchDropdown
                    value={viewAllProjects ? ALL_PROJECTS_VALUE : (currentProjectId ?? "")}
                    onChange={(v) => {
                      if (v === ALL_PROJECTS_VALUE) { setViewAllProjects(true); return; }
                      setViewAllProjects(false);
                      setCurrentProjectId(v);
                    }}
                    options={[{ value: ALL_PROJECTS_VALUE, label: "All Projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 300, lineHeight: 1.5 }}>
                {u && ROLES[u.role] ? ROLES[u.role].note : ""}
              </div>
            </div>
          )}

          {restrictedTab ? <Dashboard viewAllProjects={viewAllProjects} /> : pages[activeTab]}
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
