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
import MISDashboard from "./pages/MISDashboard";
import Measurement from "./pages/Measurement";
import ExecutionReconciliation from "./pages/ExecutionReconciliation";
import QualityInspection from "./pages/QualityInspection";
import FailRegister from "./pages/FailRegister";
import CaseStudies from "./pages/CaseStudies";
import UnitExecutionWorkflow from "./pages/UnitExecutionWorkflow";
import ProgressAnalysis from "./pages/ProgressAnalysis";
import PurchaseOrders from "./pages/PurchaseOrders";
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
import { canAccessTab } from "./shared/permissionMatrix";
import { coll } from "./shared/rules";

export default function App() {
  const { loggedIn, currentUserId, activeTab, data, myRole } = useApp();

  if (!loggedIn) return <><LoginScreen /><Toast /></>;

  const isAdmin = currentUserId === "U-ADMIN";

  const pages: Record<string, React.ReactNode> = {
    dash: <Dashboard />,
    misDashboard: <MISDashboard />,
    executionReconciliation: <ExecutionReconciliation />,
    qualityInspection: <QualityInspection />,
    qualityFails: <FailRegister />,
    caseStudies: <CaseStudies />,
    unitExecutionWorkflow: <UnitExecutionWorkflow />,
    measurement: <Measurement />,
    progressAnalysis: <ProgressAnalysis />,
    purchaseOrders: <PurchaseOrders />,
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

  // Every page is controlled by the Permission Matrix (see TAB_ACCESS in
  // shared/permissionMatrix.ts — the sidebar asks the very same question). A
  // stale activeTab, a bookmark or a dashboard tile pointing at a page the
  // person can't open falls back to the Dashboard (or a plain notice if the
  // Dashboard is switched off for them too) instead of rendering it.
  const restrictedTab = !canAccessTab(data, currentUserId, activeTab);
  const canDashboard = canAccessTab(data, currentUserId, "dash");

  return (
    <MainLayout>
      {restrictedTab
        ? (canDashboard ? <Dashboard /> : (
            <div className="card card-pad" style={{ margin: 24, textAlign: "center", color: "var(--text-muted)" }}>
              You don't have access to this page. Ask an admin to turn it on in the Permission Matrix.
            </div>
          ))
        : pages[activeTab]}

      <Drawer />
      <AssignModal />
      <SnagModal />
      <ChecklistModal />
      <RecordModal />
      <Toast />
    </MainLayout>
  );
}
