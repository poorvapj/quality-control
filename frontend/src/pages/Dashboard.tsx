import React from "react";
import { useApp } from "../context/AppContext";
import { canActOnStage } from "../shared/permissions";
import { BUILT_IN_ROLES } from "../types";
import OpsDashboard from "./OpsDashboard";
import DriDashboard from "./DriDashboard";
import CrmDashboard from "./CrmDashboard";
import ApprovalDashboard from "./ApprovalDashboard";

const STAGE_KEYS = ["canScreenStage1", "canProduceStage2", "canCrosscheckStage3", "canFinalApproveStage4"] as const;

/* Routes to a role-specific dashboard page instead of one shared layout:
   - DRI: their own Drawing Request tickets + open work (DriDashboard)
   - CRM: handover-progress focused (CrmDashboard)
   - ADMIN/CIVIL/SUPERVISOR: the original full ops KPI dashboard (OpsDashboard)
   - Any custom role (e.g. GM, Architect) with Drawing Request stage
     approval rights and none of the built-in roles' broader access gets
     the review-queue-only ApprovalDashboard instead — approval is their
     whole reason to be in the app.
   - Anything else (a custom role with no stage grants) falls back to
     OpsDashboard, same as before this feature existed. */
export default function Dashboard() {
  const { data, currentUserId, myRole } = useApp();
  const role = myRole();

  if (role === "DRI") return <DriDashboard />;
  if (role === "CRM") return <CrmDashboard />;
  if (role === "ADMIN" || role === "CIVIL" || role === "SUPERVISOR") return <OpsDashboard />;

  const isBuiltIn = (BUILT_IN_ROLES as readonly string[]).includes(role);
  const hasAnyStageGrant = STAGE_KEYS.some((k) => canActOnStage(data, currentUserId, role, k));
  if (!isBuiltIn && hasAnyStageGrant) return <ApprovalDashboard />;

  return <OpsDashboard />;
}
