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
import Dashboard from "./pages/Dashboard";
import MyWork from "./pages/MyWork";
import TowerBoard from "./pages/TowerBoard";
import Snags from "./pages/Snags";
import Team from "./pages/Team";
import Masters from "./pages/Masters";
import DailyProgressReport from "./pages/DailyProgressReport";
import DrawingRequests from "./pages/DrawingRequests";

export default function App() {
  const { data, loggedIn, currentProjectId, setCurrentProjectId, me, activeTab } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!loggedIn) return <><LoginScreen /><Toast /></>;

  const projects = coll(data, "projects").filter((p) => p.active !== false);
  const u = me();

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

  return (
    <div className="app-shell">
      <div className={"sidebar-overlay" + (sidebarOpen ? " open" : "")} onClick={() => setSidebarOpen(false)}></div>
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div className="main-area">
        <Header onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <div className="wrap">
          {activeTab === "dash" && (
            <div className="role-bar">
              <div className="role-info" style={{ flex: "0 1 auto", minWidth: 200 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="micro-label">ACTIVE PROJECT</div>
                  <select className="select" style={{ maxWidth: 260 }} value={currentProjectId ?? ""} onChange={(e) => setCurrentProjectId(e.target.value)}>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 300, lineHeight: 1.5 }}>
                {u && ROLES[u.role] ? ROLES[u.role].note : ""}
              </div>
            </div>
          )}

          {pages[activeTab]}
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
