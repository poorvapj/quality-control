import type { BoardData, ModuleAction, Role } from "../types";
import { coll, byId } from "./rules";

/* Per-module admin-grantable actions — drives both pages/PermissionMatrix.tsx's
   UI (which toggles are shown per module) and every additive gate check
   elsewhere (hasModuleGrant). Keep in sync with backend/server.js's mirror
   of this same list (MATRIX_MODULES). */
export interface MatrixModule { key: string; label: string; actions: ModuleAction[] }

export const MATRIX_MODULES: MatrixModule[] = [
  { key: "dashboard", label: "Dashboard", actions: ["view"] },
  { key: "myWork", label: "My Work", actions: ["view"] },
  { key: "towerBoard", label: "Tower Board", actions: ["view"] },
  { key: "handoverInternal", label: "Handover Checklist — Internal", actions: ["view", "edit"] },
  { key: "handoverOwner", label: "Handover Checklist — Owner", actions: ["view", "edit"] },
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

/* Baseline grants every user of this role gets automatically, without
   needing an explicit per-user Permission Matrix record — matches what
   was manually granted to a representative user of each role (Dayansh
   Shrivastava for CIVIL/SUPERVISOR, Deepti Dixit for DRI) and is now the
   standard for everyone in that role. An explicit per-user grant (saved
   via pages/PermissionMatrix.tsx) always overrides this, in either
   direction — this is only the fallback when nothing's been explicitly
   set for that module+action yet. */
export const DEFAULT_ROLE_GRANTS: Partial<Record<Role, Record<string, ModuleAction[]>>> = {
  CIVIL: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view"],
    dpr: ["view", "create"]
  },
  SUPERVISOR: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view"],
    dpr: ["view", "create"]
  },
  DRI: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view", "edit"],
    dpr: ["view", "create"],
    drawingRequests: ["view", "create", "edit"]
  }
};

/* Full grants object for a role's baseline, in the same shape stored on a
   ModuleGrant record — used by PermissionMatrix.tsx to pre-fill toggles
   for a user who has no explicit record yet, so the defaults are visibly
   ON rather than only working invisibly. */
export function defaultGrantsForRole(role: Role | null | undefined): Record<string, Partial<Record<ModuleAction, boolean>>> {
  const def = role ? DEFAULT_ROLE_GRANTS[role] : undefined;
  if (!def) return {};
  const out: Record<string, Partial<Record<ModuleAction, boolean>>> = {};
  for (const [moduleKey, actions] of Object.entries(def)) {
    out[moduleKey] = Object.fromEntries(actions.map((a) => [a, true]));
  }
  return out;
}

/* Admin (U-ADMIN) always has every permission — this is an unconditional
   bypass, matching every other permission mechanism in the app
   (canActOnStage, assertOpAllowed). Everyone else's grant is ADDITIVE: it
   only ever unlocks extra access beyond myRole()==="ADMIN"/canAct(), never
   revokes anything a Role already gives — call sites use
   `existingCheck || hasModuleGrant(...)`, never as a sole gate. Falls back
   to DEFAULT_ROLE_GRANTS only when nothing's been explicitly saved for
   this exact module+action. */
export function hasModuleGrant(
  data: BoardData | null, userId: string | null, moduleKey: string, action: ModuleAction
): boolean {
  if (userId === "U-ADMIN") return true;
  const g = getModuleGrant(data, userId, moduleKey);
  if (g && action in g) return !!g[action];
  const user = byId(coll(data, "users"), userId);
  const def = user ? DEFAULT_ROLE_GRANTS[user.role]?.[moduleKey] : undefined;
  return !!def?.includes(action);
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
