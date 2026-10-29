import React, { useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, byId } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { diffRecord, grantPatch } from "../shared/recordDiff";
import { buildEventOp } from "../shared/eventLog";
import { countGrantedActions, defaultGrantsForRole, effectiveRoleGrants, fillLegacyGrants } from "../shared/permissionMatrix";
import { ROLES } from "../services/config";
import { BUILT_IN_ROLES } from "../types";
import type { ModuleAction, ModuleGrant } from "../types";
import type { StageKey } from "../shared/permissions";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import PermissionGrid from "../components/PermissionGrid";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";

type Mode = "user" | "role";

export default function PermissionMatrix() {
  const { data, apply, currentUserId, toast } = useApp();
  const [mode, setMode] = useState<Mode>("user");
  const [saving, setSaving] = useState(false);

  const users = coll(data, "users").filter((u) => u.id !== "U-ADMIN");
  const [userId, setUserId] = useState(users[0]?.id || "");
  const existing = coll(data, "moduleGrants").find((g) => g.userId === userId) || null;

  // A user with no explicit Permission Matrix record yet still starts
  // pre-filled with their role's default grants (DEFAULT_ROLE_GRANTS) —
  // makes the baseline visible as ON toggles instead of only working
  // invisibly via hasModuleGrant()'s fallback. Saving from here always
  // writes an explicit record, same as before.
  const [roleLabel, setRoleLabel] = useState(existing?.roleLabel || "");
  const [grants, setGrants] = useState<Record<string, Partial<Record<ModuleAction, boolean>>>>(existing?.grants ? fillLegacyGrants(existing.grants, byId(users, userId)?.role || null) : defaultGrantsForRole(byId(users, userId)?.role));
  const [loadedFor, setLoadedFor] = useState(userId);
  // what was loaded when this user was picked (NOT the live copy): a save sends only what the admin changed relative to it
  const [baseGrants, setBaseGrants] = useState<Record<string, any> | null>(existing?.grants ?? null);
  const [baseLabel, setBaseLabel] = useState<string>(existing?.roleLabel || "");

  // Re-sync local draft when the selected user changes (not on every data
  // refresh, so mid-edit toggles aren't clobbered by a live-data poll).
  if (loadedFor !== userId) {
    const rec = coll(data, "moduleGrants").find((g) => g.userId === userId) || null;
    setRoleLabel(rec?.roleLabel || "");
    setBaseGrants(rec?.grants ?? null); setBaseLabel(rec?.roleLabel || "");
    setGrants(rec?.grants ? fillLegacyGrants(rec.grants, byId(users, userId)?.role || null) : defaultGrantsForRole(byId(users, userId)?.role));
    setLoadedFor(userId);
  }

  // Drawing Request stage approvals — same 4 flags as the dedicated
  // Drawing Request Permission Master, exposed here too so level-wise
  // approval rights can be set in one place alongside module access.
  const existingStageGrants = coll(data, "permissions").find((p) => p.userId === userId) || null;
  const [stageGrants, setStageGrants] = useState<Partial<Record<StageKey, boolean>>>(existingStageGrants || {});
  const [stageLoadedFor, setStageLoadedFor] = useState(userId);
  const [baseStage, setBaseStage] = useState<any>(existingStageGrants);
  if (stageLoadedFor !== userId) {
    setBaseStage(coll(data, "permissions").find((p) => p.userId === userId) || null);
    setStageGrants(coll(data, "permissions").find((p) => p.userId === userId) || {});
    setStageLoadedFor(userId);
  }

  // Role-wise mode: same grid, but editing one role's default grants —
  // either a custom role's own grants (Masters ▸ Role Master's "roles"
  // collection), or an explicit override on top of a built-in role's
  // hardcoded DEFAULT_ROLE_GRANTS baseline. Both built-in and custom roles
  // show up here, pre-marked with their real current access.
  const customRoles = coll(data, "roles").filter((r: any) => !r.builtin);
  const roleOptions = [
    ...BUILT_IN_ROLES.map((r) => ({ value: r as string, label: ROLES[r].name + " (built-in)" })),
    ...customRoles.map((r) => ({ value: r.name, label: r.name }))
  ];
  const [roleName, setRoleName] = useState(roleOptions[0]?.value || "");
  const [roleGrants, setRoleGrants] = useState<Record<string, Partial<Record<ModuleAction, boolean>>>>(effectiveRoleGrants(data, roleName));
  const [roleStageGrants, setRoleStageGrants] = useState<Partial<Record<StageKey, boolean>>>(
    coll(data, "roles").find((r) => r.name === roleOptions[0]?.value) || {}
  );
  const [roleLoadedFor, setRoleLoadedFor] = useState(roleName);
  const [baseRole, setBaseRole] = useState<any>(coll(data, "roles").find((r) => r.name === roleOptions[0]?.value) || null);
  if (roleLoadedFor !== roleName) {
    setBaseRole(coll(data, "roles").find((r) => r.name === roleName) || null);
    setRoleGrants(effectiveRoleGrants(data, roleName));
    setRoleStageGrants(coll(data, "roles").find((r) => r.name === roleName) || {});
    setRoleLoadedFor(roleName);
  }

  const user = byId(users, userId);
  const isBuiltinRole = (BUILT_IN_ROLES as readonly string[]).includes(roleName);
  const existingRoleRec = coll(data, "roles").find((r) => r.name === roleName) || null;
  const assignedCount = countGrantedActions(mode === "user" ? grants : roleGrants);

  function toggle(moduleKey: string, action: ModuleAction, v: boolean) {
    setGrants((prev) => ({ ...prev, [moduleKey]: { ...prev[moduleKey], [action]: v } }));
  }

  function toggleRole(moduleKey: string, action: ModuleAction, v: boolean) {
    setRoleGrants((prev) => ({ ...prev, [moduleKey]: { ...prev[moduleKey], [action]: v } }));
  }

  function toggleStage(k: StageKey, v: boolean) {
    setStageGrants((prev) => ({ ...prev, [k]: v }));
  }

  function toggleRoleStage(k: StageKey, v: boolean) {
    setRoleStageGrants((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    if (!userId || saving) return;
    setSaving(true);
    try {
      const rec: ModuleGrant = { id: "MG-" + userId, userId, roleLabel: roleLabel.trim() || undefined, grants };
      const stageRec = { id: baseStage?.id || existingStageGrants?.id || nextId("PRM", coll(data, "permissions")), userId, ...stageGrants };
      // Only what this admin changed since the user was loaded (a first save of a user with no stored record writes it whole).
      const grantsOp: any = baseGrants === null
        ? rec
        : { id: rec.id, ...(baseLabel !== (roleLabel.trim() || "") ? { roleLabel: roleLabel.trim() || null } : {}), ...grantPatch(baseGrants, grants) };
      const synced = await apply([
        { op: "upsert", coll: "moduleGrants", rec: grantsOp },
        { op: "upsert", coll: "permissions", rec: baseStage ? diffRecord(baseStage, stageRec as any) : stageRec, ...((baseStage?.id || existingStageGrants?.id) ? {} : { create: true }) } as any,
        buildEventOp(currentUserId, "PERMISSION_UPDATE", userId, "", `Updated module grants for ${user?.name || userId}`)
      ]);
      toast(synced ? "Permissions saved" : "Saved on this device — will finish submitting once you're back online");
    } finally {
      setSaving(false);
    }
  }

  async function saveRole() {
    if (!roleName || saving) return;
    setSaving(true);
    try {
      const rec = existingRoleRec
        ? { ...existingRoleRec, grants: roleGrants, ...roleStageGrants }
        : { id: "ROLE-OVERRIDE-" + roleName.toUpperCase(), name: roleName, builtin: true, grants: roleGrants, ...roleStageGrants };
      // an existing role record: only the modules/flags this admin changed since it was loaded
      // (roleStageGrants starts out as the whole stored role record, grants included — only its true/false flags are the
      // stage permissions, so only those are compared; the grants themselves go through grantPatch)
      const stageFlags = Object.fromEntries(Object.entries(roleStageGrants).filter(([, v]) => typeof v === "boolean"));
      const roleOp: any = baseRole
        ? { id: rec.id, ...grantPatch(baseRole.grants, roleGrants), ...diffRecord(baseRole, { id: rec.id, ...stageFlags } as any) }
        : rec;
      const synced = await apply([
        { op: "upsert", coll: "roles", rec: roleOp },
        buildEventOp(currentUserId, "PERMISSION_UPDATE", rec.id, "", `Updated default permissions for role ${roleName}`)
      ]);
      toast(synced ? "Role permissions saved" : "Saved on this device — will finish submitting once you're back online");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-6">
        <div className="flex gap-3.5 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="permissions" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Permission Matrix</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              {mode === "user"
                ? "Grant a user extra access on top of their role — never removes anything their role already allows."
                : "Set a custom role's default access — every user with this role gets it, unless a per-user override says otherwise."}
            </div>
          </div>
        </div>
        <div className="flex rounded-radius-md border border-[var(--border)] overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setMode("user")}
            className={"px-3.5 py-2 text-[12.5px] font-semibold " + (mode === "user" ? "bg-primary text-white" : "bg-[var(--bg-card)] text-[var(--text-muted)]")}
          >
            User-wise
          </button>
          <button
            type="button"
            onClick={() => setMode("role")}
            className={"px-3.5 py-2 text-[12.5px] font-semibold " + (mode === "role" ? "bg-primary text-white" : "bg-[var(--bg-card)] text-[var(--text-muted)]")}
          >
            Role-wise
          </button>
        </div>
      </div>

      {mode === "user" ? (
        <>
          <Card className="flex gap-4 flex-wrap items-end mb-5">
            <div className="w-[220px]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">User</div>
              <SearchDropdown
                value={userId}
                onChange={setUserId}
                options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))}
                neutralActive
              />
            </div>
            <div className="w-[220px]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Custom Role Label (optional)</div>
              <input className="input w-full" placeholder="e.g. Site Auditor" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} />
            </div>
            <div className="ml-auto text-right">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Assigned authorizations</div>
              <div className="text-xl font-medium leading-tight">{assignedCount}</div>
            </div>
          </Card>

          {!userId ? (
            <Card className="text-center text-[13px] text-[var(--text-muted)]">No users to grant permissions to.</Card>
          ) : (
            <div className="mb-5">
              <PermissionGrid grants={grants} onToggle={toggle} stageGrants={stageGrants} onToggleStage={toggleStage} />
            </div>
          )}

          {userId && (
            <div className="flex justify-end">
              <Btn label={saving ? "Saving…" : "Save Permissions"} color="primary" onClick={save} disabled={saving} />
            </div>
          )}
        </>
      ) : (
        <>
          <Card className="flex gap-4 flex-wrap items-end mb-5">
            <div className="w-[240px]">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Role</div>
              <SearchDropdown
                value={roleName}
                onChange={setRoleName}
                options={roleOptions}
                neutralActive
              />
            </div>
            {isBuiltinRole && (
              <div className="text-[11px] text-[var(--text-muted)] max-w-[320px]">
                This is a built-in role — toggles below start from its real current access; saving here adds an explicit override on top.
              </div>
            )}
            <div className="ml-auto text-right">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Assigned authorizations</div>
              <div className="text-xl font-medium leading-tight">{assignedCount}</div>
            </div>
          </Card>

          <div className="mb-5">
            <PermissionGrid grants={roleGrants} onToggle={toggleRole} stageGrants={roleStageGrants} onToggleStage={toggleRoleStage} />
          </div>

          {!!roleName && (
            <div className="flex justify-end">
              <Btn label={saving ? "Saving…" : "Save Role Permissions"} color="primary" onClick={saveRole} disabled={saving} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
