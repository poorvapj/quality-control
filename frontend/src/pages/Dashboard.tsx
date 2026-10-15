import React from "react";
import { useApp } from "../context/AppContext";
import { canActOnStage } from "../shared/permissions";
import { BUILT_IN_ROLES } from "../types";
import OpsDashboard from "./OpsDashboard";
import DriDashboard from "./DriDashboard";
import CrmDashboard from "./CrmDashboard";
import ApprovalDashboard from "./ApprovalDashboard";
import RoleDashboard from "./RoleDashboard";

const STAGE_KEYS = ["canScreenStage1", "canProduceStage2", "canCrosscheckStage3", "canFinalApproveStage4"] as const;

/* Routes to a role-specific dashboard page instead of one shared layout:
   - DRI: their own Drawing Request tickets + open work (DriDashboard)
   - CRM: handover-progress focused (CrmDashboard)
   - ADMIN: the original full ops KPI dashboard (OpsDashboard)
   - CIVIL/SUPERVISOR: their own work first (RoleDashboard)
   - Any custom role (e.g. GM, Architect) with Drawing Request stage
     approval rights and none of the built-in roles' broader access gets
     the review-queue-only ApprovalDashboard instead — approval is their
     whole reason to be in the app.
   - Any other custom role (e.g. Quality/Measurement/Execution — Masters ▸
     Roles) gets RoleDashboard, which shows only the sections its own
     module grants actually unlock (see RoleDashboard.tsx) — never the
     full ops-wide OpsDashboard, which is built-in-role territory. */
export default function Dashboard() {
  const { data, currentUserId, myRole } = useApp();
  const role = myRole();

  if (role === "DRI") return <DriDashboard />;
  if (role === "CRM") return <CrmDashboard />;
  // Owner/Admin keeps the ops-wide KPI dashboard. Civil Engineer and Site
  // Supervisor get their own personal dashboard (same one the engineer
  // roles use), not the Admin one.
  if (role === "ADMIN") return <OpsDashboard />;
  if (role === "CIVIL" || role === "SUPERVISOR") return <RoleDashboard />;

  const isBuiltIn = (BUILT_IN_ROLES as readonly string[]).includes(role);
  const hasAnyStageGrant = STAGE_KEYS.some((k) => canActOnStage(data, currentUserId, role, k));
  if (!isBuiltIn && hasAnyStageGrant) return <ApprovalDashboard />;
  if (!isBuiltIn) return <RoleDashboard />;

  return <OpsDashboard />;
}
