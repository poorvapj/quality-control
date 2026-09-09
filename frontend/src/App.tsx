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
import HandoverChecklist from "./pages/HandoverChecklist";
import Snags from "./pages/Snags";
import Team from "./pages/Team";
import Masters from "./pages/Masters";
import DailyProgressReport from "./pages/DailyProgressReport";
import DrawingRequests from "./pages/DrawingRequests";
import Backups from "./pages/Backups";
import AuditLog from "./pages/AuditLog";
import PermissionMatrix from "./pages/PermissionMatrix";
import AddUser from "./pages/AddUser";
import { hasModuleGrant } from "./shared/permissionMatrix";
import { coll } from "./shared/rules";

export default function App() {
  const { loggedIn, currentUserId, activeTab, data } = useApp();

  if (!loggedIn) return <><LoginScreen /><Toast /></>;

  const isAdmin = currentUserId === "U-ADMIN";

  const pages: Record<string, React.ReactNode> = {
    dash: <Dashboard />,
    work: <MyWork />,
    board: <TowerBoard />,
    handoverChecklist: <HandoverChecklist />,
    handoverInternal: <HandoverChecklist initialTab="internal" />,
    handoverOwner: <HandoverChecklist initialTab="owner" />,
    snags: <Snags />,
    team: <Team />,
    masters: <Masters />,
    addUser: <AddUser />,
    dpr: <DailyProgressReport />,
    drawingRequests: <DrawingRequests />,
    backups: <Backups />,
    auditLog: <AuditLog />,
    permissionMatrix: <PermissionMatrix />
  };

  // Team, Masters, Backups, and Audit Log are admin-only by default — a
  // stale activeTab (e.g. from before this restriction existed, or a DRI
  // who had Masters open when it got locked down) should fall back to
  // Dashboard, not just hide the nav link while still rendering the page
  // underneath. Permission Matrix additively grants "view" on these same
  // 4 tabs (Sidebar.tsx hides/shows the link the same way) — Permission
  // Matrix itself stays admin-only, since granting it would let a
  // non-admin grant themselves further access.
  const isTeamLeader = coll(data, "teams").some((t) => t.leaderId === currentUserId);
  const restrictedTab =
    ((activeTab === "team" && !hasModuleGrant(data, currentUserId, "team", "view") && !isTeamLeader) ||
      (activeTab === "masters" && !hasModuleGrant(data, currentUserId, "masters", "view")) ||
      (activeTab === "backups" && !hasModuleGrant(data, currentUserId, "backups", "view")) ||
      (activeTab === "auditLog" && !hasModuleGrant(data, currentUserId, "auditLog", "view")) ||
      // addUser needs the same "can actually edit Masters" grant Masters.tsx
      // itself gates its "+ New" button on — matching masters/view here
      // would let a read-only-granted user reach a create screen they
      // can't otherwise act from.
      (activeTab === "addUser" && !hasModuleGrant(data, currentUserId, "masters", "edit")) ||
      activeTab === "permissionMatrix") &&
    !isAdmin;

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
