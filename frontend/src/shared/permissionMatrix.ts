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
  { key: "qualityInspection", label: "Quality Inspection", actions: ["view", "create", "edit"] },
  { key: "unitExecution", label: "Measurement", actions: ["view", "create"] },
  { key: "measurement", label: "Work-category Measurement (not in sidebar)", actions: ["view", "create"] },
  { key: "progressAnalysis", label: "Progress Analysis", actions: ["view"] },
  { key: "purchaseOrders", label: "Purchase Orders", actions: ["view"] },
  { key: "masters", label: "Masters", actions: ["view", "create", "edit", "delete"] },
  { key: "backups", label: "Backups", actions: ["view", "create", "delete"] },
  { key: "auditLog", label: "Audit Logs", actions: ["view"] }
];

/* These pages used to be gated by the Work Quality Inspection grant. They
   now have their own matrix rows, but until an admin sets one explicitly it
   still inherits that same module+action, so nobody who could open a page
   before loses it, and an explicit On/Off on the new row always wins. */
export const LEGACY_FALLBACK: Record<string, string> = {
  unitExecution: "qualityInspection",
  measurement: "qualityInspection",
  progressAnalysis: "qualityInspection",
  purchaseOrders: "qualityInspection"
};

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
    dpr: ["view", "create"],
    qualityInspection: ["view", "create", "edit"]
  },
  SUPERVISOR: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view"],
    dpr: ["view", "create"],
    qualityInspection: ["view", "create", "edit"]
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
  return fillLegacyGrants(out);
}

/* Fills any module that has a LEGACY_FALLBACK but no entry of its own with
   the legacy module's current values (limited to the actions it supports),
   so the matrix toggles show the access a user really has instead of OFF. */
export function fillLegacyGrants(
  grants: Record<string, Partial<Record<ModuleAction, boolean>>> | undefined | null
): Record<string, Partial<Record<ModuleAction, boolean>>> {
  const out = { ...(grants || {}) };
  for (const [key, legacy] of Object.entries(LEGACY_FALLBACK)) {
    if (out[key]) continue;
    const mod = MATRIX_MODULES.find((m) => m.key === key);
    const from = out[legacy];
    if (!mod || !from) continue;
    out[key] = Object.fromEntries(mod.actions.filter((a) => a in from).map((a) => [a, !!from[a]]));
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
  const explicit = explicitGrant(data, userId, moduleKey, action);
  if (explicit !== undefined) return explicit;
  // Pages that predate their own matrix row inherit the old module's value.
  const legacy = LEGACY_FALLBACK[moduleKey];
  if (legacy) return hasModuleGrant(data, userId, legacy, action);
  const user = byId(coll(data, "users"), userId);
  if (!user) return false;
  const def = DEFAULT_ROLE_GRANTS[user.role]?.[moduleKey];
  return !!def?.includes(action);
}

/* An explicitly saved value for this exact module+action: per-user first,
   then the user's role record (a built-in role's override or a custom
   role's grants). undefined = nothing saved, the caller falls back. */
function explicitGrant(
  data: BoardData | null, userId: string | null, moduleKey: string, action: ModuleAction
): boolean | undefined {
  const g = getModuleGrant(data, userId, moduleKey);
  if (g && action in g) return !!g[action];
  const user = byId(coll(data, "users"), userId);
  if (!user) return undefined;
  const roleRec = coll(data, "roles").find((r) => r.name === user.role);
  const roleAction = roleRec?.grants?.[moduleKey];
  if (roleAction && action in roleAction) return !!roleAction[action];
  return undefined;
}

/* Full module×action grid for one role, with every cell resolved to its
   actual current value (explicit role-record override, else the built-in
   DEFAULT_ROLE_GRANTS baseline, else off) — used by Permission Matrix's
   Role-wise tab so built-in roles show their real current state pre-marked,
   not just whatever's been explicitly saved. */
export function effectiveRoleGrants(
  data: BoardData | null, roleName: string
): Record<string, Partial<Record<ModuleAction, boolean>>> {
  const roleRec = coll(data, "roles").find((r) => r.name === roleName);
  const out: Record<string, Partial<Record<ModuleAction, boolean>>> = {};
  for (const m of MATRIX_MODULES) {
    out[m.key] = {};
    for (const a of m.actions) {
      const explicit = roleRec?.grants?.[m.key]?.[a];
      out[m.key]![a] = explicit !== undefined ? explicit : !!DEFAULT_ROLE_GRANTS[roleName as Role]?.[m.key]?.includes(a);
    }
  }
  // A module with its own row but nothing saved for it yet shows (and
  // behaves as) its legacy module's value, see LEGACY_FALLBACK.
  for (const [key, legacy] of Object.entries(LEGACY_FALLBACK)) {
    const mod = MATRIX_MODULES.find((m) => m.key === key);
    if (!mod) continue;
    for (const a of mod.actions) {
      if (roleRec?.grants?.[key]?.[a] === undefined) out[key]![a] = !!out[legacy]?.[a];
    }
  }
  return out;
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
