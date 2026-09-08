import type { BoardData, ModuleAction } from "../types";
import { coll } from "./rules";

/* Per-module admin-grantable actions — drives both pages/PermissionMatrix.tsx's
   UI (which toggles are shown per module) and every additive gate check
   elsewhere (hasModuleGrant). Keep in sync with backend/server.js's mirror
   of this same list (MATRIX_MODULES). */
export interface MatrixModule { key: string; label: string; actions: ModuleAction[] }

export const MATRIX_MODULES: MatrixModule[] = [
  { key: "dashboard", label: "Dashboard", actions: ["view"] },
  { key: "myWork", label: "My Work", actions: ["view"] },
  { key: "towerBoard", label: "Tower Board", actions: ["view"] },
  { key: "handoverChecklist", label: "Handover Checklist", actions: ["view", "edit"] },
  { key: "snags", label: "Snags", actions: ["view", "create", "edit", "delete"] },
  { key: "team", label: "Team", actions: ["view", "edit"] },
  { key: "dpr", label: "Daily Progress Report", actions: ["view", "create"] },
  { key: "drawingRequests", label: "Drawing Requests", actions: ["view", "create", "edit"] },
  { key: "masters", label: "Masters", actions: ["view", "create", "edit", "delete"] },
  { key: "backups", label: "Backups", actions: ["view", "create", "delete"] },
  { key: "auditLog", label: "Audit Logs", actions: ["view"] }
];

export function getModuleGrant(
  data: BoardData | null, userId: string | null, moduleKey: string
): Partial<Record<ModuleAction, boolean>> | null {
  if (!data || !userId) return null;
  const rec = coll(data, "moduleGrants").find((g) => g.userId === userId);
  return rec?.grants?.[moduleKey] || null;
}

/* Admin (U-ADMIN) always has every permission — this is an unconditional
   bypass, matching every other permission mechanism in the app
   (canActOnStage, assertOpAllowed). Everyone else's grant is ADDITIVE: it
   only ever unlocks extra access beyond myRole()==="ADMIN"/canAct(), never
   revokes anything a Role already gives — call sites use
   `existingCheck || hasModuleGrant(...)`, never as a sole gate. */
export function hasModuleGrant(
  data: BoardData | null, userId: string | null, moduleKey: string, action: ModuleAction
): boolean {
  if (userId === "U-ADMIN") return true;
  const g = getModuleGrant(data, userId, moduleKey);
  return !!g?.[action];
}

export function countGrantedActions(grants: Record<string, Partial<Record<ModuleAction, boolean>>>): number {
  let n = 0;
  for (const m of MATRIX_MODULES) {
    const g = grants[m.key];
    if (!g) continue;
    for (const a of m.actions) if (g[a]) n++;
  }
  return n;
}
