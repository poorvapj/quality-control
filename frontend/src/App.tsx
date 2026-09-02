import React from "react";
import { useApp } from "./context/AppContext";
import MainLayout from "./layouts/MainLayout/MainLayout";
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
import Backups from "./pages/Backups";

export default function App() {
  const { loggedIn, currentUserId, activeTab } = useApp();

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
    drawingRequests: <DrawingRequests />,
    backups: <Backups />
  };

  // Team and Backups are admin-only — a stale activeTab (e.g. from before
  // this restriction existed) should fall back to Dashboard, not just hide
  // the nav link while still rendering the page underneath. Masters is open
  // to everyone now, so it's excluded from this check.
  const restrictedTab = (activeTab === "team" || activeTab === "backups") && !isAdmin;

  return (
    <MainLayout>
      {restrictedTab ? <Dashboard /> : pages[activeTab]}

      <Drawer />
      <AssignModal />
      <SnagModal />
      <ChecklistModal />
      <RecordModal />
      <Toast />
    </MainLayout>
  );
}
