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
  { key: "qualityMis", label: "Quality MIS", actions: ["view"] },
  { key: "executionReconciliation", label: "Execution Reconciliation", actions: ["view"] },
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
    handoverInternal: ["view", "edit"], handoverOwner: ["view"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view"],
    dpr: ["view", "create"],
    qualityInspection: ["view", "create", "edit"]
  },
  SUPERVISOR: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"], handoverOwner: ["view"],
    snags: ["view", "create", "edit", "delete"],
    team: ["view"],
    dpr: ["view", "create"],
    qualityInspection: ["view", "create", "edit"]
  },
  CRM: {
    handoverInternal: ["view"], handoverOwner: ["view"]
  },
  DRI: {
    dashboard: ["view"], myWork: ["view"], towerBoard: ["view"],
    handoverInternal: ["view", "edit"], handoverOwner: ["view"],
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
  // a role with no built-in defaults (CRM, custom roles) still starts with the normally-open pages On
  if (!def) return fillDefaultOn({}, role || null);
  const out: Record<string, Partial<Record<ModuleAction, boolean>>> = {};
  for (const [moduleKey, actions] of Object.entries(def)) {
    out[moduleKey] = Object.fromEntries(actions.map((a) => [a, true]));
  }
  return fillLegacyGrants(out, role || null);
}

/* Fills any module that has a LEGACY_FALLBACK but no entry of its own with
   the legacy module's current values (limited to the actions it supports),
   so the matrix toggles show the access a user really has instead of OFF. */
export function fillLegacyGrants(
  grants: Record<string, Partial<Record<ModuleAction, boolean>>> | undefined | null,
  role?: string | null
): Record<string, Partial<Record<ModuleAction, boolean>>> {
  const out = { ...(grants || {}) };
  for (const [key, legacy] of Object.entries(LEGACY_FALLBACK)) {
    if (out[key]) continue;
    const mod = MATRIX_MODULES.find((m) => m.key === key);
    const from = out[legacy];
    if (!mod || !from) continue;
    out[key] = Object.fromEntries(mod.actions.filter((a) => a in from).map((a) => [a, !!from[a]]));
  }
  return role === undefined ? out : fillDefaultOn(out, role);
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

/* ---------------------------------------------------------------------------
   WHO CAN OPEN WHICH PAGE — one table, used by BOTH the sidebar and the page
   router, so the Permission Matrix is the only thing that decides it (no
   per-role special cases left in the UI).

   Two kinds of page:
     "on"    visible to everyone unless an admin switched its "view" Off — for the
             user's own row or for their whole role. These were open to every
             signed-in user before the matrix controlled them, so nobody loses
             access just because the matrix now governs them; only an explicit Off
             hides one.
     "grant" visible only with a "view" grant (explicit, role-wide, or the role's
             built-in default in DEFAULT_ROLE_GRANTS).
   Admin always sees everything. The Permission Matrix page itself stays
   admin-only: letting it be granted would let someone grant themselves anything. */
export type TabAccess = { module: string; mode: "on" | "grant" };
export const TAB_ACCESS: Record<string, TabAccess> = {
  dash: { module: "dashboard", mode: "on" },
  work: { module: "myWork", mode: "on" },
  board: { module: "towerBoard", mode: "on" },
  // Handover Checklist needs a "view" tick (an unticked box in the role form is
  // simply not stored, so "visible unless explicitly Off" never matched what the
  // grid shows). The built-in roles that use it have it by default below.
  handoverInternal: { module: "handoverInternal", mode: "grant" },
  handoverOwner: { module: "handoverOwner", mode: "grant" },
  snags: { module: "snags", mode: "on" },
  team: { module: "team", mode: "grant" },
  dpr: { module: "dpr", mode: "grant" },
  drawingRequests: { module: "drawingRequests", mode: "grant" },
  qualityInspection: { module: "qualityInspection", mode: "grant" },
  unitExecutionWorkflow: { module: "unitExecution", mode: "grant" },
  measurement: { module: "measurement", mode: "grant" },
  progressAnalysis: { module: "progressAnalysis", mode: "grant" },
  purchaseOrders: { module: "purchaseOrders", mode: "grant" },
  misDashboard: { module: "qualityMis", mode: "grant" },
  executionReconciliation: { module: "executionReconciliation", mode: "grant" },
  masters: { module: "masters", mode: "grant" },
  backups: { module: "backups", mode: "grant" },
  auditLog: { module: "auditLog", mode: "grant" }
};

/** Roles whose built-in starting point has a normally-open page hidden
 *  (CRM has no stage work of its own, so My Work started hidden for it). An
 *  explicit matrix setting still overrides this either way. */
const DEFAULT_HIDDEN: Record<string, string[]> = { CRM: ["myWork"] };

export const DEFAULT_ON_MODULES = Object.values(TAB_ACCESS).filter((t) => t.mode === "on").map((t) => t.module);

/** A normally-open page: visible unless "view" was explicitly switched Off. */
export function canSeeModule(data: BoardData | null, userId: string | null, moduleKey: string): boolean {
  if (userId === "U-ADMIN") return true;
  const explicit = explicitGrant(data, userId, moduleKey, "view");
  if (explicit !== undefined) return explicit;
  const role = byId(coll(data, "users"), userId)?.role;
  return !(role && DEFAULT_HIDDEN[role]?.includes(moduleKey));
}

/** The one question the sidebar and the page router both ask. */
export function canAccessTab(data: BoardData | null, userId: string | null, tab: string): boolean {
  if (userId === "U-ADMIN") return true;
  if (tab === "permissionMatrix") return false;
  // the create-user screen needs the same right as editing Masters
  if (tab === "addUser") return hasModuleGrant(data, userId, "masters", "edit");
  const t = TAB_ACCESS[tab];
  if (!t) return true;
  return t.mode === "on" ? canSeeModule(data, userId, t.module) : hasModuleGrant(data, userId, t.module, "view");
}

/** Switch on the normally-open pages in a grants object for display, so the
 *  matrix toggles show what a person really has instead of Off. */
export function fillDefaultOn(
  grants: Record<string, Partial<Record<ModuleAction, boolean>>>, role: string | null | undefined
): Record<string, Partial<Record<ModuleAction, boolean>>> {
  const out = { ...grants };
  for (const m of DEFAULT_ON_MODULES) {
    if (out[m]?.view !== undefined) continue;
    if (role && DEFAULT_HIDDEN[role]?.includes(m)) continue;
    out[m] = { ...out[m], view: true };
  }
  return out;
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
  // Normally-open pages (Dashboard, My Work, Tower Board, Handover, Snags)
  // show as On unless switched Off, matching what the role really sees.
  for (const m of DEFAULT_ON_MODULES) {
    if (roleRec?.grants?.[m]?.view === undefined && !DEFAULT_HIDDEN[roleName]?.includes(m)) out[m] = { ...out[m], view: true };
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
